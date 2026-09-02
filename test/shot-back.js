#!/usr/bin/env node
/* 离屏渲染 app-preview（playing 视图），截图验证右上角返回/主页按钮对齐。 */
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
  const info = await win.webContents.executeJavaScript(`
    (() => {
      const d = document.getElementById('f').contentDocument;
      const err = document.getElementById('err');
      if (err) err.style.display = 'none';
      const wc = d.getElementById('winControls');
      if (wc) wc.style.display = 'flex'; // 截图时显示窗口按钮，验证对齐
      const b = d.getElementById('backBtn');
      const h = d.getElementById('homeBtn');
      d.body.dataset.view = 'playing'; // 直接切播放视图，CSS 负责显隐
      const cs = (el) => el ? d.defaultView.getComputedStyle(el) : null;
      return { view: d.body.dataset.view, back: cs(b) && cs(b).display, home: cs(h) && cs(h).display };
    })()
  `);
  console.log(JSON.stringify(info));
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'shot-back-btn.png'), image.toPNG());
  console.log('shot saved');
  app.quit();
});
