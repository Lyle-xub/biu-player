/* Biu Player · 桌面歌词窗 preload */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyricApi', {
  // 接收主窗同步过来的当前歌词行 { cur, next }
  onLine: (cb) => ipcRenderer.on('lyric:line', (_e, payload) => cb(payload)),
  // 关闭歌词窗（走主进程统一入口，主窗里的开关状态才能同步）
  close: () => ipcRenderer.send('lyric:toggle', false),
});
