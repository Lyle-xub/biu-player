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
  const cache = new Map();
  const load = (file) => {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.js';
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
      return fromMobile(name);
    };
    new Function('require', 'module', 'exports', code)(req, module, module.exports);
    return module.exports;
  };
  return load;
}

const motion = loader()('src/player/lyricMotion.js');
const trackModel = loader()('src/player/track.js');

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
});

test('segment track identities distinguish two songs from one video; invalid ranges are rejected', () => {
  const tracks = trackModel.segmentTracks({ bvid: 'BV1', cid: 4, title: 'Mix' }, [
    { from: 0, to: 10, name: 'One' }, { from: 10, to: 30, name: 'Two' },
  ]);
  assert.notEqual(trackModel.trackKeyOf(tracks[0]), trackModel.trackKeyOf(tracks[1]));
  assert.deepEqual(trackModel.segmentRange(tracks[1]), { from: 10, to: 30 });
  assert.equal(tracks[1].duration, 20);
  assert.equal(trackModel.segmentRange({ isSegment: true, from: 10, to: 5 }), null);
});

test('timestamp parser handles hour marks, duplicate / invalid times and numeric song names', () => {
  const api = loader({ './client': {} })('src/api/bili.js');
  const list = api.parseTimestampLines('00:00 1984\n00:02 Two\n00:02 Duplicate\n01:75 invalid\n1:00:00 Hour\n1:01:00 outside', 3660);
  assert.deepEqual(list, [{ from: 0, to: 2, name: '1984' }, { from: 2, to: 3600, name: 'Two' }, { from: 3600, to: 3660, name: 'Hour' }]);
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
const rn = {
  ...Object.fromEntries(['View', 'Text', 'Image', 'TouchableOpacity', 'Pressable', 'TextInput', 'ScrollView', 'KeyboardAvoidingView', 'ActivityIndicator'].map((k) => [k, host(k)])),
  Modal: ({ visible, children, ...props }) => visible ? React.createElement('Modal', props, children) : null,
  FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent, ...props }) => React.createElement('FlatList', { ...props, data },
    ListHeaderComponent,
    data.length ? data.map((item, index) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))) : ListEmptyComponent,
    ListFooterComponent),
  Platform: { OS: 'android' },
  AppState: { currentState: 'active', addEventListener: (_, fn) => {
    appStateListeners.add(fn); return { remove: () => appStateListeners.delete(fn) };
  } },
  StyleSheet: { create: (x) => x, absoluteFill: {}, absoluteFillObject: {} },
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

function actionHarness(overrides = {}) {
  const calls = [];
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
    'react-native': rn, '@react-navigation/native': { useIsFocused: () => true },
    'react-native-safe-area-context': safeArea,
    'expo-file-system/legacy': disk, 'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri) => calls.push(['share', uri]) },
    'src/api/bili': api, 'src/api/client': { authStatus: async () => ({ isLogin: true }), imageHeaders: () => ({}), streamHeaders: () => ({ Referer: 'bilibili' }) },
    'src/player/PlayerContext': { usePlayer: () => context }, 'src/components/icons': iconMock,
    '@react-native-async-storage/async-storage': storage,
  });
  return { Component: load('src/components/VideoActionBar.js').default, calls, context };
}
const track = { bvid: 'A', cid: 10, title: 'Mix', pic: 'https://cdn/cover.jpg' };

test('bottom sheets wait for native presentation and layout, keep closing content, and survive a rapid reopen', async () => {
  const load = loader({ 'react-native': rn, 'react-native-safe-area-context': safeArea });
  const Sheet = load('src/components/BottomSheet.js').default;
  let tree;
  const render = (visible) => React.createElement(Sheet, { visible, onClose() {}, style: { maxHeight: visible ? '62%' : '68%' } },
    visible ? React.createElement('Text', null, '歌词匹配内容') : null);
  await act(async () => { tree = create(render(false)); });
  assert.equal(tree.toJSON(), null);
  const before = animationCalls.length;
  await act(async () => tree.update(render(true)));
  const modal = tree.root.findByType('Modal');
  assert.equal(modal.props.animationType, 'none', 'the window and safe area must not slide');
  assert.equal(modal.props.hardwareAccelerated, true);
  assert.ok(modal.props.navigationBarTranslucent && modal.props.statusBarTranslucent);
  await act(async () => modal.props.onShow());
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
  assert.equal(tree.root.findAllByType('Modal').length, 1, 'stale completion cannot dismiss a reopened sheet');
  await act(async () => animationCalls.at(-1).finish());
  await act(async () => tree.update(render(false)));
  await act(async () => animationCalls.at(-1).finish());
  assert.equal(tree.toJSON(), null);
  await act(async () => tree.unmount());
});

