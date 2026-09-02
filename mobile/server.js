/* Biu Player · 移动版服务器
 * 用手机浏览器访问桌面端的同一套渲染层：本服务器替代 Electron 主进程，
 * 提供 window.bili 桥所需的全部后端能力——
 *   静态托管 renderer/（自动注入 bridge.js + mobile.css + viewport meta）
 *   /api/req     B 站接口代理（UA/Referer/Cookie 罐/WBI 签名/csrf）
 *   /media       音视频流代理（Range 透传、CORS、断流即取消上游）
 *   /api/image   封面图 → dataURL（取色用，防 canvas 跨域污染）
 *   /store/*     本地数据仓（likes/歌单/历史/设置，原子写 + .bak）
 *   /auth/*      扫码登录（二维码生成/轮询/登出，Cookie 落服务端罐）
 *   /api/ncm-recognize / /api/shazam-recognize  MixSplitR 识曲（复用桌面版 vendored WASM）
 * 零新增依赖：qrcode / shazamio-core / vendor/ncm 均复用项目现有 node_modules 与 vendor。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const PORT = process.env.BIU_PORT ? +process.env.BIU_PORT : 7777;
const HOST = process.env.BIU_HOST || '0.0.0.0'; // 局域网可访问

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';

/* ---------- Cookie 罐：按 name 存，bilibili 系域名共享；写临时文件再原子替换 ---------- */
const jarFile = path.join(DATA_DIR, 'cookies.json');
let jar = {};
try { jar = JSON.parse(fs.readFileSync(jarFile, 'utf8')) || {}; } catch (e) { jar = {}; }
let jarTimer = null;
const saveJar = () => {
  clearTimeout(jarTimer);
  jarTimer = setTimeout(() => {
    try {
      fs.writeFileSync(jarFile + '.tmp', JSON.stringify(jar));
      fs.renameSync(jarFile + '.tmp', jarFile);
    } catch (e) { /* 下次再试 */ }
  }, 300);
};
const COOKIE_HOSTS = /(^|\.)bilibili\.com$|(^|\.)bilivideo\.(com|cn)$|(^|\.)hdslb\.com$/;
const cookieHeaderFor = (host) => {
  if (!COOKIE_HOSTS.test(host)) return '';
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
};
function captureCookies(res, host) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  let changed = false;
  for (const sc of list) {
    const pair = sc.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const dm = sc.match(/domain=\.?([^;\s]+)/i);
    const domain = dm ? dm[1] : host;
    if (!/bilibili\.com$/.test(domain) && domain !== host) continue;
    if (value === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) { delete jar[name]; }
    else jar[name] = value;
    changed = true;
  }
  if (changed) saveJar();
}

/* ---------- WBI 签名（与 main.js 同源） ---------- */
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16,
  24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52];
let wbiKeys = null, wbiKeysAt = 0;
async function getWbiKeys() {
  if (wbiKeys && Date.now() - wbiKeysAt < 12 * 3600 * 1000) return wbiKeys;
  const res = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
  const data = JSON.parse(await res.text());
  const wbi = data.data && data.data.wbi_img;
  if (!wbi) throw new Error('无法获取 WBI 密钥');
  const keyOf = (u) => u.split('/').pop().split('.')[0];
  wbiKeys = { img: keyOf(wbi.img_url), sub: keyOf(wbi.sub_url) };
  wbiKeysAt = Date.now();
  return wbiKeys;
}
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
  return q + '&w_rid=' + crypto.createHash('md5').update(q + mixin).digest('hex');
}

/* ---------- buvid3 匿名访客标识（搜索/playurl 风控） ---------- */
async function ensureBuvid() {
  if (jar.buvid3) return;
  try {
    const res = await biliFetch('https://api.bilibili.com/x/frontend/finger/spi');
    const data = JSON.parse(await res.text());
    if (data.data && data.data.b_3) { jar.buvid3 = data.data.b_3; saveJar(); }
  } catch (e) { console.error('获取 buvid3 失败:', e.message); }
}

/* ---------- 统一请求：UA/Referer/Cookie，opts.wbi 时签名 ---------- */
async function biliFetch(url, opts = {}) {
  const u = new URL(url);
  if (opts.wbi) {
    const signed = await signWbi(u.search.replace(/^\?/, ''));
    url = u.origin + u.pathname + '?' + signed;
  }
  const cookie = cookieHeaderFor(u.hostname);
  const headers = {
    'User-Agent': UA,
    'Referer': opts.referer || REFERER,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body, redirect: 'follow' });
  captureCookies(res, u.hostname);
  return res;
}

