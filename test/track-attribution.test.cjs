const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('desktop legacy segments share source lookup, escape attribution, and open UP without playing', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const cache = new Map();
  const opened = [];
  let calls = 0, plays = 0, stopped = 0;
  const context = vm.createContext({
    store: { get: (key, fallback) => cache.get(key) || fallback, set: (key, value) => cache.set(key, value) },
    api: { view: async () => { calls++; return { title: '<原视频>', owner: { name: '原"UP', mid: 42 } }; } },
    esc: (text) => String(text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    openUpPage: (mid) => opened.push(mid),
  });
  vm.runInContext(app.slice(app.indexOf('const sourceTrackRequests'), app.indexOf('function trowHTML')), context);
  const track = { isSegment: true, bvid: 'BVsource', title: '识别歌名', up: '识别歌手' };
  const [one, two] = await Promise.all([context.resolveSourceTrack(track), context.resolveSourceTrack({ ...track, title: '另一首' })]);
  assert.equal(calls, 1);
  assert.equal(one.parentTitle, '<原视频>');
  assert.equal(two.title, '另一首');
  assert.match(context.trackNameHTML(track), /识别歌名.*track-source.*&lt;原视频&gt;/);
  assert.match(context.trackArtistHTML(track), /识别歌手.*data-source-up.*原&quot;UP/);
  assert.equal(track.parentTitle, undefined, 'display enrichment does not replace saved song identity');
  let click;
  const titleNode = {}, artistNode = {};
  const row = { isConnected: true, addEventListener: (_, fn) => { click = fn; },
    querySelectorAll: (selector) => [selector === '.track-title-line' ? titleNode : artistNode] };
  context.bindSourceTrackRow(row, track, () => { plays++; });
  await click({ target: { closest: () => ({}) }, stopPropagation: () => { stopped++; } });
  assert.deepEqual(opened, [42]);
  assert.equal(plays, 0);
  assert.equal(stopped, 1);
  assert.match(titleNode.innerHTML, /&lt;原视频&gt;/);
  await click({ target: { closest: () => null } });
  assert.equal(plays, 1);
  await context.resolveSourceTrack(track);
  assert.equal(calls, 1, 're-render uses persisted metadata');
  assert.doesNotMatch(context.trackNameHTML({ title: '普通视频' }), /track-source/);
});
