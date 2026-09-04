const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../renderer/recommendation-profile');

test('custom recommendations publish completed pages before slow pages and retain stable partial results', async () => {
  const releases = new Map(), batches = [];
  let complete = false;
  const profile = R.normalize({ profiles: [{ id: 'stream', name: '钢琴', tags: ['钢琴'] }], activeId: 'stream' });
  const manager = R.createManager({ read: async () => profile, write: async () => {}, getLikes: () => [],
    get: (url) => new Promise((resolve) => releases.set(Number(new URL(url).searchParams.get('page')), resolve)),
  });
  const response = (ids) => ({ status: 200, body: JSON.stringify({ code: 0, data: { result: ids.map((id) => ({
    type: 'video', bvid: id, title: '钢琴', tag: '钢琴', typeid: '3', duration: '2:00',
  })) } }) });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const pending = manager.recommend({ onBatch: (batch) => batches.push(batch.map((t) => t.bvid)) })
    .then((result) => { complete = true; return result; });
  await flush();
  releases.get(2)(response(['BVsecond', 'BVduplicate'])); await flush();
  assert.equal(complete, false);
  assert.deepEqual(batches, [['BVsecond', 'BVduplicate']], 'page 2 can display while pages 1 and 3 are pending');
  releases.get(1)(response(['BVfirst', 'BVduplicate']));
  await flush();
  assert.deepEqual(batches, [['BVsecond', 'BVduplicate'], ['BVfirst']]);
  assert.equal(complete, false);
  releases.get(3)({ status: 412, body: '' });
  const result = await pending;
  assert.deepEqual(result.map((t) => t.bvid), batches.flat(), 'late failures preserve the displayed order and results');
});

test('custom feed uses search metadata without per-video requests and retries failed pages', async () => {
  const profile = R.normalize({ profiles: [{ id: 'search', name: '自定义', tags: ['cos'] }], activeId: 'search' });
  const calls = [];
  let blocked = true;
  const manager = R.createManager({ read: async () => profile, write: async () => {}, getLikes: () => [],
    get: async (url) => {
      calls.push(url);
      assert.ok(url.includes('/search/'), 'complete search metadata must not trigger view/tag requests');
      if (blocked) return { status: 412, body: '' };
      const page = new URL(url).searchParams.get('page');
      const item = (id, extra = {}) => ({ type: 'video', bvid: `BVmetadata${page}_${id}`, id: Number(page),
        title: '演出', author: 'UP', mid: id, pic: '//example.com/cover.jpg',
        typeid: '3', duration: '01:20', tag: '表演,cos', ...extra });
      return { status: 200, body: JSON.stringify({ code: 0, data: { result: [
        item(1), item(2, { title: '<em class="keyword">COS</em> 舞台', tag: '舞蹈', duration: '1:02:03' }),
        item(3, { tag: '游戏' }), item(4, { duration: '0:20' }), item(5, { typeid: '1' }),
      ] } }) };
    },
  });
  await assert.rejects(manager.recommend({ mode: 'all' }), /B 站限制/);
  blocked = false;
  calls.length = 0;
  const first = await manager.recommend({ mode: 'all' });
  assert.deepEqual(calls.map((url) => Number(new URL(url).searchParams.get('page'))), [1, 2, 3]);
  assert.equal(first.length, 12);
  assert.ok(first.some((t) => t.duration === 20), 'custom all-category discovery keeps matching short videos');
  assert.ok(first.every((t) => t.recommendationReason === '画像 · cos'));
  assert.equal(first.find((t) => t.bvid.endsWith('_2')).duration, 3723);
  assert.equal(first.find((t) => t.bvid.endsWith('_2')).title, 'COS 舞台');
  assert.ok(first.every((t) => t.pic === 'https://example.com/cover.jpg'));
  calls.length = 0;
  const more = await manager.recommend({ mode: 'all' });
  assert.deepEqual(calls.map((url) => Number(new URL(url).searchParams.get('page'))), [4, 5, 6]);
  assert.equal(new Set([...first, ...more].map((t) => t.bvid)).size, 24);
  const music = await manager.recommend({ mode: 'music' });
  assert.equal(music.length, 9);
  assert.ok(music.every((t) => t.tid === 3));
});

