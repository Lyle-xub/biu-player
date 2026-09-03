/* Biu Player RN · B 站请求层（移植自 mobile/server.js 的 Node 版代理逻辑）
 * - UA / Referer 头
 * - Cookie 罐：按 name 存，bilibili 系域名共享；AsyncStorage 持久化
 * - WBI 签名（MIXIN_TAB + js-md5）
 * - buvid3 访客标识（/x/frontend/finger/spi）
 * - 扫码登录三件套（qrStart / qrPoll / authStatus / logout）
 * RN 的 fetch 等价于桌面端 Electron 主进程的 window.bili.get 桥。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import md5 from 'js-md5';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const REFERER = 'https://www.bilibili.com/';

/* ---------- Cookie 罐 ---------- */
const JAR_KEY = 'biu.cookies';
const COOKIE_HOSTS = /(^|\.)bilibili\.com$|(^|\.)bilivideo\.(com|cn)$|(^|\.)hdslb\.com$/;
let jar = {};
let jarReady = null;
let jarTimer = null;

export function initClient() {
  if (!jarReady) {
    jarReady = (async () => {
      try {
        const raw = await AsyncStorage.getItem(JAR_KEY);
        jar = raw ? JSON.parse(raw) || {} : {};
      } catch (e) { jar = {}; }
      ensureBuvid().catch(() => {});
    })();
  }
  return jarReady;
}

function scheduleJarSave() {
  clearTimeout(jarTimer);
  jarTimer = setTimeout(() => {
    AsyncStorage.setItem(JAR_KEY, JSON.stringify(jar)).catch(() => {});
  }, 300);
}

const cookieHeaderFor = (host) => {
  if (!COOKIE_HOSTS.test(host)) return '';
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
};

// 合并后的 Set-Cookie 串按「逗号 + 名字=」切分，避开 Expires 里的逗号
function splitSetCookie(header) {
  return String(header).split(/,\s*(?=[^;,\s]+=)/).map((s) => s.trim()).filter(Boolean);
}

function applySetCookieList(list, host) {
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
    if (value === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) delete jar[name];
    else jar[name] = value;
    changed = true;
  }
  if (changed) scheduleJarSave();
}

function captureCookies(res, host) {
  try {
    const h = res.headers;
    if (typeof h.getSetCookie === 'function') {
      const list = h.getSetCookie();
      if (list && list.length) applySetCookieList(list, host);
      return;
    }
    const merged = h.get('set-cookie');
    if (merged) applySetCookieList(splitSetCookie(merged), host);
  } catch (e) { /* 罐捕获失败不阻塞请求 */ }
}

/* ---------- WBI 签名（与 main.js / mobile/server.js 同源） ---------- */
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16,
  24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52];
let wbiKeys = null;
let wbiKeysAt = 0;

