/* 验证 split-decode.js：流式解码长音频不 OOM。用法：npx electron test/decode-stream-repro.cjs <m4a/m4s路径> */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('usage: electron decode-stream-repro.cjs <file>'); app.exit(1); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.webContents.on('render-process-gone', (_e, d) => { console.log('RENDERER_GONE', JSON.stringify(d)); app.exit(2); });
  await win.loadFile(path.join(__dirname, 'decode-repro.html'));
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const fs = require('fs');
      const src = fs.readFileSync(${JSON.stringify(path.join(__dirname, '../renderer/split-decode.js'))}, 'utf8');
      eval(src);
      const buf = fs.readFileSync(${JSON.stringify(file)});
      const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const out = { fileMB: +(buf.length / 1048576).toFixed(1) };
      const t0 = Date.now();
      try {
        const r = await window.splitDecodeAacStream(u8, {
          duration: 0, keepSrc: true,
          onProgress: () => {},
        });
        out.ok = true;
        out.duration = Math.round(r.duration);
        out.srcRate = r.srcRate;
        out.pcmMin = Math.round(r.pcm.length / 24000 / 60) + 'min';
        out.srcMin = r.srcPcm ? Math.round(r.srcPcm.length / r.srcRate / 60) + 'min' : null;
        // 简单能量校验：全 0 说明解错了
        let nz = 0;
        for (let i = 0; i < r.pcm.length; i += 997) if (Math.abs(r.pcm[i]) > 200) nz++;
        out.nonZeroRatio = +(nz / (r.pcm.length / 997)).toFixed(3);
        out.heapMB = +(performance.memory ? performance.memory.usedJSHeapSize / 1048576 : -1).toFixed(0);
      } catch (e) { out.error = String(e && e.message || e); }
      out.ms = Date.now() - t0;
      return out;
    })()`);
    console.log('RESULT', JSON.stringify(result));
    app.exit(0);
  } catch (e) { console.log('EXECUTE_FAILED', String(e)); app.exit(3); }
});