test('custom recommendations fetch three search pages and refresh advances without repeats or relaxed filtering', async () => {
  const searches = [], profile = R.normalize({ profiles: [{ id: 'batch', name: '钢琴', tags: ['钢琴'] }], activeId: 'batch' });
  let activeSearches = 0, peakSearches = 0;
  const manager = R.createManager({ read: async () => profile, write: async () => {}, getLikes: () => [],
    get: async (url) => {
      const query = new URL(url).searchParams;
      let data;
      if (url.includes('/search/')) {
        const page = Number(query.get('page')); searches.push(page);
        peakSearches = Math.max(peakSearches, ++activeSearches);
        await new Promise((resolve) => setImmediate(resolve));
        activeSearches--;
        if (page === 3) throw new Error('one failed page');
        data = { result: Array.from({ length: 20 }, (_, i) => ({ type: 'video', bvid: i === 0 ? 'BVbatchRepeat' : `BVbatch${page}_${i}` })) };
      } else {
        const id = query.get('bvid');
        data = url.includes('/tags?') ? [{ tag_name: id.endsWith('_18') ? '游戏' : '钢琴' }]
          : { bvid: id, cid: 1, tid: id.endsWith('_17') ? 1 : 3, duration: id.endsWith('_19') ? 10 : 120,
            title: '演奏', owner: { mid: id, name: 'UP' } };
      }
      return { status: 200, body: JSON.stringify({ code: 0, data }) };
    },
  });
  const first = await manager.recommend({ page: 0, mode: 'music' });
  assert.deepEqual(searches, [1, 2, 3]);
  assert.equal(peakSearches, 3);
  assert.equal(first.length, 35, 'one refresh can return substantially more than eight matches');
  assert.ok(first.some((t) => Number(t.bvid.split('_')[1]) > 8), 'candidates beyond the old per-page cutoff are checked');
  const second = await manager.recommend({ page: 0, mode: 'music' });
  assert.deepEqual(searches.slice(3), [4, 5, 6]);
  assert.equal(second.length, 48);
  assert.equal(new Set([...first, ...second].map((t) => t.bvid)).size, 83);
  assert.ok([...first, ...second].every((t) => t.tid === 3 && t.tags.some((tag) => tag.name === '钢琴')));
});

test('recent profile learns from likes and playlists while feed exposure only populates candidates', async () => {
  const liked = { bvid: 'BVsourceLiked', mid: 1 };
  const listed = { bvid: 'BVsourceList', mid: 2 };
  const fed = { bvid: 'BVsourceFeed', mid: 3 };
  const samples = R.recentSamples([liked, { ...liked, isSegment: true }], [{ tracks: [liked, listed] }], [liked, listed, fed]);
  assert.deepEqual(samples.map((s) => s.source), ['likes', 'playlists', 'feed']);
  const labels = { BVsourceLiked: '钢琴', BVsourceList: '古典', BVsourceFeed: '摇滚' };
  const manager = R.createManager({ read: async () => null, write: async () => {},
    getLikes: () => [liked], getPlaylists: async () => [{ tracks: [liked, listed] }],
    get: async (url) => ({ status: 200, body: JSON.stringify({ code: 0, data: [{ tag_name: labels[new URL(url).searchParams.get('bvid')] }] }) }),
  });
  manager.observeFeed([fed, fed]); await manager.refresh();
  const auto = manager.getSnapshot().auto;
  assert.deepEqual(auto.sources, { likes: 1, playlists: 1, listens: 0, feed: 0 });
  assert.equal(auto.samples, 2);
  const weights = Object.fromEntries(auto.tags.map((t) => [t.name, t.weight]));
  assert.ok(weights['钢琴'] > weights['古典']);
  assert.equal(weights['摇滚'], undefined);
  assert.equal(manager.getSnapshot().daily.candidates.length, 1);
  const many = Array.from({ length: 40 }, (_, i) => ({ bvid: 'BVliked' + i }));
  const bounded = R.recentSamples(many, [{ tracks: [listed] }], [fed]);
  assert.equal(bounded.length, 42, 'all unique source videos remain eligible for learning');
  assert.ok(bounded.some((s) => s.source === 'playlists') && bounded.some((s) => s.source === 'feed'));
  await manager.edit({ type: 'save', name: '严格', tags: ['钢琴'] });
  assert.equal(R.isStrict(manager.getSnapshot()), true);
  await manager.edit({ type: 'select', id: 'auto' });
  assert.equal(R.isStrict(manager.getSnapshot()), false);
});

