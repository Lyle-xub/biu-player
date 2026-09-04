const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const D = require('../renderer/daily-recommendation');

test('photo desktop keeps existing relative positions as songs append, with reachable bounds', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/daily-desktop'), 'utf8'), { window });
  const layout = window.BiuDailyDesktop.layout;
  for (const width of [320, 1180, 1600]) {
    const first = layout(width, 8, D.hash), full = layout(width, 24, D.hash);
    assert.deepEqual(full.positions.slice(0, 8), first.positions);
    for (const p of full.positions) {
      assert.ok(p.x >= 20 && p.x + full.cardWidth <= width - 20);
      assert.ok(p.y >= 20 && p.y + full.cardHeight <= full.height - 20);
      assert.ok(Math.abs(p.angle) <= 9);
    }
    assert.deepEqual(layout(width, 24, D.hash), full, 'reopening the same selection does not reshuffle photos');
    if (width >= 1180) {
      const top = full.positions.slice(0, 5).map((p) => p.y);
      assert.ok(Math.max(...top) - Math.min(...top) >= 120, 'neighboring photos visibly stagger up and down');
    }
  }
});

test('every photo can reach the clear viewport center while panning stays bounded', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/daily-desktop'), 'utf8'), { window });
  const { layout, clampPan } = window.BiuDailyDesktop;
  for (const [viewportWidth, viewportHeight] of [[320, 600], [1280, 616], [1920, 1080]]) {
    const width = Math.max(viewportWidth + 320, 1500);
    for (const count of [1, 24]) {
      const geometry = { ...layout(width, count, D.hash), width };
      for (const p of geometry.positions) {
        const target = {
          x: p.x + geometry.cardWidth / 2 - viewportWidth / 2,
          y: p.y + geometry.cardHeight / 2 - viewportHeight / 2,
        };
        const actual = clampPan(target, geometry, viewportWidth, viewportHeight);
        assert.equal(actual.x, target.x, 'each column can reach the clear center');
        assert.equal(actual.y, target.y, 'each row can reach the clear center');
        for (const direction of [-1, 1]) {
          const beyond = { x: target.x + direction * viewportWidth, y: target.y + direction * viewportHeight };
          const moved = clampPan(beyond, geometry, viewportWidth, viewportHeight);
          assert.equal(moved.x, beyond.x, 'edge photos have room beyond the horizontal center');
          assert.equal(moved.y, beyond.y, 'edge photos have room beyond the vertical center');
        }
      }
      for (const direction of [-1, 1]) {
        const bounded = clampPan({ x: direction * 1e6, y: direction * 1e6 }, geometry, viewportWidth, viewportHeight);
        assert.ok(bounded.x >= -viewportWidth * 1.5 && bounded.x <= geometry.width + viewportWidth * .5);
        assert.ok(bounded.y >= -viewportHeight * 1.5 && bounded.y <= geometry.height + viewportHeight * .5);
      }
    }
  }
});

test('both desktop shells place daily before ranking and route back through normal page history', () => {
  for (const [controller, shell] of [['renderer/app.js', 'renderer/index.html'], ['web/src/legacy/controller.js', 'web/src/shell.jsx']]) {
    const source = fs.readFileSync(controller, 'utf8'), markup = fs.readFileSync(shell, 'utf8');
    assert.ok(markup.indexOf('id="cardLike"') < markup.indexOf('id="dailyHome"'));
    assert.ok(markup.indexOf('id="dailyHome"') < markup.indexOf('id="cardRank"'));
    assert.ok(markup.includes('view-daily" id="dailyPage"'));
    const library = { scrollTop: 456 }, daily = { scrollTop: 0 }, buttons = { setAttribute() {} };
    const body = { dataset: { view: 'library' }, classList: { toggle() {} } }, entered = [];
    const ctx = vm.createContext({
      document: { body, querySelector: () => library, querySelectorAll: (q) => q === '.view' ? [library, daily] : [] },
      $: () => buttons, state: {}, URL, location: { href: 'http://localhost/' }, history: { replaceState() {} },
      window: { scrollTo() {}, BiuPlayerSheetMotion: { cancel() {}, enterPage(from, to, update) { entered.push([from, to]); update(); } } },
      setVideoTheater() {}, setLiveTheater() {}, setVideoMode() {}, closePanel() {}, setTimeout() {},
    });
    vm.runInContext(source.slice(source.indexOf('const VIEW_ORDER ='), source.indexOf('function setModeSelection(')), ctx);
    ctx.go('daily'); assert.equal(body.dataset.view, 'daily');
    ctx.goBack(); assert.equal(body.dataset.view, 'library'); assert.equal(library.scrollTop, 456);
    assert.deepEqual(entered, [['library', 'daily'], ['daily', 'library']]);
  }
});
