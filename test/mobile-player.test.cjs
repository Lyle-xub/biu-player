const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../mobile-rn');
const fromMobile = (name) => require(require.resolve(name, { paths: [root] }));
const React = fromMobile('react');
const { act, create } = fromMobile('react-test-renderer');
const babel = fromMobile('@babel/core');
global.IS_REACT_ACT_ENVIRONMENT = true;
const compute = require('../mobile-rn/scripts/build-compute.cjs');
const runCompute = require(compute())();

function loader(mocks = {}) {
  const emptyAI={};
  mocks = {
    'src/recommendation/localAnalysis': {analysis:{observe(){},evidence(){return {};},pause(){}},setAnalysisPlaybackBusy(){},modelManager:{ready:async()=>{},subscribe:()=>()=>{},getSnapshot:()=>emptyAI}},
    'src/performance/backgroundCompute': { backgroundCompute: async (operation, ...args) => runCompute(operation, ...args) },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    'biu-lyric-monet': {},
    'src/screens/discoveryQueue': { DISCOVERY_TARGET: 24, DISCOVERY_LOW_WATER: 12, readDiscoveryQueue: async () => [], writeDiscoveryQueue: async () => {} },
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    'expo-crypto': { getRandomBytes: (count) => new Uint8Array(require('node:crypto').randomBytes(count)) },
    'src/components/QrCode': (props) => React.createElement('QrCode', props),
    'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} },
    'expo-asset': { Asset: { fromModule: () => ({ downloadAsync: async () => {}, localUri: null }) } },
    'expo-application': { nativeApplicationVersion: '1.0.6', nativeBuildVersion: '20' },
    'biu-lyrics-pip': { setLyricsPiPEnabled() {}, updateLyricsPiP() {}, extractCoverColor: async () => null },
    'src/widgets/LyricsWidgets': { LyricsLiveActivity: { getInstances: () => [], start() {} }, LyricsWidget: { updateSnapshot() {} } },
    'expo-sharing': { isAvailableAsync: async () => false, shareAsync: async () => {} },
    'react-native-gesture-handler/ReanimatedSwipeable': (props) => React.createElement('Swipeable', props, props.children, props.renderRightActions?.()),
    'react-native-view-shot': { captureRef: async () => 'fixture.png' },
    'src/updates/service': { appUpdates: {}, useAppUpdates: () => ({ supported: false, loaded: false }) },
    ...mocks,
  };
  mocks['@shopify/flash-list'] ||= { FlashList: props => React.createElement(rn.FlatList, props) };
  mocks['@react-navigation/native'] ||= {};
  mocks['react-native-gesture-handler'] = { PanGestureHandler: 'PanGestureHandler',
    State: { BEGAN: 2, ACTIVE: 4, END: 5, CANCELLED: 3 }, ...mocks['react-native-gesture-handler'] };
  mocks['@react-navigation/native'].NavigationContext ||= React.createContext(null);
  mocks['@react-navigation/native'].NavigationRouteContext ||= React.createContext(undefined);
  mocks['src/store/largeStorage'] ||= mocks['@react-native-async-storage/async-storage'];
  mocks['src/store/largeStorage'].hasItem ||= async key => await mocks['src/store/largeStorage'].getItem(key) != null;
  const mockBili = mocks['src/api/bili'];
  if (mockBili && !mockBili.cachedFavFolders) mockBili.cachedFavFolders = async () => [];
  if (mockBili && !mockBili.homeRecommendations) mockBili.homeRecommendations = (page, limit, options) =>
    options.music ? mockBili.personalizedMusicRecommendations(page, limit, options.onBatch, options)
      : mockBili.personalizedRecommendations(page, limit, options);
  const cache = new Map();
  const load = (file) => {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.js';
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file, configFile: false, babelrc: false,
      plugins: [require.resolve('@babel/plugin-transform-react-jsx', { paths: [root] }),
        require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [root] })],
    });
    const req = (name) => {
      if (name in mocks) return mocks[name];
      if (name === 'react-native') return rn;
      if (name.startsWith('.')) {
        const target = path.resolve(path.dirname(file), name);
        const relative = path.relative(root, target).replaceAll('\\', '/');
        return relative in mocks ? mocks[relative] : load(target);
      }
      try { return fromMobile(name); } catch (error) { error.message = `${name} imported by ${path.relative(root, file)}: ${error.message}`; throw error; }
    };
    new Function('require', 'module', 'exports', code)(req, module, module.exports);
    return module.exports;
  };
  return load;
}

const motion = loader({ 'biu-lyric-monet': {} })('src/player/lyricMotion.js');
const trackModel = loader()('src/player/track.js');

test('discovery card gesture resolves native pixel velocities and wheel targets', () => {
  const { resolveDiscoveryGesture, cardExitTiming } = loader()('src/screens/discoveryGesture.js');
  const base = { index: 3, trackCount: 12, targetCount: 5 };
  assert.deepEqual(resolveDiscoveryGesture({ ...base, dx: 4, dy: -80, vx: 0, vy: -250 }),
    { type: 'next', nextIndex: 4 });
  assert.deepEqual(resolveDiscoveryGesture({ ...base, dx: -20, dy: -2, vx: -700, vy: 0 }),
    { type: 'related', nextIndex: 3 });
  assert.deepEqual(resolveDiscoveryGesture({ ...base, dx: 140, dy: -121, vx: 600, vy: 0, dragging: true, targetIndex: 2 }),
    { type: 'target', nextIndex: 4, targetIndex: 2 });
  assert.deepEqual(resolveDiscoveryGesture({ ...base, dx: 10, dy: 12, vx: 10, vy: 15 }),
    { type: 'cancel', nextIndex: 3 });
  assert.deepEqual(resolveDiscoveryGesture({ ...base, index: 0, dx: 0, dy: 80, vx: 0, vy: 600 }),
    { type: 'dislike', nextIndex: 1 }, 'the first card can also be disliked');
  const slow = cardExitTiming(-90, -600, -300), fast = cardExitTiming(-90, -600, -4000);
  assert.ok(fast.duration < slow.duration);
  assert.equal(cardExitTiming(90, 600, 4000).duration, fast.duration, 'up and down use the same speed response');
  assert.equal(cardExitTiming(-590, -600, -20000).duration, 120);
  assert.equal(cardExitTiming(-90, -2000, 100).duration, 280);
  assert.equal(fast.easing(0), 0); assert.equal(fast.easing(1), 1);
  assert.ok(fast.easing(1 / 60) > 1 / 60, 'the first frame is already moving');
});

test('discovery wheel loops in both directions, coasts independently of frame rate and finds every folder with one held pointer', () => {
  const m = loader()('src/screens/discoveryGesture.js');
  for (const count of [2, 5, 17, 80]) {
    const width = 390, height = 520;
    const { radius, halfHeight } = m.wheelGeometry(count, height);
    for (let slot = 0; slot < count * 2; slot++) {
      const angle = -slot * 180 / count;
      assert.equal(m.wheelHit(width - 52, height / 2, width, height, angle, count), slot);
      for (const laps of [-200, -1, 1, 200]) {
        const p = m.wheelPosition(slot, angle + laps * 360, count, radius);
        assert.ok(Math.abs(p.x) < 1e-8 && Math.abs(p.y) < 1e-8);
      }
    }
    assert.equal(m.wheelEdgeSpeed(width - 52, height / 2, width, height, count), 0);
    assert.equal(m.wheelEdgeSpeed(0, 0, width, height, count), 0);
    const edgeY = height / 2 + halfHeight - 8;
    assert.ok(m.wheelEdgeSpeed(width - 52, edgeY, width, height, count)
      > m.wheelEdgeSpeed(width - 52, edgeY - 25, width, height, count));
    for (const sign of [-1, 1]) {
      const pointerY = height / 2 + sign * (halfHeight - 8);
      let angle = 0;
      const visited = new Set();
      for (let frame = 0; frame < count * 160; frame++) {
        angle = m.wrap(angle + m.wheelEdgeSpeed(width - 10, pointerY, width, height, count) / 60, 360);
        const slot = m.wheelHit(width - 10, pointerY, width, height, angle, count);
        if (slot >= 0) visited.add(slot % count);
      }
      assert.equal(visited.size, count, `edge ${sign} must reach all ${count} folders without another pointer`);
    }
  }
  const coast = (hz, velocity) => {
    let state = { rotation: 0, velocity };
    for (let i = 0; i < hz; i++) state = m.coastWheel(state.rotation, state.velocity, 1 / hz);
    return state;
  };
  assert.ok(Math.abs(coast(60, 600).rotation - coast(120, 600).rotation) < 1e-8);
  assert.ok(coast(60, 600).rotation > coast(60, 100).rotation * 5);
  let state = { rotation: 0, velocity: -900 };
  for (let i = 0; i < 500; i++) state = m.coastWheel(state.rotation, state.velocity, 1 / 60);
  assert.equal(state.velocity, 0);
  const gesture = { dx: 100, dy: -320, vx: 0, vy: -900, index: 0, trackCount: 3, dragging: true };
  assert.deepEqual(m.resolveDiscoveryGesture({ ...gesture, targetIndex: 4 }), { type: 'target', nextIndex: 1, targetIndex: 4 });
  assert.deepEqual(m.resolveDiscoveryGesture(gesture), { type: 'cancel', nextIndex: 0 });
});

test('system lyric slots alternate 1/2, 3/2, 3/4 and recover after seeks without interlude parity drift', () => {
  const model = loader({ 'biu-lyric-monet': {} })('src/player/systemLyrics.js');
  const lines = model.prepareSystemLyrics([
    { from: 0, to: 3, text: '第一句' },
    { from: 3, to: 6, text: '第二句' },
    { from: 6, to: 8, text: '......', interlude: true },
    { from: 8, to: 11, text: '第三句' },
    { from: 11, to: 14, text: '第四句' },
    { from: 14, to: 17, text: '第五句' },
  ]);
  const at = (time) => {
    const result = model.systemLyricSlots(lines, time);
    return [result.activeSlot, result.slots.map((line) => line?.text || '')];
  };
  assert.deepEqual(at(-1), [0, ['第一句', '第二句']]);
  assert.deepEqual(at(2.99), [0, ['第一句', '第二句']]);
  assert.deepEqual(at(3), [1, ['第三句', '第二句']]);
  assert.deepEqual(at(6), [1, ['第三句', '第二句']],
    'the completed line stays focused through an instrumental gap');
  assert.deepEqual(at(8), [0, ['第三句', '第四句']], 'the row changes when the next lyric starts');
  assert.deepEqual(at(11), [1, ['第五句', '第四句']]);
  assert.deepEqual(at(9), [0, ['第三句', '第四句']], 'backward seeks recover the same physical slots');
  assert.deepEqual(at(99), [0, ['第五句', '']]);
  assert.deepEqual(model.systemLyricSlots([], 0), { slots: [null, null], activeSlot: 0 });
  assert.equal(lines[0].words.at(-1)[0], 3, 'compact word timing retains every grapheme');
  const realistic = model.prepareSystemLyrics(Array.from({ length: 2 }, (_, i) => ({
    text: '如果有一天我们沿着这条漫长的街道继续向前走去直到看见远方微弱的光芒', from: i * 10, to: i * 10 + 10,
  })));
  assert.equal(realistic[0].words.length, 1,
    'line-timed LRC follows Folia as one timed token instead of guessed concurrent words');
  assert.ok(Buffer.byteLength(JSON.stringify(model.systemLyricSlots(realistic, 5))) < 3000,
    'word timing leaves room for metadata within ActivityKit’s 4 KB content budget');
});

test('Monet punctuation shares the adjacent word clock without losing text or moving word boundaries', () => {
  const tokens = motion.buildLineTokens('“Hello, 世界！”', 2, 8);
  assert.equal(tokens.map((t) => t.text).join(''), '“Hello, 世界！”');
  assert.ok(tokens.every((t) => t.timed), 'visible punctuation cannot be skipped by the renderer');
  assert.equal(tokens[0].t0, 2);
  assert.equal(tokens.at(-1).t1, 8);
  const source = [
    { text: '「', timed: false }, { text: '你好', timed: true, t0: 1, t1: 2 },
    { text: '， ', timed: false }, { text: '世界', timed: true, t0: 3, t1: 4 },
    { text: '！」', timed: false },
  ];
  const joined = motion.joinLyricSeparators(source);
  assert.deepEqual(joined.map((t) => [t.text, t.t0, t.t1]), [['「你好， ', 1, 2], ['世界！」', 3, 4]]);
  assert.equal(source[1].text, '你好', 'cached source tokens are not mutated');
  const model = loader({ 'biu-lyric-monet': {} })('src/player/systemLyrics.js');
  const [line] = model.prepareSystemLyrics([{ text: source.map((t) => t.text).join(''), from: 1, to: 4, tokens: source }]);
  assert.ok(line.words.every((word) => word[1] >= 0 && word[2] > word[1]));
  assert.equal(line.words.at(-1)[0], motion.splitLyricGraphemes(line.text).length);
});

test('system lyric renderers avoid unsupported widget lifecycle clocks and preserve seek identity', () => {
  const swift = fs.readFileSync(path.join(root, 'node_modules/expo-widgets/ios/Widgets/WidgetLiveActivity.swift'), 'utf8');
  const model = fs.readFileSync(path.join(root, 'node_modules/expo-widgets/ios/Widgets/BiuMonetLyrics.swift'), 'utf8');
  const sync = fs.readFileSync(path.join(root, 'src/components/LyricsActivitySync.js'), 'utf8');
  assert.match(swift, /\.id\("\\\(payload\.animationID\):\\\(line\.id\):\\\(pageIndex\)"\)/);
  assert.doesNotMatch(swift, /line\.id\):\\\(focused/,
    'focus changes cannot recreate a short-line scan view');
  assert.match(swift, /ProgressView\(timerInterval: interval, countsDown: false\)/,
    'system-owned date progress advances without repeated activity animations');
  assert.match(swift, /BiuSystemLyricSweep\(text: text/,
    'the whole line and its highlight remain in one coordinate system');
  assert.match(swift, /\.offset\(x: inset \+ origin\)/);
  assert.match(swift, /\.clipped\(\)/, 'the scrolling viewport crops content without fading it');
  assert.match(swift, /Image\(decorative: bitmap/, 'stable glyph bitmaps avoid system text replacement fades');
  assert.doesNotMatch(swift, /scrollToEnd|scrollDuration/, 'hard-cut pages have no scrolling animation targets');
  assert.match(swift, /let started = focused && time >= line.from/, 'future lyrics cannot start their timer early');
  assert.match(swift, /glyphImage\(\)\.foregroundStyle\(biuLyricText\)\.mask/,
    'the system timer layer reveals glyphs directly, without a JS progress callback');
  assert.match(swift, /\.contentTransition\(\.identity\)/,
    'text changes must disable WidgetKit default blurred content transitions');
  assert.match(swift, /\.animation\(nil, value: focused\)/,
    'focus and highlight replacement must not inherit the one-second scan animation');
  assert.doesNotMatch(swift + model, /var animatableData|\.animation\(nil, value: time\)/,
    'remote snapshots animate standard masks and offsets, not a custom app-side clock');
  assert.doesNotMatch(swift, /TimelineView|@State|Transaction\(|\.onAppear|\.onChange|\.id\(payload\.updatedAt/,
    'remote WidgetKit rendering cannot depend on App view lifecycle callbacks or transactions');
  assert.doesNotMatch(swift, /BiuMonetStrip|BiuSimpleLyricStrip/,
    'a new snapshot cannot restart a one-second glyph animation');
  assert.match(swift, /DynamicIslandExpandedRegion\(\.bottom\)/,
    'expanded lyrics use the widest Dynamic Island region available to apps');
  assert.doesNotMatch(model, /min\(0\.75/,
    'delayed ActivityKit updates cannot freeze the clock after 0.75 seconds');
  assert.match(sync, /_timeline: preparedLines/,
    'native playback receives the full timeline so delayed JS cannot freeze line changes');
  assert.match(swift, /payload\.backgroundColor/,
    'the Live Activity background uses the color extracted from current artwork');
  const observer = fs.readFileSync(path.join(root, 'node_modules/expo-video/ios/VideoPlayerObserver.swift'), 'utf8');
  const controls = fs.readFileSync(path.join(root, 'node_modules/expo-video/ios/NowPlayingManager.swift'), 'utf8');
  assert.match(observer, /addPeriodicTimeObserver[\s\S]*?self\?\.publishBiuPlaybackClock\(\)/);
  assert.match(observer, /Notification\.Name\("BiuPlayerPlaybackClock"\)/);
  assert.doesNotMatch(controls, /Notification\.Name\("BiuPlayerPlaybackClock"\)/,
    'the lyric clock must survive a missing or replaced Now Playing card');
});

test('anonymous music ranking falls back on -352 while preserving other failures', async () => {
  const requests = [];
  let code = -352;
  const api = loader({ './client': { get: async (url) => {
    requests.push(url);
    return { status: 200, body: JSON.stringify(url.includes('/ranking/v2')
      ? { code, message: String(code) }
      : { code: 0, data: [{ bvid: 'BVguest', title: '音乐榜', duration: 30, owner: { name: 'UP' } }] }) };
  } } })('src/api/bili.js');
  assert.equal((await api.ranking())[0].bvid, 'BVguest');
  assert.equal(requests.length, 2);
  assert.match(requests[1], /ranking\/region\?rid=3&day=3&original=0$/);
  code = -500;
  await assert.rejects(api.ranking(), (error) => error.code === -500);
  assert.equal(requests.length, 3, 'unrelated failures are not retried against other endpoints');
});

test('system lyrics share offsets and seek timing, and cannot return after disable or unmount', async () => {
  let state = {
    current: { bvid: 'lyrics-a', title: 'A' }, position: 7, playing: false, buffering: false, mediaDeferred: true,
    lyricSettings: { 'lyrics-a': { offset: 2 } }, seekRevision: 0,
    desktopLyricsEnabled: true, lockScreenLyricsEnabled: true, dynamicIslandLyricsEnabled: true,
  };
  const events = [], pip = [], snapshots = [], pipFrames = [];
  let releaseLyrics;
  const loadedLyrics = new Promise((resolve) => { releaseLyrics = resolve; });
  let instances = [], holdUpdate = null;
  const makeInstance = (name) => ({
    update: async (payload) => {
      events.push(['update', payload]);
      if (holdUpdate) await holdUpdate;
    },
    end: async (policy) => {
      events.push(['end', name, policy]);
      instances = instances.filter((item) => item !== instanceByName[name]);
    },
  });
  const instanceByName = { old: makeInstance('old') };
  instances = [instanceByName.old];
  let starts = 0, lyricLoads = 0, coverLoads = 0;
  const Sync = loader({
    'react-native': { Platform: { OS: 'ios' } },
    'biu-lyric-monet': {},
    'src/player/PlayerContext': { usePlayer: () => state, usePlaybackProgress: () => state },
    'src/player/track': { trackKeyOf: (track) => track?.bvid || '', segmentRange: trackModel.segmentRange },
    'src/player/loadLyrics': { loadTrackLyrics: () => { lyricLoads++; return loadedLyrics; } },
    'src/player/coverColor': { loadCoverColor: async () => { coverLoads++; return null; } },
    'src/widgets/LyricsWidgets': {
      LyricsWidget: { updateSnapshot: (props) => {
        // Expo Widgets writes props straight into UserDefaults, which rejects
        // null (including an empty lyric slot nested in an array).
        const checkPropertyList = (value) => {
          assert.notEqual(value, null, 'widget snapshots must be valid property lists');
          assert.notEqual(value, undefined);
          if (typeof value === 'object') Object.values(value).forEach(checkPropertyList);
        };
        checkPropertyList(props);
        snapshots.push(props);
      } },
      LyricsLiveActivity: {
        getInstances: () => instances.slice(),
        start: (payload) => {
          const name = `new-${++starts}`;
          events.push(['start', payload]);
          instanceByName[name] = makeInstance(name);
          instances.push(instanceByName[name]);
        },
      },
    },
    'biu-lyrics-pip': {
      setLyricsPiPEnabled: (value) => pip.push(value), updateLyricsPiP: (frame) => pipFrames.push(frame),
    },
  })('src/components/LyricsActivitySync.js').default;
  let tree;
  const latest = () => events.filter(([type]) => type === 'start' || type === 'update').at(-1)[1];
  const update = async (patch) => {
    state = { ...state, ...patch };
    await act(async () => { tree.update(React.createElement(Sync)); });
  };
  await act(async () => { tree = create(React.createElement(Sync)); });
  assert.equal(lyricLoads, 0, 'a restored paused bar does not fetch lyrics during cold startup');
  assert.equal(coverLoads, 0, 'a restored paused bar does not decode colors or prefetch covers');
  assert.equal(starts, 0, 'cold startup does not create a new live activity');
  assert.equal(snapshots.at(-1).playing, false, 'the persisted widget is not left playing');
  await update({ mediaDeferred: false, playing: true });
  assert.equal(lyricLoads, 1);
  assert.deepEqual(events[0], ['end', 'old', 'immediate'], 'cold launch removes the orphan before starting');
  assert.equal(snapshots.at(-1).currentLine, '', 'cold launch publishes before lyrics have loaded');
  assert.deepEqual(pipFrames.at(-1).slots, [null, null], 'PiP retains the two empty JSON slots');
  await act(async () => { releaseLyrics([
    { from: 0, to: 10, text: '第一句' }, { from: 10, to: 20, text: '第二句很长也不缩小字号' },
  ]); });
  assert.equal(latest().position, 9);
  assert.equal(latest().slots[latest().activeSlot].text, '第一句');
  assert.equal(latest().activeSlot, 0);
  assert.deepEqual(latest().slots.map((line) => line?.text), ['第一句', '第二句很长也不缩小字号']);
  assert.equal((latest().position - latest().slots[0].from) / (latest().slots[0].to - latest().slots[0].from), 0.9);
  await update({ lyricSettings: { 'lyrics-a': { offset: 4 } } });
  assert.equal(latest().position, 11);
  assert.equal(latest().slots[latest().activeSlot].text, '第二句很长也不缩小字号');
  assert.equal(latest().activeSlot, 1);
  assert.equal(latest().slots[0], null, 'the final line stays in its original lower slot');
  assert.equal(snapshots.at(-1).currentLine, '第二句很长也不缩小字号');
  assert.equal(snapshots.at(-1).nextLine, '');
  assert.equal(pipFrames.at(-1).slots[0], null, 'PiP keeps the final line in the lower slot too');
  const snapshotCount = snapshots.length;
  await update({ position: 7.1, seekRevision: 1 });
  assert.equal(latest().position, 11.1, 'a seek inside the same half-second bucket still publishes');
  assert.equal(latest().clockRevision, 'lyrics-a:1:4');
  assert.equal(snapshots.length, snapshotCount, 'unchanged text does not reload the static widget');
  assert.equal(pipFrames.at(-1).position, 11.1, 'PiP animation still receives progress when widget text is unchanged');
  assert.equal(latest()._audioOffset, 4);
  assert.equal(latest()._timeline.length, 2);
  const activityCount = events.length;
  await update({ position: 8.1 });
  assert.equal(events.length, activityCount, 'ordinary JS progress must not compete with native ActivityKit updates');
  await update({ buffering: true });
  assert.equal(latest().playing, false, 'a buffering player cannot advance the lyric clock');
  await update({ buffering: false, playing: false });
  assert.equal(latest().playing, false);
  let release;
  holdUpdate = new Promise((resolve) => { release = resolve; });
  await update({ position: 8, seekRevision: 2 });
  await update({ desktopLyricsEnabled: false, lockScreenLyricsEnabled: false, dynamicIslandLyricsEnabled: false });
  await act(async () => { release(); await holdUpdate; });
  holdUpdate = null;
  assert.equal(instances.length, 0, 'disabling waits for the old update, then removes both Live Activity surfaces');
  assert.equal(pip.at(-1), false);
  await update({ desktopLyricsEnabled: true, lockScreenLyricsEnabled: true, dynamicIslandLyricsEnabled: true });
  assert.equal(instances.length, 1);
  await act(async () => { tree.unmount(); });
  assert.equal(instances.length, 0);
  assert.equal(pip.at(-1), false);
});

test('desktop lyric cover colors prefetch, share split-track requests and never flash a default on switches', async () => {
  const pending = new Map(), calls = [], frames = [];
  const tracks = ['a', 'b', 'c'].map(bvid => ({ bvid, pic: `//covers/${bvid}` }));
  let state = { current: tracks[0], queue: tracks, index: 0, position: 0, playing: true,
    lyricSettings: {}, desktopLyricsEnabled: true };
  const load = loader({
    'react-native': { Platform: { OS: 'ios' } },
    'src/player/PlayerContext': { usePlayer: () => state, usePlaybackProgress: () => state },
    'src/player/loadLyrics': { loadTrackLyrics: async () => [] },
    'biu-lyrics-pip': {
      setLyricsPiPEnabled() {}, updateLyricsPiP: frame => frames.push(frame),
      extractCoverColor: url => { calls.push(url); return new Promise(resolve => pending.set(url, resolve)); },
    },
  });
  const Sync = load('src/components/LyricsActivitySync.js').default;
  const { loadCoverColor } = load('src/player/coverColor.js');
  let tree;
  await act(async () => { tree = create(React.createElement(Sync)); });
  assert.deepEqual(calls.sort(), ['https://covers/a', 'https://covers/b', 'https://covers/c']);
  const a = [0.8, 0.2, 0.1], b = [0.1, 0.3, 0.9], c = [0.2, 0.7, 0.4];
  await act(async () => { pending.get('https://covers/a')(a); pending.get('https://covers/b')(b); });
  assert.deepEqual(frames.at(-1).coverColor, a);
  const switchTo = async index => {
    state = { ...state, current: tracks[index], index };
    await act(async () => { tree.update(React.createElement(Sync)); });
  };
  const before = frames.length;
  await switchTo(1);
  assert.deepEqual(frames.at(-1).coverColor, b, 'next track already has its extracted color');
  assert.ok(frames.slice(before).every(frame => frame.coverColor === a || frame.coverColor === b));
  await switchTo(2);
  assert.deepEqual(frames.at(-1).coverColor, b, 'uncached color retains previous background');
  await switchTo(1);
  await act(async () => pending.get('https://covers/c')(c));
  assert.deepEqual(frames.at(-1).coverColor, b, 'late response cannot recolor a newer song');
  assert.deepEqual(await loadCoverColor('http://covers/b'), b);
  assert.equal(calls.length, 3, 'same video/split cover and normalized URLs reuse the cache');
  const failed = loadCoverColor('https://covers/failure');
  await act(async () => { await Promise.resolve(); pending.get('https://covers/failure')(null); });
  assert.equal(await failed, null);
  const retry = loadCoverColor('https://covers/failure');
  await act(async () => { await Promise.resolve(); pending.get('https://covers/failure')(a); });
  assert.deepEqual(await retry, a, 'transient failures are retryable');
  await act(async () => tree.unmount());
});

test('desktop and mobile search returns playable videos from every partition', async () => {
  let detailCalls = 0;
  const searchUrls = [];
  const videos = [12, 30, 60].map((duration) => ({ bvid: 'BVshort' + duration, duration,
    type: 'video', goto: 'av', title: '短视频', tid: 3, owner: { mid: 1, name: 'UP' } }));
  const searchVideos = [
    { bvid: 'BVmusic12', duration: 12, type: 'video', goto: 'av', title: '音乐短视频',
      tid: 3, typename: '音乐', owner: { mid: 1, name: 'UP' } },
    { bvid: 'BVgame30', duration: 30, type: 'video', goto: 'av', title: '游戏短视频',
      tid: 4, typename: '游戏', owner: { mid: 2, name: '游戏 UP' } },
    // B 站视频搜索偶尔省略 type，bvid 才是播放器真正需要的字段。
    { bvid: 'BVknowledge60', duration: 60, goto: 'av', title: '知识短视频',
      tid: 36, typename: '知识', owner: { mid: 3, name: '知识 UP' } },
  ];
  const get = async (url) => {
    if (url.includes('/view?')) detailCalls++;
    if (url.includes('/search/type?')) searchUrls.push(url);
    const data = url.includes('/ranking/') ? { list: videos }
      : url.includes('/search/') ? { result: searchVideos.map((v) => ({ ...v, duration: '0:' + v.duration })) }
      : url.includes('/feed/') ? { item: videos }
      : videos.find((v) => v.bvid === new URL(url).searchParams.get('bvid'));
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  };
  const window = { bili: { get } };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(root, '../renderer/api.js'), 'utf8'),
    { window, URLSearchParams, console, setTimeout, clearTimeout });
  const mobile = loader({ './client': { get } })('src/api/bili.js');
  const ids = (list) => Array.from(list, (t) => t.bvid);
  for (const api of [window.api, mobile]) {
    assert.deepEqual(ids(await api.ranking()), videos.map((v) => v.bvid));
    const found = (await api.search('短视频')).list;
    assert.deepEqual(ids(found), searchVideos.map((v) => v.bvid));
    assert.deepEqual(Array.from(found, (track) => track.tname), ['音乐', '游戏', '知识']);
    assert.deepEqual(ids(await (api.recommendMusic ? api.recommendMusic() : api.personalizedMusicRecommendations())),
      videos.map((v) => v.bvid));
  }
  assert.equal(searchUrls.length, 2);
  assert.ok(searchUrls.every((url) => url.includes('search_type=video') && !url.includes('tids=')),
    'user search requests every video partition');
  const before = detailCalls;
  assert.deepEqual(ids(await window.api.recommendMusic(0, 12, 'all')), videos.map((v) => v.bvid));
  assert.equal(detailCalls, before, 'all-category recommendations use the platform feed without music detail filtering');
});

test('mobile requests use the application cookie jar and pause searches after a server limit', async () => {
  const originalFetch = global.fetch, calls = [];
  let retryAfter = null;
  const client = loader({ '@react-native-async-storage/async-storage': {
    getItem: async () => JSON.stringify({ buvid3: 'visitor', SESSDATA: 'current-session' }), setItem: async () => {},
  } })('src/api/client.js');
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { status: url.includes('/search/') && (calls.length === 1 || retryAfter) ? 412 : 200,
      headers: { get: (name) => name === 'retry-after' ? retryAfter : null }, text: async () => '{}' };
  };
  try {
    const first = await Promise.all([1, 2, 3].map((page) => client.get(
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=' + page)));
    assert.deepEqual(first.map((r) => r.status), [412, 200, 200]);
    assert.equal(calls.length, 3, 'one HTTP 412 cannot fabricate rate limits for other pages');
    retryAfter = '120';
    const responses = await Promise.all([4, 5, 6].map((page) => client.get(
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=' + page)));
    assert.deepEqual(responses.map((r) => r.status), [412, 429, 429]);
    assert.equal(calls.length, 4, 'queued searches must respect an explicit Retry-After');
    assert.equal(calls[0].options.credentials, 'omit');
    assert.match(calls[0].options.headers.Cookie, /SESSDATA=current-session/);
    assert.match(calls[0].options.headers.Cookie, /buvid3=visitor/);
    assert.equal((await client.get('https://api.bilibili.com/x/web-interface/view?bvid=BVplay')).status, 200);
    assert.equal(calls.length, 5, 'search cooldown must not block playback requests');
  } finally { global.fetch = originalFetch; }
});

test('Monet sweep crosses glyph interiors continuously, clears the last glyph and respects timing gaps / seek', () => {
  const token = { text: 'Wi中', t0: 10, t1: 13 };
  const offsets = [0, 28, 35, 65];
  assert.equal(motion.sweepEndAt(9, token, offsets, 12), 0);
  assert.equal(motion.sweepEndAt(13, token, offsets, 12), 77);
  const at = (t) => motion.sweepEndAt(t, token, offsets, 12);
  assert.ok(at(10.25) > 0 && at(10.25) < at(10.5));
  assert.ok(at(11.51) - at(11.50) < 0.1, 'narrow i moves by its measured width');
  assert.ok(at(12.51) - at(12.50) > 0.3, 'CJK glyph uses a wider sweep');
  const timed = { ...token, graphemeTimings: [
    { startTime: 10, endTime: 10.5 }, { startTime: 11, endTime: 11.5 }, { startTime: 12, endTime: 13 },
  ] };
  assert.equal(motion.sweepEndAt(10.6, timed, offsets, 12), motion.sweepEndAt(10.9, timed, offsets, 12));
  assert.equal(motion.sweepEndAt(10, token, offsets, 12), 0, 'backward seek resets fill');
  assert.equal(motion.lyricTimeAt({ pos: 2, ts: 1000, playing: false }, 9000), 2);
  assert.equal(motion.lyricTimeAt({ pos: 2, ts: 1000, playing: true }, 9000), 2.6, 'stale tick cannot run away');
  assert.equal(motion.glowAt(10, token, 15), 0);
  assert.ok(motion.glowAt(13, token, 15) > 0.8);
  assert.equal(motion.glowAt(17, token, 15), 0);
  const tokens = motion.buildLineTokens('Hello，世界！', 1, 5);
  assert.equal(tokens.map((t) => t.text).join(''), 'Hello，世界！');
  assert.ok(Math.abs(tokens.filter((t) => t.timed).at(-1).t1 - 5) < 1e-8);
  assert.deepEqual(motion.fallbackLyricWordSegments('正在播放这首歌，OK').map((t) => t.segment),
    ['正在播放', '这首歌', '，', 'OK'], 'Hermes fallback keeps glow on shaped word runs instead of isolated glyph tiles');
});

test('segment track identities distinguish two songs from one video; invalid ranges are rejected', () => {
  const tracks = trackModel.segmentTracks({ bvid: 'BV1', cid: 4, title: 'Mix' }, [
    { from: 0, to: 10, name: 'One' }, { from: 10, to: 30, name: 'Two' },
  ]);
  assert.notEqual(trackModel.trackKeyOf(tracks[0]), trackModel.trackKeyOf(tracks[1]));
  assert.deepEqual(trackModel.segmentRange(tracks[1]), { from: 10, to: 30 });
  assert.equal(tracks[1].duration, 20);
  assert.equal(trackModel.segmentRange({ isSegment: true, from: 10, to: 5 }), null);
  const matched = trackModel.segmentTracks({ bvid: 'BV1', cid: 4, mid: 42, title: 'Mix', up: 'Uploader' }, [
    { from: 10, to: 30, name: 'Draft', match: { title: 'Song', artist: 'Singer', pic: 'cover', source: 'shazam', lrcSource: 'qq', songmid: 'q1' } },
  ])[0];
  assert.equal(matched.title, 'Song'); assert.equal(matched.up, 'Singer'); assert.equal(matched.pic, 'cover');
  assert.equal(matched.parentTitle, 'Mix'); assert.equal(matched.parentUp, 'Uploader'); assert.equal(matched.parentMid, 42);
  assert.equal(matched.mid, undefined, 'recognized artist is not paired with the source uploader mid');
  assert.deepEqual(matched.lyricRef, { source: 'qq', id: undefined, songmid: 'q1' });
});

test('timestamp parser handles hour marks, duplicate / invalid times and numeric song names', () => {
  const api = loader({ './client': {} })('src/api/bili.js');
  const list = api.parseTimestampLines('00:00 1984\n00:02 Two\n00:02 Duplicate\n01:75 invalid\n1:00:00 Hour\n1:01:00 outside', 3660);
  assert.deepEqual(list, [{ from: 0, to: 2, name: '1984' }, { from: 2, to: 3600, name: 'Two' }, { from: 3600, to: 3660, name: 'Hour' }]);
  assert.deepEqual(api.parseTimestampLines('TRACK 01 AUDIO\nTITLE "One"\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nTITLE "Two"\nINDEX 01 03:10:30', 400),
    [{ from: 0, to: 190.4, name: 'One' }, { from: 190.4, to: 400, name: 'Two' }]);
});

test('personalized music recommendations preserve personalization while excluding other partitions', async () => {
  const feed = [
    { goto: 'av', bvid: 'BVMusic', id: 1, title: 'Music', duration: 180,
      owner: { mid: 1, name: 'Singer' }, rcmd_reason: { content: '因为你常听音乐' } },
    { goto: 'av', bvid: 'BVAnime', id: 2, title: 'Anime', duration: 180,
      owner: { mid: 2, name: 'Author' } },
  ];
  const api = loader({ './client': { get: async (url) => {
    const data = url.includes('/feed/rcmd')
      ? { item: feed }
      : url.includes('BVMusic')
        ? { aid: 1, cid: 11, tid: 3, tname: '音乐', owner: { mid: 1 } }
        : { aid: 2, cid: 22, tid: 1, tname: '动画', owner: { mid: 2 } };
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  } } })('src/api/bili.js');
  const all = await api.personalizedRecommendations(0, 20);
  assert.deepEqual(all.map((item) => item.bvid), ['BVMusic', 'BVAnime']);
  const music = await api.personalizedMusicRecommendations(0, 20);
  assert.deepEqual(music.map((item) => item.bvid), ['BVMusic']);
  assert.equal(music[0].recommendationReason, '因为你常听音乐');
});

test('playlist default art is deterministic and favorite covers keep their first observed state', async () => {
  const writes = new Map(); let writeCount = 0;
  const load = loader({
    'react-native': { View: 'View', StyleSheet: { create: (x) => x, absoluteFill: {} } },
    'react-native-svg': Object.assign({ default: 'Svg', __esModule: true },
      Object.fromEntries(['Circle', 'Defs', 'Ellipse', 'LinearGradient', 'Path', 'Rect', 'Stop'].map((name) => [name, name]))),
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => writes.get(key) ?? null,
      setItem: async (key, value) => { writeCount += 1; writes.set(key, value); },
    },
  });
  const covers = load('src/components/DefaultCover.js');
  assert.equal(covers.defaultCoverSeed(12345), covers.defaultCoverSeed(12345));
  assert.deepEqual(covers.coverDesign(23), covers.coverDesign(23));
  assert.notDeepEqual(covers.coverDesign(23), covers.coverDesign(24));

  const { stabilizeFavoriteCovers } = load('src/store/favoriteCovers.js');
  const first = await stabilizeFavoriteCovers(9, [
    { id: 1, pic: 'https://cdn/first.jpg' }, { id: 2, pic: null },
  ]);
  const refreshed = await stabilizeFavoriteCovers(9, [
    { id: 1, pic: 'https://cdn/changed.jpg' }, { id: 2, pic: 'https://cdn/late.jpg' },
  ]);
  assert.equal(first[0].pic, 'https://cdn/first.jpg');
  assert.equal(refreshed[0].pic, 'https://cdn/first.jpg', 'an API refresh cannot replace the folder cover');
  assert.equal(refreshed[1].pic, null, 'a folder first seen without art keeps its generated default');
  assert.equal(refreshed[1].seed, first[1].seed);
  assert.equal(writeCount, 1, 'an unchanged refresh does not rewrite native storage');
});

test('remote covers request bounded CDN images, rotate hosts and respect a cached collage’s zero transition', async () => {
  const load = loader({
    react: React,
    'react-native': rn,
    'expo-image': { Image: 'ExpoImage' },
    'src/api/client': { imageHeaders: () => ({ Referer: 'https://www.bilibili.com/' }) },
  });
  const { optimizedImageUri, default: RemoteImage } = load('src/components/RemoteImage.js');
  const source = 'http://i0.hdslb.com/bfs/archive/cover.jpg';
  assert.equal(optimizedImageUri(source, 720, 450),
    'https://i0.hdslb.com/bfs/archive/cover.jpg@720w_450h_1c.webp');
  assert.equal(optimizedImageUri(source, 720, 450, 1),
    'https://i1.hdslb.com/bfs/archive/cover.jpg@720w_450h_1c.webp');
  assert.equal(optimizedImageUri(source, 720, 450, 2),
    'https://i2.hdslb.com/bfs/archive/cover.jpg@720w_450h_1c.webp');
  assert.equal(optimizedImageUri('https://covers.example/a.jpg', 720, 450),
    'https://covers.example/a.jpg');
  let tree;
  await act(async () => { tree = create(React.createElement(RemoteImage, { uri: source, width: 120, height: 120, transition: 0, cachePolicy: 'memory-disk' })); });
  assert.equal(tree.root.findByType('ExpoImage').props.transition, 0);
  assert.equal(tree.root.findByType('ExpoImage').props.cachePolicy, 'memory-disk');
  await act(async () => tree.unmount());
});

test('account avatars use HTTPS without changing login state or CDN signatures', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const client = loader({ '@react-native-async-storage/async-storage': {
    getItem: async () => JSON.stringify({ buvid3: 'visitor' }), setItem: async () => {},
  } })('src/api/client.js');
  let face;
  global.fetch = async () => ({ status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ code: 0, data: { isLogin: true, mid: 123, uname: '测试', face } }),
  });
  for (const prefix of ['http:', '', 'https:']) {
    face = `${prefix}//i0.hdslb.com/bfs/face/avatar.jpg?signature=a%2Fb%2Bc`;
    const account = await client.authStatus();
    assert.equal(account.face, 'https://i0.hdslb.com/bfs/face/avatar.jpg?signature=a%2Fb%2Bc');
    assert.equal(account.isLogin, true);
    assert.equal(account.mid, 123);
  }
  face = '';
  assert.deepEqual(await client.authStatus(), { isLogin: true, mid: 123, uname: '测试', face: '', vipType: 0 });
});

test('online playback tries to match the selected quality before falling back', async () => {
  const normalize = loader()('src/player/playbackQuality.js').normalizePlaybackQuality;
  assert.equal(normalize('0'), 32);
  assert.equal(normalize('80'), 80);
  assert.equal(normalize('broken'), 1);
  const requests = [];
  let supportsHD = true;
  const api = loader({ './client': { get: async (url) => {
    requests.push(url);
    const quality = supportsHD && url.includes('/wbi/') ? 80 : 32;
    return { status: 200, body: JSON.stringify({ code: 0, data: { quality, durl: [{ url: `https://cdn/${quality}.mp4` }] } }) };
  } } })('src/api/bili.js');
  assert.equal(await api.videoUrl('BVquality', 5, 80), 'https://cdn/80.mp4');
  assert.equal(requests.length, 2, 'a lower HTML5 response must not prevent requesting the chosen quality');
  supportsHD = false; requests.length = 0;
  assert.equal(await api.videoUrl('BVquality', 5, 80), 'https://cdn/32.mp4');
  assert.equal(requests.length, 3);
  requests.length = 0;
  assert.equal(await api.videoUrl('BVquality', 5), 'https://cdn/32.mp4');
  assert.equal(requests.length, 1, 'automatic accepts the available stream without extra quality probes');
  assert.equal(new URL(requests[0]).searchParams.has('qn'), false);
});

test('download retries empty streams, retains requested quality and rejects silent downgrade / partial media', async () => {
  const requests = [];
  let mode = 'fallback';
  const api = loader({ './client': { get: async (url) => {
    requests.push(url);
    const data = mode === 'parts' ? { durl: [{ url: 'a' }, { url: 'b' }] }
      : requests.length < 3 && mode === 'fallback' ? {}
        : { quality: 32, durl: [{ url: 'https://media/video.mp4' }], accept_quality: [32], accept_description: ['480P'] };
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  } } })('src/api/bili.js');
  assert.equal((await api.videoDownloadInfo('BV1', 2, 32)).url, 'https://media/video.mp4');
  assert.equal(requests.length, 3);
  assert.ok(requests.every((u) => u.includes('qn=32')));
  mode = 'downgrade';
  await assert.rejects(api.videoDownloadInfo('BV1', 2, 80), /不支持所选清晰度/);
  mode = 'parts';
  await assert.rejects(api.videoDownloadInfo('BV1', 2), /多段媒体/);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function host(name) { return name; }
const animationCalls = [];
class Value {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  stopAnimation() {}
  interpolate(config) { return { source: this, config }; }
}
const timing = (value, config) => ({
  start(callback) { animationCalls.push({ value, config, finish() { value.setValue(config.toValue); callback?.({ finished: true }); } }); },
  stop() {},
});
const appStateListeners = new Set();
const backListeners = new Set();
const rn = {
  Switch: host('Switch'),
  ...Object.fromEntries(['View', 'Text', 'Image', 'TouchableOpacity', 'Pressable', 'TextInput', 'ScrollView', 'KeyboardAvoidingView', 'ActivityIndicator'].map((k) => [k, host(k)])),
  Modal: ({ visible, children, ...props }) => visible ? React.createElement('Modal', props, children) : null,
  FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent, ...props }) => React.createElement('FlatList', { ...props, data },
    ListHeaderComponent,
    data.length ? data.map((item, index) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))) : ListEmptyComponent,
    ListFooterComponent),
  Platform: { OS: 'android' },
  BackHandler: { addEventListener: (_, fn) => { backListeners.add(fn); return { remove: () => backListeners.delete(fn) }; } },
  AppState: { currentState: 'active', addEventListener: (_, fn) => {
    appStateListeners.add(fn); return { remove: () => appStateListeners.delete(fn) };
  } },
  StyleSheet: { create: (x) => x, absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  PanResponder: { create: (x) => ({ panHandlers: x }) },
  Keyboard: { dismiss() {} },
  Easing: { linear: (x) => x, cubic: (x) => x, out: (x) => x, in: (x) => x, bezier: () => (x) => x },
  Animated: { Value, timing, spring: timing, add: (a, b) => ({ a, b }),
    event: (mapping, options) => Object.assign(event => mapping[0].nativeEvent.translationY.setValue(event.nativeEvent.translationY), { options, mapping }),
    parallel: (all) => ({ start: () => all.forEach((a) => a.start()) }), View: 'AnimatedView', Text: 'AnimatedText' },
};
const storage = { getItem: async () => null, setItem: async () => {} };
const safeArea = { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 30, bottom: 24, left: 0, right: 0 }) };
const iconMock = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
const touch = (tree, label) => tree.root.findAll((n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === label)[0];
const click = async (tree, label) => {
  const node = touch(tree, label); assert.ok(node, `missing ${label}`);
  assert.ok(!node.props.disabled, `disabled ${label}`);
  await act(async () => { node.props.onPress(); });
};
const textOf = (tree) => JSON.stringify(tree.toJSON());

test('recognized tracks show source attribution and only the uploader link opens the UP page on both platforms', async () => {
  const track = trackModel.segmentTracks({ bvid: 'BVsource', cid: 1, mid: 42,
    title: '原视频合集', up: '原视频UP' }, [{ from: 0, to: 30,
    match: { title: '很长的识别歌曲名称'.repeat(5), artist: '识别歌手' } }])[0];
  const daily = require('../renderer/daily-recommendation.js');
  const compact = daily.compact(track);
  assert.equal(compact.parentTitle, track.parentTitle);
  assert.equal(compact.parentUp, track.parentUp);
  assert.equal(String(compact.parentMid), '42');
  for (const platform of ['ios', 'android']) {
    const load = loader({ 'react-native': { ...rn, Platform: { OS: platform } },
      '@react-native-async-storage/async-storage': storage,
      'src/api/bili': { view: async () => { throw Error('complete tracks must not fetch metadata'); } },
      'src/components/RemoteImage': { __esModule: true, default: 'RemoteImage' },
      'src/components/icons': iconMock });
    const { openTrackUp, canOpenTrackUp } = load('src/player/openTrackUp.js');
    assert.equal(canOpenTrackUp(track), true);
    for (const name of ['TrackRow', 'TrackCard']) {
      const Component = load(`src/components/${name}.js`).default;
      let tree, stopped = 0, played = 0;
      const navigations = [];
      const navigation = { navigate: (...args) => navigations.push(args) };
      await act(async () => { tree = create(React.createElement(Component, { track,
        onPress: () => { played++; },
        onPressUp: () => openTrackUp(navigation, track, async (item) => item.parentMid) })); });
      const texts = tree.root.findAllByType('Text');
      assert.ok(texts.some((node) => node.props.children === track.title));
      assert.ok(texts.some((node) => JSON.stringify(node.props.children).includes('原视频合集')));
      assert.ok(texts.some((node) => node.props.children === '识别歌手'));
      assert.equal(tree.root.findAll((node) => node.type === 'TouchableOpacity'
        && node.props.accessibilityRole === 'link').length, 1);
      const link = touch(tree, '打开 原视频UP 的 UP 主页');
      assert.ok(link, `${platform} ${name}: original uploader must remain clickable`);
      await act(async () => link.props.onPress({ stopPropagation: () => { stopped++; } }));
      assert.deepEqual(navigations, [['Up', { mid: 42 }]]);
      assert.equal(stopped, 1); assert.equal(played, 0);
      await act(async () => tree.update(React.createElement(Component,
        { track: { ...track, isSegment: false, title: '普通视频', up: '普通UP' } })));
      assert.doesNotMatch(tree.root.findAllByType('Text').map((node) => node.props.children).flat().join(''),
        /原视频合集|原视频UP/);
      await act(async () => tree.unmount());
    }
  }
});

test('legacy segment rows recover source metadata once per video, persist it, and reject recycled-row results', async () => {
  const disk = new Map();
  const requests = [];
  const a = deferred(), b = deferred();
  const store = { getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => { disk.set(key, value); } };
  const mocks = { 'react-native': rn, '@react-native-async-storage/async-storage': store,
    'src/components/RemoteImage': { __esModule: true, default: 'RemoteImage' },
    'src/components/icons': iconMock,
    'src/api/bili': { view: (bvid) => { requests.push(bvid); return bvid === 'BVoldA' ? a.promise : b.promise; } } };
  const load = loader(mocks);
  const Row = load('src/components/TrackRow.js').default;
  const { canOpenTrackUp } = load('src/player/openTrackUp.js');
  const legacy = { bvid: 'BVoldA', isSegment: true, title: '识别歌A', up: '识别歌手', from: 0, to: 30 };
  assert.equal(canOpenTrackUp(legacy), true, 'missing parentUp cannot disable the eventual source link');
  const rows = (tracks) => React.createElement(React.Fragment, null, ...tracks.map((track, i) =>
    React.createElement(Row, { key: i, track, onPressUp: () => {} })));
  const visible = (tree) => tree.root.findAllByType('Text').map((node) => node.props.children).flat().join('');
  let tree;
  await act(async () => { tree = create(rows([legacy, { ...legacy, title: '识别歌B', from: 30, to: 60 }])); });
  assert.deepEqual(requests, ['BVoldA'], 'same-video segments coalesce their lookup');
  await act(async () => a.resolve({ title: '原视频A', owner: { name: '原UP A', mid: 42 } }));
  assert.match(visible(tree), /原视频A/); assert.match(visible(tree), /原UP A/);
  assert.match(visible(tree), /识别歌A/); assert.match(visible(tree), /识别歌手/);
  assert.equal(legacy.parentTitle, undefined, 'rendering must not mutate a stored recognized track');
  assert.equal(tree.root.findAllByType('TouchableOpacity').filter((n) => n.props.accessibilityRole === 'link').length, 2);
  await act(async () => tree.update(rows([{ ...legacy, bvid: 'BVoldB', title: '另一首' }])));
  assert.doesNotMatch(visible(tree), /原视频A|原UP A/, 'recycling immediately drops the previous source');
  await act(async () => tree.update(rows([{ bvid: 'BVordinary', title: '普通视频', up: '普通UP' }])));
  await act(async () => b.resolve({ title: '原视频B', owner: { name: '原UP B', mid: 99 } }));
  assert.doesNotMatch(visible(tree), /原视频B|原UP B/);
  await act(async () => tree.unmount());
  const restarted = loader({ ...mocks, 'src/api/bili': { view: () => { throw Error('offline'); } } });
  assert.deepEqual(await restarted('src/player/trackSource.js').fetchTrackSource('BVoldA'),
    { title: '原视频A', up: '原UP A', mid: 42 }, 'relaunch/offline uses the persisted public metadata');
});

test('segment attribution survives row remounts and metadata loss in older synced tracks without a blank frame', async () => {
  let reads = 0;
  const disk = new Map();
  const store = { getItem: async (key) => { reads++; return disk.get(key) || null; },
    setItem: async (key, value) => { disk.set(key, value); } };
  const load = loader({
    '@react-native-async-storage/async-storage': store,
    'src/api/bili': { view: async () => ({ title: '原视频', owner: { name: '原UP', mid: 7 } }) },
  });
  const { useTrackSource, fetchTrackSource } = load('src/player/trackSource.js');
  const legacy = { bvid: 'BVsource', isSegment: true, title: '识别歌曲', up: '识别歌手' };
  const frames = [];
  function Probe({ track }) { frames.push(useTrackSource(track)); return null; }
  const render = (track) => React.createElement(Probe, { track });
  await fetchTrackSource(legacy.bvid);
  for (let i = 0; i < 2; i++) {
    frames.length = 0;
    let tree;
    await act(async () => { tree = create(render(legacy)); });
    assert.ok(frames.every((track) => track.parentTitle === '原视频' && track.parentUp === '原UP'));
    assert.equal(reads, 1, 'recycled rows do not wait for disk or the network again');
    await act(async () => tree.update(render({ ...legacy, bvid: 'BVother', parentTitle: '另一视频', parentUp: '另一UP', parentMid: 8 })));
    frames.length = 0;
    await act(async () => tree.update(render({ ...legacy, bvid: 'BVother' })));
    assert.ok(frames.every((track) => track.parentTitle === '另一视频' && track.parentUp === '另一UP'),
      'a complete segment seeds the shared cache before an older sync strips its source fields');
    await act(async () => tree.update(render({ isSegment: true, title: '缺少来源的视频' })));
    assert.equal(frames.at(-1).title, '缺少来源的视频');
    await act(async () => tree.unmount());
  }
  const restarted = loader({ '@react-native-async-storage/async-storage': store,
    'src/api/bili': { view: async () => { throw Error('offline'); } } });
  assert.deepEqual(await restarted('src/player/trackSource.js').fetchTrackSource('BVother'),
    { title: '另一视频', up: '另一UP', mid: 8 }, 'known source fields also survive an offline restart');
});

test('cloud video preview is opt-in and cannot restart after blur, background, close or an account change', async () => {
  let focused = true, requests = 0, plays = 0, allocated = 0, released = 0;
  let lookup = deferred();
  let sync = { ready: true, scope: 'one', bvid: 'BVcloud', logs: [],
    loadPreview: () => { requests++; return lookup.promise; } };
  const sources = [], listeners = new Set();
  const load = loader({
    'react-native': { ...rn, AppState: { currentState: 'active', addEventListener: (_, fn) => {
      listeners.add(fn); return { remove: () => listeners.delete(fn) };
    } } },
    '@react-navigation/native': { useIsFocused: () => focused },
    'src/store/CloudSyncProvider': { useCloudSync: () => sync },
    'src/api/client': { streamHeaders: () => ({ Referer: 'https://www.bilibili.com' }) },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: (_, setup) => {
      const [player] = React.useState(() => {
        allocated++;
        const source = deferred(); sources.push(source);
        const p = { released: false, play() { assert.equal(this.released, false); plays++; },
          replaceAsync: () => source.promise, addListener: () => ({ remove() {} }) };
        setup(p); return p;
      });
      React.useEffect(() => () => { player.released = true; released++; }, [player]);
      return player;
    } },
  });
  const Card = load('src/components/CloudSyncCard.js').default;
  let tree;
  const render = () => React.createElement(Card);
  const action = async (label) => {
    const node = tree.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('Text').some((t) => t.props.children === label));
    assert.ok(node, label); await act(async () => node.props.onPress());
  };
  await act(async () => { tree = create(render()); });
  assert.equal(requests, 0); assert.equal(allocated, 0);
  const buttonFor = (label) => tree.root.findAllByType('TouchableOpacity').find((node) =>
    node.findAllByType('Text').some((text) => text.props.children === label));
  const hostParent = (node) => { let parent = node.parent; while (parent?.type !== 'View') parent = parent.parent; return parent; };
  assert.equal(hostParent(buttonFor('读取云端')) === hostParent(buttonFor('查看同步视频')), true,
    'cloud read and video preview actions share the same button row');
  await action('查看同步视频'); assert.equal(requests, 1);
  await act(async () => lookup.resolve('https://cdn/preview'));
  assert.equal(allocated, 1);
  assert.equal(tree.root.findByType('VideoView').props.surfaceType, 'textureView');
  await action('关闭视频预览');
  await act(async () => sources[0].resolve());
  assert.equal(plays, 0, 'a late native load cannot play after disposal');
  assert.equal(released, 1);
  await action('查看同步视频');
  await act(async () => sources[1].resolve()); assert.equal(plays, 1);
  await act(async () => { sync = { ...sync, busy: true }; tree.update(render()); });
  assert.equal(allocated, 2, 'sync status changes do not recreate the decoder');
  await act(async () => { focused = false; tree.update(render()); });
  assert.equal(released, 2);
  await act(async () => { focused = true; tree.update(render()); });
  assert.equal(allocated, 2, 'returning to settings does not autoplay');
  await action('查看同步视频');
  await act(async () => { for (const listener of listeners) listener('background'); });
  assert.equal(released, 3);
  await act(async () => sources[2].resolve()); assert.equal(plays, 1);
  await act(async () => { for (const listener of listeners) listener('active'); });
  lookup = deferred();
  await action('查看同步视频');
  await act(async () => { sync = { ...sync, scope: 'two', bvid: 'BVnew' }; tree.update(render()); });
  await act(async () => lookup.resolve('https://cdn/old-account'));
  assert.equal(allocated, 3, 'old account lookup cannot attach its preview to the new account');
  lookup = deferred();
  await action('查看同步视频');
  await act(async () => lookup.reject(Error('加载失败')));
  assert.match(textOf(tree), /加载失败/);
  await act(async () => tree.unmount());
  assert.equal(listeners.size, 0);
});

function withOverlays(load, Component) {
  const { OverlayProvider } = load('src/components/Overlay.js');
  return (props) => React.createElement(OverlayProvider, null, React.createElement(Component, props));
}

test('app releases the native splash on layout without image callbacks and has a missing-layout fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldRequest = global.requestAnimationFrame, oldCancel = global.cancelAnimationFrame;
  let reveal;
  global.requestAnimationFrame = (fn) => { reveal = fn; return 1; };
  global.cancelAnimationFrame = () => { reveal = null; };
  t.after(() => { global.requestAnimationFrame = oldRequest; global.cancelAnimationFrame = oldCancel; });
  let hidden = 0;
  let expoGo = false;
  const splashOptions = [];
  const navigator = () => ({ Navigator: 'Navigator', Screen: 'Screen' });
  const mocks = {
    'react-native': { ...rn, Animated: { ...rn.Animated, Image: 'AnimatedImage' } },
    'react-native-safe-area-context': safeArea,
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureHandlerRootView' },
    '@react-navigation/native': { NavigationContainer: 'NavigationContainer', DefaultTheme: { colors: {} } },
    '@react-navigation/bottom-tabs': { createBottomTabNavigator: navigator },
    '@react-navigation/native-stack': { createNativeStackNavigator: navigator },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo': { isRunningInExpoGo: () => expoGo },
    'expo-splash-screen': { setOptions: (options) => splashOptions.push(options), preventAutoHideAsync: async () => {}, hideAsync: async () => { hidden++; } },
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-svg': { __esModule: true, default: 'Svg', Defs: 'Defs', RadialGradient: 'RadialGradient', Rect: 'Rect', Stop: 'Stop' },
    'src/player/PlayerContext': { PlayerProvider: 'PlayerProvider', usePlayer: () => ({ discoveryEnabled: true }) },
    'src/store/LanSyncProvider': { LanSyncProvider: 'LanSyncProvider' },
    'src/store/CloudSyncProvider': { CloudSyncProvider: 'CloudSyncProvider' },
    'src/player/useMediaTransition': { mediaScreenOptions: {} },
    'src/components/MiniBar': { default: 'MiniBar', __esModule: true },
    'src/components/LyricsActivitySync': { default: () => null, __esModule: true },
    'src/components/AppUpdateCard': { AppUpdateNotice: () => null },
    'src/components/icons': iconMock,
    'assets/splash-icon.png': 1,
  };
  for (const file of fs.readdirSync(path.join(root, 'src/screens'))) {
    mocks[`src/screens/${file.replace(/\.js$/, '')}`] = { default: () => null };
  }
  const App = loader(mocks)('App.js').default;
  assert.deepEqual(splashOptions, [{ duration: 350, fade: true }]);
  expoGo = true;
  loader(mocks)('App.js');
  assert.equal(splashOptions.length, 1, 'Expo Go must skip unsupported native splash options');
  let tree;
  const before = animationCalls.length;
  await act(async () => { tree = create(React.createElement(App)); });
  let stack = tree.root.findByType('Navigator').props;
  assert.equal(stack.screenOptions.animation, 'slide_from_right', 'native-stack owns normal page transitions');
  assert.equal(stack.screenOptions.presentation, 'card');
  const child = React.createElement('Page');
  const transition = stack.screenLayout({ route: { name: 'Settings' }, options: stack.screenOptions, children: child });
  const page = transition.props.children;
  assert.equal(page.props.style.backgroundColor, '#0b0d09');
  assert.ok(page.props.children.includes(child), 'background and content share the moving scene');
  assert.equal(stack.screenLayout({ route: { name: 'Player' }, options: { presentation: 'transparentModal' }, children: child }), child,
    'media gestures must still reveal the page underneath');
  const scene = (name) => stack.layout({ children: React.createElement('Pages'),
    state: { index: 0, routes: [{ name }] }, navigation: {} });
  let chrome;
  await act(async () => { chrome = create(scene('Tabs')); });
  assert.equal(chrome.root.findByType('BlurTargetView').props.pointerEvents, 'none');
  assert.equal(chrome.root.findByType('BlurTargetView').findAllByType('Pages').length, 0,
    'the root blur target never reparents navigation or touch responders');
  const Tabs = tree.root.findAllByType('Screen').find(node => node.props.name === 'Tabs').props.component;
  let tabs, tabScene;
  await act(async () => { tabs = create(React.createElement(Tabs)); });
  const tabLayout = tabs.root.findByType('Navigator').props.screenLayout;
  await act(async () => { tabScene = create(tabLayout({ route: { name: 'Discover' }, children: React.createElement('GestureDetector') })); });
  assert.equal(tabScene.root.findByType('BlurTargetView').findAllByType('GestureDetector').length, 0,
    'discovery gestures remain outside the native blur target hierarchy');
  assert.equal(tabScene.root.findAllByType('GestureDetector').length, 1);
  await act(async () => { tabScene.unmount(); tabs.unmount(); });
  assert.equal(hidden, 0);
  assert.equal(chrome.root.findByType('AnimatedImage').props.onLoadEnd, undefined,
    'a lost image event cannot retain the native splash or block Android pre-draw');
  assert.equal(chrome.root.findByType('AnimatedView').props.pointerEvents, 'none');
  await act(async () => chrome.root.findByType('AnimatedView').props.onLayout());
  assert.equal(hidden, 1);
  assert.equal(animationCalls.length, before + 1);
  const fade = animationCalls.at(-1);
  assert.equal(fade.config.delay, undefined, 'do not add a second startup hold after the native fade');
  assert.equal(fade.config.useNativeDriver, true);
  assert.equal(chrome.root.findAllByType('AnimatedImage').length, 1);
  await act(async () => fade.finish());
  assert.equal(chrome.root.findAllByType('AnimatedImage').length, 0);
  await act(async () => chrome.update(scene('Player')));
  assert.equal(chrome.root.findByType('MiniBar').props.visible, false);
  await act(async () => chrome.update(scene('Tabs')));
  assert.equal(chrome.root.findByType('MiniBar').props.visible, false,
    'the mini player stays hidden while the player route is sliding down');
  await act(async () => stack.screenListeners.transitionEnd({ data: { closing: true } }));
  stack = tree.root.findByType('Navigator').props;
  await act(async () => chrome.update(scene('Tabs')));
  await act(async () => reveal());
  assert.equal(chrome.root.findByType('MiniBar').props.visible, true,
    'the mini player enters only after the closing transition ends');
  await act(async () => chrome.unmount());
  await act(async () => { chrome = create(scene('Tabs')); });
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(hidden, 2, 'missing layout also releases the native window within a bounded time');
  await act(async () => chrome.unmount());
  await act(async () => tree.unmount());
});

test('ordinary pages use native transitions and never intercept back while JS is busy', async () => {
  const load = loader({ 'react-native': rn,
    '@react-navigation/native': { usePreventRemove: () => assert.fail('ordinary navigation must not wait on JS animation callbacks') } });
  const {default: Page, pageScreenOptions} = load('src/components/PageTransition.js');
  assert.equal(pageScreenOptions.presentation, 'card');
  assert.equal(pageScreenOptions.animation, 'slide_from_right');
  let tree;
  await act(async () => { tree = create(React.createElement(Page, { navigation: {} }, React.createElement('Text', null, '设置'))); });
  assert.equal(tree.root.findAllByType('AnimatedView').length, 0);
  assert.equal(tree.root.findByType('Text').props.children, '设置');
  await act(async () => tree.unmount());
});

test('mine playlist tabs keep the header height when the create button disappears', async () => {
  const context = { likes: [], history: [], account: { isLogin: true, mid: 1 } };
  const load = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    'src/player/PlayerContext': { usePlayer: () => context },
    'src/store/playlists': { usePlaylists: () => [] },
    'src/store/favoriteCovers': { stabilizeFavoriteCovers: async (_, folders) => folders },
    'src/api/bili': { favFolders: async () => [] }, 'src/api/client': {},
    'src/components/GeetestModal': () => null,
    'src/components/DefaultCover': () => null,
    'src/components/RemoteImage': () => null,
    'src/components/icons': iconMock,
  });
  const Mine = load('src/screens/MineScreen.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Mine, { navigation: { navigate() {} } })); });
  const header = () => touch(tree, '自建歌单').parent;
  const minHeight = () => Object.assign({}, ...header().props.style).minHeight;
  const createButton = header().findAllByType('TouchableOpacity').at(-1);
  assert.equal(minHeight(), createButton.props.style.height);
  await click(tree, '收藏夹');
  assert.equal(minHeight(), 28);
  assert.equal(header().findAllByType('TouchableOpacity').length, 2);
  assert.equal(touch(tree, '收藏夹').props.accessibilityState.selected, true);
  await click(tree, '自建歌单');
  assert.equal(minHeight(), 28);
  assert.equal(header().findAllByType('TouchableOpacity').length, 3);
  await act(async () => tree.unmount());
});

function actionHarness(overrides = {}) {
  const calls = [];
  const webScripts = [];
  const context = { playQueue: (...args) => calls.push(['queue', ...args]), lyricSettings: {}, updateLyricSettings: (...args) => calls.push(['lyrics', ...args]) };
  const api = {
    view: async (bvid) => ({ aid: bvid === 'A' ? 1 : 2, cid: 10, duration: 400, stat: { like: 3, favorite: 4 }, copyright: 1 }),
    arcRelation: async () => ({ like: false, coin: 0, favorite: true }),
    likeVideo: async (...args) => calls.push(['like', ...args]),
    coinVideo: async (...args) => calls.push(['coin', ...args]),
    favFoldersWithState: async () => [{ id: 5, title: 'Music', favored: true, count: 4 }],
    favDeal: async (...args) => calls.push(['favorite', ...args]),
    replies: async () => ({ list: [], total: 0, hasMore: false }),
    searchSongCandidates: async () => [{ source: 'netease', id: 1, title: 'Song', artist: 'Singer' }],
    lyricForMatch: async () => [{ text: 'matched', from: 0, to: 5 }],
    mixSplitDetect: async () => [{ from: 0, to: 100, name: 'One' }, { from: 100, to: 400, name: 'Two' }],
    videoDownloadInfo: async () => ({ qualities: [{ quality: 32, label: '480P' }], quality: 32, label: '480P', format: 'mp4', url: 'https://cdn/video.mp4' }),
    ...overrides.api,
  };
  const disk = { documentDirectory: 'file:///app/', readDirectoryAsync: async () => [], makeDirectoryAsync: async () => {}, moveAsync: async (...a) => calls.push(['move', ...a]),
    deleteAsync: async (...a) => calls.push(['delete', ...a]),
    createDownloadResumable: (url, fileUri) => ({ fileUri, cancelAsync: async () => calls.push(['cancel']), downloadAsync: async () => ({ status: 200 }) }), ...overrides.disk };
  const load = loader({
    'react-native': rn, '@react-navigation/native': { useIsFocused: () => true, useNavigation: () => ({ navigate: (...args) => calls.push(['navigate', ...args]) }) },
    'react-native-webview': { WebView: ({ ref, ...props }) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: (script) => webScripts.push(script) }));
      return React.createElement('WebView', props);
    } },
    'react-native-safe-area-context': safeArea,
    'expo-file-system/legacy': disk, 'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri) => calls.push(['share', uri]) },
    'src/api/bili': api, 'src/api/client': { authStatus: async () => ({ isLogin: true }), imageHeaders: () => ({}), streamHeaders: () => ({ Referer: 'bilibili' }) },
    'src/player/PlayerContext': { usePlayer: () => context, usePlaybackProgress: () => context }, 'src/components/icons': iconMock,
    '@react-native-async-storage/async-storage': storage,
  });
  return { Component: withOverlays(load, load('src/components/VideoActionBar.js').default), calls, context, webScripts };
}
const track = { bvid: 'A', cid: 10, title: 'Mix', pic: 'https://cdn/cover.jpg' };

test('app sheets animate without waiting for layout, keep closing content, and survive a rapid reopen', async () => {
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea });
  const Sheet = withOverlays(load, load('src/components/BottomSheet.js').default);
  let tree;
  const render = (visible) => React.createElement(Sheet, { visible, onClose() {}, style: { maxHeight: visible ? '62%' : '68%' } },
    visible ? React.createElement('Text', null, '歌词匹配内容') : null);
  await act(async () => { tree = create(render(false)); });
  assert.equal(tree.root.findAllByType('KeyboardAvoidingView').length, 0);
  const before = animationCalls.length;
  await act(async () => tree.update(render(true)));
  assert.equal(tree.root.findAllByType('Modal').length, 0, 'sheets never create a native window');
  assert.equal(animationCalls.length, before + 1, 'entry must not depend on a JS layout callback');
  const surface = () => tree.root.findAllByType('AnimatedView').find((n) => n.props.onLayout);
  await act(async () => surface().props.onLayout({ nativeEvent: { layout: { height: 320 } } }));
  const opening = animationCalls.at(-1);
  assert.equal(opening.value.value, 0, 'first visible frame starts fully below the screen');
  assert.equal(opening.config.toValue, 1);
  assert.equal(surface().props.style.at(-1).paddingBottom, 42, 'navigation inset plus normal padding');
  await act(async () => opening.finish());
  await act(async () => tree.update(render(false)));
  assert.match(textOf(tree), /歌词匹配内容/, 'closing cannot clear the sheet before its animation');
  assert.equal(surface().props.style[1].maxHeight, '62%', 'closing must retain the previous layout too');
  const interruptedClose = animationCalls.at(-1);
  assert.equal(interruptedClose.config.toValue, 0);
  await act(async () => tree.update(render(true)));
  await act(async () => interruptedClose.finish());
  assert.equal(tree.root.findAllByType('KeyboardAvoidingView').length, 1, 'stale completion cannot dismiss a reopened sheet');
  await act(async () => animationCalls.at(-1).finish());
  await act(async () => tree.update(render(false)));
  await act(async () => animationCalls.at(-1).finish());
  assert.equal(tree.root.findAllByType('KeyboardAvoidingView').length, 0);
  await act(async () => tree.unmount());
});

test('overlay back closes only the top layer and destructive dialogs require explicit confirmation', async () => {
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea });
  const { default: Overlay, OverlayProvider } = load('src/components/Overlay.js');
  const ConfirmDialog = load('src/components/Dialog.js').default;
  let deleted = 0, closedTop = 0;
  function Probe() {
    const [confirm, setConfirm] = React.useState(true);
    const [top, setTop] = React.useState(true);
    return React.createElement(React.Fragment, null,
      React.createElement(ConfirmDialog, { config: confirm ? {
        title: '删除歌单', message: '此操作不可恢复', confirmText: '删除', destructive: true,
        onConfirm: () => { deleted++; },
      } : null, onClose: () => setConfirm(false) }),
      top ? React.createElement(Overlay, { onClose: () => { closedTop++; setTop(false); } },
        React.createElement('Text', null, '安全验证')) : null);
  }
  let tree;
  await act(async () => { tree = create(React.createElement(OverlayProvider, null, React.createElement(Probe))); });
  assert.equal(tree.root.findAllByType('Modal').length, 0);
  const layers = () => tree.root.findAllByType('View').filter((node) => 'accessibilityViewIsModal' in node.props);
  assert.equal(layers().length, 2);
  assert.equal(layers()[0].props.pointerEvents, 'none');
  assert.equal(layers()[1].props.accessibilityViewIsModal, true);
  await act(async () => { assert.equal([...backListeners].at(-1)(), true); });
  assert.equal(closedTop, 1);
  assert.equal(deleted, 0);
  assert.equal(layers().length, 1);
  assert.equal(layers()[0].props.pointerEvents, 'auto');
  await click(tree, '删除');
  assert.equal(deleted, 1);
  await act(async () => tree.unmount());
  assert.equal(backListeners.size, 0, 'unmounted overlays release the Android back handler');
});

test('playlist edits preserve segments, serialize changes, report disk failures and isolate accounts', async () => {
  const disk = new Map(); let fail = false;
  const load = loader({ '@react-native-async-storage/async-storage': {
    getItem: async (key) => disk.get(key) || null,
    setItem: async (key, value) => { if (fail) throw new Error('disk full'); disk.set(key, value); },
  } });
  const store = load('src/store/playlists.js');
  await store.setPlaylistScope('user-a');
  const parts = trackModel.segmentTracks({ bvid: 'mix', cid: 5, title: 'Mix' }, [
    { from: 0, to: 20, name: 'First' }, { from: 20, to: 40, name: 'Second' },
  ]);
  const pl = await store.createPlaylist('Mix', parts);
  await Promise.all([
    store.updatePlaylist(pl.id, { title: ' Renamed ', desc: ' intro ', cover: 'https://cdn/cover.jpg' }),
    store.movePlaylistTrack(pl.id, store.trackKeyOf(parts[1]), 0),
    store.addToPlaylist(pl.id, { bvid: 'extra', title: 'Extra' }),
  ]);
  const edited = (await store.getPlaylists())[0];
  assert.equal(edited.title, 'Renamed'); assert.equal(edited.desc, 'intro');
  assert.deepEqual(edited.tracks.slice(0, 2), [parts[1], parts[0]]);
  await assert.rejects(store.movePlaylistTrack(pl.id, store.trackKeyOf(parts[0]), 99), /位置/);
  await assert.rejects(store.updatePlaylist(pl.id, { title: ' ' }), /不能为空/);
  fail = true;
  await assert.rejects(store.deletePlaylist(pl.id), /disk full/);
  assert.equal((await store.getPlaylists()).length, 1, 'failed writes keep the previous library');
  fail = false;
  await store.removePlaylistTracks(pl.id, [store.trackKeyOf(parts[0]), 'extra']);
  assert.deepEqual((await store.getPlaylists())[0].tracks, [parts[1]]);
  await store.setPlaylistScope('user-b');
  assert.deepEqual(await store.getPlaylists(), []);
  await store.setPlaylistScope('user-a');
  assert.equal((await store.getPlaylists())[0].cover, 'https://cdn/cover.jpg');
  await store.deletePlaylist(pl.id);
  assert.deepEqual(JSON.parse(disk.get('biu.playlists@user-a')), []);
});

test('playlist page edits inline, drags by the handle and confirms bulk removal and deletion', async (t) => {
  const frames = new Map(); let frameId = 0;
  const oldRequest = global.requestAnimationFrame, oldCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = (fn) => { frames.set(++frameId, fn); return frameId; };
  global.cancelAnimationFrame = (id) => frames.delete(id);
  t.after(() => { global.requestAnimationFrame = oldRequest; global.cancelAnimationFrame = oldCancel; });
  const disk = new Map(); let played, backed = 0;
  const load = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    '@react-native-async-storage/async-storage': { getItem: async (key) => disk.get(key) || null, setItem: async (key, value) => disk.set(key, value) },
    'src/player/PlayerContext': { usePlayer: () => ({ current: null, playQueue: (tracks) => { played = tracks; } }) },
    'src/components/TrackRow': { __esModule: true, default: 'TrackRow' },
    'src/components/RemoteImage': { __esModule: true, default: 'RemoteImage' },
    'src/components/DefaultCover': { __esModule: true, default: 'DefaultCover', defaultCoverSeed: () => 1 },
    'src/components/icons': iconMock,
  });
  const store = load('src/store/playlists.js');
  const pl = await store.createPlaylist('Before', [
    { bvid: 'a', title: 'First', pic: 'https://cdn/a.jpg' },
    { bvid: 'b', title: 'Second', pic: 'https://cdn/b.jpg' },
  ]);
  const Screen = withOverlays(load, load('src/screens/LocalPlaylistScreen.js').default);
  let tree;
  await act(async () => { tree = create(React.createElement(Screen, { route: { params: { id: pl.id } }, navigation: { goBack: () => { backed++; } } })); });
  await click(tree, '编辑资料');
  assert.equal(tree.root.findAllByType('KeyboardAvoidingView').length, 0, 'editing stays in the playlist page');
  const input = (name) => tree.root.findAllByType('TextInput').find((node) => node.props.accessibilityLabel === name);
  await act(async () => { input('名称').props.onChangeText('After'); input('简介').props.onChangeText('Description'); });
  await click(tree, '使用第 2 张封面');
  await click(tree, '保存修改');
  assert.equal((await store.getPlaylists())[0].title, 'After');
  assert.equal((await store.getPlaylists())[0].cover, 'https://cdn/b.jpg');
  await click(tree, '重排');
  const viewport = tree.root.findAllByType('View').find((node) => node.props.onLayout && node.props.style?.overflow === 'hidden');
  await act(async () => viewport.props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
  const grip = (title) => tree.root.findAllByType('View').find((node) => node.props.accessibilityLabel === `拖动重排 ${title}`);
  const startDrag = async (title) => act(async () => {
    viewport.props.onStartShouldSetPanResponderCapture();
    assert.equal(viewport.props.onStartShouldSetPanResponder(), false, 'touches outside the grip scroll normally');
    grip(title).props.onStartShouldSetResponder();
    assert.equal(viewport.props.onStartShouldSetPanResponder(), true);
    viewport.props.onPanResponderGrant();
  });
  await startDrag('First');
  await act(async () => viewport.props.onPanResponderMove(null, { dy: 80 }));
  assert.deepEqual((await store.getPlaylists())[0].tracks.map((track) => track.bvid), ['a', 'b'], 'drag previews do not write storage');
  await act(async () => viewport.props.onPanResponderRelease());
  await act(async () => animationCalls.at(-1).finish());
  await click(tree, '播放全部');
  assert.deepEqual(played.map((t) => t.bvid), ['b', 'a']);
  await startDrag('Second');
  await act(async () => viewport.props.onPanResponderMove(null, { dy: 80 }));
  await act(async () => viewport.props.onPanResponderTerminate());
  await act(async () => animationCalls.at(-1).finish());
  assert.deepEqual((await store.getPlaylists())[0].tracks.map((track) => track.bvid), ['b', 'a'], 'cancelled gestures keep the saved order');
  await startDrag('Second');
  await act(async () => viewport.props.onPanResponderMove(null, { dy: 80 }));
  await act(async () => viewport.props.onPanResponderRelease());
  await act(async () => animationCalls.at(-1).finish());
  assert.deepEqual((await store.getPlaylists())[0].tracks.map((t) => t.bvid), ['a', 'b']);
  assert.equal(frames.size, 0, 'edge scrolling stops when the finger lifts');
  await click(tree, '选择 First');
  await click(tree, '移除所选 1 首');
  assert.equal((await store.getPlaylists())[0].tracks.length, 2);
  await click(tree, '取消');
  await click(tree, '移除所选 1 首');
  await click(tree, '移除');
  assert.deepEqual((await store.getPlaylists())[0].tracks.map((t) => t.bvid), ['b']);
  await click(tree, '删除歌单');
  assert.equal(backed, 0);
  await click(tree, '删除');
  assert.equal(backed, 1);
  assert.deepEqual(await store.getPlaylists(), []);
  await act(async () => tree.unmount());
});

test('drag targets include header and scroll offsets and edge scrolling stays inside the list', () => {
  const { reorderTarget, reorderScrollStep } = loader({ 'react-native': rn })('src/components/ReorderablePlaylist.js');
  assert.equal(reorderTarget(100, 352, 300, 20), 2);
  assert.equal(reorderTarget(0, 0, 300, 20), 0);
  assert.equal(reorderTarget(400, 2000, 300, 20), 19);
  assert.equal(reorderScrollStep(150, 400, 100, 1500), 100, 'middle of the viewport does not scroll');
  assert.ok(reorderScrollStep(324, 400, 100, 1500) > 100);
  assert.ok(reorderScrollStep(0, 400, 100, 1500) < 100);
  assert.equal(reorderScrollStep(0, 400, 0, 1500), 0);
  assert.equal(reorderScrollStep(324, 400, 1100, 1500), 1100);
});

test('favorite metadata editing uses the desktop endpoint and surfaces failed saves', async () => {
  const calls = []; let fail = false;
  const api = loader({ 'src/api/client': {
    get: async () => ({ status: 200, body: JSON.stringify({ code: 0, data: { title: 'Folder', intro: 'About' } }) }),
    post: async (url, body) => { calls.push({ url, body }); return { status: 200, body: JSON.stringify({ code: fail ? -101 : 0, message: '请登录' }) }; },
  } })('src/api/bili.js');
  assert.deepEqual(await api.favFolderInfo(12), { id: 12, title: 'Folder', desc: 'About' });
  await api.favFolderEdit(12, ' New ', ' Description ');
  assert.deepEqual(calls[0], { url: 'https://api.bilibili.com/x/v3/fav/folder/edit', body: { media_id: 12, title: 'New', intro: 'Description' } });
  fail = true;
  await assert.rejects(api.favFolderEdit(12, 'New', ''), /请登录/);
});

test('home fills the first fifteen unique recommendations and keeps subsequent pagination incremental', async () => {
  const requests = [];
  const plays = [];
  let account = { isLogin: true };
  let recommendMode = 'all';
  const musicRequests = [];
  let failRecommendations = false;
  let rankRequests = 0;
  const recommendations = (start, count) => Array.from({ length: count }, (_, i) => ({
    bvid: `BV${start}-${i}`, title: `Song ${start}-${i}`, up: 'UP', duration: 180,
  }));
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' },
    'react-native-safe-area-context': safeArea,
    'src/api/client': { initClient: async () => {} },
    'src/api/bili': {
      personalizedRecommendations: async (start, count) => {
        requests.push([start, count]); return recommendations(start, count);
      },
      personalizedMusicRecommendations: async (start) => {
        musicRequests.push(start);
        if (failRecommendations) throw new Error('recommendations unavailable');
        return recommendations('music', Math.min(start, 4) * 5);
      },
      ranking: async () => {
        rankRequests += 1;
        if (failRecommendations) throw new Error('ranking unavailable');
        return recommendations('rank', 20);
      },
    },
    'src/player/PlayerContext': { usePlayer: () => ({
      playQueue: (...args) => plays.push(args), likes: [], recommendMode, account,
    }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' },
    'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree;
  await act(async () => {
    tree = create(React.createElement(Home, { navigation: { navigate() {} } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(requests, [[0, 30], [1, 30], [2, 30]]);
  const checkRecommendations = (total) => {
    const banner = tree.root.findByType('HomeBanner').props.tracks;
    const feed = tree.root.findAllByType('TrackCard').map((card) => card.props.track);
    const list = tree.root.findByType('FlatList').props;
    assert.equal(banner.length, Math.min(5, total - 1));
    assert.equal(feed.length, total - banner.length);
    assert.equal(list.masonry, true);
    assert.equal(list.numColumns, 2);
    assert.equal(list.optimizeItemArrangement, true);
    assert.deepEqual(list.data, feed, 'each card is a recyclable masonry item with no eight-card group boundaries');
    assert.equal(new Set([...banner, ...feed].map((track) => track.bvid)).size, total,
      'carousel and waterfall partition the recommendations without duplicate videos');
  };
  checkRecommendations(90);
  tree.root.findByType('HomeBanner').props.onPress(null, 2);
  assert.equal(plays.at(-1)[0][plays.at(-1)[1]].bvid, 'BV0-2');
  const firstCard = tree.root.findAllByType('TrackCard')[0];
  firstCard.props.onPress();
  assert.equal(plays.at(-1)[0][plays.at(-1)[1]].bvid, firstCard.props.track.bvid,
    'feed playback keeps the original queue index after excluding carousel videos');
  const scroll = tree.root.findByType('FlatList');
  await act(async () => {
    scroll.props.onScrollBeginDrag();
    scroll.props.onEndReached();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(requests, Array.from({ length: 6 }, (_, i) => [i, 30]));
  checkRecommendations(180);
  await act(async () => {
    tree.root.findByType('FlatList').props.refreshControl.props.onRefresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  checkRecommendations(90);
  assert.deepEqual(requests, Array.from({ length: 9 }, (_, i) => [i, 30]), 'refresh reserves three new platform pages');
  account = { isLogin: false };
  await act(async () => {
    tree.update(React.createElement(Home, { navigation: { navigate() {} } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(rankRequests, 1, 'guest recommendations switch to the music ranking');
  checkRecommendations(20);
  account = { isLogin: true };
  recommendMode = 'music';
  await act(async () => {
    tree.update(React.createElement(Home, { navigation: { navigate() {} } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(musicRequests.length >= 4, 'duplicate-heavy pages continue until the target is met');
  const musicCount = Math.min(Math.max(...musicRequests), 4) * 5;
  checkRecommendations(musicCount);
  const musicStart = musicRequests.length;
  assert.equal(rankRequests, 1, 'enough personalized music needs no ranking supplement');
  await act(async () => {
    tree.root.findByType('FlatList').props.onScrollBeginDrag();
    tree.root.findByType('FlatList').props.onScrollEndDrag({ nativeEvent: {
      contentOffset: { y: 1500 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 },
    } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(musicRequests.length - musicStart, 12, 'sparse load-more remains bounded while seeking thirty new matches');
  assert.deepEqual(musicRequests, Array.from({ length: musicRequests.length }, (_, i) => i));
  const cards = tree.root.findAllByType('TrackCard');
  checkRecommendations(20);
  assert.equal(cards.filter((card) => card.props.track.recommendationReason === '音乐热榜').length, 0);
  assert.equal(rankRequests, 1);
  const beforeFailure = musicRequests.length;
  failRecommendations = true;
  await act(async () => {
    tree.root.findByType('FlatList').props.onScrollBeginDrag();
    tree.root.findByType('FlatList').props.onEndReached();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(musicRequests.length - beforeFailure, 3);
  checkRecommendations(20);
  await act(async () => tree.unmount());
});

test('home keeps sparse batches visible and publishes fallback before slow profile searches, preserving feed on failed refresh', async () => {
  const enriched = deferred(), failedRefresh = deferred();
  const tracks = (prefix, count) => Array.from({ length: count }, (_, i) => ({ bvid: `${prefix}-${i}`, title: `Song ${i}` }));
  let fail = false, calls = 0;
  const profilePages = [];
  const manager = { ready: async () => {}, getSnapshot: () => ({ enabled: true, activeId: 'auto' }), observeFeed() {},
    recommend: ({ page }) => { profilePages.push(page); return page === 0 ? enriched.promise : Promise.resolve([]); } };
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/client': { initClient: async () => {} },
    'src/api/bili': {
      personalizedMusicRecommendations: () => fail ? failedRefresh.promise : Promise.resolve(calls++ === 0 ? tracks('platform', 5) : []),
      ranking: () => { throw Error('ranking must not supplement recommendations'); },
    },
    'src/player/PlayerContext': { usePlayer: () => ({ likes: [], playQueue() {}, account: { isLogin: true, mid: 1 },
      recommendMode: 'music', recommendationManager: manager }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree;
  const feed = () => tree.root.findAllByType('TrackCard').map((card) => card.props.track.bvid);
  await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  assert.equal(tree.root.findByType('HomeBanner').props.tracks.length, 4);
  assert.equal(feed().length, 1, 'the first five music tracks cannot all disappear into the carousel');
  assert.equal(tree.root.findByType('FlatList').props.masonry, true,
    'the feed uses per-card masonry recycling');
  assert.equal(feed().length, 1, 'the platform batch is visible while optional profile searches are still pending');
  assert.deepEqual(profilePages, [0]);
  await act(async () => {
    const list = tree.root.findByType('FlatList');
    list.props.onScrollBeginDrag(); list.props.onEndReached();
  });
  assert.deepEqual(profilePages, [0, 1], 'slow enrichment does not block the next feed page');
  const visible = feed();
  assert.equal(visible.length, 1);
  await act(async () => enriched.resolve(tracks('stale-profile', 10)));
  assert.deepEqual(feed(), visible, 'late enrichment cannot replace a newer feed page');
  fail = true;
  await act(async () => tree.root.findByType('FlatList').props.refreshControl.props.onRefresh());
  assert.deepEqual(feed(), visible, 'refreshing keeps existing cards mounted');
  await act(async () => failedRefresh.reject(Error('推荐加载失败')));
  assert.deepEqual(feed(), visible, 'a failed refresh cannot erase the usable feed');
  assert.match(tree.root.findAllByType('Text').map((node) => node.props.children).join(''), /推荐加载失败/);
  await act(async () => tree.unmount());
});

test('home leaves a usable feed and empty state even with fewer than six guest recommendations', async () => {
  for (const count of [0, 1, 5]) {
    const load = loader({
      'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
      'src/api/client': { initClient: async () => {} },
      'src/api/bili': { ranking: async () => Array.from({ length: count }, (_, i) => ({ bvid: `BV${i}`, title: 'Song' })) },
      'src/player/PlayerContext': { usePlayer: () => ({ account: { isLogin: false }, likes: [] }) },
      'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
      'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
      'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
    });
    const Home = load('src/screens/HomeScreen.js').default;
    let tree;
    await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
    assert.equal(tree.root.findAllByType('TrackCard').length, count ? 1 : 0);
    if (!count) assert.match(tree.root.findAllByType('Text').map((node) => node.props.children).join(''), /暂时没有内容/);
    await act(async () => tree.unmount());
  }
});

test('home refresh advances automatic profile searches and excludes the previous feed from both sources', async () => {
  const platformPages = [], profileRequests = [];
  let scope = 'account-a';
  const tracks = (prefix) => Array.from({ length: 24 }, (_, i) => ({ bvid: `${prefix}-${i}`, title: 'Song' }));
  const manager = {
    ready: async () => {}, getSnapshot: () => ({ activeId: 'auto', enabled: true }), observeFeed() {},
    async recommend(options) {
      profileRequests.push(options);
      return tracks(`profile-${options.page}`).filter((t) => !options.exclude.includes(t.bvid));
    },
  };
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/client': { initClient: async () => {} },
    'src/api/bili': { personalizedRecommendations: async (page) => {
      platformPages.push(page);
      // The server can repeat even when fresh_idx advances.
      return [...tracks('pinned').slice(0, 2), ...tracks(`platform-${page}`)];
    } },
    'src/player/PlayerContext': { usePlayer: () => ({ likes: [], playQueue() {},
      account: { isLogin: true, mid: scope }, recommendMode: 'all', recommendationManager: manager }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree;
  const visibleIds = () => [...tree.root.findByType('HomeBanner').props.tracks,
    ...tree.root.findAllByType('TrackCard').map((card) => card.props.track)].map((t) => t.bvid);
  await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  for (let page = 1; page <= 2; page++) {
    assert.ok(tree.root.findByType('HomeBanner').props.tracks.every((t) => !t.bvid.startsWith('profile-')),
      'automatic profile insertions must not displace platform carousel videos');
    const before = visibleIds();
    await act(async () => tree.root.findByType('FlatList').props.refreshControl.props.onRefresh());
    assert.equal(platformPages.at(-1), page * 3 + 2);
    assert.equal(profileRequests.at(-1).page, page);
    assert.deepEqual(new Set(profileRequests.at(-1).exclude), new Set(before));
    assert.ok(visibleIds().every((id) => !before.includes(id)), 'refresh must replace previously displayed videos');
  }
  scope = 'account-b';
  await act(async () => tree.update(React.createElement(Home, { navigation: {} })));
  assert.equal(platformPages.at(-1), 2, 'another account starts its own first three pages');
  assert.equal(profileRequests.at(-1).page, 0);
  assert.deepEqual(profileRequests.at(-1).exclude, []);
  await act(async () => tree.unmount());
});

test('strict custom home keeps platform content visible while profile matching restores in the background', async () => {
  const R = require('../renderer/recommendation-profile'), gate = deferred();
  const remaining = deferred();
  let platformCalls = 0, fail = false;
  const requests = [];
  const matches = Array.from({ length: 7 }, (_, i) => ({ bvid: 'BVmatch' + i, title: '钢琴 ' + i }));
  const manager = R.createManager({ read: () => gate.promise, write: async () => {}, getLikes: () => [] });
  manager.recommend = async (options) => {
    requests.push(options);
    if (fail) throw new Error('画像接口暂不可用');
    if (requests.length === 1) {
      options.onBatch(matches.slice(0, 6));
      await remaining.promise;
      options.onBatch(matches.slice(6));
    }
    return options.page === 0 ? matches : [];
  };
  const base = async () => { platformCalls++; return Array.from({ length: 20 }, (_, i) => ({ bvid: 'BVbase' + i })); };
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/client': { initClient: async () => {} },
    'src/api/bili': { personalizedRecommendations: base, personalizedMusicRecommendations: base, ranking: base },
    'src/player/PlayerContext': { usePlayer: () => ({
      likes: [], playQueue() {}, account: { isLogin: true, mid: 1 }, recommendMode: 'music', recommendationManager: manager,
      recommendationProfile: React.useSyncExternalStore(manager.subscribe, manager.getSnapshot),
    }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true }, 'src/components/icons': iconMock,
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' },
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  assert.equal(platformCalls, 3, 'platform recommendations are allowed while the custom profile restores');
  await act(async () => gate.resolve(R.normalize({ profiles: [{ id: 'p', name: '钢琴', tags: ['钢琴'] }], activeId: 'p' })));
  assert.equal(tree.root.findByType('HomeBanner').props.tracks.length, 5);
  assert.equal(tree.root.findAllByType('TrackCard').length, 15, 'first platform page displays before profile matching finishes');
  await act(async () => tree.root.findByType('FlatList').props.onEndReached());
  assert.equal(requests.length, 1, 'streaming cannot start another concurrent refresh');
  await act(async () => remaining.resolve());
  assert.equal(tree.root.findByType('HomeBanner').props.tracks.length, 5);
  assert.equal(tree.root.findAllByType('TrackCard').length, 15);
  assert.equal(platformCalls, 3);
  assert.equal(tree.root.findAllByProps({ accessibilityLabel: '加载更多推荐' }).length, 0);
  await act(async () => tree.root.findByType('FlatList').props.onEndReached());
  assert.equal(requests.length, 1, 'layout changes alone must not request another batch');
  await act(async () => {
    tree.root.findByType('FlatList').props.onScrollBeginDrag();
    tree.root.findByType('FlatList').props.onEndReached();
  });
  assert.equal(requests.at(-1).page, 1);
  assert.equal(requests.at(-1).mode, 'music');
  assert.equal(requests.at(-1).exclude.length, 20);
  assert.equal(tree.root.findAllByType('TrackCard').length, 15, 'empty profile page retains platform content');
  await act(async () => tree.root.findByType('FlatList').props.onScrollBeginDrag());
  await act(async () => tree.root.findByType('FlatList').props.onScrollEndDrag({ nativeEvent: {
    contentOffset: { y: 0 }, contentSize: { height: 400 }, layoutMeasurement: { height: 800 },
  } }));
  assert.equal(requests.at(-1).page, 2, 'drag can continue after an empty batch without a load-more button');
  fail = true;
  await act(async () => tree.root.findByType('FlatList').props.refreshControl.props.onRefresh());
  assert.ok(platformCalls > 1, 'refresh may retry platform pages while profile matching is unavailable');
  assert.equal(tree.root.findAllByType('HomeBanner').length, 1);
  assert.equal(tree.root.findAllByType('TrackCard').length, 15, 'failed refresh keeps already loaded videos');
  fail = false;
  await act(async () => manager.edit({ type: 'select', id: 'auto' }));
  assert.ok(platformCalls > 1, 'automatic profile keeps platform discovery');
  const visible = tree.root.findAllByType('TrackCard').map((card) => card.props.track.bvid);
  assert.deepEqual(tree.root.findAllByType('TrackCard').map((card) => card.props.track.bvid), visible,
    'background profile matching cannot modify the visible feed unexpectedly');
  const beforeSync = await manager.exportSync(), learned = structuredClone(beforeSync);
  learned.auto.updatedAt = Date.now();
  learned.auto.tags = [{ name: '古典', weight: 100 }];
  const requestsBeforeSync = requests.length;
  await act(async () => manager.applySync(learned, beforeSync));
  assert.ok(platformCalls >= 1, 'background learning sync keeps platform discovery available');
  assert.equal(requests.length, requestsBeforeSync);
  assert.deepEqual(tree.root.findAllByType('TrackCard').map((card) => card.props.track.bvid), visible);
  await act(async () => tree.unmount());
});

test('scrubber follows stable touch coordinates, commits once and animates cancellation without seeking', async () => {
  const Scrubber = loader({ 'react-native': rn })('src/components/ProgressScrubber.js').default;
  const seeks = [];
  let tree, position = 10, seekRevision = 0;
  const render = () => React.createElement(Scrubber, { position, duration: 100, playing: false, seekRevision,
    onSeek: (value) => { seeks.push(value); position = value; seekRevision++; } });
  await act(async () => { tree = create(render()); });
  const zone = tree.root.findByProps({ accessibilityRole: 'adjustable' });
  assert.equal(zone.props.onStartShouldSetResponderCapture(), true);
  assert.equal(zone.props.onMoveShouldSetResponderCapture(), true,
    'scrubber captures movement before a surrounding ScrollView can cancel it');
  const event = (pageX, locationX) => ({ nativeEvent: { pageX, locationX } });
  const thumb = () => zone.findAllByType('AnimatedView').find((n) => n.props.style?.[0]?.width === 10);
  const ratio = () => thumb().props.style[1].transform[0].translateX.source.value;
  await act(async () => zone.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  await act(async () => zone.props.onResponderGrant(event(70, 40)));
  await act(async () => zone.props.onResponderMove(event(150, 2)));
  assert.equal(ratio(), 0.6, 'child-relative locationX cannot make the thumb jump');
  assert.deepEqual(seeks, []);
  await act(async () => { position = 10.25; tree.update(render()); });
  assert.equal(ratio(), 0.6, 'player ticks cannot fight an ongoing drag');
  await act(async () => { zone.props.onResponderRelease(event(190, 3)); tree.update(render()); });
  assert.deepEqual(seeks, [80]);
  assert.equal(ratio(), 0.8, 'release keeps the exact dragged position');
  await act(async () => zone.props.onResponderGrant(event(70, 40)));
  await act(async () => zone.props.onResponderMove(event(-20, 0)));
  assert.equal(ratio(), 0, 'dragging outside the track clamps to the beginning');
  await act(async () => zone.props.onResponderTerminate(event(-20, 0)));
  assert.deepEqual(seeks, [80], 'an interrupted gesture does not seek');
  const rollback = animationCalls.findLast((a) => a.config.toValue === 0.8 && a.config.duration === 180);
  assert.ok(rollback?.config.useNativeDriver);
  await act(async () => rollback.finish());
  assert.equal(ratio(), 0.8);
  await act(async () => zone.props.onResponderGrant(event(130, 100)));
  await act(async () => zone.props.onResponderRelease(event(130, 100)));
  assert.deepEqual(seeks, [80, 50], 'a tap without a move uses the touch position, never PanResponder moveX=0');
  await act(async () => tree.unmount());
});

test('player tabs retain the same video surface and expose local likes in cover and lyric modes', async () => {
  const likedTracks = [];
  const seeks = [];
  const mediaPlayer = {};
  const load = loader({
    'react-native': rn,
    '@react-navigation/native': { useIsFocused: () => true },
    'react-native-safe-area-context': safeArea,
    'expo-image': { Image: 'ExpoImage' }, 'expo-video': { VideoView: 'VideoView' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@react-native-masked-view/masked-view': 'Mask',
    'src/player/useMediaTransition': { default: () => ({ style: {}, panHandlers: {} }), __esModule: true },
    'src/player/PlayerContext': { PLAY_MODES: ['loop', 'single', 'shuffle'], usePlaybackProgress: () => ({ position: 10, duration: 100 }), usePlayer: () => {
      const [liked, setLiked] = React.useState(false);
      const [playMode, setPlayMode] = React.useState('loop');
      return { current: track, lyricSettings: {}, queue: [track], player: mediaPlayer, playMode, setPlayMode,
        position: 10, duration: 100, seekTo: (value) => seeks.push(value),
        isLiked: () => liked, toggleLike: (t) => { likedTracks.push(t); setLiked((x) => !x); } };
    } },
    'src/api/client': { imageHeaders: () => ({}) }, 'src/api/bili': { searchLyric: async () => [] },
    'src/components/icons': iconMock,
    'src/components/VideoActionBar': { default: () => null, __esModule: true },
    '@react-native-async-storage/async-storage': storage,
  });
  const Screen = withOverlays(load, load('src/screens/PlayerScreen.js').default);
  let tree;
  await act(async () => { tree = create(React.createElement(Screen, { route: {}, navigation: {} })); });
  const video = tree.root.findByType('VideoView');
  assert.equal(video.props.contentFit, 'contain', 'the original video must remain uncropped');
  assert.equal(video.props.useExoShutter, true, 'Android must not leave the texture transparent after a missed first-frame event');
  assert.deepEqual(video.props.style, { ...rn.StyleSheet.absoluteFill, borderRadius: 14 },
    'the native texture fills the inset surface and matches its corner radius');
  const videoFrame = tree.root.findAllByType('View').find((n) => n.props.style?.[0]?.aspectRatio === 16 / 9);
  assert.equal(videoFrame.props.style[0].overflow, undefined, 'the outer glow must not be clipped');
  const coverGlow = videoFrame.findAllByType('ExpoImage').find((n) => n.props.blurRadius === 28);
  assert.equal(coverGlow.props.source.uri, track.pic, 'the glow colors come from the current cover');
  const scrubber = tree.root.findAll((n) => n.props.accessibilityRole === 'adjustable')[0];
  await act(async () => scrubber.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  await act(async () => scrubber.props.onResponderGrant({ nativeEvent: { locationX: 40 } }));
  await act(async () => scrubber.props.onResponderMove({ nativeEvent: { locationX: 120 } }));
  assert.deepEqual(seeks, [], 'dragging moves only local UI and does not seek the native decoder');
  const thumb = scrubber.findAllByType('AnimatedView').find((n) => n.props.style?.[0]?.width === 10);
  assert.equal(thumb.props.style[1].transform[0].translateX.source.value, 0.6, 'thumb follows the finger immediately');
  await act(async () => scrubber.props.onResponderRelease({ nativeEvent: { locationX: 160 } }));
  assert.deepEqual(seeks, [80], 'the player seeks once after release');
  const tab = (name) => tree.root.findAllByType('TouchableOpacity').find((n) => n.props.accessibilityRole === 'tab'
    && n.findAllByType('Text').some((t) => t.props.children === name));
  await act(async () => tab('原视频').props.onPress());
  await act(async () => animationCalls.at(-1).finish());
  await act(async () => tab('歌词').props.onPress());
  assert.equal(tree.root.findByType('VideoView'), video, 'leaving video must not detach its native surface');
  const page = tree.root.findAllByType('AnimatedView').find((n) => n.props.importantForAccessibility
    && n.findAllByType('VideoView').length);
  assert.equal(page.props.style.at(-1).opacity, undefined, 'the texture must not undergo alpha compositing');
  assert.equal(tree.root.findByType('ScrollView').props.removeClippedSubviews, false);
  await click(tree, '加入我喜欢');
  assert.equal(touch(tree, '取消我喜欢').props.accessibilityState.selected, true);
  const lyricButton = tree.root.findAllByType('TouchableOpacity').find((n) =>
    n.props.accessibilityRole !== 'tab' && n.findAllByType('IconLyric').length);
  const findCover = () => tree.root.findAllByType('View').find((n) => n.props.style?.[1]?.some?.((s) => s?.width > 300));
  const cover = findCover();
  assert.ok(cover);
  const beforeReveal = animationCalls.length;
  await act(async () => lyricButton.props.onPress());
  assert.ok(animationCalls.slice(beforeReveal).some((a) => a.config.toValue === 1 && a.config.duration === 320 && a.config.useNativeDriver));
  assert.equal(findCover(), cover,
    'cover stays mounted during the lyric reveal');
  assert.equal(tree.root.findAll((n) => n.props.accessibilityRole === 'adjustable')[0], scrubber,
    'lyrics share the same footer and scrubber without a remount or layout jump');
  assert.ok(touch(tree, '取消我喜欢'), 'lyric mode shares the same local like state');
  await click(tree, '取消我喜欢');
  assert.equal(touch(tree, '加入我喜欢').props.accessibilityState.selected, false);
  assert.deepEqual(likedTracks, [track, track]);
  assert.equal(tree.root.findAllByType('IconStar').length, 0);
  assert.equal(tree.root.findAllByType('IconVolumeLow').length, 0);
  const more = tree.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('IconMore').length);
  await act(async () => more.props.onPress());
  const menuWindow = tree.root.findByType('KeyboardAvoidingView');
  const addToPlaylist = tree.root.findAllByType('TouchableOpacity').find((n) =>
    n.findAllByType('Text').some((t) => t.props.children === '加入歌单'));
  await act(async () => addToPlaylist.props.onPress());
  assert.equal(tree.root.findByType('KeyboardAvoidingView'), menuWindow, 'menu to playlist must reuse the overlay');
  assert.equal(tree.root.findByType('TextInput').props.placeholder, '新建歌单…');
  await act(async () => [...backListeners].at(-1)());
  const queueButton = tree.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('IconQueue').length);
  await act(async () => queueButton.props.onPress());
  await click(tree, '播放模式：列表循环');
  assert.ok(touch(tree, '播放模式：单曲循环'), 'full player exposes the same queue mode switch');
  await act(async () => tree.unmount());
});

test('video actions lock duplicate likes, remove last favorite, match lyrics and play a selected segment', async () => {
  const pending = deferred(); let likes = 0;
  const h = actionHarness({ api: { likeVideo: () => { likes += 1; return pending.promise; } } });
  let tree;
  await act(async () => { tree = create(React.createElement(h.Component, { track })); });
  const like = touch(tree, '点赞');
  await act(async () => { like.props.onPress(); like.props.onPress(); });
  assert.equal(likes, 1);
  await act(async () => { pending.resolve(); });
  assert.ok(touch(tree, '已赞'));
  await click(tree, '已收藏');
  const folder = tree.root.findByProps({ accessibilityRole: 'checkbox' });
  await act(async () => folder.props.onPress());
  assert.ok(touch(tree, '收藏'), 'last folder removal clears favorite status');
  assert.deepEqual(h.calls.find((c) => c[0] === 'favorite'), ['favorite', 1, [], [5]]);
  await click(tree, '关闭面板');
  await click(tree, '歌词'); await click(tree, '搜索'); await click(tree, '匹配 Song Singer');
  assert.equal(h.calls.find((c) => c[0] === 'lyrics')[2].lines[0].text, 'matched');
  await click(tree, '关闭面板'); await click(tree, '分切');
  const web = tree.root.findByType('WebView');
  await act(async () => web.props.onMessage({ nativeEvent: { data: JSON.stringify({ id: 1, method: 'preview', args: { position: 100 } }) } }));
  const queued = h.calls.find((c) => c[0] === 'queue');
  assert.equal(queued[2], 0); assert.equal(queued[3], 100); assert.equal(queued[1][0].duration, 400);
  await act(async () => web.props.onMessage({ nativeEvent: { data: JSON.stringify({ id: 2, method: 'get', args: { url: 'https://example.com/private' } }) } }));
  assert.ok(h.webScripts.some((s) => s.includes('不支持的请求地址')));
  await act(async () => web.props.onMessage({ nativeEvent: { data: JSON.stringify({ id: 3, method: 'save', args: { segments: [
    { from: 100, to: 200, name: 'Song', match: { source: 'qq', songmid: 'q1', title: 'Matched', artist: 'Singer', pic: 'https://cdn/matched.jpg' } },
  ] } }) } }));
  assert.ok(h.webScripts.some((s) => s.includes('"count":1')));
  await act(async () => web.props.onMessage({ nativeEvent: { data: JSON.stringify({ method: 'saved' }) } }));
  assert.equal(h.calls.find((c) => c[0] === 'navigate')[1], 'LocalPlaylist');
  await act(async () => tree.unmount());
});

test('late comments from a previous track never populate the new track; failure is retryable', async () => {
  const old = deferred(); let attempts = 0;
  const h = actionHarness({ api: { replies: (aid) => {
    if (aid === 1) return old.promise;
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
    return { list: [{ rpid: 2, name: 'B', message: 'new comment' }], total: 1, hasMore: false };
  } } });
  let tree;
  await act(async () => { tree = create(React.createElement(h.Component, { track })); });
  await click(tree, '评论');
  await act(async () => tree.update(React.createElement(h.Component, { track: { ...track, bvid: 'B' } })));
  await click(tree, '评论'); assert.match(textOf(tree), /offline/);
  await click(tree, '重试');
  await act(async () => old.resolve({ list: [{ rpid: 1, message: 'old comment' }], total: 1, hasMore: false }));
  assert.match(textOf(tree), /new comment/); assert.doesNotMatch(textOf(tree), /old comment/);
  await act(async () => tree.unmount());
});

test('download writes a complete temporary file before exporting and cancels pending transfer on track change', async () => {
  const h = actionHarness(); let tree;
  await act(async () => { tree = create(React.createElement(h.Component, { track })); });
  await click(tree, '下载'); await click(tree, '下载 480P');
  assert.ok(h.calls.find((c) => c[0] === 'move' && c[1].from.endsWith('.part')));
  await click(tree, '保存到文件 / 分享');
  assert.ok(h.calls.find((c) => c[0] === 'share' && c[1].endsWith('.mp4')));
  await act(async () => tree.unmount());
  const pending = deferred(); let cancelled = false;
  const h2 = actionHarness({ disk: { createDownloadResumable: (_, fileUri) => ({ fileUri,
    downloadAsync: () => pending.promise, cancelAsync: async () => { cancelled = true; pending.resolve(); } }) } });
  await act(async () => { tree = create(React.createElement(h2.Component, { track })); });
  await click(tree, '下载'); await click(tree, '下载 480P');
  await act(async () => tree.update(React.createElement(h2.Component, { track: { ...track, bvid: 'B' } })));
  assert.ok(cancelled); assert.equal(h2.calls.filter((c) => c[0] === 'move').length, 0);
  await act(async () => tree.unmount());
});

test('media back uses native stack without an animation gate or a transparent blocking route', async () => {
  let result, backs = 0;
  const before = animationCalls.length;
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea,
    '@react-navigation/native': { usePreventRemove: () => assert.fail('media removal must never be prevented') } });
  const { default: useTransition, mediaScreenOptions } = load('src/player/useMediaTransition.js');
  function Screen() { result = useTransition({ goBack: () => backs++ }); return null; }
  let tree;
  await act(async () => { tree = create(React.createElement(Screen)); });
  assert.equal(mediaScreenOptions.presentation, 'card');
  assert.equal(mediaScreenOptions.animation, 'slide_from_bottom');
  assert.equal(animationCalls.length, before);
  assert.equal(result.panHandlers.onMoveShouldSetPanResponder(null, { dx: 1, dy: 20 }), true);
  assert.equal(result.panHandlers.onMoveShouldSetPanResponder(null, { dx: 20, dy: 1 }), false);
  await act(async () => result.panHandlers.onPanResponderRelease(null, { dy: 100, vy: 0 }));
  assert.equal(backs, 1, 'back dispatches immediately without a completion callback');
  assert.equal(result.style, undefined, 'no invisible translated page can remain above the navigator');
  assert.deepEqual(result.safeStyle, { paddingTop: 30, paddingBottom: 24, paddingLeft: 0, paddingRight: 0 });
  await act(async () => tree.unmount());
});

test('player publishes system media metadata, seeks within segments and advances exactly once at the boundary', async () => {
  const listeners = {};
  let replacements = 0;
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 400,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async updateMetadata(metadata) { this.publishedMetadata = metadata; },
    async replaceAsync(source) { replacements += 1; this.source = source; this.currentTime = 0; listeners.sourceLoad({ videoSource: source }); } };
  const urls = [];
  const load = loader({
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: (_, setup) => { React.useMemo(() => setup(player), []); return player; } },
    expo: {
      useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; },
    },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': {
      videoUrl: async (bvid) => { urls.push(bvid); return 'https://cdn/' + bvid; },
      livePlayUrl: async (roomid) => 'https://cdn/live/' + roomid,
    },
    'src/api/client': { streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  let context;
  function Probe() { context = usePlayer(); return null; }
  let tree;
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  assert.equal(player.staysActiveInBackground, true);
  assert.equal(player.showNowPlayingNotification, true, 'background playback must also opt into system media controls');
  assert.equal(player.audioMixingMode, 'doNotMix', 'expo-video alone owns the iOS playback session');
  assert.equal(player.bufferOptions.minBufferForPlayback, 0.5);
  assert.equal(player.bufferOptions.waitsToMinimizeStalling, false, 'iOS can start from cached bytes without waiting for a large safety buffer');
  const list = trackModel.segmentTracks({ bvid: 'A', cid: 10, title: 'Mix', up: 'Artist', pic: '//cdn/cover.jpg' }, [
    { from: 20, to: 40, name: 'One' }, { from: 40, to: 70, match: { title: 'Two', artist: 'Second singer', pic: '//cdn/second.jpg' } },
  ]);
  await act(async () => { await context.playQueue(list); });
  assert.deepEqual(player.source.metadata, { title: 'One', artist: 'Artist', artwork: 'https://cdn/cover.jpg', biuMediaKey: 'A:10', biuSegmentStart: 20, biuSegmentEnd: 40 });
  assert.equal(player.currentTime, 20); assert.equal(context.position, 0); assert.equal(context.duration, 20);
  const seekRevisionBefore = context.seekRevision;
  player.currentTime = 25; // Native system command has already issued the seek.
  await act(async () => listeners.systemSeek({ sourceTime: 25, mediaKey: 'A:10', segmentStart: 20, segmentDuration: 20 }));
  assert.equal(context.position, 5, 'system scrubber immediately updates segment-relative UI');
  assert.equal(player.playing, true, 'system scrubbing retains playing state');
  assert.equal(context.seekRevision, seekRevisionBefore + 1);
  await act(async () => { listeners.timeUpdate({ currentTime: 40 }); listeners.playToEnd(); });
  assert.equal(context.index, 0, 'stale end events cannot finish a song during system scrubbing');
  await act(async () => listeners.timeUpdate({ currentTime: 25.1 }));
  assert.ok(Math.abs(context.position - 5.1) < 0.001);
  await act(async () => listeners.systemSeek({ sourceTime: 45, mediaKey: 'A:10', segmentStart: 40, segmentDuration: 30 }));
  assert.ok(Math.abs(context.position - 5.1) < 0.001, 'delayed seek events from another segment are ignored');
  player.pause();
  await act(async () => context.seekTo(5));
  assert.equal(player.currentTime, 25); assert.equal(context.position, 5);
  assert.equal(context.seekRevision, seekRevisionBefore + 2, 'explicit seeks are visible to lyric interpolation');
  await act(async () => listeners.timeUpdate({ currentTime: 20.25 }));
  assert.equal(context.position, 5, 'a pre-seek native tick cannot flash the lyrics back to the old position');
  await act(async () => context.seekTo(12));
  await act(async () => listeners.timeUpdate({ currentTime: 25 }));
  assert.equal(context.position, 12, 'a second seek supersedes the first while native updates are delayed');
  await act(async () => listeners.timeUpdate({ currentTime: 32.1 }));
  assert.ok(Math.abs(context.position - 12.1) < 0.001, 'the native clock resumes when it reaches the requested position');
  await act(async () => context.seekTo(-8)); assert.equal(player.currentTime, 20);
  await act(async () => context.seekTo(100)); assert.equal(player.currentTime, 40);
  assert.equal(context.position, 20);
  player.play();
  await act(async () => { listeners.timeUpdate({ currentTime: 40 }); listeners.playToEnd(); });
  assert.equal(urls.length, 1, 'adjacent segments keep the loaded video source and its rendered frame');
  assert.equal(replacements, 1, 'same-video segments seek without clearing the native texture');
  assert.equal(context.index, 1); assert.equal(player.currentTime, 40); assert.equal(context.duration, 30);
  assert.equal(context.history.length, 2, 'both segments remain in history');
  assert.deepEqual(player.publishedMetadata, { title: 'Two', artist: 'Second singer', artwork: 'https://cdn/second.jpg', biuMediaKey: 'A:10', biuSegmentStart: 40, biuSegmentEnd: 70 },
    'same-video segments update title, artist and cover without replacing the stream');
  await act(async () => { await context.playQueue(list, 0); });
  assert.equal(player.publishedMetadata.title, 'One', 'manual switches back also refresh the media card');
  assert.equal(player.publishedMetadata.artwork, 'https://cdn/cover.jpg');
  assert.equal(replacements, 1);
  await act(async () => { await context.playQueue([{ bvid: 'A', cid: 10, title: 'Whole video', duration: 400 }]); });
  assert.equal(player.publishedMetadata.biuSegmentStart, null, 'reusing a source for the full video clears the old segment');
  assert.equal(player.publishedMetadata.biuSegmentEnd, null);
  assert.equal(context.duration, 400);
  await act(async () => { await context.playQueue([{ isLive: true, roomid: 100, title: 'Live radio', up: 'Host' }]); });
  assert.equal(player.source.contentType, 'hls');
  assert.deepEqual(player.source.metadata, { title: 'Live radio', artist: 'Host', artwork: undefined, biuMediaKey: ':0', biuSegmentStart: null, biuSegmentEnd: null }, 'live sources replace all metadata without retaining the previous cover');
  await act(async () => tree.unmount());
});

test('Android media session publishes one standard previous/next pair without duplicate custom actions', () => {
  const patch = fs.readFileSync(path.join(root, 'patches/expo-video+57.0.3.patch'), 'utf8');
  const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.doesNotMatch(additions, /BIU_NEXT_TRACK|BIU_PREVIOUS_TRACK|setCustomLayout/);
  for (const command of ['PREVIOUS', 'PREVIOUS_MEDIA_ITEM', 'NEXT', 'NEXT_MEDIA_ITEM']) {
    assert.ok(additions.includes(`Player.COMMAND_SEEK_TO_${command}`), `standard ${command} remains available`);
  }
  assert.match(additions, /override fun seekToPrevious\(\) = videoPlayer.emitRemotePrevious\(\)/);
  assert.match(additions, /override fun seekToNext\(\) = videoPlayer.emitRemoteNext\(\)/);
});

test('iOS transport has one application owner and keeps targets across item changes', () => {
  const native = fs.readFileSync(path.join(root, 'node_modules/expo-video/ios/NowPlayingManager.swift'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'node_modules/expo-video/ios/VideoView.swift'), 'utf8');
  assert.match(view, /updatesNowPlayingInfoCenter = false/);
  assert.match(native, /commandCenter = MPRemoteCommandCenter.shared\(\)/);
  assert.match(native, /infoCenter = MPNowPlayingInfoCenter.default\(\)/);
  assert.doesNotMatch(native, /MPNowPlayingSession\(players:|MediaSession\(model\)/,
    'AVPlayerViewController already owns the player session; do not attach another');
  assert.match(native, /add\(commandCenter.nextTrackCommand\)/);
  assert.match(native, /add\(commandCenter.previousTrackCommand\)/);
  assert.doesNotMatch(native, /add\(commandCenter.skip(?:Forward|Backward)Command\)/);
  assert.match(native, /for \(command, target\) in targets \{ command.removeTarget\(target\) \}/,
    'only non-optional tokens owned by this manager may be removed');
  assert.doesNotMatch(native, /reinstall|setCategory\(/,
    'track changes must not recreate handlers or fight VideoManager over the audio session');
  assert.ok(native.indexOf('infoCenter.nowPlayingInfo = info') < native.indexOf('await item.asset.loadMetadata'),
    'network metadata must not block publication of the system card');
  assert.match(native, /infoCenter\.nowPlayingInfo = info\s+infoCenter\.playbackState = player\.rate > 0 \? \.playing : \.paused/,
    'publish explicit transport state after metadata: the simulator does not infer it from audio');
  const dynamicUpdate = native.slice(native.indexOf('private func updateNowPlayingDynamicValues()'), native.indexOf('func updateNowPlayingLyric'));
  assert.match(dynamicUpdate, /infoCenter\.playbackState = player\.rate > 0 \? \.playing : \.paused/,
    'play and pause transitions must update system state, not only initial publication');
  assert.match(native, /infoCenter\.playbackState = \.stopped/, 'teardown must not leave a playing system session');
  assert.match(native, /!Task.isCancelled/);
  assert.match(native, /player.currentItem === item/, 'late metadata must belong to the current track');
  assert.match(native, /MPMediaItemPropertyArtwork: cachedArtwork \?\? loadingArtwork \?\? fallbackArtwork/,
    'initial metadata publication must include artwork while the next cover loads');
  assert.match(native, /cachedArtwork == nil/, 'ready-to-play refreshes must reuse downloaded artwork');
  assert.match(native, /self.metadataRevision == revision/,
    'a cancelled callback must not overwrite artwork even if the player item is unchanged');
  assert.match(native, /info\[MPMediaItemPropertyArtwork\] = artwork \?\? self.fallbackArtwork/,
    'failed artwork loads must use a branded fallback, not clear artwork or retain the previous song');
});

test('cold startup restores a paused queue locally, loads only on play/resume and never overrides a newer user selection', async () => {
  const saved = { queue: [{ bvid: 'saved', cid: 1, duration: 100, isSegment: true, from: 20, to: 80 }],
    index: 0, position: 12, source: 'discovery' };
  for (const action of ['togglePlay', 'resume', 'late']) {
    const disk = deferred(), requests = [], writes = [], listeners = {};
    const player = { playing: false, status: 'idle', currentTime: 0, duration: 100,
      play() { this.playing = true; }, pause() { this.playing = false; },
      async replaceAsync(source) { this.source = source; this.status = 'readyToPlay'; listeners.sourceLoad({ videoSource: source }); } };
    const load = loader({ 'expo-video': { useVideoPlayer: () => player },
      expo: { useEvent: () => ({}), useEventListener: (_, name, fn) => { listeners[name] = fn; } },
      '@react-native-async-storage/async-storage': {
        getItem: async key => key === 'biu.playback-session' ? disk.promise : null,
        setItem: async (key, value) => { if (key === 'biu.playback-session') writes.push(value); },
      },
      'src/api/bili': { videoUrl: async bvid => { requests.push(bvid); return 'https://cdn/' + bvid; } },
      'src/api/client': { streamHeaders: () => ({}) },
    });
    const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
    let context, tree;
    function Probe() { context = usePlayer(); return null; }
    await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
    try {
      if (action === 'late') await act(async () => context.playQueue([{ bvid: 'chosen', cid: 1 }]));
      await act(async () => disk.resolve(JSON.stringify(saved)));
      if (action === 'late') {
        assert.equal(context.current.bvid, 'chosen');
        assert.deepEqual(requests, ['chosen']);
        continue;
      }
      assert.equal(context.current.bvid, 'saved');
      assert.equal(context.queueSource, 'discovery');
      assert.equal(context.position, 12);
      assert.equal(context.buffering, false);
      assert.equal(context.mediaDeferred, true);
      assert.deepEqual(requests, [], 'restoring a paused bar must not fetch video');
      assert.deepEqual(writes, [], 'reading the session must not rewrite its entire queue');
      assert.equal(player.source, undefined);
      await act(async () => listeners.timeUpdate({ currentTime: 0 }));
      assert.equal(context.position, 12, 'empty player ticks cannot erase the saved position');
      await act(async () => context.seekTo(18));
      assert.equal(context.position, 18);
      assert.equal(player.currentTime, 0, 'paused restore seek is local until media is loaded');
      await act(async () => context[action]());
      assert.deepEqual(requests, ['saved']);
      assert.equal(player.currentTime, 38, 'first play respects the segment start and locally edited position');
      assert.equal(player.playing, true);
      assert.equal(context.mediaDeferred, false);
    } finally { await act(async () => tree.unmount()); }
  }
});

test('background profile updates do not rerender narrow navigation and library subscribers', async () => {
  const player = { playing: false, status: 'idle', pause() {} };
  const load = loader({ 'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: () => ({}), useEventListener() {} }, 'src/api/client': {}, 'src/api/bili': {} });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  let state, navigationRenders = 0, libraryRenders = 0, tree;
  function All() { state = usePlayer(); return null; }
  function Navigation() { usePlayer(['discoveryEnabled']); navigationRenders++; return null; }
  function Library() { usePlayer(['likes', 'libraryTracks']); libraryRenders++; return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null,
    React.createElement(All), React.createElement(Navigation), React.createElement(Library))); });
  try {
    const initial = [navigationRenders, libraryRenders];
    await act(async () => state.recommendationManager.edit({ type: 'save', name: '音乐', tags: ['钢琴'] }));
    await act(async () => state.discoveryRecommendationManager.edit({ type: 'save', name: '发现', tags: ['cos'] }));
    assert.deepEqual([navigationRenders, libraryRenders], initial);
    await act(async () => state.setDiscoveryEnabled(true));
    assert.equal(navigationRenders, initial[0] + 1, 'a relevant change still updates the tab immediately');
    assert.equal(libraryRenders, initial[1]);
  } finally { await act(async () => tree.unmount()); }
});

test('repeated sync preserves collection identities and never reloads playing media', async () => {
  const writes = [], mediaCalls = [];
  const player = { playing: true, status: 'readyToPlay',
    pause() { mediaCalls.push('pause'); }, play() { mediaCalls.push('play'); },
    replaceAsync() { mediaCalls.push('replace'); } };
  const load = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: true } : { status: 'readyToPlay' }, useEventListener() {} },
    'src/api/client': {}, 'src/api/bili': {},
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async (key) => writes.push(key) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const playlists = load('src/store/playlists.js');
  let state, tree;
  function Probe() { state = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const seed = { version: 1, likes: [{ bvid: 'BVliked' }], library: [{ bvid: 'BVsaved' }],
      playlists: [{ id: 'test', title: '测试', tracks: [{ bvid: 'BVlist' }] }] };
    await act(async () => state.applySyncLibrary(seed));
    const before = { likes: state.likes, tracks: state.libraryTracks, lists: await playlists.getPlaylists() };
    writes.length = 0; mediaCalls.length = 0;
    await act(async () => state.applySyncLibrary(seed, seed));
    assert.equal(state.likes, before.likes);
    assert.equal(state.libraryTracks, before.tracks);
    assert.equal(await playlists.getPlaylists(), before.lists);
    assert.deepEqual(writes.filter(key => /^biu\.(likes|library|playlists)/.test(key)), []);
    assert.deepEqual(mediaCalls, []);
    assert.equal(state.isLiked({ bvid: 'BVliked' }), true);
    assert.equal(state.isInLibrary({ bvid: 'BVsaved' }), true);
    const empty = { version: 1, likes: [], library: [], playlists: [] };
    await act(async () => state.applySyncLibrary(empty, seed));
    assert.equal(state.likes.length, 0);
    assert.equal(state.libraryTracks.length, 0);
    assert.equal((await playlists.getPlaylists()).length, 0, 'remote deletion still applies');
  } finally { await act(async () => tree.unmount()); }
});

test('local likes rebase on a sync commit that arrives during worker serialization', async () => {
  const held = deferred(), started = deferred();
  let hold = true, state, tree;
  const load = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: () => ({}), useEventListener() {} }, 'src/api/client': {}, 'src/api/bili': {},
    'src/performance/backgroundCompute': { backgroundCompute: async (operation, ...args) => {
      if (hold && operation === 'stringify' && Array.isArray(args[0]) && args[0].some(t => t.bvid === 'BVlocal')) {
        hold = false; started.resolve(); await held.promise;
      }
      return runCompute(operation, ...args);
    } },
  });
  const player = { playing: false, status: 'idle', pause() {} };
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  function Probe() { state = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    let saving;
    await act(async () => { saving = state.toggleLike({ bvid: 'BVlocal' }); await started.promise; });
    await act(async () => state.applySyncLibrary({ version: 1, likes: [{ bvid: 'BVremote' }], library: [], playlists: [] }, null, ''));
    await act(async () => { held.resolve(); await saving; });
    assert.deepEqual(state.likes.map(t => t.bvid).sort(), ['BVlocal', 'BVremote']);
  } finally { held.resolve(); await act(async () => tree.unmount()); }
});

test('background argument transfer never freezes live state or reuses stale serialized objects', async () => {
  let runtimes = 0;
  const load = loader({ 'react-native-worklets': {
    createWorkletRuntime: options => { runtimes++; assert.equal(options.name, 'biu-data'); return {}; },
    runOnRuntimeAsync: async (_runtime, worklet, ...args) => {
      assert.ok(args[1].every(value => value === undefined || typeof value === 'string'),
        'large state crosses the runtime boundary as strings, never recursive shareable objects');
      const freeze = value => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
        Object.freeze(value); Object.values(value).forEach(freeze); };
      args.forEach(freeze);
      return worklet(...args);
    },
  } });
  const { backgroundCompute } = load('src/performance/backgroundCompute.js');
  const track = { bvid: 'BVmutable', title: 'before' }, data = { likes: [track] };
  const raw = await backgroundCompute('stringify', data);
  assert.equal(JSON.parse(raw).likes[0].title, 'before');
  track.title = 'after';
  assert.equal(Object.isFrozen(track), false);
  assert.equal(JSON.parse(await backgroundCompute('stringify', data)).likes[0].title, 'after');
  const untrusted = JSON.parse('{"__proto__":{"admin":true},"version":1}');
  const result = JSON.parse(await backgroundCompute('stringify', untrusted));
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal({}.admin, undefined);
  assert.equal(runtimes, 1);
  delete global.__biuCompute;
});

test('system previous and next follow the latest queue, including single-repeat and paused playback', async () => {
  const listeners = {};
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 180,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { this.source = source; this.currentTime = 0; listeners.sourceLoad({ videoSource: source }); } };
  const load = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: {
      useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; },
    },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    'src/api/bili': { videoUrl: async (bvid) => 'https://cdn/' + bvid },
    'src/api/client': { streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  let context, tree;
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const tracks = ['A', 'B', 'C'].map((bvid) => ({ bvid, cid: 1, title: bvid }));
    await act(async () => context.playQueue(tracks, 0, 0, 'discovery'));
    assert.equal(context.queueSource, 'discovery');
    await act(async () => context.setPlayMode('single'));
    await act(async () => listeners.nextTrack());
    assert.equal(context.current.bvid, 'B', 'remote next bypasses automatic single-repeat');
    assert.equal(context.queueSource, 'discovery', 'transport controls retain the discovery queue owner');
    await act(async () => listeners.previousTrack());
    assert.equal(context.current.bvid, 'A');
    player.pause();
    await act(async () => listeners.previousTrack());
    assert.equal(context.current.bvid, 'C', 'previous wraps to the last track');
    assert.equal(player.playing, true, 'manual transport resumes the selected track');
    await act(async () => context.playQueue([tracks[2], tracks[0], tracks[1]]));
    assert.equal(context.queueSource, '', 'starting an ordinary queue clears the discovery owner');
    await act(async () => listeners.nextTrack());
    assert.equal(context.current.bvid, 'A', 'remote callbacks read the reordered queue');
    await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
    await act(async () => listeners.playToEnd());
    assert.equal(context.current.bvid, 'A', 'automatic completion still honors single-repeat');
  } finally { await act(async () => tree.unmount()); }
});

test('reordered segments ignore old native progress and end events until their seek lands', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const listeners = {};
  let replacements = 0;
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 180,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { replacements++; this.currentTime = 0; listeners.sourceLoad({ videoSource: source }); } };
  const load = loader({
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => player },
    expo: {
      useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; },
    },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': { videoUrl: async () => 'https://cdn/mix.mp4' },
    'src/api/client': { streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  let context, tree;
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  const tracks = trackModel.segmentTracks({ bvid: 'BVmix', cid: 10, title: 'Mix' }, [
    { from: 0, to: 30, name: 'First' }, { from: 60, to: 90, name: 'Middle' }, { from: 120, to: 150, name: 'Last' },
  ]);
  try {
    await act(async () => context.playQueue(tracks, 2));
    await act(async () => listeners.timeUpdate({ currentTime: 120.25 }));
    const synced = [tracks[2], tracks[0], tracks[1]].map((track) => ({ ...track }));
    await act(async () => context.playQueue(synced, 1));
    assert.equal(replacements, 1, 'segments reuse the same native video');
    assert.equal(context.current.title, 'First');
    assert.equal(player.currentTime, 0);
    now += 3000; // A slow native seek outlasts the ordinary scrubber's hold.
    await act(async () => listeners.timeUpdate({ currentTime: 125.25 }));
    assert.equal(context.current.title, 'First', 'an old tick must not skip the clicked segment');
    await act(async () => listeners.playToEnd());
    assert.equal(context.current.title, 'First', 'an old end event must not skip the pending seek');
    await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
    assert.equal(context.position, 0.25);
    await act(async () => listeners.timeUpdate({ currentTime: 30 }));
    assert.equal(context.current.title, 'Middle', 'real completion follows the newly synced playlist order');
    assert.equal(player.currentTime, 60);
  } finally { await act(async () => tree.unmount()); }
});

test('background automatic transitions keep the media service active through loading, repeat and segments', async () => {
  const listeners = {}, urls = [];
  const nextUrl = deferred();
  let background = false, foregroundService = false, pauses = 0;
  const player = {
    playing: false, status: 'readyToPlay', currentTime: 0, duration: 400,
    play() {
      if (background && !foregroundService) throw new Error('Foreground service cannot restart in background');
      this.playing = true;
      foregroundService = true;
    },
    pause() { this.playing = false; foregroundService = false; pauses += 1; },
    async replaceAsync(source) { this.source = source; this.currentTime = 0; listeners.sourceLoad({ videoSource: source }); },
  };
  const load = loader({
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: (_, setup) => { React.useMemo(() => setup(player), []); return player; } },
    expo: {
      useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; },
    },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': { videoUrl: async (bvid) => {
      urls.push(bvid);
      return bvid === 'B' ? nextUrl.promise : 'https://cdn/' + bvid;
    } },
    'src/api/client': { streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  let context, tree;
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  await act(async () => context.playQueue([
    { bvid: 'A', cid: 10, title: 'First' }, { bvid: 'B', cid: 20, title: 'Second' },
  ]));
  const pausesBeforeEnd = pauses;
  await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
  background = true;
  player.playing = false; // STATE_ENDED retains playWhenReady and the foreground service.
  await act(async () => { listeners.timeUpdate({ currentTime: 399.8 }); });
  assert.equal(context.index, 1);
  assert.equal(context.buffering, true);
  assert.equal(context.automaticVideoTransition, true, 'autoplay is identified before the next URL finishes loading');
  assert.equal(foregroundService, true, 'URL resolution must not demote the service');
  await act(async () => { listeners.playToEnd(); });
  assert.deepEqual(urls, ['A', 'B'], 'duplicate end events cannot start a second transition');
  await act(async () => nextUrl.resolve('https://cdn/B'));
  assert.equal(pauses, pausesBeforeEnd);
  assert.equal(context.playError, null);
  assert.equal(player.playing, true);
  assert.equal(player.source.metadata.title, 'Second');
  // expo-video iOS resolves replaceAsync before the main-thread AVPlayerItem swap.
  // A sourceChange retry must start the newly installed item after the earlier play was lost.
  player.playing = false;
  await act(async () => listeners.sourceChange({ source: player.source }));
  assert.equal(player.playing, true);
  await act(async () => context.setPlayMode('single'));
  await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
  player.playing = false;
  await act(async () => { listeners.playToEnd(); });
  assert.equal(player.playing, true);
  assert.equal(context.index, 1);
  assert.equal(pauses, pausesBeforeEnd, 'single repeat keeps the service too');

  background = false;
  await act(async () => context.setPlayMode('loop'));
  await act(async () => context.playQueue(trackModel.segmentTracks(
    { bvid: 'A', cid: 10, title: 'Mix' },
    [{ from: 20, to: 40, name: 'One' }, { from: 40, to: 70, name: 'Two' }],
  )));
  assert.equal(context.automaticVideoTransition, false, 'manual queue selection clears the continuous-surface transition');
  const pausesBeforeSegment = pauses;
  background = true;
  await act(async () => listeners.timeUpdate({ currentTime: 20.25 }));
  await act(async () => { listeners.timeUpdate({ currentTime: 40 }); listeners.playToEnd(); });
  assert.equal(context.index, 1);
  assert.equal(player.currentTime, 40);
  assert.equal(pauses, pausesBeforeSegment);
  assert.equal(context.playError, null);
  await act(async () => context.pauseAll());
  assert.equal(player.playing, false, 'explicit pause still stops playback');
  assert.equal(foregroundService, false);
  await act(async () => tree.unmount());
});

test('mini player ring, queue controls and persisted playback modes share actual segment / shuffle playback', async ({ mock }) => {
  const listeners = {}, writes = new Map(), visits = [], urls = [];
  const delayedMode = deferred();
  let restoreDelayed = true;
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 400,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { this.source = source; this.currentTime = 0; listeners.sourceLoad({ videoSource: source }); } };
  const load = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    '@react-navigation/native': { useNavigation: () => ({ navigate: (name) => visits.push(name) }) },
    'react-native-svg': { default: 'Svg', Circle: 'Circle', __esModule: true },
    'expo-blur': { BlurView: 'BlurView' },
    'expo-image': { Image: 'ExpoImage' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'src/components/icons': iconMock,
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: (_, setup) => { React.useMemo(() => setup(player), []); return player; } },
    expo: {
      useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; },
    },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => key === 'biu.play-mode' && restoreDelayed ? delayedMode.promise : (writes.get(key) ?? null),
      setItem: async (key, value) => writes.set(key, value),
    },
    'src/api/bili': {
      videoUrl: async (bvid) => { urls.push(bvid); return 'https://cdn/' + bvid; },
      livePlayUrl: async (roomid) => 'https://cdn/live/' + roomid,
    },
    'src/api/client': { streamHeaders: () => ({}), imageHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const MiniBar = withOverlays(load, load('src/components/MiniBar.js').default);
  let context, tree;
  const blurTarget = { current: {} };
  function Probe() { context = usePlayer(); return React.createElement(MiniBar, { blurTarget }); }
  const render = () => React.createElement(PlayerProvider, null, React.createElement(Probe));
  await act(async () => { tree = create(render()); });
  assert.equal(touch(tree, '打开播放列表'), undefined);
  assert.equal(context.playMode, 'loop');
  const list = [
    ...trackModel.segmentTracks({ bvid: 'A', cid: 10, up: 'Artist', pic: 'https://cdn/cover.jpg' }, [{ from: 20, to: 40, name: 'Segment' }]),
    { bvid: 'B', cid: 11, title: 'Second' }, { bvid: 'C', cid: 12, title: 'Third' },
  ];
  await act(async () => { await context.playQueue(list); });
  const blur = tree.root.findByType('BlurView');
  assert.equal(blur.props.blurTarget, blurTarget,
    'the realtime glass uses the explicit Android blur target');
  assert.equal(blur.props.blurMethod, 'dimezisBlurView');
  assert.equal(blur.props.intensity, 72);
  assert.equal(blur.props.blurReductionFactor, 3);
  assert.ok(tree.root.findByType('Gradient').props.colors[0].includes('0.10'));
  const ring = () => tree.root.findAllByType('Circle').find((n) => n.props.strokeDashoffset !== undefined);
  const circumference = ring().props.strokeDasharray[0];
  assert.equal(ring().props.opacity, 0, 'an unplayed track has no stray progress dot');
  await act(async () => listeners.timeUpdate({ currentTime: 20.25 }));
  await act(async () => listeners.timeUpdate({ currentTime: 25 }));
  assert.equal(ring().props.strokeDashoffset, circumference * 0.75, 'ring uses segment-relative progress');
  assert.equal(ring().props.rotation, -90, 'progress starts at twelve o’clock');
  player.pause();
  await act(async () => context.seekTo(500));
  assert.equal(ring().props.strokeDashoffset, 0, 'progress is capped at one full circle');
  await act(async () => context.seekTo(-5));
  assert.equal(ring().props.strokeDashoffset, circumference);
  await click(tree, '打开播放列表');
  assert.equal(visits.length, 0, 'queue entry must not open the full player');
  assert.ok(touch(tree, '播放 Segment').props.accessibilityState.selected);
  const window = tree.root.findByType('KeyboardAvoidingView');
  assert.equal(tree.root.findAllByType('Modal').length, 0);
  await click(tree, '播放模式：列表循环');
  assert.equal(context.playMode, 'single');
  assert.equal(writes.get('biu.play-mode'), '"single"');
  await act(async () => delayedMode.resolve('"shuffle"'));
  restoreDelayed = false;
  assert.equal(context.playMode, 'single', 'late restore cannot overwrite a mode chosen in the queue');
  assert.equal(tree.root.findByType('KeyboardAvoidingView'), window, 'mode changes preserve the sheet overlay');
  player.play();
  for (let i = 0; i < 2; i++) {
    const before = urls.length;
    await act(async () => listeners.timeUpdate({ currentTime: 20.25 }));
    await act(async () => { listeners.timeUpdate({ currentTime: 40 }); listeners.playToEnd(); });
    assert.equal(urls.length, before, 'segment repeat seeks without reloading or blanking the video');
    assert.equal(context.index, 0); assert.equal(player.currentTime, 20); assert.equal(context.position, 0);
  }
  await act(async () => { await context.next(); });
  assert.equal(context.index, 1, 'single repeat still allows manual next');
  await act(async () => { await context.prev(); });
  assert.equal(context.index, 0);
  mock.method(Math, 'random', () => 0.99);
  await click(tree, '播放模式：单曲循环');
  await act(async () => { await context.next(); });
  assert.equal(context.index, 2, 'shuffle picks another entry instead of always following list order');
  await act(async () => { await context.prev(); });
  assert.equal(context.index, 0, 'shuffle previous returns to the actual last song');
  await act(async () => listeners.timeUpdate({ currentTime: 20.25 }));
  await act(async () => { listeners.timeUpdate({ currentTime: 40 }); listeners.playToEnd(); });
  assert.equal(context.index, 2, 'automatic next also follows shuffle mode');
  await click(tree, '播放模式：随机播放');
  await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
  await act(async () => listeners.playToEnd());
  assert.equal(context.index, 0, 'list repeat wraps the last song to the first');
  await click(tree, '播放 Second');
  assert.equal(context.index, 1, 'queue rows select the requested track');
  assert.equal(tree.root.findAllByType('Modal').length, 0);
  await click(tree, '打开播放页：Second');
  assert.deepEqual(visits, ['Player']);
  await act(async () => context.setPlayMode('shuffle'));
  await act(async () => { await context.playQueue([list[1]]); });
  await act(async () => { await context.next(); });
  assert.equal(context.queue.length, 1);
  assert.equal(context.index, 0, 'shuffle works with a one-song queue');
  await act(async () => { await context.playQueue([
    { isLive: true, roomid: 100, title: 'Radio' }, { isLive: true, roomid: 101, title: 'Radio 2' },
  ]); });
  assert.equal(tree.root.findAllByType('Circle').length, 0, 'live radio has no finite progress ring');
  await act(async () => listeners.playToEnd());
  assert.equal(context.index, 0, 'radio never loops a finite segment');
  await click(tree, '下一电台');
  assert.equal(context.index, 1);
  await act(async () => context.setPlayMode('invalid'));
  assert.equal(context.playMode, 'shuffle');
  await act(async () => tree.unmount());
  await act(async () => { tree = create(render()); });
  assert.equal(context.playMode, 'shuffle', 'playback mode survives app restart');
  await act(async () => tree.unmount());
});

function interpolationAt(config, time) {
  const { inputRange: xs, outputRange: ys } = config;
  if (time <= xs[0]) return ys[0];
  if (time >= xs.at(-1)) return ys.at(-1);
  const i = xs.findIndex((x) => x > time);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * (time - xs[i - 1]) / (xs[i] - xs[i - 1]);
}
const animatedAt = (node) => interpolationAt(node.config, node.source.value);
const lyricMocks = {
  'react-native': rn,
  'biu-lyric-monet': 'MonetGlow',
  '@react-native-masked-view/masked-view': ({ maskElement, children, ...props }) =>
    React.createElement('Mask', { ...props, maskElement }, maskElement, children),
  'expo-linear-gradient': { LinearGradient: 'Gradient' },
};

test('lyrics wait for viewport and measured row heights, align while paused, and discard obsolete layouts', async () => {
  let fontScale = 1;
  const Lyrics = loader({ ...lyricMocks, 'react-native': {
    ...rn, useWindowDimensions: () => ({ width: 390, height: 844, fontScale }),
  } })('src/components/LyricsRail.js').default;
  const original = Array.from({ length: 12 }, (_, i) => ({ from: i * 4, to: (i + 1) * 4,
    text: i === 1 ? '这是一句需要换行的很长的歌词 Mixed words' : `歌词 ${i}` }));
  let lines = original, width = 0, height = 0, effect = 'simple', activeIndex = 2, tree;
  const render = () => React.createElement(Lyrics, { lines, width, height, effect,
    activeIndex, position: 9, playing: false });
  const rows = () => tree.root.findAllByType('AnimatedView').filter((n) => n.props.onLayout);
  const rail = () => tree.root.findAllByType('View').find((n) => n.props.style?.flex === 1 && n.props.style.opacity !== undefined);
  const measure = async (row, h) => act(async () => row.props.onLayout({ nativeEvent: { layout: { width, height: h } } }));
  const measuredHeight = (i) => i === 1 ? 121 : i === 2 ? 86 : 51;
  const checkGeometry = () => {
    const bounds = rows().map((row, i) => {
      const [_, ty, scale] = row.props.style[1].transform;
      const h = measuredHeight(i), s = scale.scale.value;
      return { top: ty.translateY.value + h * (1 - s) / 2, height: h * s };
    });
    assert.ok(Math.abs(bounds[2].top + bounds[2].height / 2 - height * 0.46) < 1e-6, 'the current line is centered immediately, even while paused');
    for (let i = 1; i <= 6; i++) {
      const gap = bounds[i].top - bounds[i - 1].top - bounds[i - 1].height;
      assert.ok(Math.abs(gap - (i === 2 || i === 3 ? 18 : 14)) < 1e-6, 'wrapped rows keep their full height and intended gap');
    }
  };
  await act(async () => { tree = create(render()); });
  assert.equal(rows().length, 0, 'do not mount rows at the placeholder position before the viewport is known');
  width = 390; height = 500;
  await act(async () => tree.update(render()));
  assert.equal(rail().props.style.opacity, 0);
  await measure(rows()[2], measuredHeight(2));
  assert.equal(rail().props.style.opacity, 0, 'one measured row is not enough to position its neighbours');
  for (const i of [6, 0, 4, 1, 5, 3]) await measure(rows()[i], measuredHeight(i));
  assert.equal(rail().props.style.opacity, 1);
  checkGeometry();
  // Overscan measurements must not hide the already positioned rows or move their bounds.
  for (const i of [7, 8]) await measure(rows()[i], measuredHeight(i));
  assert.equal(rail().props.style.opacity, 1); checkGeometry();
  const before = animationCalls.length;
  activeIndex = 3;
  await act(async () => tree.update(render()));
  assert.equal(rail().props.style.opacity, 1, 'normal playback uses premeasured neighbouring rows');
  assert.ok(animationCalls.slice(before).some((a) => a.config.duration === 420), 'subsequent lyric changes still scroll smoothly');
  activeIndex = 10;
  await act(async () => tree.update(render()));
  assert.equal(rail().props.style.opacity, 1, 'a distant seek retains visible lyrics while destination rows are measured');
  const destinationRows = rows();
  for (let i = 0; i < destinationRows.length; i++) await measure(destinationRows[i], measuredHeight(i));
  assert.equal(rail().props.style.opacity, 1, 'revealing the measured destination never blanks the rail');
  activeIndex = 2;
  for (const change of [() => { width = 320; }, () => { effect = 'monet'; },
    () => { fontScale = 1.3; }, () => { lines = original.map((l) => ({ ...l, text: l.text + ' 新歌词' })); }]) {
    const obsolete = rows()[0].props.onLayout;
    change();
    await act(async () => tree.update(render()));
    assert.equal(rail().props.style.opacity, 0, 'new wrapping conditions require fresh measurements');
    for (let i = 0; i <= 6; i++) await measure(rows()[i], measuredHeight(i));
    assert.equal(rail().props.style.opacity, 1); checkGeometry();
    await act(async () => obsolete({ nativeEvent: { layout: { width: 390, height: 999 } } }));
    assert.equal(rail().props.style.opacity, 1); checkGeometry();
  }
  await act(async () => tree.unmount());
});

test('native sweep segments match Monet glyph positions, timing gaps and soft edges; jitter never resets the clock', () => {
  const token = { text: 'Wi中', t0: 10, t1: 13 };
  const offsets = [0, 28, 35, 65];
  for (const variant of [token, { ...token, graphemeTimings: [
    { startTime: 10, endTime: 10.5 }, { startTime: 11, endTime: 11.5 }, { startTime: 12, endTime: 13 },
  ] }]) {
    const frames = motion.sweepFrames(variant, offsets, 12);
    for (let time = 9; time < 14; time += 0.017) {
      assert.ok(Math.abs(interpolationAt(frames, time) - motion.sweepEndAt(time, variant, offsets, 12)) < 1e-8);
    }
  }
  const glow = motion.glowFrames(token, 14);
  for (let time = 10; time < 15; time += 0.017) {
    assert.ok(Math.abs(interpolationAt(glow, time) - motion.glowAt(time, token, 14) * 0.88) < 0.006);
  }
  const previous = { pos: 2, ts: 1000, playing: true, revision: 0 };
  const sample = { pos: 2.25, ts: 1280, playing: true, revision: 0 };
  assert.equal(motion.shouldResetLyricClock(previous, sample), false, '30ms arrival jitter must not move the light backwards');
  assert.equal(motion.shouldResetLyricClock(previous, { ...sample, revision: 1 }), true, 'small explicit seeks reset immediately');
  assert.equal(motion.shouldResetLyricClock(previous, { ...sample, playing: false }), true);
  assert.equal(motion.shouldResetLyricClock(previous, { ...sample, pos: 20 }), true);
});

test('Monet uses static hardware glyph masks and one native clock across words, including paused and short seeks', async () => {
  const Lyrics = loader(lyricMocks)('src/components/LyricsRail.js').default;
  const lines = [{ from: 0, to: 4, text: '你好世界', tokens: [
    { text: '你好', t0: 0, t1: 2, timed: true }, { text: '世界', t0: 2, t1: 4, timed: true },
  ] }];
  let tree;
  const render = (position, playing = false, clockRevision = 0) => React.createElement(Lyrics,
    { lines, activeIndex: 0, position, playing, clockRevision, width: 390, height: 500, effect: 'monet' });
  await act(async () => { tree = create(render(1)); });
  const masks = tree.root.findAllByType('Mask').filter((n) => n.props.maskElement.type === 'Text');
  assert.equal(masks.length, 2);
  assert.ok(masks.every((n) => n.props.androidRenderingMode === 'hardware'));
  const front = (mask) => mask.findByType('AnimatedView').props.style.transform[0].translateX;
  assert.equal(front(masks[0]).source, front(masks[1]).source, 'all words derive from one clock');
  const early = animatedAt(front(masks[0])); assert.ok(early > 0);
  await act(async () => tree.update(render(1.8))); assert.ok(animatedAt(front(masks[0])) > early);
  await act(async () => tree.update(render(0))); assert.equal(animatedAt(front(masks[0])), 0);
  const before = animationCalls.length;
  await act(async () => tree.update(render(1, true)));
  assert.equal(animationCalls.length, before + 1, 'one timing animation per native sample, never a loop per word');
  const clock = animationCalls.at(-1);
  assert.equal(clock.config.useNativeDriver, true);
  assert.equal(clock.config.isInteraction, false);
  assert.equal(clock.config.toValue, 31);
  assert.equal(clock.config.duration, 30000, 'each native timing allocates at most 1,801 frame values, not an hour of frames');
  clock.value.setValue(1.28); // Native frame between React updates.
  const moving = animatedAt(front(masks[0]));
  const timingsBeforeSample = animationCalls.length;
  await act(async () => tree.update(render(1.25, true)));
  assert.equal(animatedAt(front(masks[0])), moving, 'a late sample does not snap back from the rendered frame');
  assert.equal(animationCalls.length, timingsBeforeSample, 'an agreeing playback sample leaves the clock untouched');
  await act(async () => tree.update(render(1.2, true, 1)));
  assert.equal(front(masks[0]).source.value, 1.2, 'even a 50ms explicit backward seek applies immediately');
  await act(async () => appStateListeners.forEach((fn) => fn('background')));
  const background = animationCalls.length;
  await act(async () => tree.update(render(1.4, true, 1)));
  assert.equal(animationCalls.length, background, 'native interpolation stops when the app is hidden');
  await act(async () => appStateListeners.forEach((fn) => fn('active')));
  assert.equal(animationCalls.length, background + 1);
  const resumed = animationCalls.at(-1);
  await act(async () => resumed.finish());
  assert.equal(animationCalls.at(-1).config.toValue, resumed.config.toValue + 30, 'clock renews without waiting for another playback tick');
  const lastClock = animationCalls.at(-1);
  await act(async () => tree.unmount());
  const stopped = animationCalls.length;
  await act(async () => lastClock.finish());
  assert.equal(animationCalls.length, stopped, 'late native completion cannot resurrect an unmounted clock');
  assert.equal(appStateListeners.size, 0);
});

test('background track changes create no lyric animation graph and resume only the latest song on iOS and Android', async () => {
  for (const platform of ['ios', 'android']) for (const effect of ['simple', 'monet']) {
    let interpolations = 0;
    class TrackedValue extends Value {
      interpolate(config) { interpolations++; return super.interpolate(config); }
    }
    const Lyrics = loader({ ...lyricMocks, 'react-native': { ...rn, Platform: { OS: platform },
      Animated: { ...rn.Animated, Value: TrackedValue } } })('src/components/LyricsRail.js').default;
    const linesFor = song => Array.from({ length: 60 }, (_, i) => ({ from: i * 4, to: (i + 1) * 4, text: `${song} 第 ${i} 行歌词` }));
    let lines = linesFor('A'), tree, visible = true;
    const render = (position = 10) => React.createElement(Lyrics, { key: lines[0].text, lines, effect, visible,
      position, activeIndex: Math.floor(position / 4), playing: true, width: 390, height: 500 });
    await act(async () => { tree = create(render()); });
    await act(async () => { rn.AppState.currentState = 'background'; appStateListeners.forEach(fn => fn('background')); });
    const backgroundTimings = animationCalls.length, backgroundNodes = interpolations;
    for (let song = 0; song < 20; song++) {
      lines = linesFor(`song-${song}`);
      await act(async () => tree.update(render(song * 4)));
    }
    assert.equal(tree.toJSON(), null);
    assert.equal(animationCalls.length, backgroundTimings, `${platform}/${effect}: no hidden row transitions`);
    assert.equal(interpolations, backgroundNodes, `${platform}/${effect}: no hidden glyph interpolation nodes`);
    await act(async () => { rn.AppState.currentState = 'active'; appStateListeners.forEach(fn => fn('active')); });
    const renderedLines = tree.root.findAll(n => n.props.line?.text).map(n => n.props.line.text);
    assert.ok(renderedLines.length > 0);
    assert.ok(renderedLines.every(text => text.startsWith('song-19')));
    assert.equal(animationCalls.at(-1).config.toValue, 76 + 30);
    await act(async () => { visible = false; tree.update(render()); });
    const hiddenTimings = animationCalls.length;
    await act(async () => { lines = linesFor('offscreen'); tree.update(render(20)); });
    assert.equal(tree.toJSON(), null, 'an unfocused page releases the rail even while the app is active');
    assert.equal(animationCalls.length, hiddenTimings);
    await act(async () => tree.unmount());
    assert.equal(appStateListeners.size, 0);
  }
});

test('player lyric results belong to the current song and late requests cannot restore old lyrics', async () => {
  const requests = new Map();
  let current = { bvid: 'A', cid: 1, title: 'A' }, focused = true;
  const playerState = { lyricSettings: {}, isLiked: () => false, seekTo() {}, playing: true };
  const load = loader({ ...lyricMocks,
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': safeArea,
    'src/player/useMediaTransition': { default: () => ({}), __esModule: true },
    'src/player/PlayerContext': { usePlayer: () => ({ ...playerState, current }), usePlaybackProgress: () => ({ position: 10, duration: 100 }) },
    'src/player/loadLyrics': { loadTrackLyrics: track => { const request = deferred(); requests.set(track.bvid, request); return request.promise; } },
    'src/player/trackSource': { useTrackSource: track => track },
    'src/components/icons': iconMock,
    ...Object.fromEntries(['VideoPane', 'VideoActionBar', 'LivePlayerBody', 'PlaylistPicker', 'BottomSheet',
      'PlaybackQueue', 'RemoteImage', 'ProgressScrubber', 'LyricsRail'].map(name => [`src/components/${name}`, name])),
  });
  const Player = load('src/screens/PlayerScreen.js').default;
  let tree;
  const render = () => React.createElement(Player, { navigation: { setParams() {} }, route: { params: { showLyrics: true } } });
  const lyricsA = [{ from: 0, to: 60, text: 'A lyric' }];
  await act(async () => { tree = create(render()); });
  await act(async () => requests.get('A').resolve(lyricsA));
  assert.equal(tree.root.findByType('LyricsRail').props.lines, lyricsA);
  await act(async () => { current = { ...current, bvid: 'B', title: 'B' }; tree.update(render()); });
  assert.equal(tree.root.findAllByType('LyricsRail').length, 0, 'a new track never receives the previous lyric graph');
  await act(async () => { current = { ...current, bvid: 'C', title: 'C' }; tree.update(render()); });
  await act(async () => requests.get('B').resolve([{ from: 0, to: 60, text: 'late B lyric' }]));
  assert.equal(tree.root.findAllByType('LyricsRail').length, 0);
  await act(async () => requests.get('C').reject(new Error('lyrics offline')));
  assert.ok(tree.root.findAllByType('Text').some(n => n.props.children === '纯音乐 / 暂无歌词'), 'a failed request is handled without crashing');
  await act(async () => { current = { ...current, bvid: 'D', title: 'D' }; tree.update(render()); });
  const lyricsD = [{ from: 0, to: 60, text: 'D lyric' }];
  await act(async () => requests.get('D').resolve(lyricsD));
  assert.equal(tree.root.findByType('LyricsRail').props.lines, lyricsD);
  assert.equal(tree.root.findByType('LyricsRail').props.visible, true);
  await act(async () => { focused = false; tree.update(render()); });
  assert.equal(tree.root.findByType('LyricsRail').props.visible, false);
  await act(async () => tree.unmount());
});

test('scrubber reuses native interpolation nodes and suspends background animations', async () => {
  let interpolations = 0;
  class TrackedValue extends Value {
    interpolate(config) { interpolations++; return super.interpolate(config); }
  }
  const Scrubber = loader({ 'react-native': { ...rn, Animated: { ...rn.Animated, Value: TrackedValue } } })('src/components/ProgressScrubber.js').default;
  let tree;
  const render = position => React.createElement(Scrubber, { position, duration: 300, playing: true, seekRevision: 0, onSeek() {} });
  await act(async () => { tree = create(render(0)); });
  const nodes = interpolations;
  for (let i = 1; i < 40; i++) await act(async () => tree.update(render(i / 4)));
  assert.equal(interpolations, nodes, 'progress ticks reuse the same graph');
  await act(async () => appStateListeners.forEach(fn => fn('background')));
  const hiddenTimings = animationCalls.length;
  for (let i = 40; i < 80; i++) await act(async () => tree.update(render(i / 4)));
  assert.equal(animationCalls.length, hiddenTimings);
  assert.equal(interpolations, nodes);
  await act(async () => appStateListeners.forEach(fn => fn('active')));
  assert.ok(animationCalls.length > hiddenTimings);
  await act(async () => tree.unmount());
});

test('default lyrics fill left to right across wrapped rows with native timing, enlargement and neighbouring blur', async () => {
  const Lyrics = loader(lyricMocks)('src/components/LyricsRail.js').default;
  const lines = [{ from: 0, to: 4, text: 'Hello 世界' }, { from: 4, to: 8, text: '下一行' }];
  let tree;
  const render = (position, activeIndex = 0, effect) => React.createElement(Lyrics,
    { lines, activeIndex, position, playing: false, width: 390, height: 500, effect });
  await act(async () => { tree = create(render(1)); });
  assert.equal(tree.root.findAllByType('Mask').length, 0);
  const measured = tree.root.findAllByType('Text').filter((n) => n.props.onTextLayout);
  await act(async () => measured[0].props.onTextLayout({ nativeEvent: { lines: [
    { x: 0, y: 0, width: 300, height: 36 }, { x: 0, y: 36, width: 100, height: 36 },
  ] } }));
  assert.equal(tree.root.findAllByType('Mask').length, 1, 'one hardware mask for the active lyric, never per-word glow layers');
  assert.equal(tree.root.findByType('Mask').props.androidRenderingMode, 'hardware');
  assert.equal(tree.root.findAllByType('Gradient').length, 0);
  const fills = () => tree.root.findAllByType('AnimatedView').filter((n) => n.props.style.backgroundColor === '#fff')
    .map((n) => animatedAt(n.props.style.transform[0].translateX));
  assert.deepEqual(fills(), [-200, -100], 'only the left part of the first visual row is white');
  await act(async () => tree.update(render(3))); assert.deepEqual(fills(), [0, -100]);
  await act(async () => tree.update(render(3.5))); assert.deepEqual(fills(), [0, -50]);
  await act(async () => tree.update(render(4))); assert.deepEqual(fills(), [0, 0]);
  await act(async () => tree.update(render(0))); assert.deepEqual(fills(), [-300, -100]);
  assert.ok(tree.root.findAllByType('View').some((n) => n.props.style?.filter?.[0].blur > 0));
  const rows = tree.root.findAllByType('AnimatedView').filter((n) => n.props.onLayout);
  assert.ok(rows[0].props.style[1].transform[2].scale.value > rows[1].props.style[1].transform[2].scale.value);
  await act(async () => measured[1].props.onTextLayout({ nativeEvent: { lines: [{ x: 0, y: 0, width: 120, height: 36 }] } }));
  await act(async () => tree.update(render(5, 1)));
  assert.equal(tree.root.findByType('Mask').props.maskElement.props.children, '下一行');
  assert.deepEqual(fills(), [-90]);
  await act(async () => tree.update(render(5, 1, 'monet'))); assert.ok(tree.root.findAllByType('Mask').length);
  await act(async () => tree.update(render(5, 1, 'simple'))); assert.equal(tree.root.findAllByType('Mask').length, 0);
  await act(async () => tree.unmount());
});

test('iOS lyrics use native glyph shadows without clipping Monet glow into glyph tiles', async () => {
  const Lyrics = loader({ ...lyricMocks, 'react-native': { ...rn, Platform: { OS: 'ios' } } })('src/components/LyricsRail.js').default;
  const lines = [{ from: 0, to: 4, text: '正在播放' }, { from: 4, to: 8, text: '下一句歌词' }];
  let tree;
  await act(async () => { tree = create(React.createElement(Lyrics,
    { lines, activeIndex: 0, position: 1, playing: false, width: 390, height: 500, effect: 'simple' })); });
  const styles = () => tree.root.findAllByType('Text').flatMap((node) => Array.isArray(node.props.style) ? node.props.style.flat() : [node.props.style]).filter(Boolean);
  assert.ok(styles().some((style) => style.textShadowRadius >= 2 && style.color === 'rgba(255,255,255,0.16)'), 'default neighbouring lines retain a faint fill under the CoreText blur');
  await act(async () => tree.update(React.createElement(Lyrics,
    { lines, activeIndex: 0, position: 1, playing: false, width: 390, height: 500, effect: 'monet' })));
  assert.equal(tree.root.findAllByType('AnimatedText').length, 0, 'Monet never rasterizes each glyph into a clipped shadow tile');
  const nativeGlow = tree.root.findAllByType('MonetGlow');
  assert.equal(nativeGlow.map((node) => node.props.text).join(''), '正在播放');
  assert.ok(nativeGlow.every((node) => node.props.tightRadius >= 8 && node.props.wideRadius >= 19),
    'Monet renders tight and wide whole-word glow in the native iOS layer');
  assert.ok(styles().some((style) => style.textShadowRadius >= 1), 'Monet keeps unsung and neighbouring glyph blur on iOS');
  await act(async () => tree.unmount());
});

test('settings default to simple lyrics, apply immediately, persist across restart and protect edits from a late restore', async () => {
  const saved = new Map([['biu.quality', '2']]);
  let settingsRenders = 0;
  const events = {};
  let restore = null;
  const videoRequests = [];
  const player = { playing: false, duration: 120, pause() {}, play() {}, replaceAsync: async () => {} };
  const load = loader({
    'src/store/LanSyncProvider': { useLanSync: () => ({ enabled: true, ready: true, setEnabled() {} }) },
    'src/store/CloudSyncProvider': { useCloudSync: () => ({}) },
    'react-native': { ...rn, ScrollView: (props) => { settingsRenders++; return React.createElement('ScrollView', props); } },
    'react-native-safe-area-context': safeArea, 'src/components/icons': iconMock,
    '@react-navigation/native': { useIsFocused: () => true },
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => player },
    'src/components/RecommendationProfileCard': { default: () => null, __esModule: true },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' },
      useEventListener: (_, name, callback) => { events[name] = callback; } },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => key === 'biu.lyric-effect' && restore ? restore.promise : saved.get(key) ?? null,
      setItem: async (key, value) => saved.set(key, value),
    },
    'src/api/bili': { videoUrl: async (...args) => { videoRequests.push(args); return 'https://cdn/video.mp4'; } },
    'src/api/client': { streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer, usePlaybackProgress } = load('src/player/PlayerContext.js');
  const Settings = load('src/screens/SettingsScreen.js').default;
  let context, progress, backgroundProgress, tree, slowRenders = 0, progressRenders = 0;
  const navigation = {};
  function ProgressProbe() { progressRenders += 1; progress = usePlaybackProgress(); return null; }
  function SystemProgressProbe() { backgroundProgress = usePlaybackProgress({ background: true }); return null; }
  function Probe() {
    slowRenders += 1;
    context = usePlayer();
    return React.createElement(React.Fragment, null,
      React.createElement(ProgressProbe), React.createElement(SystemProgressProbe), React.createElement(Settings, { navigation }));
  }
  const mount = async () => act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  await mount();
  const initialRenders = settingsRenders;
  assert.ok(initialRenders > 0);
  assert.equal(tree.root.findAllByType('FlatList').length, 0, 'the fixed form never waits for virtualized batches');
  assert.ok(tree.root.findAllByType('Text').some(node => node.props.children === 'Biu Player RN'), 'the final settings section is present immediately');
  assert.ok(touch(tree, '返回'), 'back is available without waiting for settings data');
  const initialSlowRenders = slowRenders;
  const initialProgressRenders = progressRenders;
  for (let i = 1; i <= 8; i++) await act(async () => events.timeUpdate({ currentTime: i / 4 }));
  assert.equal(context.position, 2, 'playback progress still advances');
  assert.equal(progress.position, 2, 'dedicated progress consumers receive the latest playback clock');
  assert.equal(slowRenders, initialSlowRenders, 'playback ticks do not publish the main player context');
  assert.ok(progressRenders > initialProgressRenders, 'the dedicated progress context publishes playback ticks');
  assert.equal(settingsRenders, initialRenders, '250 ms playback ticks do not rebuild the settings list');
  await act(async () => appStateListeners.forEach(fn => fn('background')));
  const hiddenRenders = progressRenders;
  for (let i = 9; i <= 80; i++) await act(async () => events.timeUpdate({ currentTime: i / 4 }));
  assert.equal(progressRenders, hiddenRenders, 'hidden player views receive no playback ticks');
  assert.equal(progress.position, 2);
  assert.equal(context.position, 20, 'background audio and queue logic keep their live position');
  assert.equal(backgroundProgress.position, 20, 'lock-screen lyrics still receive background progress');
  await act(async () => appStateListeners.forEach(fn => fn('active')));
  assert.equal(progress.position, 20, 'returning to foreground publishes the latest sample immediately');
  assert.equal(context.quality, 1, 'legacy lossless choice migrates to automatic video quality');
  assert.equal(touch(tree, '自动').props.accessibilityState.checked, true);
  assert.equal(tree.root.findAllByType('Text').some((n) => n.props.children === '在线音质'), false);
  for (const [label, q] of [['360P', 16], ['480P', 32], ['720P', 64], ['1080P', 80], ['自动', 1]]) {
    await click(tree, label);
    assert.equal(context.quality, q);
    assert.equal(saved.get('biu.quality'), String(q));
    await act(async () => context.playQueue([{ bvid: 'BVquality', cid: 5, title: 'Quality' }]));
    assert.equal(videoRequests.at(-1)[2], q === 1 ? undefined : q, 'the selected quality reaches the stream request');
  }
  await click(tree, '1080P');
  assert.equal(context.lyricEffect, 'simple');
  assert.equal(context.recommendMode, 'music');
  assert.equal(touch(tree, '首页音乐分区推荐').props.accessibilityState.checked, true);
  assert.equal(context.discoveryEnabled, false);
  assert.equal(touch(tree, '发现页全部分区推荐').props.accessibilityState.checked, true, 'discovery range is independently configurable before enabling the page');
  await act(async () => tree.root.findByProps({ accessibilityLabel: '启用卡片发现' }).props.onValueChange(true));
  assert.equal(context.discoveryEnabled, true);
  assert.equal(saved.get('biu.discovery-enabled'), 'true');
  assert.equal(tree.root.findAllByProps({ accessibilityLabel: '卡片全部推荐' }).length, 0);
  assert.ok(!tree.root.findAllByType('Text').some((node) => node.props.children === '视频来源'));
  await click(tree, '发现页音乐分区推荐');
  assert.equal(context.discoveryRecommendMode, 'music');
  await click(tree, '发现页全部分区推荐');
  assert.equal(context.discoveryRecommendMode, 'all');
  assert.equal(saved.get('biu.discovery-recommend-mode'), '"all"');
  assert.equal(context.recommendMode, 'music', 'discovery range does not change home range');
  await click(tree, '发现页音乐分区推荐');
  await click(tree, '首页全部分区推荐');
  assert.equal(context.discoveryRecommendMode, 'music', 'changing home range preserves discovery range');
  assert.equal(context.recommendMode, 'all');
  assert.equal(saved.get('biu.recommend-mode'), '"all"');
  assert.equal(touch(tree, '简单').props.accessibilityState.checked, true);
  await click(tree, '莫奈光效');
  assert.equal(context.lyricEffect, 'monet');
  assert.equal(saved.get('biu.lyric-effect'), '"monet"');
  await act(async () => tree.unmount());
  await mount();
  assert.equal(context.quality, 80, 'video quality choice survives restart');
  assert.equal(context.lyricEffect, 'monet', 'choice survives provider restart');
  assert.equal(context.recommendMode, 'all', 'recommendation choice survives provider restart');
  assert.equal(context.discoveryEnabled, true, 'card discovery survives provider restart');
  assert.equal(context.discoveryRecommendMode, 'music', 'discovery range survives restart independently of home');
  assert.equal(touch(tree, '莫奈光效').props.accessibilityState.checked, true);
  await click(tree, '简单');
  assert.equal(context.lyricEffect, 'simple');
  await act(async () => tree.unmount());
  saved.set('biu.lyric-effect', '{broken');
  await mount(); assert.equal(context.lyricEffect, 'simple');
  await act(async () => tree.unmount());
  restore = deferred();
  await mount();
  await click(tree, '莫奈光效');
  await act(async () => restore.resolve('"simple"'));
  assert.equal(context.lyricEffect, 'monet', 'old storage must not overwrite an explicit choice');
  await act(async () => tree.unmount());
});

test('mobile library follows the signed-in account and adopts legacy guest data only on first login', async () => {
  const guestSong = { bvid: 'BVguest', cid: 1, title: 'Guest song' };
  const secondSong = { bvid: 'BVsecond', cid: 2, title: 'Second song' };
  const guestPlaylists = [{ id: 1, title: 'Guest list', tracks: [guestSong] }];
  const disk = new Map([
    ['biu.likes', JSON.stringify([guestSong])],
    ['biu.history', JSON.stringify([guestSong])],
    ['biu.playlists', JSON.stringify(guestPlaylists)],
  ]);
  const load = loader({
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => ({ playing: false, duration: 0 }) },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' }, useEventListener() {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => disk.set(key, value),
    },
    'src/api/bili': {},
    'src/api/client': { initClient: async () => {}, authStatus: async () => ({ isLogin: true, mid: 9 }), streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const { usePlaylists } = load('src/store/playlists.js');
  let context, playlists, tree;
  function Probe() { context = usePlayer(); playlists = usePlaylists(); return null; }
  await act(async () => {
    tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(context.account.mid, 9);
  assert.deepEqual(context.likes.map((item) => item.bvid), ['BVguest']);
  assert.equal(playlists[0].title, 'Guest list');
  assert.equal(disk.get('biu.likes@9'), disk.get('biu.likes'));
  assert.equal(disk.get('biu.playlists@9'), disk.get('biu.playlists'));

  await act(async () => context.toggleLike(secondSong));
  assert.deepEqual(JSON.parse(disk.get('biu.likes@9')).map((item) => item.bvid), ['BVsecond', 'BVguest']);
  assert.deepEqual(JSON.parse(disk.get('biu.likes')).map((item) => item.bvid), ['BVguest'], 'guest bucket stays intact');

  await act(async () => context.switchAccount({ isLogin: true, mid: 10 }));
  assert.deepEqual(context.likes, [], 'switching directly between accounts never copies another account');
  assert.deepEqual(playlists, []);
  await act(async () => context.switchAccount({ isLogin: false }));
  assert.deepEqual(context.likes.map((item) => item.bvid), ['BVguest']);
  assert.equal(playlists[0].title, 'Guest list');
  await act(async () => tree.unmount());
});

test('mobile LAN requests allow larger transfers, distinguish timeouts and never retry server errors as alternate routes', async (t) => {
  const {lanRequest}=loader()('src/store/lanSync.js');
  const originalFetch=global.fetch;t.after(()=>{global.fetch=originalFetch;});
  t.mock.timers.enable({apis:['setTimeout']});
  const peer={id:'desktop-test',token:'test-token',addresses:['192.168.1.2:4000']};
  let complete,options,calls=0;
  global.fetch=(_url,opts)=>{calls++;options=opts;return new Promise((resolve,reject)=>{
    complete=()=>resolve({ok:true,text:async()=>JSON.stringify({version:2,account:'123',deviceId:peer.id})});
    opts.signal.addEventListener('abort',()=>reject(Error('fetch failed')),{once:true});
  });};
  const timeout=assert.rejects(lanRequest(peer,'123','status'),/连接设备超时/);
  t.mock.timers.tick(3000);await timeout;
  const transfer=lanRequest(peer,'123','sync',{clientId:'phone-test',library:{}});
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(5000);assert.equal(options.signal.aborted,false);
  assert.equal(options.credentials,'omit');complete();await transfer;
  peer.addresses.push('192.168.1.3:4000');calls=0;
  global.fetch=async()=>{calls++;return {ok:false,text:async()=>JSON.stringify({error:'两端登录账号不同'})};};
  await assert.rejects(lanRequest(peer,'123','sync',{}),/账号不同/);
  assert.equal(calls,1);
});

test('mobile LAN discovery keeps one continuous DNSSD browse while no desktop is found', (t) => {
  const { EventEmitter } = require('node:events');
  const { startAutoSync } = loader()('src/store/lanSync.js');
  t.mock.timers.enable({ apis: ['setInterval'] });
  let scans = 0, stops = 0, removed = 0;
  class Discovery extends EventEmitter {
    scan(_type, _protocol, _domain, implementation) {
      assert.equal(implementation, 'DNSSD'); scans += 1;
    }
    stop(implementation) { assert.equal(implementation, 'DNSSD'); stops += 1; }
    removeDeviceListeners() { removed += 1; }
  }
  const stop = startAutoSync({ scope: '123', clientId: 'phone-test', discovery: new Discovery(),
    storage: {}, getLibrary: async () => ({}), applyLibrary: async () => {}, onStatus: () => {}, interval: 4000 });
  t.mock.timers.tick(120000);
  assert.equal(scans, 1, 'an idle continuous browse must not be stopped and recreated');
  assert.equal(stops, 0);
  stop();
  assert.equal(stops, 1);
  assert.equal(removed, 1);
});

test('large LAN transfers preserve Unicode and wait for each bounded socket write', async (t) => {
  const net = require('node:net'), writes = [];
  let pending = 0;
  const tcp = { createServer: accept => net.createServer(socket => {
    const write = socket.write.bind(socket);
    socket.write = (data, encoding, done) => {
      assert.equal(pending, 0, 'do not flood the native bridge before the previous block completes');
      pending++;
      const length = Buffer.byteLength(data, encoding); writes.push(length);
      assert.ok(length <= 64 * 1024);
      return write(data, encoding, error => { pending--; done(error); });
    };
    accept(socket);
  }) };
  const load = loader(), { startLanReceiver } = load('src/store/lanSyncServer.js');
  const { lanRequest } = load('src/store/lanSync.js');
  const library = { version: 1, likes: Array.from({ length: 5000 }, (_, i) => ({ bvid: 'BVlarge' + i, title: '音乐🎵'.repeat(15) })), playlists: [] };
  const receiver = startLanReceiver({ tcp, scope: '123', deviceId: 'phone-large-test',
    getLibrary: async () => library, applyLibrary: async () => assert.fail('unchanged library must not be applied') });
  t.after(() => receiver.stop());
  const { port, token } = await receiver.ready;
  const response = await lanRequest({ id: 'phone-large-test', token, addresses: ['127.0.0.1:' + port] }, '123', 'sync',
    { clientId: 'phone-other-test', library });
  assert.deepEqual(response.library.likes, library.likes);
  assert.ok(writes.length > 10, 'large libraries are sent in multiple small blocks');
});

test('phone LAN receiver syncs two independent recent profiles, retains same-named custom IDs, and propagates edits/deletions', async (t) => {
  const { EventEmitter } = require('node:events'), tcp = require('node:net');
  const R = require('../renderer/recommendation-profile'), L = require('../renderer/library-sync');
  const load = loader(), { startLanReceiver } = load('src/store/lanSyncServer.js');
  const { startAutoSync, lanRequest } = load('src/store/lanSync.js');
  const profile = (id, tag, updatedAt = 10) => R.normalize({ auto: { tags: [tag], updatedAt },
    profiles: [{ id, name: '同名画像', tags: [tag] }] });
  let left = L.normalize({ version: 1, likes: [], playlists: [], recommendation: profile('custom-a', '钢琴', 20), discoveryRecommendation: profile('custom-a', 'cos') });
  let right = L.normalize({ version: 1, likes: [], playlists: [], recommendation: profile('custom-b', '摇滚'), discoveryRecommendation: profile('custom-b', '舞蹈', 20) });
  let failWrites = true, acknowledgements = 0;
  const receiver = startLanReceiver({ tcp, scope: '123', deviceId: 'phone-bbbbbbbb', getLibrary: async () => right,
    applyLibrary: async (incoming, base, scope) => {
      assert.equal(scope, '123');
      if (failWrites) throw Error('存储失败');
      right = L.reconcile(base, incoming, right);
    }, onStatus: (status) => { if (status.lastSync) acknowledgements++; } });
  t.after(() => receiver.stop());
  const { port, token } = await receiver.ready;
  const peer = { id: 'phone-bbbbbbbb', token, addresses: ['127.0.0.1:' + port] };
  assert.equal((await lanRequest(peer, '123', 'status')).discoveryProfiles, true);
  await assert.rejects(lanRequest(peer, '456', 'status'), /账号或授权/);
  await assert.rejects(lanRequest({ ...peer, token: '0'.repeat(64) }, '123', 'status'), /账号或授权/);
  await assert.rejects(lanRequest(peer, '123', 'sync', { clientId: 'phone-aaaaaaaa', library: left }), /存储失败/);
  assert.equal(right.recommendation.profiles.length, 1);
  assert.equal(acknowledgements, 0, 'failed persistence cannot be acknowledged');
  failWrites = false;
  class Discovery extends EventEmitter { scan() {} stop() {} removeDeviceListeners() {} }
  const discovery = new Discovery(), disk = new Map();
  let synced = false;
  const stop = startAutoSync({ scope: '123', clientId: 'phone-aaaaaaaa', discovery, interval: 25,
    storage: { getItem: async (key) => disk.get(key), setItem: async (key, value) => disk.set(key, value) },
    getLibrary: async () => left, applyLibrary: async (incoming, base) => { left = L.reconcile(base, incoming, left); },
    onStatus: (status) => { synced = !!status.connected; } });
  t.after(stop);
  const txt = { version: '2', account: fromMobile('js-md5')('biu-lan:123'), device: peer.id, token, kind: 'mobile' };
  discovery.emit('resolved', { name: 'phone-b', port, addresses: ['127.0.0.1'], txt });
  const until = async (check) => {
    const deadline = Date.now() + 3000;
    while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(check(), 'mobile sync must converge');
  };
  await until(() => synced && acknowledgements > 0);
  assert.deepEqual(left, right);
  for (const field of ['recommendation', 'discoveryRecommendation']) {
    assert.deepEqual(new Set(left[field].profiles.map((p) => p.id)), new Set(['custom-a', 'custom-b']));
    assert.ok(left[field].profiles.every((p) => p.name === '同名画像'));
  }
  assert.deepEqual(new Set(left.recommendation.auto.tags.map((tag) => tag.name)), new Set(['钢琴']));
  assert.deepEqual(new Set(left.discoveryRecommendation.auto.tags.map((tag) => tag.name)), new Set(['舞蹈']));
  const mainBefore = structuredClone(left.recommendation);
  left = structuredClone(left);
  left.discoveryRecommendation.profiles = left.discoveryRecommendation.profiles.filter((p) => p.id !== 'custom-a');
  right = structuredClone(right);
  right.discoveryRecommendation.profiles.find((p) => p.id === 'custom-b').name = '改名';
  await until(() => left.discoveryRecommendation.profiles.length === 1 && right.discoveryRecommendation.profiles.length === 1
    && left.discoveryRecommendation.profiles[0].name === '改名');
  assert.deepEqual(left.recommendation, mainBefore, 'discovery deletion and renaming must leave the entire main namespace intact');
  assert.deepEqual(left, right);
  assert.ok(receiver.status().connected);
  stop(); receiver.stop();
  await assert.rejects(lanRequest(peer, '123', 'status'), /无法连接设备/);
});

test('mobile LAN receiver bounds and authenticates fragmented HTTP requests and rejects stale receipts', async (t) => {
  const tcp = require('node:net');
  const polyfill = fromMobile('buffer/');
  const species = Object.getOwnPropertyDescriptor(polyfill.Buffer, Symbol.species);
  Object.defineProperty(polyfill.Buffer, Symbol.species, { value: Uint8Array, configurable: true });
  t.after(() => { if (species) Object.defineProperty(polyfill.Buffer, Symbol.species, species); else delete polyfill.Buffer[Symbol.species]; });
  const load = loader({ buffer: polyfill }), { startLanReceiver } = load('src/store/lanSyncServer.js');
  let library = { version: 1, likes: [], playlists: [] };
  const receiver = startLanReceiver({ tcp, scope: '123', deviceId: 'phone-receiver', getLibrary: async () => library, applyLibrary: async (value) => { library = value; } });
  t.after(() => receiver.stop());
  const { port, token } = await receiver.ready;
  const request = (head, parts = []) => new Promise((resolve, reject) => {
    const socket = tcp.connect(port, '127.0.0.1'), data = [];
    socket.on('error', reject); socket.on('data', (value) => data.push(value));
    socket.on('end', () => resolve(Buffer.concat(data).toString('utf8')));
    socket.on('connect', async () => {
      socket.write(head);
      for (const part of parts) { await new Promise((r) => setImmediate(r)); socket.write(part); }
    });
  });
  const headers = `Authorization: Bearer ${token}\r\nX-Biu-Account: 123\r\n`;
  const finishFeed = load('src/updates/networkGate.js').beginRecommendation();
  assert.match(await request('GET /v2/status HTTP/1.1\r\n' + headers + '\r\n'), /^HTTP\/1.1 503/);
  finishFeed();
  assert.match(await request('GET /v2/status HTTP/1.1\r\n' + headers + '\r\n'), /^HTTP\/1.1 200/);
  const body = JSON.stringify({ clientId: 'phone-sender', library: { version: 1, playlists: [], likes: [{ bvid: 'BVtest', title: '中文标题' }] } });
  const bytes = Buffer.from(body), split = bytes.indexOf(Buffer.from('中文')) + 1;
  const response = await request('POST /v2/sync HTTP/1.1\r\n' + headers + `Content-Length: ${bytes.length}\r\n\r\n`,
    [bytes.subarray(0, split), bytes.subarray(split)]);
  assert.match(response, /^HTTP\/1.1 200/);
  assert.equal(JSON.parse(response.split('\r\n\r\n')[1]).library.likes[0].title, '中文标题');
  const cover = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
  const large = Buffer.from(JSON.stringify({ clientId: 'phone-sender', library: {
    version: 1, likes: [], playlists: [{ id: 'large-cover', title: '大歌单', tracks: [], cover }],
  } }));
  const parts = [];
  for (let offset = 0; offset < large.length; offset += 65536) parts.push(large.subarray(offset, offset + 65536));
  const largeResponse = await request('POST /v2/sync HTTP/1.1\r\n' + headers + `Content-Length: ${large.length}\r\n\r\n`, parts);
  assert.match(largeResponse, /^HTTP\/1.1 200/);
  assert.equal(JSON.parse(largeResponse.split('\r\n\r\n')[1]).library.playlists[0].cover, cover);
  assert.equal(library.playlists[0].cover, cover);
  assert.match(await request('GET /v2/status HTTP/1.1\r\n' + headers + 'Origin: https://example.com\r\n\r\n'), /^HTTP\/1.1 403/);
  assert.match(await request('POST /v2/sync HTTP/1.1\r\n' + headers + 'Content-Length: 9007199254740992\r\n\r\n'), /^HTTP\/1.1 413/);
  assert.match(await request('POST /v2/sync HTTP/1.1\r\n' + headers + 'Transfer-Encoding: chunked\r\n\r\n'), /^HTTP\/1.1 413/);
  assert.match(await request('GET /v2/status HTTP/1.1\r\n' + headers + 'X-Biu-Account: 456\r\n\r\n'), /^HTTP\/1.1 400/);
  await assert.rejects(load('src/store/lanSync.js').lanRequest({ id: 'phone-receiver', token, addresses: ['127.0.0.1:' + port] },
    '123', 'ack', { clientId: 'phone-sender', receipt: 'stale' }), /同步结果已更新/);
  assert.equal(receiver.status().connected, false);
});

test('mobile LAN elects one initiator, ignores self and preserves inbound connection status', async (t) => {
  const { EventEmitter } = require('node:events');
  const { startAutoSync } = loader()('src/store/lanSync.js');
  class Discovery extends EventEmitter { scan() {} stop() {} removeDeviceListeners() {} }
  const discovery = new Discovery(); let reads = 0, status;
  const stop = startAutoSync({ scope: '123', clientId: 'phone-bbbbbbbb', discovery,
    getLibrary: async () => { reads++; return {}; }, storage: { getItem: async () => { reads++; } },
    applyLibrary: async () => {}, getInboundStatus: () => ({ connected: true, message: '已同步' }), onStatus: (s) => { status = s; } });
  t.after(stop);
  for (const id of ['phone-aaaaaaaa', 'phone-bbbbbbbb']) discovery.emit('resolved', { name: id, port: 1234,
    addresses: ['127.0.0.1'], txt: { version: '2', device: id, account: fromMobile('js-md5')('biu-lan:123'), token: 'a'.repeat(64), kind: 'mobile' } });
  await new Promise((resolve) => setImmediate(resolve));
  discovery.emit('remove', 'phone-aaaaaaaa');
  assert.equal(reads, 0, 'only the smaller ID initiates a mobile pair exchange');
  assert.equal(status.connected, true);
});

test('mobile LAN provider publishes a native receiver only for the foreground account and rotates authorization on restart', async (t) => {
  const { EventEmitter } = require('node:events'), tcp = require('node:net');
  const announcements = [], unpublished = [], servers = [];
  let account = { isLogin: true, mid: 123 }, onAppState, context, tree;
  class Discovery extends EventEmitter {
    scan() {} stop() {} removeDeviceListeners() {}
    publishService(type, protocol, domain, name, port, txt, implementation) {
      announcements.push({ type, name, port, txt, implementation });
    }
    unpublishService(name) { unpublished.push(name); }
  }
  const load = loader({
    'react-native': { ...rn, NativeModules: { RNZeroconf: {}, TcpSockets: {} },
      AppState: { currentState: 'active', addEventListener: (_, fn) => { onAppState = fn; return { remove() {} }; } } },
    'react-native-zeroconf': Discovery,
    'react-native-tcp-socket': { createServer: (fn) => { const server = tcp.createServer(fn); servers.push(server); return server; } },
    'src/player/PlayerContext': { usePlayer: () => ({ account, libraryReady: true,
      getSyncLibrary: async () => ({ version: 1, likes: [], playlists: [] }), applySyncLibrary: async () => {} }) },
    'src/store/CloudSyncProvider': { useCloudSync: () => ({}) },
  });
  const { LanSyncProvider, useLanSync } = load('src/store/LanSyncProvider.js');
  function Probe() { context = useLanSync(); return null; }
  const component = () => React.createElement(LanSyncProvider, null, React.createElement(Probe));
  t.after(async () => { if (tree) await act(async () => tree.unmount()); });
  const settle = async (check) => {
    const deadline = Date.now() + 2000;
    while (!check() && Date.now() < deadline) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    assert.ok(check());
  };
  await act(async () => { tree = create(component()); });
  await settle(() => announcements.length === 1);
  assert.equal(announcements[0].implementation, 'NSD');
  assert.equal(announcements[0].txt.kind, 'mobile');
  assert.equal(announcements[0].txt.account, fromMobile('js-md5')('biu-lan:123'));
  assert.equal(context.receiverError, undefined, 'CommonJS native TCP import must start successfully');
  await act(async () => onAppState('background'));
  assert.equal(servers[0].listening, false); assert.equal(unpublished.length, 1);
  await act(async () => onAppState('active'));
  await settle(() => announcements.length === 2);
  assert.notEqual(announcements[0].txt.token, announcements[1].txt.token);
  account = { isLogin: true, mid: 456 };
  await act(async () => tree.update(component()));
  await settle(() => announcements.length === 3);
  assert.equal(servers[1].listening, false);
  assert.equal(announcements[2].txt.account, fromMobile('js-md5')('biu-lan:456'));
  await act(async () => context.setEnabled(false));
  assert.equal(servers[2].listening, false);
  assert.equal(unpublished.length, 3);
});

test('automatic mobile sync runs outside settings, survives reconnect, persists opt-out and never crosses accounts', async (t) => {
  const { createLanSync } = require('../lan-sync');
  const R = require('../renderer/recommendation-profile');
  const { EventEmitter } = require('node:events');
  const phoneSong = { bvid: 'BVphone', cid: 1, title: 'Phone song' };
  const desktopSong = { bvid: 'BVdesktop', cid: 2, title: 'Desktop song' };
  const disk = new Map([
    ['biu.likes@123', JSON.stringify([phoneSong])],
    ['biu.discovery-recommendation-profiles@123', JSON.stringify(R.normalize({ profiles: [{ id: 'study', name: '美女', tags: ['cos'] }], activeId: 'study' }))],
    ['biu.playlists@123', JSON.stringify([{ id: 1, title: 'Phone list', tracks: [phoneSong] }])],
  ]);
  let desktop = { version: 1, likes: [desktopSong], playlists: [{ id: 2, title: 'Desktop list', tracks: [desktopSong] }],
    recommendation: R.normalize({ profiles: [{ id: 'study', name: '学习', tags: ['钢琴'] }], activeId: 'study' }) };
  let advertised, scans = 0, failStorage = false;
  const service = createLanSync({ host: '127.0.0.1', deviceId: 'desktop-test',
    publish: (value) => { advertised = value; return () => {}; }, readLibrary: () => desktop,
    writeLibrary: (_, value) => { desktop = value; } });
  t.after(() => service.stop());
  await service.configure('123', true);
  class Discovery extends EventEmitter {
    scan(type, protocol, domain, implementation) {
      assert.equal(implementation, 'NSD');
      scans++;
      queueMicrotask(() => {
        this.emit('resolved', { ...advertised, addresses: ['127.0.0.1'], txt: { ...advertised.txt, account: 'other-account' } });
        this.emit('resolved', { ...advertised, addresses: ['127.0.0.1'] });
      });
    }
    stop(implementation) { assert.equal(implementation, 'NSD'); }
    removeDeviceListeners() {}
  }
  const transport = loader()('src/store/lanSync.js');
  assert.equal(transport.discoveredPeer({ ...advertised, addresses: ['8.8.8.8'], txt: { ...advertised.txt, addresses: '' } }, '123'), null);
  assert.equal(transport.discoveredPeer({ ...advertised, addresses: ['127.0.0.1'] }, '456'), null);
  const preferred = transport.discoveredPeer({ ...advertised, addresses: ['10.0.0.2'],
    txt: { ...advertised.txt, addresses: '192.168.1.29' } }, '123');
  assert.equal(preferred.addresses[0], '192.168.1.29:' + advertised.port, 'physical LAN addresses precede VPN DNS results');
  const retryPeer = { ...preferred, addresses: ['127.0.0.2:' + advertised.port, '127.0.0.1:' + advertised.port] };
  await transport.lanRequest(retryPeer, '123', 'status');
  assert.equal(retryPeer.addresses[0], '127.0.0.1:' + advertised.port, 'subsequent requests reuse the verified working address');

  const load = loader({
    'react-native': { ...rn, NativeModules: { RNZeroconf: {} } },
    'react-native-safe-area-context': safeArea, 'src/components/icons': iconMock,
    'react-native-zeroconf': { __esModule: true, default: Discovery },
    '@react-navigation/native': { useIsFocused: () => true },
    'src/store/lanSync': { ...transport, startAutoSync: (options) => transport.startAutoSync({ ...options, interval: 30 }) },
    'src/store/CloudSyncProvider': { useCloudSync: () => ({}) },
    'src/components/RecommendationProfileCard': { __esModule:true, default:()=>null },
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => ({ playing: false, duration: 0 }) },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' }, useEventListener() {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => { if (failStorage && key === 'biu.likes@123') throw new Error('手机存储空间不足'); disk.set(key, value); },
    },
    'src/api/bili': {}, 'src/api/client': { authStatus: async () => ({ isLogin: true, mid: 123 }) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const { usePlaylists } = load('src/store/playlists.js');
  const { LanSyncProvider, useLanSync } = load('src/store/LanSyncProvider.js');
  const Settings = load('src/screens/SettingsScreen.js').default;
  let context, sync, playlists, tree, showSettings = false;
  function Probe() {
    context = usePlayer(); sync = useLanSync(); playlists = usePlaylists();
    return showSettings ? React.createElement(Settings, { navigation: {} }) : null;
  }
  const render = () => React.createElement(PlayerProvider, null, React.createElement(LanSyncProvider, null, React.createElement(Probe)));
  const until = async (predicate) => {
    for (let i = 0; i < 60 && !predicate(); i++) await act(async () => new Promise((r) => setTimeout(r, 30)));
    assert.ok(predicate(), sync?.message);
  };
  await act(async () => { tree = create(render()); });
  t.after(async () => { await act(async () => tree.unmount()); });
  await until(() => context.likes.length === 2 && sync.connected);
  assert.equal(showSettings, false, 'sync starts without opening settings');
  assert.equal(playlists.length, 2);
  assert.equal(JSON.parse(disk.get('biu.likes@123')).length, 2);
  await until(() => context.recommendationProfile.activeId === 'study');
  assert.equal(JSON.parse(disk.get('biu.recommendation-profiles@123')).profiles[0].name, '学习');
  await act(async () => context.recommendationManager.edit({ type: 'save', id: 'study', name: '安静学习', tags: [{ name: '钢琴', weight: 90 }] }));
  await until(() => desktop.recommendation.profiles[0]?.tags[0].weight === 90);
  assert.equal(desktop.recommendation.profiles[0].name, '安静学习');
  await until(() => context.discoveryRecommendationProfile.activeId === 'study');
  assert.equal(JSON.parse(disk.get('biu.discovery-recommendation-profiles@123')).profiles[0].name, '美女');
  await act(async () => context.discoveryRecommendationManager.edit({ type: 'save', id: 'study', name: '美女', tags: [{ name: '丝袜', weight: 95 }] }));
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  assert.equal(desktop.discoveryRecommendation, undefined, 'desktop peer does not receive mobile discovery profiles');
  assert.equal(JSON.parse(disk.get('biu.lan-baseline@123:desktop-test')).discoveryRecommendation, undefined, 'desktop baselines and revision checks exclude discovery');
  assert.equal(desktop.recommendation.profiles[0].tags[0].name, '钢琴', 'discovery edits do not enter the main profile');
  desktop.recommendation = R.normalize({ profiles: [], enabled: false });
  await until(() => !context.recommendationProfile.enabled && context.recommendationProfile.profiles.length === 0);
  await act(async () => { showSettings = true; tree.update(render()); });
  assert.equal(tree.root.findAllByType('TextInput').length, 0, 'no address or code input');
  assert.equal(tree.root.findAllByType('Switch').find(node=>node.props.accessibilityLabel==='局域网自动同步').props.value, true);
  await act(async () => context.toggleLike(phoneSong));
  await until(() => desktop.likes.length === 1);
  assert.equal(desktop.likes[0].bvid, 'BVdesktop', 'unlike must not be resurrected by the desktop');
  await act(async () => { appStateListeners.forEach((fn) => fn('background')); });
  desktop.likes.push({ bvid: 'BVthird', title: 'Third song' });
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  assert.equal(context.likes.length, 1);
  await act(async () => { appStateListeners.forEach((fn) => fn('active')); });
  await until(() => context.likes.length === 2);
  failStorage = true;
  desktop.likes.push({ bvid: 'BVfourth', title: 'Fourth song' });
  await until(() => /手机存储空间不足/.test(sync.message));
  failStorage = false;
  await until(() => context.likes.length === 3 && sync.connected);
  await act(async () => sync.setEnabled(false));
  assert.equal(disk.get('biu.lan-auto'), 'false');
  desktop.likes.push({ bvid: 'BVfifth', title: 'Fifth song' });
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  assert.equal(context.likes.length, 3);
  const scansBefore = scans;
  await act(async () => { tree.unmount(); });
  await act(async () => { tree = create(render()); });
  assert.equal(sync.enabled, false);
  assert.equal(scans, scansBefore, 'opt-out survives restart');
  assert.equal(context.discoveryRecommendationProfile.profiles[0].tags[0].name, '丝袜', 'mobile discovery profiles survive desktop sync and restart');
  await act(async () => sync.setEnabled(true));
  await until(() => context.likes.length === 4 && sync.connected);
  await act(async () => context.switchAccount({ isLogin: true, mid: 456 }));
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  assert.equal(context.likes.length, 0);
  assert.equal(playlists.length, 0);
  await assert.rejects(context.applySyncLibrary(desktop, null, '123'), /账号已切换/);
  assert.equal(disk.get('biu.likes@456'), undefined);
  const newProfile=R.normalize(JSON.parse(disk.get('biu.recommendation-profiles@456') || 'null'));
  assert.deepEqual(newProfile.profiles, [], 'new account must not inherit saved profiles');
  assert.deepEqual(newProfile.auto.tags, []);
  assert.deepEqual(newProfile.auto.evidence || [], []);
  assert.equal(newProfile.activeId, 'auto');
  const newDiscovery = R.normalize(JSON.parse(disk.get('biu.discovery-recommendation-profiles@456') || 'null'));
  assert.deepEqual(newDiscovery.profiles, [], 'account switches isolate discovery profiles too');
});

test('live APIs normalize followed rooms and recent danmaku without offline or duplicate rooms', async () => {
  const api = loader({ './client': { get: async (url) => ({ status: 200, body: JSON.stringify({ code: 0,
    data: url.includes('GetWebList') ? { rooms: [
      { roomid: 12, live_status: 1, title: 'Live', uname: 'Singer', face: '//face', keyframe: 'http://cover' },
      { roomid: '12', live_status: 1 }, { roomid: 13, live_status: 0 },
    ] } : { room: [{ text: '', uid: 1 }, { text: 'Hello', nickname: 'Viewer', uid: 2, timeline: 'now' }] },
  }) }) } })('src/api/bili.js');
  const rooms = await api.followedLives();
  assert.equal(rooms.length, 1);
  assert.deepEqual({ id: rooms[0].roomid, live: rooms[0].isLive, pic: rooms[0].pic, face: rooms[0].face },
    { id: 12, live: true, pic: 'https://cover', face: 'https://face' });
  assert.deepEqual(await api.liveDanmaku(12), [{ text: 'Hello', nickname: 'Viewer', uid: 2, timeline: 'now' }]);
});

test('radio opens live video, follows use the account, and danmaku cleans up across toggles and room changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = { roomid: 12, isLive: true, title: 'Live', up: 'Singer', pic: 'https://cover', duration: 0 };
  const nextRoom = { ...room, roomid: 15 };
  const mediaPlayer = {};
  const plays = [], routes = [], polls = [];
  let account = { isLogin: false }, focused = true, delayed = false, buffering = true;
  const oldResponse = deferred();
  const message = { text: 'Hello', nickname: 'Viewer', uid: 1, timeline: 'now' };
  let follows = 0;
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' },
    '@shopify/flash-list': { FlashList: rn.FlatList },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': safeArea,
    'expo-image': { Image: 'ExpoImage' }, 'expo-video': { VideoView: 'VideoView' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    '@react-native-masked-view/masked-view': 'Mask',
    '@react-native-async-storage/async-storage': storage,
    'src/components/icons': iconMock,
    'src/player/useMediaTransition': { default: () => ({ style: {}, panHandlers: {} }), __esModule: true },
    'src/components/VideoActionBar': { default: () => null, __esModule: true },
    'src/api/client': { initClient: async () => {}, imageHeaders: () => ({}) },
    'src/api/bili': {
      rooms: async () => [room], followedLives: async () => { follows++; return [room]; },
      liveDanmaku: async (id) => {
        polls.push(id);
        if (id === 12 && delayed) return oldResponse.promise;
        return id === 12 ? [message, message] : [{ ...message, text: 'Next room' }];
      },
    },
    'src/player/PlayerContext': { usePlaybackProgress: () => ({ position: 0, duration: 0 }), usePlayer: () => ({
      current: room, isLive: true, player: mediaPlayer, account, playing: true, buffering, lyricSettings: {},
      isLiked: () => false, playQueue: (...args) => plays.push(args),
    }) },
  });
  const Radio = load('src/screens/RadioScreen.js').default;
  let radio;
  const navigation = { navigate: (route) => routes.push(route) };
  await act(async () => { radio = create(React.createElement(Radio, { navigation })); });
  const masonry = radio.root.findByType('FlatList');
  assert.equal(masonry.props.masonry, true);
  assert.equal(masonry.props.numColumns, 2, 'radio rooms use two independent masonry columns');
  assert.equal(follows, 0, 'guests never request a private followed list');
  const card = radio.root.findAllByType('TouchableOpacity').find((node) => node.findAllByType('Text').some((text) => text.props.children === 'LIVE'));
  await act(async () => card.props.onPress());
  assert.deepEqual(routes, ['Player']);
  assert.equal(plays[0][0][0].roomid, room.roomid);
  account = { isLogin: true, mid: 7 };
  await act(async () => radio.update(React.createElement(Radio, { navigation })));
  assert.equal(follows, 1);
  await click(radio, '观看 Singer 的直播');
  assert.equal(plays.at(-1)[0][0].roomid, room.roomid);
  focused = false;
  await act(async () => radio.update(React.createElement(Radio, { navigation })));
  focused = true;
  await act(async () => radio.update(React.createElement(Radio, { navigation })));
  assert.equal(follows, 1, 'returning to radio keeps the followed-room result');
  await act(async () => radio.unmount());
  await act(async () => { radio = create(React.createElement(Radio, { navigation })); });
  assert.equal(follows, 1, 'a remounted radio header restores the account cache without another request');
  await act(async () => radio.unmount());

  const Player = withOverlays(load, load('src/screens/PlayerScreen.js').default);
  let page;
  await act(async () => { page = create(React.createElement(Player, { route: {}, navigation })); });
  assert.equal(page.root.findAllByType('VideoView').length, 1, 'live mode attaches exactly one native video surface');
  assert.equal(page.root.findByType('VideoView').props.player, mediaPlayer);
  assert.equal(page.root.findAll((node) => node.props.accessibilityRole === 'adjustable').length, 0, 'live mode has no seek bar');
  assert.equal(follows, 1, 'opening playback must not load the followed hosts again');
  const Pane = load('src/components/VideoPane.js').default;
  const pane = page.root.findByType(Pane);
  const loading = pane.findAllByType('View').find((node) => node.findAllByType('ActivityIndicator').length === 1
    && node.props.style?.justifyContent === 'center');
  assert.ok(loading, 'buffering has a centered indicator over the video');
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.equal(loading.props.style[edge], 0);
  assert.equal(loading.props.style.position, 'absolute', 'loading cannot take space below the native video');
  const surface = pane.findByType('VideoView');
  buffering = false;
  await act(async () => page.update(React.createElement(Player, { route: {}, navigation })));
  assert.equal(page.root.findByType(Pane).findAllByType('ActivityIndicator').length, 0);
  assert.equal(page.root.findByType('VideoView'), surface, 'buffering completion preserves the video surface');
  await act(async () => page.unmount());

  const Body = load('src/components/LivePlayerBody.js').default;
  let tree, current = room;
  const render = () => React.createElement(Body, { key: current.roomid, current, player: mediaPlayer, playing: true, focused });
  await act(async () => { tree = create(render()); });
  const chat = () => tree.root.findAllByType('Text').filter((node) => node.props.style?.lineHeight === 20)
    .map((node) => node.props.children[1]);
  assert.deepEqual(chat(), ['Hello'], 'identical history messages appear only once');
  const overlay = tree.root.findAllByType('View').find((node) => node.props.pointerEvents === 'none' && node.props.onLayout);
  await act(async () => overlay.props.onLayout({ nativeEvent: { layout: { width: 350 } } }));
  assert.ok(animationCalls.at(-1).config.useNativeDriver, 'scrolling danmaku stays on the native animation driver');
  delayed = true;
  await act(async () => t.mock.timers.tick(4000));
  const before = polls.length;
  await act(async () => t.mock.timers.tick(12000));
  assert.equal(polls.length, before, 'a slow history request cannot overlap another poll');
  current = nextRoom;
  await act(async () => tree.update(render()));
  await act(async () => oldResponse.resolve([{ ...message, text: 'Stale room' }]));
  assert.deepEqual(chat(), ['Next room']);
  await click(tree, '直播弹幕');
  const stopped = polls.length;
  await act(async () => t.mock.timers.tick(12000));
  assert.equal(polls.length, stopped, 'turning off danmaku stops polling');
  await click(tree, '直播弹幕');
  await act(async () => { for (const listener of appStateListeners) listener('background'); });
  const background = polls.length;
  await act(async () => t.mock.timers.tick(12000));
  assert.equal(polls.length, background);
  await act(async () => { for (const listener of appStateListeners) listener('active'); });
  assert.equal(polls.length, background + 1, 'returning to foreground resumes polling');
  focused = false;
  await act(async () => tree.update(render()));
  const hidden = polls.length;
  await act(async () => t.mock.timers.tick(12000));
  assert.equal(polls.length, hidden, 'hidden playback pages do not fetch danmaku');
  await act(async () => tree.unmount());
  assert.equal(appStateListeners.size, 0);
});

test('mobile recommendation editor saves separate profiles, edits weights and switches the active profile', async () => {
  const R = require('../renderer/recommendation-profile');
  let saved, pulseStarts = 0, pulseStops = 0, portraits = 0;
  const manager = R.createManager({ read: async () => null, write: async (value) => { saved = value; }, getLikes: () => [], get() {} });
  await manager.ready();
  const load = loader({
    'react-native': { ...rn, Animated: { ...rn.Animated, sequence: (animations) => animations,
      loop: () => ({ start: () => { pulseStarts++; }, stop: () => { pulseStops++; } }) } },
    'expo-image': { Image: (props) => { portraits++; return React.createElement('PortraitImage', props); } },
    '../renderer/profile-presentation': { ...require('../renderer/profile-presentation'),
      quoteFor: async () => ({ text: '用于检查的主题语录', from: '测试来源', author: '' }) },
    'src/player/PlayerContext': { usePlayer: () => ({ recommendationManager: manager,
      recommendationProfile: React.useSyncExternalStore(manager.subscribe, manager.getSnapshot),
      libraryReady: true, account: { isLogin: true, mid: 1 } }) },
  });
  const Card = load('src/components/RecommendationProfileCard.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Card)); });
  const portrait = tree.root.findByType('PortraitImage');
  assert.match(Buffer.from(portrait.props.source.uri.split(',')[1], 'base64').toString('utf8'), /<svg[\s>]/);
  assert.equal(portrait.props.cachePolicy, 'memory-disk');
  const initialPortraits = portraits;
  for (let i = 0; i < 8; i++) await act(async () => tree.update(React.createElement(Card)));
  assert.equal(portraits, initialPortraits, 'unchanged recommendation state cannot repaint the portrait on playback ticks');
  assert.equal(tree.root.findAllByProps({ accessibilityLabel: '新建画像' }).length, 0, 'profile details start on the reverse');
  await click(tree, '翻转卡片，查看用户画像');
  await click(tree, '新建画像');
  await act(async () => tree.root.findByProps({ accessibilityLabel: '画像名称' }).props.onChangeText('学习'));
  await act(async () => tree.root.findByProps({ accessibilityLabel: '画像标签与权重' }).props.onChangeText('钢琴:90\n古典:60'));
  await click(tree, '保存并使用');
  assert.equal(saved.profiles.length, 1); assert.equal(saved.profiles[0].tags[0].weight, 90);
  await click(tree, '编辑画像');
  await click(tree, '另存为新画像');
  assert.equal(saved.profiles.length, 2); assert.equal(R.activeProfile(saved).name, '学习 副本');
  await click(tree, '学习');
  assert.equal(R.activeProfile(saved).name, '学习');
  await click(tree, '删除画像');
  assert.equal(saved.profiles.length, 2, 'deleting needs inline confirmation');
  await click(tree, '确认删除');
  assert.equal(saved.profiles.length, 1); assert.equal(saved.activeId, 'auto');
  assert.equal(pulseStarts, 1, 'editing profiles does not restart the breathing indicator');
  await click(tree, '画像推荐已开启');
  assert.equal(pulseStops, 1, 'disabling recommendations stops the animation');
  assert.equal(tree.root.findAllByType('AnimatedView').length, 2, 'only the two card faces remain when the status light is disabled');
  await click(tree, '画像推荐已关闭');
  assert.equal(pulseStarts, 2);
  await click(tree, '返回画像卡片正面');
  assert.equal(tree.root.findAllByProps({ accessibilityLabel: '新建画像' }).length, 0);
  await act(async () => tree.unmount());
  assert.equal(pulseStops, 2, 'closing the editor cleans up the animation');
});

test('discovery screen starts swipes on the UI thread, retains failed drops, and keeps one opaque video surface across buffering', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixtures = Array.from({ length: 24 }, (_, i) => ({ bvid: `BVdiscovery${i}`, cid: i + 1, title: `Card ${i}`, tags: ['Card'] }));
  for (const platform of ['ios', 'android']) {
    let focused = true, refresh, tree, frame, revision = 0, completingAnimation = false, deferUI = false, deferJS = false, holdAnimation = false;
    const heldAnimations = [], queueWrites = [];
    const frameControl = { active: false, setActive(value) { this.active = value; } };
    const uiJobs = [], jsJobs = [], exitAnimations = [];
    const prematureResets = [];
    const mountedCardTransforms = [];
    let backdropMounts = 0, backdropRenders = 0;
    function NativeView(props) {
      if (props.testID === 'discovery-backdrop') backdropRenders++;
      React.useLayoutEffect(() => { if (props.testID === 'discovery-backdrop') backdropMounts++; }, []);
      return React.createElement('View', props);
    }
    function MotionView(props) {
      React.useLayoutEffect(() => {
        if (props.testID === 'discovery-card') mountedCardTransforms.push(props.style.flat().find((style) => style.transform)?.transform);
      }, []);
      return React.createElement('MotionView', props);
    }
    const profileModel = require('../renderer/recommendation-profile');
    let profileState = { ...profileModel.normalize({ auto: { tags: ['Card'] }, profiles: [{ id: 'cards', name: '卡片画像', tags: ['Card'] }] }), revision: 0 };
    const relatedCalls = [], profileEdits = [];
    const relatedPending = deferred();
    const nativePlayer = {};
    const navigation = [];
    const saves = [];
    const preloadWindows = [];
    const folderRequests = [];
    const folderDisk = new Map();
    let playlistSave;
    let foldersOffline = false;
    let preloadClears = 0;
    const localPlaylists = [{ id: 7, title: 'Test folder', tracks: [] }];
    const context = { player: nativePlayer, playing: true, buffering: false, playError: null,
      current: null, discoveryRecommendMode: 'all', queueSource: 'discovery',
      discoveryRecommendationProfile: profileState,
      discoveryRecommendationManager: { ready: async () => {}, getSnapshot: () => profileState, observeFeed() {},
        async edit(action) {
          profileEdits.push(action);
          profileState = { ...profileState, activeId: action.id ?? profileState.activeId, enabled: action.enabled, revision: profileState.revision + 1 };
          context.discoveryRecommendationProfile = profileState; refresh((v) => v + 1);
        },
      },
      isLiked: () => false, isInLibrary: () => false,
      toggleLike: async (track) => saves.push(track), toggleLibrary: async (track) => saves.push(track),
      syncDiscoveryQueue(list) { context.queue = list; queueWrites.push(list); },
      resume() {}, playQueue(list, index) {
        context.current = list[index];
        context.automaticVideoTransition = false;
        context.videoSource = ++revision === 1 ? { key: list[index].bvid, revision } : null;
        context.buffering = revision > 1;
        refresh((v) => v + 1);
      },
    };
    const recognizer = () => {
      const g = { handlers: {} };
      for (const name of ['minDistance', 'maxDistance', 'maxPointers', 'minDuration']) g[name] = () => g;
      for (const name of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) g[name] = (fn) => { g.handlers[name] = fn; return g; };
      return g;
    };
    const animation = (value, config, done) => {
      if (config?.easing) exitAnimations.push({ value, config });
      if (done) {
        const complete = () => { completingAnimation = true; done(true); completingAnimation = false; };
        if (holdAnimation) heldAnimations.push(complete); else queueMicrotask(complete);
      }
      return value;
    };
    const Screen = loader({
      'react-native': { ...rn, View: NativeView, Platform: { OS: platform } },
      '@react-navigation/native': { useIsFocused: () => focused },
      'react-native-safe-area-context': safeArea,
      'react-native-gesture-handler': { GestureDetector: 'GestureDetector',
        Gesture: { Pan: recognizer, Tap: recognizer, LongPress: recognizer, Race: (...gestures) => gestures } },
      'react-native-reanimated': { __esModule: true, default: { View: MotionView },
        useSharedValue: (initial) => {
          const cell = React.useRef();
          if (!cell.current) {
            let value = initial;
            cell.current = { get value() { return value; }, set value(next) {
              if (completingAnimation && value !== 0 && next === 0) prematureResets.push(value);
              value = next;
            } };
          }
          return cell.current;
        }, useAnimatedStyle: (fn) => fn(),
        useFrameCallback: (fn, autostart) => { frame = fn; assert.equal(autostart, false); return frameControl; }, cancelAnimation() {},
        runOnJS: (fn) => (...args) => { if (deferJS) jsJobs.push(() => fn(...args)); else fn(...args); },
        runOnUI: (fn) => (...args) => { if (deferUI) uiJobs.push(() => fn(...args)); else fn(...args); },
        withSpring: animation, withTiming: animation },
      'expo-video': { VideoView: 'VideoView' }, 'expo-image': { Image: { prefetch: async () => {} } },
      'expo-linear-gradient': { LinearGradient: 'Gradient' },
      'src/screens/DiscoveryWheel': { __esModule: true, default: 'Wheel', DiscoveryWheelHaze: 'WheelHaze' },
      'src/components/Overlay': 'Overlay',
      'src/components/RemoteImage': { __esModule: true, default: 'CoverImage', optimizedImageUri: (uri) => uri },
      'src/updates/networkGate': { yieldToInput: async () => {} },
      'src/player/discoveryPreload': {
        preloadDiscoveryQueue: (tracks) => preloadWindows.push(tracks.map((track) => track.bvid)),
        clearDiscoveryPreloads: () => { preloadClears++; },
      },
      'src/api/client': { imageHeaders: () => ({}) },
      'src/components/icons': iconMock,
      'src/components/BottomSheet': { __esModule: true, default: ({ visible, children }) => visible ? React.createElement('Sheet', null, children) : null },
      '@react-native-async-storage/async-storage': {
        getItem: async (key) => folderDisk.get(key) || null, setItem: async (key, value) => folderDisk.set(key, value),
      },
      'src/api/bili': { personalizedRecommendations: async () => fixtures,
        favFolders: async () => { if (foldersOffline) throw new Error('offline'); return [{ id: 99, title: 'Remote folder', count: 4 }]; },
        favItems: async (...args) => { folderRequests.push(args); return { list: [{ pic: 'remote1' }, { pic: 'remote2' }, { pic: 'remote1' }] }; },
        relatedVideos: async (bvid) => {
          relatedCalls.push(bvid);
          if (bvid === fixtures[3].bvid) return relatedPending.promise;
          return [fixtures[0], ...Array.from({ length: 10 }, (_, i) => ({ bvid: `${bvid}related${i}`, title: `Related Card ${i}`, tags: ['Card'] }))];
        },
        videoTags: async () => ['Card'],
      },
      'src/store/playlists': { usePlaylists: () => localPlaylists, addToPlaylist: async () => {
        if (playlistSave) return playlistSave.promise;
        throw new Error('Storage unavailable');
      } },
      'src/player/PlayerContext': { usePlayer: () => { [, refresh] = React.useState(0); return context; } },
    })('src/screens/DiscoveryScreen.js').default;
    await act(async () => { tree = create(React.createElement(Screen, { navigation: { navigate: (name) => navigation.push(name) } })); });
    await act(async () => t.mock.timers.tick(32));
    assert.equal(relatedCalls.filter((id) => id === fixtures[0].bvid).length, 1);
    assert.equal(context.queue.filter((item) => item.discoveryOrigin === 'related').length, 6, 'related expansion is capped and synchronized into autoplay');
    assert.equal(new Set(context.queue.map((item) => item.bvid)).size, context.queue.length);
    const detector = () => tree.root.findAllByType('GestureDetector')[0].props.gesture;
    const card = () => tree.root.findAllByType('MotionView').find((node) => node.props.testID === 'discovery-card');
    const cardTransform = () => card().props.style.flat().find((style) => style.transform)?.transform;
    const cardStack = () => tree.root.findAllByType('MotionView').find((node) => node.props.testID === 'discovery-card-layer')
      .props.style.flat().find((style) => 'zIndex' in style).zIndex;
    const rest = [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }, { scale: 1 }];
    const wheel = () => tree.root.findByType('Wheel').props;
    assert.equal(tree.root.findAllByType('Wheel').length, 0, 'closed wheel mounts no duplicated folders or covers');
    assert.equal(frameControl.active, false, 'closed wheel does not schedule UI frame callbacks');
    const change = async (values) => act(async () => { Object.assign(context, values); refresh((v) => v + 1); });
    const backdrop = tree.root.findByProps({ testID: 'discovery-backdrop' });
    const backgroundImage = tree.root.findByType('CoverImage');
    assert.equal(backgroundImage.props.blurRadius, 32, 'the video retains its frosted background');
    assert.equal(tree.root.findAllByType('CoverImage').length, 1, 'there is no second sharp cover or under-card cover');
    assert.deepEqual(preloadWindows.at(-1), fixtures.slice(1, 4).map((track) => track.bvid));
    // Intentionally never emit onFirstFrameRender: playback must not be hidden
    // behind a JS overlay while waiting for that optional/delayed event.
    const assertUncoveredVideo = () => {
      const video = tree.root.findByType('VideoView');
      assert.ok(video.parent.children.at(-1) === video, 'native video renders above the frosted backdrop immediately');
      const glass = tree.root.findByProps({ testID: 'discovery-backdrop' });
      assert.ok(!glass.props.style.flat().some((style) => style.zIndex > 0), 'the backdrop never covers a loaded video');
      assert.equal(tree.root.findAllByProps({ testID: 'discovery-video-placeholder' }).length, 0);
    };
    assertUncoveredVideo();
    const surface = tree.root.findByType('VideoView');
    assert.equal(surface.props.player, nativePlayer);
    assert.equal(surface.props.surfaceType, 'textureView');
    assert.equal(rn.StyleSheet.create(surface.props.style).opacity, undefined);
    assert.ok(tree.root.findByProps({ testID: 'discovery-backdrop' }) === backdrop, 'initial video attachment keeps the same backdrop layer');
    assert.ok(tree.root.findByType('CoverImage') === backgroundImage, 'initial video attachment keeps the same background image');
    const touchShield = card().findAllByType('View').find((node) => node.props.pointerEvents === 'none');
    assert.ok(touchShield, 'native video descendants must not intercept the card pan recognizer');
    const preloadUpdates = preloadWindows.length;
    const clearsBeforeBuffering = preloadClears;
    await change({ buffering: true });
    await change({ buffering: false });
    assert.equal(preloadWindows.length, preloadUpdates, 'buffering does not restart queue preloads');
    assert.equal(preloadClears, clearsBeforeBuffering, 'buffering never destroys warmed video buffers');
    assert.equal(tree.root.findByType('VideoView'), surface);
    const unchangedCardRenders = backdropRenders;
    await change({ history: [{ bvid: 'unrelated' }] });
    assert.equal(backdropRenders, unchangedCardRenders, 'unrelated context updates do not rebuild the frosted video card');
    const layoutNode = tree.root.findAllByType('View').find((node) => node.props.onLayout);
    await act(async () => layoutNode.props.onLayout({ nativeEvent: { layout: { width: 390, height: 520 } } }));
    const event = (dx, dy, px = 200, py = 260) => ({ translationX: dx, translationY: dy,
      absoluteX: px, absoluteY: py, velocityX: 0, velocityY: 0 });
    const pan = detector()[0].handlers;
    const outgoingCard = card();
    deferJS = true;
    await act(async () => { pan.onStart(); pan.onUpdate(event(0, -90)); pan.onEnd(event(0, -90)); });
    assert.equal(context.current.bvid, fixtures[0].bvid, 'JS is still blocked at release');
    assert.equal(exitAnimations.at(-1).value, -600, 'the exit starts without a JS finish handler');
    assert.ok(exitAnimations.at(-1).config.easing(0.05) > 0.05, 'the exit does not ease in from zero speed');
    await act(async () => refresh((v) => v + 1));
    assert.equal(cardTransform()[1].translateY, -600, 'the outgoing card keeps moving while the JS completion is queued');
    deferJS = false;
    await act(async () => jsJobs.splice(0).forEach((job) => job()));
    assert.deepEqual(prematureResets, [], 'the animation completion callback must leave the outgoing card offscreen until React commits its replacement');
    assert.notEqual(card(), outgoingCard, 'the native animated card container must belong to the new track');
    assert.deepEqual(mountedCardTransforms.at(-1), [
      { translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }, { scale: 1 },
    ], 'the incoming card must be onscreen on its first commit, before effects reset the outgoing shared values');
    assert.equal(context.current.bvid, fixtures[1].bvid, `${platform}: upward pan advances once`);
    assert.equal(tree.root.findAllByType('VideoView').length, 0, 'new queue metadata cannot attach the old native source');
    const loadingBackdrop = tree.root.findByProps({ testID: 'discovery-backdrop' });
    await change({ buffering: false, videoSource: { key: fixtures[0].bvid, revision: 1 } });
    assert.equal(tree.root.findAllByType('VideoView').length, 0, 'even ready status from the old source cannot reveal it');
    await change({ videoSource: { key: fixtures[1].bvid, revision: 2 } });
    assert.ok(tree.root.findByProps({ testID: 'discovery-backdrop' }) === loadingBackdrop, 'attaching video preserves its existing frosted backdrop');
    assertUncoveredVideo();
    const nextSurface = tree.root.findByType('VideoView');
    assert.notEqual(nextSurface, surface);
    await change({ buffering: true });
    await change({ buffering: false });
    assert.equal(tree.root.findByType('VideoView'), nextSurface);
    assert.deepEqual(cardTransform(), rest, 'source and first-frame updates must keep the entire card onscreen');
    deferUI = true;
    await change({ current: fixtures[0], videoSource: null, automaticVideoTransition: false });
    assert.equal(context.current.bvid, fixtures[0].bvid);
    assert.ok(uiJobs.length, 'exercise a new card before its UI-thread ownership reset runs');
    assert.deepEqual(cardTransform(), rest, 'a delayed reset cannot move the incoming card to the outgoing position');
    await change({ buffering: false, videoSource: { key: fixtures[0].bvid, revision: 3 } });
    assert.deepEqual(cardTransform(), rest, 'starting video before the reset must not expose the under-card');
    deferUI = false;
    await act(async () => { uiJobs.splice(0).forEach((job) => job()); refresh((v) => v + 1); });
    assert.deepEqual(cardTransform(), rest, 'transferring motion ownership is visually continuous');
    await act(async () => tree.root.findAllByType('TouchableOpacity').find((node) => node.props.testID === 'discovery-wheel-toggle').props.onPress());
    assert.equal(frameControl.active, true, 'opening the wheel starts its physics');
    const wheelPan = tree.root.findAllByType('GestureDetector')[1].props.gesture.handlers;
    await act(async () => { wheelPan.onStart(); wheelPan.onUpdate(event(0, 80)); wheelPan.onUpdate(event(0, 100));
      wheelPan.onEnd({ ...event(0, 100), velocityY: 1200 }); });
    const before = wheel().rotation.value;
    const wheelRotation = wheel().rotation;
    await act(async () => frame({ timeSincePreviousFrame: 16.667 }));
    assert.ok(Number.isFinite(wheel().rotation.value) && wheel().rotation.value > before, 'onUpdate needs only translationY; release keeps coasting');
    const dragSurface = tree.root.findByType('VideoView');
    await act(async () => { pan.onStart(); pan.onUpdate(event(40, 0)); pan.onUpdate(event(40, -200, 380, 120)); });
    // The test renderer samples worklets on render; native Reanimated observes
    // shared values directly without requiring a React update.
    await act(async () => refresh((v) => v + 1));
    assert.equal(cardTransform()[0].translateX, 40, 'after handoff the card still follows its own drag');
    assert.equal(cardStack(), 3, 'dragged card is above the frosted layer and folders');
    assert.equal(tree.root.findByType('VideoView'), dragSurface, 'raising the card never remounts its video surface');
    await act(async () => { for (let i = 0; i < 60; i++) frame({ timeSincePreviousFrame: 16.667 }); });
    assert.ok(Number.isFinite(wheel().rotation.value));
    await act(async () => pan.onEnd(event(40, -200, 20, 120)));
    assert.equal(context.current.bvid, fixtures[0].bvid, 'leaving wheel cancels the locked drag instead of skipping the card');
    assert.equal(saves.length, 0);
    assert.equal(frameControl.active, false, 'cancelling the drag stops the frame loop');
    assert.equal(cardStack(), 0, 'the resting card returns below the wheel backdrop');
    assert.equal(tree.root.findAllByType('Wheel').length, 0);
    await act(async () => { wheelRotation.value = -120; pan.onStart(); pan.onUpdate(event(120, 0, 338, 260)); });
    deferJS = true;
    await act(async () => { pan.onEnd(event(120, 0, 338, 260)); refresh((n) => n + 1); });
    assert.equal(cardTransform()[3].scale, 0.08, 'folder absorption runs on UI even before JS can begin the save');
    assert.equal(context.current.bvid, fixtures[0].bvid, 'a pending save cannot discard the current card');
    deferJS = false;
    await act(async () => jsJobs.splice(0).forEach((job) => job()));
    assert.equal(context.current.bvid, fixtures[0].bvid, 'failed playlist write must keep the card');
    assert.match(textOf(tree), /Storage unavailable/);
    await change({ playError: 'Network offline' });
    assert.match(textOf(tree), /Network offline/);
    await act(async () => detector()[2].handlers.onEnd({}, true));
    assert.equal(navigation.length, 0, 'tap retries a failed card without navigating away');
    await change({ playError: null, buffering: false, videoSource: { key: fixtures[0].bvid, revision: 4 } });
    const autoSurface = tree.root.findByType('VideoView');
    const autoCard = card();
    const manualRequests = revision;
    const backdropsBeforeAuto = backdropMounts;
    await change({ current: fixtures[1], videoSource: null, buffering: true, automaticVideoTransition: true });
    assert.ok(card() === autoCard, 'automatic advance preserves the native card instead of remounting its placeholder');
    assert.equal(tree.root.findByType('VideoView'), autoSurface, 'automatic loading retains the already visible video surface');
    await change({ buffering: false, videoSource: { key: fixtures[1].bvid, revision: 5 } });
    assert.equal(tree.root.findByType('VideoView'), autoSurface);
    assertUncoveredVideo();
    await change({ buffering: true });
    await change({ buffering: false });
    assert.equal(revision, manualRequests, 'following native completion must not restart playQueue');
    // A cached next source may be ready before React follows its queue index.
    await change({ current: fixtures[2], videoSource: { key: fixtures[2].bvid, revision: 6 } });
    assert.equal(card(), autoCard);
    assert.equal(tree.root.findByType('VideoView'), autoSurface);
    assertUncoveredVideo();
    assert.match(tree.root.findByProps({ testID: 'discovery-card-gesture-region' }).props.accessibilityLabel, /Card 2/);
    await change({ videoSource: null, buffering: true });
    await change({ videoSource: { key: fixtures[2].bvid, revision: 7 }, buffering: false });
    assert.ok(tree.root.findByType('VideoView') === autoSurface, 'automatic repeat keeps the same surface even when its source revision changes');
    assert.equal(backdropMounts, backdropsBeforeAuto, 'automatic transitions do not remount the frosted backdrop');
    await act(async () => { pan.onStart(); pan.onUpdate(event(0, -90)); pan.onEnd(event(0, -90)); });
    assert.notEqual(card(), autoCard, 'a manual swipe after autoplay still creates an isolated card');
    assert.equal(tree.root.findAllByType('VideoView').length, 0);
    await change({ buffering: false, videoSource: { key: fixtures[3].bvid, revision: 7 }, automaticVideoTransition: false });
    await act(async () => { focused = false; refresh((v) => v + 1); });
    assert.equal(tree.root.findAllByType('VideoView').length, 0, 'blur detaches the shared player surface');
    assert.equal(tree.root.findAllByType('Wheel').length, 0);
    assert.equal(frameControl.active, false, 'blur stops the wheel frame loop');
    await act(async () => { focused = true; refresh((v) => v + 1); });
    await act(async () => t.mock.timers.tick(32));
    assert.equal(tree.root.findAllByType('VideoView').length, 1);
    assert.ok(mountedCardTransforms.every((transform) => JSON.stringify(transform) === JSON.stringify(rest)),
      'every new native card starts at rest, including backward navigation');
    await act(async () => tree.root.findByProps({ testID: 'discovery-profile-toggle' }).props.onPress());
    assert.equal(tree.root.findAllByType('Sheet').length, 1);
    await act(async () => tree.root.findByProps({ accessibilityLabel: '使用画像：卡片画像' }).props.onPress());
    assert.deepEqual(profileEdits.at(-1), { type: 'select', id: 'cards', enabled: true });
    assert.equal(tree.root.findAllByType('Sheet').length, 0);
    await act(async () => relatedPending.resolve([{ bvid: 'BVstaleRelated', title: 'Card stale' }]));
    assert.ok(!context.queue.some((item) => item.bvid === 'BVstaleRelated'), 'old related requests cannot leak into a new profile');
    const relatedTrack = context.queue.find((item) => item.discoveryOrigin === 'related');
    await change({ current: relatedTrack, videoSource: { key: relatedTrack.bvid, revision: 99 }, automaticVideoTransition: true });
    assert.ok(!relatedCalls.includes(relatedTrack.bvid), 'related videos never recursively expand');
    await change({ account: { isLogin: true, mid: 777 }, likes: [{ pic: 'liked1' }, { pic: 'liked2' }] });
    assert.equal(folderRequests.length, 0, 'remote thumbnails wait until the wheel is opened');
    await act(async () => tree.root.findByProps({ testID: 'discovery-wheel-toggle' }).props.onPress());
    assert.deepEqual(wheel().targets.find((target) => target.kind === 'likes').covers, ['liked1', 'liked2']);
    assert.deepEqual(folderRequests, [[99, 1, 4]]);
    assert.deepEqual(wheel().targets.find((target) => target.id === 99).covers, ['remote1', 'remote2']);
    await act(async () => tree.root.findByProps({ testID: 'discovery-wheel-toggle' }).props.onPress());
    await act(async () => tree.root.findByProps({ testID: 'discovery-wheel-toggle' }).props.onPress());
    assert.equal(folderRequests.length, 1, 'reopening retains the thumbnail cache');
    await act(async () => tree.unmount());
    foldersOffline = true;
    await act(async () => { tree = create(React.createElement(Screen, { navigation: {} })); });
    await act(async () => t.mock.timers.tick(32));
    await act(async () => tree.root.findByProps({ testID: 'discovery-wheel-toggle' }).props.onPress());
    assert.deepEqual(wheel().targets.find((target) => target.id === 99).covers, ['remote1', 'remote2'], 'remount restores folder metadata and covers even when the folder API is offline');
    assert.equal(folderRequests.length, 1, 'persisted fresh covers skip content requests after remount');
    const rejected = context.current;
    const rejectedRelated = context.queue.filter((item) => item.relatedTo === rejected.bvid).map((item) => item.bvid);
    const down = detector()[0].handlers;
    const queueBeforeDown = context.queue, writesBeforeDown = queueWrites.length;
    holdAnimation = true;
    await act(async () => { down.onStart(); down.onUpdate(event(0, 90)); down.onEnd(event(0, 90)); });
    assert.equal(context.queue, queueBeforeDown, 'dislike persistence and related lookup do not mutate the deck during its flight');
    assert.equal(context.current.bvid, rejected.bvid);
    holdAnimation = false;
    await act(async () => heldAnimations.splice(0).forEach((finish) => finish()));
    assert.notEqual(context.current.bvid, rejected.bvid, 'down advances after disliking instead of going backward');
    const firstReplacement = queueWrites[writesBeforeDown].map((item) => item.bvid);
    assert.ok(queueWrites.slice(writesBeforeDown).every((queue) =>
      JSON.stringify(queue.slice(0, firstReplacement.length).map((item) => item.bvid)) === JSON.stringify(firstReplacement)),
    'ready exclusions are removed together; later enrichment only appends and never prunes a second time');
    assert.ok(context.queue.every((item) => item.bvid !== rejected.bvid && !rejectedRelated.includes(item.bvid)));
    assert.match(textOf(tree), /已标记不喜欢/);
    await act(async () => tree.unmount());
    await act(async () => { tree = create(React.createElement(Screen, { navigation: {} })); });
    await act(async () => t.mock.timers.tick(32));
    assert.ok(context.queue.every((item) => item.bvid !== rejected.bvid && !rejectedRelated.includes(item.bvid)), 'new Web pages and remounts cannot reintroduce rejected IDs');
    const anchor = context.current, anchorCard = card(), playsBeforeLeft = revision, savedBeforeLeft = saves.length;
    const left = detector()[0].handlers;
    await act(async () => { left.onStart(); left.onUpdate(event(-100, 0)); left.onEnd(event(-100, 0)); });
    const anchorIndex = context.queue.findIndex((item) => item.bvid === anchor.bvid);
    const focusedRun = context.queue.slice(anchorIndex + 1, anchorIndex + 21);
    assert.equal(focusedRun.length, 20);
    assert.ok(focusedRun.every((item) => item.discoveryOrigin === 'focused' && item.relatedFocus === anchor.bvid));
    assert.equal(new Set(focusedRun.map((item) => item.bvid)).size, 20);
    assert.equal(context.current, anchor, 'left swipe keeps the current video playing');
    assert.equal(card(), anchorCard, 'left swipe never remounts the playing video card');
    assert.equal(revision, playsBeforeLeft); assert.equal(saves.length, savedBeforeLeft, 'left no longer adds to the library');
    assert.deepEqual(preloadWindows.at(-1), focusedRun.slice(0, 3).map((item) => item.bvid));
    assert.match(textOf(tree), /接下来 20 个视频已换为相关推荐/);
    await act(async () => tree.root.findAllByType('View').find((node) => node.props.onLayout)
      .props.onLayout({ nativeEvent: { layout: { width: 390, height: 520 } } }));
    await act(async () => tree.root.findByProps({ testID: 'discovery-wheel-toggle' }).props.onPress());
    const folderIndex = wheel().targets.findIndex((target) => target.kind === 'playlist');
    const drop = detector()[0].handlers;
    playlistSave = deferred(); holdAnimation = true;
    await act(async () => {
      wheel().rotation.value = -180 * folderIndex / wheel().targets.length;
      drop.onStart(); drop.onUpdate(event(120, 0, 338, 260)); drop.onEnd(event(120, 0, 338, 260));
    });
    assert.equal(context.current, anchor);
    holdAnimation = false;
    await act(async () => { heldAnimations.splice(0).forEach((finish) => finish()); refresh((n) => n + 1); });
    assert.equal(cardTransform()[3].scale, 0.08, 'a slow save leaves the card visibly absorbed instead of stopping its flight');
    assert.equal(context.current, anchor, 'retain the card until the asynchronous save succeeds');
    await act(async () => playlistSave.resolve('added'));
    assert.equal(context.current.bvid, focusedRun[0].bvid, 'successful drop advances once into the arranged related run');
    await act(async () => tree.unmount());
  }
});

test('a native video error clears the reusable media key so discovery retry replaces the failed source', async () => {
  let requests = 0, replacements = 0, context, tree;
  const listeners = {};
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 180,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { replacements++; this.source = source; } };
  const { PlayerProvider, usePlayer } = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; } },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': { videoUrl: async () => `https://cdn/video?attempt=${++requests}` },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/PlayerContext.js');
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const list = [{ bvid: 'BVretry', cid: 1, title: 'Retry' }];
    await act(async () => context.playQueue(list, 0, 0, 'discovery'));
    await act(async () => listeners.statusChange({ status: 'error', error: { message: 'CDN unavailable' } }));
    assert.equal(context.playError, 'CDN unavailable');
    await act(async () => context.playQueue(list, 0, 0, 'discovery'));
    assert.equal(requests, 2); assert.equal(replacements, 2);
    assert.equal(player.source.uri, 'https://cdn/video?attempt=2');
    assert.equal(context.playError, null);
  } finally { await act(async () => tree.unmount()); }
});

test('discovery source readiness rejects late loads and survives A → B → A during an in-flight native replacement', async () => {
  const listeners = {}, replacingB = deferred();
  const sources = [];
  let context, tree, bRequest, aRequest;
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 180,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) {
      sources.push(source);
      if (source.metadata.title === 'B') await replacingB.promise;
      this.source = source;
      // Exercise Android ordering: sourceLoad can precede replaceAsync completion.
      if (sources.length > 2) listeners.sourceLoad({ videoSource: source });
    } };
  const { PlayerProvider, usePlayer } = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; } },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': { videoUrl: async (bvid) => `https://cdn/${bvid}` },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/PlayerContext.js');
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const tracks = ['A', 'B'].map((bvid) => ({ bvid, title: bvid, cid: 1 }));
    await act(async () => context.playQueue(tracks, 0, 0, 'discovery'));
    assert.equal(context.videoSource, null, 'replaceAsync may finish before iOS installs the new native item');
    await act(async () => listeners.sourceChange({ source: player.source }));
    assert.equal(context.videoSource, null, 'sourceChange does not imply that video tracks have loaded');
    await act(async () => listeners.sourceLoad({ videoSource: player.source }));
    assert.deepEqual(context.videoSource, { key: 'A', revision: 1 }, 'mount the matching native video before waiting for a playing time tick');
    await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
    assert.deepEqual(context.videoSource, { key: 'A', revision: 1 });
    const first = context.videoSource;
    await act(async () => listeners.statusChange({ status: 'loading' }));
    await act(async () => listeners.statusChange({ status: 'readyToPlay' }));
    assert.equal(context.videoSource, first, 'rebuffering never revokes an already loaded source');
    await act(async () => { bRequest = context.playQueue(tracks, 1, 0, 'discovery'); });
    assert.equal(context.current.bvid, 'B');
    assert.equal(context.videoSource, null, 'selecting B immediately conceals A, even while native replace waits');
    await act(async () => listeners.sourceLoad({ videoSource: sources[0] }));
    assert.equal(context.videoSource, null, 'late A load cannot reveal A under B metadata');
    await act(async () => { aRequest = context.playQueue(tracks, 0, 0, 'discovery'); });
    assert.equal(context.videoSource, null);
    await act(async () => { replacingB.resolve(); await bRequest; await aRequest; });
    assert.equal(sources.length, 3, 'A must replace B after the pending replace; reusing the old A cache would show B');
    assert.equal(player.source.metadata.title, 'A');
    await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
    assert.deepEqual(context.videoSource, { key: 'A', revision: 3 });
    assert.equal(context.playing, true);
    assert.equal(context.buffering, false, 'sourceLoad without sourceChange clears startup even when loading finished before replaceAsync');
    await act(async () => { player.status = 'loading'; listeners.timeUpdate({ currentTime: 0.5 }); });
    assert.equal(context.buffering, true, 'a genuine native rebuffer still shows loading even with play intent set');
    await act(async () => { player.status = 'readyToPlay'; listeners.timeUpdate({ currentTime: 0.75 }); });
    assert.equal(context.buffering, false);
    await act(async () => listeners.sourceLoad({ videoSource: sources[1] }));
    assert.deepEqual(context.videoSource, { key: 'A', revision: 3 }, 'late B events cannot undo the last selection');
    await act(async () => context.playQueue(tracks, 0, 0, 'discovery'));
    assert.equal(sources.length, 3, 'an idle native item can still be reused without another load event');
    assert.deepEqual(context.videoSource, { key: 'A', revision: 4 });
  } finally { await act(async () => tree.unmount()); }
});

test('discovery waits for startup progress and rejects old end events throughout slow native loading', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const events = {}, seeks = [], sources = [];
  let context, tree, nativeTime = 0;
  const player = { playing: false, status: 'readyToPlay', duration: 180,
    get currentTime() { return nativeTime; }, set currentTime(value) { seeks.push(value); nativeTime = value; },
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { sources.push(source); this.source = source; nativeTime = 0; },
  };
  const { PlayerProvider, usePlayer } = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { events[name] = fn; } },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': { videoUrl: async (bvid) => `https://cdn/${bvid}` },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/PlayerContext.js');
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const tracks = ['A', 'B', 'C'].map((bvid) => ({ bvid, cid: 1, title: bvid }));
    await act(async () => context.playQueue(tracks, 0, 0, 'discovery'));
    await act(async () => { events.sourceLoad({ videoSource: player.source }); events.timeUpdate({ currentTime: 0.25 }); });
    assert.equal(context.videoSource.key, 'A');
    await act(async () => context.playQueue(tracks, 1, 0, 'discovery'));
    const incoming = player.source;
    await act(async () => { events.timeUpdate({ currentTime: 0.25 }); events.playToEnd(); });
    assert.equal(context.current.bvid, 'B', 'an untagged near-start tick cannot unlock a source that has not loaded');
    now += 5000;
    await act(async () => { events.timeUpdate({ currentTime: 179.9 }); events.playToEnd(); });
    assert.equal(context.current.bvid, 'B', 'old tail ticks and end events must not skip a slow-loading card');
    assert.equal(context.videoSource, null);
    await act(async () => {
      events.sourceChange({ source: incoming }); events.sourceLoad({ videoSource: incoming });
      events.timeUpdate({ currentTime: 0 }); events.playToEnd();
    });
    assert.equal(context.current.bvid, 'B', 'an installed item still waiting at zero is not playback completion');
    assert.deepEqual(context.videoSource, { key: 'B', revision: 2 }, 'source readiness mounts video while the independent end-event guard still waits for startup');
    await act(async () => events.timeUpdate({ currentTime: 0.25 }));
    assert.deepEqual(context.videoSource, { key: 'B', revision: 2 });
    assert.deepEqual(seeks, [], 'fresh sources must not flush their decoder with a redundant seek to zero');
    const ready = context.videoSource;
    await act(async () => { events.statusChange({ status: 'loading' }); events.statusChange({ status: 'readyToPlay' }); });
    assert.equal(context.videoSource, ready, 'ordinary rebuffering preserves the revealed native view');
    await act(async () => { events.timeUpdate({ currentTime: 179.9 }); events.playToEnd(); });
    assert.equal(context.current.bvid, 'C', 'actual completion advances exactly once');
    await act(async () => events.playToEnd());
    assert.equal(context.current.bvid, 'C', 'late duplicate completion cannot skip the next pending source');
    assert.equal(sources.length, 3);
  } finally { await act(async () => tree.unmount()); }
});

test('discovery transfers buffered players without replacing or seeking, isolates old events and releases ownership exactly once', async () => {
  let context, tree, viewRequests = 0, urlRequests = 0;
  const decoders = [];
  let installGate = null;
  function nativePlayer() {
    const listeners = new Map();
    let time = 0;
    return { released: 0, playing: false, status: 'idle', duration: 90, volume: 0.36, replacements: 0, seeks: 0,
      get currentTime() { return time; }, set currentTime(value) { this.seeks++; time = value; },
      addListener(name, fn) { const list = listeners.get(name) || new Set(); list.add(fn); listeners.set(name, list); return { remove: () => list.delete(fn) }; },
      queued(name) { return [...(listeners.get(name) || [])]; },
      emit(name, event) { for (const fn of this.queued(name)) fn(event); },
      async replaceAsync(source) {
        this.replacements++; this.source = source; time = 0;
        if (source?.uri.includes('BVslow')) await installGate.promise;
        this.status = source ? 'readyToPlay' : 'idle';
        this.emit('sourceChange', { source }); this.emit('sourceLoad', { videoSource: source });
        this.emit('statusChange', { status: this.status });
      },
      play() { this.playing = true; this.emit('playingChange', { isPlaying: true }); },
      pause() { this.playing = false; this.emit('playingChange', { isPlaying: false }); },
      release() { this.released++; },
    };
  }
  const primary = nativePlayer();
  function useEventListener(emitter, name, listener) {
    const ref = React.useRef(listener); ref.current = listener;
    React.useEffect(() => { const sub = emitter.addListener(name, (...args) => ref.current(...args)); return () => sub.remove(); }, [emitter, name]);
  }
  const load = loader({
    'expo-video': { useVideoPlayer: () => primary, createVideoPlayer: () => {
      const p = nativePlayer(); decoders.push(p);
      assert.ok(decoders.filter((decoder) => !decoder.released).length <= 4, 'at most one active player and three preloads');
      return p;
    } },
    expo: { useEventListener, useEvent: (emitter, name, initial) => {
      const [event, setEvent] = React.useState(initial); useEventListener(emitter, name, setEvent); return event;
    } },
    '@react-native-async-storage/async-storage': storage,
    'src/api/bili': { view: async () => { viewRequests++; return { cid: 55 }; },
      videoUrl: async (bvid) => `https://cdn/${bvid}?signature=${++urlRequests}` },
    'src/api/client': { streamHeaders: () => ({ Referer: 'https://www.bilibili.com/' }) },
  });
  const preload = load('src/player/discoveryPreload.js');
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  function Probe() { context = usePlayer(); return null; }
  const tracks = Array.from({ length: 5 }, (_, i) => ({ bvid: `BVwarm${i}`, title: `Warm ${i}`, cid: i || undefined }));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 140));
  preload.preloadDiscoveryQueue(tracks, 1, ''); await settle();
  assert.equal(decoders.length, 3);
  assert.ok(decoders.every((p) => p.muted && !p.playing && !p.showNowPlayingNotification));
  assert.ok(decoders.every((p) => p.source.useCaching && p.bufferOptions.preferredForwardBufferDuration === 12));
  preload.preloadDiscoveryQueue(tracks.map((track) => ({ ...track })), 1, ''); await settle();
  assert.equal(urlRequests, 3, 'unchanged entries retain their loaded native item');
  const forTrack = (track) => decoders.find((decoder) => decoder.source.uri.includes('/' + track.bvid + '?'));
  const warm = forTrack(tracks[0]), retained = tracks.slice(1, 3).map(forTrack);
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const stalePrimary = primary.queued('statusChange');
    await act(async () => context.playQueue(tracks, 0, 0, 'discovery'));
    assert.equal(viewRequests, 1); assert.equal(urlRequests, 3); assert.equal(tracks[0].cid, 55);
    assert.equal(context.playError, null);
    assert.ok(context.player === warm, 'foreground owns the exact preloaded native player');
    assert.equal(warm.replacements, 1, 'no second replaceAsync or download on a warm hit');
    assert.equal(warm.seeks, 0, 'handoff never flushes the buffered first frame with a zero seek');
    assert.equal(warm.released, 0); assert.equal(warm.playing, true); assert.equal(warm.muted, false);
    assert.equal(warm.volume, 0.36); assert.equal(warm.showNowPlayingNotification, true);
    assert.equal(context.buffering, false); assert.equal(context.playing, true);
    assert.equal(context.videoSource.key, tracks[0].bvid, 'source ready before adoption is published immediately');
    assert.equal(primary.source, null, 'the unused base player frees its native media buffer');
    await act(async () => stalePrimary.forEach((fn) => fn({ status: 'error', error: { message: 'old source' } })));
    assert.equal(context.playError, null, 'already queued events from the previous emitter are ignored');
    preload.preloadDiscoveryQueue(tracks.slice(1), 1, ''); await settle();
    assert.equal(urlRequests, 4);
    assert.ok(retained.every((p) => p.released === 0));
    const staleEnd = warm.queued('playToEnd'), staleClock = warm.queued('timeUpdate');
    await act(async () => context.playQueue(tracks, 1, 0, 'discovery'));
    assert.ok(context.player === retained[0]); assert.equal(retained[0].replacements, 1);
    assert.equal(warm.playing, false); assert.equal(warm.released, 1);
    await act(async () => {
      staleClock.forEach((fn) => fn({ currentTime: 89.9 })); staleEnd.forEach((fn) => fn());
    });
    assert.equal(context.current.bvid, tracks[1].bvid, 'retired clocks and end events cannot skip a card');
    await act(async () => retained[0].emit('timeUpdate', { currentTime: 0.25 }));
    await act(async () => retained[0].emit('playToEnd'));
    assert.ok(context.player === retained[1], 'automatic completion also adopts the next prepared player');
    assert.equal(retained[1].replacements, 1); assert.equal(retained[0].released, 1);
    assert.equal(preload.takeDiscoveryPreload(tracks[3], 64, ''), null);
    assert.equal(preload.takeDiscoveryPreload(tracks[3], 1, 'another-account'), null);
    preload.clearDiscoveryPreloads();
    assert.equal(retained[1].released, 0, 'clearing the background pool cannot release the active video');
    assert.equal(decoders[3].released, 1);
    await act(async () => context.playQueue([tracks[4]]));
    assert.ok(context.player === retained[1], 'a cache miss retains normal foreground playback');
    assert.equal(retained[1].replacements, 2);
    const failed = { bvid: 'BVfailedWarm', cid: 88 };
    preload.preloadDiscoveryQueue([failed], 1, ''); await settle();
    const failedPlayer = decoders.at(-1);
    failedPlayer.emit('statusChange', { status: 'error' });
    assert.equal(preload.takeDiscoveryPreload(failed, 1, ''), null);
    assert.equal(failedPlayer.released, 1);
    installGate = deferred();
    const slow = { bvid: 'BVslow', cid: 77 };
    preload.preloadDiscoveryQueue([slow], 1, ''); await settle();
    const pendingPlayer = decoders.at(-1);
    let pendingSwitch;
    await act(async () => { pendingSwitch = context.playQueue([slow], 0, 0, 'discovery'); });
    await act(async () => context.playQueue([tracks[4]]));
    await act(async () => { installGate.resolve(); await pendingSwitch; });
    assert.equal(context.current.bvid, tracks[4].bvid);
    assert.ok(context.player === retained[1]);
    assert.equal(pendingPlayer.released, 1, 'superseded in-flight handoffs release the claimed decoder');
  } finally { preload.clearDiscoveryPreloads(); await act(async () => tree.unmount()); }
  assert.ok(decoders.every((p) => p.released === 1));
});

test('discovery preload cancellation preserves a claimed lookup and never resurrects background decoders', async (t) => {
  const uri = deferred();
  let creates = 0, now = Date.now(), requests = 0;
  t.mock.method(Date, 'now', () => now);
  const preload = loader({
    'expo-video': { createVideoPlayer: () => { creates++; throw Error('must not create a cancelled decoder'); } },
    'src/api/bili': { videoUrl: () => { requests++; return uri.promise; } },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/discoveryPreload.js');
  const track = { bvid: 'BVpending', cid: 4 };
  preload.preloadDiscoveryQueue([track], 1, '');
  preload.preloadDiscoveryQueue([track], 1, '');
  const pending = preload.takeDiscoveryPreload(track, 1, '');
  preload.clearDiscoveryPreloads();
  assert.equal(requests, 1, 'reuse a pending lookup instead of firing duplicate API calls');
  uri.resolve('https://cdn/pending');
  assert.equal((await pending).uri, 'https://cdn/pending');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(creates, 0, 'late async results cannot recreate a cancelled native preloader');
  preload.preloadDiscoveryQueue([track], 1, '');
  now += 10 * 60 * 1000 + 1;
  assert.equal(preload.takeDiscoveryPreload(track, 1, ''), null, 'expired signatures are never sent to the foreground');
  preload.clearDiscoveryPreloads();
});

test('discovery API normalizes related videos and tag responses through the authenticated client', async () => {
  const requests = [];
  const api = loader({ './client': { get: async (url) => {
    requests.push(new URL(url));
    const data = url.includes('/archive/related') ? [
      { bvid: 'BVseed' }, { bvid: 'BVnext', cid: 12, title: '<em>钢琴</em>现场', owner: { name: '演奏者', mid: 9 }, duration: 180 },
      { bvid: 'BVnext' }, { aid: 4 },
    ] : [{ tag_name: '<em>钢琴</em>' }, { tag_name: '现场' }, {}];
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  } } })('src/api/bili.js');
  const videos = await api.relatedVideos('BVseed');
  assert.deepEqual(videos.map((v) => v.bvid), ['BVnext']);
  assert.equal(videos[0].cid, 12);
  assert.equal(videos[0].title, '钢琴现场');
  assert.equal(videos[0].up, '演奏者');
  assert.equal(requests[0].pathname, '/x/web-interface/archive/related');
  assert.equal(requests[0].searchParams.get('bvid'), 'BVseed');
  assert.deepEqual(await api.videoTags('BVnext'), ['钢琴', '现场']);
  assert.equal(requests[1].pathname, '/x/web-interface/view/detail/tag');
  assert.equal(requests[1].searchParams.get('bvid'), 'BVnext');
});

test('discovery verifies App labels, bounds classification and caches public tags across profile changes', { timeout: 5000 }, async () => {
  const R = require('../renderer/recommendation-profile');
  const gates = new Map(), batches = []; let pending = 0, peak = 0;
  const firstStarted = deferred(), secondStarted = deferred();
  const { filterDiscoveryCandidates } = loader({ 'src/api/bili': { videoTags: async (id) => {
    pending++; peak = Math.max(peak, pending);
    const gate = deferred(); gates.set(id, gate);
    if (gates.size === 4) firstStarted.resolve();
    if (gates.size === 6) secondStarted.resolve();
    try { return await gate.promise; } finally { pending--; }
  } } })('src/screens/discoveryFeed.js');
  const candidates = Array.from({ length: 6 }, (_, i) => ({ bvid: `BVtag${i}`, title: `作品 ${i}`, tags: ['钢琴'] }));
  const state = R.normalize({ auto: { tags: ['钢琴'] }, profiles: [{ id: 'piano', name: '钢琴', tags: ['钢琴'] }] });
  const result = filterDiscoveryCandidates(candidates, state, (items) => batches.push(items.map((v) => v.bvid)), () => true);
  assert.deepEqual(batches, [], 'App card tags never publish before verification');
  await firstStarted.promise;
  assert.equal(gates.size, 4);
  gates.get('BVtag0').resolve(['钢琴']); gates.get('BVtag1').resolve(['影视剪辑']);
  gates.get('BVtag2').resolve([]); gates.get('BVtag3').resolve(['钢琴']);
  await secondStarted.promise;
  assert.equal(gates.size, 6);
  gates.get('BVtag4').resolve(['钢琴']); gates.get('BVtag5').resolve(['游戏']);
  assert.deepEqual((await result).map((v) => v.bvid), ['BVtag0', 'BVtag3', 'BVtag4']);
  assert.equal(peak, 4);
  const cached = await filterDiscoveryCandidates(candidates, { ...state, activeId: 'piano' }, () => {}, () => true);
  assert.deepEqual(cached.map((v) => v.bvid), ['BVtag0', 'BVtag3', 'BVtag4']);
  assert.equal(gates.size, 6, 'verified public metadata is reused, decisions are re-evaluated');
  for (const snapshot of [null, { ...state, ready: false }, R.normalize(null), { ...state, activeId: 'missing' }]) {
    assert.deepEqual(await filterDiscoveryCandidates(candidates, snapshot, () => assert.fail('unready profile leaked'), () => true), []);
  }
  const raw = await filterDiscoveryCandidates(candidates, { ...state, enabled: false }, () => {}, () => true);
  assert.deepEqual(raw, candidates, 'only explicit native mode skips filtering');
});

test('discovery drops late tag batches after a profile reset without starting further requests', { timeout: 5000 }, async () => {
  const R = require('../renderer/recommendation-profile');
  const gate = deferred(), started = deferred(), batches = []; let current = true, calls = 0;
  const { filterDiscoveryCandidates } = loader({ 'src/api/bili': { videoTags: async () => { calls++; if (calls === 4) started.resolve(); return gate.promise; } } })('src/screens/discoveryFeed.js');
  const result = filterDiscoveryCandidates(Array.from({ length: 8 }, (_, i) => ({ bvid: `BV${i}`, title: '未知' })),
    R.normalize({ auto: { tags: ['钢琴'] } }), (items) => batches.push(items), () => current);
  await started.promise;
  assert.equal(calls, 4);
  current = false; gate.resolve(['钢琴']);
  assert.deepEqual(await result, []);
  assert.deepEqual(batches, []);
  assert.equal(calls, 4);
});

test('discovery preserves successful matches and retries failed and unprocessed tags without caching failures', async () => {
  const calls = [], published = [];
  let offline = true, failure;
  const { filterDiscoveryCandidates } = loader({ 'src/api/bili': { videoTags: async (id) => {
    calls.push(id);
    if (id === '1' && offline) throw new Error('HTTP 429');
    return id === '2' ? ['游戏'] : ['丝袜'];
  } } })('src/screens/discoveryFeed.js');
  const snapshot = require('../renderer/recommendation-profile').normalize({ auto: { tags: ['丝袜'] } });
  const candidates = Array.from({ length: 6 }, (_, i) => ({ bvid: String(i), tid: 183, tname: '' }));
  await assert.rejects(filterDiscoveryCandidates(candidates, snapshot, (items) => published.push(...items), () => true), (error) => {
    failure = error; return /HTTP 429/.test(error.message);
  });
  assert.deepEqual(published.map((v) => v.bvid), ['0', '3']);
  assert.deepEqual(failure.retryCandidates.map((v) => v.bvid), ['1', '4', '5']);
  assert.deepEqual(calls, ['0', '1', '2', '3'], 'stop hammering metadata after a failed batch');
  offline = false;
  await filterDiscoveryCandidates(failure.retryCandidates, snapshot, (items) => published.push(...items), () => true);
  assert.deepEqual(published.map((v) => v.bvid), ['0', '3', '1', '4', '5']);
  assert.equal(calls.filter((id) => id === '1').length, 2);
});

test('discovery queue enrichment preserves native playback and allows automatic advance into appended recommendations', async () => {
  const listeners = {}; let replacements = 0;
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 180,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { replacements++; this.source = source; this.currentTime = 0; listeners.sourceLoad({ videoSource: source }); } };
  const { PlayerProvider, usePlayer } = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { listeners[name] = fn; } },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    'src/api/bili': { videoUrl: async (bvid) => 'https://cdn/' + bvid },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/PlayerContext.js');
  let context, tree;
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const [a, b, c] = ['A', 'B', 'C'].map((bvid) => ({ bvid, cid: 1, title: bvid }));
    await act(async () => context.playQueue([a, b], 1, 0, 'discovery'));
    await act(async () => listeners.timeUpdate({ currentTime: 0.25 }));
    player.currentTime = 23;
    await act(async () => listeners.timeUpdate({ currentTime: 23 }));
    const source = context.videoSource, replacementsBefore = replacements;
    await act(async () => context.syncDiscoveryQueue([b, c]));
    assert.equal(context.current.bvid, 'B'); assert.equal(context.index, 0);
    assert.equal(player.currentTime, 23); assert.equal(player.playing, true);
    assert.equal(replacements, replacementsBefore); assert.ok(context.videoSource === source);
    await act(async () => listeners.playToEnd());
    assert.equal(context.current.bvid, 'C', 'native completion sees the enriched queue');
    await act(async () => context.playQueue([a, b]));
    await act(async () => context.syncDiscoveryQueue([a, c]));
    assert.deepEqual(context.queue.map((item) => item.bvid), ['A', 'B'], 'discovery cannot replace another screen’s queue');
  } finally { await act(async () => tree.unmount()); }
});

test('discovery folders display cover collages and names on their animated front', async () => {
  let coverRenders = 0;
  let reactToRotation;
  function Cover(props) { coverRenders++; return React.createElement('Cover', props); }
  const { default: Wheel, DiscoveryWheelHaze } = loader({
    'react-native': rn,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useAnimatedStyle: (fn) => fn(), useDerivedValue: (fn) => ({ value: fn() }), withTiming: (value) => value,
      useAnimatedReaction: (prepare, react) => { reactToRotation = () => react(prepare(), null); }, runOnJS: (fn) => fn },
    'expo-linear-gradient': { LinearGradient: 'MaskGradient' },
    '@react-native-masked-view/masked-view': { __esModule: true, default: 'MaskedView' },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Defs: 'Defs', LinearGradient: 'Gradient', RadialGradient: 'RadialGradient', Rect: 'Rect', Path: 'Path', Pattern: 'Pattern', Stop: 'Stop' },
    'src/components/RemoteImage': { __esModule: true, default: Cover },
  })('src/screens/DiscoveryWheel.js');
  let tree;
  const props = { targets: [{ key: 'folder', title: '旅行收藏', subtitle: '4 个视频', covers: ['a', 'b', 'c', 'd', 'a'] }],
    height: 520, rotation: { value: 0 }, hover: { value: 0 }, visibility: { value: 1 } };
  await act(async () => { tree = create(React.createElement(Wheel, props)); });
  const fronts = tree.root.findAllByProps({ testID: 'discovery-folder-front' });
  const contents = tree.root.findAllByProps({ testID: 'discovery-folder-covers' });
  assert.equal(fronts.length, 2, 'the loop still contains two copies');
  assert.ok(fronts.every((front) => front.findAllByType('Text').some((node) => node.props.children === '旅行收藏')));
  assert.deepEqual(contents[0].findAllByType('Cover').map((node) => node.props.uri), ['a', 'b', 'c', 'd']);
  assert.equal(fronts[0].props.style[1].transform[1].rotateX, '-35deg');
  assert.equal(contents[0].props.style[1].transform[0].translateY, -10);
  const initialRenders = coverRenders;
  await act(async () => tree.update(React.createElement(Wheel, { ...props })));
  assert.equal(coverRenders, initialRenders, 'queue and playback renders do not rebuild identical folder collages');
  await act(async () => { tree.update(React.createElement(Wheel, { ...props, hover: { value: -1 } })); });
  assert.equal(tree.root.findAllByProps({ testID: 'discovery-folder-front' })[0].props.style[1].transform[1].rotateX, '0deg');
  const large = { ...props, open: false, targets: Array.from({ length: 200 }, (_, i) => ({ key: `folder${i}`, title: `收藏 ${i}`, covers: [`cover${i}`] })) };
  await act(async () => tree.update(React.createElement(Wheel, large)));
  assert.ok(tree.root.findAllByProps({ testID: 'discovery-folder-front' }).length <= 11, '200 folders do not mount 400 SVG collages');
  const warmRenders = coverRenders;
  await act(async () => tree.update(React.createElement(Wheel, { ...large, open: true })));
  assert.equal(coverRenders, warmRenders, 'opening reuses the prepared visible folders without rebuilding their images');
  await act(async () => { large.rotation.value = -90; reactToRotation(); });
  assert.ok(tree.root.findAllByType('Text').some((node) => node.props.children === '收藏 100'));
  assert.ok(tree.root.findAllByProps({ testID: 'discovery-folder-front' }).length <= 11);
  await act(async () => tree.unmount());
  const frost = { blurTarget: { current: null }, bounds: { top: -88, bottom: -190 }, width: 390,
    height: 520, count: 5, visibility: { value: 1 }, open: true };
  await act(async () => { tree = create(React.createElement(DiscoveryWheelHaze, frost)); });
  const mask = tree.root.findByType('MaskedView');
  let maskTree;
  await act(async () => { maskTree = create(mask.props.maskElement); });
  const radial = maskTree.root.findByType('RadialGradient');
  const { radius } = loader()('src/screens/discoveryGesture.js').wheelGeometry(frost.count, frost.height);
  assert.equal(radial.props.cx, 280 + radius - 52, 'frost and folder ring have the same offscreen center');
  assert.equal(radial.props.cy, 520 / 2 + 88, 'frost stays centered on the wheel despite the page-sized overlay');
  assert.equal(280 - (radial.props.cx - radial.props.r), (52 + 145) / 2, 'frost extends half as far inward from the screen edge');
  assert.equal(radial.findAllByType('Stop').at(-1).props.stopOpacity, '0', 'the outer arc fades to transparent');
  assert.equal(tree.root.findAllByType('BlurView').length, 1, 'the glass treatment reuses one live blur');
  assert.equal(tree.root.findByType('BlurView').props.tint, 'systemThinMaterialLight');
  await act(async () => tree.update(React.createElement(DiscoveryWheelHaze, { ...frost, open: false })));
  assert.equal(tree.root.findByType('BlurView').props.intensity, 0, 'prewarmed glass does not compute hidden blur');
  await act(async () => { tree.unmount(); maskTree.unmount(); });
});

test('discovery matches verified tags regardless of partition, title or missing partition names', async () => {
  const R = require('../renderer/recommendation-profile');
  const requested = [], partitionRequests = [];
  const realTags = { mac: ['软件应用'], bait: ['软件应用'], film: ['美女', '丝袜', '影视剪辑'],
    hiddenFilm: ['丝袜'], outfit: ['丝袜'], cosplay: ['COSPLAY'], broken: ['美女'], realFilm: ['影视剪辑'] };
  const { filterDiscoveryCandidates } = loader({ 'src/api/bili': {
    videoTags: async (id) => { requested.push(id); return realTags[id]; },
    view: async (id) => { partitionRequests.push(id); if (id === 'broken') throw new Error('offline');
      return { tname: id === 'hiddenFilm' ? '影视剪辑' : '日常' }; },
  } })('src/screens/discoveryFeed.js');
  const snapshot = R.normalize({ activeId: 'beauty', profiles: [{ id: 'beauty', name: '美女', tags: ['cos', '丝袜', '美女'] }] });
  const candidates = [
    { bvid: 'mac', title: 'macOS 软件推荐', tags: ['COS'] },
    { bvid: 'bait', title: 'COS丝袜软件', tags: ['丝袜'], discoveryOrigin: 'related' },
    { bvid: 'film', title: '角色出场', tname: '影视剪辑', discoveryOrigin: 'feed' },
    { bvid: 'hiddenFilm', title: '日常', discoveryOrigin: 'related' },
    { bvid: 'outfit', title: '今日穿搭', tname: '日常', discoveryOrigin: 'related' },
    { bvid: 'cosplay', title: '展会', tname: '日常', discoveryOrigin: 'feed' },
    { bvid: 'broken', title: '未知分区' },
  ];
  const result = await filterDiscoveryCandidates(candidates, snapshot, () => {}, () => true);
  assert.deepEqual(new Set(result.map((v) => v.bvid)), new Set(['film', 'hiddenFilm', 'outfit', 'cosplay', 'broken']));
  assert.equal(requested.length, candidates.length);
  assert.deepEqual(partitionRequests, [], 'matching tags never require a partition lookup');
  const movie = R.normalize({ activeId: 'movie', profiles: [{ id: 'movie', name: '影视美女', tags: ['美女', '影视剪辑'] }] });
  const permitted = await filterDiscoveryCandidates([{ bvid: 'film', tname: '影视剪辑' }], movie, () => {}, () => true);
  assert.equal(permitted.length, 1, 'explicit film interests continue to work');
});

test('mobile recommendation cards use Android HD pagination and retain player information', async () => {
  const calls = [], metadataCalls = [];
  const api = loader({ './client': {
    appGet: async (...args) => { calls.push(args); return { items: [
      { goto: 'av', bvid: 'BVnative', param: '1', cover: 'http://i0.hdslb.com/a.jpg', title: 'COS作品',
        args: { up_id: 7, up_name: '作者', tid: 174, tname: '日常' }, player_args: { aid: 1, cid: 2, duration: 18 }, idx: 11 },
      { goto: 'av', bvid: 'BVnative', player_args: { aid: 1 }, idx: 12 },
      { goto: 'av', param: '170001', can_play: 1, title: '旧版卡片', idx: 13 },
      { goto: 'av', bvid: 'BVad', ad_info: {}, player_args: { aid: 5 }, idx: 14 },
      { goto: 'live', param: '8', idx: 15 }, { goto: 'av', bvid: 'BVcharge', can_play: 0, idx: 16 },
    ] }; },
    get: async (url) => { metadataCalls.push(url); return { status: 200, body: JSON.stringify({ code: 0,
      data: { aid: 170001, bvid: 'BV17x411w7KC', owner: { name: '旧作者', mid: 8 } } }) }; },
  } })('src/api/bili.js');
  const result = await api.mobileRecommendations('10');
  assert.equal(calls[0][0], '/x/v2/feed/index');
  assert.equal(calls[0][1].device, 'pad'); assert.equal(calls[0][1].idx, 10);
  assert.equal(calls[0][1].mobi_app, 'android_hd');
  assert.equal(calls[0][1].pull, 'false');
  await api.mobileRecommendations();
  assert.equal(calls[1][1].idx, 0); assert.equal(calls[1][1].pull, 'true');
  assert.equal(result.nextIdx, '11', 'Android HD advances the page index, not card idx');
  assert.deepEqual(result.items.map((v) => v.bvid), ['BVnative', 'BV17x411w7KC']);
  assert.equal(result.items[0].cid, 2); assert.equal(result.items[0].duration, 18);
  assert.equal(result.items[0].tname, '日常'); assert.equal(result.items[0].tid, 174);
  assert.equal(result.items[0].up, '作者'); assert.equal(result.items[1].up, '');
  assert.equal(metadataCalls.length, 0, 'PiliPlus AV/BV conversion must not issue metadata requests');
});


function appAuthFixture(t, initial = { buvid3: 'visitor' }) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const state = { jar: JSON.stringify(initial), pollCode: 0, mid: '123', navCode: 0, rejectFeed: false,
    url: 'https://passport.bilibili.com/x/passport-tv-login/h5/qrcode/auth?auth_code=fixture',
    delayedPoll: null, delayedStore: null };
  const secrets = new Map(), calls = [];
  const makeClient = () => loader({
    '@react-native-async-storage/async-storage': { getItem: async () => state.jar, setItem: async (_, value) => { state.jar = value; } },
    'expo-secure-store': { getItemAsync: async (key) => secrets.get(key) || null,
      setItemAsync: async (key, value) => { if (state.delayedStore) await state.delayedStore.promise; secrets.set(key, value); },
      deleteItemAsync: async (key) => secrets.delete(key) },
  })('src/api/client.js');
  global.fetch = async (url, options) => {
    const uri = new URL(url), params = new URLSearchParams(options.body || uri.search), stage = uri.pathname.split('/').pop();
    calls.push(stage);
    let data = {}, code = 0;
    if (stage === 'key') {
      assert.equal(uri.pathname, '/x/passport-login/web/key'); data = { key: state.keyPem };
    } else if (stage === 'nav') {
      assert.match(options.headers.Cookie, /SESSDATA=(?:old-session|new%2Cweb%2Bsession%2Fvalue)/);
      code = state.navCode; data = { isLogin: code === 0, mid: Number(state.mid), uname: '测试用户', face: '//i0.hdslb.com/face.png' };
    } else {
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.credentials, 'omit');
      assert.equal(params.get('appkey'), 'dfca71928277209b');
      assert.equal(params.has('csrf'), false);
      assert.equal(options.headers['app-key'], 'android_hd');
      assert.match(options.headers['User-Agent'], /build\/2001100/);
      assert.match(options.headers.buvid, /^XY[0-9a-f]{35}$/);
      const signedQuery = (options.body || uri.search.slice(1)).split('&sign=')[0];
      assert.equal(params.get('sign'), fromMobile('js-md5')(signedQuery + 'b5475a8825547a4fc26c7d518eaaa02e'));
      assert.ok(!signedQuery.includes('+'), 'signing uses URI components, not form-encoded spaces');
      if (stage === 'auth_code') {
        assert.equal(options.method, 'POST'); assert.equal(params.get('mobi_app'), 'android_hd');
        data = { auth_code: 'fixture-code', url: state.url, expires_in: 180 };
      } else if (stage === 'send') {
        assert.equal(uri.pathname, '/x/passport-login/sms/send'); assert.equal(params.get('tel'), '13800000000');
        if (state.smsChallenge && !params.get('gee_validate')) {
          code = -105; data = { recaptcha_url: 'https://passport.bilibili.com/captcha?gee_gt=fixture-gt&gee_challenge=fixture-challenge&recaptcha_token=fixture-recaptcha' };
        } else {
          if (state.smsChallenge) {
            assert.equal(params.get('gee_validate'), 'fixture-validate');
            assert.equal(params.get('recaptcha_token'), 'fixture-recaptcha');
          }
          data = { captcha_key: 'fixture-sms-ticket', recaptcha_url: '' };
        }
      } else if (stage === 'poll' || stage === 'sms') {
        assert.equal(options.method, 'POST');
        if (stage === 'poll') assert.equal(params.get('auth_code'), 'fixture-code');
        else {
          assert.equal(uri.pathname, '/x/passport-login/login/sms');
          assert.equal(params.get('captcha_key'), 'fixture-sms-ticket'); assert.equal(params.get('code'), '123456');
          const forge = fromMobile('node-forge');
          assert.match(state.privateKey.decrypt(forge.util.decode64(decodeURIComponent(params.get('dt')))), /^[0-9a-f]{16}$/);
        }
        if (state.delayedPoll) await state.delayedPoll.promise;
        code = state.pollCode;
        data = { token_info: { mid: Number(state.mid), access_token: 'fixture-app-token', expires_in: 86400 },
          cookie_info: { cookies: [ { name: 'SESSDATA', value: 'new,web+session/value' },
            { name: 'bili_jct', value: 'new-csrf' }, { name: 'DedeUserID', value: state.mid } ] } };
      } else {
        assert.equal(uri.origin, 'https://app.bilibili.com'); assert.equal(stage, 'index');
        assert.equal(params.get('access_key'), 'fixture-app-token');
        if (params.has('splash_id')) assert.match(signedQuery, /(?:^|&)splash_id&/, 'empty values follow PiliPlus signing');
        code = state.rejectFeed ? -101 : 0; data = { items: [] };
      }
    }
    return { status: 200, headers: { getSetCookie: () => stage === 'nav' ? [] : ['SESSDATA=unwanted; Domain=.bilibili.com'] },
      text: async () => JSON.stringify({ code, data }) };
  };
  return { state, secrets, calls, makeClient };
}

test('first App login persists matching Web and Android HD credentials and restart needs no extra grant', async (t) => {
  const f = appAuthFixture(t), client = f.makeClient();
  await assert.rejects(client.appGet('/x/v2/feed/index'), /请先/);
  assert.deepEqual(f.calls, []);
  const grant = await client.startAppAuthorization({ login: true });
  f.state.pollCode = 86039;
  assert.deepEqual(await client.pollAppAuthorization(grant), { status: 'waiting' });
  f.state.pollCode = 86090;
  assert.deepEqual(await client.pollAppAuthorization(grant), { status: 'scanned' });
  assert.equal(f.secrets.size, 0);
  f.state.pollCode = 0;
  const result = await client.pollAppAuthorization(grant);
  assert.equal(result.status, 'authorized');
  assert.equal(result.auth.mid, 123); assert.equal(result.auth.uname, '测试用户');
  assert.equal(result.auth.face, 'https://i0.hdslb.com/face.png');
  assert.equal(JSON.parse(f.state.jar).SESSDATA, 'new,web+session/value');
  assert.doesNotMatch(f.state.jar, /fixture-app-token/, 'App token is only in SecureStore');
  const saved = JSON.parse(f.secrets.get('biu.bili-app.123'));
  assert.equal(saved.appkey, 'dfca71928277209b'); assert.equal(saved.mid, '123');
  await Promise.all([client.appGet('/x/v2/feed/index', { splash_id: '', search: 'space value' }), client.appGet('/x/v2/feed/index')]);
  await f.makeClient().appGet('/x/v2/feed/index');
  assert.equal(f.calls.filter((v) => v === 'auth_code').length, 1);
  assert.ok(!f.calls.includes('confirm'), 'no rejected Cookie-to-App confirmation endpoint');
  await client.logout();
  assert.equal(f.secrets.size, 0);
  const count = f.calls.length;
  await assert.rejects(client.appGet('/x/v2/feed/index'), /请先/);
  assert.equal(f.calls.length, count, 'logout cannot fall back to anonymous or Web recommendations');
});

test('legacy web accounts approve App access once; wrong accounts, expiry and revoked tokens cannot silently downgrade', async (t) => {
  const f = appAuthFixture(t, { buvid3: 'visitor', SESSDATA: 'old-session', DedeUserID: '123', bili_jct: 'csrf' });
  const client = f.makeClient();
  f.secrets.set('biu.bili-app.123', JSON.stringify({ token: 'old-TV-token', expiresAt: Date.now() + 86400000 }));
  await assert.rejects(client.appGet('/x/v2/feed/index'), { code: 'APP_AUTH_REQUIRED' });
  assert.deepEqual(f.calls, [], 'legacy TV credentials are not used with Android HD keys');
  f.secrets.clear();
  const grant = await client.startAppAuthorization();
  f.state.mid = '456';
  await assert.rejects(client.pollAppAuthorization(grant), /相同的 B 站账号/);
  assert.equal(f.secrets.size, 0);
  f.state.mid = '123';
  await client.pollAppAuthorization(grant);
  assert.equal(JSON.parse(f.state.jar).SESSDATA, 'old-session', 'supplemental authorization preserves the current web session');
  await client.appGet('/x/v2/feed/index');
  f.state.rejectFeed = true;
  await assert.rejects(client.appGet('/x/v2/feed/index'), { code: 'APP_AUTH_REQUIRED' });
  assert.equal(f.secrets.size, 0);
  assert.equal(f.calls.filter((v) => v === 'auth_code').length, 1, 'rejected tokens require real App approval');
  f.state.rejectFeed = false;
  await client.pollAppAuthorization(grant);
  const saved = JSON.parse(f.secrets.get('biu.bili-app.123')); saved.expiresAt = Date.now();
  f.secrets.set('biu.bili-app.123', JSON.stringify(saved));
  const count = f.calls.length;
  await assert.rejects(client.appGet('/x/v2/feed/index'), /已到期/);
  assert.equal(f.calls.length, count);
});

test('cancelled, expired, unverified and late App grants never publish a partial login', async (t) => {
  const f = appAuthFixture(t), client = f.makeClient();
  f.state.url = 'https://bilibili.com.attacker.test/';
  await assert.rejects(client.startAppAuthorization({ login: true }), /授权地址无效/);
  f.state.url = 'https://passport.bilibili.com/auth';
  const controller = new AbortController();
  const grant = await client.startAppAuthorization({ login: true, signal: controller.signal });
  f.state.pollCode = 86038;
  assert.deepEqual(await client.pollAppAuthorization(grant), { status: 'expired' });
  f.state.pollCode = 0; f.state.navCode = -101;
  await assert.rejects(client.pollAppAuthorization(grant), /校验登录账号/);
  assert.equal(f.secrets.size, 0); assert.equal(JSON.parse(f.state.jar).SESSDATA, undefined);
  f.state.navCode = 0; f.state.delayedPoll = deferred();
  const pending = client.pollAppAuthorization(grant);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(); f.state.delayedPoll.resolve(); await rejected;
  assert.equal(f.secrets.size, 0);
  f.state.delayedPoll = null; f.state.delayedStore = deferred();
  const lateGrant = await client.startAppAuthorization({ login: true });
  const late = client.pollAppAuthorization(lateGrant);
  const lateRejected = assert.rejects(late, /账号已切换/);
  await new Promise((resolve) => setImmediate(resolve));
  const logout = client.logout();
  await new Promise((resolve) => setImmediate(resolve));
  f.state.delayedStore.resolve();
  await Promise.all([lateRejected, logout]);
  assert.equal(f.secrets.size, 0); assert.equal(JSON.parse(f.state.jar).SESSDATA, undefined);
});

test('App login sheet opens Bilibili, resumes polling on return and cancels stale grants', async () => {
  const listeners = new Set(), opened = [], controllers = [];
  let polls = 0, approved = 0, closed = 0, result = { status: 'waiting' }, delayed = null;
  const appState = { currentState: 'active', addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };
  const Auth = loader({
    'react-native': { ...rn, AppState: appState, Linking: { openURL: async (url) => opened.push(url) } },
    'src/components/Dialog': { Dialog: ({ children }) => React.createElement('Dialog', {}, children) },
    'src/api/client': {
      startAppAuthorization: async ({ signal, login }) => {
        assert.equal(login, true); controllers.push(signal);
        return { url: 'https://passport.bilibili.com/auth?auth_code=fixture' };
      },
      pollAppAuthorization: async () => { polls++; if (delayed) await delayed.promise; return result; },
    },
  })('src/components/AppRecommendationAuth.js').default;
  let tree;
  const render = () => React.createElement(Auth, { login: true, onClose: () => closed++, onAuthorized: () => approved++ });
  await act(async () => { tree = create(render()); });
  assert.equal(polls, 1);
  await click(tree, '打开 B 站授权');
  assert.equal(opened[0], 'bilibili://browser?url=' + encodeURIComponent('https://passport.bilibili.com/auth?auth_code=fixture'));
  result = { status: 'expired' };
  await act(async () => { for (const listener of listeners) listener('active'); });
  assert.equal(tree.root.findAllByType('QrCode').length, 0);
  result = { status: 'waiting' };
  await click(tree, '刷新授权二维码');
  assert.equal(controllers[0].aborted, true);
  assert.equal(controllers.length, 2);
  result = { status: 'authorized', auth: { isLogin: true, mid: 123 } };
  await act(async () => { for (const listener of listeners) listener('active'); });
  assert.equal(approved, 1);
  await act(async () => tree.unmount());
  assert.equal(listeners.size, 0);
  result = { status: 'authorized' }; delayed = deferred();
  await act(async () => { tree = create(render()); });
  await click(tree, '取消 App 授权');
  assert.equal(closed, 1); assert.equal(controllers.at(-1).aborted, true);
  await act(async () => { delayed.resolve(); });
  assert.equal(approved, 1, 'a late response after dismissal cannot sign in');
  await act(async () => tree.unmount());
});

test('Mine first login offers shared App credentials and switches to the verified account', async () => {
  const switched = [];
  const context = { likes: [], history: [], account: { isLogin: false }, switchAccount: async (a) => switched.push(a) };
  const Mine = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    'src/player/PlayerContext': { usePlayer: () => context },
    'src/store/playlists': { usePlaylists: () => [] },
    'src/api/bili': {}, 'src/api/client': {},
    'src/components/BiliLogin': (props) => React.createElement('AppGrant', props),
    'src/components/DefaultCover': () => null, 'src/components/RemoteImage': () => null, 'src/components/icons': iconMock,
  })('src/screens/MineScreen.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Mine, { navigation: { navigate() {} } })); });
  await click(tree, '登录');
  const grant = tree.root.findByType('AppGrant');
  const auth = { isLogin: true, mid: 123, uname: '测试用户' };
  await act(async () => grant.props.onAuthorized(auth));
  assert.deepEqual(switched, [auth]);
  assert.equal(tree.root.findAllByType('AppGrant').length, 0);
  await act(async () => tree.unmount());
});

test('App SMS login handles Geetest and obtains both credentials without Cookie-to-token conversion', async (t) => {
  const f = appAuthFixture(t), client = f.makeClient();
  const forge = fromMobile('node-forge');
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  f.state.keyPem = forge.pki.publicKeyToPem(keys.publicKey); f.state.privateKey = keys.privateKey;
  f.state.smsChallenge = true;
  const challenge = await client.smsSend({ tel: '13800000000' });
  assert.equal(challenge.captcha.gt, 'fixture-gt');
  assert.equal(f.secrets.size, 0);
  const sent = await client.smsSend({ tel: '13800000000', captcha: { ...challenge.captcha, validate: 'fixture-validate', seccode: 'fixture-seccode' } });
  assert.equal(sent.captchaKey, 'fixture-sms-ticket');
  const loggedIn = await client.smsLogin({ tel: '13800000000', code: '123456', captchaKey: sent.captchaKey });
  assert.equal(loggedIn.auth.mid, 123);
  await client.appGet('/x/v2/feed/index');
  await f.makeClient().appGet('/x/v2/feed/index');
  assert.equal(f.calls.includes('auth_code'), false, 'SMS login never asks for a second QR authorization');
  assert.equal(f.calls.includes('confirm'), false);
  assert.equal(f.secrets.size, 1);
  assert.equal(JSON.parse(f.state.jar).DedeUserID, '123');
  await client.logout();
  assert.equal(f.secrets.size, 0);
  const controller = new AbortController(); f.state.delayedPoll = deferred();
  const pending = client.smsLogin({ tel: '13800000000', code: '123456', captchaKey: sent.captchaKey, signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(); f.state.delayedPoll.resolve(); await rejected;
  assert.equal(f.secrets.size, 0);
});

test('login offers SMS with Geetest and countdown, and switching to App login cancels pending SMS', async () => {
  const signals = [], sends = [], logged = [];
  let needsCaptcha = true, startApp = 0, smsSubmits = 0;
  const Login = loader({
    'react-native': rn,
    'src/components/Dialog': { Dialog: ({ children }) => React.createElement('Dialog', {}, children) },
    'src/components/GeetestModal': (props) => React.createElement('Geetest', props),
    'src/components/AppRecommendationAuth': (props) => { startApp++; return React.createElement('AppGrant', props); },
    'src/api/client': {
      smsSend: async (args) => {
        signals.push(args.signal); sends.push(args);
        return needsCaptcha ? { captcha: { gt: 'gt', challenge: 'challenge', token: 'token' } } : { captchaKey: 'ticket' };
      },
      smsLogin: async (args) => { smsSubmits++; signals.push(args.signal); return { auth: { isLogin: true, mid: 123 } }; },
    },
  })('src/components/BiliLogin.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Login, { onClose() {}, onAuthorized: (auth) => logged.push(auth) })); });
  const input = (label) => tree.root.findAllByType('TextInput').find((n) => n.props.accessibilityLabel === label);
  await act(async () => input('手机号').props.onChangeText('13800000000'));
  await click(tree, '获取验证码');
  const gt = tree.root.findByType('Geetest'); needsCaptcha = false;
  await act(async () => gt.props.onResult({ geetest_validate: 'validate', geetest_seccode: 'seccode' }));
  assert.equal(sends.length, 2); assert.equal(sends[1].captcha.token, 'token');
  assert.equal(touch(tree, '获取验证码').props.disabled, true, 'successful sends start the cooldown');
  await act(async () => input('短信验证码').props.onChangeText('123456'));
  await click(tree, '验证码登录');
  assert.equal(smsSubmits, 1); assert.equal(logged[0].mid, 123);
  await act(async () => input('手机号').props.onChangeText('13900000000'));
  await click(tree, '验证码登录');
  assert.equal(smsSubmits, 1, 'a captcha ticket cannot be used for a different phone number');
  await click(tree, '使用 B 站 App 登录');
  assert.equal(startApp, 1); assert.ok(signals.every((signal) => signal.aborted));
  const app = tree.root.findByType('AppGrant'); assert.equal(app.props.login, true);
  await act(async () => app.props.onUseSms());
  assert.equal(tree.root.findAllByType('AppGrant').length, 0);
  assert.equal(input('手机号').props.value, '');
  await act(async () => tree.unmount());
});

test('discovery queue cache is account/profile scoped, bounded and never extends stale verification', async () => {
  const values = new Map();
  const cache = loader({ '@react-native-async-storage/async-storage': {
    getItem: async (key) => values.get(key) || null, setItem: async (key, value) => values.set(key, value),
  } })('src/screens/discoveryQueue.js');
  const profile = require('../renderer/recommendation-profile').normalize({ activeId: 'beauty', profiles: [{ id: 'beauty', name: '美女', tags: ['美女'] }] });
  const tracks = Array.from({ length: 40 }, (_, i) => ({ bvid: `BVcache${i}`, tags: ['美女'], tname: '日常',
    discoveryVerifiedAt: Date.now(), url: 'https://private-media', access_key: 'private-token' }));
  values.set('biu.discovery-queue@123', JSON.stringify({ version: 1, selection: JSON.stringify([profile.activeId, profile.profiles[0].tags]), at: Date.now(), tracks }));
  assert.deepEqual(await cache.readDiscoveryQueue('123', profile), [], 'switching to Web does not restore the App queue');
  await cache.writeDiscoveryQueue('123', profile, tracks);
  assert.equal((await cache.readDiscoveryQueue('123', profile)).length, 32);
  assert.deepEqual(await cache.readDiscoveryQueue('123', profile, 'music'), [], 'all-partition queue cannot leak into music discovery');
  assert.doesNotMatch(values.get('biu.discovery-queue.web@123'), /private-media|private-token/);
  assert.deepEqual(await cache.readDiscoveryQueue('456', profile), []);
  assert.deepEqual(await cache.readDiscoveryQueue('123', { ...profile, enabled: false }), []);
  assert.deepEqual(await cache.readDiscoveryQueue('123', { ...profile, profiles: [{ id: 'beauty', tags: ['钢琴'] }] }), []);
  const arranged = tracks.slice(0, 4).map((track, i) => ({ ...track, mid: i < 3 ? 1 : 2,
    discoveryOrigin: 'focused', relatedFocus: 'BVanchor' }));
  await cache.writeDiscoveryQueue('123', profile, arranged);
  const restored = await cache.readDiscoveryQueue('123', profile);
  assert.deepEqual(restored.map((track) => track.bvid), arranged.map((track) => track.bvid), 'verification must not reorder a related run by UP diversity');
  assert.ok(restored.every((track) => track.relatedFocus === 'BVanchor'));
  tracks[0].discoveryVerifiedAt = Date.now() - 600001;
  await cache.writeDiscoveryQueue('123', profile, [tracks[0]]);
  assert.deepEqual(await cache.readDiscoveryQueue('123', profile), [], 'saving again does not renew old video verification');
});

test('discovery folder covers persist across module restarts, stay account scoped and refresh changed or expired folders', async () => {
  const disk = new Map();
  const restart = () => loader({ '@react-native-async-storage/async-storage': {
    getItem: async (key) => disk.get(key) || null, setItem: async (key, value) => disk.set(key, value),
  } })('src/screens/discoveryFolders.js');
  const cache = restart(), folder = { id: 7, title: '收藏', count: 9, pic: 'cover' };
  const entry = cache.folderCoverEntry(folder, ['a', 'b', 'a', 'c', 'd', 'e']);
  await cache.writeDiscoveryFolders({ scope: '123', folders: [folder], covers: { 7: entry, 8: entry } });
  const fresh = restart(), restored = await fresh.readDiscoveryFolders('123');
  assert.deepEqual(restored.covers[7].uris, ['a', 'b', 'c', 'd']);
  assert.equal(restored.covers[8], undefined, 'removed folders do not leave cover records');
  assert.equal(fresh.folderCoverFresh(restored.covers[7], folder), true);
  assert.equal(fresh.folderCoverFresh(entry, { ...folder, count: 10 }), false);
  assert.equal(fresh.folderCoverFresh(entry, { ...folder, pic: 'changed' }), false);
  assert.deepEqual((await fresh.readDiscoveryFolders('456')).folders, []);
  entry.at = Date.now() - 86400001;
  await fresh.writeDiscoveryFolders({ scope: '123', folders: [folder], covers: { 7: entry } });
  assert.deepEqual((await restart().readDiscoveryFolders('123')).covers[7].uris, ['a', 'b', 'c', 'd'], 'expired collages remain available while revalidating');
  assert.equal(fresh.folderCoverFresh(entry, folder), false);
  disk.set('biu.discovery-folders@123', 'invalid json');
  assert.deepEqual((await fresh.readDiscoveryFolders('123')).folders, []);
});

test('discovery builds a 24-card verified buffer and continues beyond empty pages without replacing the active card', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let focused = true, refresh, tree, starts = 0;
  const pages = [], feedSignals = [], tagSignals = [], observed = [];
  const navigationListeners = new Map();
  const navigation = { addListener(name, callback) { navigationListeners.set(name, callback); return () => navigationListeners.delete(name); } };
  let tagsOffline = true, emptyFeed = false;
  let pauseProbe = false, feedGate, tagGate, relatedGate;
  const tagRequests = [];
  const profile = { ...require('../renderer/recommendation-profile').normalize({ activeId: 'beauty',
    profiles: [{ id: 'beauty', name: '美女', tags: ['美女'] }] }), ready: true, revision: 1 };
  const context = { account: { isLogin: false }, likes: [], libraryTracks: [], playing: true, queueSource: 'discovery',
    player: {}, current: null, queue: [], discoveryRecommendationProfile: profile,
    discoveryRecommendationManager: { ready: async () => {}, getSnapshot: () => profile, observeFeed: items => observed.push(items) },
    syncDiscoveryQueue(tracks) { context.queue = tracks; }, resume() {},
    playQueue(tracks, index) { starts++; context.queue = tracks; context.current = tracks[index];
      context.videoSource = { key: tracks[index].bvid }; refresh((n) => n + 1); },
  };
  const gesture = () => {
    const item = {};
    for (const name of ['minDistance', 'maxDistance', 'maxPointers', 'minDuration', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) item[name] = () => item;
    return item;
  };
  const Screen = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', Gesture: { Pan: gesture, Tap: gesture, LongPress: gesture, Race: (...g) => g } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: (value) => React.useRef({ value }).current, useAnimatedStyle: (fn) => fn(),
      useFrameCallback: () => React.useRef({ setActive() {} }).current,
      cancelAnimation() {}, runOnJS: (fn) => fn, runOnUI: (fn) => fn, withSpring: (v) => v, withTiming: (v) => v },
    'expo-video': { VideoView: 'VideoView' }, 'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'src/screens/DiscoveryWheel': { __esModule: true, default: 'Wheel', DiscoveryWheelHaze: 'WheelHaze' }, 'src/components/RemoteImage': () => null,
    'src/components/Overlay': 'Overlay',
    'src/components/BottomSheet': () => null, 'src/components/icons': iconMock,
    'src/updates/networkGate': { yieldToInput: async () => {} },
    'src/player/discoveryPreload': { clearDiscoveryPreloads() {}, preloadDiscoveryQueue() {} },
    'src/store/playlists': { usePlaylists: () => [] },
    'src/player/PlayerContext': { usePlayer: () => { [, refresh] = React.useState(0); return context; } },
    'src/api/bili': {
      personalizedRecommendations: async (cursor, limit, options) => {
        feedSignals.push(options.signal);
        assert.equal(limit, 30, 'discovery requests full Web pages');
        const page = Number(cursor || 0); pages.push(page);
        if (feedGate) await feedGate.promise;
        if (emptyFeed) return [{ bvid: `BVnone${page}`, tags: ['美女'] }];
        const count = pauseProbe ? 12 : page < 4 ? 3 : page < 12 ? 0 : page === 12 ? 12 : 14;
        return [
          ...Array.from({ length: count }, (_, i) => ({ bvid: `BV${pauseProbe ? 'paused' : 'page'}${page}item${i}`, title: '穿搭', tname: '日常' })),
          { bvid: `BVmovie${page}`, title: '影视片段', tname: '影视剪辑', tags: ['美女'] },
        ];
      },
      videoTags: async (id, options) => {
        tagSignals.push(options.signal);
        tagRequests.push(id);
        if (tagGate) await tagGate.promise;
        if (tagsOffline) throw new Error('HTTP 429');
        return id.startsWith('BVmovie') ? ['影视剪辑'] : id.startsWith('BVnone') ? ['游戏'] : ['美女'];
      }, relatedVideos: async () => {
        if (!relatedGate) return [];
        await relatedGate.promise;
        return Array.from({ length: 4 }, (_, i) => ({ bvid: `BVpausedRelated${i}`, title: '穿搭' }));
      },
    },
  })('src/screens/DiscoveryScreen.js').default;
    await act(async () => { tree = create(React.createElement(Screen, { navigation })); });
    await act(async () => t.mock.timers.tick(32));
  assert.deepEqual(pages, [0]); assert.equal(starts, 0);
  assert.match(JSON.stringify(tree.toJSON()), /视频信息核验失败.*HTTP 429/);
  await act(async () => t.mock.timers.tick(60000));
  assert.deepEqual(pages, [0], 'metadata failure stops the refill spinner and automatic requests');
  tagsOffline = false;
  await click(tree, '重新获取推荐');
  assert.equal(observed.length, 1, 'only one profile write for a multi-page refill');
  assert.equal(observed[0].length, 12, 'rejected candidates never trigger profile writes');
  const initial = context.current.bvid;
  assert.equal(context.queue.length, 12); assert.deepEqual(pages, [0, 1, 2, 3]);
  assert.equal(starts, 1, 'the first batch plays before the target buffer is filled');
  assert.equal(tree.root.findAllByType('Wheel').length, 0);
  await act(async () => t.mock.timers.tick(350));
  const preparedWheel = tree.root.findByType('Wheel');
  const blurTarget = tree.root.findByType('BlurTargetView');
  const haze = tree.root.findByType('WheelHaze');
  const wheelOverlay = tree.root.findByType('Overlay');
  assert.equal(wheelOverlay.props.active, false, 'the wheel visual portal must not acquire navigation input');
  assert.equal(wheelOverlay.findByType('WheelHaze'), haze, 'frost clears the navigation chrome through the portal');
  assert.equal(wheelOverlay.findByType('Wheel'), preparedWheel, 'folders share the portal and remain above the glass');
  assert.equal(haze.props.blurTarget, blurTarget.props.ref, 'blur samples the fixed page-sized target');
  const samplingBounds = Object.assign({}, ...blurTarget.props.style);
  assert.ok(samplingBounds.top < 0 && samplingBounds.bottom < 0, 'sampling extends past both stage boundaries');
  assert.equal(haze.props.bounds.top, samplingBounds.top, 'blur and sampling share the extended top boundary');
  assert.equal(haze.props.bounds.bottom, samplingBounds.bottom, 'blur and sampling share the extended bottom boundary');
  const cardRegion = tree.root.findByProps({ testID: 'discovery-blur-card-region' });
  const cardRegionBounds = Object.assign({}, ...cardRegion.props.style);
  assert.equal(cardRegionBounds.top + samplingBounds.top, 0, 'expanding sampling preserves the card origin');
  assert.equal(cardRegionBounds.bottom + samplingBounds.bottom, 0, 'expanding sampling preserves the card height');
  assert.equal(blurTarget.findAllByType('WheelHaze').length, 0, 'blur must not sample its own overlay');
  assert.equal(blurTarget.findAllByType('GestureDetector').length, 0, 'native sampling never owns a gesture handler');
  const cardFrame = tree.root.findAllByType('AnimatedView').find(n => n.props.testID === 'discovery-card');
  assert.ok(wheelOverlay.findAllByType('AnimatedView').includes(cardFrame), 'card and frost share a portal so native stacking can raise the card');
  assert.equal(tree.root.findByProps({ testID: 'discovery-card-gesture-region' }).findAllByType('BlurTargetView').length, 0,
    'input stays in the page when the visual card moves to the portal');
  assert.equal(cardFrame.findAllByType('WheelHaze').length, 0, 'wheel blur must not shrink or move with the card');
  assert.ok(!Object.hasOwn(samplingBounds, 'transform'), 'the sampling coordinates stay fixed while dragging');
  assert.equal(haze.props.open, false, 'idle preparation leaves native blur disabled');
  assert.equal(preparedWheel.props.open, false, 'the bounded window is prepared while the card is idle');
  await click(tree, '打开收藏轮盘');
  assert.equal(tree.root.findByType('WheelHaze').props.open, true);
  assert.equal(tree.root.findByType('Wheel'), preparedWheel, 'right-drag opening needs no cold mount');
  await click(tree, '关闭收藏轮盘');
  assert.equal(tree.root.findByType('Wheel'), preparedWheel);
  await act(async () => { focused = false; refresh((n) => n + 1); });
  await act(async () => t.mock.timers.tick(10000));
  assert.equal(pages.length, 4, 'inactive discovery stops refill timers');
  await act(async () => { focused = true; refresh((n) => n + 1); });
    await act(async () => t.mock.timers.tick(32));
  await act(async () => t.mock.timers.tick(1500));
  assert.equal(pages.length, 8); assert.equal(context.queue.length, 12);
  await act(async () => t.mock.timers.tick(3000));
  assert.equal(pages.length, 12);
  await act(async () => t.mock.timers.tick(6000));
  assert.equal(context.queue.length, 24); assert.deepEqual(pages, Array.from({ length: 13 }, (_, i) => i));
  assert.equal(context.current.bvid, initial); assert.equal(starts, 1);
  assert.ok(!context.queue.some((track) => track.bvid.startsWith('BVmovie')), 'nonmatching verified tags stay excluded even if the App card label matches');
  await act(async () => { context.current = context.queue[14]; context.videoSource = { key: context.current.bvid }; refresh((n) => n + 1); });
  await act(async () => t.mock.timers.tick(0));
  assert.equal(pages.at(-1), 13, 'refill starts before the user reaches the last card');
  assert.equal(context.queue.length, 38);
  await act(async () => tree.unmount());

  emptyFeed = true; pages.length = 0; context.current = null; context.queue = []; context.videoSource = null;
  await act(async () => { tree = create(React.createElement(Screen, { navigation })); });
  for (const delay of [3000, 6000, 12000]) await act(async () => t.mock.timers.tick(delay));
  assert.equal(pages.length, 16);
  assert.match(JSON.stringify(tree.toJSON()), /已检查 16 条推荐，最近几批未命中画像标签/);
  await act(async () => t.mock.timers.tick(60000));
  assert.equal(pages.length, 16, 'genuinely empty results do not spin forever');
  await click(tree, '重新获取推荐');
  assert.equal(pages[16], 16, 'manual continuation preserves the page cursor');
  await act(async () => tree.unmount());

  // Simulate switching tabs while native requests are still in flight.
  emptyFeed = false; pauseProbe = true; focused = false;
  pages.length = 0; tagRequests.length = 0; context.current = null; context.queue = []; context.videoSource = null;
  feedGate = deferred(); relatedGate = deferred();
  await act(async () => { tree = create(React.createElement(Screen, { navigation })); });
  assert.equal(pages.length, 0, 'an inactive mount does not start the discovery crawl');
  await act(async () => { focused = true; refresh((n) => n + 1); });
    await act(async () => t.mock.timers.tick(32));
  assert.deepEqual(pages, [0]);
  await act(async () => { focused = false; navigationListeners.get('blur')(); assert.equal(feedSignals.at(-1).aborted, false); t.mock.timers.tick(0); assert.equal(feedSignals.at(-1).aborted, true); refresh((n) => n + 1); });
  const abortedFeed = feedGate;
  assert.equal(tagRequests.length, 0);
  assert.equal(context.queue.length, 0);
  feedGate = null; tagGate = deferred();
  await act(async () => { focused = true; refresh((n) => n + 1); });
    await act(async () => t.mock.timers.tick(32));
  await act(async () => t.mock.timers.tick(0));
  assert.deepEqual(pages, [0, 0], 'an aborted page is retried without waiting for its old transport');
  assert.equal(tagRequests.length, 4);
  await act(async () => abortedFeed.resolve());
  assert.equal(tagRequests.length, 4, 'the late old response cannot start more checks after returning');
  await act(async () => { focused = false; navigationListeners.get('blur')(); t.mock.timers.tick(0); assert.equal(tagSignals.at(-1).aborted, true); refresh((n) => n + 1); });
  await act(async () => { tagGate.resolve(); });
  assert.equal(tagRequests.length, 4, 'blur finishes only the four in-flight tag requests, with no following batches');
  assert.equal(context.queue.length, 0, 'late tag results cannot update the global playback queue');
  tagGate = null;
  await act(async () => { focused = true; refresh((n) => n + 1); });
    await act(async () => t.mock.timers.tick(32));
  await act(async () => t.mock.timers.tick(0));
  assert.deepEqual(pages, [0, 0, 1]);
  assert.equal(context.queue.length, 24, 'paused candidate checks resume without losing the page');
  assert.equal(new Set(context.queue.map((item) => item.bvid)).size, 24);
  assert.equal(context.queue.filter((item) => item.bvid.startsWith('BVpaused0')).length, 12);
  tagGate = deferred();
  const beforeRelated = tagRequests.length;
  await act(async () => relatedGate.resolve());
  assert.equal(tagRequests.length, beforeRelated + 4);
  await act(async () => { focused = false; refresh((n) => n + 1); });
  await act(async () => tagGate.resolve());
  assert.equal(context.queue.length, 24, 'related tag results also stop publishing after blur');
  tagGate = null;
  await act(async () => { focused = true; refresh((n) => n + 1); });
    await act(async () => t.mock.timers.tick(32));
  assert.equal(context.queue.filter((item) => item.bvid.startsWith('BVpausedRelated')).length, 4,
    'paused related checks remain eligible on return instead of being lost in the seen set');
  await act(async () => tree.unmount());
});

test('mobile request deadlines cover stalled bodies and transports that ignore abort, then allow a fresh request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const client = loader({ '@react-native-async-storage/async-storage': {
    getItem: async () => JSON.stringify({ buvid3: 'visitor' }), setItem: async () => {},
  } })('src/api/client.js');
  await client.initClient();
  for (const kind of ['text', 'bytes', 'post', 'headers']) {
    let signal;
    global.fetch = async (_url, options) => {
      signal = options.signal;
      if (kind === 'headers') return new Promise(() => {});
      return { status: 200, headers: { get: () => null },
        text: () => new Promise(() => {}), arrayBuffer: () => new Promise(() => {}) };
    };
    const pending = kind === 'post' ? client.post('https://api.bilibili.com/probe', {}, { timeout: 100 })
      : client.get('https://api.bilibili.com/probe', { timeout: 100, responseType: kind });
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(101);
    const result = await pending;
    assert.equal(result.status, -1, kind); assert.match(result.body, /超时/);
    assert.equal(signal.aborted, true);
  }
  global.fetch = async () => ({ status: 200, headers: { get: () => null }, text: async () => '{"code":0}' });
  assert.equal((await client.get('https://api.bilibili.com/probe')).body, '{"code":0}');
});

test('discovery abandons a stalled speculative decoder and uses its URL for normal foreground playback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const installation = deferred(); let released = 0;
  const cache = loader({
    'expo-video': { createVideoPlayer: () => ({ addListener: () => ({ remove() {} }),
      replaceAsync: () => installation.promise, release: () => { released++; } }) },
    'src/api/bili': { videoUrl: async () => 'https://cdn/ready.mp4' },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/discoveryPreload.js');
  const track = { bvid: 'BVblocked', cid: 1 };
  cache.preloadDiscoveryQueue([track], 1, '123');
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(32);
  await new Promise((resolve) => setImmediate(resolve));
  const pending = cache.takeDiscoveryPreload(track, 1, '123');
  t.mock.timers.tick(751);
  const source = await pending;
  assert.equal(source.uri, 'https://cdn/ready.mp4'); assert.equal(source.player, undefined);
  assert.equal(released, 1);
  installation.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.takeDiscoveryPreload(track, 1, '123'), null, 'late installation cannot resurrect the consumed decoder');
});

test('home music publishes available cards ahead of slow details and reports a metadata outage', async () => {
  const slow = deferred(), batches = [];
  let offline = false;
  const api = loader({ './client': { get: async (url) => {
    let data;
    if (url.includes('/feed/rcmd')) data = { item: ['slow', 'fast'].map((id) => ({ goto: 'av', bvid: id, owner: { mid: 1 } })) };
    else {
      if (offline) throw new Error('HTTP 429');
      if (url.includes('slow')) return slow.promise;
      data = { tid: 3, cid: 1 };
    }
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  } } })('src/api/bili.js');
  const pending = api.personalizedMusicRecommendations(0, 2, (tracks) => batches.push(...tracks));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(batches.map((track) => track.bvid), ['fast']);
  slow.resolve({ status: 200, body: JSON.stringify({ code: 0, data: { tid: 3, cid: 2 } }) });
  assert.equal((await pending).length, 2);
  offline = true;
  await assert.rejects(api.personalizedMusicRecommendations(1, 2), /HTTP 429/);
});

test('discovery viewing and autoplay never enter the main taste, while ordinary playback still does', async (t) => {
  let now = 100000, context, tree;
  t.mock.method(Date, 'now', () => now);
  const events = {}, mainEvents = [], discoveryEvents = [];
  const main = { getSnapshot:()=>({activeId:'auto'}), recordListening: (event) => mainEvents.push(event) };
  const discovery = { getSnapshot:()=>({activeId:'auto'}), recordListening: (event) => discoveryEvents.push(event) };
  const player = { playing: false, status: 'readyToPlay', duration: 180, currentTime: 0,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { this.source = source; events.sourceLoad({ videoSource: source }); } };
  const { PlayerProvider, usePlayer } = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: player.playing } : { status: player.status },
      useEventListener: (_, name, fn) => { events[name] = fn; } },
    'src/store/useRecommendationProfile': (_account, _likes, _ready, name) => ({
      recommendationManager: name ? discovery : main, recommendationProfile: { ready: true, revision: 0 } }),
    'src/api/bili': { videoUrl: async (bvid) => 'https://cdn/' + bvid },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/PlayerContext.js');
  function Probe() { context = usePlayer(); return null; }
  const watch = async () => {
    for (let i = 1; i <= 5; i++) {
      now += 1000;
      await act(async () => events.timeUpdate({ currentTime: i }));
    }
  };
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  const song = { bvid: 'BVmain', cid: 1 }, cards = [{ bvid: 'BVcardA', cid: 1 }, { bvid: 'BVcardB', cid: 1 }];
  await act(async () => context.playQueue([song])); await watch();
  await act(async () => context.playQueue(cards, 0, 0, 'discovery')); await watch();
  assert.ok(mainEvents.some((event) => event.track.bvid === 'BVmain'), 'switching source flushes the preceding normal session correctly');
  await act(async () => context.next(true)); await watch();
  await act(async () => context.syncDiscoveryQueue([]));
  assert.equal(context.current, null); assert.equal(player.playing, false, 'an exhausted disliked queue cannot autoplay the removed video');
  assert.ok(mainEvents.every((event) => event.track.bvid === 'BVmain'));
  assert.ok(discoveryEvents.some((event) => event.track.bvid === 'BVcardA'));
  assert.ok(discoveryEvents.some((event) => event.track.bvid === 'BVcardB'), 'automatic next retains discovery attribution');
  assert.ok(discoveryEvents.every((event) => event.track.bvid !== 'BVmain'), 'ordinary watching cannot train discovery recent taste');
  const discoveryCount = discoveryEvents.length;
  await act(async () => context.playQueue([cards[0]], 0, 0, 'search')); await watch();
  await act(async () => tree.unmount());
  assert.ok(mainEvents.some((event) => event.track.bvid === 'BVcardA' && event.search), 'explicit ordinary playback of the same video can train the main profile');
  assert.equal(discoveryEvents.length, discoveryCount, 'ordinary search playback cannot train discovery taste either');
});

test('discovery dislikes persist exact IDs and pending related lookups per account without blocking whole topics', async () => {
  const disk = new Map();
  const restart = () => loader({ '@react-native-async-storage/async-storage': {
    getItem: async (key) => disk.get(key) || null, setItem: async (key, value) => disk.set(key, value),
  } })('src/screens/discoveryExclusions.js').createDiscoveryExclusions;
  const first = restart()('123'); await first.ready;
  await first.reject({ bvid: 'BVseed' });
  assert.equal(first.has({ bvid: 'BVchild', relatedTo: 'BVseed' }), true, 'queued children are blocked before the API returns');
  const restored = restart()('123'); await restored.ready;
  assert.ok(restored.pending.has('BVseed'), 'failed/incomplete related requests remain retryable after restart');
  await restored.addRelated('BVseed', [{ bvid: 'BVlate' }, { bvid: 'BVseed' }]);
  assert.equal(restored.has({ bvid: 'BVlate', discoveryOrigin: 'feed' }), true, 'late related IDs cannot return via an independent Web recommendation');
  assert.equal(restored.pending.size, 0);
  assert.equal(restored.addRelated('BVlate', [{ bvid: 'BVunrelated' }]), null, 'negative feedback does not recursively crawl other videos');
  assert.equal(restored.has({ bvid: 'BVunrelated', tags: ['同一标签'] }), false);
  const other = restart()('456'); await other.ready;
  assert.equal(other.has({ bvid: 'BVseed' }), false);
  const again = restart()('123'); await again.ready;
  assert.equal(again.has({ bvid: 'BVlate' }), true);
});

test('left-swipe related runs filter tags, deduplicate and exclude negatives, then stop at twenty with bounded expansion', async () => {
  const calls = [];
  const { buildRelatedRun } = loader({ 'src/api/bili': {
    videoTags: async (id) => id === 'BVsoftware' ? ['软件应用'] : ['美女'],
  } })('src/screens/discoveryFeed.js');
  const snapshot = { ...require('../renderer/recommendation-profile').normalize({ activeId: 'beauty',
    profiles: [{ id: 'beauty', name: '美女', tags: ['美女'] }] }), ready: true };
  const video = (bvid) => ({ bvid, title: '视频' });
  const seed = video('BVroot');
  const direct = Array.from({ length: 8 }, (_, i) => video(`BVdirect${i}`));
  const run = await buildRelatedRun(seed, snapshot, async (id) => {
    calls.push(id);
    return id === seed.bvid ? [seed, video('BVblocked'), video('BVsoftware'), ...direct, direct[0]]
      : [seed, direct[0], ...Array.from({ length: 30 }, (_, i) => video(`BVchild${i}`))];
  }, (item) => item.bvid === 'BVblocked', () => true);
  assert.equal(run.length, 20); assert.equal(new Set(run.map((item) => item.bvid)).size, 20);
  assert.deepEqual(calls, ['BVroot', 'BVdirect0']);
  assert.deepEqual(run.slice(0, 8).map((item) => item.bvid), direct.map((item) => item.bvid));
  assert.ok(run.every((item) => item.relatedFocus === 'BVroot' && item.discoveryOrigin === 'focused'));
  assert.ok(!run.some((item) => ['BVroot', 'BVblocked', 'BVsoftware'].includes(item.bvid)));
  let requests = 0;
  const sparse = await buildRelatedRun(video('BVsparse'), snapshot, async (id) => {
    requests++; return id === 'BVsparse' ? [video('BVonly')] : [];
  }, () => false, () => true);
  assert.equal(sparse.length, 1); assert.equal(requests, 2, 'short related graphs cannot create an endless spinner or unrelated padding');
  let live = true;
  const cancelled = await buildRelatedRun(seed, snapshot, async () => { live = false; return direct; }, () => false, () => live);
  assert.deepEqual(cancelled, [], 'leaving or replacing the request discards its late result');
  await assert.rejects(buildRelatedRun(seed, snapshot, async () => { throw Error('offline'); }, () => false, () => true), /offline/);
});

test('wheel window covers both copies and every visible folder with at most eleven mounted slots', () => {
  const { visibleWheelSlots, wheelGeometry, wheelPosition, wrap } = loader()('src/screens/discoveryGesture.js');
  for (const count of [1, 2, 5, 20, 200]) {
    const all = new Set(), { radius, halfHeight, step } = wheelGeometry(count, 520);
    for (let center = 0; center < count * 2; center++) {
      const rotation = -center * step;
      const slots = visibleWheelSlots(wrap(Math.round(-rotation / step), count * 2), count, 520);
      assert.ok(slots.length <= 11); assert.equal(new Set(slots).size, slots.length);
      slots.forEach((slot) => all.add(slot));
      for (let slot = 0; slot < count * 2; slot++) {
        const p = wheelPosition(slot, rotation, count, radius);
        if (p.front && Math.abs(p.y) <= halfHeight) assert.ok(slots.includes(slot), 'the window cannot miss a visible folder at the wrap boundary');
      }
    }
    assert.equal(all.size, count * 2, 'both logical copies remain reachable');
  }
});

test('playlist transfer writes both lists once, deduplicates segments and preserves source on failure', async () => {
  const disk = new Map(); let fail = false, writes = 0;
  const store = loader({ '@react-native-async-storage/async-storage': {
    getItem: async (key) => disk.get(key) || null,
    setItem: async (key, value) => { writes++; if (fail) throw Error('disk full'); disk.set(key, value); },
  } })('src/store/playlists.js');
  const a = { bvid: 'BVmove', isSegment: true, segmentId: 'one', start: 0, end: 10 }, b = { bvid: 'BVother' };
  const from = await store.createPlaylist('来源', [a, b]), to = await store.createPlaylist('目标', [a]);
  const before = writes;
  await store.transferPlaylistTrack(from.id, to.id, store.trackKeyOf(a));
  assert.equal(writes, before + 1);
  assert.deepEqual((await store.getPlaylists()).find((p) => p.id === from.id).tracks, [b]);
  assert.deepEqual((await store.getPlaylists()).find((p) => p.id === to.id).tracks, [a]);
  fail = true;
  await assert.rejects(store.transferPlaylistTrack(from.id, to.id, store.trackKeyOf(b)), /disk full/);
  assert.deepEqual((await store.getPlaylists()).find((p) => p.id === from.id).tracks, [b]);
  fail = false;
  await assert.rejects(store.transferPlaylistTrack(from.id, -99, store.trackKeyOf(b)), /已被删除/);
  await store.transferPlaylistTrack(from.id, to.id, store.trackKeyOf(b));
  assert.equal((await store.getPlaylists()).find((p) => p.id === from.id).tracks.length, 0);
});

test('collection deletion is persisted, library removal also unlikes, and failed writes keep the visible collection', async () => {
  const disk = new Map(); let fail = false, context, tree;
  const player = { playing: false, status: 'idle', currentTime: 0, duration: 0 };
  const { PlayerProvider, usePlayer } = loader({
    'expo-video': { useVideoPlayer: () => player },
    expo: { useEvent: () => ({}), useEventListener() {} },
    'src/api/client': { initClient: async () => {}, authStatus: async () => ({ isLogin: false }) },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => disk.get(key) || null,
      setItem: async (key, value) => { if (fail && key.startsWith('biu.likes')) throw Error('disk full'); disk.set(key, value); },
    },
  })('src/player/PlayerContext.js');
  function Probe() { context = usePlayer(); return null; }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  try {
    const track = { bvid: 'BVcollection', title: 'Collection' };
    await act(async () => { await context.toggleLibrary(track); await context.toggleLike(track); });
    assert.equal(context.likes.length, 1); assert.equal(context.libraryTracks.length, 1);
    await act(async () => context.removeCollectionTrack(track, 'likes'));
    assert.equal(context.likes.length, 0); assert.equal(context.libraryTracks.length, 1, 'removing only a like retains an explicitly saved library entry');
    await act(async () => context.toggleLike(track));
    fail = true;
    await act(async () => assert.rejects(context.removeCollectionTrack(track, 'likes'), /disk full/));
    assert.equal(context.likes.length, 1);
    fail = false;
    await act(async () => context.removeCollectionTrack(track, 'library'));
    assert.equal(context.likes.length, 0); assert.equal(context.libraryTracks.length, 0);
    assert.deepEqual(JSON.parse(disk.get('biu.likes')), []); assert.deepEqual(JSON.parse(disk.get('biu.library')), []);
    await act(async () => Promise.all([context.toggleLike(track), context.toggleLike(track)]));
    assert.equal(context.likes.length, 0, 'queued toggles use the preceding persisted result');
  } finally { await act(async () => tree.unmount()); }
});

test('likes, library and playlist rows expose swipe deletion and safe long-press moves and Bilibili favorites', async () => {
  for (const [source, file] of [['likes', 'LikesScreen'], ['library', 'MusicLibraryScreen'], ['playlist', 'LocalPlaylistScreen']]) {
    const disk = new Map(), favorites = [], removals = [];
    let fail = false, refresh, tree, plays = 0;
    const track = { bvid: 'BVactions', aid: 77, title: '测试歌曲', mid: 1 };
    const context = { account: { isLogin: true, mid: 123 }, likes: [track], libraryTracks: [track], current: null,
      playQueue() { plays++; }, isLiked: (item) => context.likes.includes(item), isInLibrary: (item) => context.libraryTracks.includes(item),
      toggleLike: async () => { context.likes = []; refresh((n) => n + 1); },
      toggleLibrary: async () => { context.libraryTracks = [track]; refresh((n) => n + 1); },
      removeCollectionTrack: async (item, collection) => {
        removals.push(collection); context.likes = context.likes.filter((t) => t.bvid !== item.bvid);
        if (collection === 'library') context.libraryTracks = context.libraryTracks.filter((t) => t.bvid !== item.bvid);
        refresh((n) => n + 1);
      },
    };
    const load = loader({
      'react-native': rn, 'react-native-safe-area-context': safeArea,
      'src/player/PlayerContext': { usePlayer: () => context },
      'src/components/TrackRow': 'TrackRow', 'src/components/RemoteImage': 'Cover',
      'src/components/DefaultCover': { __esModule: true, default: 'DefaultCover', defaultCoverSeed: () => 1 },
      'src/components/icons': iconMock,
      'src/components/BottomSheet': ({ visible, children }) => visible ? React.createElement('Sheet', null, children) : null,
      'src/api/bili': { favFolders: async () => [{ id: 99, title: 'B站收藏' }], favDeal: async (...args) => favorites.push(args) },
      '@react-native-async-storage/async-storage': {
        getItem: async (key) => disk.get(key) || null,
        setItem: async (key, value) => { if (fail) throw Error('disk full'); disk.set(key, value); },
      },
    });
    const store = load('src/store/playlists.js');
    const from = await store.createPlaylist('来源歌单', [track]), to = await store.createPlaylist('目标歌单');
    const Screen = load(`src/screens/${file}.js`).default;
    function Harness() { [, refresh] = React.useState(0); return React.createElement(Screen, { navigation: {}, route: { params: { id: from.id } } }); }
    await act(async () => { tree = create(React.createElement(Harness)); });
    try {
      const menu = async () => act(async () => tree.root.findAllByType('TrackRow')[0].props.onLongPress());
      await menu();
      assert.ok(touch(tree, '移到其他歌单'));
      await click(tree, '加入 B 站收藏夹'); await click(tree, '加入「B站收藏」');
      assert.deepEqual(favorites, [[77, [99]]]); assert.equal(tree.root.findAllByType('Sheet').length, 0);
      await menu(); await click(tree, '移到其他歌单');
      if (source === 'playlist') assert.equal(tree.root.findAllByProps({ accessibilityLabel: '选择歌单 来源歌单' }).length, 0);
      fail = true;
      await click(tree, '选择歌单 目标歌单');
      assert.ok(tree.root.findAllByType('Text').some((node) => node.props.children === 'disk full'));
      assert.equal(tree.root.findAllByType('TrackRow').length, 1, 'failed target writes retain the source row');
      assert.equal(removals.length, 0);
      fail = false;
      await click(tree, '选择歌单 目标歌单');
      assert.equal((await store.getPlaylists()).find((p) => p.id === to.id).tracks[0].bvid, track.bvid);
      assert.equal(tree.root.findAllByType('TrackRow').length, 0, 'successful moves remove only the source collection');
      assert.equal(plays, 0, 'long presses never start playback');
      await act(async () => {
        if (source === 'playlist') await store.addToPlaylist(from.id, track);
        else { context.likes = [track]; context.libraryTracks = [track]; refresh((n) => n + 1); }
      });
      assert.equal(tree.root.findByType('Swipeable').props.enabled, true);
      await click(tree, '删除 测试歌曲');
      assert.equal(tree.root.findAllByType('TrackRow').length, 0);
      assert.equal((await store.getPlaylists()).find((p) => p.id === to.id).tracks.length, 1, 'swipe deletion does not remove another playlist copy');
      if (source === 'library') assert.equal(context.likes.length, 0);
    } finally { await act(async () => tree.unmount()); }
  }
});


test('home always uses signed Web recommendations and never calls App auth, including empty or failed pages', async () => {
  let appCalls = 0, mode = 'ok'; const calls = [], batches = [], loaded = [];
  const api = loader({ './client': {
    appGet: async () => { appCalls++; throw Error('App must not be called'); },
    get: async (url, opts) => {
      calls.push([url, opts]);
      assert.ok(url.includes('/x/web-interface/wbi/index/top/feed/rcmd'));
      if (mode === 'fail') return { status: 412, body: '' };
      return { status: 200, body: JSON.stringify({ code: 0, data: { item: mode === 'empty' ? [] : [
        { goto: 'av', bvid: 'BVmusic', owner: {}, tid: 3 },
        { goto: 'av', bvid: 'BVgame', owner: {}, tid: 17 },
      ] } }) };
    },
  } })('src/api/bili.js');
  const result = await api.homeRecommendations(7, 20, { music: true, onBatch: (items) => batches.push(...items), onPageLoaded: () => loaded.push(7) });
  assert.deepEqual(result.map((item) => item.bvid), ['BVmusic']);
  assert.equal(batches.length, 1); assert.deepEqual(loaded, [7]);
  assert.equal(new URL(calls[0][0]).searchParams.get('fresh_idx'), '7');
  assert.equal(calls[0][1].wbi, true);
  assert.equal((await api.homeRecommendations(8)).length, 2);
  mode = 'empty'; assert.deepEqual(await api.homeRecommendations(9), []);
  mode = 'fail'; await assert.rejects(api.homeRecommendations(10), /HTTP 412/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.homeRecommendations(11, 20, { signal: controller.signal }), /取消/);
  assert.equal(calls.length, 4, 'failed pages do not retry or switch source; cancelled pages issue no request');
  assert.equal(appCalls, 0);
});

test('request deadlines include storage and shared WBI preparation; expired callers cannot send late requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = global.fetch; t.after(() => { global.fetch = original; });
  let calls = [];
  global.fetch = async (url) => { calls.push(url); return { text: async () => '{}', headers: { get: () => null } }; };
  const storage = deferred();
  const blocked = loader({ '@react-native-async-storage/async-storage': { getItem: () => storage.promise, setItem: async () => {} } })('src/api/client.js');
  const pending = blocked.get('https://api.bilibili.com/late', { timeout: 50 });
  t.mock.timers.tick(50); assert.equal((await pending).status, -1);
  storage.resolve(JSON.stringify({ buvid3: 'test' }));
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls.length, 0);
  const nav = deferred(); calls = [];
  global.fetch = async (url) => { calls.push(url); return url.includes('/nav') ? nav.promise : { status: 200, text: async () => '{}', headers: { get: () => null } }; };
  const client = loader({ '@react-native-async-storage/async-storage': {
    getItem: async () => JSON.stringify({ buvid3: 'test' }), setItem: async () => {},
  } })('src/api/client.js');
  const first = client.get('https://api.bilibili.com/first', { wbi: true, timeout: 50 });
  const second = client.get('https://api.bilibili.com/second', { wbi: true, timeout: 50 });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls.length, 1, 'WBI nav is shared');
  t.mock.timers.tick(50); assert.equal((await first).status, -1); assert.equal((await second).status, -1);
  nav.resolve({ status: 200, text: async () => JSON.stringify({ data: { wbi_img: { img_url: 'https://x/' + 'a'.repeat(32) + '.png', sub_url: 'https://x/' + 'b'.repeat(32) + '.png' } } }), headers: { get: () => null } });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls.length, 1);
  assert.equal((await client.get('https://api.bilibili.com/fresh', { wbi: true })).status, 200);
  assert.equal(calls.length, 2);
});

test('home cancels superseded pages, times out stalled loads and retains cards while background sync waits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stale = deferred(), stalled = deferred(); let phase = 'initial', staleSignal;
  const cards = (name) => Array.from({ length: 15 }, (_, i) => ({ bvid: name + i, title: name }));
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/bili': { homeRecommendations: (_page, _count, options) => {
      if (phase === 'stale') { staleSignal = options.signal; return stale.promise; }
      if (phase === 'stalled') return stalled.promise;
      return Promise.resolve(cards(phase === 'initial' ? 'old' : 'new'));
    } },
    'src/player/PlayerContext': { usePlayer: () => ({ likes: [], account: { isLogin: true, mid: 123 }, recommendMode: 'all', playQueue() {} }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
  });
  const gate = load('src/updates/networkGate.js'), Home = load('src/screens/HomeScreen.js').default;
  let tree; await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  t.after(async () => { await act(async () => tree.unmount()); });
  const refresh = () => tree.root.findByType('FlatList').props.refreshControl.props.onRefresh();
  const visible = () => tree.root.findAllByType('TrackCard').map((v) => v.props.track.bvid);
  const before = visible(); phase = 'stale'; await act(async () => refresh());
  const cancelledSync = new AbortController();
  const waiting = gate.waitForRecommendationIdle(cancelledSync.signal);
  cancelledSync.abort(); await assert.rejects(waiting, { name: 'AbortError' });
  let synced = false; const sync = gate.waitForRecommendationIdle().then(() => { synced = true; });
  assert.equal(synced, false); assert.deepEqual(visible(), before);
  phase = 'stalled'; await act(async () => refresh()); assert.ok(staleSignal.aborted);
  await act(async () => stale.resolve(cards('stale'))); assert.deepEqual(visible(), before);
  await act(async () => t.mock.timers.tick(18000));
  await sync; assert.ok(synced); assert.equal(gate.isRecommendationBusy(), false);
  assert.deepEqual(visible(), before); assert.ok(tree.root.findAllByType('Text').some((node) => String(node.props.children).includes('首页推荐请求超时')));
  phase = 'new'; await act(async () => refresh()); assert.ok(visible().every((id) => id.startsWith('new')));
  await act(async () => stalled.resolve(cards('late'))); assert.ok(visible().every((id) => id.startsWith('new')));
});

test('home streams Web music matches immediately and fills fifteen across pages despite metadata failures', async (t) => {
  const next = deferred(), pages = []; let detailCalls = 0;
  const cards = (page) => Array.from({ length: 20 }, (_, i) => ({
    goto: 'av', bvid: `BVweb${page}-${i}`, owner: {}, title: '推荐',
    tid: i < 3 ? 3 : 17, tname: i < 3 ? '音乐' : '游戏',
  }));
  const api = loader({ './client': {
    appGet: async () => { throw Error('App recommendations must not be used'); },
    get: async (url) => {
      if (url.includes('/feed/rcmd')) {
        const idx = Number(new URL(url).searchParams.get('fresh_idx'));
        pages.push(idx);
        if (idx >= 1) await next.promise;
        const items = cards(idx);
        const unknown = (item) => { delete item.tid; delete item.tname; };
        if (idx === 2) items.slice(3, 8).forEach(unknown);
        if (idx === 3) items.forEach(unknown);
        return { status: 200, body: JSON.stringify({ code: 0, data: { item: items } }) };
      }
      assert.ok(url.includes('/view?'));
      detailCalls++; throw Error('HTTP 412');
    },
  } })('src/api/bili.js');
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/bili': api,
    'src/player/PlayerContext': { usePlayer: () => ({ likes: [], account: { isLogin: true, mid: 123 }, recommendMode: 'music', playQueue() {} }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree; await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  t.after(async () => { await act(async () => tree.unmount()); });
  const visible = () => [...tree.root.findByType('HomeBanner').props.tracks,
    ...tree.root.findAllByType('TrackCard').map((node) => node.props.track)];
  assert.equal(visible().length, 3, 'first three matches display while the second page is pending');
  assert.ok(load('src/updates/networkGate.js').isRecommendationBusy());
  await act(async () => next.resolve());
  assert.ok(pages.includes(5), 'metadata failures advance past the consumed page');
  assert.deepEqual(pages, Array.from({ length: pages.length }, (_, i) => i), 'concurrent pages reserve distinct increasing cursors');
  assert.ok(pages.length <= 8, 'at most two additional pages may already be in flight when the target arrives');
  assert.equal(visible().length, 15);
  assert.equal(new Set(visible().map((item) => item.bvid)).size, 15);
  assert.ok(visible().every((item) => item.tid === 3), 'music filtering remains strict');
  assert.equal(detailCalls, 2, 'each concurrent home page caps details at two; confirmed music skips metadata entirely');
  assert.equal(load('src/updates/networkGate.js').isRecommendationBusy(), false);
  assert.ok(!tree.root.findAllByType('Text').some((node) => /412|不足/.test(String(node.props.children))));
});

test('home bounds concurrent fill to three and retains every in-flight result beyond fifteen', async (t) => {
  const pending = new Map(), signals = new Map(), requested = []; let active = 0, peak = 0;
  const cards = (prefix, count) => Array.from({ length: count }, (_, i) => ({ bvid: prefix + i, tid: 3 }));
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/bili': { homeRecommendations: (page, _limit, { signal }) => {
      requested.push(page); signals.set(page, signal);
      if (page === 0) return Promise.resolve(cards('first', 3));
      active++; peak = Math.max(peak, active);
      let ended = false;
      const end = () => { if (!ended) { ended = true; active--; } };
      signal.addEventListener('abort', end, { once: true });
      const gate = deferred(); pending.set(page, gate);
      return gate.promise.finally(end); // Deliberately ignores abort to test the coordinator's cancellation race.
    } },
    'src/player/PlayerContext': { usePlayer: () => ({ likes: [], account: { isLogin: true, mid: 123 }, recommendMode: 'music', playQueue() {} }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree; await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  t.after(async () => { await act(async () => tree.unmount()); });
  const visible = () => [...tree.root.findByType('HomeBanner').props.tracks,
    ...tree.root.findAllByType('TrackCard').map((node) => node.props.track)].map((item) => item.bvid);
  assert.deepEqual(requested, [0, 1, 2, 3]); assert.equal(active, 3);
  await act(async () => pending.get(2).resolve([...cards('first', 3), ...cards('fast', 6)]));
  assert.equal(visible().length, 9, 'duplicate cards do not count towards the target');
  assert.ok(visible().includes('fast0'), 'page two renders while page one is still blocked');
  assert.equal(active, 3, 'the free slot begins another page');
  await act(async () => pending.get(3).resolve(cards('last', 6)));
  assert.equal(visible().length, 15); assert.equal(peak, 3); assert.equal(active, 2);
  assert.equal(signals.get(1).aborted, false); assert.equal(signals.get(4).aborted, false);
  assert.equal(load('src/updates/networkGate.js').isRecommendationBusy(), true);
  const complete = visible();
  await act(async () => { pending.get(1).resolve(cards('late', 20)); pending.get(4).resolve(cards('late4', 20)); });
  assert.equal(visible().length, 55, 'all in-flight results append even after reaching fifteen');
  assert.ok(complete.every((id) => visible().includes(id)));
  assert.equal(active, 0);
  assert.equal(load('src/updates/networkGate.js').isRecommendationBusy(), false);
});

test('home related API keeps Web cancellation and independently verifies music rather than inheriting the seed partition', async () => {
  let raw = [
    { bvid: 'seed', tid: 3 }, { bvid: 'music', tid: 3 }, { bvid: 'music', tid: 3 },
    { bvid: 'game', tid: 17 }, { bvid: 'unknown' },
  ];
  const calls = [], batches = [], signal = new AbortController().signal;
  const api = loader({ './client': {
    get: async (url, opts) => {
      calls.push([url, opts]);
      const data = url.includes('/archive/related') ? raw
        : { tid: new URL(url).searchParams.get('bvid') === 'verified' ? 3 : 17 };
      return { status: 200, body: JSON.stringify({ code: 0, data }) };
    },
  } })('src/api/bili.js');
  const result = await api.homeRelatedRecommendations('seed', { music: true, signal, onBatch: (items) => batches.push(...items) });
  assert.deepEqual(result.map((item) => item.bvid), ['music']);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].signal, signal); assert.equal(batches.length, 1);
  raw = [{ bvid: 'verified' }, { bvid: 'not-music' }];
  assert.deepEqual((await api.homeRelatedRecommendations('seed', { music: true })).map((item) => item.bvid), ['verified']);
  assert.equal(calls.length, 4);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(api.homeRelatedRecommendations('seed', { signal: cancelled.signal }), /取消/);
  assert.equal(calls.length, 4);
});

test('home starts three Web pages immediately, streams related videos concurrently and keeps extra results on every load', async (t) => {
  const feeds = new Map(), related = new Map(), pages = [], seeds = [], signals = [];
  const cards = (prefix, count) => Array.from({ length: count }, (_, i) => ({ bvid: prefix + i, tid: 3 }));
  const initial = cards('seed', 3);
  const load = loader({
    'react-native': { ...rn, RefreshControl: 'RefreshControl' }, 'react-native-safe-area-context': safeArea,
    'src/api/bili': {
      homeRecommendations: (page, count, options) => {
        pages.push(page); signals.push(options.signal); assert.equal(count, 30);
        if (page >= 3) return Promise.resolve(cards('page' + page + '-', 10));
        const gate = deferred(); feeds.set(page, gate);
        if (page === 0) options.onBatch(initial);
        return gate.promise;
      },
      homeRelatedRecommendations: (bvid, options) => {
        seeds.push(bvid); signals.push(options.signal); assert.equal(options.music, true);
        if (seeds.length > 2) return seeds.length === 3 ? Promise.reject(Error('related offline')) : Promise.resolve(initial);
        const gate = deferred(); related.set(bvid, gate); return gate.promise;
      },
    },
    'src/player/PlayerContext': { usePlayer: () => ({ likes: [], account: { isLogin: true, mid: 123 }, recommendMode: 'music', playQueue() {} }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/screens/DailyScreen': { DailyCard: 'DailyCard' }, 'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree; await act(async () => { tree = create(React.createElement(Home, { navigation: {} })); });
  t.after(async () => { await act(async () => tree.unmount()); });
  const visible = () => [...tree.root.findByType('HomeBanner').props.tracks,
    ...tree.root.findAllByType('TrackCard').map((node) => node.props.track)].map((item) => item.bvid);
  assert.deepEqual(pages, [0, 1, 2]); assert.deepEqual(seeds, ['seed0', 'seed1']);
  assert.equal(visible().length, 3);
  await act(async () => related.get('seed0').resolve([...initial, ...cards('related', 12)]));
  assert.equal(visible().length, 15, 'related results display before any recommendation page completes');
  assert.ok(signals.every((signal) => !signal.aborted), 'fifteen is not a cancellation threshold');
  await act(async () => {
    feeds.get(0).resolve(initial);
    feeds.get(1).resolve(cards('feed1-', 6));
    feeds.get(2).resolve([...cards('feed2-', 5), { bvid: 'related0', tid: 3 }]);
    related.get('seed1').resolve([...cards('more-related', 4), { bvid: 'feed1-0', tid: 3 }]);
  });
  assert.equal(visible().length, 30); assert.equal(new Set(visible()).size, 30);
  assert.equal(seeds.length, 2, 'related results never recursively expand');
  assert.equal(load('src/updates/networkGate.js').isRecommendationBusy(), false);
  await act(async () => {
    const list = tree.root.findByType('FlatList'); list.props.onScrollBeginDrag(); list.props.onEndReached();
  });
  assert.deepEqual(pages, [0, 1, 2, 3, 4, 5]); assert.equal(seeds.length, 4);
  assert.equal(visible().length, 60, 'load-more also gathers three pages and retains all new results');
  assert.ok(!tree.root.findAllByType('Text').some((node) => String(node.props.children).includes('related offline')));
});

test('large account storage migrates CursorWindow rows durably and isolates iOS/Android account and profile buckets', async () => {
  const { createLargeStorage } = loader()('src/store/largeStorageCore.js');
  const key = 'biu.lan-baseline@123:phone-peer';
  const huge = JSON.stringify({ cover: '中文😀'.repeat(400000) });
  const legacyValues = new Map([[key, huge]]), values = new Map(); let fail = true, recovered = 0;
  const legacy = { getItem: async (key) => {
    const value = legacyValues.get(key) ?? null;
    if (value && value.length > 100000) assert.fail('Android migration must bypass oversized CursorWindow reads entirely');
    return value;
  }, setItem: async (key,value) => legacyValues.set(key,value), removeItem: async (key) => legacyValues.delete(key) };
  const storage = createLargeStorage({ legacy, readLegacyLarge: async (key) => { recovered++; return legacyValues.get(key) ?? null; },
    files: { read: async (key) => values.get(key) ?? null,
      write: async (key,value) => { if (fail) throw Error('disk full'); values.set(key,value); }, remove: async (key) => values.delete(key) } });
  await assert.rejects(storage.getItem(key), /disk full/); assert.equal(legacyValues.get(key),huge); assert.equal(values.size,0);
  fail = false; assert.equal(await storage.getItem(key),huge); assert.equal(legacyValues.has(key),false); assert.equal(recovered,2);
  assert.equal(await storage.getItem(key),huge); assert.equal(recovered,2, 'subsequent reads never touch the oversized SQLite row');
  for (const bucket of ['biu.likes@123','biu.library@123','biu.playlists@123','biu.recommendation-profiles@123','biu.discovery-recommendation-profiles@123']) {
    await storage.setItem(bucket,bucket); assert.equal(await storage.getItem(bucket),bucket);
    assert.equal(await storage.getItem(bucket.replace('@123','@456')),null);
  }
  await storage.setItem('biu.quality','80'); assert.equal(legacyValues.get('biu.quality'),'80');
  fail = true; await assert.rejects(storage.setItem(key,'new'), /disk full/); assert.equal(await storage.getItem(key),huge);
});

test('cold account adoption checks existence without reading large target values and still copies missing guest buckets', async () => {
  const { createLargeStorage } = loader()('src/store/largeStorageCore.js');
  for (const fileBacked of [true, false]) {
    const reads = [], values = new Map([['biu.likes', '["guest"]'], ['biu.likes@123', '["account"]'],
      ['biu.library', '["guest-library"]']]);
    const legacyValues = fileBacked ? new Map([['biu.history@123', '["old-history"]']]) : values;
    const legacy = { getAllKeys: async () => [...legacyValues.keys()],
      getItem: async key => { reads.push(key); return legacyValues.get(key) ?? null; },
      setItem: async (key, value) => legacyValues.set(key, value), removeItem: async key => legacyValues.delete(key) };
    const store = createLargeStorage({ legacy, files: fileBacked ? {
      exists: async key => values.has(key),
      read: async key => { reads.push(key); return values.get(key) ?? null; },
      write: async (key, value) => values.set(key, value), remove: async key => values.delete(key),
    } : null });
    const { adoptGuestLibrary } = loader({ 'src/store/largeStorage': store })('src/store/accountStorage.js');
    await adoptGuestLibrary('123');
    assert.ok(!reads.includes('biu.likes@123'), 'existing account values are never fetched for migration');
    assert.ok(!reads.includes('biu.history@123'), 'legacy existence also bypasses CursorWindow value reads');
    assert.equal(values.get('biu.likes@123'), '["account"]');
    assert.equal(values.get('biu.library@123'), '["guest-library"]');
    assert.equal(values.get('biu.library'), '["guest-library"]');
  }
});

test('large storage serializes legacy migration against new writes without resurrecting stale state', async () => {
  const { createLargeStorage } = loader()('src/store/largeStorageCore.js'), old = deferred();
  let value = null;
  const storage = createLargeStorage({ legacy: { getItem: () => old.promise, removeItem: async () => {} },
    files: { read: async () => value, write: async (_,next) => { value = next; }, remove: async () => { value = null; } } });
  const migrating = storage.getItem('biu.library@123'), updating = storage.setItem('biu.library@123','new');
  old.resolve('old'); assert.equal(await migrating,'old'); await updating; assert.equal(value,'new');
  await storage.removeItem('biu.library@123'); assert.equal(value,null);
});

test('discovery applies the selected partition to native, tagged and focused related recommendations', async () => {
  const calls = [];
  const load = loader({ 'src/api/client': { get: async (url) => {
    const u = new URL(url), id = u.searchParams.get('bvid'); calls.push(id);
    const data = u.pathname.endsWith('/tag') ? [{ tag_name: id === 'wrong-tags' ? '游戏' : '钢琴' }]
      : { tid: id === 'unknown-music' ? 3 : 17, tname: id === 'unknown-music' ? '音乐' : '游戏' };
    return { status: 200, body: JSON.stringify({ code: 0, data }) };
  } } });
  const {filterDiscoveryCandidates, buildRelatedRun} = load('src/screens/discoveryFeed.js');
  const candidates = [{bvid:'music',tid:3},{bvid:'film',tid:181},{bvid:'unknown-music'},{bvid:'unknown-game'},{bvid:'wrong-tags',tid:3}];
  const R = require('../renderer/recommendation-profile'), snapshot = R.normalize({auto:{tags:['钢琴']}});
  const ids = (items) => items.map(x=>x.bvid);
  assert.deepEqual(ids(await filterDiscoveryCandidates(candidates,snapshot,()=>{},()=>true,'music')),['music','unknown-music']);
  assert.ok(!calls.includes('film'), 'known non-music partitions do not fetch tags');
  assert.deepEqual(ids(await filterDiscoveryCandidates(candidates,{...snapshot,enabled:false},()=>{},()=>true,'music')),['music','wrong-tags','unknown-music']);
  assert.equal((await filterDiscoveryCandidates(candidates,{...snapshot,enabled:false},()=>{},()=>true,'all')).length,5);
  assert.ok(ids(await filterDiscoveryCandidates(candidates,snapshot,()=>{},()=>true,'all')).includes('film'),'all partitions still obey verified profile tags');
  const related = await buildRelatedRun({bvid:'seed'},snapshot,async()=>candidates,()=>false,()=>true,'music');
  assert.deepEqual(ids(related),['music','unknown-music']);
});

test('home cancels hidden startup work and resumes without keeping settings navigation busy', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events={}, requests=[];
  const load=loader({
    'react-native':{...rn,RefreshControl:'RefreshControl'},'react-native-safe-area-context':safeArea,
    'src/api/bili':{homeRecommendations:(page,limit,options)=>{const gate=deferred();requests.push({page,gate,...options});return gate.promise;}},
    'src/player/PlayerContext':{usePlayer:()=>({likes:[],account:{isLogin:true,mid:123},recommendMode:'all',playQueue(){}})},
    'src/components/TrackCard':{default:'TrackCard',__esModule:true},
    'src/components/HomeBanner':{default:'HomeBanner',__esModule:true},
    'src/screens/DailyScreen':{DailyCard:'DailyCard'},'src/components/icons':iconMock,
  });
  const Home=load('src/screens/HomeScreen.js').default;
  const navigation={addListener:(name,fn)=>{events[name]=fn;return()=>{delete events[name];};}};
  let tree;await act(async()=>{tree=create(React.createElement(Home,{navigation}));});
  t.after(async()=>{await act(async()=>tree.unmount());});
  assert.equal(requests.length,3);
  await act(async()=>events.blur());
  assert.ok(requests.every(x=>!x.signal.aborted), 'blur invalidates results before native cancellation fan-out');
  await act(async()=>t.mock.timers.tick(0));
  assert.ok(requests.every(x=>x.signal.aborted));
  assert.equal(load('src/updates/networkGate.js').isRecommendationBusy(),false);
  await act(async()=>requests.forEach(x=>x.gate.resolve([{bvid:'stale'}])));
  assert.equal(tree.root.findAllByType('TrackCard').length,0,'late results cannot rebuild a hidden homepage');
  await act(async()=>events.focus());
  assert.equal(requests.length,3,'focus does not start network work inside navigation dispatch');
  await act(async()=>t.mock.timers.tick(32));
  assert.equal(requests.length,6,'returning resumes the pending feed');
});

test('tab bar selection follows navigator state after return, and the first press targets the current tab navigator', async () => {
  const actions=[], events=[];
  const mocks={
    'react-native':rn,'react-native-safe-area-context':safeArea,
    '@react-navigation/native':{DefaultTheme:{colors:{}},TabActions:{jumpTo:name=>({type:'JUMP_TO',payload:{name}})}},
    '@react-navigation/bottom-tabs':{createBottomTabNavigator:()=>({})},
    '@react-navigation/native-stack':{createNativeStackNavigator:()=>({})},
    'react-native-gesture-handler':{GestureHandlerRootView:'Root'},
    'expo-status-bar':{StatusBar:'StatusBar'},expo:{isRunningInExpoGo:()=>true},
    'expo-splash-screen':{preventAutoHideAsync:async()=>{}},
    'expo-blur':{BlurView:'BlurView',BlurTargetView:'BlurTargetView'},
    'expo-linear-gradient':{LinearGradient:'Gradient'},'react-native-svg':{},
    'src/player/PlayerContext':{},'src/store/LanSyncProvider':{},'src/store/CloudSyncProvider':{},
    'src/player/useMediaTransition':{},'src/components/MiniBar':()=>null,'src/components/Overlay':{},
    'src/components/icons':iconMock,'src/components/AppUpdateCard':{},'src/components/LyricsActivitySync':()=>null,
    'assets/splash-icon.png':1,
  };
  for(const file of fs.readdirSync(path.join(root,'src/screens')))mocks[`src/screens/${file.replace(/\.js$/,'')}`]={default:()=>null};
  const {GlassTabBar}=loader(mocks)('App.js');
  const routes=['Home','Search','Mine','Discover'].map(name=>({name,key:name+'-route'}));
  let state={key:'tabs-one',index:0,routes}, prevented=false, liveState;
  const navigation={getState:()=>liveState||state,dispatch:action=>actions.push(action),emit:event=>{events.push(event);return {defaultPrevented:prevented};}};
  const blurTargets=Object.fromEntries(routes.map(route=>[route.name,{current:route.name}]));
  const render=()=>React.createElement(GlassTabBar,{state,navigation,blurTargets});
  let tree;await act(async()=>{tree=create(render());});
  await click(tree,'我的');assert.deepEqual(actions.at(-1),{type:'JUMP_TO',payload:{name:'Mine'},target:'tabs-one'});
  state={...state,index:2};await act(async()=>tree.update(render()));
  assert.equal(touch(tree,'我的').props.accessibilityState.selected,true);
  assert.equal(touch(tree,'首页').props.accessibilityState.selected,false);
  liveState={key:'tabs-live',index:3,routes:routes.map(route=>({...route,key:route.name+'-live'}))};
  const beforeRapidReturn=actions.length;
  await click(tree,'我的');
  assert.equal(actions.length,beforeRapidReturn+1,'returning to the still-painted tab cannot be discarded before React catches up');
  assert.deepEqual(actions.at(-1),{type:'JUMP_TO',payload:{name:'Mine'},target:'tabs-live'});
  assert.equal(events.at(-1).target,'Mine-live','tabPress targets the actual current navigator route');
  await click(tree,'发现');
  assert.equal(actions.at(-1).payload.name,'Discover','every valid discovery tap is dispatched, even during a delayed commit');
  liveState=null;
  state={...state,key:'tabs-after-return',index:1};await act(async()=>tree.update(render()));
  assert.equal(touch(tree,'搜索').props.accessibilityState.selected,true,'external navigation updates selection without an extra tap');
  assert.equal(tree.root.findByType('BlurView').props.blurTarget,blurTargets.Search);
  await click(tree,'首页');assert.equal(actions.at(-1).target,'tabs-after-return');
  assert.equal(actions.at(-1).payload.name,'Home');
  await click(tree,'首页');assert.ok(events.some(x=>x.type==='homeDoublePress'&&x.target==='Home-route'));
  prevented=true;const before=actions.length;await click(tree,'我的');assert.equal(actions.length,before);
  await act(async()=>tree.unmount());
});


test('favorite folder loads coalesce, cache last success by account, and retry malformed or failed responses', async () => {
  const disk = new Map(), requests = [];
  const load = loader({
    '@react-native-async-storage/async-storage': {
      getItem: async key => disk.get(key) || null, setItem: async (key, value) => disk.set(key, value),
    },
    'src/api/client': { get: (url, options) => { const task = deferred(); requests.push({ url, options, task }); return task.promise; } },
  });
  const api = load('src/api/bili.js');
  const a = api.favFolders(123), b = api.favFolders('123');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.timeout, 10000);
  requests[0].task.resolve({ status: 200, body: JSON.stringify({ code: 0, data: { list: [{ id: 9, title: '我的收藏', media_count: 5 }] } }) });
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.deepEqual(await api.favFolders(123), first);
  assert.equal(requests.length, 1, 'rapid focus uses the fresh in-memory result');
  assert.deepEqual(await load('src/api/bili.js').cachedFavFolders(456), [], 'another account never receives this cache');
  const refresh = api.favFolders(123, { force: true });
  requests[1].task.resolve({ status: 200, body: '{"code":0,"data":{}}' });
  await assert.rejects(refresh, /不完整/);
  assert.deepEqual(await api.cachedFavFolders(123), first);
  const offline = api.favFolders(123, { force: true });
  requests[2].task.reject(new Error('offline'));
  await assert.rejects(offline, /offline/);
  const restarted = loader({
    '@react-native-async-storage/async-storage': { getItem: async key => disk.get(key) || null, setItem: async () => {} },
    'src/api/client': {},
  })('src/api/bili.js');
  assert.deepEqual(await restarted.cachedFavFolders(123), first, 'last good folders survive process restart');
  const empty = api.favFolders(123, { force: true });
  requests[3].task.resolve({ status: 200, body: '{"code":0,"data":{"list":null,"count":0}}' });
  assert.deepEqual(await empty, [], 'a verified empty list replaces old cached folders');
});

test('Mine keeps cached folders and navigation available during refresh, and ignores old-account results', async () => {
  const context = { likes: [], libraryTracks: [], history: [], account: { isLogin: true, mid: 123 } };
  const tasks = [], listeners = new Map(), navigated = [];
  const Mine = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    'src/player/PlayerContext': { usePlayer: () => context },
    'src/store/playlists': { usePlaylists: () => [] },
    'src/store/favoriteCovers': { stabilizeFavoriteCovers: async (_, folders) => folders },
    'src/api/bili': {
      cachedFavFolders: async mid => [{ id: Number(mid), title: '缓存' + mid, count: 3 }],
      favFolders: (mid) => { const task = deferred(); tasks.push({ mid, task }); return task.promise; },
    },
    'src/api/client': {}, 'src/components/BiliLogin': () => null,
    'src/components/DefaultCover': () => null, 'src/components/RemoteImage': () => null, 'src/components/icons': iconMock,
  })('src/screens/MineScreen.js').default;
  const navigation = { navigate: (...args) => navigated.push(args), addListener: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); } };
  let tree;
  await act(async () => { tree = create(React.createElement(Mine, { navigation })); });
  await click(tree, '收藏夹');
  assert.equal(tree.root.findByType('FlatList').props.data[0].title, '缓存123');
  await act(async () => { listeners.get('focus')(); listeners.get('focus')(); });
  assert.equal(tasks.length, 1);
  await click(tree, '设置');
  assert.equal(navigated.at(-1)[0], 'Settings', 'background loading does not gate buttons');
  context.account = { isLogin: true, mid: 456 };
  await act(async () => { tree.update(React.createElement(Mine, { navigation })); });
  await act(async () => { tasks[0].task.resolve([{ id: 1, title: '旧账号返回' }]); tasks[1].task.reject(new Error('offline')); });
  assert.equal(tree.root.findByType('FlatList').props.data[0].title, '缓存456');
  await click(tree, '重试');
  assert.equal(tasks.length, 3, 'failed refresh can be retried without hiding cached rows');
  assert.equal(tree.root.findByType('FlatList').props.data.length, 1);
  await act(async () => tree.unmount());
  await act(async () => tasks[2].task.resolve([]));
});

test('favorite detail serializes pagination, preserves rows on failure and cancels stale folders', async () => {
  const requests = [], context = { account: { mid: 123, isLogin: true } };
  const Detail = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea,
    'src/player/PlayerContext': { usePlayer: () => context },
    'src/api/bili': { favItems: (id, page, size, options) => { const task = deferred(); requests.push({ id, page, options, task }); return task.promise; } },
    'src/components/TrackRow': host('TrackRow'), 'src/components/PlaylistEditor': () => null,
    'src/components/icons': iconMock,
  })('src/screens/PlaylistDetailScreen.js').default;
  const render = id => React.createElement(Detail, { navigation: {}, route: { params: { mediaId: id } } });
  let tree;
  await act(async () => { tree = create(render(9)); });
  await act(async () => requests[0].task.resolve({ list: [{ bvid: 'BV1' }], total: 80, hasMore: true }));
  await act(async () => { const list = tree.root.findByType('FlatList'); list.props.onEndReached(); list.props.onEndReached(); });
  assert.equal(requests.length, 2); assert.equal(requests[1].page, 2);
  await act(async () => requests[1].task.reject(new Error('offline')));
  assert.equal(tree.root.findByType('FlatList').props.data.length, 1);
  await click(tree, '重试');
  assert.equal(requests[2].page, 2);
  await act(async () => tree.update(render(10)));
  assert.equal(requests[2].options.signal.aborted, true);
  await act(async () => {
    requests[3].task.resolve({ list: [{ bvid: 'BVnew' }], hasMore: false, total: 1 });
    requests[2].task.resolve({ list: [{ bvid: 'BVold' }], hasMore: true, total: 80 });
  });
  assert.deepEqual(tree.root.findByType('FlatList').props.data.map(t => t.bvid), ['BVnew']);
  await act(async () => tree.unmount());
});

test('large mobile storage uses async string I/O and commits only after the temporary write succeeds', async () => {
  const disk = new Map(), write = deferred(), operations = [];
  const storage = loader({
    'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } async text() { operations.push('readAsync'); return disk.get(this.uri); } } },
    'expo-file-system/legacy': { writeAsStringAsync: async (uri, value) => { operations.push('writeAsync'); await write.promise; disk.set(uri, value); } },
    'src/cloud/platform': { native: {}, directory: '/data/video-cloud', path: { join: (...parts) => parts.join('/'), dirname: () => '/data' },
      fs: { existsSync: uri => disk.has(uri), mkdirSync() {}, renameSync: (from, to) => { operations.push('commit'); disk.set(to, disk.get(from)); disk.delete(from); }, unlinkSync: uri => disk.delete(uri) } },
    '@react-native-async-storage/async-storage': { getItem: async () => null, removeItem: async () => operations.push('removeLegacy') },
  })('src/store/largeStorage.js').default;
  const saving = storage.setItem('biu.library@123', '你好'.repeat(1000000));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(operations, ['writeAsync']);
  write.resolve(); await saving;
  assert.deepEqual(operations, ['writeAsync', 'commit', 'removeLegacy']);
  assert.equal((await storage.getItem('biu.library@123')).length, 2000000);
  assert.equal(operations.at(-1), 'readAsync');
});

test('LAN idle probes reuse immutable snapshots and invalidate each independent profile and library edit', async () => {
  const { createLibrarySnapshot } = loader()('src/store/lanSync.js');
  const snapshot = createLibrarySnapshot();
  const R = require('../renderer/recommendation-profile');
  let saved = null;
  const manager = R.createManager({ read: async () => null, write: async value => { saved = value; }, get: async () => ({}), getLikes: () => [] });
  const profile = await manager.exportSync();
  assert.strictEqual(await manager.exportSync(), profile, 'idle exports retain identity for snapshot reuse');
  const original = { version: 1, likes: [{ bvid: 'BV1' }], library: [], playlists: [], recommendation: profile,
    discoveryRecommendation: R.normalize({ profiles: [{ id: 'beauty', name: '美女', tags: ['cos'] }] }) };
  const first = await snapshot(original);
  assert.strictEqual(await snapshot(original), first);
  const desktop = await snapshot(original, { discovery: false });
  assert.equal(desktop.library.discoveryRecommendation, undefined);
  assert.notEqual(desktop.revision, first.revision);
  const discoveryEdit = { ...original, discoveryRecommendation: R.normalize({ profiles: [{ id: 'beauty', name: '美女', tags: ['舞蹈'] }] }) };
  assert.notEqual((await snapshot(discoveryEdit)).revision, first.revision);
  assert.equal((await snapshot(discoveryEdit, { discovery: false })).revision, desktop.revision);
  const libraryEdit = { ...original, library: [{ bvid: 'BV2' }] };
  assert.notEqual((await snapshot(libraryEdit)).revision, first.revision);
  await manager.applySync(R.normalize({ profiles: [{ id: 'main', name: '音乐', tags: ['钢琴'] }] }));
  const mainEdit = await manager.exportSync();
  assert.notStrictEqual(mainEdit, profile); assert.ok(saved);
  assert.notEqual((await snapshot({ ...original, recommendation: mainEdit })).revision, first.revision);
  manager.dispose();
});


test('closing sheets immediately release touch and back even when animation completion never arrives', async () => {
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea });
  const Sheet = withOverlays(load, load('src/components/BottomSheet.js').default);
  const render = visible => React.createElement(Sheet, { visible, onClose() {} }, React.createElement('Text', null, 'Panel'));
  let tree;
  await act(async () => { tree = create(render(true)); });
  const surface = () => tree.root.findAllByType('AnimatedView').find(n => n.props.onLayout);
  await act(async () => surface().props.onLayout({ nativeEvent: { layout: { height: 300 } } }));
  await act(async () => animationCalls.at(-1).finish());
  const layers = () => tree.root.findAllByType('View').filter(n => 'accessibilityViewIsModal' in n.props);
  assert.equal(layers()[0].props.pointerEvents, 'auto');
  assert.equal(backListeners.size, 1);
  await act(async () => tree.update(render(false)));
  // Deliberately never finish the native close animation.
  assert.equal(layers()[0].props.pointerEvents, 'none');
  assert.equal(backListeners.size, 0, 'the next hardware back belongs to navigation');
  const content = tree.root.findAllByType('View').find(n => n.props.importantForAccessibility === 'auto');
  assert.notEqual(content.props.pointerEvents, 'none', 'the root app responder is never disabled');
  await act(async () => new Promise(resolve => setTimeout(resolve, 380)));
  assert.equal(layers().length, 0, 'missing callbacks cannot leak a permanent invisible portal');
  await act(async () => tree.unmount());
});

test('offscreen and frozen route overlays release the host and cannot mask a new page', async () => {
  const NavigationContext = React.createContext(null), listeners = new Map();
  let focused = true, closed = 0;
  const navigation = { isFocused: () => focused, addListener(name, callback) {
    if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback);
    return () => listeners.get(name).delete(callback);
  } };
  const load = loader({ 'react-native': rn, '@react-navigation/native': { NavigationContext } });
  const { default: Overlay, OverlayProvider } = load('src/components/Overlay.js');
  const render = text => React.createElement(OverlayProvider, null,
    React.createElement(NavigationContext.Provider, { value: navigation },
      React.createElement(Overlay, { onClose: () => closed++ }, React.createElement('Text', null, text))));
  let tree;
  await act(async () => { tree = create(render('old page')); });
  const layers = () => tree.root.findAllByType('View').filter(n => 'accessibilityViewIsModal' in n.props);
  assert.equal(layers().length, 1);
  await act(async () => { focused = false; for (const fn of listeners.get('blur')) fn(); });
  assert.equal(closed, 1);
  assert.equal(layers().length, 0);
  assert.equal(backListeners.size, 0);
  await act(async () => tree.update(render('late request from hidden page')));
  assert.equal(layers().length, 0, 'background completion on a mounted hidden route cannot reopen its portal');
  await act(async () => tree.unmount());
  assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 0);
});


test('nested portals retain their source navigation and release input when their parent starts closing', async () => {
  const NavigationContext = React.createContext(null), NavigationRouteContext = React.createContext(undefined);
  const route = { key: 'settings-1', name: 'Settings' }, navigation = { isFocused: () => true, addListener: () => () => {} };
  const load = loader({ 'react-native': rn, '@react-navigation/native': { NavigationContext, NavigationRouteContext } });
  const { default: Overlay, OverlayProvider } = load('src/components/Overlay.js');
  const observed = [];
  function Nested() {
    observed.push([React.useContext(NavigationContext), React.useContext(NavigationRouteContext)]);
    return React.createElement(Overlay, { onClose() {} }, React.createElement('Text', null, 'nested'));
  }
  const render = active => React.createElement(OverlayProvider, null,
    React.createElement(NavigationContext.Provider, { value: navigation },
      React.createElement(NavigationRouteContext.Provider, { value: route },
        React.createElement(Overlay, { active, onClose() {} }, React.createElement(Nested)))));
  let tree;
  await act(async () => { tree = create(render(true)); });
  assert.ok(observed.every(([nav, owner]) => nav === navigation && owner === route));
  const layers = () => tree.root.findAllByType('View').filter(n => 'accessibilityViewIsModal' in n.props);
  assert.equal(layers().length, 2);
  assert.equal(layers().filter(n => n.props.pointerEvents === 'auto').length, 1);
  await act(async () => tree.update(render(false)));
  assert.ok(layers().every(n => n.props.pointerEvents === 'none'), 'a retained nested dialog must not outlive parent input ownership');
  assert.equal(backListeners.size, 0);
  await act(async () => tree.unmount());
});


test('sheet resume restores visible content when opening animation or layout callbacks were interrupted', async () => {
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea });
  const Sheet = withOverlays(load, load('src/components/BottomSheet.js').default);
  let tree;
  await act(async () => { tree = create(React.createElement(Sheet, { visible: true, animationType: 'fade', onClose() {} }, 'visible panel')); });
  const animation = animationCalls.at(-1);
  assert.equal(animation.value.value, 0);
  // Do not dispatch onLayout or finish() at all; simulate returning from another app.
  await act(async () => { for (const fn of appStateListeners) fn('active'); });
  assert.equal(animation.value.value, 1, 'a visible modal cannot remain a transparent input blocker');
  await act(async () => tree.unmount());
});


test('cached discovery filtering yields to input and abort stops all following batches', async () => {
  let tagCalls = 0;
  const { filterDiscoveryCandidates } = loader({ 'src/api/bili': { videoTags: async () => { tagCalls++; return ['钢琴']; } } })('src/screens/discoveryFeed.js');
  const profile = require('../renderer/recommendation-profile').normalize({ auto: { tags: ['钢琴'] } });
  const candidates = Array.from({ length: 32 }, (_, i) => ({ bvid: 'BVfair' + i }));
  await filterDiscoveryCandidates(candidates, profile, () => {}, () => true);
  assert.equal(tagCalls, 32);
  const controller = new AbortController(), delivered = [];
  let inputHandled = false;
  await assert.rejects(filterDiscoveryCandidates(candidates, profile, batch => {
    delivered.push(...batch);
    setTimeout(() => { inputHandled = true; controller.abort(); }, 0);
  }, () => true, 'all', { signal: controller.signal }), /取消/);
  assert.equal(inputHandled, true);
  assert.equal(delivered.length, 4, 'input runs between cache-hit batches, before the remaining 28 candidates');
  assert.equal(tagCalls, 32, 'the test exercises cached metadata rather than network waiting');
});

test('sheet handles drive native dragging, spring back, dismiss on distance or velocity, and leave content scrolling alone', async () => {
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea });
  const Sheet = withOverlays(load, load('src/components/BottomSheet.js').default);
  let tree, closeCount = 0;
  const render = (visible, placement = 'bottom') => React.createElement(Sheet,
    { visible, placement, onClose: () => closeCount++ }, React.createElement('ScrollView', null, 'menu'));
  await act(async () => { tree = create(render(true)); });
  const surface = () => tree.root.findAllByType('AnimatedView').find(node => node.props.onLayout);
  await act(async () => surface().props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
  await act(async () => animationCalls.at(-1).finish());
  const handle = () => tree.root.findByType('PanGestureHandler');
  assert.equal(handle().findAllByType('ScrollView').length, 0, 'only the handle captures the pan');
  assert.equal(handle().props.onGestureEvent.options.useNativeDriver, true, 'movement stays off the JS thread');
  const drag = handle().props.onGestureEvent.mapping[0].nativeEvent.translationY;
  const finish = (translationY, velocityY = 0, state = 5) => act(async () => {
    handle().props.onGestureEvent({ nativeEvent: { translationY } });
    handle().props.onHandlerStateChange({ nativeEvent: { oldState: 4, state, translationY, velocityY } });
  });
  await finish(30);
  assert.equal(closeCount, 0);
  assert.equal(animationCalls.at(-1).config.toValue, 0);
  await act(async () => animationCalls.at(-1).finish());
  assert.equal(drag.value, 0);
  await finish(200, 900, 3);
  assert.equal(closeCount, 0, 'cancelled gestures always return to rest');
  await finish(-100, -1000);
  assert.equal(closeCount, 0, 'upward drags never close');
  await finish(85);
  assert.equal(closeCount, 1);
  await act(async () => tree.update(render(false)));
  assert.equal(handle().props.enabled, false);
  await act(async () => tree.update(render(true)));
  assert.equal(drag.value, 0, 'reopening cancels the previous drag offset');
  await finish(20, 1000);
  assert.equal(closeCount, 2, 'a deliberate fast downward flick closes');
  await act(async () => tree.update(render(false)));
  await act(async () => animationCalls.at(-1).finish());
  await act(async () => tree.update(render(true, 'center')));
  assert.equal(tree.root.findAllByType('PanGestureHandler').length, 0, 'centered confirmation dialogs keep their existing behavior');
  await act(async () => tree.unmount());
});

test('discovery spreads decoder creation and defers blur teardown without reviving cancelled buffers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const players = [], released = [];
  const pool = loader({
    'expo-video': { createVideoPlayer: () => {
      const id = players.length;
      const player = { addListener: () => ({ remove() {} }), replaceAsync: async () => {}, release: () => released.push(id) };
      players.push(player); return player;
    } },
    'src/api/bili': { videoUrl: async bvid => 'https://cdn/' + bvid },
    'src/api/client': { streamHeaders: () => ({}) },
  })('src/player/discoveryPreload.js');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const tick = async ms => { t.mock.timers.tick(ms); await flush(); };
  const tracks = [1, 2, 3].map(id => ({ bvid: 'BVframe' + id, cid: id }));
  pool.preloadDiscoveryQueue(tracks, 1, ''); await flush();
  assert.equal(players.length, 0, 'cached URLs do not allocate players in the entry commit');
  for (let count = 1; count <= 3; count++) { await tick(32); assert.equal(players.length, count); }
  pool.clearDiscoveryPreloads({ defer: true }); await flush();
  assert.deepEqual(released, [], 'blur does no synchronous native teardown');
  assert.equal(pool.takeDiscoveryPreload(tracks[0], 1, ''), null, 'invalidated players cannot be claimed');
  pool.preloadDiscoveryQueue([{ bvid: 'BVreturned', cid: 4 }], 1, ''); await flush();
  await tick(299); assert.deepEqual(released, []);
  await tick(1); assert.deepEqual(released, [0]);
  await tick(16); assert.deepEqual(released, [0, 1]);
  await tick(16); assert.deepEqual(released, [0, 1, 2]);
  assert.equal(players.length, 3, 'returning cannot allocate beyond the old decoder budget');
  await tick(16); await tick(32); assert.equal(players.length, 4);
  pool.clearDiscoveryPreloads(); assert.deepEqual(released, [0, 1, 2, 3]);
});

test('home search waits for entry before focusing and never opens the keyboard after leaving', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const listeners = new Map(); let focuses = 0, backs = 0;
  const navigation = { isFocused: () => true, goBack: () => backs++,
    addListener: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); } };
  const Search = loader({
    'react-native': { ...rn, TextInput: ({ ref, ...props }) => {
      React.useImperativeHandle(ref, () => ({ focus: () => focuses++ }));
      return React.createElement('TextInput', props);
    } },
    'react-native-safe-area-context': safeArea, 'src/components/icons': iconMock,
    'src/player/PlayerContext': { usePlayer: () => ({}) }, 'src/api/bili': {}, 'src/api/client': {},
    'src/components/TrackRow': 'TrackRow',
  })('src/screens/SearchScreen.js').default;
  let tree;
  const render = () => React.createElement(Search, { navigation, route: { name: 'SearchInput' } });
  await act(async () => { tree = create(render()); });
  assert.equal(focuses, 0);
  await act(async () => listeners.get('transitionEnd')({ data: { closing: false } }));
  assert.equal(focuses, 1);
  await act(async () => t.mock.timers.tick(300)); assert.equal(focuses, 1);
  await click(tree, '取消搜索'); assert.equal(backs, 1);
  await act(async () => tree.unmount());
  await act(async () => { tree = create(render()); });
  await act(async () => listeners.get('blur')());
  await act(async () => t.mock.timers.tick(300));
  assert.equal(focuses, 1, 'a quick back cancels delayed keyboard focus');
  await act(async () => tree.unmount());
  assert.equal(listeners.size, 0);
});

test('split recognition uses NCM first, Shazam fallback and releases native WASM signatures', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'src/split/identify.js'), 'utf8');
  let calls = [], freed = 0, hit = { title: 'Song' };
  const sandbox = vm.createContext({ ncm: { Encode: async () => 'fingerprint' },
    shazam: { init: async () => {}, DecodedSignature: { new: () => ({ uri: 'signature', samplems: 6000, free: () => freed++ }) } },
    renderClipRate: async pcm => pcm, rpc: async (method, args) => { calls.push({ method, args }); return method === 'netease' ? hit : { title: 'Fallback' }; } });
  vm.runInContext(source, sandbox);
  assert.equal((await sandbox.identifyAudioClip(new Float32Array(48000 * 6), 48000)).title, 'Song');
  assert.deepEqual(calls.map(v => v.method), ['netease']);
  hit = null; calls = [];
  assert.equal((await sandbox.identifyAudioClip(new Float32Array(48000 * 12), 48000)).title, 'Fallback');
  assert.deepEqual(calls.map(v => v.method), ['netease', 'shazam']); assert.equal(freed, 1);
  await assert.rejects(sandbox.identifyAudioClip(new Float32Array(1), 48000), /太短/);
  const match = loader({ 'src/api/client': { streamHeaders: () => ({ 'User-Agent': 'test' }) } })('src/split/service.js').matchFingerprint;
  await assert.rejects(match('shazam', { uri: 'file:///private', samplems: 1000 }, () => { throw Error('must not request'); }), /无效/);
  require('../mobile-rn/scripts/build-split.cjs')();
  const html = require('../mobile-rn/src/split/editor.generated.json');
  new vm.Script(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')));
  assert.ok(fs.readFileSync(path.join(root, 'src/split/runtime.js'), 'utf8').includes('return identifyAudioClip('));
});