test('desktop profile bridge refreshes the active manager and ignores another account', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  let receive, refreshes = 0, mode = 'music', searchUrl;
  const disk = new Map(), local = new Map();
  const window = { BiuRecommendation: R, bili: {
    storeGet: async (key) => disk.get(key), storeSet: async (key, value) => disk.set(key, value),
    onLanSyncLibrary: (fn) => { receive = fn; },
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/recommendation-desktop'), 'utf8'), {
    window, console, localStorage: { getItem: (key) => local.get(key), setItem: (key, value) => local.set(key, value) },
  });
  const desktop = window.BiuRecommendationDesktop({ getScope: () => '123', getLikes: () => [], getMode: () => mode,
    onRefresh: () => refreshes++ });
  const before = await desktop.manager().exportSync();
  const incoming = R.normalize({ profiles: [{ id: 'phone', name: '学习', tags: ['钢琴'] }], activeId: 'phone' });
  await receive({ scope: '456', library: { recommendation: incoming }, base: { recommendation: before } });
  assert.equal(disk.size, 0);
  await receive({ scope: '123', library: { recommendation: incoming }, base: { recommendation: before } });
  assert.equal(desktop.manager().getSnapshot().activeId, 'phone');
  assert.deepEqual(disk.get('biu-recommendation-profiles@123'), incoming);
  assert.equal(refreshes, 1);
  const learned = structuredClone(incoming);
  learned.auto.updatedAt = 100;
  learned.auto.tags = [{ name: '古典', weight: 100 }];
  await receive({ scope: '123', library: { recommendation: learned }, base: { recommendation: incoming } });
  assert.equal(refreshes, 1, 'background sync must not call the desktop full-page refresh');
  assert.equal(desktop.manager().getSnapshot().auto.updatedAt, 100, 'the updated profile still reaches settings and storage');
  window.bili.get = async (url) => { searchUrl = url; return { status: 412, body: '' }; };
  await assert.rejects(desktop.recommend(0), /B 站限制/, 'desktop must not disguise a rejected custom search as an empty page');
  assert.equal(new URL(searchUrl).searchParams.get('tids'), '3');
  mode = 'all';
  await assert.rejects(desktop.recommend(0), /B 站限制/);
  assert.equal(new URL(searchUrl).searchParams.has('tids'), false, 'custom searches honor the desktop scope selector');
});

test('profile sync preserves feed revision during learning, but updates it when the active filter changes', async () => {
  let disk = R.normalize(null);
  const manager = R.createManager({ read: async () => disk, write: async (value) => { disk = value; }, getLikes: () => [] });
  await manager.ready();
  for (let i = 1; i <= 3; i++) {
    const before = await manager.exportSync(), incoming = structuredClone(before);
    incoming.auto.updatedAt = i;
    incoming.auto.tags = [{ name: '钢琴', weight: i * 20 }];
    incoming.auto.fingerprint = 'feed:' + i;
    await manager.applySync(incoming, before);
    assert.equal(manager.getSnapshot().revision, 0, 'the mobile HomeScreen revision dependency stays stable during browsing');
    assert.equal(disk.auto.tags[0].weight, i * 20);
  }
  await manager.edit({ type: 'save', name: '自定义', tags: ['钢琴'] });
  const id = manager.getSnapshot().activeId;
  assert.equal(manager.getSnapshot().revision, 1);
  await manager.edit({ type: 'save', id, name: '重命名', tags: ['钢琴'] });
  assert.equal(manager.getSnapshot().revision, 1, 'renaming does not change the active filter');
  await manager.refresh(true);
  assert.equal(manager.getSnapshot().revision, 1, 'updating inactive automatic profile must not replace the custom feed');
  const before = await manager.exportSync(), changed = structuredClone(before);
  changed.profiles[0].tags = [{ name: '摇滚', weight: 90 }];
  await manager.applySync(changed, before);
  assert.equal(manager.getSnapshot().revision, 2, 'a changed custom filter must clear results that no longer match');
  await manager.edit({ type: 'select', id: 'auto' });
  assert.equal(manager.getSnapshot().revision, 3);
  await manager.refresh(true);
  assert.equal(manager.getSnapshot().revision, 4, 'an explicit update of the active automatic profile still refreshes');
});

