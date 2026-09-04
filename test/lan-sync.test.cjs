const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLanSync } = require('../lan-sync');
const { merge, reconcile, normalize, endpoint } = require('../renderer/library-sync');
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


test('automatic reconciliation propagates deletions, edits and ordering without losing unrelated additions', () => {
  const base = library([song(1), song(2)], [{ id: 1, title: 'Old', tracks: [song(1), song(2), song(3)] }]);
  const desktop = structuredClone(base);
  desktop.likes.push(song(3));
  const phone = library([song(2)], [{ id: 1, title: 'Edited', tracks: [song(3), song(1)] }]);
  const result = reconcile(base, desktop, phone);
  assert.deepEqual(result.likes.map((s) => s.bvid), ['BV2', 'BV3']);
  assert.equal(result.playlists[0].title, 'Edited');
  assert.deepEqual(result.playlists[0].tracks.map((s) => s.bvid), ['BV3', 'BV1']);
  assert.deepEqual(reconcile(result, result, result), result);
  assert.equal(reconcile(base, base, library(base.likes)).playlists.length, 0);
  assert.deepEqual(reconcile(null, desktop, phone), merge(desktop, phone));
});

test('automatic server advertises only signed-in enabled accounts, isolates requests, acknowledges durable writes and reconnects', { timeout: 3000 }, async (t) => {
  let saved = library([song(1)]), failure = false, advertised, stopped = 0;
  const scopes = [];
  const service = createLanSync({ host: '127.0.0.1', deviceId: 'desktop-test',
    publish: (options) => { advertised = options; return () => { stopped++; }; },
    readLibrary: (scope) => { scopes.push(scope); return saved; },
    writeLibrary: (scope, next) => { scopes.push(scope); if (failure) throw new Error('disk full'); saved = next; },
  });
  t.after(() => service.stop());
  await service.configure('', true);
  assert.equal(advertised, undefined, 'guest data must never be advertised');
  await service.configure('123', false);
  assert.equal(advertised, undefined);
  await service.configure('123', true);
  assert.equal(advertised.txt.version, '2');
  assert.equal(advertised.txt.account, require('node:crypto').createHash('md5').update('biu-lan:123').digest('hex'));
  const request = (pathname, data, extra = {}) => fetch('http://127.0.0.1:' + advertised.port + '/v2/' + pathname, {
    method: data ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + advertised.txt.token, 'X-Biu-Account': '123', ...extra },
    ...(data ? { body: JSON.stringify({ clientId: 'phone-test', ...data }) } : {}),
  });
  assert.equal((await request('status', null, { 'X-Biu-Account': '456' })).status, 403);
  assert.equal((await request('status', null, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request('status', null, { Origin: 'https://untrusted.example' })).status, 403);
  const received = await (await request('sync', { base: null, library: library([song(2)]) })).json();
  assert.equal(service.status().lastSync, null);
  assert.equal((await request('ack', { receipt: received.receipt })).status, 200);
  assert.ok(service.status().lastSync);
  assert.deepEqual(saved.likes.map((s) => s.bvid), ['BV1', 'BV2']);
  assert.ok(scopes.every((scope) => scope === '123'));
  const deleted = await (await request('sync', { base: received.library, library: library([song(2)]) })).json();
  assert.deepEqual(deleted.library.likes.map((s) => s.bvid), ['BV2']);
  failure = true;
  assert.equal((await request('sync', { base: deleted.library, library: library([song(3)]) })).status, 400);
  assert.deepEqual(saved.likes.map((s) => s.bvid), ['BV2']);
  assert.equal((await request('sync', { padding: 'x'.repeat(8 * 1024 * 1024) })).status, 413);
  const old = { ...advertised, txt: { ...advertised.txt } };
  await service.configure('456', true);
  assert.equal((await request('status', null, { Authorization: 'Bearer ' + old.txt.token })).status, 401);
  await service.configure('456', false);
  assert.equal(service.status().active, false);
  assert.equal(stopped, 2);
  await assert.rejects(request('status'));
  await Promise.all([service.configure('123', true), service.configure('123', false)]);
  assert.equal(service.status().active, false, 'closing during startup must also settle the opening request');
});

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(file + ': starts automatically, persists toggle and applies scoped library deletions', async () => {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const legacy = file.startsWith('renderer');
    const start = source.indexOf('function renderLanSync(');
    const end = source.indexOf(legacy ? 'function initSettings(' : 'function publishSettings(', start);
    const nodes = new Map(), listeners = {}, calls = [];
    const context = vm.createContext({
      dataNs: '123', likes: [song(1)], customPlaylists: [], state: { playlist: null },
      document: { body: { dataset: { view: 'library' } } }, BiuLibrarySync: { reconcile },
      $: (id) => {
        if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} },
          setAttribute(key, value) { this[key] = value; }, getAttribute(key) { return this[key]; },
          addEventListener: (name, fn) => { listeners[id + ':' + name] = fn; } });
        return nodes.get(id);
      },
      window: { bili: {
        lanSyncConfigure: async (scope, enabled = true) => { calls.push([scope, enabled]); return { enabled, signedIn: true }; },
        onLanSyncStatus: (fn) => { listeners.status = fn; },
        onLanSyncLibrary: (fn) => { listeners.library = fn; },
      } },
      saveLikes() {}, saveCustomPlaylists() {}, refreshLikeUI() {}, renderMyPlaylists() {},
      renderFavButtons() {}, publish() {}, patchSlice() {},
    });
    vm.runInContext(source.slice(start, end), context);
    context.initLanSync();
    await Promise.resolve();
    assert.deepEqual(calls, [['123', true]]);
    if (legacy) await listeners['swLanSync:click']();
    else await context.setLanSyncEnabled(false);
    assert.deepEqual(calls.at(-1), ['123', false]);
    const incoming = library([song(2)]);
    listeners.library({ scope: '456', library: incoming, base: library([song(1)]) });
    assert.equal(context.likes[0].bvid, 'BV1');
    listeners.library({ scope: '123', library: incoming, base: library([song(1)]) });
    assert.deepEqual(Array.from(context.likes, (s) => s.bvid), ['BV2']);
  });
}

