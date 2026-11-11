"""Authenticated Modal workers for cached music/podcast rendering."""
from __future__ import annotations
import hashlib
import hmac
import os
from pathlib import Path
import socket
import ipaddress
import subprocess
import tempfile
import time
from urllib.parse import urlparse, urljoin

import modal
from modal_test import image as separation_image

app = modal.App('audio-angel-media')
base = separation_image.pip_install('fastapi[standard]', 'requests==2.32.5').add_local_python_source('modal_test')
gpu_image = base
secret = modal.Secret.from_name('audio-angel-media-worker')
MAX_BYTES = 24 * 1024 * 1024
MAX_SECONDS = 1800


def authorize(authorization):
    from fastapi import HTTPException
    if not hmac.compare_digest(authorization or '', 'Bearer ' + os.environ['MEDIA_WORKER_TOKEN']):
        raise HTTPException(status_code=401, detail='Unauthorized')


def public_url(raw):
    u = urlparse(raw)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port not in (None, 443):
        raise ValueError('HTTPS public URL required')
    for result in socket.getaddrinfo(u.hostname, 443):
        if not ipaddress.ip_address(result[4][0]).is_global:
            raise ValueError('Private addresses are not allowed')
    return raw


def download(url, path, cap=MAX_BYTES):
    import requests
    # Validate each redirect and disable environment HTTP proxies.
    session = requests.Session(); session.trust_env = False
    for _ in range(12):
        with session.get(public_url(url), stream=True, allow_redirects=False, timeout=(15, 120)) as r:
            if r.is_redirect:
                url = urljoin(url, r.headers['Location']); continue
            r.raise_for_status()
            total = 0
            with open(path, 'wb') as f:
                for block in r.iter_content(65536):
                    total += len(block)
                    if total > cap: raise ValueError('Audio exceeds worker size limit')
                    f.write(block)
            return
    raise ValueError('Too many audio redirects')


def upload(url, path, mime):
    import requests
    u = urlparse(public_url(url))
    if not u.hostname.endswith('.convex.cloud') or not u.path.startswith('/api/storage/upload'):
        raise ValueError('Expected a Convex storage upload URL')
    with open(path, 'rb') as f:
        response = requests.post(url, data=f, headers={'Content-Type': mime}, timeout=120, allow_redirects=False)
    response.raise_for_status()
    return response.json()['storageId']


def decode(path):
    import numpy as np
    data = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-t', str(MAX_SECONDS), '-ar', '44100', '-ac', '2', '-f', 'f32le', 'pipe:1'], timeout=120)
    samples = np.frombuffer(data, dtype='<f4').reshape(-1, 2).copy()
    if len(samples) == 0 or len(samples) > MAX_SECONDS * 44100 or not np.isfinite(samples).all():
        raise ValueError('Audio must be finite, nonempty, and at most 30 minutes')
    return samples


def encode(samples, path, codec):
    import numpy as np
    args = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0']
    args += ['-c:a', 'flac', '-sample_fmt', 's32'] if codec == 'flac' else ['-c:a', 'libmp3lame', '-b:a', '192k']
    subprocess.run(args + [str(path)], input=np.asarray(samples, dtype='<f4').tobytes(), check=True, timeout=120)


@app.function(image=gpu_image, gpu='T4', cpu=2, memory=8192, max_containers=1, scaledown_window=2, timeout=600, secrets=[secret])
@modal.fastapi_endpoint(method='POST')
def separate(payload: dict, authorization: str = __import__('fastapi').Header(default='')):
    authorize(authorization)
    import numpy as np
    import tensorflow as tf
    from spleeter.separator import Separator
    if len(tf.config.list_physical_devices('GPU')) != 1: raise RuntimeError('One GPU required')
    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp); source = root / 'source'
        download(payload['sourceUrl'], source)
        if hashlib.sha256(source.read_bytes()).hexdigest() != payload['sourceHash']: raise ValueError('Source hash changed')
        original = decode(source)
        separator = Separator('spleeter:2stems', multiprocess=False)
        result = {name: np.zeros_like(original) for name in ['vocals', 'accompaniment']}
        # Context on each side is discarded, keeping memory bounded on longer music.
        chunk, context = 30 * 44100, 2 * 44100
        t = time.perf_counter()
        for start in range(0, len(original), chunk):
            end = min(len(original), start + chunk)
            lo, hi = max(0, start-context), min(len(original), end+context)
            stems = separator.separate(original[lo:hi])
            for name in result:
                if stems[name].shape != original[lo:hi].shape or not np.isfinite(stems[name]).all(): raise ValueError('Invalid stem')
                result[name][start:end] = stems[name][start-lo:end-lo]
        separation_s = time.perf_counter() - t
        gain = min(1.0, .98 / max(.98, float(np.max(np.abs(result['vocals']) + np.abs(result['accompaniment'])))))
        # FLAC is integer PCM. Scale both stems together before export to avoid clipping.
        peak = max(float(np.max(np.abs(result['vocals']))), float(np.max(np.abs(result['accompaniment']))))
        stem_scale = min(1.0, .98 / max(.98, peak))
        gain /= stem_scale
        ids = {}
        for name, key in [('vocals', 'vocals'), ('accompaniment', 'instrumental')]:
            path = root / (key + '.flac'); encode(result[name] * stem_scale, path, 'flac')
            ids[key] = upload(payload[key+'UploadUrl'], path, 'audio/flac')
        return {**ids, 'duration': len(original)/44100, 'frames': len(original), 'gain': gain,
                'separation_s': separation_s, 'worker_s': time.perf_counter()-started}


