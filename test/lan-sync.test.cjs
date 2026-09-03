const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLanSync } = require('../lan-sync');
const { merge, normalize, endpoint } = require('../renderer/library-sync');
const song = (id, extra = {}) => ({ bvid: `BV${id}`, title: `Song ${id}`, cid: id, ...extra });
const library = (likes = [], playlists = []) => ({ version: 1, likes, playlists });

test('library merge is idempotent, keeps segment identity and empty playlists, and only transfers library fields', () => {
  const a = song(1, { Cookie: 'secret', url: 'https://signed.example/token', lyricRef: { source: 'qq', songmid: 'abc', token: 'secret' } });
  const first = song(1, { isSegment: true, from: 0, to: 20 });
  const second = song(1, { isSegment: true, from: 20, to: 40 });
  const desktop = library([a, first], [{ id: 1, title: 'My list', tracks: [a] }]);
  const mobile = library([a, second], [{ id: 1, title: 'My list', tracks: [second] }, { id: 2, title: 'Empty', tracks: [] }]);
  const result = merge(desktop, mobile);
  assert.equal(result.likes.length, 3);
  assert.equal(result.playlists[0].tracks.length, 2);
  assert.equal(result.playlists[1].tracks.length, 0);
  assert.equal(result.likes[2].duration, 20);
  assert.deepEqual(merge(result, mobile), result);
  assert.doesNotMatch(JSON.stringify(result), /secret|signed\.example|token|Cookie/);
  assert.deepEqual(result.likes[0].lyricRef, { source: 'qq', songmid: 'abc' });
  assert.deepEqual(merge(result, library()), result, 'absence never erases another device’s songs');
  assert.throws(() => normalize({ ...desktop, version: 2 }), /版本/);
  assert.throws(() => merge(desktop, library([song(2, { isSegment: true, from: 3, to: 2 })])), /时间/);
  assert.throws(() => normalize(library([], [{ id: 1, title: 'A', tracks: [] }, { id: 1, title: 'B', tracks: [] }])), /重复/);
  assert.equal(endpoint('192.168.1.10:43821'), 'http://192.168.1.10:43821');
  for (const value of ['https://192.168.1.2:99', '8.8.8.8:80', '010.0.0.1:80', 'evil.example:80', '192.168.1.2:0', '192.168.1.2:80/path']) assert.throws(() => endpoint(value));
});

