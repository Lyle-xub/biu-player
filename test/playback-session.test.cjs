const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const session = require('../renderer/playback-session');
const song = { bvid: 'BV1demo', cid: 100, aid: 200, title: '测试歌曲', up: '歌手', duration: 240 };
const snapshot = (extra = {}) => ({ version: 1, queue: [song], current: song, qi: 0,
  position: 83.5, playing: false, volume: .35, muted: true, playMode: 'one', videoMode: true,
  queueName: '我喜欢', view: 'playing', ...extra });

test('round-trip retains queue, timing, paused state and controls, but not signed URLs', () => {
  const dirty = { ...song, url: 'https://expired.test/?token=secret', streamURL: 'expired', pic: 'blob:expired' };
  const result = session.normalize(snapshot({ current: dirty, queue: [dirty] }));
  assert.deepEqual(result, snapshot());
  assert.deepEqual(session.normalize(JSON.parse(JSON.stringify(result))), result);
});

test('invalid snapshots and queue entries are safe; duplicate queue index is preserved', () => {
  for (const value of [null, 'broken', {}, { version: 2 }]) assert.equal(session.normalize(value), null);
  const result = session.normalize(snapshot({ queue: [null, song, song], qi: 2, volume: 4, position: NaN }));
  assert.equal(result.qi, 1);
  assert.equal(result.volume, 1);
  assert.equal(result.position, 0);
  assert.equal(session.normalize(snapshot({ current: null })).playing, false);
});

test('segment timing is absolute, bounded and retains lyric matching', () => {
  const segment = { ...song, isSegment: true, from: 100, to: 180, lyricRef: { source: 'qq', id: 123, songmid: 'abc' } };
  const saved = session.normalize(snapshot({ current: segment, queue: [segment] }));
  assert.deepEqual(saved.current, segment);
  assert.equal(session.resumePosition(segment, 120, 240), 120);
  assert.equal(session.resumePosition(segment, 20, 240), 100);
  assert.equal(session.resumePosition(segment, 180, 240), 100);
  assert.equal(session.resumePosition(segment, 170, 150), 100);
  assert.equal(session.resumePosition(segment, 120, 60), 0);
  assert.equal(session.resumePosition(song, 240, 240), 0);
});

test('live rooms restore identity and pause intent, never obsolete stream URLs or seek positions', () => {
  const live = { roomid: 123, isLive: true, title: '音乐台', up: '主播' };
  const saved = session.normalize(snapshot({ current: { ...live, streamURL: 'old.m3u8' }, queue: [], playing: false }));
  assert.deepEqual(saved.current, live);
  assert.equal(saved.qi, -1);
  assert.equal(saved.position, 0);
  assert.equal(saved.videoMode, false);
  assert.equal(session.resumePosition(live, 120, Infinity), 0);
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  assert.doesNotMatch(html.match(/<video id="liveVideo"[^>]*>/)[0], /autoplay/);
});

function harness() {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const block = source.slice(source.indexOf('const PLAYBACK_SESSION_KEY'), source.indexOf('/* ---------- B 站登录'));
  const calls = [];
  const media = () => Object.assign(new EventTarget(), { currentTime: 83.5, paused: true, ended: false, volume: .35, muted: true });
  const audio = media(), video = media(), liveVideo = media();
  const window = Object.assign(new EventTarget(), { bili: {
    storeSet: (_key, value) => calls.push(['async', value]),
    playbackSave: (value) => calls.push(['flush', value]),
  } });
  const context = vm.createContext({ BiuPlaybackSession: session, state: { current: null, queue: [] },
    audio, video, liveVideo, window, calls, document: { body: { dataset: { view: 'playing' } } },
    api: { hasBridge: true }, store: { set: (_key, value) => calls.push(['local', value]) },
    activeMedia: () => audio, videoModeOn: () => false, videoSoundMedia: () => audio,
    Date, setTimeout, clearTimeout, renderMode() {}, syncToggleIcon() {}, renderQueue() {},
    setVolume(value) { audio.volume = value; },
    go(view) { context.document.body.dataset.view = view; },
    async playTrack(track, options) { context.state.current = track; calls.push(['play', track, options]); },
  });
  vm.runInContext('let playMode = "loop";\n' + block, context);
  return { context, calls, audio, window };
}

test('startup restores seek and view without starting playback', async () => {
  for (const playing of [true, false]) {
    const { context, calls } = harness();
    await context.restorePlaybackSession(snapshot({ playing, view: 'fav' }));
    const play = calls.find(([name]) => name === 'play');
    assert.deepEqual(JSON.parse(JSON.stringify(play[2])), { autoplay: false, startTime: 83.5, videoMode: true });
    assert.equal(context.document.body.dataset.view, 'fav');
    assert.equal(context.state.qi, 0);
    assert.equal(context.audio.muted, true);
    assert.equal(vm.runInContext('playMode', context), 'one');
  }
});

test('quit synchronously flushes final progress and ignores teardown pause events', async () => {
  const { context, calls, audio, window } = harness();
  await context.restorePlaybackSession(snapshot());
  context.initPlaybackSession();
  audio.currentTime = 101.25;
  audio.paused = false;
  window.dispatchEvent(new Event('beforeunload'));
  const saved = calls.find(([name]) => name === 'flush')[1];
  assert.equal(saved.position, 101.25);
  assert.equal(saved.playing, true);
  const count = calls.length;
  audio.paused = true;
  audio.dispatchEvent(new Event('pause'));
  assert.equal(calls.length, count);
});

test('restoration does not replace a song the user has already selected', async () => {
  const { context, calls } = harness();
  const picked = { ...song, bvid: 'BV2new' };
  context.state.current = picked;
  await context.restorePlaybackSession(snapshot());
  assert.equal(context.state.current, picked);
  assert.equal(calls.length, 0);
});
