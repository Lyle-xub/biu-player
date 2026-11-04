const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fromDetail, currentPart, partKey, select, url } = require('../renderer/video-parts');
const sync = require('../renderer/library-sync');
const session = require('../renderer/playback-session');
const bvid = 'BV1zhEq6HEj8';
const original = { bvid, cid: 39646463876, title: '专辑' };
const parts = fromDetail(bvid, { aid: 123, pages: [
  { page: 2, cid: 39646464077, part: 'stupid song', duration: 210 },
  { page: 1, cid: 39646463876, part: 'drop dead', duration: 226 },
  { page: 3, cid: 39646593841, part: 'honeybee', duration: 224 },
] });

test('parts use their own CID, duration and title, in upload order', () => {
  assert.deepEqual(parts.map(p => [p.page, p.cid, p.duration]), [
    [1, 39646463876, 226], [2, 39646464077, 210], [3, 39646593841, 224],
  ]);
  assert.equal(currentPart(original, parts).title, 'drop dead');
  assert.equal(currentPart({ ...original, cid: 99 }, parts), null);
  assert.equal(parts[1].title, 'stupid song');
  assert.equal(partKey(parts[0]), partKey(original));
  assert.notEqual(partKey(parts[1]), partKey(parts[2]));
  assert.equal(url(parts[1]), `https://www.bilibili.com/video/${bvid}/?p=2`);
  assert.deepEqual(fromDetail(bvid, { pages: [{ page: 1, cid: 123 }] }), []);
});

test('selection expands one queue entry and switching parts does not duplicate the group', () => {
  const before = { bvid: 'BVbefore' }, after = { bvid: 'BVafter' };
  const first = select([before, original, after], 1, original, parts, parts[1].cid);
  assert.deepEqual(first, { tracks: [before, ...parts, after], index: 2 });
  assert.equal(select(first.tracks, first.index, parts[1], parts, 'all').index, 1);
  const second = select(first.tracks, first.index, parts[1], parts, parts[2].cid);
  assert.deepEqual(second, { tracks: first.tracks, index: 3 });
  assert.equal(select(first.tracks, 0, before, parts, parts[0].cid), null);
  assert.equal(select([original], 0, { ...original, isSegment: true }, parts, parts[1].cid), null);
});

test('cloud/LAN data and the restored queue keep separate pages', () => {
  const saved = sync.normalize({ version: 1, likes: parts, library: parts, playlists: [{ id: 1, title: '分 P', tracks: parts }] });
  assert.deepEqual(saved.likes.map(p => p.page), [1, 2, 3]);
  assert.equal(saved.playlists[0].tracks.length, 3);
  const restored = session.normalize({ version: 1, current: parts[1], queue: saved.library, qi: 1 });
  assert.equal(restored.current.page, 2);
  assert.equal(restored.queue[restored.qi].cid, parts[1].cid);
});

test('both desktop controllers pass the selected part to the normal player', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
    const source = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
    const state = { queue: [original, { bvid: 'BVafter' }], qi: 0, current: original };
    let chosen, liked;
    const context = { state, parts, BiuVideoParts: { select, currentPart }, toggleLike(t) { liked = t; }, closeFavPop() {}, renderFavButtons() {}, playIndex(i) { chosen = state.queue[i]; } };
    vm.runInNewContext(source.slice(source.indexOf('let availableVideoParts ='), source.indexOf('function fillPlayingBase(track)'))
      + '\navailableVideoParts = parts; toggleCurrentPartFavorite(); selectVideoPart(parts[1].cid);', context);
    assert.equal(liked.title, 'drop dead');
    assert.equal(liked.page, 1);
    assert.equal(chosen.cid, parts[1].cid);
    assert.equal(state.queue[3].bvid, 'BVafter');
  }
});
