const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { layout } = require('../renderer/playlist-cover-editor');

test('cover crop fills a square for portrait, landscape and small images and clamps dragging at every zoom', () => {
  for (const [w, h] of [[1600, 900], [900, 1600], [32, 32], [100, 2000]]) {
    for (const zoom of [1, 1.5, 4, 9, -1]) {
      for (const offset of [-5000, 0, 5000]) {
        const p = layout(w, h, zoom, offset, -offset);
        assert.ok(p.w >= 512 && p.h >= 512);
        assert.ok((512 - p.w) / 2 + p.x <= 0);
        assert.ok((512 - p.h) / 2 + p.y <= 0);
        assert.ok((512 + p.w) / 2 + p.x >= 512);
        assert.ok((512 + p.h) / 2 + p.y >= 512);
        assert.ok(p.scale <= 512 / Math.min(w, h) * 4);
      }
    }
  }
  assert.deepEqual(layout(1024, 512, 1, 100, 100), { scale: 1, w: 1024, h: 512, x: 100, y: 0 });
});

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(`${file}: restore default persists removal, invalidates pending crop and refreshes only the selected playlist`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const fn = source.slice(source.indexOf('function resetInlineCover()'), source.indexOf('function resetDialogCover()'));
    const playlist = { id: 1, cover: 'data:image/jpeg;base64,OLD', title: 'Mine', tracks: [] };
    const calls = [];
    const context = { coverPickRevision: 4, currentCustomPlaylist: () => playlist,
      window: { BiuCoverEditor: { close: () => calls.push('cancel') } },
      saveCustomPlaylists: () => calls.push(['save', { ...playlist }]),
      refreshCustomPlaylist: value => calls.push(['refresh', value]), toast: () => {} };
    vm.runInNewContext(fn + '\nresetInlineCover();', context);
    assert.equal(context.coverPickRevision, 5);
    assert.equal(playlist.cover, undefined);
    assert.equal(calls[0], 'cancel');
    assert.equal(calls[1][1].cover, undefined);
    assert.equal(calls[2][1], playlist);
    calls.length = 0;
    vm.runInNewContext(fn + '\nresetInlineCover();', context);
    assert.deepEqual(calls, [], 'default cover is a no-op');
  });
}
