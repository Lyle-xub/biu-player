/* 复现脚本：隐藏窗口里执行 splitAnalyzeAudio 同款 decodeAudioData 流程，
 * 观察长音频解码是否导致渲染进程 OOM（黑屏）。用法：npx electron test/decode-repro.cjs <m4a路径> */
const { app, BrowserWindow } = require('electron');

const file = process.argv[2];
if (!file) { console.error('usage: electron decode-repro.cjs <file.m4a>'); app.exit(1); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('RENDERER_GONE', JSON.stringify(details));
    app.exit(2);
  });
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
  await win.loadURL('about:blank');
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const fs = require('fs');
      const buf = fs.readFileSync(${JSON.stringify(file)});
      const out = { fileMB: +(buf.length / 1048576).toFixed(1) };
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      try {
        const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const ctx = new AC(1, 1, 44100);
        const audio = await ctx.decodeAudioData(ab);
        out.duration = Math.round(audio.duration);
        out.rate = audio.sampleRate;
        out.ch = audio.numberOfChannels;
        out.floatMB = +(audio.length * audio.numberOfChannels * 4 / 1048576).toFixed(0);
        const chA = audio.getChannelData(0);
        const chB = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
        const src = new Int16Array(audio.length);
        for (let i = 0; i < audio.length; i++) src[i] = (chB ? (chA[i] + chB[i]) / 2 : chA[i]) * 32767;
        out.srcMB = +(src.byteLength / 1048576).toFixed(0);
        const pcm = new Int16Array(Math.round(audio.duration * 24000));
        out.pcmMB = +(pcm.byteLength / 1048576).toFixed(0);
        out.heapMB = +(performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1).toFixed(0);
        out.ok = true;
      } catch (e) { out.error = String(e); }
      return out;
    })()`);
    console.log('RESULT', JSON.stringify(result));
    app.exit(0);
  } catch (e) {
    console.log('EXECUTE_FAILED', String(e));
    app.exit(3);
  }
});
