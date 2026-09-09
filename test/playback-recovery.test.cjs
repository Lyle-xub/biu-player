const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const recovery = require('../renderer/playback-recovery');

class Media extends EventTarget {
  constructor() { super(); Object.assign(this, { src: 'https://cdn.test/audio', currentTime: 83.5, paused: true, error: null, plays: 0, dataset: {}, duration: 300, readyState: 4 }); }
  play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {}
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(separate = false) {
  const audio = new Media(), video = separate ? new Media() : audio;
  const track = { bvid: 'A', cid: 1, isSegment: true, from: 60, to: 180 };
  let state = { track, media: video, sound: audio, videoMode: separate }, now = 1000000, refresh;
  const calls = [], errors = [];
  const manager = recovery.create({ read: () => state, now: () => now, report: error => errors.push(error),
    refresh: async (snapshot, valid) => { calls.push(snapshot); if (refresh) await refresh(snapshot, valid); } });
  manager.bind(audio); if (separate) manager.bind(video);
  return { audio, video, track, manager, calls, errors, advance: ms => { now += ms; },
    select: t => { state = { ...state, track: t }; manager.reset(); }, refresh: fn => { refresh = fn; } };
}

test('signed CDN expiry is detected through the desktop proxy and short pauses keep the buffered connection', async () => {
  const url = 'https://cdn.test/audio?deadline=2000';
  assert.equal(recovery.expired('biu-media://stream/?url=' + encodeURIComponent(url), 2000000), true);
  assert.equal(recovery.expired('https://cdn.test/audio?wsTime=' + (2000).toString(16), 2000000), true);
  assert.equal(recovery.expired(url, 1000000), false);
  assert.equal(recovery.expired('file:///music/song.mp3', 2000000), false);
  const h = harness(); h.advance(20000);
  await h.manager.resume();
  assert.equal(h.audio.plays, 1); assert.equal(h.calls.length, 0);
});

test('a long pause refreshes before play and retains absolute segment position and video mode', async () => {
  const h = harness(true); h.video.currentTime = 82;
  h.advance(8 * 60 * 60 * 1000);
  await h.manager.resume();
  assert.equal(h.calls.length, 1); assert.equal(h.audio.plays, 0); assert.equal(h.video.plays, 0);
  assert.equal(h.calls[0].position, 83.5); assert.equal(h.calls[0].videoMode, true);
  assert.equal(h.calls[0].track, h.track);
});

test('error events and rejected play promises coalesce into one refresh, with last good position', async () => {
  const h = harness();
  h.audio.dispatchEvent(new Event('timeupdate'));
  h.audio.currentTime = 0; h.audio.error = { code: 2 };
  h.manager.handleError(h.audio);
  assert.equal(h.calls.length, 0, 'a paused failure waits for the user to resume');
  await h.manager.resume();
  assert.equal(h.calls[0].position, 83.5);
  const h2 = harness();
  h2.audio.play = () => { h2.manager.handleError(h2.audio); return Promise.reject(new Error('HTTP 403')); };
  const first = h2.manager.resume();
  assert.equal(h2.manager.resume(), first);
  await first;
  assert.equal(h2.calls.length, 1); assert.equal(h2.errors.length, 0);
});

test('cancelling recovery or selecting another song prevents late refresh results from starting playback', async () => {
  for (const select of [false, true]) {
    const h = harness(), wait = deferred(); let applied = 0;
    h.refresh(async (_, valid) => { await wait.promise; if (valid()) applied++; });
    const task = h.manager.resume(true);
    await Promise.resolve();
    if (select) h.select({ bvid: 'B', cid: 2 }); else h.manager.cancel();
    wait.resolve(); await task;
    assert.equal(applied, 0); assert.equal(h.manager.pending, false);
  }
});

test('failed refresh terminates once, while a later explicit click may retry', async () => {
  const h = harness(); h.advance(600000);
  h.refresh(async () => { h.audio.currentTime = 0; throw new Error('offline'); });
  await h.manager.resume();
  assert.equal(h.calls.length, 1); assert.equal(h.errors.length, 1); assert.equal(h.manager.pending, false);
  h.manager.handleError(h.audio);
  assert.equal(h.calls.length, 1);
  await h.manager.resume();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].position, 83.5, 'retry retains the position even if a failed new source reset currentTime');
});

