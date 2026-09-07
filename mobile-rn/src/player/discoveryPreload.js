import { createVideoPlayer } from 'expo-video';
import * as bili from '../api/bili';
import { streamHeaders } from '../api/client';
import { mediaUrl } from '../api/mediaUrl';

// The next three native players retain their loaded items. A cache hit transfers
// ownership to PlayerProvider instead of discarding the buffer and loading again.
const prepared = new Map();
const keyOf = (track, quality, scope) => `${scope || ''}:${track.bvid}:${track.cid || 0}:${quality}`;
const MAX_AGE = 10 * 60 * 1000;
const WINDOW = 3;
let cleanup = Promise.resolve();
let allocation = Promise.resolve();

function release(entry) {
  entry.cancelled = true;
  if (entry.retiring) return;
  detach(entry);
  const player = entry.player; entry.player = null;
  try { player?.release(); } catch { /* Native teardown may already have released it. */ }
}

function detach(entry) {
  entry.subscriptions?.forEach((subscription) => subscription.remove());
  entry.subscriptions = [];
}

export function clearDiscoveryPreloads({ defer = false } = {}) {
  const entries = [...prepared.values()];
  prepared.clear();
  if (!defer) { entries.forEach(release); return; }
  // Invalidate now; native decoder teardown must not run inside tab blur.
  entries.forEach(entry => { entry.cancelled = true; entry.retiring = true; });
  if (!entries.length) return;
  cleanup = cleanup.then(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
    for (const entry of entries) {
      entry.retiring = false; release(entry);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
  });
}

export function takeDiscoveryPreload(track, quality, scope) {
  const key = keyOf(track, quality, scope);
  const entry = prepared.get(key);
  if (!entry) return null;
  prepared.delete(key);
  if (Date.now() - entry.created >= MAX_AGE) { release(entry); return null; }
  const ready = entry.player
    ? entry.install.then(() => ({ ...entry.source, player: entry.player, loaded: entry.loaded,
      dispose: () => release(entry),
      adopt: () => { detach(entry); entry.player = null; },
    })) : entry.promise;
  if (!entry.player) release(entry);
  return (async () => {
    let timer;
    const timedOut = {};
    try {
      const result = await Promise.race([ready, new Promise((resolve) => {
        timer = setTimeout(() => resolve(timedOut), 750);
      })]);
      if (result !== timedOut) return result;
      // A speculative paused decoder must never hold the active card indefinitely.
      // Reuse its resolved URL through normal playback, or fetch normally if needed.
      release(entry);
      return entry.source || null;
    } finally { clearTimeout(timer); }
  })();
}

export function preloadDiscoveryQueue(tracks, quality, scope) {
  const wanted = new Map(tracks.filter((track) => track?.bvid && !track.isLive && !track.isSegment)
    .map((track) => [keyOf(track, quality, scope), track]).slice(0, WINDOW));
  for (const [key, entry] of prepared) {
    if (!wanted.has(key) || Date.now() - entry.created >= MAX_AGE) {
      release(entry); prepared.delete(key);
    }
  }
  for (const [key, track] of wanted) {
    if (prepared.has(key)) continue;
    const entry = { created: Date.now(), cancelled: false, player: null, subscriptions: [], loaded: false };
    prepared.set(key, entry);
    const fail = () => {
      if (prepared.get(key) === entry) prepared.delete(key);
      release(entry);
    };
    entry.promise = (async () => {
      const detail = track.cid ? track : await bili.view(track.bvid);
      if (!detail?.cid) throw new Error('无法获取视频分 P 信息');
      const uri = await bili.videoUrl(track.bvid, detail.cid, quality === 1 ? undefined : quality);
      return { cid: detail.cid, dimension: detail.dimension, uri };
    })().catch(() => { fail(); return null; });
    entry.promise.then(source => { allocation = allocation.then(async () => {
      // Do not allocate another set of decoders while retired ones await release.
      await cleanup;
      if (entry.cancelled || !source) return;
      // Even cached URLs must give the new screen a frame before creating each
      // decoder. Serialise creation only; the native buffers still fill in parallel.
      await new Promise(resolve => setTimeout(resolve, 32));
      if (entry.cancelled) return;
      try {
        const player = createVideoPlayer(null);
        entry.player = player;
        entry.source = source;
        player.muted = true;
        player.audioMixingMode = 'mixWithOthers';
        player.staysActiveInBackground = false;
        player.showNowPlayingNotification = false;
        entry.subscriptions = [
          player.addListener('statusChange', ({ status }) => { if (status === 'error') fail(); }),
          player.addListener('sourceLoad', () => { entry.loaded = true; }),
        ];
        player.bufferOptions = { preferredForwardBufferDuration: 12, minBufferForPlayback: 0.5,
          maxBufferBytes: 8 * 1024 * 1024, waitsToMinimizeStalling: false };
        entry.install = player.replaceAsync({ uri: source.uri, headers: streamHeaders(), contentType: 'progressive', useCaching: true,
          metadata: { title: track.title || 'Biu Player', artist: track.up || undefined, artwork: mediaUrl(track.pic) || undefined,
            biuMediaKey: `${track.bvid}:${source.cid}`, biuSegmentStart: null, biuSegmentEnd: null },
        }).catch(fail);
        // Paused native players buffer without playing audio or taking the media session.
      } catch { fail(); }
    }); });
  }
}
