const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/hot-comment-motion.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ reduced = false, visible = true } = {}) {
  const played = [], frames = new Map(), images = [];
  let frameId = 0;
  function element(name, children = []) {
    const classes = new Set([name]);
    return {
      name, children, attrs: { id: name }, scrollWidth: 400, clientWidth: 200,
      style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      querySelector(selector) {
        for (const child of children) {
          if (selector === '.' + child.name) return child;
          const nested = child.querySelector(selector);
          if (nested) return nested;
        }
        return null;
      },
      querySelectorAll() { return children.flatMap((c) => [c, ...c.querySelectorAll()]); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      getClientRects: () => visible ? [{}] : [],
      cloneNode() { return element(name, children.map((c) => c.cloneNode())); },
      appendChild(child) { child.parent = this; children.push(child); },
      remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); },
      animate(keyframes, options) {
        let finish;
        const animation = { target: name, keyframes, options, cancelled: false,
          finished: new Promise((resolve) => { finish = resolve; }),
          finish: () => finish(), cancel() { this.cancelled = true; } };
        played.push(animation);
        return animation;
      },
    };
  }
  const text = element('hot-comment-text');
  const viewport = element('hot-comment-viewport', [text]);
  const content = element('hot-comment-content', [element('hot-comment-avatar'), viewport]);
  const pill = element('hot-comment', [content]);
  const root = {
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => ({ transform: 'matrix(1, 0, 0, 1, -48, 0)', visibility: visible ? 'visible' : 'hidden' }),
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout, clearTimeout,
    Image: function () { this.decode = () => Promise.resolve(); images.push(this); },
  };
  vm.runInNewContext(source, { window: root });
  const motion = root.BiuHotCommentMotion.create(pill);
  const commits = [];
  const commit = (data) => { commits.push(data); text.textContent = data.text; };
  const paint = () => {
    for (let n = 0; n < 2; n++) {
      const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn());
    }
  };
  return { motion, pill, content, text, viewport, played, images, commits, commit, paint };
}

test('crossfade freezes the outgoing marquee, animates only content and cleans up', async () => {
  const h = harness();
  h.motion.update({ text: '下一条评论', seed: 3 }, h.commit);
  assert.equal(h.commits.length, 1);
  assert.equal(h.pill.children.length, 2);
  const old = h.pill.children[1];
  assert.equal(old.attrs['aria-hidden'], 'true');
  assert.ok(old.querySelectorAll().every((n) => !n.attrs.id));
  assert.equal(old.querySelector('.hot-comment-text').style.transform, 'matrix(1, 0, 0, 1, -48, 0)');
  assert.equal(old.querySelector('.hot-comment-text').style.animation, 'none');
  h.paint();
  assert.equal(h.played.length, 2);
  assert.ok(h.played.every((a) => a.target === 'hot-comment-content'));
  assert.equal(h.motion.dwellTime > 9000, true);
  h.played[1].finish();
  await flush();
  assert.equal(h.pill.children.length, 1);
  assert.equal(h.content.style.opacity, undefined);
});

test('refreshing the same comment does not restart animations or scrolling', () => {
  const h = harness();
  const data = { text: '相同评论', avatar: null, seed: 3, uname: '听众' };
  h.motion.update(data, h.commit);
  h.paint();
  h.motion.update({ ...data }, h.commit);
  h.paint();
  assert.equal(h.commits.length, 1);
  assert.equal(h.played.length, 2);
});

test('different comments with equal overflow restart the marquee after a paint', () => {
  const h = harness();
  h.motion.update({ text: '第一条评论' }, h.commit);
  h.paint();
  assert.equal(h.text.classList.contains('scrolling'), true);
  h.motion.update({ text: '第二条评论' }, h.commit);
  assert.equal(h.text.classList.contains('scrolling'), false);
  h.paint();
  assert.equal(h.text.classList.contains('scrolling'), true);
});

test('avatar and text are committed together after avatar preparation', async () => {
  const h = harness();
  h.motion.update({ text: '新评论', avatar: '/face.png', uname: '听众' }, h.commit);
  assert.equal(h.commits.length, 0);
  assert.equal(h.pill.children.length, 1);
  h.images[0].onload();
  await flush();
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].text, '新评论');
  assert.equal(h.commits[0].avatar, '/face.png');
});

test('a pending avatar cannot overwrite a newer comment or a cleared track', async () => {
  const h = harness();
  h.motion.update({ text: '旧评论', avatar: '/old.png' }, h.commit);
  h.motion.update({ text: '新评论', seed: 2 }, h.commit);
  h.images[0].onload();
  await flush();
  assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].text, '新评论');
  h.paint();
  h.motion.clear();
  assert.equal(h.pill.children.length, 1);
  assert.ok(h.played.every((a) => a.cancelled));
  h.motion.update({ text: '待加载', avatar: '/pending.png' }, h.commit);
  h.motion.clear();
  h.images[1].onerror();
  await flush();
  assert.equal(h.commits.length, 1);
});

for (const mode of [{ reduced: true }, { visible: false }]) {
  test(`no swap animation when ${JSON.stringify(mode)}`, () => {
    const h = harness(mode);
    h.motion.update({ text: '评论' }, h.commit);
    h.paint();
    assert.equal(h.commits.length, 1);
    assert.equal(h.played.length, 0);
    assert.equal(h.pill.children.length, 1);
    if (mode.reduced) assert.equal(h.text.classList.contains('scrolling'), false);
  });
}