test('home fills recommendation batches across sparse pages and supplements only missing music items', async () => {
  const requests = [];
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
      playQueue() {}, likes: [], recommendMode, account,
    }) },
    'src/components/TrackCard': { default: 'TrackCard', __esModule: true },
    'src/components/HomeBanner': { default: 'HomeBanner', __esModule: true },
    'src/components/icons': iconMock,
  });
  const Home = load('src/screens/HomeScreen.js').default;
  let tree;
  await act(async () => {
    tree = create(React.createElement(Home, { navigation: { navigate() {} } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(requests, [[0, 30]]);
  const scroll = tree.root.findByType('FlatList');
  await act(async () => {
    scroll.props.onEndReached();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(requests, [[0, 30], [1, 30]]);
  assert.equal(tree.root.findAllByType('TrackCard').length, 60,
    'the carousel previews recommendations without removing them from the feed');
  account = { isLogin: false };
  await act(async () => {
    tree.update(React.createElement(Home, { navigation: { navigate() {} } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(rankRequests, 1, 'guest recommendations switch to the music ranking');
  assert.equal(tree.root.findAllByType('TrackCard').length, 20, 'guest ranking also keeps its complete feed');
  account = { isLogin: true };
  recommendMode = 'music';
  await act(async () => {
    tree.update(React.createElement(Home, { navigation: { navigate() {} } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(musicRequests, [0, 1, 2, 3, 4], 'empty and duplicate results do not count towards the batch target');
  assert.equal(tree.root.findAllByType('TrackCard').length, 20);
  assert.equal(tree.root.findByType('HomeBanner').props.tracks.length, 5);
  assert.equal(rankRequests, 1, 'enough personalized music needs no ranking supplement');
  await act(async () => {
    touch(tree, '加载更多推荐').props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(musicRequests, Array.from({ length: 13 }, (_, i) => i),
    'pagination resumes at the next unread page and stops after eight sparse pages');
  const cards = tree.root.findAllByType('TrackCard');
  assert.equal(cards.length, 40, 'the next batch fills twenty new entries from music ranking');
  assert.equal(new Set(cards.map((card) => card.props.track.bvid)).size, 40);
  assert.equal(cards.filter((card) => card.props.track.recommendationReason === '音乐热榜').length, 20);
  assert.equal(rankRequests, 2);
  failRecommendations = true;
  await act(async () => {
    tree.root.findByType('FlatList').props.onEndReached();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(musicRequests.at(-1), 13);
  assert.equal(tree.root.findAllByType('TrackCard').length, 40, 'failed pagination preserves the visible feed');
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
  const Screen = load('src/screens/PlayerScreen.js').default;
  let tree;
  await act(async () => { tree = create(React.createElement(Screen, { route: {}, navigation: {} })); });
  const video = tree.root.findByType('VideoView');
  assert.equal(video.props.contentFit, 'contain', 'the original video must remain uncropped');
  assert.equal(video.props.useExoShutter, true, 'Android must not leave the texture transparent after a missed first-frame event');
  assert.equal(video.props.style.flex, 1, 'the native texture gets a measured flex layout instead of an absolute zero-size race');
  const videoFrame = tree.root.findAllByType('View').find((n) => n.props.style?.[0]?.aspectRatio === 16 / 9);
  assert.equal(videoFrame.props.style[0].overflow, undefined, 'the outer glow must not be clipped');
  const coverGlow = videoFrame.findAllByType('ExpoImage').find((n) => n.props.blurRadius === 28);
  assert.equal(coverGlow.props.source.uri, track.pic, 'the glow colors come from the current cover');
  const scrubber = tree.root.findAll((n) => n.props.accessibilityRole === 'adjustable')[0];
  await act(async () => scrubber.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  await act(async () => scrubber.props.onResponderGrant({ nativeEvent: { locationX: 40 } }));
  await act(async () => scrubber.props.onResponderMove({ nativeEvent: { locationX: 120 } }));
  assert.deepEqual(seeks, [], 'dragging moves only local UI and does not seek the native decoder');
  const thumb = scrubber.findAllByType('AnimatedView').find((n) => n.props.style.some?.((s) => s?.left));
  assert.equal(thumb.props.style.find((s) => s?.left).left.source.value, 0.6, 'thumb follows the finger immediately');
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
  await act(async () => lyricButton.props.onPress());
  assert.ok(touch(tree, '取消我喜欢'), 'lyric mode shares the same local like state');
  await click(tree, '取消我喜欢');
  assert.equal(touch(tree, '加入我喜欢').props.accessibilityState.selected, false);
  assert.deepEqual(likedTracks, [track, track]);
  assert.equal(tree.root.findAllByType('IconStar').length, 0);
  assert.equal(tree.root.findAllByType('IconVolumeLow').length, 0);
  const more = tree.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('IconMore').length);
  await act(async () => more.props.onPress());
  const menuWindow = tree.root.findByType('Modal');
  const addToPlaylist = tree.root.findAllByType('TouchableOpacity').find((n) =>
    n.findAllByType('Text').some((t) => t.props.children === '加入歌单'));
  await act(async () => addToPlaylist.props.onPress());
  assert.equal(tree.root.findByType('Modal'), menuWindow, 'menu to playlist must reuse the native window');
  assert.equal(tree.root.findByType('TextInput').props.placeholder, '新建歌单…');
  await act(async () => tree.root.findByType('Modal').props.onRequestClose());
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
  await click(tree, '关闭面板'); await click(tree, '分切'); await click(tree, '播放分切 Two');
  const queued = h.calls.find((c) => c[0] === 'queue');
  assert.equal(queued[2], 1); assert.equal(queued[1][1].from, 100); assert.equal(queued[1][1].duration, 300);
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
  const list = trackModel.segmentTracks({ bvid: 'A', cid: 10, title: 'Mix', up: 'Artist', pic: 'https://cdn/cover.jpg' }, [
    { from: 20, to: 40, name: 'One' }, { from: 40, to: 70, name: 'Two' },
  ]);
  await act(async () => { await context.playQueue(list); });
  assert.deepEqual(player.source.metadata, { title: 'Mix', artist: 'Artist', artwork: 'https://cdn/cover.jpg' });
  assert.equal(player.currentTime, 20); assert.equal(context.position, 0); assert.equal(context.duration, 20);
  player.pause();
  await act(async () => context.seekTo(5));
  assert.equal(player.currentTime, 25); assert.equal(context.position, 5);
  assert.equal(context.seekRevision, 1, 'explicit seeks are visible to lyric interpolation');
  await act(async () => context.seekTo(-8)); assert.equal(player.currentTime, 20);
  await act(async () => context.seekTo(100)); assert.equal(player.currentTime, 40);
  assert.equal(context.position, 20);
  player.play();
  await act(async () => { listeners.timeUpdate({ currentTime: 40 }); listeners.playToEnd(); });
  assert.equal(urls.length, 1, 'adjacent segments keep the loaded video source and its rendered frame');
  assert.equal(replacements, 1, 'same-video segments seek without clearing the native texture');
  assert.equal(context.index, 1); assert.equal(player.currentTime, 40); assert.equal(context.duration, 30);
  assert.equal(context.history.length, 2, 'both segments remain in history');
  assert.equal(player.source.metadata.title, 'Mix', 'system controls keep the parent video title while its segments reuse one source');
  await act(async () => { await context.playQueue([{ isLive: true, roomid: 100, title: 'Live radio', up: 'Host' }]); });
  assert.equal(player.source.contentType, 'hls');
  assert.deepEqual(player.source.metadata, { title: 'Live radio', artist: 'Host', artwork: undefined }, 'live sources replace all metadata without retaining the previous cover');
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
  const MiniBar = load('src/components/MiniBar.js').default;
  let context, tree;
  const blurTarget = { current: {} };
  function Probe() { context = usePlayer(); return React.createElement(MiniBar, { blurTarget }); }
  const render = () => React.createElement(PlayerProvider, null, React.createElement(Probe));
  await act(async () => { tree = create(render()); });
  assert.equal(tree.toJSON(), null);
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
  const window = tree.root.findByType('Modal');
  assert.equal(window.props.navigationBarTranslucent, true);
  await click(tree, '播放模式：列表循环');
  assert.equal(context.playMode, 'single');
  assert.equal(writes.get('biu.play-mode'), '"single"');
  await act(async () => delayedMode.resolve('"shuffle"'));
  restoreDelayed = false;
  assert.equal(context.playMode, 'single', 'late restore cannot overwrite a mode chosen in the queue');
  assert.equal(tree.root.findByType('Modal'), window, 'mode changes preserve the sheet window');
  player.play();
  for (let i = 0; i < 2; i++) {
    const before = urls.length;
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
  assert.equal(clock.config.toValue, 1.6);
  clock.value.setValue(1.28); // Native frame between React updates.
  const moving = animatedAt(front(masks[0]));
  await act(async () => tree.update(render(1.25, true)));
  assert.equal(animatedAt(front(masks[0])), moving, 'a late sample does not snap back from the rendered frame');
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

test('settings default to simple lyrics, apply immediately, persist across restart and protect edits from a late restore', async () => {
  const saved = new Map();
  let restore = null;
  const load = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea, 'src/components/icons': iconMock,
    '@react-navigation/native': { useIsFocused: () => true },
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => ({ playing: false, duration: 0 }) },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' }, useEventListener() {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => key === 'biu.lyric-effect' && restore ? restore.promise : saved.get(key) ?? null,
      setItem: async (key, value) => saved.set(key, value),
    },
    'src/api/bili': {}, 'src/api/client': {},
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const Settings = load('src/screens/SettingsScreen.js').default;
  let context, tree;
  function Probe() { context = usePlayer(); return React.createElement(Settings, { navigation: {} }); }
  const mount = async () => act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  await mount();
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

test('mobile settings exchange real HTTP libraries, refresh likes and playlists, accept desktop requests, and expose save failures', async (t) => {
  const { createLanSync } = require('../lan-sync');
  const phoneSong = { bvid: 'BVphone', cid: 1, title: 'Phone song' };
  const desktopSong = { bvid: 'BVdesktop', cid: 2, title: 'Desktop song' };
  const disk = new Map([
    ['biu.likes', JSON.stringify([phoneSong])],
    ['biu.playlists', JSON.stringify([{ id: 1, title: 'Phone list', tracks: [phoneSong] }])],
  ]);
  let desktop = { version: 1, likes: [desktopSong], playlists: [{ id: 2, title: 'Desktop list', tracks: [desktopSong] }] };
  let writes = 0, failStorage = false;
  const service = createLanSync({ host: '127.0.0.1', readLibrary: () => desktop,
    writeLibrary: (_, value) => { desktop = value; writes++; } });
  t.after(() => service.stop());
  const session = await service.manual();
  const load = loader({
    'react-native': rn, 'react-native-safe-area-context': safeArea, 'src/components/icons': iconMock,
    '@react-navigation/native': { useIsFocused: () => true },
    'expo-audio': { setAudioModeAsync: async () => {} },
    'expo-video': { useVideoPlayer: () => ({ playing: false, duration: 0 }) },
    expo: { useEvent: (_, name) => name === 'playingChange' ? { isPlaying: false } : { status: 'idle' }, useEventListener() {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => { if (failStorage && key === 'biu.playlists') throw new Error('手机存储空间不足'); disk.set(key, value); },
    },
    'src/api/bili': {}, 'src/api/client': {},
  });
  const { PlayerProvider, usePlayer } = load('src/player/PlayerContext.js');
  const { usePlaylists } = load('src/store/playlists.js');
  const Settings = load('src/screens/SettingsScreen.js').default;
  let context, playlists, tree;
  function Probe() { context = usePlayer(); playlists = usePlaylists(); return React.createElement(Settings, { navigation: {} }); }
  await act(async () => { tree = create(React.createElement(PlayerProvider, null, React.createElement(Probe))); });
  t.after(async () => { await act(async () => tree.unmount()); });
  const input = (label) => tree.root.findAllByType('TextInput').find((n) => n.props.accessibilityLabel === label);
  await act(async () => {
    input('电脑地址').props.onChangeText(`127.0.0.1:${session.port}`);
    input('配对码').props.onChangeText(session.code);
  });
  await act(async () => {
    const button = touch(tree, '手动同步');
    await Promise.all([button.props.onPress(), button.props.onPress()]);
  });
  assert.equal(writes, 1, 'rapid duplicate taps run only one exchange');
  assert.equal(desktop.likes.length, 2); assert.equal(context.likes.length, 2);
  assert.equal(playlists.length, 2, 'open playlist screens receive the imported lists immediately');
  assert.equal(JSON.parse(disk.get('biu.likes')).length, 2);
  assert.equal(JSON.parse(disk.get('biu.playlists')).length, 2);
  assert.match(textOf(tree), /同步完成/);
  desktop.likes.push({ bvid: 'BVthird', title: 'Third song' });
  await service.manual();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2300)); });
  assert.equal(context.likes.length, 3, 'the desktop button also updates the connected phone');
  assert.equal(writes, 2);
  failStorage = true;
  await act(async () => { await touch(tree, '手动同步').props.onPress(); });
  assert.match(textOf(tree), /手机存储空间不足/);
  assert.doesNotMatch(textOf(tree), /同步完成/);
  failStorage = false;
  await act(async () => { await touch(tree, '手动同步').props.onPress(); });
  assert.equal(context.likes.length, 3, 'retry is idempotent');
  await click(tree, '断开同步');
  const before = writes;
  await service.manual();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); });
  assert.equal(writes, before, 'disconnect stops reacting to desktop requests');
});
