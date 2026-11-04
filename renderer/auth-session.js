/* Shared session lifecycle. Transport failures never revoke a verified account. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuAuthSession = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NAV = 'https://api.bilibili.com/x/web-interface/nav';
  function decode(status, body) {
    if (status !== 200) throw new Error(`登录状态暂时无法验证（HTTP ${status}）`);
    const json = typeof body === 'string' ? JSON.parse(body) : body;
    if (Number(json?.code) === -101 || (json?.code === 0 && json.data?.isLogin === false)) return { isLogin: false };
    if (json?.code !== 0 || !json.data?.isLogin || !json.data.mid) throw new Error('登录状态暂时无法验证');
    const d = json.data;
    return { isLogin: true, mid: d.mid, uname: d.uname || '', face: d.face || '', vipType: d.vipType || 0 };
  }
  function create({ verify, now = Date.now, ttl = 60000, timeout = 10000 }) {
    let state = null, revision = 0, pending = null, checkedAt = -Infinity;
    const listeners = new Set();
    function apply(next) {
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = next;
      if (changed) for (const listener of listeners) { try { listener(next); } catch {} }
      return next;
    }
    function reset(next) {
      revision++; pending = null; checkedAt = -Infinity;
      if (next) return apply(next);
    }
    function expire() {
      reset();
      checkedAt = now();
      return apply({ isLogin: false, status: 'expired', message: '登录已失效，请重新登录' });
    }
    function check({ force = false } = {}) {
      if (pending) return pending;
      if (!force && state && !state.unverified && now() - checkedAt < ttl) return Promise.resolve(state);
      const token = revision;
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('登录状态验证超时，请检查网络')), timeout);
      });
      const request = Promise.race([Promise.resolve().then(verify), deadline]).then(next => {
        if (token !== revision) return state || { isLogin: false };
        checkedAt = now();
        if (!next.isLogin && (state?.isLogin || state?.status === 'expired')) return expire();
        return apply(next);
      }).catch(error => {
        if (token !== revision) return state || { isLogin: false };
        checkedAt = now();
        return apply({ ...(state || { isLogin: false }), unverified: true, error: String(error.message || error) });
      }).finally(() => { clearTimeout(timer); if (pending === request) pending = null; });
      pending = request;
      return request;
    }
    function observe(url, response, token, authenticated = true) {
      if (!authenticated || token !== revision || response.status !== 200 || typeof response.body !== 'string') return;
      let u, json;
      try { u = new URL(url); } catch { return; }
      // App-token rejection and third-party failures do not revoke Web cookies.
      if (u.hostname !== 'api.bilibili.com' || u.pathname === '/x/web-interface/nav') return;
      // Successful feed pages need no second JSON allocation on the UI thread.
      if (!response.body.includes('-101')) return;
      try { json = JSON.parse(response.body); } catch { return; }
      if (Number(json.code) === -101) expire();
    }
    return { check, reset, observe, get revision() { return revision; }, get state() { return state; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  }
  return { NAV, decode, create };
});
