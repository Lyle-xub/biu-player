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

function loader(mocks = {}) {
  mocks = {
    'biu-lyric-monet': {},
    'expo-asset': { Asset: { fromModule: () => ({ downloadAsync: async () => {}, localUri: null }) } },
    'expo-application': { nativeApplicationVersion: '1.0.6', nativeBuildVersion: '20' },
    'biu-lyrics-pip': { setLyricsPiPEnabled() {}, updateLyricsPiP() {}, extractCoverColor: async () => null },
    'src/widgets/LyricsWidgets': { LyricsLiveActivity: { getInstances: () => [], start() {} }, LyricsWidget: { updateSnapshot() {} } },
    'expo-sharing': { isAvailableAsync: async () => false, shareAsync: async () => {} },
    'react-native-view-shot': { captureRef: async () => 'fixture.png' },
    'src/updates/service': { appUpdates: {}, useAppUpdates: () => ({ supported: false, loaded: false }) },
    ...mocks,
  };
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
    current: { bvid: 'lyrics-a', title: 'A' }, position: 7, playing: true, buffering: false,
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
  let starts = 0;
  const Sync = loader({
    'react-native': { Platform: { OS: 'ios' } },
    'biu-lyric-monet': {},
    'src/player/PlayerContext': { usePlayer: () => state },
    'src/player/track': { trackKeyOf: (track) => track?.bvid || '', segmentRange: trackModel.segmentRange },
    'src/player/loadLyrics': { loadTrackLyrics: () => loadedLyrics },
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

test('desktop and mobile recommendations, ranking and search retain short videos', async () => {
  let detailCalls = 0;
  const videos = [12, 30, 60].map((duration) => ({ bvid: 'BVshort' + duration, duration,
    type: 'video', goto: 'av', title: '短视频', tid: 3, owner: { mid: 1, name: 'UP' } }));
  const get = async (url) => {
    if (url.includes('/view?')) detailCalls++;
    const data = url.includes('/ranking/') ? { list: videos }
      : url.includes('/search/') ? { result: videos.map((v) => ({ ...v, duration: '0:' + v.duration })) }
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
    assert.deepEqual(ids((await api.search('短视频')).list), videos.map((v) => v.bvid));
    assert.deepEqual(ids(await (api.recommendMusic ? api.recommendMusic() : api.personalizedMusicRecommendations())),
      videos.map((v) => v.bvid));
  }
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

test('remote covers request bounded CDN images and rotate hosts when a fetch fails', () => {
  const load = loader({
    react: React,
    'react-native': rn,
    'expo-image': { Image: 'ExpoImage' },
    'src/api/client': { imageHeaders: () => ({ Referer: 'https://www.bilibili.com/' }) },
  });
  const { optimizedImageUri } = load('src/components/RemoteImage.js');
  const source = 'http://i0.hdslb.com/bfs/archive/cover.jpg';
  assert.equal(optimizedImageUri(source, 720, 450),
    'https://i0.hdslb.com/bfs/archive/cover.jpg@720w_450h_1c.webp');
  assert.equal(optimizedImageUri(source, 720, 450, 1),
    'https://i1.hdslb.com/bfs/archive/cover.jpg@720w_450h_1c.webp');
  assert.equal(optimizedImageUri(source, 720, 450, 2),
    'https://i2.hdslb.com/bfs/archive/cover.jpg@720w_450h_1c.webp');
  assert.equal(optimizedImageUri('https://covers.example/a.jpg', 720, 450),
    'https://covers.example/a.jpg');
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
  Easing: { linear: (x) => x, cubic: (x) => x, out: (x) => x, in: (x) => x, bezier: () => (x) => x },
  Animated: { Value, timing, spring: timing, parallel: (all) => ({ start: () => all.forEach((a) => a.start()) }), View: 'AnimatedView', Text: 'AnimatedText' },
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

function withOverlays(load, Component) {
  const { OverlayProvider } = load('src/components/Overlay.js');
  return (props) => React.createElement(OverlayProvider, null, React.createElement(Component, props));
}

test('app gives pushed screens their own background and waits for startup layout and logo', async () => {
  let hidden = 0;
  let expoGo = false;
  const splashOptions = [];
  const navigator = () => ({ Navigator: 'Navigator', Screen: 'Screen' });
  const mocks = {
    'react-native': { ...rn, Animated: { ...rn.Animated, Image: 'AnimatedImage' } },
    'react-native-safe-area-context': safeArea,
    '@react-navigation/native': { NavigationContainer: 'NavigationContainer', DefaultTheme: { colors: {} } },
    '@react-navigation/bottom-tabs': { createBottomTabNavigator: navigator },
    '@react-navigation/native-stack': { createNativeStackNavigator: navigator },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo': { isRunningInExpoGo: () => expoGo },
    'expo-splash-screen': { setOptions: (options) => splashOptions.push(options), preventAutoHideAsync: async () => {}, hideAsync: async () => { hidden++; } },
    'expo-blur': { BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-svg': { __esModule: true, default: 'Svg', Defs: 'Defs', RadialGradient: 'RadialGradient', Rect: 'Rect', Stop: 'Stop' },
    'src/player/PlayerContext': { PlayerProvider: 'PlayerProvider' },
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
  assert.equal(stack.screenOptions.animation, 'none', 'the page performs one complete transition before popping');
  assert.equal(stack.screenOptions.presentation, 'transparentModal');
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
  assert.equal(hidden, 0);
  await act(async () => chrome.root.findByType('AnimatedImage').props.onLoadEnd());
  assert.equal(hidden, 0, 'image loading alone must not uncover an unlaid-out view');
  await act(async () => chrome.root.findByType('AnimatedView').props.onLayout());
  assert.equal(hidden, 1);
  assert.equal(animationCalls.length, before + 1);
  const fade = animationCalls.at(-1);
  assert.ok(fade.config.delay >= 350, 'allow the native splash fade to finish');
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
  assert.equal(chrome.root.findByType('MiniBar').props.visible, true,
    'the mini player enters only after the closing transition ends');
  await act(async () => chrome.unmount());
  await act(async () => tree.unmount());
});

test('ordinary pages retain their content until the exit animation completes and only the focused page blocks removal', async () => {
  let prevent, focused = true, unmounted = 0;
  const dispatched = [];
  const load = loader({
    'react-native': rn,
    '@react-navigation/native': {
      useIsFocused: () => focused,
      usePreventRemove: (enabled, callback) => { prevent = enabled ? callback : null; },
    },
  });
  const Page = load('src/components/PageTransition.js').default;
  function Content() {
    React.useEffect(() => () => { unmounted++; }, []);
    return React.createElement('Text', null, '设置页完整内容');
  }
  const navigation = { dispatch: (action) => dispatched.push(action) };
  const render = () => React.createElement(Page, { navigation }, React.createElement(Content));
  let tree;
  const before = animationCalls.length;
  await act(async () => { tree = create(render()); });
  assert.equal(animationCalls.length, before, 'entry waits for final layout');
  await act(async () => tree.root.findByType('View').props.onLayout({ nativeEvent: { layout: { width: 412 } } }));
  await act(async () => animationCalls.at(-1).finish());
  const content = tree.root.findByType('Text');
  const action = { type: 'GO_BACK', source: 'Settings', target: 'root' };
  await act(async () => prevent({ data: { action } }));
  const exit = animationCalls.at(-1);
  assert.equal(exit.config.useNativeDriver, true);
  assert.equal(exit.config.toValue, 1);
  assert.deepEqual(dispatched, []);
  assert.equal(unmounted, 0);
  assert.equal(tree.root.findByType('Text'), content, 'live content must not disappear before the background finishes moving');
  assert.equal(tree.root.findByType('AnimatedView').props.style[1].opacity, undefined);
  assert.deepEqual(tree.root.findByType('AnimatedView').props.style[1].transform[0].translateX.config.outputRange, [0, 412]);
  const count = animationCalls.length;
  await act(async () => prevent({ data: { action } }));
  assert.equal(animationCalls.length, count, 'repeated back presses cannot start multiple exits');
  await act(async () => exit.finish());
  assert.deepEqual(dispatched, [action]);
  focused = false;
  await act(async () => tree.update(render()));
  assert.equal(prevent, null, 'underlying routes must not intercept a multi-page back action');
  await act(async () => tree.unmount());
  assert.equal(unmounted, 1);
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
    'src/player/PlayerContext': { usePlayer: () => context }, 'src/components/icons': iconMock,
    '@react-native-async-storage/async-storage': storage,
  });
  return { Component: withOverlays(load, load('src/components/VideoActionBar.js').default), calls, context, webScripts };
}
const track = { bvid: 'A', cid: 10, title: 'Mix', pic: 'https://cdn/cover.jpg' };

test('app sheets wait for layout, keep closing content, and survive a rapid reopen', async () => {
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
  assert.equal(animationCalls.length, before, 'do not reveal unmeasured content');
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

test('home fills recommendation batches across sparse pages and supplements only missing music items', async () => {
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
  assert.deepEqual(requests, [[0, 30]]);
  const checkRecommendations = (total) => {
    const banner = tree.root.findByType('HomeBanner').props.tracks;
    const feed = tree.root.findAllByType('TrackCard').map((card) => card.props.track);
    assert.equal(banner.length, 5);
    assert.equal(feed.length, total - banner.length);
    assert.equal(new Set([...banner, ...feed].map((track) => track.bvid)).size, total,
      'carousel and waterfall partition the recommendations without duplicate videos');
  };
  checkRecommendations(30);
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
  assert.deepEqual(requests, [[0, 30], [1, 30]]);
  checkRecommendations(60);
  await act(async () => {
    tree.root.findByType('FlatList').props.refreshControl.props.onRefresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  checkRecommendations(30);
  assert.deepEqual(requests, [[0, 30], [1, 30], [2, 30]], 'refresh continues at the next platform page');
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
  assert.deepEqual(musicRequests, [0, 1, 2, 3, 4], 'empty and duplicate results do not count towards the batch target');
  checkRecommendations(20);
  assert.equal(rankRequests, 1, 'enough personalized music needs no ranking supplement');
  await act(async () => {
    tree.root.findByType('FlatList').props.onScrollBeginDrag();
    tree.root.findByType('FlatList').props.onScrollEndDrag({ nativeEvent: {
      contentOffset: { y: 1500 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 },
    } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(musicRequests, Array.from({ length: 13 }, (_, i) => i),
    'pagination resumes at the next unread page and stops after eight sparse pages');
  const cards = tree.root.findAllByType('TrackCard');
  checkRecommendations(40);
  assert.equal(cards.filter((card) => card.props.track.recommendationReason === '音乐热榜').length, 20);
  assert.equal(rankRequests, 2);
  failRecommendations = true;
  await act(async () => {
    tree.root.findByType('FlatList').props.onScrollBeginDrag();
    tree.root.findByType('FlatList').props.onEndReached();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(musicRequests.at(-1), 13);
  checkRecommendations(40);
  await act(async () => tree.unmount());
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
    assert.equal(platformPages.at(-1), page);
    assert.equal(profileRequests.at(-1).page, page);
    assert.deepEqual(new Set(profileRequests.at(-1).exclude), new Set(before));
    assert.ok(visibleIds().every((id) => !before.includes(id)), 'refresh must replace previously displayed videos');
  }
  scope = 'account-b';
  await act(async () => tree.update(React.createElement(Home, { navigation: {} })));
  assert.equal(platformPages.at(-1), 0, 'another account starts a separate feed');
  assert.equal(profileRequests.at(-1).page, 0);
  assert.deepEqual(profileRequests.at(-1).exclude, []);
  await act(async () => tree.unmount());
});

test('strict custom home waits for profile restore and excludes unrelated carousel, feed and fallback videos', async () => {
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
  assert.equal(platformCalls, 0, 'saved custom selection cannot briefly show platform recommendations');
  await act(async () => gate.resolve(R.normalize({ profiles: [{ id: 'p', name: '钢琴', tags: ['钢琴'] }], activeId: 'p' })));
  assert.equal(tree.root.findByType('HomeBanner').props.tracks.length, 5);
  assert.equal(tree.root.findAllByType('TrackCard').length, 1, 'first page displays before the remaining searches finish');
  await act(async () => tree.root.findByType('FlatList').props.onEndReached());
  assert.equal(requests.length, 1, 'streaming cannot start another concurrent refresh');
  await act(async () => remaining.resolve());
  assert.equal(tree.root.findByType('HomeBanner').props.tracks.length, 5);
  assert.equal(tree.root.findAllByType('TrackCard').length, 2);
  assert.equal(platformCalls, 0);
  assert.equal(tree.root.findAllByProps({ accessibilityLabel: '加载更多推荐' }).length, 0);
  await act(async () => tree.root.findByType('FlatList').props.onEndReached());
  assert.equal(requests.length, 1, 'layout changes alone must not request another batch');
  await act(async () => {
    tree.root.findByType('FlatList').props.onScrollBeginDrag();
    tree.root.findByType('FlatList').props.onEndReached();
  });
  assert.equal(requests.at(-1).page, 1);
  assert.equal(requests.at(-1).mode, 'music');
  assert.equal(requests.at(-1).exclude.length, 7);
  assert.equal(tree.root.findAllByType('TrackCard').length, 2, 'empty next page retains only matching existing content');
  await act(async () => tree.root.findByType('FlatList').props.onScrollBeginDrag());
  await act(async () => tree.root.findByType('FlatList').props.onScrollEndDrag({ nativeEvent: {
    contentOffset: { y: 0 }, contentSize: { height: 400 }, layoutMeasurement: { height: 800 },
  } }));
  assert.equal(requests.at(-1).page, 2, 'drag can continue after an empty batch without a load-more button');
  fail = true;
  await act(async () => tree.root.findByType('FlatList').props.refreshControl.props.onRefresh());
  assert.equal(platformCalls, 0);
  assert.equal(tree.root.findAllByType('HomeBanner').length, 1);
  assert.equal(tree.root.findAllByType('TrackCard').length, 2, 'failed refresh keeps already loaded matching videos');
  fail = false;
  await act(async () => manager.edit({ type: 'select', id: 'auto' }));
  assert.equal(platformCalls, 1, 'automatic profile keeps platform discovery');
  const visible = tree.root.findAllByType('TrackCard').map((card) => card.props.track.bvid);
  await act(async () => requests[0].onBatch([{ bvid: 'BVstaleProfile', title: '旧画像迟到结果' }]));
  assert.deepEqual(tree.root.findAllByType('TrackCard').map((card) => card.props.track.bvid), visible,
    'a callback from the previous custom selection cannot modify the new feed');
  const beforeSync = await manager.exportSync(), learned = structuredClone(beforeSync);
  learned.auto.updatedAt = Date.now();
  learned.auto.tags = [{ name: '古典', weight: 100 }];
  const requestsBeforeSync = requests.length;
  await act(async () => manager.applySync(learned, beforeSync));
  assert.equal(platformCalls, 1, 'background learning sync must not reload the visible home feed');
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
    'src/player/PlayerContext': { PLAY_MODES: ['loop', 'single', 'shuffle'], usePlayer: () => {
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

test('media layout is ready before entry; drag reveals tabs continuously and back dispatch waits for completion', async () => {
  let remove, result; const dispatched = [];
  const navigation = { dispatch: (a) => dispatched.push(a), goBack: () => remove({ data: { action: { type: 'GO_BACK' } } }) };
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea,
    '@react-navigation/native': { usePreventRemove: (enabled, cb) => { if (enabled) remove = cb; } } });
  const { default: useTransition, mediaScreenOptions } = load('src/player/useMediaTransition.js');
  function Screen() { result = useTransition(navigation); return null; }
  const offset = (style) => {
    const { source, config: { inputRange, outputRange } } = style.transform[0].translateY;
    const end = inputRange.findIndex((x, i) => i > 0 && source.value <= x);
    const i = end === -1 ? inputRange.length - 1 : end;
    return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1])
      * (source.value - inputRange[i - 1]) / (inputRange[i] - inputRange[i - 1]);
  };
  let tree;
  const before = animationCalls.length;
  await act(async () => { tree = create(React.createElement(Screen)); });
  assert.equal(mediaScreenOptions.presentation, 'transparentModal');
  assert.equal(animationCalls.length, before, 'do not animate before native layout');
  await act(async () => result.onLayout({ nativeEvent: { layout: { height: 900 } } }));
  assert.equal(offset(result.style) + offset(result.viewportStyle), 900, 'use real page height, not window estimate');
  assert.equal(animationCalls.at(-1).config.toValue, 0);
  await act(async () => animationCalls.at(-1).finish());
  const opened = animationCalls.length;
  await act(async () => result.onLayout({ nativeEvent: { layout: { height: 920 } } }));
  assert.equal(animationCalls.length, opened, 'relayout must not replay the entry animation');
  assert.equal(offset(result.style) + offset(result.viewportStyle), 0);
  const fixedInsets = result.safeStyle;
  for (const dy of [46, 92, 230]) {
    result.panHandlers.onPanResponderMove(null, { dy });
    assert.ok(offset(result.viewportStyle) < 0, 'navigation begins to appear during the drag');
    assert.ok(Math.abs(offset(result.style) + offset(result.viewportStyle) - dy) < 0.001, 'page follows the finger exactly');
    assert.deepEqual(result.safeStyle, fixedInsets, 'moving content must not recalculate safe-area padding');
  }
  result.panHandlers.onPanResponderRelease(null, { dy: 10, vy: 0 });
  assert.equal(animationCalls.at(-1).config.toValue, 0);
  await act(async () => animationCalls.at(-1).finish());
  assert.equal(offset(result.viewportStyle), 0, 'cancelled drag covers tabs again');
  const action = { type: 'GO_BACK', source: 'Player' };
  await act(async () => remove({ data: { action } }));
  assert.equal(dispatched.length, 0);
  assert.equal(animationCalls.at(-1).config.toValue, 1);
  const exits = animationCalls.length;
  await act(async () => remove({ data: { action } }));
  assert.equal(animationCalls.length, exits, 'duplicate back does not start another exit');
  await act(async () => animationCalls.at(-1).finish());
  assert.equal(dispatched[0], action);
  await act(async () => tree.unmount());

  await act(async () => { tree = create(React.createElement(Screen)); });
  await act(async () => remove({ data: { action } }));
  const earlyExit = animationCalls.at(-1);
  await act(async () => result.onLayout({ nativeEvent: { layout: { height: 900 } } }));
  assert.equal(animationCalls.at(-1), earlyExit, 'late layout cannot override an immediate back');
  await act(async () => earlyExit.finish());
  await act(async () => tree.unmount());
});

test('player publishes system media metadata, seeks within segments and advances exactly once at the boundary', async () => {
  const listeners = {};
  let replacements = 0;
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 400,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async updateMetadata(metadata) { this.publishedMetadata = metadata; },
    async replaceAsync(source) { replacements += 1; this.source = source; this.currentTime = 0; } };
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

test('system previous and next follow the latest queue, including single-repeat and paused playback', async () => {
  const listeners = {};
  const player = { playing: false, status: 'readyToPlay', currentTime: 0, duration: 180,
    play() { this.playing = true; }, pause() { this.playing = false; },
    async replaceAsync(source) { this.source = source; this.currentTime = 0; } };
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
    await act(async () => context.playQueue(tracks));
    await act(async () => context.setPlayMode('single'));
    await act(async () => listeners.nextTrack());
    assert.equal(context.current.bvid, 'B', 'remote next bypasses automatic single-repeat');
    await act(async () => listeners.previousTrack());
    assert.equal(context.current.bvid, 'A');
    player.pause();
    await act(async () => listeners.previousTrack());
    assert.equal(context.current.bvid, 'C', 'previous wraps to the last track');
    assert.equal(player.playing, true, 'manual transport resumes the selected track');
    await act(async () => context.playQueue([tracks[2], tracks[0], tracks[1]]));
    await act(async () => listeners.nextTrack());
    assert.equal(context.current.bvid, 'A', 'remote callbacks read the reordered queue');
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
    async replaceAsync() { replacements++; this.currentTime = 0; } };
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
    async replaceAsync(source) { this.source = source; this.currentTime = 0; },
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
  background = true;
  player.playing = false; // STATE_ENDED retains playWhenReady and the foreground service.
  await act(async () => { listeners.timeUpdate({ currentTime: 399.8 }); });
  assert.equal(context.index, 1);
  assert.equal(context.buffering, true);
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
    async replaceAsync(source) { this.source = source; this.currentTime = 0; } };
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
  assert.equal(clock.config.toValue, 3601);
  assert.equal(clock.config.duration, 3600000, 'the native clock runs continuously instead of restarting at each sample');
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
  await act(async () => tree.unmount());
  assert.equal(appStateListeners.size, 0);
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
  let restore = null;
  const videoRequests = [];
  const player = { playing: false, duration: 120, pause() {}, play() {}, replaceAsync: async () => {} };
  const load = loader({
    'src/store/LanSyncProvider': { useLanSync: () => ({ enabled: true, ready: true, setEnabled() {} }) },
    'src/store/CloudSyncProvider': { useCloudSync: () => ({}) },
    'react-native': rn, 'react-native-safe-area-context': safeArea, 'src/components/icons': iconMock,
    '@react-navigation/native': { useIsFocused: () => true },
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => player },
    'src/components/RecommendationProfileCard': { default: () => null, __esModule: true },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' }, useEventListener() {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => key === 'biu.lyric-effect' && restore ? restore.promise : saved.get(key) ?? null,
      setItem: async (key, value) => saved.set(key, value),
    },
    'src/api/bili': { videoUrl: async (...args) => { videoRequests.push(args); return 'https://cdn/video.mp4'; } },
    'src/api/client': { streamHeaders: () => ({}) },
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const Settings = load('src/screens/SettingsScreen.js').default;
  let context, tree;
  function Probe() { context = usePlayer(); return React.createElement(Settings, { navigation: {} }); }
  const mount = async () => act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  await mount();
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
  assert.equal(touch(tree, '音乐分区推荐').props.accessibilityState.checked, true);
  await click(tree, '全部推荐');
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
    complete=()=>resolve({ok:true,json:async()=>({version:2,account:'123',deviceId:peer.id})});
    opts.signal.addEventListener('abort',()=>reject(Error('fetch failed')),{once:true});
  });};
  const timeout=assert.rejects(lanRequest(peer,'123','status'),/连接电脑超时/);
  t.mock.timers.tick(3000);await timeout;
  const transfer=lanRequest(peer,'123','sync',{clientId:'phone-test',library:{}});
  t.mock.timers.tick(5000);assert.equal(options.signal.aborted,false);
  assert.equal(options.credentials,'omit');complete();await transfer;
  peer.addresses.push('192.168.1.3:4000');calls=0;
  global.fetch=async()=>{calls++;return {ok:false,json:async()=>({error:'两端登录账号不同'})};};
  await assert.rejects(lanRequest(peer,'123','sync',{}),/账号不同/);
  assert.equal(calls,1);
});

test('automatic mobile sync runs outside settings, survives reconnect, persists opt-out and never crosses accounts', async (t) => {
  const { createLanSync } = require('../lan-sync');
  const R = require('../renderer/recommendation-profile');
  const { EventEmitter } = require('node:events');
  const phoneSong = { bvid: 'BVphone', cid: 1, title: 'Phone song' };
  const desktopSong = { bvid: 'BVdesktop', cid: 2, title: 'Desktop song' };
  const disk = new Map([
    ['biu.likes@123', JSON.stringify([phoneSong])],
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
      assert.equal(implementation, 'DNSSD');
      scans++;
      queueMicrotask(() => {
        this.emit('resolved', { ...advertised, addresses: ['127.0.0.1'], txt: { ...advertised.txt, account: 'other-account' } });
        this.emit('resolved', { ...advertised, addresses: ['127.0.0.1'] });
      });
    }
    stop(implementation) { assert.equal(implementation, 'DNSSD'); }
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
    'src/store/lanSync': { ...transport, startAutoSync: (options) => transport.startAutoSync({ ...options, interval: 30 }) },
    'src/store/CloudSyncProvider': { useCloudSync: () => ({}) },
    'src/components/RecommendationProfileCard': { __esModule:true, default:()=>null },
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => ({ playing: false, duration: 0 }) },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' }, useEventListener() {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => { if (failStorage && key === 'biu.playlists@123') throw new Error('手机存储空间不足'); disk.set(key, value); },
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
    'src/player/PlayerContext': { usePlayer: () => ({
      current: room, isLive: true, player: mediaPlayer, account, playing: true, buffering, lyricSettings: {},
      isLiked: () => false, playQueue: (...args) => plays.push(args),
    }) },
  });
  const Radio = load('src/screens/RadioScreen.js').default;
  let radio;
  const navigation = { navigate: (route) => routes.push(route) };
  await act(async () => { radio = create(React.createElement(Radio, { navigation })); });
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
  let saved, pulseStarts = 0, pulseStops = 0;
  const manager = R.createManager({ read: async () => null, write: async (value) => { saved = value; }, getLikes: () => [], get() {} });
  await manager.ready();
  const load = loader({
    'react-native': { ...rn, Animated: { ...rn.Animated, sequence: (animations) => animations,
      loop: () => ({ start: () => { pulseStarts++; }, stop: () => { pulseStops++; } }) } },
    'react-native-svg': { SvgXml: 'SvgXml' },
    '../renderer/profile-presentation': { ...require('../renderer/profile-presentation'),
      quoteFor: async () => ({ text: '用于检查的主题语录', from: '测试来源', author: '' }) },
    'src/player/PlayerContext': { usePlayer: () => ({ recommendationManager: manager,
      recommendationProfile: React.useSyncExternalStore(manager.subscribe, manager.getSnapshot),
      libraryReady: true, account: { isLogin: true, mid: 1 } }) },
  });
  const Card = load('src/components/RecommendationProfileCard.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Card)); });
  assert.equal(tree.root.findAllByType('SvgXml').length, 1);
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