@app.function(image=base, cpu=2, memory=8192, max_containers=1, scaledown_window=2, timeout=600, secrets=[secret])
@modal.fastapi_endpoint(method='POST')
def render(payload: dict, authorization: str = __import__('fastapi').Header(default='')):
    authorize(authorization)
    import numpy as np
    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp); source = root / 'source'
        download(payload['voiceUrl'], source, cap=512*1024*1024)
        vocals = decode(source)
        gain = float(payload.get('gain', 1))
        if not payload.get('instrumentalUrl'):
            gain = min(gain, .98 / max(.98, float(np.max(np.abs(vocals)))))
        if not 0 < gain <= 1: raise ValueError('Invalid gain')
        mask = np.ones(len(vocals), dtype=np.float32)
        for interval in payload['intervals']:
            a, b = round(interval['start']*44100), round(interval['end']*44100)
            if not 0 <= a < b <= len(vocals): raise ValueError('Invalid mute interval')
            fade = min(441, (b-a)//2)
            gate = np.zeros(b-a, dtype=np.float32)
            if fade:
                gate[:fade] = np.linspace(1, 0, fade)
                gate[-fade:] = np.linspace(0, 1, fade)
            mask[a:b] = np.minimum(mask[a:b], gate)
        t = time.perf_counter()
        output = vocals * mask[:, None]
        if payload.get('instrumentalUrl'):
            path = root/'instrumental'; download(payload['instrumentalUrl'], path, cap=512*1024*1024)
            beat = decode(path)
            if beat.shape != vocals.shape: raise ValueError('Stems are not aligned')
            output += beat
        output *= gain
        if np.max(np.abs(output)) > 1.0001 or not np.isfinite(output).all(): raise ValueError('Invalid/clipped output')
        mix_s = time.perf_counter()-t
        t = time.perf_counter(); target=root/'filtered.mp3'; encode(output, target, 'mp3')
        encode_s = time.perf_counter()-t
        file_id = upload(payload['uploadUrl'], target, 'audio/mpeg')
        return {'fileId': file_id, 'duration': len(output)/44100, 'frames': len(output),
                'mix_s': mix_s, 'encode_s': encode_s, 'worker_s': time.perf_counter()-started}


@app.function(image=base, cpu=2, memory=8192, max_containers=1, scaledown_window=2, timeout=600, secrets=[secret])
@modal.fastapi_endpoint(method='POST')
def preview(payload: dict, authorization: str = __import__('fastapi').Header(default='')):
    """Accept a larger episode on disk, then persist only its first 30 minutes."""
    authorize(authorization)
    import json
    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp); source = root/'episode'; target = root/'preview.mp3'
        download(payload['sourceUrl'], source, cap=512*1024*1024)
        download_s = time.perf_counter()-started
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(source)], timeout=30))
        source_duration = float(info.get('format', {}).get('duration', 0))
        if source_duration <= 0: raise ValueError('Episode has no valid audio duration')
        t = time.perf_counter()
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source), '-t', str(MAX_SECONDS), '-map', '0:a:0', '-vn', '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '96k', str(target)], check=True, timeout=240)
        if not target.exists() or target.stat().st_size == 0: raise ValueError('Empty podcast preview')
        encode_s = time.perf_counter()-t
        file_id = upload(payload['uploadUrl'], target, 'audio/mpeg')
        return {'fileId': file_id, 'sourceHash': hashlib.sha256(target.read_bytes()).hexdigest(),
                'durationMs': round(min(source_duration, MAX_SECONDS)*1000),
                'sourceDurationMs': round(source_duration*1000), 'isPreview': source_duration > MAX_SECONDS,
                'download_s': download_s, 'preview_encode_s': encode_s, 'worker_s': time.perf_counter()-started}