test('LAN selection ignores private TUN addresses and VPN toggles do not rotate an active sync session', async () => {
  const { lanInterfaces, advertiseNative } = require('../lan-sync');
  const { EventEmitter } = require('node:events');
  const iface = (address) => [{ address, netmask: '255.255.255.0', family: 'IPv4', internal: false }];
  const networks = { utun0: iface('10.0.0.1'), tun0: iface('198.18.0.1'), en0: iface('192.168.1.29'),
    'Clash VPN': iface('172.20.0.1'), en1: iface('192.168.2.2'), lo0: [{ ...iface('127.0.0.1')[0], internal: true }] };
  assert.deepEqual(lanInterfaces(networks).map((n) => n.address), ['192.168.1.29', '192.168.2.2']);
  let published, count = 0;
  const sync = createLanSync({ host: '127.0.0.1', interfaces: () => lanInterfaces(networks),
    readLibrary: () => library(), writeLibrary() {}, publish: (value) => { published = value; count++; return () => {}; } });
  try {
    await sync.configure('123'); const token = published.txt.token;
    networks.utun0 = iface('10.9.0.1'); networks.utun5 = iface('172.16.0.2');
    await sync.configure('123');
    assert.equal(count, 1); assert.equal(published.txt.token, token);
    networks.en0 = iface('192.168.5.2'); await sync.configure('123');
    assert.equal(count, 2); assert.notEqual(published.txt.token, token);
    assert.equal(published.txt.addresses, '192.168.5.2,192.168.2.2');
  } finally { sync.stop(); }
  let args, killed = 0, errors = 0;
  const child = new EventEmitter(); child.kill = () => { killed++; child.emit('exit', 0); };
  const stop = advertiseNative(published, () => errors++, (command, argv, options) => {
    assert.equal(command, '/usr/bin/dns-sd'); assert.equal(options.stdio[1], 'ignore'); args = argv; return child;
  });
  assert.deepEqual(args.slice(0, 4), ['-R', published.name, '_biu-sync._tcp', 'local.']);
  assert.ok(args.includes('addresses=192.168.5.2,192.168.2.2'));
  stop(); stop(); assert.equal(killed, 1); assert.equal(errors, 0);
});