test('profile sync merges copies, propagates edits/deletions and retains edits made during an exchange', async () => {
  const { normalize, reconcile } = require('../renderer/library-sync');
  const wrap = (recommendation) => ({ version: 1, likes: [], playlists: [], recommendation });
  const p = (id, name = id) => ({ id, name, tags: [{ name: '钢琴', weight: 80 }] });
  const desktop = R.normalize({ profiles: [p('d')], activeId: 'd' });
  const mobile = R.normalize({ profiles: [p('m')], activeId: 'm', auto: { tags: ['摇滚'], updatedAt: 20 } });
  const merged = reconcile(null, wrap(desktop), wrap(mobile));
  assert.deepEqual(merged.recommendation.profiles.map((p) => p.id), ['d', 'm']);
  assert.equal(merged.recommendation.auto.updatedAt, 20);
  assert.deepEqual(reconcile(merged, merged, merged), merged);
  assert.deepEqual(reconcile(merged, merged, wrap(undefined)), merged, 'old peers cannot erase profiles');
  const left = structuredClone(merged), right = structuredClone(merged);
  left.recommendation.profiles[0].name = '学习';
  right.recommendation.profiles[0].tags[0].weight = 50;
  right.recommendation.profiles.pop();
  right.recommendation.enabled = false;
  const next = reconcile(merged, left, right).recommendation;
  assert.deepEqual(next.profiles, [p('d', '学习')].map((p) => ({ ...p, tags: [{ name: '钢琴', weight: 50 }] })));
  assert.equal(next.enabled, false);
  assert.equal(next.activeId, 'd');
  const secret = structuredClone(next); secret.cookie = 'secret'; secret.profiles[0].token = 'secret';
  assert.doesNotMatch(JSON.stringify(normalize(wrap(secret))), /secret/);
  assert.throws(() => normalize(wrap({ ...secret, profiles: Array(21).fill(p('x')) })), /数量/);
  const many = R.normalize({ profiles: Array.from({ length: 20 }, (_, i) => p('p' + i)) });
  assert.throws(() => reconcile(null, wrap(many), wrap(mobile)), /20/);
  let saved = merged.recommendation, fail = false;
  const manager = R.createManager({ read: async () => saved, write: async (v) => { if (fail) throw new Error('disk'); saved = v; }, getLikes: () => [] });
  await manager.ready();
  await Promise.all([
    manager.edit({ type: 'save', id: 'd', name: '本地新编辑', tags: [{ name: '钢琴', weight: 80 }] }),
    manager.applySync(next, merged.recommendation),
  ]);
  assert.equal(saved.profiles[0].name, '本地新编辑');
  assert.equal(saved.profiles[0].tags[0].weight, 50);
  const before = await manager.exportSync(); fail = true;
  await assert.rejects(manager.applySync(mobile, before), /disk/);
  assert.deepEqual(await manager.exportSync(), before);
});

test('profile weights respect recency, remove generic tags, deduplicate videos and diversify recommendations', () => {
  const samples = [
    { track: { bvid: 'BVone', mid: 1 }, index: 0, tags: ['音乐', '钢琴', '钢琴'] },
    { track: { bvid: 'BVtwo', mid: 2 }, index: 16, tags: ['音乐', '摇滚'] },
  ];
  const inferred = R.infer(samples);
  assert.deepEqual(inferred.map((tag) => tag.name), ['钢琴', '摇滚']);
  assert.ok(inferred[0].weight > inferred[1].weight);
  assert.equal(R.recentLikes([{ bvid: 'BVone' }, { bvid: 'BVone', isSegment: true }, { isLive: true, bvid: 'live' }]).length, 1);
  assert.deepEqual(R.parseTagsText('钢琴:80\n摇滚'), [{ name: '钢琴', weight: 80 }, { name: '摇滚', weight: 50 }]);
  assert.throws(() => R.parseTagsText('钢琴:300'));
  const profile = { tags: [{ name: '钢琴', weight: 100 }, { name: '摇滚', weight: 50 }] };
  const queries = Array.from({ length: 5 }, (_, page) => R.queries(profile, page)).flat();
  const twoTags = { tags: ['钢琴', '古典'] };
  assert.deepEqual([0, 1].flatMap((page) => R.queries(twoTags, page, 3).map((q) => [q.name, q.page])),
    [['钢琴', 1], ['古典', 1], ['钢琴', 2], ['古典', 2], ['钢琴', 3], ['古典', 3]]);
  assert.ok(queries.filter((q) => q.name === '钢琴').length > queries.filter((q) => q.name === '摇滚').length);
  assert.equal(new Set(queries.map((q) => `${q.name}:${q.page}`)).size, queries.length);
  assert.deepEqual(R.rank([
    { bvid: 'BVliked', mid: 1, tags: ['钢琴'] },
    { bvid: 'BVa', mid: 1, tags: ['钢琴'] },
    { bvid: 'BVb', mid: 1, tags: ['钢琴'] },
    { bvid: 'BVc', mid: 2, tags: ['钢琴'] },
    { bvid: 'BVunrelated', mid: 3, tags: ['游戏'] },
  ], profile, ['BVliked']).map((t) => t.bvid), ['BVa', 'BVc', 'BVb']);
});

