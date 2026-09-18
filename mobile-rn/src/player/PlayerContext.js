import { setAnalysisPlaybackBusy } from '../recommendation/localAnalysis';
/* Biu Player RN · 全局播放状态（一个前台播放器，发现队列可接管预加载实例）
 * 点播与直播共用当前前台 VideoPlayer；发现页可把已预热的实例提升为前台：
 *   点播：progressive mp4 整文件流（bili.videoUrl，含音轨）——播放页歌词模式只是
 *     把视频画面藏起来，声音从当前 player 出；切「原视频」只是显示画面，
 *     永不 replace/pause/resume，从根上消灭重载与串台。
 *   直播（track.isLive）：同一 player 播 HLS（contentType:'hls'）；无进度条，
 *     seekTo 跳过，prev/next 当作换台。
 * 竞态防护：tokenRef 自增校验 + replaceChain 串行化 replaceAsync——
 *   同一时刻只有最新 track 的加载流程能落地 replace/play。
 * 喜欢 / 历史等大数据持久化到文件，音质等小设置保留在 AsyncStorage。
 * 后台播放：app.json expo-video plugin supportsBackgroundPlayback + staysActiveInBackground；
 *   showNowPlayingNotification 接入系统媒体控件，source.metadata 随切歌更新。
 *   expo-video 独占管理 iOS 音频会话，避免两个原生模块在系统中断后互相覆盖配置。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { useVideoPlayer } from 'expo-video';
import { useEvent, useEventListener } from 'expo';
import AsyncStorage from '../store/largeStorage';
import * as bili from '../api/bili';
import { authStatus, streamHeaders } from '../api/client';
import { mediaUrl } from '../api/mediaUrl';
import { fetchTrackSource } from './trackSource';
import { takeDiscoveryPreload } from './discoveryPreload';
import { segmentRange, trackKeyOf } from './track';
import { PLAYBACK_QUALITIES, normalizePlaybackQuality } from './playbackQuality';
import { getPlaylists, mergeSyncedPlaylists, setPlaylistScope } from '../store/playlists';
import { accountKey, adoptGuestLibrary, readAccountValue } from '../store/accountStorage';
import { backgroundCompute } from '../performance/backgroundCompute';
import useAppForeground from '../performance/useAppForeground';

import useRecommendationProfile from '../store/useRecommendationProfile';
import { tracker } from '../../../renderer/daily-recommendation';

const LIKES_KEY = 'biu.likes';
const MUSIC_LIBRARY_KEY = 'biu.library';
const HISTORY_KEY = 'biu.history';
const QUALITY_KEY = 'biu.quality';
const LYRIC_KEY = 'biu.lyric-settings';
const DESKTOP_LYRICS_KEY = 'biu.ios-desktop-lyrics';
const LOCK_SCREEN_LYRICS_KEY = 'biu.ios-lock-screen-lyrics';
const DYNAMIC_ISLAND_LYRICS_KEY = 'biu.ios-dynamic-island-lyrics';
const LYRIC_EFFECT_KEY = 'biu.lyric-effect';
const RECOMMEND_MODE_KEY = 'biu.recommend-mode';
const DISCOVERY_ENABLED_KEY = 'biu.discovery-enabled';
const DISCOVERY_MODE_KEY = 'biu.discovery-recommend-mode';
const PLAY_MODE_KEY = 'biu.play-mode';
const PLAYBACK_SESSION_KEY = 'biu.playback-session';
export const PLAY_MODES = ['loop', 'single', 'shuffle'];
export const RECOMMEND_MODES = ['music', 'all'];

const PlayerContext = createContext(null);
const PlaybackProgressContext = createContext({ position: 0, duration: 0 });
const BackgroundPlaybackProgressContext = createContext({ position: 0, duration: 0 });

export function PlayerProvider({ children }) {
  const basePlayer = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.25; // UI samples; lyric interpolation runs on the native driver.
    p.bufferOptions = { preferredForwardBufferDuration: 12, minBufferForPlayback: 0.5, waitsToMinimizeStalling: false };
    p.staysActiveInBackground = true; // 退后台继续出声（音频不中断）
    p.showNowPlayingNotification = true; // 通知栏 / 锁屏媒体控件，由原生播放器同步播放状态
    p.audioMixingMode = 'doNotMix'; // 系统播放其他媒体时正常让出，用户再次播放时由同一模块恢复会话
  });
  const [adoptedPlayer, setAdoptedPlayer] = useState(null);
  const player = adoptedPlayer || basePlayer;
  const activePlayer = useRef(player);
  const ownedPlayers = useRef(new Set());
  const baseRetired = useRef(false);
  // Bind the emitter identity before Expo's latest-listener forwarding. Events
  // already queued by a retired player cannot affect the newly selected video.
  const events = useMemo(() => ({
    addListener: (name, listener) => player.addListener(name, (...args) => {
      if (activePlayer.current === player) listener(...args);
    }),
  }), [player]);
  useEvent(events, 'playingChange', { isPlaying: player.playing });
  useEvent(events, 'statusChange', { status: player.status });
  // useEvent retains its previous value when its emitter changes. Native reads
  // give the adopted player's actual state even when readiness happened offscreen.
  const isPlaying = player.playing, status = player.status;
  useEffect(()=>setAnalysisPlaybackBusy(status==='loading'),[status]);
  const [currentTime, setCurrentTime] = useState(0);
  const pendingSeek = useRef(null);

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [queueSource, setQueueSource] = useState('');
  const queueSourceRef = useRef('');
  const [playMode, setPlayModeState] = useState('loop');
  const playModeEdited = useRef(false);
  const shuffleHistory = useRef([]);
  const [resolving, setResolving] = useState(false);
  const [sourcePending, setSourcePending] = useState(false);
  const [videoSource, setVideoSource] = useState(null);
  const [automaticVideoTransition, setAutomaticVideoTransition] = useState(false);
  const [playError, setPlayError] = useState(null);
  const [likes, setLikes] = useState([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [account, setAccount] = useState(null);
  const accountScope = useRef('');
  const accountSwitch = useRef(Promise.resolve());
  const libraryEpoch = useRef(0);
  const libraryReadyRef = useRef(false);
  const likesRef = useRef(likes);
  likesRef.current = likes;
  const [savedLibrary, setSavedLibrary] = useState([]);
  const savedLibraryRef = useRef(savedLibrary);
  savedLibraryRef.current = savedLibrary;
  const collectionWrites = useRef(Promise.resolve());
  const [history, setHistory] = useState([]);
  const [quality, setQualityState] = useState(1);
  const qualityEdited = useRef(false);
  const [lyricSettings, setLyricSettings] = useState({});
  const [lyricEffect, setLyricEffectState] = useState('simple');
  const [desktopLyricsEnabled, setDesktopLyricsEnabledState] = useState(true);
  const [lockScreenLyricsEnabled, setLockScreenLyricsEnabledState] = useState(true);
  const [dynamicIslandLyricsEnabled, setDynamicIslandLyricsEnabledState] = useState(true);
  const [recommendMode, setRecommendModeState] = useState('music');
  const [discoveryEnabled, setDiscoveryEnabledState] = useState(false);
  const [discoveryRecommendMode, setDiscoveryRecommendModeState] = useState('all');
  const [seekRevision, setSeekRevision] = useState(0);
  const lyricEffectEdited = useRef(false);
  const desktopLyricsEdited = useRef(false);
  const lockScreenLyricsEdited = useRef(false);
  const dynamicIslandLyricsEdited = useRef(false);
  const recommendModeEdited = useRef(false);
  const discoveryEnabledEdited = useRef(false);
  const discoveryModeEdited = useRef(false);
  const tokenRef = useRef(0);
  const listeningRef = useRef(null);
  const searchPlaybackRef = useRef(false);
  const resolvingRef = useRef(false);
  const playIntentRef = useRef(false);
  const loadedMediaKey = useRef(null);
  const pendingAutoplayUri = useRef(null);
  const videoLoad = useRef(null);
  const videoRequest = useRef(null);
  const replaceChain = useRef(Promise.resolve()); // 串行化 replaceAsync，防串台
  const playbackSessionRef = useRef(null);
  const sessionRestoreStarted = useRef(false);
  const deferredSession = useRef(null);
  const sessionWrites = useRef(Promise.resolve());
  const saveSession = useCallback(() => {
    if (!playbackSessionRef.current) return;
    const saved = { ...playbackSessionRef.current };
    sessionWrites.current = sessionWrites.current.catch(() => {}).then(async () => {
      await AsyncStorage.setItem(PLAYBACK_SESSION_KEY, await backgroundCompute('stringify', saved));
    }).catch(() => {});
  }, []);

  const switchAccount = useCallback((nextAccount) => {
    libraryEpoch.current += 1;
    libraryReadyRef.current = false;
    const normalized = nextAccount && nextAccount.isLogin
      ? nextAccount : { isLogin: false };
    accountSwitch.current = accountSwitch.current.catch(() => {}).then(async () => {
      const nextScope = normalized.isLogin && normalized.mid ? String(normalized.mid) : '';
      const previousScope = accountScope.current;
      setLibraryReady(false);
      await adoptGuestLibrary(nextScope, previousScope);
      const [nextLikes, nextHistory, nextLibrary] = await Promise.all([
        readAccountValue(LIKES_KEY, nextScope, []),
        readAccountValue(HISTORY_KEY, nextScope, []),
        readAccountValue(MUSIC_LIBRARY_KEY, nextScope, []),
        setPlaylistScope(nextScope),
      ]);
      accountScope.current = nextScope;
      likesRef.current = Array.isArray(nextLikes) ? nextLikes : [];
      setLikes(likesRef.current);
      setHistory(Array.isArray(nextHistory) ? nextHistory : []);
      savedLibraryRef.current = Array.isArray(nextLibrary) ? nextLibrary : [];
      setSavedLibrary(savedLibraryRef.current);
      setAccount(normalized);
      libraryReadyRef.current = true;
      setLibraryReady(true);
      return normalized;
    });
    return accountSwitch.current;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [q, lyric, desktopLyrics, lockScreenLyrics, dynamicIslandLyrics] = await Promise.all([
          AsyncStorage.getItem(QUALITY_KEY),
          AsyncStorage.getItem(LYRIC_KEY),
          AsyncStorage.getItem(DESKTOP_LYRICS_KEY),
          AsyncStorage.getItem(LOCK_SCREEN_LYRICS_KEY),
          AsyncStorage.getItem(DYNAMIC_ISLAND_LYRICS_KEY),
        ]);
        if (q !== null && !qualityEdited.current) setQualityState(normalizePlaybackQuality(q));
        if (lyric) setLyricSettings(JSON.parse(lyric) || {});
        if (desktopLyrics !== null && !desktopLyricsEdited.current) {
          setDesktopLyricsEnabledState(JSON.parse(desktopLyrics) !== false);
        }
        if (lockScreenLyrics !== null && !lockScreenLyricsEdited.current) {
          setLockScreenLyricsEnabledState(JSON.parse(lockScreenLyrics) !== false);
        }
        if (dynamicIslandLyrics !== null && !dynamicIslandLyricsEdited.current) {
          setDynamicIslandLyricsEnabledState(JSON.parse(dynamicIslandLyrics) !== false);
        }
      } catch (e) { /* 本地数据损坏时从空开始 */ }
    })();
    Promise.resolve().then(() => (typeof authStatus === 'function' ? authStatus() : { isLogin: false }))
      .then(switchAccount)
      .catch(() => switchAccount({ isLogin: false }));
    AsyncStorage.getItem(LYRIC_EFFECT_KEY).then((raw) => {
      if (!lyricEffectEdited.current) setLyricEffectState(JSON.parse(raw) === 'monet' ? 'monet' : 'simple');
    }).catch(() => {});
    AsyncStorage.getItem(RECOMMEND_MODE_KEY).then((raw) => {
      const saved = JSON.parse(raw);
      if (!recommendModeEdited.current && RECOMMEND_MODES.includes(saved)) setRecommendModeState(saved);
    }).catch(() => {});
    AsyncStorage.getItem(DISCOVERY_ENABLED_KEY).then((raw) => {
      if (!discoveryEnabledEdited.current) setDiscoveryEnabledState(JSON.parse(raw) === true);
    }).catch(() => {});
    AsyncStorage.getItem(DISCOVERY_MODE_KEY).then((raw) => {
      const saved = JSON.parse(raw);
      if (!discoveryModeEdited.current && RECOMMEND_MODES.includes(saved)) setDiscoveryRecommendModeState(saved);
    }).catch(() => {});
    AsyncStorage.getItem(PLAY_MODE_KEY).then((raw) => {
      const saved = JSON.parse(raw);
      if (!playModeEdited.current && PLAY_MODES.includes(saved)) setPlayModeState(saved);
    }).catch(() => {});
  }, []);

  const current = index >= 0 && index < queue.length ? queue[index] : null;
  const isLive = !!(current && current.isLive);
  const range = segmentRange(current);

  const persist = useCallback((key, val) => {
    AsyncStorage.setItem(key, JSON.stringify(val)).catch(() => {});
  }, []);
  const persistLibrary = useCallback((key, val) => {
    AsyncStorage.setItem(accountKey(key, accountScope.current), JSON.stringify(val)).catch(() => {});
  }, []);

  const publishVideoSource = useCallback(() => {
    const request = videoRequest.current;
    const load = videoLoad.current;
    if (resolvingRef.current || !request || request.token !== tokenRef.current
      || !load?.loaded || load.mediaKey !== request.mediaKey) return;
    // A matching loaded item can acquire its video surface now. Waiting for a
    // playing clock here forces audio to start before video can even render.
    // pendingSeek independently guards stale end/progress events below.
    // sourceLoad can arrive without sourceChange (notably after adopting a
    // preloaded player). Matching loaded media also completes source startup.
    setSourcePending(false);
    setVideoSource((old) => old?.revision === request.token ? old
      : { key: request.key, revision: request.token });
  }, []);

  const playIndex = useCallback(async (
    list, i, keepShuffleHistory = false, automatic = false, startAt = 0, autoplay = true,
  ) => {
    let playbackPlayer = activePlayer.current;
    let prepared;
    const t = list[i];
    if (!t) return;
    deferredSession.current = null;
    // A pending replace may still change the native item before this request's
    // turn in the chain (A → B → A). Only an idle chain can safely reuse media.
    const canReuseMedia = !resolvingRef.current;
    if (autoplay) listeningRef.current?.start(t, { manual: !automatic, search: !automatic && searchPlaybackRef.current });
    searchPlaybackRef.current = false;
    if (!keepShuffleHistory) shuffleHistory.current = [];
    setQueue(list);
    setIndex(i);
    setResolving(true);
    setPlayError(null);
    const token = ++tokenRef.current;
    setAutomaticVideoTransition(automatic);
    videoRequest.current = null;
    setVideoSource(null);
    pendingSeek.current = null;
    resolvingRef.current = true;
    playbackSessionRef.current = { queue: list, index: i, position: startAt, source: queueSourceRef.current };
    saveSession();
    try {
      // 自动续播时保留 playWhenReady：pause 会让 Android 媒体服务退出前台，
      // 随后的后台取流 / 重新播放可能被系统限制。replaceAsync 本身会切换旧媒体。
      if (!automatic) playbackPlayer.pause();
      let source;
      let mediaKey;
      if (t.isLive) {
        mediaKey = `live:${t.roomid}`;
        // 电台：HLS（同一 player，contentType 显式声明）
        const url = await bili.livePlayUrl(t.roomid);
        if (token !== tokenRef.current) return;
        source = { uri: url, headers: streamHeaders(), contentType: 'hls' };
      } else {
        prepared = !t.isSegment && !startAt ? await takeDiscoveryPreload(t, quality, accountScope.current) : null;
        if (token !== tokenRef.current) return;
        let cid = t.cid || prepared?.cid;
        if (prepared) {
          t.cid = cid;
          if (prepared.dimension) t.dimension = prepared.dimension;
        }
        if (!cid) {
          const v = await bili.view(t.bvid);
          if (token !== tokenRef.current) return;
          cid = v && v.cid;
          // 回填 cid，避免重复请求
          if (cid) {
            t.cid = cid;
            setQueue((q) => q.map((item) => (item === t || item.bvid === t.bvid ? { ...item, cid } : item)));
          }
        }
        if (!cid) throw new Error('无法获取视频分 P 信息');
        mediaKey = `${t.bvid}:${cid}:${quality}`;
        if (prepared?.player || !canReuseMedia || loadedMediaKey.current !== mediaKey) {
          // 音画共用视频流；自动不指定 qn，手动档位传递实际的视频清晰度。
          const requestedQuality = quality === 1 ? undefined : quality;
          const url = prepared?.uri || await bili.videoUrl(t.bvid, cid, requestedQuality);
          if (token !== tokenRef.current) return; // 已被更新的切歌请求取代
          source = { uri: url, headers: streamHeaders(), contentType: 'progressive', useCaching: true };
        }
      }
      const metadataSegment = segmentRange(t);
      const metadata = {
        title: t.title || 'Biu Player',
        artist: t.up || undefined,
        artwork: mediaUrl(t.pic) || undefined,
        biuMediaKey: `${t.bvid || ''}:${t.cid || 0}`,
        biuSegmentStart: metadataSegment?.from ?? null,
        biuSegmentEnd: metadataSegment?.to ?? null,
      };
      if (source) source.metadata = metadata;
      videoRequest.current = { token, key: trackKeyOf(t), mediaKey };
      // 串行 replace：过期的加载流程到这一步直接丢弃，只有最新 track 能落地
      replaceChain.current = replaceChain.current.catch(() => {}).then(async () => {
        if (token !== tokenRef.current) return;
        if (prepared?.player) {
          const incoming = prepared.player;
          // Keep the loaded AVPlayerItem / ExoPlayer and its buffer intact: no
          // replace, no seek-to-zero, and no repeated play-URL or metadata request.
          playbackPlayer.pause();
          playbackPlayer.showNowPlayingNotification = false;
          playbackPlayer.staysActiveInBackground = false;
          incoming.volume = playbackPlayer.volume ?? 1;
          incoming.muted = false;
          incoming.timeUpdateEventInterval = 0.25;
          ownedPlayers.current.add(incoming);
          activePlayer.current = incoming;
          playbackPlayer = incoming;
          prepared.adopt();
          setAdoptedPlayer(incoming);
          loadedMediaKey.current = mediaKey;
          const loaded = prepared.loaded || incoming.status === 'readyToPlay';
          videoLoad.current = { uri: source.uri, mediaKey, loaded, player: incoming };
          pendingAutoplayUri.current = loaded ? null : source.uri;
          setSourcePending(!loaded);
        } else if (source) {
          try {
            // expo-video iOS resolves replaceAsync before its main-thread AVPlayerItem
            // replacement runs. Resume when sourceChange confirms the new item exists.
            playIntentRef.current = autoplay;
            pendingAutoplayUri.current = source.uri;
            setSourcePending(true);
            videoLoad.current = { uri: source.uri, mediaKey, loaded: false };
            await playbackPlayer.replaceAsync(source);
            loadedMediaKey.current = mediaKey;
          } catch (e) {
            loadedMediaKey.current = null;
            videoLoad.current = null;
            if (token === tokenRef.current) {
              playIntentRef.current = false;
              pendingAutoplayUri.current = null;
              setSourcePending(false);
              setPlayError('播放失败：' + String(e.message || e));
            }
            return;
          }
        } else if (playbackPlayer.updateMetadata) {
          // Adjacent clips reuse the stream, but each song owns its media card.
          await playbackPlayer.updateMetadata(metadata);
        }
        if (token !== tokenRef.current) return;
        const segment = segmentRange(t);
        const offset = Number.isFinite(startAt) ? Math.max(0, Math.min(startAt,
          segment ? segment.to - segment.from : (playbackPlayer.duration || t.duration || Infinity))) : 0;
        const start = (segment?.from || 0) + offset;
        if (!t.isLive) {
          // iOS seeks asynchronously even when two segments share the same
          // video. Old progress/end events must not finish the new segment.
          if (source || segment || offset > 0) pendingSeek.current = {
            target: start, started: Date.now(), isSegmentSwitch: !!segment, isSourceSwitch: !!source,
          };
          // A fresh source already starts at zero. Seeking it again can flush a
          // decoded first frame and show the native shutter as playback starts.
          if (!source || start > 0) playbackPlayer.currentTime = start;
        }
        setCurrentTime(start);
        playIntentRef.current = autoplay;
        // replaceAsync can reset AVPlayer integration flags on iOS. Reapply them
        // before every new item so lock-screen / Control Center stays registered.
        playbackPlayer.staysActiveInBackground = true;
        playbackPlayer.showNowPlayingNotification = true;
        playbackPlayer.audioMixingMode = 'doNotMix';
        if (autoplay) playbackPlayer.play();
        else playbackPlayer.pause();
        if (!t.isLive && autoplay) {
          setHistory((h) => {
            const nextH = [t, ...h.filter((x) => trackKeyOf(x) !== trackKeyOf(t))].slice(0, 100);
            persistLibrary(HISTORY_KEY, nextH);
            return nextH;
          });
        }
      });
      await replaceChain.current;
    } catch (e) {
      if (token !== tokenRef.current) return;
      playIntentRef.current = false;
      setSourcePending(false);
      setPlayError(String(e.message || e));
    } finally {
      prepared?.dispose?.();
      if (token === tokenRef.current) {
        resolvingRef.current = false;
        setResolving(false);
        publishVideoSource();
      }
    }
  }, [player, quality, persistLibrary, publishVideoSource, saveSession]);

  // A paused session needs only its local queue and position at startup.
  // Resolve media on an explicit play/resume, not alongside homepage hydration.
  useEffect(() => {
    if (sessionRestoreStarted.current) return;
    sessionRestoreStarted.current = true;
    const token = tokenRef.current;
    AsyncStorage.getItem(PLAYBACK_SESSION_KEY).then(async (raw) => {
      if (!raw || token !== tokenRef.current) return;
      const saved = await backgroundCompute('parse', raw);
      if (token !== tokenRef.current) return;
      if (!Array.isArray(saved?.queue) || !saved.queue.length || saved.queue[saved.index]?.isLive) return;
      const restoredIndex = Math.max(0, Math.min(saved.queue.length - 1, Number(saved.index) || 0));
      const restoredPosition = Math.max(0, Number(saved.position) || 0);
      queueSourceRef.current = typeof saved.source === 'string' ? saved.source
        : saved.queue.some((track) => track.discoveryOrigin) ? 'discovery' : '';
      setQueueSource(queueSourceRef.current);
      deferredSession.current = { position: restoredPosition };
      playbackSessionRef.current = { queue: saved.queue, index: restoredIndex,
        position: restoredPosition, source: queueSourceRef.current };
      setQueue(saved.queue);
      setIndex(restoredIndex);
      setCurrentTime((segmentRange(saved.queue[restoredIndex])?.from || 0) + restoredPosition);
    }).catch(() => {});
  }, [playIndex]);

  useEffect(() => {
    const timer = setInterval(() => {
      const saved = playbackSessionRef.current;
      if (!saved) return;
      saveSession();
    }, 8000);
    return () => clearInterval(timer);
  }, [saveSession]);

  const playQueue = useCallback((tracks, i = 0, startAt = 0, source = '') => {
    searchPlaybackRef.current = source === 'search';
    queueSourceRef.current = source;
    setQueueSource(source);
    return playIndex(tracks, i, false, false, startAt);
  }, [playIndex]);

  // Feed enrichment changes future entries without replacing the playing source.
  const syncDiscoveryQueue = useCallback((tracks) => {
    if (queueSource !== 'discovery' || !current || tracks === queue) return;
    if (!tracks.length) {
      player.pause(); setQueue([]); setIndex(-1);
      listeningRef.current?.start(null);
      playbackSessionRef.current = { queue: [], index: -1, position: 0, source: 'discovery' };
      return;
    }
    const nextIndex = tracks.findIndex((track) => trackKeyOf(track) === trackKeyOf(current));
    if (nextIndex < 0) return;
    setQueue(tracks); setIndex(nextIndex);
    if (playbackSessionRef.current) {
      playbackSessionRef.current = { ...playbackSessionRef.current, queue: tracks, index: nextIndex };
    }
  }, [queueSource, current, queue, player]);

  const next = useCallback((automatic = false) => {
    if (!queue.length) return;
    let target = (index + 1) % queue.length;
    if (playMode === 'shuffle' && !isLive && queue.length > 1) {
      // Pick any other entry; previous returns through the actual shuffle history.
      target = (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length;
      shuffleHistory.current = [...shuffleHistory.current.slice(-99), index];
    }
    return playIndex(queue, target, true, automatic === true);
  }, [queue, index, playIndex, playMode, isLive]);

  const prev = useCallback(() => {
    if (!queue.length) return;
    const previous = playMode === 'shuffle' && !isLive ? shuffleHistory.current.pop() : undefined;
    return playIndex(queue, previous ?? (index - 1 + queue.length) % queue.length, true);
  }, [queue, index, playIndex, playMode, isLive]);

  const togglePlay = useCallback(() => {
    if (!current) return;
    if (deferredSession.current) return playIndex(queue, index, false, false, deferredSession.current.position);
    if (playError) { playIndex(queue, index); return; } // 取流失败时播放键 = 重试
    if (player.playing) {
      playIntentRef.current = false;
      player.pause();
    } else {
      playIntentRef.current = true;
      player.play();
    }
  }, [player, current, playError, queue, index, playIndex]);

  const seekTo = useCallback((sec) => {
    if (!current || current.isLive || resolvingRef.current) return;
    if (!Number.isFinite(sec)) return;
    const segment = segmentRange(current);
    const end = segment ? segment.to - segment.from : (player.duration || current?.duration || Infinity);
    try {
      const target = (segment?.from || 0) + Math.max(0, Math.min(end, sec));
      if (deferredSession.current) {
        deferredSession.current.position = target - (segment?.from || 0);
        playbackSessionRef.current.position = deferredSession.current.position;
        setCurrentTime(target);
        setSeekRevision((n) => n + 1);
        return;
      }
      pendingSeek.current = { target, started: Date.now() };
      player.currentTime = target;
      setCurrentTime(target); // Paused seek updates lyrics without waiting for a native tick.
      setSeekRevision((n) => n + 1); // Even a small seek must reset the lyric clock immediately.
    } catch (e) { pendingSeek.current = null; }
  }, [player, current]);

  // Discovery and the playback controls share lazy session restoration.
  const resume = useCallback(() => {
    if (!current) return;
    if (deferredSession.current) return playIndex(queue, index, false, false, deferredSession.current.position);
    try { playIntentRef.current = true; player.play(); } catch (e) { /* 忽略 */ }
  }, [player, current, queue, index, playIndex]);

  // 音量（player 内音量，0~1）
  const setVolume = useCallback((v) => {
    try { player.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* 忽略 */ }
  }, [player]);

  // 单 player 架构下等价于 pause()，保留 API 兼容
  const pauseAll = useCallback(() => {
    try { playIntentRef.current = false; player.pause(); } catch (e) {}
  }, [player]);

  const setQuality = useCallback((q) => {
    if (!PLAYBACK_QUALITIES.some((item) => item.q === q)) return;
    qualityEdited.current = true;
    setQualityState(q);
    persist(QUALITY_KEY, q);
  }, [persist]);

  const setPlayMode = useCallback((mode) => {
    if (!PLAY_MODES.includes(mode)) return;
    playModeEdited.current = true;
    shuffleHistory.current = [];
    setPlayModeState(mode);
    persist(PLAY_MODE_KEY, mode);
  }, [persist]);

  const setLyricEffect = useCallback((effect) => {
    if (effect !== 'simple' && effect !== 'monet') return;
    lyricEffectEdited.current = true;
    setLyricEffectState(effect);
    persist(LYRIC_EFFECT_KEY, effect);
  }, [persist]);

  const setDesktopLyricsEnabled = useCallback((enabled) => {
    const next = enabled !== false;
    desktopLyricsEdited.current = true;
    setDesktopLyricsEnabledState(next);
    persist(DESKTOP_LYRICS_KEY, next);
  }, [persist]);

  const setLockScreenLyricsEnabled = useCallback((enabled) => {
    const next = enabled !== false;
    lockScreenLyricsEdited.current = true;
    setLockScreenLyricsEnabledState(next);
    persist(LOCK_SCREEN_LYRICS_KEY, next);
  }, [persist]);

  const setDynamicIslandLyricsEnabled = useCallback((enabled) => {
    const next = enabled !== false;
    dynamicIslandLyricsEdited.current = true;
    setDynamicIslandLyricsEnabledState(next);
    persist(DYNAMIC_ISLAND_LYRICS_KEY, next);
  }, [persist]);

  const setRecommendMode = useCallback((mode) => {
    if (!RECOMMEND_MODES.includes(mode)) return;
    recommendModeEdited.current = true;
    setRecommendModeState(mode);
    persist(RECOMMEND_MODE_KEY, mode);
  }, [persist]);

  const setDiscoveryEnabled = useCallback((enabled) => {
    const next = enabled === true;
    discoveryEnabledEdited.current = true;
    setDiscoveryEnabledState(next);
    persist(DISCOVERY_ENABLED_KEY, next);
  }, [persist]);

  const setDiscoveryRecommendMode = useCallback((mode) => {
    if (!RECOMMEND_MODES.includes(mode)) return;
    discoveryModeEdited.current = true;
    setDiscoveryRecommendModeState(mode);
    persist(DISCOVERY_MODE_KEY, mode);
  }, [persist]);

  const likedKeys = useMemo(() => new Set(likes.map(trackKeyOf)), [likes]);
  const isLiked = useCallback((t) => !!t && likedKeys.has(trackKeyOf(t)), [likedKeys]);
  const changeCollections = useCallback((update) => {
    const scope = accountScope.current, epoch = libraryEpoch.current;
    const operation = collectionWrites.current.catch(() => {}).then(async () => {
      const check = () => { if (epoch !== libraryEpoch.current || !libraryReadyRef.current) throw new Error('账号正在切换，请稍后重试'); };
      for (;;) {
        check();
        const before = { likes: likesRef.current, library: savedLibraryRef.current };
        const changed = () => likesRef.current !== before.likes || savedLibraryRef.current !== before.library;
        const next = update(before);
        const likesRaw = next.likes !== before.likes ? await backgroundCompute('stringify', next.likes) : null;
        const libraryRaw = next.library !== before.library ? await backgroundCompute('stringify', next.library) : null;
        check(); if (changed()) continue;
        await Promise.all([
          likesRaw !== null && AsyncStorage.setItem(accountKey(LIKES_KEY, scope), likesRaw),
          libraryRaw !== null && AsyncStorage.setItem(accountKey(MUSIC_LIBRARY_KEY, scope), libraryRaw),
        ]);
        check(); if (changed()) continue;
        likesRef.current = next.likes; savedLibraryRef.current = next.library;
        setLikes(next.likes); setSavedLibrary(next.library);
        return;
      }
    });
    collectionWrites.current = operation.catch(() => {});
    return operation;
  }, []);
  const profileManagersRef=useRef({});
  const toggleLike = useCallback((t) => {
    if (!t) return;
    const scope=t.recommendationScope || (t.discoveryOrigin?'discovery':'home');
    const profileId=profileManagersRef.current[scope]?.getSnapshot().activeId || 'auto';
    return changeCollections((before) => {
      const list = before.likes;
      const k = trackKeyOf(t);
      const nextL = list.some((x) => trackKeyOf(x) === k)
        ? list.filter((x) => trackKeyOf(x) !== k)
        : [{ ...t, recommendationScope: scope, profileId, addedAt: Date.now() }, ...list];
      return { ...before, likes: nextL };
    });
  }, [changeCollections]);

  const savedKeys = useMemo(() => new Set(savedLibrary.map(trackKeyOf)), [savedLibrary]);
  const isInLibrary = useCallback(
    (t) => !!t && (likedKeys.has(trackKeyOf(t)) || savedKeys.has(trackKeyOf(t))),
    [likedKeys, savedKeys],
  );
  const toggleLibrary = useCallback((t) => {
    if (!t) return;
    const scope=t.recommendationScope || (t.discoveryOrigin?'discovery':'home');
    const profileId=profileManagersRef.current[scope]?.getSnapshot().activeId || 'auto';
    return changeCollections((before) => {
      const list = before.library;
      const key = trackKeyOf(t);
      if (before.likes.some((x) => trackKeyOf(x) === key)
        && !list.some((x) => trackKeyOf(x) === key)) return before;
      const next = list.some((x) => trackKeyOf(x) === key)
        ? list.filter((x) => trackKeyOf(x) !== key)
        : [{ ...t, recommendationScope: scope, profileId, addedAt: Date.now() }, ...list];
      return { ...before, library: next };
    });
  }, [changeCollections]);
  const removeCollectionTrack = useCallback((track, collection) => changeCollections((before) => {
    const keep = (item) => trackKeyOf(item) !== trackKeyOf(track);
    return { likes: before.likes.filter(keep), library: collection === 'library' ? before.library.filter(keep) : before.library };
  }), [changeCollections]);

  // 旧版桌面端写入本地集合时没有保留 mid。首次点击 UP 主时按 bvid
  // 补查视频作者，并写回所有本地歌曲集合，后续启动与同步可直接使用。
  const resolveTrackUp = useCallback(async (track) => {
    if (!track) return null;
    if (track.isSegment && track.parentMid) return track.parentMid;
    if (!track.isSegment && track.mid) return track.mid;
    if (!track.parentBvid && !track.bvid) return null;

    const bvid = String(track.parentBvid || track.bvid);
    const scope = accountScope.current;
    const epoch = libraryEpoch.current;
    const author = await fetchTrackSource(bvid);
    if (!author) return null;
    // 让来自歌单等非 Context 集合的当前对象也立即获得绑定信息。
    const identity = track.isSegment
      ? { parentMid: author.mid, parentUp: author.up, parentTitle: track.parentTitle || author.title }
      : { mid: author.mid, up: author.up };
    Object.assign(track, identity);
    if (scope !== accountScope.current || epoch !== libraryEpoch.current) return author.mid;
    const patch = (list) => {
      let changed = false;
      const next = list.map((item) => {
        if (String(item?.parentBvid || item?.bvid || '') !== bvid || (item.isSegment ? item.parentMid : item.mid)) return item;
        changed = true;
        return { ...item, ...(item.isSegment
          ? { parentMid: author.mid, parentUp: author.up, parentTitle: item.parentTitle || author.title }
          : { mid: author.mid, up: author.up }) };
      });
      return changed ? next : list;
    };
    setQueue((list) => patch(list));
    setLikes((list) => {
      const next = patch(list);
      if (next !== list) {
        likesRef.current = next;
        persistLibrary(LIKES_KEY, next);
      }
      return next;
    });
    setSavedLibrary((list) => {
      const next = patch(list);
      if (next !== list) {
        savedLibraryRef.current = next;
        persistLibrary(MUSIC_LIBRARY_KEY, next);
      }
      return next;
    });
    setHistory((list) => {
      const next = patch(list);
      if (next !== list) persistLibrary(HISTORY_KEY, next);
      return next;
    });
    return author.mid;
  }, [persistLibrary]);
  const libraryTracks = useMemo(() => {
    const seen = new Set();
    return [...likes, ...savedLibrary].filter((track) => {
      const key = trackKeyOf(track);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [likes, savedLibrary]);

  const updateLyricSettings = useCallback((track, patch) => {
    setLyricSettings((all) => {
      const key = trackKeyOf(track);
      const updated = { ...all, [key]: { ...all[key], ...patch } };
      persist(LYRIC_KEY, updated);
      return updated;
    });
  }, [persist]);

  const { recommendationManager, recommendationProfile } = useRecommendationProfile(account, likes, libraryReady);
  const { recommendationManager: discoveryRecommendationManager,
    recommendationProfile: discoveryRecommendationProfile } = useRecommendationProfile(
    account, likes, libraryReady, 'biu.discovery-recommendation-profiles',
  );
  profileManagersRef.current={home:recommendationManager,discovery:discoveryRecommendationManager};
  const listening = useMemo(() => {
    const main = tracker((event) => recommendationManager.recordListening(event));
    const discovery = tracker((event) => discoveryRecommendationManager.recordListening(event));
    return {
      start(track, options) {
        // Each tracker flushes its previous session before starting the next.
        // Capture the source at selection, not when delayed ticks are persisted.
        main.start(queueSourceRef.current === 'discovery' ? null : track, {...options,profileId:recommendationManager.getSnapshot().activeId});
        discovery.start(queueSourceRef.current === 'discovery' ? track : null, {...options,profileId:discoveryRecommendationManager.getSnapshot().activeId});
      },
      tick(position, playing) { main.tick(position, playing); discovery.tick(position, playing); },
      flush() { main.flush(); discovery.flush(); },
    };
  }, [discoveryRecommendationManager, recommendationManager]);
  listeningRef.current = listening;
  useEffect(() => () => listening.flush(), [listening]);
  useEffect(() => { if (!isPlaying) listening.tick(currentTime, false); }, [isPlaying, listening]);
  const profileScope = account?.isLogin && account.mid ? String(account.mid) : '';
  const syncSnapshot = useRef(null);
  const getSyncLibrary = useCallback(async (scope = accountScope.current) => {
    const epoch = libraryEpoch.current;
    const [playlists, recommendation, discoveryRecommendation] = await Promise.all([
      getPlaylists(), recommendationManager.exportSync(), discoveryRecommendationManager.exportSync(),
    ]);
    if (!libraryReadyRef.current || epoch !== libraryEpoch.current || scope !== accountScope.current || scope !== profileScope) throw new Error('账号正在切换');
    const next = { version: 1, likes: likesRef.current, library: savedLibraryRef.current, playlists, recommendation, discoveryRecommendation };
    if (!syncSnapshot.current || Object.keys(next).some(key => next[key] !== syncSnapshot.current[key])) syncSnapshot.current = next;
    return syncSnapshot.current;
  }, [recommendationManager, discoveryRecommendationManager, profileScope]);
  const applySyncLibrary = useCallback((incoming, base, scope = accountScope.current) => {
    const epoch = libraryEpoch.current;
    const check = () => {
      if (!libraryReadyRef.current || epoch !== libraryEpoch.current || scope !== accountScope.current || scope !== profileScope) throw new Error('账号已切换，已取消同步');
    };
    // Account switches wait for this write; a late response cannot enter another bucket.
    const operation = accountSwitch.current.catch(() => {}).then(async () => {
      check();
      const data = await backgroundCompute('libraryNormalize', incoming);
      check();
      await mergeSyncedPlaylists(data.playlists, base?.playlists);
      check();
      await recommendationManager.applySync(data.recommendation, base?.recommendation);
      check();
      await discoveryRecommendationManager.applySync(data.discoveryRecommendation, base?.discoveryRecommendation);
      for (;;) {
        check();
        const before = likesRef.current;
        const beforeLibrary = savedLibraryRef.current;
        const changes = await backgroundCompute('libraryChanges',
          base ? { version: 1, likes: base.likes, library: base.library, playlists: [] } : null,
          { version: 1, likes: data.likes, library: data.library, playlists: [] },
          { version: 1, likes: before, library: beforeLibrary, playlists: [] },
        );
        const next = changes.likes?.value || before;
        const nextLibrary = changes.library?.value || beforeLibrary;
        check();
        if (likesRef.current !== before || savedLibraryRef.current !== beforeLibrary) continue;
        if (changes.likes) await AsyncStorage.setItem(accountKey(LIKES_KEY, scope), changes.likes.raw);
        if (changes.library) await AsyncStorage.setItem(accountKey(MUSIC_LIBRARY_KEY, scope), changes.library.raw);
        check();
        if (likesRef.current !== before || savedLibraryRef.current !== beforeLibrary) continue;
        likesRef.current = next;
        savedLibraryRef.current = nextLibrary;
        setLikes(next);
        setSavedLibrary(nextLibrary);
        return;
      }
    });
    accountSwitch.current = operation.catch(() => {});
    return operation;
  }, [recommendationManager, discoveryRecommendationManager, profileScope]);

  // 单曲循环只影响自动结束，手动上一首/下一首仍可切歌；分切也从自己的起点重播。
  const nextRef = useRef(next);
  nextRef.current = playMode === 'single'
    ? () => playIndex(queue, index, true, true)
    : () => next(true);
  const remoteNextRef = useRef(next);
  remoteNextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;
  useEventListener(events, 'nextTrack', () => remoteNextRef.current());
  useEventListener(events, 'previousTrack', () => prevRef.current());
  useEventListener(events, 'systemSeek', ({ sourceTime, mediaKey, segmentStart, segmentDuration }) => {
    if (!current || current.isLive || resolvingRef.current || !Number.isFinite(sourceTime)) return;
    const segment = segmentRange(current);
    if (mediaKey !== `${current.bvid || ''}:${current.cid || 0}`
      || segmentStart !== (segment?.from || 0)
      || (segment && Math.abs(segmentDuration - (segment.to - segment.from)) > 0.01)) return;
    // The native command has already sought. Only synchronize the UI/lyric clock
    // and guard old source ticks; issuing a second seek here would cancel it.
    pendingSeek.current = { target: sourceTime, started: Date.now(), isSystemSeek: true };
    setCurrentTime(sourceTime);
    setSeekRevision((n) => n + 1);
  });
  const autoNextRef = useRef({ queue, isLive });
  autoNextRef.current = { queue, isLive, range, resolving };
  const endedToken = useRef(-1);
  const advanceOnce = () => {
    const s = autoNextRef.current;
    if (!s.queue.length || s.isLive || resolvingRef.current || (pendingSeek.current?.isSourceSwitch || pendingSeek.current?.isSegmentSwitch || pendingSeek.current?.isSystemSeek) || endedToken.current === tokenRef.current) return;
    endedToken.current = tokenRef.current;
    nextRef.current();
  };
  useEventListener(events, 'playToEnd', () => {
    listening.flush();
    advanceOnce();
  });
  useEventListener(events, 'statusChange', ({ status: nextStatus, error }) => {
    if (nextStatus !== 'error') return;
    // Native decoding/CDN failures can arrive after replaceAsync has resolved.
    // Retry must fetch a fresh URL and replace the failed item, not reuse it.
    loadedMediaKey.current = null;
    videoLoad.current = null;
    setVideoSource(null);
    pendingAutoplayUri.current = null;
    setSourcePending(false);
    setPlayError(error?.message || '视频播放失败，请点击重试');
  });
  useEventListener(events, 'sourceLoad', ({ videoSource: source }) => {
    const load = videoLoad.current;
    if (!load || source?.uri !== load.uri) return;
    // Unlike queue/current and replaceAsync, this event identifies the source
    // whose native tracks actually loaded. Late events cannot reveal another card.
    load.loaded = true;
    publishVideoSource();
  });
  useEventListener(events, 'sourceChange', ({ source }) => {
    if (!pendingAutoplayUri.current || source?.uri !== pendingAutoplayUri.current) return;
    pendingAutoplayUri.current = null;
    setSourcePending(false);
    if (playIntentRef.current) {
      player.staysActiveInBackground = true;
      player.showNowPlayingNotification = true;
      player.audioMixingMode = 'doNotMix';
      player.play();
    }
  });
  useEventListener(events, 'timeUpdate', ({ currentTime: time }) => {
    if (resolvingRef.current || deferredSession.current) return;
    listening.tick(time, player.playing && player.status === 'readyToPlay' && !pendingSeek.current);
    const pending = pendingSeek.current;
    if (pending) {
      // Ticks have no source identity. Do not let even a plausible old clock
      // unlock startup before the matching sourceLoad acknowledges the new item.
      if (pending.isSourceSwitch && !videoLoad.current?.loaded) return;
      // Native ticks queued before a seek must not rewind the scrubber or lyrics.
      // Manual scrubbing can recover to an adjusted native position after a
      // timeout. Source/segment switches must land first, even on a slow connection.
      const elapsed = Date.now() - pending.started;
      if ((pending.isSourceSwitch || pending.isSegmentSwitch || elapsed < 2500)
        && (time < pending.target - 0.5 || time > pending.target + 0.5 + elapsed / 1000)) return;
      // A reset-to-zero tick only proves that the item was installed, not that
      // playback started. Reject stale end events until it moves; surface mounting
      // is independent so it does not have to wait for an audible playback tick.
      if (pending.isSourceSwitch && playIntentRef.current && time <= pending.target) return;
      pendingSeek.current = null;
      publishVideoSource();
    }
    setCurrentTime(time);
    if (playbackSessionRef.current) {
      playbackSessionRef.current.position = Math.max(0, time - (range?.from || 0));
    }
    const s = autoNextRef.current;
    const mediaEnd = Number(player.duration);
    const reachedEnd = s.range ? time >= s.range.to
      : Number.isFinite(mediaEnd) && mediaEnd > 0 && time >= mediaEnd - 0.35;
    // iOS can emit the last time tick after AVPlayer has already changed `playing`
    // to false and omit playToEnd for some progressive streams.
    if (!s.isLive && playIntentRef.current && reachedEnd) advanceOnce();
  });

  useEffect(() => {
    const load = videoLoad.current;
    if (load?.player === player && player.status === 'readyToPlay') {
      load.loaded = true;
      setSourcePending(false);
      publishVideoSource();
    }
    for (const previous of ownedPlayers.current) {
      if (previous === player || previous === activePlayer.current) continue;
      previous.release(); ownedPlayers.current.delete(previous);
    }
    if (player !== basePlayer && !baseRetired.current) {
      baseRetired.current = true;
      basePlayer.replaceAsync(null).catch(() => {});
    }
  }, [player, basePlayer, publishVideoSource]);
  useEffect(() => () => {
    tokenRef.current++;
    for (const owned of ownedPlayers.current) owned.release();
    ownedPlayers.current.clear();
  }, []);

  const playing = !!isPlaying;
  const mediaDeferred = !!deferredSession.current;

  const position = isLive || resolving ? 0
    : Math.max(0, Math.min(range ? range.to - range.from : Infinity, (currentTime || 0) - (range?.from || 0)));
  const duration = isLive ? 0
    : (range ? range.to - range.from : (player.duration || (current && current.duration) || 0));
  const progressValue = useMemo(() => ({ position, duration }), [position, duration]);
  const progressRef = useRef(progressValue);
  progressRef.current = progressValue;
  const foreground = useAppForeground();
  const visibleProgress = useRef(progressValue);
  if (foreground) visibleProgress.current = progressValue;

  const value = useMemo(() => ({
    queue, index, queueSource, current, isLive, playMode, setPlayMode,
    playing,
    mediaDeferred,
    videoSource,
    automaticVideoTransition,
    buffering: resolving || sourcePending || status === 'loading',
    // Backwards-compatible imperative reads stay current without making every
    // usePlayer consumer subscribe to the 250 ms playback clock.
    get position() { return progressRef.current.position; },
    get duration() { return progressRef.current.duration; },
    playError,
    likes, isLiked, toggleLike, libraryTracks, isInLibrary, toggleLibrary, removeCollectionTrack, resolveTrackUp,
    libraryReady, getSyncLibrary, applySyncLibrary,
    account, switchAccount,
    history,
    quality, setQuality,
    lyricSettings, updateLyricSettings,
    lyricEffect, setLyricEffect,
    desktopLyricsEnabled, setDesktopLyricsEnabled,
    lockScreenLyricsEnabled, setLockScreenLyricsEnabled,
    dynamicIslandLyricsEnabled, setDynamicIslandLyricsEnabled,
    seekRevision,
    recommendMode, setRecommendMode, recommendationManager, recommendationProfile,
    homeProfileRevision: recommendationProfile.revision,
    homeStrictProfile: !!recommendationProfile.enabled && recommendationProfile.activeId !== 'auto'
      && recommendationProfile.profiles.some(profile => profile.id === recommendationProfile.activeId),
    discoveryEnabled, setDiscoveryEnabled,
    discoveryRecommendMode, setDiscoveryRecommendMode,
    discoveryRecommendationManager, discoveryRecommendationProfile,
    setVolume, pauseAll, resume,
    playQueue, syncDiscoveryQueue, playIndex, togglePlay, next, prev, seekTo,
    player, // 原始 VideoPlayer：播放页/视频页的 VideoView 共用
  }), [
    queue, index, queueSource, current, isLive, playMode, setPlayMode, playing, mediaDeferred, status, sourcePending, videoSource, automaticVideoTransition,
    resolving, playError, likes, isLiked, toggleLike, libraryTracks, isInLibrary, toggleLibrary, removeCollectionTrack, resolveTrackUp,
    libraryReady, getSyncLibrary, applySyncLibrary, account, switchAccount, history, quality, setQuality, lyricSettings, updateLyricSettings,
    lyricEffect, setLyricEffect,
    desktopLyricsEnabled, setDesktopLyricsEnabled,
    lockScreenLyricsEnabled, setLockScreenLyricsEnabled,
    dynamicIslandLyricsEnabled, setDynamicIslandLyricsEnabled,
    seekRevision,
    recommendMode, setRecommendMode, recommendationManager, recommendationProfile,
    discoveryEnabled, setDiscoveryEnabled,
    discoveryRecommendMode, setDiscoveryRecommendMode,
    discoveryRecommendationManager, discoveryRecommendationProfile,
    setVolume, pauseAll, resume,
    playQueue, syncDiscoveryQueue, playIndex, togglePlay, next, prev, seekTo, player,
  ]);

  const store = useRef(null);
  if (!store.current) {
    const listeners = new Set();
    store.current = { value, getSnapshot: () => store.current.value,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      publish: next => { if (store.current.value === next) return; store.current.value = next; listeners.forEach(listener => listener()); } };
  }
  useLayoutEffect(() => store.current.publish(value), [value]);
  return <PlayerContext.Provider value={store.current}>
    <BackgroundPlaybackProgressContext.Provider value={progressValue}>
      <PlaybackProgressContext.Provider value={visibleProgress.current}>{children}</PlaybackProgressContext.Provider>
    </BackgroundPlaybackProgressContext.Provider>
  </PlayerContext.Provider>;
}

// Narrow subscriptions keep navigation and library pages out of unrelated
// profile, loading and playback updates. Existing consumers can still read all.
export function usePlayer(fields) {
  const store = useContext(PlayerContext);
  const selected = useRef(null);
  const getSnapshot = () => {
    const value = store.getSnapshot();
    if (!fields) return value;
    const previous = selected.current;
    if (previous && fields.length === Object.keys(previous).length && fields.every(key => Object.is(previous[key], value[key]))) return previous;
    selected.current = Object.fromEntries(fields.map(key => [key, value[key]]));
    return selected.current;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
// Only system lyric services need ticks while the UI is suspended. Audio/queue
// progression and usePlayer's imperative position getter always remain live.
export const usePlaybackProgress = ({ background = false } = {}) =>
  useContext(background ? BackgroundPlaybackProgressContext : PlaybackProgressContext);