async function getAuthStatus() {
  try {
    const res = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
    const json = JSON.parse(await res.text());
    const data = json && json.data;
    if (json.code !== 0 || !data || !data.isLogin) return { isLogin: false };
    return { isLogin: true, mid: data.mid, uname: data.uname || '', face: data.face || '', vipType: data.vipType || 0 };
  } catch (e) { return { isLogin: false, error: String(e) }; }
}

/* ---------- 本地数据仓（与 main.js biu-store 同构：原子写 + .bak） ---------- */
const storeFile = path.join(DATA_DIR, 'store.json');
let storeCache = null;
const readStore = () => {
  if (storeCache) return storeCache;
  try { storeCache = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch (e) {
    try { storeCache = JSON.parse(fs.readFileSync(storeFile + '.bak', 'utf8')); } catch (e2) { storeCache = {}; }
  }
  if (!storeCache || typeof storeCache !== 'object') storeCache = {};
  return storeCache;
};
let storeTimer = null;
const scheduleStoreWrite = () => {
  clearTimeout(storeTimer);
  storeTimer = setTimeout(() => {
    try {
      const body = JSON.stringify(storeCache);
      fs.writeFileSync(storeFile + '.tmp', body);
      fs.renameSync(storeFile + '.tmp', storeFile);
      fs.writeFileSync(storeFile + '.bak', body);
    } catch (e) { /* 忽略 */ }
  }, 300);
};

/* ---------- MixSplitR 识曲（复用桌面版 vendored 模块，缺模块时 501 优雅降级） ---------- */
function tryRequire(p) { try { return require(p); } catch (e) { return null; } }
const ncmSandbox = () => tryRequire(path.join(ROOT, 'vendor/ncm/sandbox.bundle.cjs'));
const shazamio = () => tryRequire(path.join(ROOT, 'node_modules/shazamio-core/node/shazamio-core.js'));

async function ncmRecognize(pcmBuf, from, len) {
  const sandbox = ncmSandbox();
  if (!sandbox) return null;
  const audio48k = { sampleRate: 48000, getChannelData: () => new Float32Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 4) };
  const encoded = await sandbox.Encode(audio48k, from, len, 0);
  const res = await fetch('https://interface.music.163.com/api/music/audio/match', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'origin': 'chrome-extension://pgphbbekcgpfaekhcbjamjjkegcclhhd',
      'User-Agent': UA,
    },
    body: new URLSearchParams({
      sessionId: '441df692-afea-4a54-8aff-f5f20fd34f12',
      algorithmCode: 'shazam_v2',
      duration: String(len),
      rawdata: encoded,
      times: '2',
      decrypt: '1',
    }).toString(),
  });
  const json = JSON.parse(await res.text());
  const result = (json && json.data && json.data.result) || [];
  return result.map((item) => {
    const song = item.song || item;
    return {
      id: song.id,
      title: song.name,
      artist: (song.artists || []).map((a) => a.name).join('/'),
      album: song.album && song.album.name,
    };
  }).filter((s) => s.id && s.title);
}

async function shazamRecognize(pcmBuf) {
  const sz = shazamio();
  if (!sz) return null;
  const f32 = new Float32Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 4);
  const sig = sz.DecodedSignature.new(f32, 16000, 1);
  try {
    const url = 'https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/'
      + crypto.randomUUID().toUpperCase() + '/' + crypto.randomUUID().toUpperCase()
      + '?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3';
    const res = await fetch(url, {
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
    if (!track) return null;
    const meta = {};
    ((track.sections && track.sections[0] && track.sections[0].metadata) || [])
      .forEach((m) => { meta[m.title] = m.text; });
    return {
      title: track.title, artist: track.subtitle,
      album: meta['Album'] || null, year: meta['Released'] || null, genre: track.genres && track.genres.primary,
      pic: (track.images && track.images.coverart) || null,
    };
  } finally { if (sig.free) sig.free(); }
}

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ico': 'image/x-icon',
};
function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

