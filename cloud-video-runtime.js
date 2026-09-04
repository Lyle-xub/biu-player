const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createVideoRuntime({ source, directory }) {
  const windows = process.platform === 'win32';
  const env = { ...process.env, PYTHONUTF8: '1', ...(!windows && { PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` }) };
  const python = path.join(directory, windows ? 'venv/Scripts/python.exe' : 'venv/bin/python');
  const hostPython = windows ? 'python' : ['/opt/homebrew/bin/python3','/usr/local/bin/python3'].find(p=>fs.existsSync(p)) || 'python3';
  const native = windows ? path.join(source, 'wirehair.dll')
    : path.join(directory, process.platform === 'darwin' ? 'libwirehair.dylib' : 'libwirehair.so');
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
      child.once('error', () => { settled = true; clearTimeout(deadline);signal?.removeEventListener('abort', cancel); reject(new Error(windows ? '无法启动同步组件，请安装 Python 3.12+ 和 FFmpeg，并加入 PATH' : '无法启动同步组件，请安装 Python 3.12+、FFmpeg 和 C++ 编译器')); });
      child.once('close', code => {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', cancel);
        if (settled) return;
        if (code !== 0) reject(new Error(signal?.aborted ? '同步已停止' : '同步组件执行失败，请检查 Python、FFmpeg 和磁盘空间'));
        else resolve();
      });
      child.stdin.end(input || '');
    });
  }
  async function ensure(signal, log) {
    if (preparing) return preparing;
    preparing = (async () => {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (windows && !fs.existsSync(native)) throw new Error('安装包缺少视频同步 DLL，请重新安装完整版本');
      await command('ffmpeg', ['-version'], signal);
      if (!fs.existsSync(python)) {
        log({ type: 'setup', message: '首次启用：正在准备视频同步组件' });
        try { await command(hostPython, ['-c', 'import sys; assert sys.version_info >= (3,12)'], signal); }
        catch(e) { if(signal?.aborted)throw e;throw new Error('视频云同步需要 Python 3.12 或更高版本'); }
        await command(hostPython, ['-m', 'venv', path.join(directory, 'venv')], signal);
      }
      if (!fs.existsSync(path.join(directory, 'ready-v1'))) {
        await command(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(source, 'requirements.txt')], signal);
        if (!windows) await command('c++', ['-std=c++11', '-O2', ...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-fPIC']), '-I', source,
          ...['wirehair.cpp', 'WirehairCodec.cpp', 'WirehairTools.cpp', 'gf256.cpp'].map(f => path.join(source, 'wirehair', f)), '-o', native], signal);
        fs.writeFileSync(path.join(directory, 'ready-v1'), '1');
      }
    })().finally(() => { preparing = null; });
    return preparing;
  }
  async function run(request, signal, onEvent) {
    await ensure(signal, onEvent);
    let result, failure;
    try { await command(python, [path.join(source, 'worker.py')], signal, JSON.stringify(request), line => {
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
