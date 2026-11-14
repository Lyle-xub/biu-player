const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const extract = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return source.slice(a, b);
  };
  const calls = { dom: 0, words: 0, scrolls: [], desk: [], frames: [], analyser: 0, bars: 0 };
  const classes = new Set();
  const document = { hidden: false, body: { dataset: { view: 'library' } } };
  const media = { currentTime: 2, paused: false, ended: false };
  const lines = Array.from({ length: 3 }, () => ({ classList: { toggle() {} } }));
  const events = {}, rafs = [], timers = new Map();
  let tid = 0;
  const view = {
    scrollTop: 100, clientHeight: 600, scrollHeight: 5000,
    classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    addEventListener: (event, cb) => { events[event] = cb; },
  };
  document.querySelector = () => view;
  const ctx = vm.createContext({
    document, state: { current: {} }, media, videoOn: false, deskLyricOn: false,
    videoModeOn: () => ctx.videoOn, activeMedia: () => media, lyricOffsetOf: () => 0,
    lyrics: [{ from: 0, text: '第一行' }, { from: 4, text: '第二行' }, { from: 8, text: '第三行' }],
    lastLi: -1, lyricVisualsDirty: true, lyricRailRendered: false, monetLineStates: new Map(), lyricManualAnchor: null,
    $: (id) => {
      if (id === 'recLoader') return { addEventListener() {} };
      calls.dom++;
      return { querySelectorAll: () => lines };
    },
    updateMonetLineWords: () => calls.words++, resetMonetLineWords() {},
    renderLyricRail: () => { calls.rail = (calls.rail || 0) + 1; ctx.lyricRailRendered = true; },
    resolveMonetAccentRgb: () => [255, 255, 255],
    pushDeskLyric: (line) => calls.desk.push(line),
    scrollLyricTo: (index, immediate) => calls.scrolls.push({ index, immediate }),
    requestAnimationFrame: (fn) => { calls.frames.push(fn); rafs.push(fn); return rafs.length; },
    setTimeout: (fn) => { timers.set(++tid, fn); return tid; }, clearTimeout: (id) => timers.delete(id),
    loadMoreRecommendations: () => calls.loads = (calls.loads || 0) + 1,
    video: media, settings: { danmaku: true }, danmakuItems: [], danmakuCursor: 0,
    segHandledToken: -1, videoLoadToken: 1,
    segmentRange: track => track.segment || null,
    handleSegmentEnd: () => { calls.boundaries = (calls.boundaries || 0) + 1; ctx.segHandledToken = 1; media.paused = true; },
    syncDanmaku: () => { calls.danmaku = (calls.danmaku || 0) + 1; ctx.danmakuCursor++; },
    spectrumSettled: false, spectrumReady: true,
    spectrumAnalyser: { getByteFrequencyData() { calls.analyser++; } },
    spectrumData: new Uint8Array(256), spectrumLevels: new Float32Array(112), SPECTRUM_BARS: 112,
    spectrumEls: Array.from({ length: 112 }, () => ({ style: {
      set transform(v) { calls.bars++; }, set opacity(v) { calls.bars++; },
    } })),
  });
  vm.runInContext(
    extract('function lyricVisualsVisible()', '\n}') + '\n}\n' +
    extract('function syncLyric(force)', '/* ---------- 桌面歌词') +
    extract('const lyricStyleValues =', 'function clearMonetTokenFx(') +
    extract('let playbackFrame = 0;', '/* ---------- 底部频谱：') +
    extract('function renderSpectrum(now)', '// 进度定位：') +
    extract('function initRecommendationInfiniteScroll()', 'async function loadLibrary('), ctx);
  return { ctx, calls, document, media, events, view, rafs, timers };
}

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(`${file}: hidden lyrics perform no DOM work; returning refreshes even the same line`, () => {
    const h = harness(file);
    for (let i = 0; i < 120; i++) h.ctx.syncLyric();
    assert.equal(h.calls.dom, 0);
    assert.equal(h.calls.words, 0);
    assert.equal(h.calls.rail || 0, 0, 'no lyric rail is built while hidden');
    h.document.body.dataset.view = 'playing';
    h.ctx.syncLyric();
    assert.equal(h.calls.scrolls.length, 1);
    assert.equal(h.calls.scrolls[0].immediate, true);
    assert.equal(h.calls.rail, 1);
    h.ctx.syncLyric();
    assert.equal(h.calls.dom, 1, 'steady frames do not query all lines');
    h.document.body.dataset.view = 'library'; h.ctx.syncLyric();
    h.media.paused = true;
    h.document.body.dataset.view = 'playing'; h.ctx.syncLyric();
    assert.equal(h.calls.scrolls.length, 2);
    assert.equal(h.calls.rail, 1, 'reuse the existing rail on subsequent visits');
  });

  test(`${file}: desktop lyric line changes still sync without rendering hidden lyrics`, () => {
    const h = harness(file);
    h.ctx.deskLyricOn = true;
    h.ctx.syncLyric();
    h.media.currentTime = 5; h.ctx.syncLyric();
    assert.equal(h.calls.desk.at(-1).text, '第二行');
    assert.equal(h.calls.dom, 0);
    assert.equal(h.calls.words, 0);
    h.document.body.dataset.view = 'playing'; h.ctx.syncLyric();
    assert.equal(h.calls.scrolls.at(-1).index, 1);
  });

  test(`${file}: hidden spectrum skips analyser/224 style writes, then resumes`, () => {
    const h = harness(file);
    h.ctx.renderSpectrum(100);
    assert.equal(h.calls.analyser, 0);
    assert.equal(h.calls.bars, 0);
    h.document.body.dataset.view = 'playing'; h.ctx.renderSpectrum(200);
    assert.equal(h.calls.analyser, 1);
    assert.equal(h.calls.bars, 224);
    h.ctx.videoOn = true; h.ctx.renderSpectrum(300);
    assert.equal(h.calls.bars, 224);
    h.ctx.videoOn = false; h.document.hidden = true; h.ctx.renderSpectrum(400);
    assert.equal(h.calls.bars, 224);
    assert.equal(h.calls.frames.length, 0, 'a single spectrum paint does not reschedule itself');
  });

  test(`${file}: playback frames stop on idle pages but keep segment boundaries and visible danmaku`, () => {
    const h = harness(file);
    h.ctx.schedulePlaybackFrame();
    assert.equal(h.rafs.length, 0, 'ordinary audio playback on the library has no visual loop');
    h.document.body.dataset.view = 'playing';
    h.ctx.schedulePlaybackFrame(); h.ctx.schedulePlaybackFrame();
    assert.equal(h.rafs.length, 1, 'multiple wakeups share one animation frame');
    h.rafs.shift()(100);
    assert.equal(h.calls.analyser, 1);
    assert.equal(h.rafs.length, 1);
    h.document.body.dataset.view = 'library';
    h.rafs.shift()(117);
    assert.equal(h.rafs.length, 0, 'leaving lyrics drains the queued frame and stops');
    h.ctx.state.current.segment = { from: 2, to: 10 };
    h.media.currentTime = 7;
    h.ctx.schedulePlaybackFrame(); h.rafs.shift()(133);
    assert.equal(h.rafs.length, 1, 'a segment boundary still needs a precise clock offscreen');
    h.media.currentTime = 9.95;
    h.rafs.shift()(150);
    assert.equal(h.calls.boundaries, 1);
    assert.equal(h.rafs.length, 0);
    h.document.body.dataset.view = 'playing';
    h.ctx.videoOn = true; h.media.paused = false;
    h.ctx.danmakuItems.push({ time: 10 });
    h.ctx.schedulePlaybackFrame(); h.rafs.shift()(167);
    assert.equal(h.calls.danmaku, 1);
    assert.equal(h.rafs.length, 0, 'finished danmaku does not keep a permanent frame loop');
  });

  test(`${file}: lyric rail measures every row before updating transforms`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const begin = source.indexOf('function layoutLyricRail(');
    const end = source.indexOf('function scrollLyricTo(', begin);
    const events = [];
    const rows = Array.from({ length: 9 }, (_, i) => ({
      get offsetHeight() { events.push('read'); return 48 + i; },
      get scrollHeight() { events.push('read'); return 48 + i + (i === 3 ? 20 : 0); },
      classList: { toggle(name, value) { events.push('write'); this[name] = value; } },
      values: {},
    }));
    const box = {
      querySelectorAll: () => rows,
      classList: { add() {}, contains: () => false },
      get clientHeight() { events.push('read'); return 500; },
    };
    const ctx = vm.createContext({
      $: () => box, lastLi: 4, LYRIC_VISIBLE_BEFORE: 2, LYRIC_VISIBLE_AFTER: 2,
      matchMedia: () => ({ matches: false }),
      lyricLineTone: i => ({ scale: i === 4 ? 1 : .75, opacity: i === 4 ? 1 : .5, blur: 0, z: 0 }),
      setLyricStyle: (el, key, value) => { events.push('write'); el.values[key] = value; },
    });
    vm.runInContext(source.slice(begin, end), ctx);
    ctx.layoutLyricRail(4);
    assert.equal(rows[4].values['--line-y'], '204.00px', 'active line stays vertically centered');
    assert.equal(rows[5].values['--line-y'], '274.00px');
    assert.equal(rows[3].values['--line-y'], '147.75px');
    assert.equal(rows[3].classList.clipped, true);
    assert.equal(rows[0].values['--line-opacity'], '0');
    assert.equal(rows[2].classList['rail-visible'], true);
    assert.ok(events.lastIndexOf('read') < events.indexOf('write'), 'no alternating layout reads after style writes');
  });

  test(`${file}: audio-only warmup does not attach a video source`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
    const calls = [];
    const track = { bvid: 'BV1', cid: 10 };
    const ctx = vm.createContext({
      state: { current: track }, videoLoadToken: 1,
      visible: false, videoOn: false,
      videoModeOn: () => ctx.videoOn, lyricVisualsVisible: () => ctx.visible,
      getVideoQualityOptions: async t => { calls.push(t.cid); },
      prepareOriginalVideo: () => assert.fail('cannot attach media during an audio-only warmup'),
      window: { requestIdleCallback: fn => fn() },
      requestIdleCallback: fn => fn(),
    });
    vm.runInContext(slice('function primeVideoStream()', 'async function waitForVideoReady(')
      + slice('function scheduleVideoWarmup(', 'async function positionPreparedVideo('), ctx);
    ctx.scheduleVideoWarmup(track);
    assert.deepEqual(calls, []);
    ctx.visible = true;
    ctx.scheduleVideoWarmup(track);
    assert.deepEqual(calls, [10]);
    ctx.videoOn = true;
    ctx.primeVideoStream();
    assert.deepEqual(calls, [10]);
  });

  test(`${file}: scroll work coalesces once per frame and restores hover after scrollend/idle`, () => {
    const h = harness(file);
    h.ctx.initRecommendationInfiniteScroll();
    for (let i = 0; i < 10; i++) h.events.scroll();
    assert.equal(h.view.classList.contains('is-scrolling'), true);
    assert.equal(h.rafs.length, 1);
    assert.equal(h.timers.size, 1);
    h.rafs[0]();
    assert.equal(h.calls.loads || 0, 0);
    h.events.scrollend();
    assert.equal(h.view.classList.contains('is-scrolling'), false);
    h.view.scrollTop = 4000; h.events.scroll(); h.rafs[1]();
    assert.equal(h.calls.loads, 1);
    h.view.scrollTop = 0; h.view.scrollHeight = 400;
    h.events.wheel({ deltaY: 80 }); h.rafs[2]();
    assert.equal(h.calls.loads, 2, 'short result pages advance through wheel input');
    [...h.timers.values()][0]();
    assert.equal(h.view.classList.contains('is-scrolling'), false);
  });
}
