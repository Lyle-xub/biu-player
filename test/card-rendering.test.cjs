const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../renderer/styles.css'), 'utf8');
const slice = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source boundaries: ${start}`);
  return source.slice(a, b);
};

function harness() {
  const context = vm.createContext({
    esc: (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    coverSVG: () => '<svg></svg>',
    fetch: () => assert.fail('Revealing a cover must not refetch it'),
    URL: { createObjectURL: () => assert.fail('Cover URLs must stay stable') },
  });
  vm.runInContext(
    slice('function covHTML(', '/* ---------- 列表行') + '\n' +
    slice('const boundCoverCards =', '/* ---------- 播放队列'), context);
  return context;
}

function makeCard(img = null) {
  const classes = new Set();
  let loading = true;
  let removes = 0;
  return {
    classList: { add: (name) => classes.add(name) },
    get ready() { return classes.has('cover-ready'); },
    get loading() { return loading; },
    get removes() { return removes; },
    querySelector(selector) {
      if (selector === '.cover img') return img;
      if (selector === '.cover-loading' && loading) return {
        remove() { loading = false; removes++; },
      };
      return null;
    },
  };
}

const scope = (...cards) => ({ querySelectorAll: () => cards.filter((c) => !c.ready) });
const flush = () => new Promise((resolve) => setImmediate(resolve));
function makeImage(props = {}) {
  return Object.assign(new EventTarget(), {
    src: 'https://example.test/cover.jpg', complete: false, naturalWidth: 0,
    decode: () => Promise.resolve(),
  }, props);
}

test('image markup keeps a stable escaped URL and asynchronous decoding', () => {
  const ctx = harness();
  const html = ctx.covHTML({ pic: 'https://example.test/a?x=1&y="2"' });
  assert.match(html, /src="https:\/\/example.test\/a\?x=1&amp;y=&quot;2&quot;"/);
  assert.match(html, /loading="lazy" decoding="async"/);
  assert.doesNotMatch(html, /data-pic|blob:/);
  assert.equal(ctx.covHTML(null), '<svg></svg>');
});

test('inline SVG cards immediately remove their loading layer', () => {
  const ctx = harness();
  const card = makeCard();
  ctx.bindCoverLoading(scope(card));
  assert.equal(card.ready, true);
  assert.equal(card.loading, false);
});

test('cached images wait for decode, then remove the layer without changing src', async () => {
  const ctx = harness();
  let finishDecode;
  const img = makeImage({ complete: true, naturalWidth: 400,
    decode: () => new Promise((resolve) => { finishDecode = resolve; }) });
  const card = makeCard(img);
  ctx.bindCoverLoading(scope(card));
  assert.equal(card.ready, false);
  finishDecode();
  await flush();
  assert.equal(card.ready, true);
  assert.equal(card.loading, false);
  assert.equal(img.src, 'https://example.test/cover.jpg');
});

test('appending recommendations does not rebind pending image listeners', async () => {
  const ctx = harness();
  let decodes = 0;
  const img = makeImage({ decode: () => { decodes++; return Promise.resolve(); } });
  const card = makeCard(img);
  ctx.bindCoverLoading(scope(card));
  ctx.bindCoverLoading(scope(card, makeCard()));
  img.dispatchEvent(new Event('load'));
  await flush();
  assert.equal(decodes, 1);
  assert.equal(card.removes, 1);
  assert.equal(card.ready, true);
});

test('failed cached images do not leave a permanent loading layer', () => {
  const card = makeCard(makeImage({ complete: true }));
  harness().bindCoverLoading(scope(card));
  assert.equal(card.ready, true);
  assert.equal(card.loading, false);
});

test('network errors and decode rejection both remove loading layers', async () => {
  const ctx = harness();
  const img = makeImage();
  const card = makeCard(img);
  const rejected = makeCard(makeImage({ complete: true, naturalWidth: 400,
    decode: () => Promise.reject(new Error('decode failed')) }));
  ctx.bindCoverLoading(scope(card, rejected));
  img.dispatchEvent(new Event('error'));
  await flush();
  assert.equal(card.loading, false);
  assert.equal(rejected.loading, false);
});

test('both card types keep clipped glass separate from capsule content', () => {
  const shared = styles.match(/\.gcard \.count, \.card \.count\s*\{([^}]+)\}/)?.[1];
  assert.ok(shared);
  assert.match(shared, /border-radius:\s*22px/);
  assert.match(shared, /overflow:\s*hidden/);
  // The shell must not become a backdrop root that excludes the cover image.
  for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim().split(',').some((s) => /^\.(gcard|card) \.count$/.test(s.trim()))) {
      assert.doesNotMatch(match[2], /backdrop-filter|clip-path|\bopacity\b|will-change/);
    }
  }
  const glass = styles.match(/\.gcard \.count::before, \.card \.count::before\s*\{([^}]+)\}/)?.[1];
  assert.ok(glass);
  assert.match(glass, /clip-path:\s*inset\(0 round 22px\)/);
  assert.match(glass, /backdrop-filter:\s*blur\(8px\)/);
  assert.match(glass, /pointer-events:\s*none/);
  assert.match(glass, /z-index:\s*0/);
  const content = styles.match(/\.gcard \.count > \*, \.card \.count > \*\s*\{([^}]+)\}/)?.[1];
  assert.match(content, /z-index:\s*1/);
  assert.match(styles, /\.gcard:not\(\.cover-ready\) \.count\s*\{\s*visibility:\s*hidden;/);
  assert.match(styles, /\.gcard\.cover-ready \.cover-loading::after\s*\{\s*animation:\s*none;/);
});
