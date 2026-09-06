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
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import forge from 'node-forge';
import { mediaUrl } from './mediaUrl';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const REFERER = 'https://www.bilibili.com/';

/* ---------- Cookie 罐 ---------- */
const JAR_KEY = 'biu.cookies';
const COOKIE_HOSTS = /(^|\.)bilibili\.com$|(^|\.)bilivideo\.(com|cn)$|(^|\.)hdslb\.com$/;
let jar = {};
let jarReady = null;
let jarTimer = null;
let authRevision = 0;

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

const cookieHeaderFor = (host, cookies = jar) => {
  if (!COOKIE_HOSTS.test(host)) return '';
  return Object.entries(cookies).map(([k, v]) => {
    // QR callback query parameters are decoded, unlike Set-Cookie values.
    // Keep SESSDATA in its wire format without double-encoding existing cookies.
    const value = k === 'SESSDATA' ? String(v).replace(/[^A-Za-z0-9_.~%\-]/g, encodeURIComponent) : v;
    return `${k}=${value}`;
  }).join('; ');
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
  const data = await biliFetch('https://api.bilibili.com/x/web-interface/nav', { skipBuvid: true }, async (res) => JSON.parse(await res.text()));
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
      const data = await biliFetch('https://api.bilibili.com/x/frontend/finger/spi', { skipBuvid: true }, async (res) => JSON.parse(await res.text()));
      if (data.data && data.data.b_3) { jar.buvid3 = data.data.b_3; scheduleJarSave(); }
    } catch (e) { /* 失败不影响后续请求 */ }
    buvidPending = null;
  })();
  return buvidPending;
}

/* ---------- 统一请求：UA/Referer/Cookie/超时，opts.wbi 时签名 ---------- */
export async function biliFetch(url, opts = {}, consume = (res) => res) {
  await initClient();
  if (!opts.skipBuvid) await ensureBuvid();
  const u = new URL(url);
  if (opts.wbi) {
    const signed = await signWbi(u.search.replace(/^\?/, ''));
    url = u.origin + u.pathname + '?' + signed;
  }
  const cookie = opts.cookies === false ? '' : cookieHeaderFor(u.hostname);
  const headers = {
    'User-Agent': UA,
    Referer: opts.referer || REFERER,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(opts.headers || {}),
  };
  const controller = new AbortController();
  let rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    controller.abort();
    rejectAbort(Object.assign(new Error('请求已取消或超时'), { name: 'AbortError' }));
  };
  if (opts.signal?.aborted) abort();
  opts.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, opts.timeout || 10000);
  try {
    return await Promise.race([interrupted, (async () => {
      if (controller.signal.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
      const res = await fetch(url, {
        method: opts.method || 'GET',
        // Keep the application's explicit Cookie header as the only source.
        credentials: 'omit',
        headers,
        body: opts.body,
        signal: controller.signal,
      });
      if (opts.captureCookies !== false && !controller.signal.aborted) captureCookies(res, u.hostname);
      // Keep the deadline through body consumption, even if native fetch fails
      // to reject promptly after aborting. A stalled body must release callers.
      return await consume(res);
    })()]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
}

// 与桌面端 window.bili.get 同形：{ status, body }，调用方自行 JSON.parse
let searchQueue = Promise.resolve(), nextSearchAt = 0, searchBlockedUntil = 0;
export async function get(url, opts = {}) {
  try {
    const isSearch = /^https:\/\/api\.bilibili\.com\/x\/web-interface\/(?:wbi\/)?search\//.test(url);
    if (isSearch) {
      // Pace starts without waiting for earlier responses; completed pages still
      // display immediately. A server rejection pauses subsequent search calls.
      searchQueue = searchQueue.then(async () => {
        const delay = nextSearchAt - Date.now();
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        nextSearchAt = Date.now() + 750;
      });
      await searchQueue;
      if (Date.now() < searchBlockedUntil) return { status: 429, body: '搜索请求冷却中，请稍后重试' };
    }
    return await biliFetch(url, opts, async (res) => {
      // 412 is not a rate-limit instruction. Do not turn one rejected page into
      // a fabricated 429 for every later search; honor an explicit Retry-After.
      if (isSearch && (res.status === 429 || (res.status === 412 && res.headers.get('retry-after')))) {
        const retry = res.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        searchBlockedUntil = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60000);
      }
      return { status: res.status, body: opts.responseType === 'bytes'
        ? Array.from(new Uint8Array(await res.arrayBuffer())) : await res.text() };
    });
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /aborted|timeout/i.test(String(e.message || e)));
    return { status: -1, body: aborted ? '请求超时，请检查网络' : String(e.message || e) };
  }
}

