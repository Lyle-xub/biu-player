const { test } = require('node:test');
const assert = require('node:assert/strict');
const { artwork, themeFor, quoteFor } = require('../renderer/profile-presentation');

test('portrait artwork is deterministic, escaped and follows weighted interests', () => {
  const profile = { name: '我的卡片', tags: [{ name: '爵士', weight: 90 }, { name: '电影', weight: 20 }] };
  assert.equal(themeFor(profile).id, 'music');
  assert.equal(artwork(profile).svg, artwork(structuredClone(profile)).svg);
  assert.notEqual(artwork(profile).svg, artwork({ ...profile, name: '另一张' }).svg);
  assert.equal(themeFor({ tags: [{ name: '爵士', weight: 10 }, { name: '电影', weight: 80 }] }).id, 'film');
  assert.equal(themeFor({ tags: [] }).id, 'literature');
  const svg = artwork({ tags: [{ name: '<script>alert("x")</script>', weight: 5 }] }).svg;
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(!svg.includes('<script>'));
});

test('public quotes use category-only requests, rank candidates and cache them', async () => {
  const calls = [];
  const profile = { tags: [{ name: '爵士', weight: 90 }] };
  const fetcher = async (url, options) => {
    const i = calls.length;
    calls.push({ url, options });
    return { ok: true, json: async () => ({ hitokoto: i === 1 ? '爵士乐中的一次相遇。' : '另一段测试语录。', from: '测试出处', from_who: '测试作者' }) };
  };
  const quote = await quoteFor(profile, fetcher);
  assert.equal(quote.text, '爵士乐中的一次相遇。');
  assert.equal(quote.author, '测试作者');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ url, options }) => new URL(url).searchParams.get('c') === 'j' && options.credentials === 'omit' && !url.includes('爵士')));
  assert.deepEqual(await quoteFor(profile, fetcher), quote);
  assert.equal(calls.length, 3, 'opening settings again does not request new quotes');
});

test('failed quote requests can retry; malformed responses cannot become quotations', async () => {
  const profile = { tags: [{ name: '旅行', weight: 80 }] };
  await assert.rejects(quoteFor(profile, async () => ({ ok: true, json: async () => ({ error: 'bad' }) })), /暂时无法连接/);
  const quote = await quoteFor(profile, async () => ({ ok: true, json: async () => ({ hitokoto: '一段测试风景语录。', from: '测试集' }) }));
  assert.equal(quote.from, '测试集');
});

test('desktop flip paints one face at a time and cancels cleanly when settings close', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const animations = [], handlers = {};
  const nodes = {
    '.portrait-front': { hidden: false, focus() {} },
    '.portrait-back': { hidden: true },
    '.portrait-back button': { focus() {} },
    '.profile-details': { hidden: true }, '.quote-content': {},
  };
  const card = { isConnected: true, classList: { toggle() {} }, querySelector: (s) => nodes[s],
    animate() {
      let resolve, reject;
      const animation = { finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
        finish: () => resolve(), cancel: () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })) };
      animations.push(animation); return animation;
    } };
  nodes['.portrait-card'] = card;
  const host = { querySelector: (s) => nodes[s], addEventListener: (name, handler) => { handlers[name] = handler; },
    removeEventListener() {}, replaceChildren() {} };
  const R = require('../renderer/recommendation-profile');
  const window = { BiuRecommendation: R, BiuProfilePresentation: { artwork, themeFor }, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/recommendation-editor'), 'utf8'), { window, console });
  const dispose = window.BiuRecommendationEditor(host, {
    getSnapshot: () => ({ ...R.normalize({}), ready: false }), subscribe: () => () => {}, ready: () => new Promise(() => {}),
  });
  assert.match(host.innerHTML, /portrait-back" hidden inert/);
  const click = () => handlers.click({ target: { closest: () => ({ dataset: { action: 'flip' } }) } });
  const forward = click();
  await click();
  assert.equal(animations.length, 1, 'rapid repeated clicks cannot overlap flips');
  assert.equal(nodes['.portrait-back'].hidden, true);
  animations[0].finish(); await new Promise(setImmediate);
  assert.equal(nodes['.portrait-front'].hidden, true);
  assert.equal(nodes['.portrait-back'].hidden, false);
  assert.equal(nodes['.profile-details'].hidden, false);
  animations[1].finish(); await forward;
  const reverse = click();
  animations[2].finish(); await new Promise(setImmediate);
  assert.equal(nodes['.portrait-front'].hidden, false);
  assert.equal(nodes['.portrait-back'].hidden, true);
  animations[3].finish(); await reverse;
  const interrupted = click();
  dispose(); await interrupted;
  assert.equal(nodes['.portrait-back'].hidden, true, 'closing during the outgoing phase must not reveal the reverse');
});