test('shared profile blending caps insertions at 20%, randomizes picks and slots, and preserves discovery order', () => {
  const base = Array.from({ length: 24 }, (_, i) => ({ bvid: `base-${i}` }));
  const suggested = Array.from({ length: 18 }, (_, i) => ({ bvid: `profile-${i}` }));
  const ids = (items) => items.map((t) => t.bvid);
  const isProfile = (t) => t.bvid.startsWith('profile-');
  const blend = (random) => R.blend([...base, base[0]], [base[0], ...suggested, suggested[0]], random);
  const first = blend(() => 0), second = blend(() => 0.999);
  for (const result of [first, second]) {
    assert.equal(result.filter(isProfile).length, 6);
    assert.equal(result.length, 30);
    assert.equal(new Set(ids(result)).size, result.length);
    assert.deepEqual(ids(result.filter((t) => !isProfile(t))), ids(base));
    assert.equal(result[0], base[0]);
  }
  assert.notDeepEqual(ids(first.filter(isProfile)), ids(second.filter(isProfile)), 'selected profile videos vary');
  const positions = (items) => items.flatMap((t, i) => isProfile(t) ? [i] : []);
  assert.notDeepEqual(positions(first), positions(second), 'insertion positions vary');
  assert.ok(positions(second)[0] >= 19, 'all insertion slots can fall near the end; no early segment is forced');
  assert.deepEqual(R.blend(base, []), base);
  assert.deepEqual(R.blend([], suggested), []);
  for (const length of [2, 4, 5, 12, 23]) {
    const result = R.blend(base.slice(0, length), suggested);
    assert.equal(result.filter(isProfile).length, Math.floor(length / 4));
  }
  assert.equal(R.blend(base, suggested.slice(0, 2)).filter(isProfile).length, 2);
  assert.deepEqual(ids(base), Array.from({ length: 24 }, (_, i) => `base-${i}`));
  assert.deepEqual(ids(suggested), Array.from({ length: 18 }, (_, i) => `profile-${i}`));
});

test('account managers save multiple profiles, reload selection, preserve failed writes and only recommend verified matching music', async () => {
  const disk = new Map(), calls = [];
  let failWrite = false;
  const get = async (url) => {
    calls.push(url);
    const id = new URL(url).searchParams.get('bvid');
    const data = url.includes('/tags?') ? [{ tag_name: id === 'BVgame' ? '钢琴' : '钢琴' }]
      : url.includes('/search/') ? { result: [{ type: 'video', bvid: 'BVmusic' }, { type: 'video', bvid: 'BVgame' }, { type: 'video', bvid: 'BVliked' }] }
        : { bvid: id, aid: 1, cid: 10, tid: id === 'BVgame' ? 1 : 3, title: '演奏', duration: 120, owner: { mid: 2, name: 'UP' }, pic: '//cover' };
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  };
  const create = (scope) => R.createManager({ get, getLikes: () => [{ bvid: 'BVliked', mid: 1 }],
    read: async () => disk.get(scope), write: async (value) => { if (failWrite) throw new Error('disk full'); disk.set(scope, value); } });
  const a = create('A'); await a.ready(); await a.refresh();
  assert.equal(a.getSnapshot().auto.samples, 1);
  assert.deepEqual(a.getSnapshot().auto.tags, [{ name: '钢琴', weight: 100 }]);
  const before = calls.length; await a.refresh(); assert.equal(calls.length, before, 'unchanged likes reuse the saved profile');
  await Promise.all([
    a.edit({ type: 'save', name: '学习', tags: [{ name: '钢琴', weight: 80 }] }),
    a.edit({ type: 'save', name: '运动', tags: [{ name: '摇滚', weight: 70 }] }),
  ]);
  assert.equal(a.getSnapshot().profiles.length, 2, 'concurrent saves are serialized');
  const first = a.getSnapshot().profiles[0];
  await a.edit({ type: 'select', id: first.id });
  const reopened = create('A'); await reopened.ready();
  assert.equal(reopened.getSnapshot().activeId, first.id);
  const b = create('B'); await b.ready(); assert.equal(b.getSnapshot().profiles.length, 0);
  const music = await reopened.recommend({ mode: 'music' });
  assert.deepEqual(music.map((t) => t.bvid), ['BVmusic']);
  assert.match(music[0].recommendationReason, /钢琴/);
  assert.deepEqual((await reopened.recommend({ mode: 'all', exclude: ['BVmusic'] })).map((t) => t.bvid), ['BVgame']);
  failWrite = true;
  await assert.rejects(a.edit({ type: 'delete', id: first.id }));
  assert.equal(a.getSnapshot().profiles.length, 2);
  failWrite = false;
  await a.edit({ type: 'delete', id: first.id });
  assert.equal(a.getSnapshot().activeId, 'auto');
  await a.edit({ type: 'enable', enabled: false });
  const count = calls.length;
  assert.deepEqual(await a.recommend({}), []); assert.equal(calls.length, count);
});

