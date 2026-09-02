/* Biu Player · preload：向渲染层暴露受控桥 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bili', {
  // GET 请求 B 站接口：返回 { status, body }，body 为文本
  get: (url, opts) => ipcRenderer.invoke('bili:get', url, opts),
  // POST 请求 B 站接口：form 编码对象，主进程自动补 csrf
  post: (url, body) => ipcRenderer.invoke('bili:post', url, body),
  // 图片 → dataURL（封面取色用）
  image: (url) => ipcRenderer.invoke('bili:image', url),
  // Shazam 识曲：{ pcm: ArrayBuffer(Float32 mono @16000Hz) } → { title, artist, album, year, genre, pic } | null
  shazamRecognize: (payload) => ipcRenderer.invoke('shazam:recognize', payload),
  // 网易云识曲：{ pcm: ArrayBuffer(Float32 mono @48000Hz), from, len } → 匹配数组
  ncmRecognize: (payload) => ipcRenderer.invoke('ncm:recognize', payload),
  // 下载整文件视频：{ url, filename } → { ok, path? , canceled? , message? }；进度经 onDownloadProgress
  downloadStart: (payload) => ipcRenderer.invoke('download:start', payload),
  onDownloadProgress: (cb) => ipcRenderer.on('download:progress', (_event, p) => cb(p)),
  // B 站登录（Cookie 仅保存在 Electron session）
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authQrStart: () => ipcRenderer.invoke('auth:qr-start'),
  authQrPoll: (key) => ipcRenderer.invoke('auth:qr-poll', key),
  authOpenLogin: () => ipcRenderer.send('auth:open-login'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  onAuthChanged: (cb) => ipcRenderer.on('auth:changed', (_event, auth) => cb(auth)),
  // 本地数据仓（likes / 自建歌单 / 历史）：主进程 JSON 文件，带原子写入与 .bak
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, val) => ipcRenderer.send('store:set', key, val),
  // 仅退出前使用同步确认，确保最后一个播放快照已落盘再销毁渲染进程。
  playbackSave: (snapshot) => ipcRenderer.sendSync('playback:save', snapshot),
  // 窗口控制
  winMin: () => ipcRenderer.send('win:min'),
  winMax: () => ipcRenderer.send('win:max'),
  winClose: () => ipcRenderer.send('win:close'),
  // 桌面歌词
  lyricToggle: (on) => ipcRenderer.send('lyric:toggle', on),
  lyricLine: (payload) => ipcRenderer.send('lyric:line', payload),
  onLyricClosed: (cb) => ipcRenderer.on('lyric:closed', () => cb()),
});