// 表单 POST（与 mobile/server.js /api/req 的 post 分支一致：有 bili_jct 时自动补 csrf）
export async function post(url, params = {}, opts = {}) {
  await initClient();
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.set(k, String(v));
  });
  if (opts.csrf !== false && jar.bili_jct && !body.has('csrf')) body.set('csrf', jar.bili_jct);
  try {
    return await biliFetch(url, {
      ...opts,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
      body: body.toString(),
    }, async (res) => ({ status: res.status, body: await res.text() }));
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
    return { isLogin: true, mid: data.mid, uname: data.uname || '', face: mediaUrl(data.face) || '', vipType: data.vipType || 0 };
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

export async function logout() {
  await initClient();
  authRevision++;
  const mid = jar.DedeUserID;
  ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].forEach((k) => delete jar[k]);
  if (mid) await appCredentialWrite(() => SecureStore.deleteItemAsync(`biu.bili-app.${mid}`)).catch(() => {});
  scheduleJarSave();
  return { isLogin: false };
}

// Protocol reference: PiliPlus 4d66b7b, lib/http/login.dart, video.dart and
// utils/app_sign.dart. App approval issues an Android HD token; web cookies
// cannot approve this grant on the user's behalf.
const APP_KEY = 'dfca71928277209b';
const APP_SECRET = 'b5475a8825547a4fc26c7d518eaaa02e';
const APP_UA = 'Mozilla/5.0 BiliDroid/2.0.1 (bbcallen@gmail.com) os/android model/android_hd mobi_app/android_hd build/2001100 channel/master innerVer/2001100 osVer/15 network/2';
// Forge's PKCS#1 padding needs native entropy in Hermes, which has no Node RNG.
forge.random.getBytesSync = (count) => String.fromCharCode(...Crypto.getRandomBytes(count));
let appDeviceId;
function deviceId() {
  if (!appDeviceId) {
    const now = new Date(), year = now.getFullYear();
    const bcd = (value) => (Math.floor(value / 10) << 4) | (value % 10);
    const bytes = [...Crypto.getRandomBytes(16), ...[Math.floor(year / 100), year % 100, now.getMonth() + 1,
      now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].map(bcd), ...Crypto.getRandomBytes(8)];
    bytes.push(bytes.reduce((sum, value) => sum + value, 0) & 255);
    appDeviceId = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return appDeviceId;
}
let appWrites = Promise.resolve();
function appCredentialWrite(write) {
  const result = appWrites.then(write);
  appWrites = result.catch(() => {});
  return result;
}
function signApp(params) {
  // PiliPlus signs URI components (spaces as %20, empty values as bare keys).
  const values = { ...params, appkey: APP_KEY, ts: String(Math.floor(Date.now() / 1000)) };
  const query = Object.keys(values).sort().map((key) => encodeURIComponent(key)
    + (String(values[key]) === '' ? '' : '=' + encodeURIComponent(String(values[key])))).join('&');
  return query + '&sign=' + md5(query + APP_SECRET);
}
function appData(response, stage) {
  if (response.status !== 200) throw new Error(`${stage}连接失败（HTTP ${response.status}），请稍后重试`);
  let json;
  try { json = JSON.parse(response.body); } catch { throw new Error(`${stage}响应无效`); }
  if (json.code !== 0) throw Object.assign(new Error(`${stage}失败（${json.code}）`), { code: json.code, stage });
  return json.data;
}
function appAuthRequired(message = '首次使用 App 推荐，请打开 B 站完成授权') {
  return Object.assign(new Error(message), { code: 'APP_AUTH_REQUIRED' });
}
async function appSession(signal, login = false) {
  await initClient();
  const mid = String(jar.DedeUserID || ''), session = jar.SESSDATA;
  const revision = authRevision;
  if (!login && (!mid || !session)) throw new Error('请先在「我的」登录 B 站');
  const check = () => {
    if (signal?.aborted) throw Object.assign(new Error('授权已取消'), { name: 'AbortError' });
    if (revision !== authRevision || String(jar.DedeUserID || '') !== mid || jar.SESSDATA !== session) throw new Error('账号已切换，请重新授权');
  };
  check();
  return { mid, sessionKey: md5(session || ''), storageKey: `biu.bili-app.${mid}`, check, login };
}
async function appOptions(signal) {
  await ensureBuvid();
  const device = md5(String(jar.buvid3 || 'biu-player'));
  return { cookies: false, csrf: false, skipBuvid: true, captureCookies: false, signal,
    headers: { 'User-Agent': APP_UA, 'app-key': 'android_hd', env: 'prod',
      buvid: `XY${device[2]}${device[12]}${device[22]}${device}` } };
}
async function appLoginPost(path, params, signal, stage) {
  const opts = await appOptions(signal);
  return appData(await post(`https://passport.bilibili.com/x/passport-tv-login/qrcode/${path}?${signApp(params)}`,
    {}, opts), stage);
}
async function appSmsPost(path, params, signal) {
  const opts = await appOptions(signal);
  const buvid = opts.headers.buvid;
  const body = signApp({ build: '2001100', buvid, local_id: buvid, channel: 'master', disable_rcmd: '0',
    platform: 'android', mobi_app: 'android_hd', c_locale: 'zh_CN', s_locale: 'zh_CN',
    statistics: '{"appId":5,"platform":3,"version":"2.0.1","abtest":""}', ...params });
  try {
    return await biliFetch('https://passport.bilibili.com/x/passport-login/' + path, {
      ...opts, method: 'POST', body,
      headers: { ...opts.headers, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    }, async (res) => ({ status: res.status, body: await res.text() }));
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('短信登录连接失败，请检查网络后重试');
  }
}
export async function smsSend({ tel, cid = 86, captcha, signal }) {
  if (String(cid) !== '86' || !/^1\d{10}$/.test(tel)) throw new Error('请输入正确的 11 位手机号');
  const session = await appSession(signal, true);
  const opts = await appOptions(signal);
  const response = await appSmsPost('sms/send', { cid, tel,
    login_session_id: md5(opts.headers.buvid + Date.now()),
    ...(captcha ? { gee_challenge: captcha.challenge, gee_validate: captcha.validate,
      gee_seccode: captcha.seccode, recaptcha_token: captcha.token } : {}),
  }, signal);
  session.check();
  let data;
  try { data = appData(response, '发送验证码'); }
  catch (error) {
    if (Number(error.code) !== -105) throw error;
    data = JSON.parse(response.body).data;
  }
  if (data?.captcha_key && !data.recaptcha_url) return { captchaKey: data.captcha_key };
  let challenge;
  try {
    const url = new URL(data?.recaptcha_url);
    challenge = { gt: url.searchParams.get('gee_gt'), challenge: url.searchParams.get('gee_challenge'), token: url.searchParams.get('recaptcha_token') };
  } catch { /* Older App responses need the safecenter captcha endpoint. */ }
  if (!challenge?.gt || !challenge.challenge || !challenge.token) {
    const pre = appData(await post('https://passport.bilibili.com/x/safecenter/captcha/pre', {}, opts), '获取安全验证');
    session.check();
    challenge = { gt: pre?.gee_gt, challenge: pre?.gee_challenge, token: pre?.recaptcha_token };
  }
  if (!challenge.gt || !challenge.challenge || !challenge.token) throw new Error('B 站未返回有效的安全验证，请重试');
  return { captcha: challenge };
}
export async function smsLogin({ tel, cid = 86, code, captchaKey, signal }) {
  if (String(cid) !== '86' || !/^1\d{10}$/.test(tel) || !/^\d{4,8}$/.test(code) || !captchaKey) throw new Error('请填写手机号和短信验证码');
  const session = await appSession(signal, true);
  const keyData = appData(await get('https://passport.bilibili.com/x/passport-login/web/key', await appOptions(signal)), '获取登录公钥');
  session.check();
  const key = forge.pki.publicKeyFromPem(keyData.key);
  const seed = forge.util.bytesToHex(forge.random.getBytesSync(8));
  const dt = encodeURIComponent(forge.util.encode64(key.encrypt(seed, 'RSAES-PKCS1-V1_5')));
  const id = deviceId();
  const data = appData(await appSmsPost('login/sms', { cid, tel, code, captcha_key: captchaKey,
    bili_local_id: id, device_id: id, device: 'phone', device_name: 'vivo', device_platform: 'Android14vivo',
    dt, from_pv: 'main.my-information.my-login.0.click', from_url: encodeURIComponent('bilibili://user_center/mine'),
  }, signal), '短信登录');
  session.check();
  if (data?.status === 2) throw new Error('B 站要求额外安全验证，请改用 B 站 App 登录');
  return completeAppLogin(session, data, signal);
}
export async function startAppAuthorization({ signal, login = false } = {}) {
  const session = await appSession(signal, login);
  const data = await appLoginPost('auth_code', { local_id: '0', platform: 'android', mobi_app: 'android_hd' },
    signal, '创建 App 授权');
  session.check();
  let url;
  try { url = new URL(data.url); } catch { throw new Error('B 站返回的授权地址无效'); }
  if (url.protocol !== 'https:' || !/(^|\.)bilibili\.com$/.test(url.hostname) || !data.auth_code) {
    throw new Error('B 站返回的授权地址无效');
  }
  return { ...session, authCode: data.auth_code, url: url.href,
    expiresAt: Date.now() + Math.min(180, Number(data.expires_in) > 0 ? Number(data.expires_in) : 180) * 1000 };
}
export async function pollAppAuthorization(grant, { signal } = {}) {
  grant.check();
  if (Date.now() >= grant.expiresAt) return { status: 'expired' };
  let data;
  try {
    data = await appLoginPost('poll', { auth_code: grant.authCode, local_id: '0' }, signal, '领取 App 令牌');
  } catch (error) {
    grant.check();
    if (Number(error.code) === 86038) return { status: 'expired' };
    if (Number(error.code) === 86039) return { status: 'waiting' };
    if (Number(error.code) === 86090) return { status: 'scanned' };
    throw error;
  }
  grant.check();
  return completeAppLogin(grant, data, signal);
}
async function completeAppLogin(grant, data, signal) {
  grant.check();
  const info = data?.token_info || data;
  const mid = String(info?.mid || data?.mid || '');
  if (!/^[1-9]\d*$/.test(mid)) throw new Error('B 站未返回有效的登录账号');
  if (!grant.login && mid !== grant.mid) throw new Error('请使用与「我的」相同的 B 站账号授权');
  if (!info?.access_token || !(Number(info.expires_in) > 60)) throw new Error('B 站未返回有效的 App 令牌，请刷新授权');
  let nextJar, auth;
  if (grant.login) {
    const cookies = {};
    for (const cookie of data?.cookie_info?.cookies || []) {
      if (['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].includes(cookie.name)
          && typeof cookie.value === 'string') cookies[cookie.name] = cookie.value;
    }
    if (!cookies.SESSDATA || !cookies.bili_jct || cookies.DedeUserID !== mid) throw new Error('B 站未返回完整登录凭据，请刷新重试');
    // Validate cookies before committing either credential, so a "successful"
    // first login cannot leave the Web APIs and App feed on different accounts.
    nextJar = { ...jar };
    ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].forEach((key) => delete nextJar[key]);
    Object.assign(nextJar, cookies);
    const web = appData(await get('https://api.bilibili.com/x/web-interface/nav', {
      cookies: false, captureCookies: false, signal,
      headers: { Cookie: cookieHeaderFor('api.bilibili.com', nextJar) },
    }), '校验登录账号');
    grant.check();
    if (!web?.isLogin || String(web.mid) !== mid) throw new Error('登录账号校验失败，请刷新重试');
    auth = { isLogin: true, mid: web.mid, uname: web.uname || '', face: mediaUrl(web.face) || '', vipType: web.vipType || 0 };
  }
  const storageKey = `biu.bili-app.${mid}`;
  const credential = { appkey: APP_KEY, mid, sessionKey: nextJar ? md5(nextJar.SESSDATA) : grant.sessionKey,
    token: info.access_token, expiresAt: Date.now() + Number(info.expires_in) * 1000 };
  await appCredentialWrite(async () => {
    grant.check();
    await SecureStore.setItemAsync(storageKey, JSON.stringify(credential));
    try {
      grant.check();
      if (nextJar) {
        clearTimeout(jarTimer);
        await AsyncStorage.setItem(JAR_KEY, JSON.stringify(nextJar));
        grant.check();
        jar = nextJar;
        authRevision++;
      }
    } catch (error) {
      await SecureStore.deleteItemAsync(storageKey);
      if (nextJar) await AsyncStorage.setItem(JAR_KEY, JSON.stringify(jar));
      throw error;
    }
  });
  if (!grant.login) grant.check();
  return { status: 'authorized', ...(auth ? { auth } : {}) };
}
export async function appGet(path, params = {}) {
  if (path !== '/x/v2/feed/index') throw new Error('不支持的移动端接口');
  const session = await appSession();
  let auth;
  try { auth = JSON.parse(await SecureStore.getItemAsync(session.storageKey)); } catch { /* Request App approval again. */ }
  session.check();
  if (auth?.appkey !== APP_KEY || auth.mid !== session.mid || auth.sessionKey !== session.sessionKey || !auth.token) {
    throw appAuthRequired();
  }
  if (!(auth.expiresAt > Date.now() + 60000)) throw appAuthRequired('App 推荐授权已到期，请打开 B 站重新授权');
  const opts = await appOptions();
  session.check();
  const response = await get(`https://app.bilibili.com${path}?${signApp({ ...params, access_key: auth.token })}`, opts);
  session.check();
  try { return appData(response, '读取 App 推荐'); }
  catch (error) {
    if (![-101, -111, -663].includes(Number(error.code))) throw error;
    // Do not delete a newer grant if an old in-flight feed request is rejected.
    await appCredentialWrite(async () => {
      const current = await SecureStore.getItemAsync(session.storageKey);
      if (current && JSON.parse(current).token === auth.token) await SecureStore.deleteItemAsync(session.storageKey);
    });
    session.check();
    throw appAuthRequired(`B 站已拒绝当前 App 令牌（${error.code}），请重新授权`);
  }
}

// 供播放器使用：CDN 必须带 Referer 否则 403
export const streamHeaders = () => ({ Referer: REFERER, 'User-Agent': UA });
export const cloudCsrf = async () => { await initClient(); return jar.bili_jct || ''; };
// 封面图请求头（hdslb.com 同样需要 Referer）
export const imageHeaders = streamHeaders;
