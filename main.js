/* Biu Player · 主进程 */
const { app, BrowserWindow, ipcMain, net, session, protocol, dialog, nativeImage, safeStorage, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { createLanSync } = require('./lan-sync');
const { createVideoCloudSync } = require('./video-cloud-sync');
const { createVideoRuntime } = require('./cloud-video-runtime');
const { createBiliVideoApi } = require('./cloud-video-bili');

// 桌面 Chrome UA + B 站页面 Referer（CDN 无 Referer 会 403）
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';
// 需要统一补 Referer/UA 的 B 站 CDN 域名
const CDN_HOSTS = ['bilivideo.com', 'bilivideo.cn', 'hdslb.com', 'acgvideo.com'];

// 媒体通过应用内安全代理流式读取，浏览器侧无需直接跨域访问带签名的 CDN URL。
protocol.registerSchemesAsPrivileged([{
  scheme: 'biu-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let mainWin = null;
let cloudTray = null, keepCloudRunning = false, quitting = false;
let lyricWin = null; // 桌面歌词悬浮窗
let loginWin = null; // B 站官方验证码登录窗
let buvid3 = ''; // 匿名访客标识：搜索 / playurl 接口风控需要
// One local writer per userData directory, including repeated launches from Finder/CLI.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if(app.isReady())showMainWindow(); });
app.on('before-quit', () => { quitting = true; });

function showMainWindow() {
  if(!mainWin || mainWin.isDestroyed())createWindow();
  if(mainWin.isMinimized())mainWin.restore();
  mainWin.show();mainWin.focus();
}
function updateCloudBackground(status) {
  if(quitting)return;
  keepCloudRunning=!!(status.signedIn && status.enabled || status.busy);
  if(keepCloudRunning && !cloudTray) {
    const icon=nativeImage.createFromPath(path.join(__dirname,'renderer/assets/icon.png')).resize({width:18,height:18});
    cloudTray=new Tray(icon);
    cloudTray.setToolTip('Biu Player · 云同步后台运行');
    cloudTray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开 Biu Player',click:showMainWindow},
      {type:'separator'},
      {label:'完全退出',click:()=>app.quit()},
    ]));
    cloudTray.on('click',showMainWindow);
  } else if(!keepCloudRunning && cloudTray) {
    cloudTray.destroy();cloudTray=null;
    if(!mainWin && BrowserWindow.getAllWindows().length===0)app.quit();
  }
}

/* ---------- WBI 签名（参考 wood3n/biu：/x/player/wbi/playurl 等接口需要） ---------- */
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16,
  24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52];
let wbiKeys = null;
let wbiKeysAt = 0;

async function getWbiKeys() {
  if (wbiKeys && Date.now() - wbiKeysAt < 12 * 3600 * 1000) return wbiKeys;
  const res = await net.fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, Referer: REFERER },
  });
  const data = JSON.parse(await res.text());
  const wbi = data.data && data.data.wbi_img;
  if (!wbi) throw new Error('无法获取 WBI 密钥');
  const keyOf = (u) => u.split('/').pop().split('.')[0];
  wbiKeys = { img: keyOf(wbi.img_url), sub: keyOf(wbi.sub_url) };
  wbiKeysAt = Date.now();
  return wbiKeys;
}

// 对 URL 查询串做 WBI 签名，返回带 wts + w_rid 的新查询串
async function signWbi(query) {
  const keys = await getWbiKeys();
  const raw = keys.img + keys.sub;
  const mixin = MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32);
  const params = new URLSearchParams(query);
  params.set('wts', Math.floor(Date.now() / 1000));
  const entries = [...params.entries()]
    .map(([k, v]) => [k, String(v).replace(/[!'()*]/g, '')])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const q = new URLSearchParams(entries).toString();
  const wrid = crypto.createHash('md5').update(q + mixin).digest('hex');
  return q + '&w_rid=' + wrid;
}

// 通过 spi 接口获取并缓存 buvid3
async function ensureBuvid() {
  if (buvid3) return buvid3;
  try {
    const res = await net.fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA, Referer: REFERER },
    });
    const data = JSON.parse(await res.text());
    buvid3 = (data.data && data.data.b_3) || '';
  } catch (e) {
    console.error('获取 buvid3 失败:', e);
  }
  return buvid3;
}

