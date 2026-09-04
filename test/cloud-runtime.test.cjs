const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { EventEmitter } = require('node:events');

test('both platforms use only bundled components, ignoring host Python settings', async () => {
  for (const platform of ['win32', 'darwin']) {
    const windows = platform === 'win32', paths = windows ? path.win32 : path.posix;
    const source = windows ? 'C:\\Program Files\\Biu\\cloud-video' : '/Applications/Biu/cloud-video';
    const calls = [], module = { exports: {} };
    let complete = true;
    const mocks = {
      'node:fs': { existsSync: () => complete },
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
      module, require: name => mocks[name], process: { platform, env: { PATH: '', PYTHONHOME: '/invalid' } },
      setTimeout, clearTimeout,
    });
    const runtime = module.exports.createVideoRuntime({ source });
    await runtime.ensure();
    await runtime.ensure();
    assert.equal(calls.length, 2, 'prepare once; no pip, venv or compiler');
    assert.equal(calls[0].bin, paths.join(source, windows ? 'runtime/ffmpeg.exe' : 'runtime/ffmpeg'));
    assert.equal(calls[1].bin, paths.join(source, windows ? 'runtime/python/python.exe' : 'runtime/python/bin/python3'));
    assert.ok(calls[1].args.includes('-E') && calls[1].args.includes('-s'));
    assert.ok(calls.every(c => c.options.windowsHide && c.options.env.BIU_FFMPEG === calls[0].bin));
    assert.equal(calls[1].options.env.PATH, '');
    complete = false;
    await assert.rejects(module.exports.createVideoRuntime({ source }).ensure(), /缺少内置同步组件/);
  }
});
