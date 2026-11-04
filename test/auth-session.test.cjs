const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, decode, NAV } = require('../renderer/auth-session');
const account = { isLogin: true, mid: 123, uname: '测试', face: '', vipType: 0 };
const expiredResponse = { status: 200, body: JSON.stringify({ code: -101 }) };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('only definitive authentication responses sign an account out', () => {
  assert.deepEqual(decode(200, { code: 0, data: account }), account);
  assert.deepEqual(decode(200, { code: -101 }), { isLogin: false });
  assert.deepEqual(decode(200, { code: 0, data: { isLogin: false } }), { isLogin: false });
  for (const [status, body] of [[412, 'blocked'], [401, 'denied'], [200, { code: -352 }], [200, {}], [200, '<html>']]) {
    assert.throws(() => decode(status, body));
  }
});

test('expired API calls notify once; unrelated and anonymous responses never revoke Web login', async () => {
  let time = 0, calls = 0;
  const session = create({ now: () => time, verify: async () => { calls++; return account; } });
  const events = []; session.subscribe(auth => events.push(auth));
  await session.check();
  const revision = session.revision;
  for (const url of ['https://app.bilibili.com/x/v2/feed/index', 'https://other.example/api', NAV]) {
    session.observe(url, expiredResponse, revision);
  }
  session.observe('https://api.bilibili.com/x/relation', expiredResponse, revision, false);
  session.observe('https://api.bilibili.com/x/relation', { status: 412, body: expiredResponse.body }, revision);
  assert.equal(session.state.isLogin, true);
  session.observe('https://api.bilibili.com/x/relation', expiredResponse, revision);
  session.observe('https://api.bilibili.com/x/favorite', expiredResponse, revision);
  assert.equal(session.state.status, 'expired'); assert.equal(events.length, 2);
  await session.check(); assert.equal(calls, 1, 'expiration notification does not trigger a request storm');
  time = 60001;
  assert.equal((await session.check()).isLogin, true, 'a successful subsequent login can restore the session');
});

test('checks coalesce and network failures preserve accounts while allowing immediate recovery', async () => {
  let result = account;
  const session = create({ verify: async () => {
    if (result instanceof Error) throw result;
    return result;
  } });
  const a = session.check({ force: true }), b = session.check({ force: true });
  assert.equal(a, b); await a;
  result = new Error('offline');
  const offline = await session.check({ force: true });
  assert.equal(offline.mid, account.mid); assert.equal(offline.isLogin, true); assert.equal(offline.unverified, true);
  result = account;
  assert.deepEqual(await session.check(), account, 'an online retry is not blocked by the normal cache TTL');
});

test('stale status and API responses cannot undo logout or overwrite a newer login', async () => {
  const delayed = deferred();
  const session = create({ verify: () => delayed.promise });
  session.reset(account);
  const oldRevision = session.revision;
  const status = session.check({ force: true });
  session.reset({ isLogin: false });
  delayed.resolve(account);
  assert.equal((await status).isLogin, false);
  const next = { ...account, mid: 456 };
  session.reset(next);
  session.observe('https://api.bilibili.com/x/relation', expiredResponse, oldRevision);
  assert.deepEqual(session.state, next);
});

test('definitive expiration wins over an older successful status check', async () => {
  const delayed = deferred(); const session = create({ verify: () => delayed.promise });
  session.reset(account);
  const status = session.check({ force: true });
  session.observe('https://api.bilibili.com/x/relation', expiredResponse, session.revision);
  delayed.resolve(account);
  assert.equal((await status).status, 'expired');
});

test('a stalled probe releases callers without logging them out', async () => {
  const session = create({ timeout: 15, verify: () => new Promise(() => {}) });
  session.reset(account);
  const result = await session.check({ force: true });
  assert.equal(result.isLogin, true); assert.equal(result.unverified, true);
  assert.match(result.error, /超时/);
});

test('desktop and browser-server adapters use definitive status, preserve outages and broadcast expiry', async t => {
  for (const file of ['main.js', 'mobile/server.js']) await t.test(file, async () => {
    let status = 200, body = { code: 0, data: account };
    const events = [];
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf('const authSession = createAuthSession(');
    const end = source.indexOf(file === 'main.js' ? '\nfunction notifyAuthChanged' : '\n/* ---------- 本地数据仓', start);
    const context = { createAuthSession: create, decodeAuth: decode, AUTH_NAV: NAV, AbortController, setTimeout, clearTimeout,
      biliFetch: async () => ({ status, text: async () => JSON.stringify(body) }),
      notifyAuthChanged: auth => events.push(auth) };
    vm.runInNewContext(source.slice(start, end) + '\nglobalThis.adapter = { getAuthStatus, authSession };', context);
    const adapter = context.adapter;
    assert.equal((await adapter.getAuthStatus()).isLogin, true);
    status = 412;
    assert.equal((await adapter.getAuthStatus()).unverified, true);
    assert.equal(adapter.authSession.state.isLogin, true);
    status = 200; body = { code: -101 };
    assert.equal((await adapter.getAuthStatus()).status, 'expired');
    if (file === 'main.js') assert.equal(events.at(-1).status, 'expired', 'main process updates both desktop renderers through IPC');
  });
});

test('both desktop renderers reject stale account buckets without waiting for the feed', async t => {
  for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) await t.test(file, async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf('async function loadBuckets() {');
    const end = source.indexOf('\nfunction renderAuth', start);
    const guest = deferred();
    const context = { api: { hasBridge: true },
      window: { bili: { lanSyncStop: async () => {}, lanSyncConfigure: async () => {},
        storeGet: async key => key === 'biu-likes' ? guest.promise : [{ key }], storeSet() {} } },
      localStorage: { getItem: () => null, setItem() {} },
      recommendationProfiles: { manager() {} }, publish() {}, renderFavButtons() {}, refreshMusicLibraryUI() {},
      loadLibrary: () => new Promise(() => {}),
    };
    vm.runInNewContext(`let dataNs='9', dataNsRevision=0, likes=[], musicLibrary=[], customPlaylists=[], playHistory=[];\n`
      + source.slice(start, end) + '\nglobalThis.buckets={switchDataNs,likes:()=>likes,scope:()=>dataNs};', context);
    const buckets = context.buckets;
    const expire = buckets.switchDataNs('');
    await new Promise(resolve => setImmediate(resolve));
    await buckets.switchDataNs('9');
    guest.resolve([{ key: 'old-guest-data' }]); await expire;
    assert.equal(buckets.scope(), '9');
    assert.equal(buckets.likes()[0].key, 'biu-likes@9');
  });
});
