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
    lastLi: -1, lyricVisualsDirty: true, monetLineStates: new Map(), lyricManualAnchor: null,
    $: (id) => {
      if (id === 'recLoader') return { addEventListener() {} };
      calls.dom++;
      return { querySelectorAll: () => lines };
    },
    updateMonetLineWords: () => calls.words++, resetMonetLineWords() {},
    resolveMonetAccentRgb: () => [255, 255, 255],
    pushDeskLyric: (line) => calls.desk.push(line),
    scrollLyricTo: (index, immediate) => calls.scrolls.push({ index, immediate }),
    requestAnimationFrame: (fn) => { calls.frames.push(fn); rafs.push(fn); return rafs.length; },
    setTimeout: (fn) => { timers.set(++tid, fn); return tid; }, clearTimeout: (id) => timers.delete(id),
    loadMoreRecommendations: () => calls.loads = (calls.loads || 0) + 1,
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
    h.document.body.dataset.view = 'playing';
    h.ctx.syncLyric();
    assert.equal(h.calls.scrolls.length, 1);
    assert.equal(h.calls.scrolls[0].immediate, true);
    h.ctx.syncLyric();
    assert.equal(h.calls.dom, 1, 'steady frames do not query all lines');
    h.document.body.dataset.view = 'library'; h.ctx.syncLyric();
    h.media.paused = true;
    h.document.body.dataset.view = 'playing'; h.ctx.syncLyric();
    assert.equal(h.calls.scrolls.length, 2);
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
    assert.equal(h.calls.frames.length, 4);
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
    [...h.timers.values()][0]();
    assert.equal(h.view.classList.contains('is-scrolling'), false);
  });
}
