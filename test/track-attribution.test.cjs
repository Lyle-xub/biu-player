const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('desktop source title continues as a clamped two-line block after the song title', () => {
  const css = fs.readFileSync(path.join(__dirname, '../renderer/styles.css'), 'utf8');
  const sourceLayout = css.match(/\.np-title:has\(> \.np-source-inline\)\s*\{([^}]*)\}[\s\S]*?\.np-title:has\(> \.np-source-inline\) > \.np-title-main\s*\{([^}]*)\}[\s\S]*?\.np-title > \.np-source-inline\s*\{([^}]*)\}[\s\S]*?\.np-title > \.np-source-inline > \.np-source-text\s*\{([^}]*)\}/);
  assert.ok(sourceLayout, 'source title layout rules exist');
  assert.doesNotMatch(sourceLayout[1], /display\s*:\s*flex/, 'title is not split into parallel columns');
  assert.match(sourceLayout[2], /display\s*:\s*inline/, 'song title stays in the shared text flow');
  assert.match(sourceLayout[3], /display\s*:\s*inline-block/, 'source block follows the final song-title glyph');
  assert.match(sourceLayout[4], /-webkit-line-clamp\s*:\s*2/, 'source text truncates after two small lines');
});

test('desktop legacy segments share source lookup, escape attribution, and open UP without playing', async () => {
  const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const cache = new Map();
  const opened = [];
  let calls = 0, plays = 0, stopped = 0;
  const context = vm.createContext({
    window: { BiuTrackSource: require('../renderer/track-source') },
    store: { get: (key, fallback) => cache.get(key) || fallback, set: (key, value) => cache.set(key, value) },
    api: { view: async () => { calls++; return { title: '<原视频>', owner: { name: '原"UP', mid: 42 } }; } },
    esc: (text) => String(text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    openUpPage: (mid) => opened.push(mid),
  });
  vm.runInContext(app.slice(app.indexOf('const { sourceTrack, resolveSourceTrack }'), app.indexOf('function trowHTML')), context);
  const track = { isSegment: true, bvid: 'BVsource', title: '识别歌名', up: '识别歌手' };
  vm.runInContext('globalThis.resolveSourceTrack = resolveSourceTrack;', context);
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

test('React list attribution fills every old segment and drops stale lookups on row reuse', async () => {
  const mobile = path.join(__dirname, '../mobile-rn');
  const dep = name => require(require.resolve(name, { paths: [mobile] }));
  const React = dep('react'), { act, create } = dep('react-test-renderer'), babel = dep('@babel/core');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const disk = new Map(), pending = new Map(), calls = [], opened = [];
  const mockWindow = { biuActions: { openUpPage: mid => opened.push(mid) }, api: { view: bvid => {
    calls.push(bvid); return new Promise(resolve => pending.set(bvid, resolve));
  } } };
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(__dirname, '../web/src', relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file, configFile: false, babelrc: false,
      plugins: [require.resolve('@babel/plugin-transform-react-jsx', { paths: [mobile] }),
        require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [mobile] })],
    });
    const req = name => {
      if (name === 'react') return React;
      if (name.endsWith('renderer/track-source.js')) return require('../renderer/track-source');
      return load(path.relative(path.join(__dirname, '../web/src'), path.resolve(path.dirname(file), name)));
    };
    new Function('require', 'module', 'exports', 'localStorage', 'window', code)(req, module, module.exports,
      { getItem: key => disk.get(key), setItem: (key, value) => disk.set(key, value) }, mockWindow);
    return module.exports;
  }
  const { TrackAttribution } = load('views/TrackAttribution.jsx');
  const a = { isSegment: true, bvid: 'A', title: '歌曲一', up: '歌手一' };
  let tracks = [a, { ...a, title: '歌曲二' }], tree;
  const render = () => React.createElement('rows', null, tracks.map((track, i) => React.createElement('row', { key: i },
    React.createElement(TrackAttribution, { track }), React.createElement(TrackAttribution, { track, artist: true }))));
  await act(async () => { tree = create(render()); });
  assert.deepEqual(calls, ['A'], 'every row and artist share one source request');
  await act(async () => pending.get('A')({ title: '原视频A', owner: { name: '原UP A', mid: 42 } }));
  assert.equal(tree.root.findAllByType('button').length, 2);
  for (const row of tree.root.findAllByType('row')) {
    assert.equal(row.findByProps({ className: 'track-source' }).children.join(''), '· 原视频A');
  }
  let stopped = 0;
  await act(async () => tree.root.findAllByType('button')[0].props.onClick({ stopPropagation() { stopped++; } }));
  assert.deepEqual(opened, [42]); assert.equal(stopped, 1);
  tracks = [{ ...a, bvid: 'B', title: '歌曲三' }];
  await act(async () => tree.update(render()));
  assert.equal(tree.root.findAllByType('button').length, 0, 'reused row immediately drops the previous UP');
  tracks = [{ title: '普通视频', up: '普通UP' }];
  await act(async () => tree.update(render()));
  await act(async () => pending.get('B')({ title: '原视频B', owner: { name: '原UP B', mid: 99 } }));
  assert.equal(tree.root.findAllByType('button').length, 0);
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /原视频A|原视频B/);
  tracks = [a]; await act(async () => tree.update(render()));
  assert.equal(tree.root.findAllByType('button').length, 1, 'returning uses the persisted source');
  assert.deepEqual(calls, ['A', 'B']);
  assert.equal(a.parentTitle, undefined, 'recognized track identity remains unchanged');
  await act(async () => tree.unmount());
});
