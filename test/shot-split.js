#!/usr/bin/env node
/* 用 Electron 离屏渲染 split-panel-harness 并截图，验证分切面板 UI。 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 760, show: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'split-panel-harness.html'));
  await new Promise((r) => setTimeout(r, 800));
  const image = await win.webContents.capturePage();
  require('fs').writeFileSync(path.join(__dirname, 'shot-split-panel.png'), image.toPNG());
  console.log('shot saved');
  app.quit();
});