/* ---------- Shazam：shazamio-core WASM 指纹签名 ---------- */
// 懒加载 shazamio-core（wasm-bindgen Node 构建，require 即同步就绪）
let shazamioMod = null;
function getShazamio() {
  if (!shazamioMod) shazamioMod = require(path.join(__dirname, 'node_modules/shazamio-core/node/shazamio-core.js'));
  return shazamioMod;
}
// pcmF32: ArrayBuffer（Float32 单声道 @16000Hz）→ Shazam 匹配结果或 null
async function shazamRecognize(pcmF32) {
  const sz = getShazamio();
  const f32 = new Float32Array(pcmF32);
  const sig = sz.DecodedSignature.new(f32, 16000, 1);
  try {
    const url = 'https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/'
      + crypto.randomUUID().toUpperCase() + '/' + crypto.randomUUID().toUpperCase()
      + '?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3';
    const res = await fetchWithFallback(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)',
      },
      body: JSON.stringify({
        timezone: 'Asia/Shanghai',
        signature: { uri: sig.uri, samplems: sig.samplems },
        timestamp: Date.now(),
        context: {},
        geolocation: {},
      }),
    });
    const json = JSON.parse(await res.text());
    const track = json && json.track;
    if (!track || !track.title) return null;
    // 专辑/年份在 sections[0].metadata 里；封面取 images.coverart
    let album = null;
    let year = null;
    const sections = track.sections || [];
    for (const sec of sections) {
      (sec.metadata || []).forEach((m) => {
        if (m.title === 'Album') album = m.text;
        if (m.title === 'Released') year = m.text;
      });
    }
    return {
      title: track.title,
      artist: track.subtitle || '',
      album,
      year,
      genre: (track.genres && track.genres.primary) || null,
      pic: (track.images && track.images.coverart) || null,
    };
  } finally { sig.free(); }
}

/* ---------- 登录态 / Cookie ---------- */
async function cookieHeader(extraCookie = '') {
  const values = new Map();
  const saved = await session.defaultSession.cookies.get({ url: 'https://www.bilibili.com/' });
  saved.forEach((cookie) => values.set(cookie.name, cookie.value));
  const bv = await ensureBuvid();
  if (bv && !values.has('buvid3')) values.set('buvid3', bv);
  String(extraCookie || '').split(';').forEach((part) => {
    const pos = part.indexOf('=');
    if (pos > 0) values.set(part.slice(0, pos).trim(), part.slice(pos + 1).trim());
  });
  return [...values].map(([key, value]) => `${key}=${value}`).join('; ');
}

// 带直连兜底的请求：Electron net.fetch 走 Chromium 网络栈，会应用系统代理，
// 代理规则/TLS 拦截对个别域名（如 interface.music.163.com）可能直接重置连接（net::ERR_FAILED）。
// 网络层失败时用 Node 内置 undici fetch 直连重试（默认不走系统代理；Cookie 等头部是显式传递的，行为一致）。
async function fetchWithFallback(url, opts) {
  try {
    return await net.fetch(url, opts);
  } catch (e) {
    console.warn('net.fetch 失败，直连重试:', url.split('?')[0], '—', String((e && e.message) || e));
    const directOpts = { ...opts };
    delete directOpts.credentials; // undici 无 Electron session，Cookie 已在 headers 里显式带上
    return fetch(url, directOpts);
  }
}

async function biliFetch(url, opts = {}) {
  let finalUrl = url;
  if (opts.wbi) {
    const qi = url.indexOf('?');
    const base = qi >= 0 ? url.slice(0, qi) : url;
    const query = qi >= 0 ? url.slice(qi + 1) : '';
    finalUrl = base + '?' + (await signWbi(query));
  }
  const cookie = await cookieHeader(opts.cookie);
  return (opts.noFallback ? net.fetch : fetchWithFallback)(finalUrl, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    method: opts.method || 'GET',
    credentials: 'include',
    headers: {
      'User-Agent': UA,
      Referer: opts.referer || REFERER,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
    ...(opts.body ? { body: opts.body } : {}),
  });
}

