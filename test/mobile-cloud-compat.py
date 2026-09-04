"""Run with the desktop cloud-codec Python environment; all keys are synthetic."""
import base64
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud-video'))
import codec
for name in ['video-cloud-mobile.json', 'video-cloud-python.json']:
    fixture = json.loads((Path(__file__).parent / 'fixtures' / name).read_text())
    raw, _ = codec.unseal(base64.b64decode(fixture['payload']), bytes.fromhex(fixture['key']))
    assert json.loads(raw) == fixture['library']
print('Desktop decodes mobile and Python envelopes, including differing float notation')
