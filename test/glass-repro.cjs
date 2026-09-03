/* 毛玻璃对照实验：四种胶囊写法在锐利条纹背景上的模糊表现。
 * 用法：npx electron test/glass-repro.cjs  → 输出 /tmp/glass-repro.png */
const { app, BrowserWindow } = require('electron');

const HTML = `<!DOCTYPE html><html><head><style>
body { margin: 0; background: #222; }
.stage { position: relative; width: 900px; height: 260px; overflow: hidden;
  background: repeating-linear-gradient(45deg, #e74c3c 0 12px, #3498db 12px 24px, #f1c40f 24px 36px, #2ecc71 36px 48px); }
.pill { position: absolute; top: 90px; width: 180px; height: 60px; border-radius: 30px;
  display: grid; place-items: center; color: #fff; font: 14px sans-serif; }
.pill .glass { position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: rgba(18,18,16,.38);
  backdrop-filter: blur(16px) saturate(1.6);
  -webkit-backdrop-filter: blur(16px) saturate(1.6); }
.pill span { position: relative; z-index: 1; }
/* A：现状 —— 玻璃层带 clip-path */
#pa { left: 30px; overflow: hidden; }
#pa .glass { clip-path: inset(0 round 30px); }
/* B：玻璃层无 clip-path，外壳 overflow:hidden */
#pb { left: 250px; overflow: hidden; }
/* C：backdrop-filter 直接画在元素上，无伪元素 */
#pc { left: 470px; overflow: hidden;
  background: rgba(18,18,16,.38);
  backdrop-filter: blur(16px) saturate(1.6);
  -webkit-backdrop-filter: blur(16px) saturate(1.6); }
/* D：无 overflow、无伪元素，最裸写法 */
#pd { left: 690px;
  background: rgba(18,18,16,.38);
  backdrop-filter: blur(16px) saturate(1.6);
  -webkit-backdrop-filter: blur(16px) saturate(1.6); }
.label { position: absolute; top: 170px; color: #fff; font: 12px sans-serif; }
</style></head><body>
<div class="stage">
  <div class="pill" id="pa"><i class="glass"></i><span>A clip-path</span></div>
  <div class="pill" id="pb"><i class="glass"></i><span>B overflow only</span></div>
  <div class="pill" id="pc"><span>C direct + of</span></div>
  <div class="pill" id="pd"><span>D direct bare</span></div>
</div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 920, height: 280,
    webPreferences: { offscreen: false } });
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage();
  require('fs').writeFileSync('/tmp/glass-repro.png', img.toPNG());
  console.log('SAVED /tmp/glass-repro.png');
  app.exit(0);
});
