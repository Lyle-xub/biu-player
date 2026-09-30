const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function harness(source) {
  let writes = 0;
  const element = () => {
    const values = {}, classes = new Set();
    const style = new Proxy({ setProperty(key, value) { writes++; values[key] = value; } }, {
      set(_, key, value) { writes++; values[key] = value; return true; },
    });
    return { style, values, classes, classList: {
      add(key) { classes.add(key); }, remove(key) { classes.delete(key); },
      toggle(key, on) { if (on) classes.add(key); else classes.delete(key); },
    } };
  };
  const states = new Map(), lyrics = [];
  for (let i = 0; i < 400; i++) {
    lyrics.push({ from: i * 2, to: i * 2 + 2 });
    states.set(i, { measured: true, fontPx: 36, edge: 10, accentRgb: [122, 180, 240],
      tokens: Array.from({ length: 8 }, (_, w) => ({ timed: true, text: '字',
        t0: i * 2 + w / 4, t1: i * 2 + (w + 1) / 4,
        offsets: [0, 10], graphemeCount: 1, el: element(), base: element(), fill: element(),
      })),
    });
  }
  const sandbox = { monetLineStates: states, lyrics };
  vm.createContext(sandbox);
  const constants = [...source.matchAll(/^const MONET_GLOW_[A-Z_]+ = [^;]+;/gm)].map(x => x[0]).join('\n');
  const functions = source.slice(source.indexOf('function monetMixRgb('), source.indexOf('function layoutLyricRail('));
  vm.runInContext(constants + '\n' + functions, sandbox);
  const snapshot = () => [...states.values()].map(st => st.tokens.map(t =>
    [t.el.values, [...t.el.classes].sort(), t.base.values, t.fill.values]));
  return { sandbox, states, snapshot, writes: () => writes };
}

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(file + ': lyric resets and word animation preserve every style with fewer writes', () => {
    const before = harness(fs.readFileSync(path.join(__dirname, 'fixtures/lyric-rendering-baseline.txt'), 'utf8'));
    const after = harness(fs.readFileSync(path.join(root, file), 'utf8'));
    const reset = (h, index) => {
      for (let i = 0; i < h.states.size; i++) {
        if (i !== index && i !== index - 1) h.sandbox.resetMonetLineWords(i, i < index);
      }
    };
    // Forward movement, a seek backwards and a large jump use exactly the same
    // word fill/glow equations. Compare all lines, including offscreen ones.
    for (const index of [0, 1, 2, 1, 90, 91]) {
      for (const h of [before, after]) {
        for (let frame = 0; frame < 12; frame++) {
          const now = index * 2 + frame / 60;
          h.sandbox.updateMonetLineWords(index, now, true);
          if (index) h.sandbox.updateMonetLineWords(index - 1, now, false);
        }
        reset(h, index);
      }
      assert.deepEqual(after.snapshot(), before.snapshot(), 'word fill, glow and passed state are identical');
    }
    assert.ok(after.writes() < before.writes() * 0.45,
      `DOM writes ${before.writes()} -> ${after.writes()}`);
    const count = after.writes(); reset(after, 91);
    assert.equal(after.writes(), count, 'unchanged inactive lines generate no additional DOM mutations');
    // A reset must remain effective after a previously reset line is animated.
    after.sandbox.updateMonetLineWords(90, 180.1, true);
    after.sandbox.resetMonetLineWords(90, false);
    assert.equal(after.states.get(90).tokens[0].el.values['--w-sweep'], '0px');
    console.log(`${file}: DOM writes ${before.writes()} -> ${count}`);
  });
}