test('DASH resumes both tracks from the audio timeline, and stalled play receives a bounded refresh', async t => {
  const h = harness(true); h.video.currentTime = 81;
  await h.manager.resume();
  assert.equal(h.video.currentTime, 83.5); assert.equal(h.audio.currentTime, 83.5);
  assert.equal(h.video.plays, 1); assert.equal(h.audio.plays, 1);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = harness(); stalled.audio.play = () => new Promise(() => {});
  const task = stalled.manager.resume(); await Promise.resolve();
  t.mock.timers.tick(12000); await task;
  assert.equal(stalled.calls.length, 1);
});

for (const file of ['renderer/app.js', 'web/src/legacy/controller.js']) {
  test(`${file}: recovery bypasses segment source reuse without adding listening history`, async () => {
    const source = fs.readFileSync(file, 'utf8');
    const block = source.slice(source.indexOf('async function playTrack(t, options = {})'), source.indexOf('// 电台直播：HLS 流'));
    const audio = new Media(), video = new Media(), liveVideo = new Media();
    audio.dataset = { bvid: 'A', quality: '1' };
    const track = { bvid: 'A', cid: 1, aid: 1, isSegment: true, from: 60, to: 180 };
    const noop = () => {}, element = { style: {}, dataset: {} }; let requested = 0, learned = 0;
    const context = { audio, video, liveVideo, state: { current: track }, settings: { quality: 1 },
      videoModeOn: () => false, videoLoadToken: 0, audioLoadToken: 0,
      recommendationProfiles: { startListening: () => learned++ }, recordHistory: () => learned++,
      pendingPlaybackStart: null, videoPreparePromise: null, videoPrepareKey: '', videoQualityOptions: [], videoQualityOptionsKey: '', lastLi: 0,
      $: () => element, fmt: String, segmentRange: () => ({ from: 60, to: 180 }),
      api: { hasBridge: true, media: url => url, view: async () => ({}), playUrl: async () => { requested++; return 'https://cdn.test/fresh'; } },
      BiuPlaybackSession: require('../renderer/playback-session'), withTimeout: promise => promise,
      waitForPlaybackMetadata: async () => {}, resolveSourceTrack: async () => ({}),
      patchSlice: noop, requestAnimationFrame: noop, console, toast: noop, playbackRecovery: { reset: noop },
    };
    for (const name of ['syncPlayingHeaderLayout', 'fillPlayingAttribution', 'syncToggleIcon', 'stopLiveDanmaku', 'setLiveTheater',
      'destroyHls', 'fillPlayingBase', 'pushDeskLyric', 'resetFavState', 'savePlaybackSession', 'syncFavState', 'fillPlayingDetail',
      'syncProgress', 'applyArtColors', 'loadComments', 'loadLyrics', 'scheduleVideoWarmup']) context[name] = noop;
    vm.createContext(context); vm.runInContext(block, context);
    await context.playTrack(track, { recover: true, forceAudioRefresh: true, startTime: 83.5, keepView: true });
    assert.equal(requested, 1); assert.equal(audio.src, 'https://cdn.test/fresh');
    assert.equal(audio.currentTime, 83.5); assert.equal(audio.plays, 1); assert.equal(learned, 0);
    await context.playTrack(track, { recover: true, forceAudioRefresh: true, startTime: 95, keepView: true, cancelled: () => true });
    assert.equal(audio.plays, 1, 'cancelled loading cannot restart the old song');
  });
}
