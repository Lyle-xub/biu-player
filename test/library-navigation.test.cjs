const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const track = (id) => ({ bvid: id, title: id, up: '测试音乐' });

function harness(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const slice = (from, to) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const nodes = new Map();
  const animationCompletions = [];
  const node = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        animate() {
          metrics.transitions++;
          return { cancel() { metrics.skipped++; }, finished: { then(fn) { animationCompletions.push(fn); return { catch() {} }; } } };
        },
        scrollTop: 0, style: {}, textContent: '', innerHTML: '', setAttribute() {},
        classList: {
          add: (c) => classes.add(c), remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c), toggle() {},
        },
        querySelector: () => node(id + '-cover'),
      });
    }
    return nodes.get(id);
  };
  const metrics = { my: 0, rec: 0, ranking: 0, feed: 0, transitions: 0, skipped: 0 };
  const api = {
    hasBridge: true,
    ranking: async () => { metrics.ranking++; return [track('rank')]; },
    recommendMusic: async () => { metrics.feed++; return [track('first')]; },
  };
  const clock = { now: 100000 };
  const body = { dataset: { view: 'library' }, classList: { toggle() {} } };
  const context = vm.createContext({
    $, api, settings: { recommendMode: 'music' }, state: { recommendations: [], ranking: [], recommendFreshIdx: 0 },
    playHistory: [], console: { error() {} }, URL,
    location: { href: 'http://localhost/' }, history: { replaceState() {} },
    window: { scrollTo() {}, matchMedia: () => ({ matches: false }), BiuRecommendation: require('../renderer/recommendation-profile') },
    recommendationProfiles: { isStrict: async () => false, recommend: async () => [], observeFeed() {} },
    document: {
      body,
      querySelector: node,
      querySelectorAll: (q) => q === '.view' ? [node('.view-library'), node('.view-playlist')] : [],
    },
    Date: class extends Date { static now() { return clock.now; } },
    matchMedia: () => ({ matches: false }), setTimeout() {},
    setVideoTheater() {}, setLiveTheater() {}, setVideoMode() {}, closePanel() {},
    refreshLikeUI() {}, refreshMusicLibraryUI() {}, renderMyPlaylists: () => { metrics.my++; },
    setShelfCover() {}, toast() {}, esc: (value) => String(value),
    publish() {}, renderRec: () => { metrics.rec++; },
  });
  function $(id) { return node(id); }
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/player-sheet-motion.js'), 'utf8'), context);
  vm.runInContext(
    slice('const VIEW_ORDER =', 'function setModeSelection(') + '\n' +
    slice('let libraryLoadToken =', '/* ---------- 收藏夹 ---------- */') + '\n' +
    'renderRecommendationCards = renderRec;', context);
  return { context, metrics, api, clock, node, body, animationCompletions };
}

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(`${file}: selected recommendation scope applies to initial and subsequent platform pages`, async () => {
    const h = harness(file), modes = [];
    h.api.recommendMusic = async (_page, _limit, mode) => { modes.push(mode); return [track('BV' + modes.length)]; };
    h.context.settings.recommendMode = 'all';
    await h.context.loadLibrary();
    await h.context.loadMoreRecommendations();
    h.context.settings.recommendMode = 'music';
    await h.context.loadLibrary({ force: true });
    assert.deepEqual(modes, ['all', 'all', 'music']);
    assert.deepEqual(Array.from(h.context.state.recommendations, (t) => t.bvid), ['BV3']);
  });

  test(`${file}: strict custom pages stream without rebuilding cards and ignore stale callbacks`, async () => {
    const h = harness(file), started = deferred(), remaining = deferred();
    let publish;
    h.context.recommendationProfiles.isStrict = async () => true;
    h.context.recommendationProfiles.recommend = async (_page, _exclude, onBatch) => {
      publish = onBatch;
      onBatch([track('BVfirst')]); started.resolve();
      await remaining.promise;
      onBatch([track('BVsecond')]);
      return [track('BVfirst'), track('BVsecond')];
    };
    const pending = h.context.loadLibrary();
    await started.promise;
    assert.deepEqual(Array.from(h.context.state.recommendations, (t) => t.bvid), ['BVfirst']);
    h.node('.view-library').scrollTop = 300;
    remaining.resolve(); await pending;
    assert.deepEqual(Array.from(h.context.state.recommendations, (t) => t.bvid), ['BVfirst', 'BVsecond']);
    assert.equal(h.metrics.rec, 2, 'final completion must not rebuild already streamed cards');
    assert.equal(h.node('.view-library').scrollTop, 300);
    const oldPublish = publish;
    h.context.recommendationProfiles.recommend = async () => [track('BVnewProfile')];
    await h.context.loadLibrary({ force: true });
    oldPublish([track('BVstale')]);
    assert.deepEqual(Array.from(h.context.state.recommendations, (t) => t.bvid), ['BVnewProfile']);
  });

  test(`${file}: strict custom profiles never display platform or ranking fallback, including empty pages`, async () => {
    const h = harness(file), gate = deferred();
    h.context.recommendationProfiles.isStrict = () => gate.promise;
    h.context.recommendationProfiles.recommend = async () => [track('BVmatching')];
    const loading = h.context.loadLibrary();
    assert.equal(h.metrics.feed, 0); assert.equal(h.metrics.ranking, 0);
    gate.resolve(true); await loading;
    assert.deepEqual(Array.from(h.context.state.recommendations, (t) => t.bvid), ['BVmatching']);
    h.context.recommendationProfiles.recommend = async () => [];
    await h.context.loadMoreRecommendations();
    assert.equal(h.context.state.recommendations.length, 1);
    await h.context.loadLibrary({ force: true });
    assert.equal(h.context.state.recommendations.length, 0);
    assert.match(h.node('recLoader').textContent, /继续查找/);
    assert.equal(h.metrics.feed, 0); assert.equal(h.metrics.ranking, 0);
    h.context.recommendationProfiles.recommend = async () => { throw new Error('推荐请求暂时被 B 站限制'); };
    await h.context.loadLibrary({ force: true });
    assert.match(h.node('grid-rec').innerHTML, /B 站限制/);
    h.context.recommendationProfiles.recommend = async () => [];
    h.context.recommendationProfiles.isStrict = async () => false;
    await h.context.loadLibrary({ force: true });
    assert.equal(h.metrics.feed, 1);
  });
  test(`${file}: returning after 60 seconds keeps local cards and appended recommendations`, async () => {
    const h = harness(file);
    await h.context.loadLibrary();
    h.api.recommendMusic = async () => { h.metrics.feed++; return [track('second')]; };
    await h.context.loadMoreRecommendations();
    const retained = h.context.state.recommendations;
    const before = { ...h.metrics };
    h.clock.now += 3600000;
    for (const view of ['playlist', 'fav', 'radio', 'search', 'up', 'playing']) {
      h.body.dataset.view = view;
      h.context.go('library');
      await h.context.loadLibrary();
    }
    assert.equal(h.context.state.recommendations, retained);
    assert.equal(retained.length, 2);
    for (const key of ['my', 'rec', 'ranking', 'feed']) assert.equal(h.metrics[key], before[key]);
  });

  test(`${file}: repeated navigation shares the pending initial request`, async () => {
    const h = harness(file);
    const wait = deferred();
    h.api.recommendMusic = () => { h.metrics.feed++; return wait.promise; };
    const first = h.context.loadLibrary();
    const again = h.context.loadLibrary();
    await new Promise(setImmediate);
    assert.equal(h.metrics.my, 1);
    assert.equal(h.metrics.feed, 1);
    wait.resolve([track('first')]);
    await Promise.all([first, again]);
    assert.equal(h.metrics.rec, 2);
  });

  test(`${file}: network retries do not rebuild the local playlist grid`, async () => {
    const h = harness(file);
    h.api.ranking = h.api.recommendMusic = async () => { throw new Error('offline'); };
    await h.context.loadLibrary();
    await h.context.loadLibrary();
    assert.equal(h.metrics.my, 1);
    h.api.recommendMusic = async () => [track('recovered')];
    await h.context.loadLibrary();
    assert.equal(h.context.state.recommendations[0].bvid, 'recovered');
    assert.equal(h.metrics.my, 1);
  });

  test(`${file}: switching account invalidates cached and pending recommendations`, async () => {
    const h = harness(file);
    await h.context.loadLibrary();
    const old = deferred();
    h.api.recommendMusic = () => old.promise;
    const previousAccount = h.context.loadMoreRecommendations();
    await new Promise(setImmediate);
    const current = deferred();
    h.api.recommendMusic = () => current.promise;
    const newAccount = h.context.loadLibrary({ force: true });
    old.reject(new Error('old account request failed'));
    await previousAccount;
    assert.equal(h.node('recLoader').textContent, '正在准备推荐流…');
    current.resolve([track('new-account')]);
    await newAccount;
    assert.deepEqual(Array.from(h.context.state.recommendations, (t) => t.bvid), ['new-account']);
    assert.equal(h.metrics.my, 2);
  });

  test(`${file}: a superseded initial load cannot overwrite the new account`, async () => {
    const h = harness(file);
    const old = deferred();
    h.api.recommendMusic = () => old.promise;
    const first = h.context.loadLibrary();
    await new Promise(setImmediate);
    h.api.recommendMusic = async () => [track('new-account')];
    await h.context.loadLibrary({ force: true });
    old.resolve([track('old-account')]);
    await first;
    assert.equal(h.context.state.recommendations[0].bvid, 'new-account');
    assert.equal(h.metrics.rec, 2);
  });

  test(`${file}: returning preserves homepage scroll and skips loading-style transitions`, () => {
    const h = harness(file);
    const library = h.node('.view-library');
    library.scrollTop = 742;
    h.context.go('playlist');
    // 模拟隐藏视图不再保有可读 scrollTop；返回时必须用离开前记录的值。
    library.scrollTop = 0;
    h.context.go('library');
    assert.equal(library.scrollTop, 742);
    assert.equal(h.metrics.transitions, 2); // 两次真实 DOM 过渡都立即提交目标页。
    assert.equal(h.metrics.skipped, 1);
    assert.equal(library.classList.contains('view-entering'), false);
    h.context.go('library');
    assert.equal(library.scrollTop, 742);
  });

  test(`${file}: an interrupted transition cannot navigate away again after returning`, () => {
    const h = harness(file);
    h.node('.view-library').scrollTop = 600;
    h.context.go('playlist');
    h.context.go('library');
    h.animationCompletions[0](); // 旧动画稍后完成也不能重新提交页面。
    assert.equal(h.body.dataset.view, 'library');
    assert.equal(h.node('.view-library').scrollTop, 600);
  });

  test(`${file}: changing likes updates the local card without reloading recommendations`, async () => {
    const h = harness(file);
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf('function toggleLike(');
    const end = source.indexOf('// 收藏数变化后刷新相关 UI', start);
    vm.runInContext(`
      let likes = [];
      const trackKey = (t) => t.bvid;
      const trackCopy = (t) => ({ ...t });
      const isLiked = (t) => likes.some((l) => l.bvid === t.bvid);
      const saveLikes = () => {};
      const toast = () => {};
      ${source.slice(start, end)}
    `, h.context);
    await h.context.loadLibrary();
    h.context.toggleLike(track('liked'));
    assert.equal(vm.runInContext('likes.length', h.context), 1);
    assert.equal(h.metrics.my, 2);
    h.context.toggleLike(track('liked'));
    assert.equal(vm.runInContext('likes.length', h.context), 0);
    assert.equal(h.metrics.my, 3);
    await h.context.loadLibrary();
    assert.equal(h.metrics.my, 3);
    assert.equal(h.metrics.feed, 1);
  });
}