async function getWbiKeys() {
  if (wbiKeys && Date.now() - wbiKeysAt < 12 * 3600 * 1000) return wbiKeys;
  const res = await biliFetch('https://api.bilibili.com/x/web-interface/nav', { skipBuvid: true });
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
  const params = {};
  for (const [k, v] of new URLSearchParams(query).entries()) params[k] = v;
  params.wts = Math.floor(Date.now() / 1000);
  const entries = Object.entries(params)
    .map(([k, v]) => [k, String(v).replace(/[!'()*]/g, '')])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const q = entries.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  return q + '&w_rid=' + md5(q + mixin);
}

/* ---------- buvid3 匿名访客标识（搜索 / playurl 风控） ---------- */
let buvidPending = null;
async function ensureBuvid() {
  if (jar.buvid3) return;
  if (buvidPending) return buvidPending;
  buvidPending = (async () => {
    try {
      const res = await biliFetch('https://api.bilibili.com/x/frontend/finger/spi', { skipBuvid: true });
      const data = JSON.parse(await res.text());
      if (data.data && data.data.b_3) { jar.buvid3 = data.data.b_3; scheduleJarSave(); }
    } catch (e) { /* 失败不影响后续请求 */ }
    buvidPending = null;
  })();
  return buvidPending;
}

/* ---------- 统一请求：UA/Referer/Cookie/超时，opts.wbi 时签名 ---------- */
async function biliFetch(url, opts = {}) {
  await initClient();
  if (!opts.skipBuvid) await ensureBuvid();
  const u = new URL(url);
  if (opts.wbi) {
    const signed = await signWbi(u.search.replace(/^\?/, ''));
    url = u.origin + u.pathname + '?' + signed;
  }
  const cookie = cookieHeaderFor(u.hostname);
  const headers = {
    'User-Agent': UA,
    Referer: opts.referer || REFERER,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(opts.headers || {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
      signal: controller.signal,
    });
    captureCookies(res, u.hostname);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 与桌面端 window.bili.get 同形：{ status, body }，调用方自行 JSON.parse
export async function get(url, opts = {}) {
  try {
    const res = await biliFetch(url, opts);
    return { status: res.status, body: await res.text() };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /aborted|timeout/i.test(String(e.message || e)));
    return { status: -1, body: aborted ? '请求超时，请检查网络' : String(e.message || e) };
  }
}

// 表单 POST（与 mobile/server.js /api/req 的 post 分支一致：有 bili_jct 时自动补 csrf）
export async function post(url, params = {}, opts = {}) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.set(k, String(v));
  });
  if (jar.bili_jct && !body.has('csrf')) body.set('csrf', jar.bili_jct);
  try {
    const res = await biliFetch(url, {
      ...opts,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
      body: body.toString(),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /aborted|timeout/i.test(String(e.message || e)));
    return { status: -1, body: aborted ? '请求超时，请检查网络' : String(e.message || e) };
  }
}

/* ---------- 扫码登录 ---------- */
export async function authStatus() {
  try {
    const r = await get('https://api.bilibili.com/x/web-interface/nav');
    if (r.status !== 200) return { isLogin: false };
    const json = JSON.parse(r.body);
    const data = json && json.data;
    if (json.code !== 0 || !data || !data.isLogin) return { isLogin: false };
    return { isLogin: true, mid: data.mid, uname: data.uname || '', face: data.face || '', vipType: data.vipType || 0 };
  } catch (e) {
    return { isLogin: false, error: String(e) };
  }
}

// 返回 { ok, key, url }：url 供 RN 端本地渲染二维码
export async function qrStart() {
  try {
    const r = await get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
      { referer: 'https://passport.bilibili.com/login' });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const json = JSON.parse(r.body);
    if (json.code !== 0 || !json.data) throw new Error(json.message || '无法生成二维码');
    return { ok: true, key: json.data.qrcode_key, url: json.data.url };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

// 返回 { ok, code, message, auth? }；code 0 成功 / 86038 过期 / 86090 已扫码 / 86101 未扫码
export async function qrPoll(key) {
  try {
    const r = await get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key='
      + encodeURIComponent(key || ''), { referer: 'https://passport.bilibili.com/login' });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const json = JSON.parse(r.body);
    if (json.code !== 0 || !json.data) throw new Error(json.message || '二维码轮询失败');
    const result = { ok: true, code: json.data.code, message: json.data.message || '' };
    if (json.data.code === 0) {
      // Set-Cookie 已被 captureCookies 入罐；部分环境拿不到 Set-Cookie 时，
      // 从成功回调 URL 的 query 里补 SESSDATA / bili_jct 等关键 cookie。
      try {
        const cu = new URL(json.data.url || '');
        ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].forEach((k) => {
          const v = cu.searchParams.get(k);
          if (v && !jar[k]) jar[k] = v;
        });
        scheduleJarSave();
      } catch (e) { /* 有 Set-Cookie 兜底，忽略 */ }
      result.auth = await authStatus();
    }
    return result;
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

/* ---------- 短信验证码登录（移植自 mobile/server.js /auth/sms-*，与桌面端同流程） ---------- */
// 极验参数：{ ok, token, gt, challenge }
export async function smsCaptcha() {
  try {
    const r = await get('https://passport.bilibili.com/x/passport-login/captcha?source=main_web',
      { referer: 'https://passport.bilibili.com/login' });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const json = JSON.parse(r.body);
    if (json.code !== 0 || !json.data || !json.data.geetest) throw new Error(json.message || '获取验证参数失败');
    return { ok: true, token: json.data.token, gt: json.data.geetest.gt, challenge: json.data.geetest.challenge };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

// 发短信：{ tel, token, challenge, validate, seccode } → { ok, message, captchaKey }
export async function smsSend(payload) {
  try {
    const r = await post('https://passport.bilibili.com/x/passport-login/web/sms/send', {
      cid: payload.cid || 86, tel: payload.tel, source: 'main_web',
      token: payload.token, challenge: payload.challenge,
      validate: payload.validate, seccode: payload.seccode,
    }, { referer: 'https://passport.bilibili.com/login' });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const json = JSON.parse(r.body);
    return { ok: json.code === 0, message: json.message || '', captchaKey: json.data && json.data.captcha_key };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

// 验证码登录：成功时响应 Set-Cookie 已由 captureCookies 入罐 → { ok, auth }
export async function smsLogin(payload) {
  try {
    const r = await post('https://passport.bilibili.com/x/passport-login/web/login/sms', {
      cid: payload.cid || 86, tel: payload.tel, code: payload.code, source: 'main_web',
      captcha_key: payload.captchaKey, keep: true,
    }, { referer: 'https://passport.bilibili.com/login' });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const json = JSON.parse(r.body);
    if (json.code !== 0) return { ok: false, message: json.message || '登录失败' };
    scheduleJarSave();
    return { ok: true, auth: await authStatus() };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
}

export async function logout() {
  ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].forEach((k) => delete jar[k]);
  scheduleJarSave();
  return { isLogin: false };
}

// 供播放器使用：CDN 必须带 Referer 否则 403
export const streamHeaders = () => ({ Referer: REFERER, 'User-Agent': UA });
// 封面图请求头（hdslb.com 同样需要 Referer）
export const imageHeaders = streamHeaders;
