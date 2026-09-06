const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function node(id = '') {
  const classes = new Set();
  return {
    id, style: {}, dataset: {}, attrs: {}, events: {}, children: [], clientWidth: 1088,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k === 'src' ? this.src : this.attrs[k]; },
    addEventListener(k, fn) { (this.events[k] ||= []).push(fn); },
    emit(k, event = {}) { for (const fn of this.events[k] || []) fn(event); },
    prepend(child) { child.parent = this; this.children.unshift(child); },
    replaceWith(child) {
      const parent = this.parent;
      child.parent = parent;
      parent.children.splice(parent.children.indexOf(this), 1, child);
    },
    querySelector() { return this.children.find((n) => n.id === 'art'); },
    querySelectorAll() { return this.children; },
  };
}

function harness(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const shelf = node('shelf');
  const nodes = new Map(['shelfTitle', 'shelfMeta'].map((id) => [id, node(id)]));
  for (const id of ['cardLike', 'cardDaily', 'cardMusicLibrary', 'cardRank', 'cardHistory']) {
    const card = node(id), cover = node('cover');
    cover.prepend(node('capsule'));
    cover.prepend(node('art'));
    card.querySelector = () => cover;
    shelf.children.push(card);
    nodes.set(id, card);
  }
  const images = [], window = node('window');
  window.devicePixelRatio = 2;
  window.BiuDaily = { current: () => null };
  const ctx = vm.createContext({
    document: { querySelector: () => shelf }, window,
    $: (id) => nodes.get(id), likes: [], playHistory: [], state: { ranking: [] },
    recommendationProfiles: { manager: () => ({ getSnapshot: () => ({}) }) }, musicLibraryTracks: () => [],
    activateShelfCard() {}, performance: { now: () => 0 }, setTimeout() {},
    Image: function () {
      const img = node('art');
      img.decode = () => Promise.resolve();
      images.push(img);
      return img;
    },
  });
  const start = source.indexOf('function initShelfCarousel()');
  const end = source.indexOf('function openPanel(', start);
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, shelf, nodes, images, window };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(`${file}: diagonal vertical wheel gestures keep native page scrolling`, () => {
    const h = harness(file);
    h.ctx.initShelfCarousel();
    let prevented = false;
    h.shelf.emit('wheel', { deltaX: 5, deltaY: 90, shiftKey: false,
      preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(h.nodes.get('cardLike').getAttribute('aria-current'), 'true');
  });

  test(`${file}: deliberate horizontal and Shift-wheel gestures still change cards`, () => {
    for (const delta of [{ deltaX: 90, deltaY: 5 }, { deltaX: 0, deltaY: 90, shiftKey: true }]) {
      const h = harness(file);
      h.ctx.initShelfCarousel();
      let prevented = false;
      h.shelf.emit('wheel', { ...delta, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(h.nodes.get('cardDaily').getAttribute('aria-current'), 'true');
    }
  });

  test(`${file}: initialization positions cards without marking them as dragging`, () => {
    const h = harness(file);
    h.ctx.initShelfCarousel();
    assert.equal(h.shelf.classList.contains('positioning'), true);
    assert.equal(h.shelf.classList.contains('dragging'), false);
    const rank = h.nodes.get('cardRank');
    rank.emit('keydown', { key: 'Enter', preventDefault() {} });
    assert.equal(rank.getAttribute('aria-current'), 'true');
    const transform = rank.style.transform;
    h.ctx.initShelfCarousel();
    assert.equal(rank.style.transform, transform);
    assert.equal(rank.events.keydown.length, 1);
    assert.equal(h.nodes.get('shelfTitle').textContent, '音乐区热榜');
  });

  test(`${file}: a hidden zero-width resize does not collapse the carousel`, () => {
    const h = harness(file);
    h.ctx.initShelfCarousel();
    const rank = h.nodes.get('cardRank');
    const transform = rank.style.transform;
    h.shelf.clientWidth = 0;
    h.window.emit('resize');
    assert.equal(rank.style.transform, transform);
    h.shelf.clientWidth = 900;
    h.window.emit('resize');
    assert.equal(h.shelf.classList.contains('positioning'), true);
    assert.notEqual(rank.style.transform, transform);
  });

  test(`${file}: unchanged and in-flight covers reuse the artwork and keep the capsule`, async () => {
    const h = harness(file);
    const cover = h.nodes.get('cardHistory').querySelector('.cover');
    const previous = cover.children[0], capsule = cover.children[1];
    h.ctx.setShelfCover('cardHistory', '/cover.jpg');
    h.ctx.setShelfCover('cardHistory', '/cover.jpg');
    assert.equal(h.images.length, 1);
    assert.equal(cover.children[0], previous);
    let finish;
    h.images[0].decode = () => new Promise((resolve) => { finish = resolve; });
    h.images[0].onload();
    assert.equal(cover.children[0], previous);
    finish();
    await flush();
    assert.equal(cover.children[0], h.images[0]);
    assert.equal(cover.children[1], capsule);
    h.ctx.setShelfCover('cardHistory', '/cover.jpg');
    assert.equal(h.images.length, 1);
  });

  test(`${file}: failed or superseded covers never replace the current artwork`, async () => {
    const h = harness(file);
    const cover = h.nodes.get('cardRank').querySelector('.cover');
    const previous = cover.children[0];
    h.ctx.setShelfCover('cardRank', '/failed.jpg');
    h.images[0].onerror();
    assert.equal(cover.children[0], previous);
    h.ctx.setShelfCover('cardRank', '/first.jpg');
    h.ctx.setShelfCover('cardRank', '/second.jpg');
    h.images[1].onload();
    await flush();
    assert.equal(cover.children[0], previous);
    h.images[2].onload();
    await flush();
    assert.equal(cover.children[0].src, '/second.jpg');
    h.ctx.setShelfCover('cardRank', '/failed-decode.jpg');
    h.images[3].decode = () => Promise.reject(new Error('decode failed'));
    h.images[3].onload();
    await flush();
    assert.equal(cover.children[0].src, '/second.jpg');
  });
}
