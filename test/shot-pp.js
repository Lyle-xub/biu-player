#!/usr/bin/env node
/* 离屏渲染 app-preview，强制展开底部控制栏（平时 hover 才显示），截图验证 ppPrev/ppNext。 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200, height: 760, show: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'app-preview.html'));
  await new Promise((r) => setTimeout(r, 1200));
  await win.webContents.executeJavaScript(`
    (() => {
      const d = document.getElementById('f').contentDocument;
      const pill = d.querySelector('.progress-pill');
      // 模拟 hover 展开：直接给关键元素加内联样式
      const c = d.querySelector('.progress-controls');
      c.style.cssText += ';opacity:1;pointer-events:auto;transform:none';
      const m = d.querySelector('.progress-main');
      m.style.cssText += ';left:92px;right:118px;top:54px;transform:translateY(-50%)';
      const t = d.getElementById('ppTitle');
      if (t) t.textContent = '七里香 - 周杰伦';
      const err = document.getElementById('err');
      if (err) err.style.display = 'none';
      return !!d.getElementById('ppPrev') && !!d.getElementById('ppNext');
    })()
  `).then((ok) => console.log('buttons present:', ok));
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'shot-pp-step.png'), image.toPNG());
  console.log('shot saved');
  app.quit();
});
