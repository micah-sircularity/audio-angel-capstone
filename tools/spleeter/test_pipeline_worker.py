"""CPU-only regressions: bounded preview decoding and publisher redirect chains."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import subprocess

import pipeline_worker as worker


class PreviewTests(unittest.TestCase):
    def test_decode_keeps_beginning_and_limits_duration(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'long.wav'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=2.4','-c:a','pcm_s16le',str(source)],check=True)
            with patch.object(worker,'MAX_SECONDS',1):
                result=worker.decode(source)
            self.assertEqual(result.shape,(44100,2))
            self.assertGreater(float(abs(result).max()),.05)

    def test_publisher_can_redirect_more_than_five_times(self):
        class Response:
            def __init__(self,step):
                self.is_redirect=step<7
                self.headers={'Location':f'https://audio.example/{step+1}'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def raise_for_status(self):pass
            def iter_content(self,_):yield b'audio bytes'
        class Session:
            def __init__(self):self.calls=0
            def get(self,*args,**kwargs):
                response=Response(self.calls);self.calls+=1;return response
        session=Session()
        with tempfile.TemporaryDirectory() as folder,patch('requests.Session',return_value=session),patch.object(worker,'public_url',side_effect=lambda url:url):
            output=Path(folder)/'episode'
            worker.download('https://audio.example/0',output)
            self.assertEqual(output.read_bytes(),b'audio bytes')
            self.assertEqual(session.calls,8)

if __name__=='__main__':unittest.main()