async function getAuthStatus() {
  try {
    const res = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
    const json = JSON.parse(await res.text());
    const data = json && json.data;
    if (json.code !== 0 || !data || !data.isLogin) return { isLogin: false };
    return {
      isLogin: true,
      mid: data.mid,
      uname: data.uname || '',
      face: data.face || '',
      vipType: data.vipType || 0,
    };
  } catch (e) {
    return { isLogin: false, error: String(e) };
  }
}

function notifyAuthChanged(auth) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth:changed', auth);
}

function openOfficialLogin() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 900,
    minHeight: 680,
    parent: mainWin || undefined,
    modal: !!mainWin,
    show: false,
    title: 'Bilibili 验证码登录',
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let checking = false;
  const check = async () => {
    if (checking || !loginWin) return;
    checking = true;
    const auth = await getAuthStatus();
    checking = false;
    if (auth.isLogin && loginWin) {
      notifyAuthChanged(auth);
      loginWin.close();
    }
  };
  const cookieChanged = (_event, cookie, _cause, removed) => {
    if (!removed && /(^|\.)bilibili\.com$/.test(cookie.domain || '')) check();
  };
  session.defaultSession.cookies.on('changed', cookieChanged);
  loginWin.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    if (loginWin) loginWin.setTitle('Bilibili 验证码登录');
  });
  loginWin.webContents.on('did-finish-load', check);
  loginWin.on('closed', () => {
    session.defaultSession.cookies.removeListener('changed', cookieChanged);
    loginWin = null;
  });
  loginWin.once('ready-to-show', () => loginWin && loginWin.show());
  loginWin.loadURL('https://passport.bilibili.com/login');
}

