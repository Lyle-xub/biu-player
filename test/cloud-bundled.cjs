// Real offline encode/decode from a relocated bundle, with no system Python or FFmpeg.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVideoRuntime } = require('../cloud-video-runtime');

async function main() {
  const source = path.resolve(process.argv[2] || 'cloud-video');
  const runtime = path.resolve(process.argv[3] || 'dist/cloud-runtime');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-cloud-'));
  try {
    const moved = path.join(temp, '音乐 Cloud');
    fs.mkdirSync(moved);
    for (const name of fs.readdirSync(source).filter(name => name.endsWith('.py'))) fs.copyFileSync(path.join(source, name), path.join(moved, name));
    fs.cpSync(runtime, path.join(moved, 'runtime'), { recursive: true, verbatimSymlinks: true });
    // Keep Windows system DLL lookup available, but exclude every installed tool.
    process.env.PATH = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin';
    process.env.PYTHONHOME = path.join(temp, 'does-not-exist');
    process.env.PYTHONPATH = process.env.PYTHONHOME;
    const cloud = createVideoRuntime({ source: moved });
    const library = { version: 1, likes: Array.from({ length: 80 }, (_, i) => ({ bvid: `test-${i}`, title: `跨设备音乐 ${i}` })) };
    const key = '12'.repeat(32); // Synthetic data only; never opens application data.
    const folder = path.join(temp, 'encoded');
    const { snapshotId } = await cloud.run({ operation: 'encode', folder, key, library, device: 'bundle-test' }, undefined, () => {});
    const output = path.join(temp, 'restored.json');
    const request = { operation: 'decode', url: path.join(folder, 'video.mp4'), key, output, snapshotId };
    await cloud.run(request, undefined, () => {});
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), library);
    const rejected = path.join(temp, 'rejected.json');
    await assert.rejects(cloud.run({ ...request, output: rejected, snapshotId: '0'.repeat(32) }, undefined, () => {}));
    assert.equal(fs.existsSync(rejected), false);
    console.log('Bundled runtime: offline round trip, relocation and authentication passed');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