// index.html 注入：viewport meta + bridge.js（须在 api.js 之前）+ mobile.css
// React 构建版（web-dist/ 存在时优先）：bridge.js 插到 module 脚本前（module 延迟执行，bridge 先跑），
// viewport 与 mobile.css 已分别内建于 web/index.html 与打包 CSS，无需再注入。
let indexCache = null;
const WEBDIST = path.join(ROOT, 'web-dist');
const STATIC_ROOT = fs.existsSync(path.join(WEBDIST, 'index.html')) ? WEBDIST : RENDERER;
function mobileIndex() {
  if (indexCache) return indexCache;
  let html = fs.readFileSync(path.join(STATIC_ROOT, 'index.html'), 'utf8');
  if (STATIC_ROOT === WEBDIST) {
    html = html.replace('<script type="module"',
      '<script src="/__mobile/bridge.js"></script>\n<script type="module"');
  } else {
    html = html.replace('<meta charset="UTF-8">',
      '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
    html = html.replace('<link rel="stylesheet" href="styles.css">',
      '<link rel="stylesheet" href="styles.css">\n<link rel="stylesheet" href="/__mobile/mobile.css">');
    html = html.replace('<script src="api.js"></script>',
      '<script src="/__mobile/bridge.js"></script>\n<script src="api.js"></script>');
  }
  indexCache = html;
  return html;
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => {
    chunks.push(c);
    if (Buffer.concat(chunks).length > 64 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const sendJson = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(mobileIndex());
      return;
    }
    if (p.startsWith('/__mobile/')) {
      const f = path.normalize(path.join(__dirname, p.slice('/__mobile/'.length)));
      if (!f.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
      serveFile(res, f);
      return;
    }

    // B 站接口代理（get/post 合一）
    if (p === '/api/req' && req.method === 'POST') {
      const payload = JSON.parse((await readBody(req)).toString('utf8'));
      if (!/^https:\/\//i.test(payload.url || '')) { sendJson(res, { status: 400, body: 'bad url' }); return; }
      try {
        let r;
        if (payload.method === 'post') {
          const params = new URLSearchParams();
          Object.entries(payload.body || {}).forEach(([k, v]) => {
            if (v !== undefined && v !== null) params.set(k, String(v));
          });
          if (jar.bili_jct && !params.has('csrf')) params.set('csrf', jar.bili_jct);
          r = await biliFetch(payload.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });
        } else {
          r = await biliFetch(payload.url, payload.opts || {});
        }
        sendJson(res, { status: r.status, body: await r.text() });
      } catch (e) { sendJson(res, { status: -1, body: String(e) }); }
      return;
    }

    // 封面图 → dataURL
    if (p === '/api/image') {
      const target = u.searchParams.get('url') || '';
      try {
        const r = await biliFetch(target);
        if (!r.ok) { res.writeHead(200); res.end(''); return; }
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = r.headers.get('content-type') || 'image/jpeg';
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`data:${mime};base64,${buf.toString('base64')}`);
      } catch (e) { res.writeHead(200); res.end(''); }
      return;
    }

    // 音视频流代理：Range 透传 + CORS；客户端断开即取消上游，避免 CDN 连接配额被占满
    if (p === '/media') {
      const target = u.searchParams.get('url') || '';
      if (!/^https:\/\//i.test(target)) { res.writeHead(400); res.end('bad url'); return; }
      const headers = {
        'User-Agent': UA, 'Referer': REFERER,
        ...(cookieHeaderFor(new URL(target).hostname) ? { Cookie: cookieHeaderFor(new URL(target).hostname) } : {}),
      };
      if (req.headers.range) headers.Range = req.headers.range;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const remote = await fetch(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: controller.signal });
        clearTimeout(timer);
        const out = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
        };
        ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((h) => {
          const v = remote.headers.get(h);
          if (v) out[h] = v;
        });
        const dl = u.searchParams.get('dl');
        if (dl) out['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`;
        res.writeHead(remote.status, out);
        if (!remote.body) { res.end(); return; }
        const reader = remote.body.getReader();
        res.on('close', () => { try { reader.cancel().catch(() => {}); } catch (e) {} });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await new Promise((ok) => res.once('drain', ok));
        }
        res.end();
      } catch (e) {
        clearTimeout(timer);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
      return;
    }

    // 数据仓
    if (p === '/store/get') {
      const v = readStore()[u.searchParams.get('key') || ''];
      sendJson(res, v === undefined ? null : v);
      return;
    }
    if (p === '/store/set' && req.method === 'POST') {
      const { key, val } = JSON.parse((await readBody(req)).toString('utf8'));
      readStore()[String(key)] = val;
      scheduleStoreWrite();
      sendJson(res, { ok: true });
      return;
    }

    // 扫码登录
    if (p === '/auth/status') { sendJson(res, await getAuthStatus()); return; }
    if (p === '/auth/qr-start') {
      try {
        const r = await biliFetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
          { referer: 'https://passport.bilibili.com/login' });
        const json = JSON.parse(await r.text());
        if (json.code !== 0 || !json.data) throw new Error(json.message || '无法生成二维码');
        const QRCode = require('qrcode');
        sendJson(res, {
          ok: true,
          key: json.data.qrcode_key,
          image: await QRCode.toDataURL(json.data.url, { width: 320, margin: 1, color: { dark: '#171810', light: '#ffffff' } }),
        });
      } catch (e) { sendJson(res, { ok: false, message: String(e.message || e) }); }
      return;
    }
    if (p === '/auth/qr-poll') {
      try {
        const r = await biliFetch('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key='
          + encodeURIComponent(u.searchParams.get('key') || ''), { referer: 'https://passport.bilibili.com/login' });
        const json = JSON.parse(await r.text());
        if (json.code !== 0 || !json.data) throw new Error(json.message || '二维码轮询失败');
        const result = { ok: true, code: json.data.code, message: json.data.message || '' };
        if (json.data.code === 0) result.auth = await getAuthStatus();
        sendJson(res, result);
      } catch (e) { sendJson(res, { ok: false, message: String(e.message || e) }); }
      return;
    }
    if (p === '/auth/logout' && req.method === 'POST') {
      ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].forEach((k) => delete jar[k]);
      saveJar();
      sendJson(res, { isLogin: false });
      return;
    }

    // 短信验证码登录（与桌面端同一流程：极验参数 → 发短信 → 验证码登录）
    if (p === '/auth/sms-captcha') {
      try {
        const r = await biliFetch('https://passport.bilibili.com/x/passport-login/captcha?source=main_web',
          { referer: 'https://passport.bilibili.com/login' });
        const json = JSON.parse(await r.text());
        if (json.code !== 0 || !json.data || !json.data.geetest) throw new Error(json.message || '获取验证参数失败');
        sendJson(res, { ok: true, token: json.data.token, gt: json.data.geetest.gt, challenge: json.data.geetest.challenge });
      } catch (e) { sendJson(res, { ok: false, message: String(e.message || e) }); }
      return;
    }
    if ((p === '/auth/sms-send' || p === '/auth/sms-login') && req.method === 'POST') {
      try {
        const payload = JSON.parse((await readBody(req)).toString('utf8'));
        const params = p === '/auth/sms-send'
          ? { cid: payload.cid || 86, tel: payload.tel, source: 'main_web',
              token: payload.token, challenge: payload.challenge, validate: payload.validate, seccode: payload.seccode }
          : { cid: payload.cid || 86, tel: payload.tel, code: payload.code, source: 'main_web',
              captcha_key: payload.captchaKey, keep: true };
        const r = await biliFetch('https://passport.bilibili.com/x/passport-login/web'
          + (p === '/auth/sms-send' ? '/sms/send' : '/login/sms'), {
          method: 'POST',
          referer: 'https://passport.bilibili.com/login',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params).toString(),
        });
        const json = JSON.parse(await r.text());
        if (p === '/auth/sms-send') {
          sendJson(res, { ok: json.code === 0, message: json.message || '', captchaKey: json.data && json.data.captcha_key });
        } else if (json.code !== 0) {
          sendJson(res, { ok: false, message: json.message || '登录失败' });
        } else {
          sendJson(res, { ok: true, auth: await getAuthStatus() });
        }
      } catch (e) { sendJson(res, { ok: false, message: String(e.message || e) }); }
      return;
    }

    // MixSplitR 识曲：原始 PCM（Float32 小端）放 body，区间走 query
    if (p === '/api/ncm-recognize' && req.method === 'POST') {
      const pcm = await readBody(req);
      const list = await ncmRecognize(pcm, +(u.searchParams.get('from') || 0), +(u.searchParams.get('len') || 0));
      sendJson(res, list || []);
      return;
    }
    if (p === '/api/shazam-recognize' && req.method === 'POST') {
      const pcm = await readBody(req);
      sendJson(res, await shazamRecognize(pcm));
      return;
    }

    // 其余按静态文件处理（React 构建版优先，否则旧版 renderer/）
    const f = path.normalize(path.join(STATIC_ROOT, p));
    if (!f.startsWith(STATIC_ROOT)) { res.writeHead(403); res.end(); return; }
    serveFile(res, f);
  } catch (e) {
    console.error(p, e);
    if (!res.headersSent) sendJson(res, { error: String(e.message || e) }, 500);
    else res.end();
  }
});

server.listen(PORT, HOST, async () => {
  await ensureBuvid();
  const os = require('os');
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Biu Player 移动版已启动：`);
  console.log(`  本机:   http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  局域网: http://${ip}:${PORT}  ← 手机浏览器打开这个`));
});