function createWindow() {
  mainWin = new BrowserWindow({
    // 启动即最小尺寸
    width: 1120,
    height: 720,
    minWidth: 1120,
    minHeight: 720,
    frame: false, // 使用应用内右上角窗口控制，彻底隐藏系统红绿灯
    roundedCorners: true,
    icon: path.join(__dirname, 'renderer/assets/icon.png'),
    backgroundColor: '#141610',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // 发布包默认使用当前 React 界面；源码未构建时回退旧界面，BIU_WEB_UI=0 可显式选择旧版。
  const useWebUi = process.env.BIU_WEB_UI !== '0'
    && fs.existsSync(path.join(__dirname, 'web-dist/index.html'));
  mainWin.loadFile(path.join(__dirname, useWebUi ? 'web-dist/index.html' : 'renderer/index.html'));
  mainWin.on('closed', () => {
    mainWin=null;
    lyricWin?.close();loginWin?.close();
  });
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  // 渲染层右上角三个圆形按钮 → 窗口控制
  ipcMain.on('win:min', () => mainWin.minimize());
  ipcMain.on('win:max', () => {
    if (mainWin.isMaximized()) mainWin.unmaximize();
    else mainWin.maximize();
  });
  ipcMain.on('win:close', () => mainWin.close());
  // 开发态 Dock 图标（打包后由 app bundle 提供）
  if (process.platform === 'darwin' && !app.isPackaged) {
    // Dock 按整张画布缩放；为满幅图标补上约 10% 的透明边距，与系统图标视觉大小一致。
    // 只处理开发态 Dock，不改变应用内和启动动画所用的原图。
    const canvasSize = 1024;
    const artworkSize = 820;
    const inset = (canvasSize - artworkSize) / 2;
    const artwork = nativeImage.createFromPath(path.join(__dirname, 'renderer/assets/icon.png'))
      .resize({ width: artworkSize, height: artworkSize, quality: 'best' });
    const pixels = artwork.toBitmap({ scaleFactor: 1 });
    const canvas = Buffer.alloc(canvasSize * canvasSize * 4);
    for (let row = 0; row < artworkSize; row++) {
      pixels.copy(canvas, ((row + inset) * canvasSize + inset) * 4,
        row * artworkSize * 4, (row + 1) * artworkSize * 4);
    }
    app.dock.setIcon(nativeImage.createFromBitmap(canvas, {
      width: canvasSize, height: canvasSize, scaleFactor: 1,
    }));
  }
  protocol.handle('biu-media', async (request) => {
    const parsed = new URL(request.url);
    const target = parsed.searchParams.get('url') || '';
    if (!/^https:\/\//i.test(target)) return new Response('Invalid media URL', { status: 400 });
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
      } });
    }
    let connectTimer;
    try {
      const cookie = await cookieHeader();
      const range = request.headers.get('range');
      const controller = new AbortController();
      connectTimer = setTimeout(() => controller.abort(), 8000);
      const remote = await net.fetch(target, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'User-Agent': UA,
          Referer: REFERER,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(range ? { Range: range } : {}),
        },
      });
      const headers = new Headers(remote.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
      // 渲染层放弃加载（切歌/重置媒体元素）时必须取消上游下载，
      // 否则被遗弃的大视频流会一直占着 CDN 连接配额，后续请求全部挂起超时。
      let bodyReader = null;
      const body = remote.body ? new ReadableStream({
        async start(out) {
          bodyReader = remote.body.getReader();
          try {
            for (;;) {
              const { done, value } = await bodyReader.read();
              if (done) { out.close(); break; }
              out.enqueue(value);
            }
          } catch (streamError) { try { out.error(streamError); } catch (e) {} }
        },
        cancel() {
          controller.abort();
          // body 被上面的 getReader() 锁定，直接 body.cancel() 会得到一个
          // 拒绝的 Promise（未处理即闪退）；取消 reader 才是合法路径
          try {
            if (bodyReader) bodyReader.cancel().catch(() => {});
            else remote.body.cancel().catch(() => {});
          } catch (e) {}
        },
      }) : null;
      return new Response(body, { status: remote.status, statusText: remote.statusText, headers });
    } catch (error) {
      console.error('媒体代理失败:', error);
      return new Response('Media proxy failed', { status: 502 });
    } finally {
      clearTimeout(connectTimer);
    }
  });

  // 关键：给发往 B 站 CDN 的请求统一加 Referer / UA，否则音/图 403
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const host = new URL(details.url).hostname;
    const hit = CDN_HOSTS.some((d) => host === d || host.endsWith('.' + d));
    if (hit) {
      details.requestHeaders['Referer'] = REFERER;
      details.requestHeaders['User-Agent'] = UA;
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // Web Audio 分析器需要可读的跨域媒体响应；仅为 B 站 CDN 补 CORS 响应头。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const host = new URL(details.url).hostname;
    const hit = CDN_HOSTS.some((d) => host === d || host.endsWith('.' + d));
    if (!hit) { callback({ responseHeaders: details.responseHeaders }); return; }
    const headers = { ...(details.responseHeaders || {}) };
    Object.keys(headers).forEach((key) => {
      if (key.toLowerCase() === 'access-control-allow-origin') delete headers[key];
    });
    headers['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders: headers });
  });

  // 通用 GET：带 UA + Referer + Electron 持久化 Cookie，返回文本由渲染层自行解析
  // opts.wbi = true 时对查询串做 WBI 签名（playurl / 字幕等接口风控需要）
  ipcMain.handle('bili:get', async (_e, url, opts = {}) => {
    try {
      const res = await biliFetch(url, opts);
      return { status: res.status, body: opts.responseType === 'bytes'
        ? Array.from(new Uint8Array(await res.arrayBuffer())) : await res.text() };
    } catch (e) {
      return { status: -1, body: String(e) };
    }
  });

  // Shazam 识曲：渲染层传入 16kHz 单声道 Float32 PCM，主进程出签名并请求匹配
  ipcMain.handle('shazam:recognize', async (_e, payload) => {
    try {
      return await shazamRecognize(payload.pcm);
    } catch (e) {
      console.error('Shazam 识曲失败:', e);
      return null;
    }
  });

  /* ---------- 本地数据仓：likes / 自建歌单 / 历史 ----------
     之前存在 Chromium localStorage，渲染进程被强杀导致 leveldb 损坏时
     Chromium 会整库删除重建，数据全丢。改为 userData 下独立 JSON：
     写临时文件再原子替换 + .bak 冗余，崩溃也不会留半个文件。 */
  let biuStoreCache = null;
  const biuStoreFile = () => path.join(app.getPath('userData'), 'biu-store.json');
  const readBiuStore = () => {
    if (biuStoreCache) return biuStoreCache;
    try { biuStoreCache = JSON.parse(fs.readFileSync(biuStoreFile(), 'utf8')); } catch (e) {
      // 主文件损坏时回退 .bak
      try { biuStoreCache = JSON.parse(fs.readFileSync(biuStoreFile() + '.bak', 'utf8')); } catch (e2) { biuStoreCache = {}; }
    }
    if (!biuStoreCache || typeof biuStoreCache !== 'object') biuStoreCache = {};
    return biuStoreCache;
  };
  let biuStoreTimer = null;
  const flushBiuStore = () => {
    clearTimeout(biuStoreTimer);
    biuStoreTimer = null;
    if (!biuStoreCache) return true;
    try {
      const f = biuStoreFile();
      const body = JSON.stringify(biuStoreCache);
      fs.writeFileSync(f + '.tmp', body);
      fs.renameSync(f + '.tmp', f);
      fs.writeFileSync(f + '.bak', body);
      return true;
    } catch (e) { return false; }
  };
  const scheduleBiuStoreWrite = () => {
    clearTimeout(biuStoreTimer);
    biuStoreTimer = setTimeout(flushBiuStore, 300);
  };
  app.on('will-quit', flushBiuStore);
  ipcMain.on('playback:save', (event, snapshot) => {
    readBiuStore()['biu-playback-session'] = snapshot;
    event.returnValue = flushBiuStore();
  });
  ipcMain.handle('store:get', (_e, key) => {
    const v = readBiuStore()[String(key)];
    return v === undefined ? null : v;
  });
  ipcMain.on('store:set', (_e, key, val) => {
    readBiuStore()[String(key)] = val;
    scheduleBiuStoreWrite();
  });

  const savedSync = readBiuStore();
  if (!savedSync['biu-lan-device']) savedSync['biu-lan-device'] = require('node:crypto').randomUUID();
  let lanScope = '';
  let lanEnabled = savedSync['biu-lan-auto'] !== false;
  scheduleBiuStoreWrite();
  const readSyncLibrary = (scope) => {
      const suffix = scope ? `@${scope}` : '';
      const saved = readBiuStore();
      return { version: 1, likes: saved[`biu-likes${suffix}`] || [], playlists: saved[`biu-playlists${suffix}`] || [],
        recommendation: require('./renderer/recommendation-profile').normalize(saved[`biu-recommendation-profiles${suffix}`]) };
    };
  const writeSyncLibrary = (scope, library, base) => {
      const suffix = scope ? `@${scope}` : '';
      const before = readBiuStore();
      biuStoreCache = { ...before, [`biu-likes${suffix}`]: library.likes, [`biu-playlists${suffix}`]: library.playlists };
      if (library.recommendation) biuStoreCache[`biu-recommendation-profiles${suffix}`] = library.recommendation;
      if (!flushBiuStore()) { biuStoreCache = before; throw new Error('电脑保存失败，请检查磁盘空间后重试'); }
      if(mainWin && !mainWin.isDestroyed())mainWin.webContents.send('lan-sync:library', { scope, library, base });
    };
  const lanSync = createLanSync({
    deviceId: savedSync['biu-lan-device'],
    readLibrary: readSyncLibrary,
    writeLibrary: writeSyncLibrary,
    cloudKeyStatus: scope => videoCloud.lanKeyStatus(scope),
    exchangeCloudKey: (value, scope, isActive) => videoCloud.exchangeLanRecovery(value, scope, isActive),
    onStatus: (status) => {
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('lan-sync:status', status);
    },
  });
  const cloudSource = app.isPackaged ? path.join(process.resourcesPath, 'cloud-video') : path.join(__dirname, 'cloud-video');
  const cloudRuntime = createVideoRuntime({ source: cloudSource, directory: path.join(app.getPath('userData'), 'video-cloud-runtime') });
  const cloudApi = createBiliVideoApi({
    request: (url, options) => biliFetch(url, { ...options, noFallback: options?.method && options.method !== 'GET' }),
    uploadFetch: (url, options) => net.fetch(url, { ...options, headers: { ...options.headers, 'User-Agent': UA, Referer: REFERER } }),
    csrf: async () => (await session.defaultSession.cookies.get({ url: REFERER })).find(c => c.name === 'bili_jct')?.value || '',
    coverFile: path.join(cloudSource, 'cover.png'),
  });
  const videoCloud = createVideoCloudSync({
    directory: path.join(app.getPath('userData'), 'video-cloud'), api: cloudApi, runtime: cloudRuntime,
    auth: getAuthStatus, readLibrary: readSyncLibrary, writeLibrary: writeSyncLibrary,
    protect: text => { if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用'); return safeStorage.encryptString(text).toString('base64'); },
    unprotect: text => safeStorage.decryptString(Buffer.from(text, 'base64')),
    onStatus: status => { updateCloudBackground(status);if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('video-cloud:status', status); },
  });
  ipcMain.handle('video-cloud:status', () => videoCloud.status());
  ipcMain.handle('video-cloud:preview', () => videoCloud.loadPreview());
  ipcMain.handle('video-cloud:configure', (_event, patch) => videoCloud.configure({ enabled: patch?.enabled, ...(patch?.intervalHours === undefined ? {} : { intervalHours: patch.intervalHours }) }));
  ipcMain.handle('video-cloud:run', (_event, readOnly = false) => videoCloud.run(readOnly === true, readOnly !== true).then(() => videoCloud.status()));
  ipcMain.handle('video-cloud:export', async () => {
    const recovery = videoCloud.exportRecovery();
    const result = await dialog.showSaveDialog(mainWin, { title: '保存视频云同步恢复密钥', defaultPath: 'Biu-云同步恢复密钥.json', filters: [{name:'恢复密钥',extensions:['json']}] });
    if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, JSON.stringify(recovery), {mode:0o600});
    return { canceled: result.canceled };
  });
  ipcMain.handle('video-cloud:import', async () => {
    const result = await dialog.showOpenDialog(mainWin, { title: '导入其他设备的云同步恢复密钥', properties:['openFile'], filters:[{name:'恢复密钥',extensions:['json']}] });
    if (result.canceled) return videoCloud.status();
    const file=result.filePaths[0];
    if (fs.statSync(file).size > 8192) throw new Error('恢复密钥文件过大');
    return videoCloud.importRecovery(JSON.parse(fs.readFileSync(file,'utf8')));
  });
  app.on('before-quit', () => videoCloud.stop());
  ipcMain.handle('lan-sync:configure', (_e, scope, enabled) => {
    if (!/^\d{0,20}$/.test(String(scope))) throw new Error('同步账号无效');
    lanScope = String(scope);
    videoCloud.setAccount(lanScope).catch(() => {});
    if (typeof enabled === 'boolean') {
      const before = readBiuStore()['biu-lan-auto'];
      readBiuStore()['biu-lan-auto'] = enabled;
      if (!flushBiuStore()) { readBiuStore()['biu-lan-auto'] = before; throw new Error('同步设置保存失败，请检查磁盘空间'); }
      lanEnabled = enabled;
    }
    return lanSync.configure(lanScope, lanEnabled);
  });
  ipcMain.handle('lan-sync:status', () => lanSync.status());
  ipcMain.handle('lan-sync:stop', () => { lanScope = ''; lanSync.stop(); videoCloud.setAccount('').catch(() => {}); });
  // Re-advertise after an interface change or a transient discovery failure.
  const lanRetry = setInterval(() => lanSync.configure(lanScope, lanEnabled).catch(() => {}), 15000);
  lanRetry.unref();
  app.on('before-quit', () => { clearInterval(lanRetry); lanSync.stop(); });
  lanSync.configure('', lanEnabled);

  // 网易云听歌识曲：vendored afp WASM 指纹 → interface.music.163.com 匹配
  // payload: { pcm: ArrayBuffer（Float32 单声道 @48000Hz）, from, len }（from/len 单位：秒）
  ipcMain.handle('ncm:recognize', async (_e, payload) => {
    try {
      // 渲染层已从原始 44.1/48k 音频截取 clip 并重采样为真实 48kHz Float32，
      // 构造 AudioBuffer 形态（sampleRate + getChannelData）喂给 Encode
      const audio48k = { sampleRate: 48000, getChannelData: () => new Float32Array(payload.pcm) };
      const encoded = await require(path.join(__dirname, 'vendor/ncm/sandbox.bundle.cjs'))
        .Encode(audio48k, payload.from, payload.len, 0);
      // 直接 fetchWithFallback（不走 biliFetch，避免带 B 站 cookie；代理重置时自动直连重试）
      const res = await fetchWithFallback('https://interface.music.163.com/api/music/audio/match', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'origin': 'chrome-extension://pgphbbekcgpfaekhcbjamjjkegcclhhd',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36',
        },
        body: new URLSearchParams({
          sessionId: '441df692-afea-4a54-8aff-f5f20fd34f12',
          algorithmCode: 'shazam_v2',
          duration: String(payload.len),
          rawdata: encoded,
          times: '2',
          decrypt: '1',
        }).toString(),
      });
      const json = JSON.parse(await res.text());
      const result = (json && json.data && json.data.result) || [];
      // 每项真实歌曲信息包在 .song 里（外层带 startTime 等匹配信息）
      return result.map((item) => {
        const song = item.song || item;
        return {
          id: song.id,
          title: song.name,
          artist: (song.artists || []).map((a) => a.name).join('/'),
          album: song.album && song.album.name,
        };
      }).filter((s) => s.id && s.title);
    } catch (e) {
      console.error('网易云识曲失败:', e);
      return null;
    }
  });

  // 通用 POST：form 编码，自动从 session Cookie 补 bili_jct 作为 csrf（收藏等写接口需要）
  ipcMain.handle('bili:post', async (_e, url, body = {}) => {
    try {
      const cookies = await session.defaultSession.cookies.get({ url: 'https://www.bilibili.com/' });
      const csrf = ((cookies.find((c) => c.name === 'bili_jct') || {}).value) || '';
      const params = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.set(key, String(value));
      });
      if (csrf && !params.has('csrf')) params.set('csrf', csrf);
      const res = await biliFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      return { status: res.status, body: await res.text() };
    } catch (e) {
      return { status: -1, body: String(e) };
    }
  });

  // 扫码登录：主进程请求与轮询，Cookie 只保存在 Electron session 中。
  ipcMain.handle('auth:status', () => getAuthStatus());
  ipcMain.handle('auth:qr-start', async () => {
    try {
      const res = await biliFetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
        referer: 'https://passport.bilibili.com/login',
      });
      const json = JSON.parse(await res.text());
      if (json.code !== 0 || !json.data) throw new Error(json.message || '无法生成二维码');
      return {
        ok: true,
        key: json.data.qrcode_key,
        image: await QRCode.toDataURL(json.data.url, {
          width: 320, margin: 1,
          color: { dark: '#171810', light: '#ffffff' },
        }),
      };
    } catch (e) {
      return { ok: false, message: String(e.message || e) };
    }
  });
  ipcMain.handle('auth:qr-poll', async (_e, key) => {
    try {
      const url = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(key);
      const res = await biliFetch(url, { referer: 'https://passport.bilibili.com/login' });
      const json = JSON.parse(await res.text());
      if (json.code !== 0 || !json.data) throw new Error(json.message || '二维码轮询失败');
      const result = { ok: true, code: json.data.code, message: json.data.message || '' };
      if (json.data.code === 0) {
        result.auth = await getAuthStatus();
        notifyAuthChanged(result.auth);
      }
      return result;
    } catch (e) {
      return { ok: false, message: String(e.message || e) };
    }
  });
  ipcMain.on('auth:open-login', () => openOfficialLogin());

  /* ---- 短信验证码登录（参考 wood3n/biu，全流程内置，不跳外部页面）----
     流程：captcha 取极验参数 → 渲染层加载 gt.js 完成滑块 → sms/send 发短信 → login/sms 登录。
     全程走 biliFetch（credentials: include），Set-Cookie 直接落 Electron session。 */
  const passportPost = async (url, params) => {
    const res = await biliFetch(url, {
      method: 'POST',
      referer: 'https://passport.bilibili.com/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    return JSON.parse(await res.text());
  };
  // 取极验验证码参数（gt/challenge/token）
  ipcMain.handle('auth:sms-captcha', async () => {
    try {
      const res = await biliFetch('https://passport.bilibili.com/x/passport-login/captcha?source=main_web',
        { referer: 'https://passport.bilibili.com/login' });
      const json = JSON.parse(await res.text());
      if (json.code !== 0 || !json.data || !json.data.geetest) throw new Error(json.message || '获取验证参数失败');
      return { ok: true, token: json.data.token, gt: json.data.geetest.gt, challenge: json.data.geetest.challenge };
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  });
  // 极验通过后发送短信验证码
  ipcMain.handle('auth:sms-send', async (_e, p) => {
    try {
      const json = await passportPost('https://passport.bilibili.com/x/passport-login/web/sms/send', {
        cid: p.cid || 86, tel: p.tel, source: 'main_web',
        token: p.token, challenge: p.challenge, validate: p.validate, seccode: p.seccode,
      });
      return { ok: json.code === 0, message: json.message || '', captchaKey: json.data && json.data.captcha_key };
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  });
  // 提交短信验证码完成登录
  ipcMain.handle('auth:sms-login', async (_e, p) => {
    try {
      const json = await passportPost('https://passport.bilibili.com/x/passport-login/web/login/sms', {
        cid: p.cid || 86, tel: p.tel, code: p.code, source: 'main_web',
        captcha_key: p.captchaKey, keep: true,
      });
      if (json.code !== 0) return { ok: false, message: json.message || '登录失败' };
      const auth = await getAuthStatus();
      notifyAuthChanged(auth);
      return { ok: true, auth };
    } catch (e) { return { ok: false, message: String(e.message || e) }; }
  });
  ipcMain.handle('auth:logout', async () => {
    const authNames = new Set(['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']);
    const cookies = await session.defaultSession.cookies.get({ url: 'https://www.bilibili.com/' });
    await Promise.all(cookies.filter((cookie) => authNames.has(cookie.name)).map((cookie) =>
      session.defaultSession.cookies.remove('https://' + cookie.domain.replace(/^\./, '') + cookie.path, cookie.name)
    ));
    const auth = { isLogin: false };
    notifyAuthChanged(auth);
    return auth;
  });

  // 图片转 dataURL：渲染层 canvas 取色用，避免跨域污染
  ipcMain.handle('bili:image', async (_e, url) => {
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': UA, Referer: REFERER } });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get('content-type') || 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
      return null;
    }
  });

  // 下载整文件视频：保存对话框 → 流式写盘，进度经 download:progress 事件回报
  ipcMain.handle('download:start', async (_e, { url, filename }) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWin, {
        defaultPath: filename || 'biu-download.mp4',
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      const res = await net.fetch(url, { headers: { 'User-Agent': UA, Referer: REFERER } });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const total = +res.headers.get('content-length') || 0;
      const file = fs.createWriteStream(filePath);
      const reader = res.body.getReader();
      let got = 0;
      let lastNotify = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!file.write(value)) await new Promise((r) => file.once('drain', r));
        got += value.length;
        if (mainWin && !mainWin.isDestroyed() && got - lastNotify >= 4 * 1024 * 1024) {
          lastNotify = got;
          mainWin.webContents.send('download:progress', { got, total });
        }
      }
      await new Promise((resolve, reject) => file.end((e) => (e ? reject(e) : resolve())));
      return { ok: true, path: filePath };
    } catch (e) {
      console.error('下载失败:', e);
      return { ok: false, message: String(e.message || e) };
    }
  });

  // ---------- 桌面歌词悬浮窗 ----------
  ipcMain.on('lyric:toggle', (_e, on) => {
    if (on && !lyricWin) {
      lyricWin = new BrowserWindow({
        width: 880, height: 112,
        frame: false, transparent: true, hasShadow: false,
        alwaysOnTop: true, skipTaskbar: true, resizable: true,
        minimizable: false, maximizable: false, fullscreenable: false,
        webPreferences: { preload: path.join(__dirname, 'lyric-preload.js') },
      });
      lyricWin.setAlwaysOnTop(true, 'screen-saver');
      lyricWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      lyricWin.loadFile(path.join(__dirname, 'lyric.html'));
      lyricWin.on('closed', () => {
        lyricWin = null;
        if (mainWin) mainWin.webContents.send('lyric:closed');
      });
    } else if (!on && lyricWin) {
      lyricWin.close();
      lyricWin = null;
    }
  });
  // 主窗 → 歌词窗：同步当前歌词行
  ipcMain.on('lyric:line', (_e, payload) => {
    if (lyricWin) lyricWin.webContents.send('lyric:line', payload);
  });

  createWindow();

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (lyricWin) { lyricWin.close(); lyricWin = null; }
  if(!keepCloudRunning)app.quit();
});
