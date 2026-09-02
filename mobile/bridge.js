/* Biu Player · 移动版桥接层
 * 在浏览器里实现桌面版 preload.js 暴露的 window.bili 接口，
 * 全部能力经同源 HTTP 落到 mobile/server.js（Cookie/WBI/风控都在服务端处理）。
 * 桌面专属能力（窗口控制、桌面歌词）降级为 no-op。
 */
(function () {
  'use strict';
  const json = (r) => r.json();
  const postJson = (url, payload) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json);

  window.bili = {
    /* ---- B 站接口 ---- */
    get: (url, opts) => postJson('/api/req', { method: 'get', url, opts }),
    post: (url, body) => postJson('/api/req', { method: 'post', url, body }),
    // 封面 → dataURL（api.image 的约定；失败返回 null）
    image: async (url) => {
      try {
        const t = await fetch('/api/image?url=' + encodeURIComponent(url));
        const s = await t.text();
        return s || null;
      } catch (e) { return null; }
    },
    // api.js 的媒体地址包装钩子：移动版走同源 /media 代理
    mediaProxy: (u) => '/media?url=' + encodeURIComponent(u),

    /* ---- 本地数据仓 ---- */
    storeGet: (key) => fetch('/store/get?key=' + encodeURIComponent(key)).then(json).catch(() => null),
    storeSet: (key, val) => { postJson('/store/set', { key, val }).catch(() => {}); },
    playbackSave: (snap) => { postJson('/store/set', { key: 'biu-playback-session', val: snap }).catch(() => {}); },

    /* ---- 扫码登录 ---- */
    authStatus: () => fetch('/auth/status').then(json),
    authQrStart: () => fetch('/auth/qr-start').then(json),
    authQrPoll: (key) => fetch('/auth/qr-poll?key=' + encodeURIComponent(key)).then(json),
    authLogout: () => fetch('/auth/logout', { method: 'POST' }).then(json),
    // 短信验证码登录（与桌面端同一流程）
    authSmsCaptcha: () => fetch('/auth/sms-captcha').then(json),
    authSmsSend: (payload) => postJson('/auth/sms-send', payload),
    authSmsLogin: (payload) => postJson('/auth/sms-login', payload),
    // 桌面版会开官方登录窗；移动版开新标签页（扫码登录是主路径）
    authOpenLogin: () => window.open('https://passport.bilibili.com/login', '_blank'),
    onAuthChanged: () => {},

    /* ---- MixSplitR 识曲：PCM（Float32 ArrayBuffer）原样上传 ---- */
    ncmRecognize: async ({ pcm, from, len }) => {
      try {
        const r = await fetch(`/api/ncm-recognize?from=${from}&len=${len}`, { method: 'POST', body: pcm });
        return await r.json();
      } catch (e) { return null; }
    },
    shazamRecognize: async ({ pcm }) => {
      try {
        const r = await fetch('/api/shazam-recognize', { method: 'POST', body: pcm });
        return await r.json();
      } catch (e) { return null; }
    },

    /* ---- 下载：走 /media 代理 + Content-Disposition，交给浏览器下载 ---- */
    downloadStart: ({ url, filename }) => {
      const name = filename || 'biu-download.mp4';
      const a = document.createElement('a');
      a.href = '/media?url=' + encodeURIComponent(url) + '&dl=' + encodeURIComponent(name);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return Promise.resolve({ ok: true });
    },
    onDownloadProgress: () => {},

    /* ---- 桌面专属：窗口控制 / 桌面歌词，全部 no-op ---- */
    winMin: () => {},
    winMax: () => {},
    winClose: () => window.close(),
    lyricLine: () => {},
    lyricToggle: () => {},
    onLyricClosed: () => {},
  };
})();
