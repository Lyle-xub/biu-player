const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { EventEmitter } = require('node:events');

test('cloud runtime uses bundled Windows DLL and venv paths while retaining the macOS compiler flow', async () => {
  for (const platform of ['win32', 'darwin']) {
    const windows = platform === 'win32', paths = windows ? path.win32 : path.posix;
    const source = windows ? 'C:\\Program Files\\Biu\\cloud-video' : '/Applications/Biu/cloud-video';
    const directory = windows ? 'C:\\Users\\Test\\Biu' : '/Users/test/Biu';
    const calls = [], writes = [], module = { exports: {} };
    const native = paths.join(source, 'wirehair.dll');
    let dllExists = true;
    const mocks = {
      'node:fs': { existsSync: (p) => p === native && dllExists, mkdirSync() {}, writeFileSync: (p) => writes.push(p) },
      'node:path': paths,
      'node:child_process': { spawn(bin, args, options) {
        calls.push({ bin, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        child.stdin = Object.assign(new EventEmitter(), { end() {} });
        queueMicrotask(() => child.emit('close', 0));
        return child;
      } },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../cloud-video-runtime'), 'utf8'), {
      module, require: (name) => mocks[name], process: { platform, env: { PATH: windows ? 'C:\\Python;C:\\ffmpeg' : '/usr/bin' } },
      setTimeout, clearTimeout,
    });
    const runtime = module.exports.createVideoRuntime({ source, directory });
    await runtime.ensure(undefined, () => {});
    assert.ok(calls.some((c) => c.bin === paths.join(directory, windows ? 'venv/Scripts/python.exe' : 'venv/bin/python')));
    assert.equal(calls.some((c) => c.bin === 'c++'), !windows);
    assert.ok(calls.every((c) => c.options.windowsHide && c.options.env.PYTHONUTF8 === '1'));
    assert.equal(writes[0], paths.join(directory, 'ready-v1'));
    if (windows) {
      assert.equal(calls[0].options.env.PATH, 'C:\\Python;C:\\ffmpeg');
      assert.ok(calls.some((c) => c.bin === 'python' && c.args.includes('venv')));
      dllExists = false;
      await assert.rejects(runtime.ensure(undefined, () => {}), /DLL/);
    }
  }
});