test('automatic learning accumulates beyond 24, drains pending work and survives restart without counting repeats', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let disk, calls = 0, likes = Array.from({ length: 36 }, (_, i) => ({ bvid: `BVaccumulate${i}`, mid: i }));
  const options = { read: async () => disk, write: async (value) => { disk = value; }, getLikes: () => likes,
    get: async () => { calls++; return { status: 200, body: JSON.stringify({ code: 0, data: [{ tag_name: '钢琴' }] }) }; } };
  let manager = R.createManager(options);
  try {
    await manager.refresh();
    assert.equal(disk.auto.samples, 12); assert.equal(disk.auto.pending, 24);
    for (let i = 0; i < 2; i++) {
      t.mock.timers.tick(4000); await new Promise(setImmediate);
    }
    assert.equal(disk.auto.samples, 36); assert.equal(disk.auto.sources.likes, 36);
    assert.equal(disk.auto.pending, 0); assert.equal(calls, 36);
    assert.equal(manager.getSnapshot().revision, 0, 'background accumulation cannot reset the visible feed');
    manager.dispose(); likes = [];
    manager = R.createManager(options); await manager.ready();
    assert.equal(manager.getSnapshot().auto.samples, 36);
    const track = { bvid: 'BVaccumulateNew', mid: 99 };
    manager.observeFeed([track, track]); await manager.refresh();
    assert.equal(disk.auto.samples, 36); assert.equal(disk.auto.sources.feed, 0);
    assert.equal(calls, 36);
    likes = [track, { ...track, isSegment: true }];
    await manager.refresh();
    assert.equal(disk.auto.samples, 37, 'liking an observed video upgrades its source rather than adding another sample');
    assert.equal(disk.auto.sources.likes, 37); assert.equal(disk.auto.sources.feed, 0);
    assert.equal(calls, 37, 'saved tags must not be fetched again after restart or source promotion');
    const remote = structuredClone(disk);
    remote.auto.evidence.push({ bvid: 'BVaccumulateOtherDevice', source: 'playlists', owner: 'peer', at: Date.now(), tags: ['爵士'] });
    const merged = R.reconcile(undefined, disk, remote);
    assert.equal(merged.auto.samples, 38);
    assert.deepEqual(R.reconcile(undefined, remote, disk).auto, merged.auto, 'device merge is order independent');
    assert.deepEqual(R.reconcile(merged, merged, merged), merged, 'repeated sync cannot inflate learned counts');
  } finally { manager.dispose(); }
});

test('failed cumulative analysis persists pending videos and keeps previous knowledge', async () => {
  let disk, blocked = false, likes = [{ bvid: 'BVkeepKnowledge', mid: 1 }];
  const manager = R.createManager({ read: async () => disk, write: async (value) => { disk = value; }, getLikes: () => likes,
    get: async () => ({ status: blocked ? 412 : 200, body: JSON.stringify({ code: 0, data: [{ tag_name: '古典' }] }) }) });
  try {
    await manager.refresh();
    blocked = true; likes = [{ bvid: 'BVpendingKnowledge', mid: 2 }];
    await manager.refresh();
    assert.equal(disk.auto.samples, 1); assert.equal(disk.auto.pending, 1);
    assert.equal(disk.auto.tags[0].name, '古典');
    assert.match(manager.getSnapshot().error, /保留/);
    blocked = false; await manager.refresh(true);
    assert.equal(disk.auto.samples, 2); assert.equal(disk.auto.pending, 0);
  } finally { manager.dispose(); }
});
