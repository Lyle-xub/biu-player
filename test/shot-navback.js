#!/usr/bin/env node
/* 离屏渲染 app-preview，截图验证：顶栏返回钮 + 缩小搜索框（library 视图）、歌单详情标题钮（playlist 视图）。 */
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

  // 1) 默认视图：顶栏（返回钮 + 缩小搜索框）
  await win.webContents.executeJavaScript(`
    (() => { const e = document.getElementById('err'); if (e) e.style.display = 'none';
      const d = document.getElementById('f').contentDocument;
      d.body.dataset.view = 'library';
      return !!d.getElementById('navBack'); })()
  `).then((ok) => console.log('navBack present:', ok));
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(path.join(__dirname, 'shot-navback-top.png'),
    (await win.webContents.capturePage()).toPNG());

  // 2) 歌单详情：标题右侧下拉钮
  await win.webContents.executeJavaScript(`
    (() => { const d = document.getElementById('f').contentDocument;
      d.body.dataset.view = 'playlist';
      const t = d.getElementById('plTitle'); if (t) t.textContent = '周杰伦精选 · 分切';
      return !!d.getElementById('plBackBtn'); })()
  `).then((ok) => console.log('plBackBtn present:', ok));
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(path.join(__dirname, 'shot-navback-pl.png'),
    (await win.webContents.capturePage()).toPNG());

  console.log('shots saved');
  app.quit();
});
