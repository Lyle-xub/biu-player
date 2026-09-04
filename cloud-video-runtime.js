const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createVideoRuntime({ source, runtime = path.join(source, 'runtime') }) {
  const windows = process.platform === 'win32';
  const python = path.join(runtime, windows ? 'python/python.exe' : 'python/bin/python3');
  const ffmpeg = path.join(runtime, windows ? 'ffmpeg.exe' : 'ffmpeg');
  const native = path.join(runtime, windows ? 'wirehair.dll' : 'libwirehair.dylib');
  const certificate = path.join(runtime, windows ? 'python/Lib/site-packages/certifi/cacert.pem' : 'python/lib/python3.12/site-packages/certifi/cacert.pem');
  const env = { ...process.env, BIU_WIREHAIR: native, BIU_FFMPEG: ffmpeg, SSL_CERT_FILE: certificate };
  // Ignore host Python settings and user-installed modules; never install at runtime.
  const pythonArgs = ['-E', '-s', '-B', '-X', 'utf8'];
  let preparing;
  function command(bin, args, signal, input, onLine = () => {}, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('同步已停止'));
      const child = spawn(bin, args, { cwd: source, env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
      let buffer = '', error = '', settled = false;
      const cancel = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
      const deadline = setTimeout(cancel, 10*60*1000);deadline.unref?.();
      signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
        if (buffer.length > 1024 * 1024) { error = '同步组件输出超出限制'; cancel(); }
      });
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-4000); });
      child.stdin.on('error', () => {});
      child.once('error', () => { settled = true; clearTimeout(deadline);signal?.removeEventListener('abort', cancel); reject(new Error('无法启动内置同步组件，请重新安装完整版本')); });
      child.once('close', code => {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', cancel);
        if (settled) return;
        if (code !== 0) reject(new Error(signal?.aborted ? '同步已停止' : '内置同步组件执行失败，请检查磁盘空间或重新安装完整版本'));
        else resolve();
      });
      child.stdin.end(input || '');
    });
  }
  async function ensure(signal) {
    if (preparing) return preparing;
    preparing = (async () => {
      if (![python, ffmpeg, native, certificate].every(p => fs.existsSync(p))) throw new Error('缺少内置同步组件，请安装完整版本；源码运行请先执行 npm run build:cloud');
      await command(ffmpeg, ['-version'], signal);
      await command(python, [...pythonArgs, '-c', 'import ctypes,os,cryptography,numpy,PIL,reedsolo,certifi; assert ctypes.CDLL(os.environ["BIU_WIREHAIR"]).wirehair_init_(2)==0'], signal);
    })().catch(error => { preparing = null; throw error; });
    return preparing;
  }
  async function run(request, signal, onEvent) {
    await ensure(signal, onEvent);
    let result, failure;
    try { await command(python, [...pythonArgs, path.join(source, 'worker.py')], signal, JSON.stringify(request), line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'result') result = event;
      else if (event.type === 'error') failure = event.message;
      else onEvent(event);
    }, { BIU_WIREHAIR: native }); } catch(e) { throw new Error(failure || e.message); }
    if (!result) throw new Error(failure || '同步组件没有返回完整结果');
    return result;
  }
  return { run, ensure };
}
module.exports = { createVideoRuntime };
