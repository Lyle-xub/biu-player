"""Cross-platform large snapshot test; BIU_CARRIER_TEST points at the shared C++ carrier test executable."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud-video'))
import codec
import fullframe

with tempfile.TemporaryDirectory(prefix='biu-large-cloud-') as folder:
    folder = Path(folder)
    key = bytes(range(32))
    library = {'version': 1, 'likes': [], 'library': [], 'playlists': [],
               'entropy': os.urandom(850000).hex(), 'padding': '中' * (3 * 1024 * 1024)}
    payload, _ = codec.seal(library, key)
    assert len(payload) > 512 * 1024
    assert len(codec.normalize(library)) > 8 * 1024 * 1024
    sid = codec.sha(payload)[:32]
    # Both mobile platforms share this JS envelope; exercise both directions
    # through Python as well as the native packet transport below.
    (folder / 'python.bin').write_bytes(payload)
    (folder / 'library.json').write_bytes(codec.normalize(library))
    subprocess.run(['node', '--input-type=module', '-e', '''
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import {seal,unseal} from './mobile-rn/src/cloud/envelope.js';
      const folder=process.argv[1], key=Buffer.from(process.argv[2],'hex');
      const library=JSON.parse(fs.readFileSync(folder+'/library.json','utf8'));
      assert.deepEqual(unseal(fs.readFileSync(folder+'/python.bin'),key,process.argv[3]),library);
      const {payload}=seal(library,key,Buffer.alloc(12,7),'large-mobile-test');
      fs.writeFileSync(folder+'/mobile.bin',payload);
    ''', str(folder), key.hex(), sid], cwd=Path(__file__).resolve().parents[1], check=True)
    assert codec.unseal((folder / 'mobile.bin').read_bytes(), key)[0] == codec.normalize(library)
    packets = codec.packetize(payload, fullframe.BLOCK, fullframe.PROFILE)
    assert packets[0][:4] == b'BQ03'
    encoded = folder / 'python.packets'; encoded.write_bytes(b''.join(packets))
    recovered = folder / 'native.bin'
    subprocess.run([os.environ['BIU_CARRIER_TEST'], 'decode', str(encoded), sid, str(recovered)], check=True)
    assert recovered.read_bytes() == payload
    encoded = folder / 'native.packets'
    subprocess.run([os.environ['BIU_CARRIER_TEST'], 'encode', str(recovered), sid, str(encoded)], check=True)
    raw = encoded.read_bytes(); size = codec.HEADER.size + fullframe.BLOCK
    restored, _ = codec.recover([raw[i:i+size] for i in range(0, len(raw), size)], sid, fullframe.BLOCK, fullframe.PROFILE)
    assert codec.unseal(restored, key)[0] == codec.normalize(library)
    print('Large Python ↔ shared iOS/Android C++ carrier verified:', len(payload), 'encrypted bytes')
