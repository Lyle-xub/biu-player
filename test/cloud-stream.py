"""Exercise real FFmpeg pipes with synthetic data; BIU_WIREHAIR selects the native library."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parents[1] / 'cloud-video'
sys.path.insert(0, str(source))
import stream_read

with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp) / 'encoded'
    library = {'version': 1, 'likes': [{'bvid': f'test-{i}', 'title': f'跨设备音乐 {i}'} for i in range(80)]}
    key = '12' * 32  # Test-only key; never reads application data.
    request = dict(operation='encode', folder=str(folder), library=library, key=key, device='windows-test')
    result = subprocess.run([sys.executable, str(source / 'worker.py')], input=json.dumps(request).encode(),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert result.returncode == 0, (result.stdout.decode('utf-8'), result.stderr.decode('utf-8'))
    events = [json.loads(line) for line in result.stdout.splitlines()]
    snapshot = next(event['snapshotId'] for event in events if event['type'] == 'result')
    output = Path(tmp) / 'restored.json'
    proof = stream_read.restore(folder / 'video.mp4', bytes.fromhex(key), output, snapshot, timeout=20)
    assert proof['passed'] and json.loads(output.read_text(encoding='utf-8')) == library
    rejected = Path(tmp) / 'rejected.json'
    try:
        stream_read.restore(folder / 'video.mp4', bytes.fromhex(key), rejected, '0' * 32, timeout=20)
        raise AssertionError('Wrong snapshot was accepted')
    except ValueError as error:
        assert 'unexpected snapshot' in str(error), error
    assert not rejected.exists()
print('Real video restores through subprocess pipes; incorrect snapshot is rejected')
