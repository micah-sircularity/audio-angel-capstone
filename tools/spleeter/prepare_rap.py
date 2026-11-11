"""Prepare the fixed rap listening experiment; no new separation/GPU call.
Run with: uv run --with numpy --with soundfile python tools/spleeter/prepare_rap.py
Deepgram key is read from the process environment or the personal dev deployment.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

import numpy as np
import soundfile as sf

SOURCE = Path('tools/spleeter/output/20261103T185831.786198Z')
OUT = Path('tools/spleeter/output/rap-word-filter')
OUT.mkdir(parents=True, exist_ok=True)
started = time.perf_counter()
vocals, rate = sf.read(SOURCE / 'vocals.wav', dtype='float32', always_2d=True)
beat, beat_rate = sf.read(SOURCE / 'instrumental.wav', dtype='float32', always_2d=True)
assert rate == beat_rate == 44100 and vocals.shape == beat.shape
assert np.isfinite(vocals).all() and np.isfinite(beat).all()
# One fixed gain protects every mix, including the unmuted comparison, from clipping.
peak_bound = float(np.max(np.abs(vocals) + np.abs(beat)))
gain = min(1.0, .98 / peak_bound)
buffer = io.BytesIO()
sf.write(buffer, vocals.mean(axis=1), rate, format='WAV', subtype='PCM_16')
audio = buffer.getvalue()
asr_hash = hashlib.sha256(audio).hexdigest()
preparation_s = time.perf_counter() - started
transcript_path = OUT / 'vocals-transcript.json'
timing_path = OUT / 'vocals-transcription-timing.json'
transcription_cache_hit = False
if transcript_path.exists() and timing_path.exists():
    timing = json.loads(timing_path.read_text())
    transcription_cache_hit = timing.get('input_sha256') == asr_hash
if transcription_cache_hit:
    raw = json.loads(transcript_path.read_text())
else:
    key = os.environ.get('DEEPGRAM_API_KEY', '')
    if not key:
        result = subprocess.run(['pnpm', 'exec', 'convex', 'env', 'get', 'DEEPGRAM_API_KEY', '--deployment', 'dev'], capture_output=True, text=True, check=True)
        key = result.stdout.strip()
    if not key or key == 'undefined':
        raise RuntimeError('Development transcription credential is unavailable')
    request = urllib.request.Request(
        'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true&profanity_filter=false',
        data=audio, headers={'Authorization': 'Token ' + key, 'Content-Type': 'audio/wav'}, method='POST')
    t = time.perf_counter()
    with urllib.request.urlopen(request, timeout=240) as response:
        raw = json.load(response)
    transcription_s = time.perf_counter() - t
    timing = {'transcription_s': transcription_s, 'preparation_s': preparation_s,
              'input_bytes': len(audio), 'input_sha256': asr_hash, 'runs': 1,
              'input': 'mono PCM16 WAV from cached aligned vocal stem',
              'includes': 'audio upload, provider processing, response download',
              'excludes': 'credential lookup, prior separation, stem download, render',
              'request_id': raw['metadata']['request_id']}
    transcript_path.write_text(json.dumps(raw, indent=2) + '\n')
    timing_path.write_text(json.dumps(timing, indent=2) + '\n')
words = raw['results']['channels'][0]['alternatives'][0]['words']
if not words:
    raise RuntimeError('Transcription returned no words')
duration = len(vocals) / rate
normalized = []
for w in words:
    if not 0 <= w['start'] < w['end'] <= duration + .1:
        raise RuntimeError('Transcription timestamp outside recording')
    normalized.append({'word': w['word'], 'start': w['start'], 'end': min(w['end'], duration), 'confidence': w['confidence']})
fingerprints = {name: hashlib.sha256((SOURCE / (name + '.wav')).read_bytes()).hexdigest()
                for name in ['vocals', 'instrumental']}
manifest = {'title': 'I Be On My Shit', 'artist': 'Smiz The Cryptokid', 'trackId': 'm7AlvqA',
            'sourceUrl': 'https://audius.co/PraiseGod/i-be-on-my-shit',
            'duration': duration, 'sampleRate': rate, 'frames': len(vocals), 'gain': gain,
            'fingerprints': fingerprints, 'words': normalized,
            'defaultWords': ['fuck', 'fucking', 'fucked', 'motherfucker', 'motherfucking', 'shit', 'bullshit', 'bitch', 'bitches', 'ass', 'asshole', 'dick', 'pussy', 'damn', 'bastard', 'nigga', 'niggas', 'nigger', 'niggers'],
            'transcription': timing,
            'priorSeparation': json.loads((SOURCE / 'report.json').read_text()),
            'vocalsPath': str((SOURCE / 'vocals.wav').resolve()),
            'instrumentalPath': str((SOURCE / 'instrumental.wav').resolve())}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'duration': duration, 'word_count': len(words), 'transcription_s': timing['transcription_s'],
                  'transcription_cache_hit': transcription_cache_hit, 'gain': gain,
                  'default_matches': [w for w in normalized if w['word'] in manifest['defaultWords']]}))