test('real LAN server pairs, merges both directions, accepts desktop-triggered sync and reports write failure', async (t) => {
  let saved = library([song(1)]), failure = false;
  const scopes = [], statuses = [];
  const service = createLanSync({ host: '127.0.0.1',
    readLibrary: (scope) => { scopes.push(scope); return saved; },
    writeLibrary: (scope, next) => { scopes.push(scope); if (failure) throw new Error('disk full'); saved = next; },
    onStatus: (status) => statuses.push(status),
  });
  t.after(() => service.stop());
  assert.equal(service.status().active, false);
  const session = await service.manual('123');
  const url = `http://127.0.0.1:${session.port}`;
  const request = (pathname, data, extra = {}) => fetch(url + pathname, {
    method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.code}`, ...extra },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  assert.equal((await request('/v1/status', null, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request('/v1/status', null, { Origin: 'https://untrusted.example' })).status, 403);
  const phone = library([song(2)], [{ id: 2, title: 'Mobile', tracks: [song(2)] }]);
  let response = await request('/v1/sync', phone);
  assert.equal(response.status, 200);
  let received = await response.json();
  assert.equal(service.status().lastSync, null, 'do not report completion before the phone has saved its copy');
  await request('/v1/ack', { receipt: received.receipt });
  assert.ok(service.status().lastSync);
  assert.deepEqual(received.library, saved);
  assert.deepEqual(saved.likes.map((s) => s.bvid), ['BV1', 'BV2']);
  assert.ok(scopes.every((s) => s === '123'), 'both buckets stay within the desktop account that opened this session');
  assert.equal(service.status().connected, true);
  assert.equal(service.status().pending, false);
  saved.likes.push(song(3));
  await service.manual('123');
  const poll = await (await request('/v1/status')).json();
  assert.ok(poll.requestId > received.requestId, 'desktop button asks the connected phone to perform an exchange');
  assert.equal(service.status().pending, true);
  received = await (await request('/v1/sync', phone)).json();
  assert.equal(received.library.likes.length, 3);
  await request('/v1/ack', { receipt: received.receipt });
  assert.equal(service.status().pending, false);
  failure = true;
  response = await request('/v1/sync', library([song(4)]));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /disk full/);
  assert.equal(saved.likes.length, 3);
  assert.equal((await request('/v1/sync', { padding: 'x'.repeat(4 * 1024 * 1024) })).status, 413);
  service.stop();
  assert.equal(statuses.at(-1).active, false);
  await assert.rejects(request('/v1/status'));
});

test('pairing expires and switching accounts invalidates the previous session', async (t) => {
  const service = createLanSync({ host: '127.0.0.1', ttl: 100, readLibrary: () => library(), writeLibrary() {} });
  t.after(() => service.stop());
  const old = await service.manual('1');
  const next = await service.manual('2');
  const response = await fetch(`http://127.0.0.1:${next.port}/v1/status`, { headers: { Authorization: `Bearer ${old.code}` } });
  assert.equal(response.status, 401);
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(service.status().active, false);
});

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(`${file}: desktop sync updates visible library data and ignores another account`, async () => {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const legacy = file.startsWith('renderer');
    const start = source.indexOf(legacy ? 'function renderLanSync(' : 'let lanSyncBusy =');
    const end = source.indexOf(legacy ? 'function initSettings(' : 'function publishSettings(', start);
    const nodes = new Map(), listeners = {}, calls = [];
    const session = { active: true, addresses: ['192.168.1.10:43821'], code: '12345678' };
    const context = vm.createContext({
      dataNs: '123', likes: [song(1)], customPlaylists: [], state: { playlist: null },
      document: { body: { dataset: { view: 'library' } } }, BiuLibrarySync: { merge },
      $: (id) => {
        if (!nodes.has(id)) nodes.set(id, { addEventListener: (name, fn) => { listeners[id + ':' + name] = fn; } });
        return nodes.get(id);
      },
      window: { bili: {
        lanSync: async (scope) => { assert.equal(scope, '123'); return session; },
        lanSyncStatus: async () => ({ active: false }), lanSyncStop: async () => {},
        onLanSyncStatus: (fn) => { listeners.status = fn; },
        onLanSyncLibrary: (fn) => { listeners.library = fn; },
      } },
      saveLikes: () => calls.push('saveLikes'), saveCustomPlaylists: () => calls.push('savePlaylists'),
      refreshLikeUI: () => calls.push('refreshLikes'), renderMyPlaylists: () => calls.push('refreshPlaylists'),
      renderFavButtons() {}, publish() {}, patchSlice() {}, toast() {},
    });
    vm.runInContext(source.slice(start, end), context);
    context.initLanSync();
    await Promise.resolve();
    if (legacy) {
      await listeners['lanSyncStart:click']();
      assert.match(nodes.get('lanSyncPair').textContent, /192\.168\.1\.10:43821/);
      assert.match(nodes.get('lanSyncPair').textContent, /12345678/);
      assert.equal(nodes.get('lanSyncStop').hidden, false);
    } else await context.manualLanSync();
    const incoming = library([song(2)], [{ id: 2, title: 'Mobile list', tracks: [song(2)] }]);
    listeners.library({ scope: '456', library: incoming });
    assert.equal(context.likes.length, 1);
    listeners.library({ scope: '123', library: incoming });
    assert.equal(context.likes.length, 2); assert.equal(context.customPlaylists.length, 1);
    assert.deepEqual(calls, ['saveLikes', 'savePlaylists', 'refreshLikes', 'refreshPlaylists']);
  });
}
