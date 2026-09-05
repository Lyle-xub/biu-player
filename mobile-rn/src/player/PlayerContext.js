/* Biu Player RN · 全局播放状态（单一 expo-video player 架构）
 * 点播与直播共用同一个 VideoPlayer：
 *   点播：progressive mp4 整文件流（bili.videoUrl，含音轨）——播放页歌词模式只是
 *     把视频画面藏起来，声音一直从这个 player 出；切「原视频」只是显示画面，
 *     永不 replace/pause/resume，从根上消灭重载与串台。
 *   直播（track.isLive）：同一 player 播 HLS（contentType:'hls'）；无进度条，
 *     seekTo 跳过，prev/next 当作换台。
 * 竞态防护：tokenRef 自增校验 + replaceChain 串行化 replaceAsync——
 *   同一时刻只有最新 track 的加载流程能落地 replace/play。
 * 喜欢 / 历史 / 音质设置持久化到 AsyncStorage（喜欢 = 本地歌单）。
 * 后台播放：app.json expo-video plugin supportsBackgroundPlayback + staysActiveInBackground；
 *   showNowPlayingNotification 接入系统媒体控件，source.metadata 随切歌更新。
 *   setAudioModeAsync（expo-audio）仍用于配置 iOS 音频会话（静音键下出声）。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { setAudioModeAsync } from 'expo-audio';
import { useVideoPlayer } from 'expo-video';
import { useEvent, useEventListener } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as bili from '../api/bili';
import { authStatus, initClient, streamHeaders } from '../api/client';
import { segmentRange, trackKeyOf } from './track';
import { PLAYBACK_QUALITIES, normalizePlaybackQuality } from './playbackQuality';
import { getPlaylists, mergeSyncedPlaylists, setPlaylistScope } from '../store/playlists';
import { accountKey, adoptGuestLibrary, readAccountValue } from '../store/accountStorage';
import { reconcile, normalize } from '../../../renderer/library-sync';

import useRecommendationProfile from '../store/useRecommendationProfile';
import { tracker } from '../../../renderer/daily-recommendation';

const LIKES_KEY = 'biu.likes';
const HISTORY_KEY = 'biu.history';
const QUALITY_KEY = 'biu.quality';
const LYRIC_KEY = 'biu.lyric-settings';
const LYRIC_EFFECT_KEY = 'biu.lyric-effect';
const RECOMMEND_MODE_KEY = 'biu.recommend-mode';
const PLAY_MODE_KEY = 'biu.play-mode';
export const PLAY_MODES = ['loop', 'single', 'shuffle'];
export const RECOMMEND_MODES = ['music', 'all'];

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.25; // UI samples; lyric interpolation runs on the native driver.
    p.staysActiveInBackground = true; // 退后台继续出声（音频不中断）
    p.showNowPlayingNotification = true; // 通知栏 / 锁屏媒体控件，由原生播放器同步播放状态
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const [currentTime, setCurrentTime] = useState(0);
  const pendingSeek = useRef(null);

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playMode, setPlayModeState] = useState('loop');
  const playModeEdited = useRef(false);
  const shuffleHistory = useRef([]);
  const [resolving, setResolving] = useState(false);
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
  const [history, setHistory] = useState([]);
  const [quality, setQualityState] = useState(1);
  const qualityEdited = useRef(false);
  const [lyricSettings, setLyricSettings] = useState({});
  const [lyricEffect, setLyricEffectState] = useState('simple');
  const [recommendMode, setRecommendModeState] = useState('music');
  const [seekRevision, setSeekRevision] = useState(0);
  const lyricEffectEdited = useRef(false);
  const recommendModeEdited = useRef(false);
  const tokenRef = useRef(0);
  const listeningRef = useRef(null);
  const searchPlaybackRef = useRef(false);
  const resolvingRef = useRef(false);
  const loadedMediaKey = useRef(null);
  const replaceChain = useRef(Promise.resolve()); // 串行化 replaceAsync，防串台

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
      const [nextLikes, nextHistory] = await Promise.all([
        readAccountValue(LIKES_KEY, nextScope, []),
        readAccountValue(HISTORY_KEY, nextScope, []),
        setPlaylistScope(nextScope),
      ]);
      accountScope.current = nextScope;
      likesRef.current = Array.isArray(nextLikes) ? nextLikes : [];
      setLikes(likesRef.current);
      setHistory(Array.isArray(nextHistory) ? nextHistory : []);
      setAccount(normalized);
      libraryReadyRef.current = true;
      setLibraryReady(true);
      return normalized;
    });
    return accountSwitch.current;
  }, []);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
    (async () => {
      try {
        const [q, lyric] = await Promise.all([
          AsyncStorage.getItem(QUALITY_KEY),
          AsyncStorage.getItem(LYRIC_KEY),
        ]);
        if (q !== null && !qualityEdited.current) setQualityState(normalizePlaybackQuality(q));
        if (lyric) setLyricSettings(JSON.parse(lyric) || {});
      } catch (e) { /* 本地数据损坏时从空开始 */ }
    })();
    Promise.resolve(typeof initClient === 'function' ? initClient() : undefined)
      .then(() => (typeof authStatus === 'function' ? authStatus() : { isLogin: false }))
      .then(switchAccount)
      .catch(() => switchAccount({ isLogin: false }));
    AsyncStorage.getItem(LYRIC_EFFECT_KEY).then((raw) => {
      if (!lyricEffectEdited.current) setLyricEffectState(JSON.parse(raw) === 'monet' ? 'monet' : 'simple');
    }).catch(() => {});
    AsyncStorage.getItem(RECOMMEND_MODE_KEY).then((raw) => {
      const saved = JSON.parse(raw);
      if (!recommendModeEdited.current && RECOMMEND_MODES.includes(saved)) setRecommendModeState(saved);
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

  const playIndex = useCallback(async (list, i, keepShuffleHistory = false, automatic = false, startAt = 0) => {
    const t = list[i];
    if (!t) return;
    listeningRef.current?.start(t, { manual: !automatic, search: !automatic && searchPlaybackRef.current });
    searchPlaybackRef.current = false;
    if (!keepShuffleHistory) shuffleHistory.current = [];
    setQueue(list);
    setIndex(i);
    setResolving(true);
    setPlayError(null);
    const token = ++tokenRef.current;
    pendingSeek.current = null;
    resolvingRef.current = true;
    try {
      // 自动续播时保留 playWhenReady：pause 会让 Android 媒体服务退出前台，
      // 随后的后台取流 / 重新播放可能被系统限制。replaceAsync 本身会切换旧媒体。
      if (!automatic) player.pause();
      let source;
      let mediaKey;
      if (t.isLive) {
        // 电台：HLS（同一 player，contentType 显式声明）
        const url = await bili.livePlayUrl(t.roomid);
        if (token !== tokenRef.current) return;
        source = { uri: url, headers: streamHeaders(), contentType: 'hls' };
      } else {
        let cid = t.cid;
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
        if (loadedMediaKey.current !== mediaKey) {
          // 音画共用视频流；自动不指定 qn，手动档位传递实际的视频清晰度。
          const url = await bili.videoUrl(t.bvid, cid, quality === 1 ? undefined : quality);
          if (token !== tokenRef.current) return; // 已被更新的切歌请求取代
          source = { uri: url, headers: streamHeaders(), contentType: 'progressive' };
        }
      }
      if (source) source.metadata = {
        title: t.parentTitle || t.title || 'Biu Player',
        artist: t.up || undefined,
        artwork: t.pic || undefined,
      };
      // 串行 replace：过期的加载流程到这一步直接丢弃，只有最新 track 能落地
      replaceChain.current = replaceChain.current.catch(() => {}).then(async () => {
        if (token !== tokenRef.current) return;
        if (source) {
          try {
            await player.replaceAsync(source);
            loadedMediaKey.current = mediaKey;
          } catch (e) {
            if (token === tokenRef.current) setPlayError('播放失败：' + String(e.message || e));
            return;
          }
        }
        if (token !== tokenRef.current) return;
        const segment = segmentRange(t);
        const offset = Number.isFinite(startAt) ? Math.max(0, Math.min(startAt,
          segment ? segment.to - segment.from : (player.duration || t.duration || Infinity))) : 0;
        const start = (segment?.from || 0) + offset;
        if (!t.isLive) {
          // iOS seeks asynchronously even when two segments share the same
          // video. Old progress/end events must not finish the new segment.
          if (segment || offset > 0) pendingSeek.current = { target: start, started: Date.now(), isSegmentSwitch: !!segment };
          player.currentTime = start;
        }
        setCurrentTime(start);
        player.play();
        if (!t.isLive) {
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
      setPlayError(String(e.message || e));
    } finally {
      if (token === tokenRef.current) {
        resolvingRef.current = false;
        setResolving(false);
      }
    }
  }, [player, quality, persistLibrary]);

  const playQueue = useCallback((tracks, i = 0, startAt = 0, source = '') => {
    searchPlaybackRef.current = source === 'search';
    return playIndex(tracks, i, false, false, startAt);
  }, [playIndex]);

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
    if (playError) { playIndex(queue, index); return; } // 取流失败时播放键 = 重试
    if (player.playing) player.pause();
    else player.play();
  }, [player, current, playError, queue, index, playIndex]);

  const seekTo = useCallback((sec) => {
    if (!current || current.isLive || resolvingRef.current) return;
    if (!Number.isFinite(sec)) return;
    const segment = segmentRange(current);
    const end = segment ? segment.to - segment.from : (player.duration || current?.duration || Infinity);
    try {
      const target = (segment?.from || 0) + Math.max(0, Math.min(end, sec));
      pendingSeek.current = { target, started: Date.now() };
      player.currentTime = target;
      setCurrentTime(target); // Paused seek updates lyrics without waiting for a native tick.
      setSeekRevision((n) => n + 1); // Even a small seek must reset the lyric clock immediately.
    } catch (e) { pendingSeek.current = null; }
  }, [player, current]);

  // 恢复当前曲目播放（单 player 架构下等价于 player.play()，保留给旧调用方）
  const resume = useCallback(() => {
    if (!current) return;
    try { player.play(); } catch (e) { /* 忽略 */ }
  }, [player, current]);

  // 音量（player 内音量，0~1）
  const setVolume = useCallback((v) => {
    try { player.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* 忽略 */ }
  }, [player]);

  // 单 player 架构下等价于 pause()，保留 API 兼容
  const pauseAll = useCallback(() => {
    try { player.pause(); } catch (e) {}
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

  const setRecommendMode = useCallback((mode) => {
    if (!RECOMMEND_MODES.includes(mode)) return;
    recommendModeEdited.current = true;
    setRecommendModeState(mode);
    persist(RECOMMEND_MODE_KEY, mode);
  }, [persist]);

  const isLiked = useCallback(
    (t) => !!t && likes.some((x) => trackKeyOf(x) === trackKeyOf(t)),
    [likes],
  );
  const toggleLike = useCallback((t) => {
    if (!t) return;
    setLikes((list) => {
      const k = trackKeyOf(t);
      const nextL = list.some((x) => trackKeyOf(x) === k)
        ? list.filter((x) => trackKeyOf(x) !== k)
        : [t, ...list];
      persistLibrary(LIKES_KEY, nextL);
      return nextL;
    });
  }, [persistLibrary]);

  const updateLyricSettings = useCallback((track, patch) => {
    setLyricSettings((all) => {
      const key = trackKeyOf(track);
      const updated = { ...all, [key]: { ...all[key], ...patch } };
      persist(LYRIC_KEY, updated);
      return updated;
    });
  }, [persist]);

  const { recommendationManager, recommendationProfile } = useRecommendationProfile(account, likes, libraryReady);
  const listening = useMemo(() => tracker((event) => recommendationManager.recordListening(event)), [recommendationManager]);
  listeningRef.current = listening;
  useEffect(() => () => listening.flush(), [listening]);
  useEffect(() => { if (!isPlaying) listening.tick(currentTime, false); }, [isPlaying, listening]);
  const profileScope = account?.isLogin && account.mid ? String(account.mid) : '';
  const getSyncLibrary = useCallback(async (scope = accountScope.current) => {
    const epoch = libraryEpoch.current;
    const [playlists, recommendation] = await Promise.all([getPlaylists(), recommendationManager.exportSync()]);
    if (!libraryReadyRef.current || epoch !== libraryEpoch.current || scope !== accountScope.current || scope !== profileScope) throw new Error('账号正在切换');
    return { version: 1, likes: likesRef.current, playlists, recommendation };
  }, [recommendationManager, profileScope]);
  const applySyncLibrary = useCallback((incoming, base, scope = accountScope.current) => {
    const epoch = libraryEpoch.current;
    const check = () => {
      if (!libraryReadyRef.current || epoch !== libraryEpoch.current || scope !== accountScope.current || scope !== profileScope) throw new Error('账号已切换，已取消同步');
    };
    // Account switches wait for this write; a late response cannot enter another bucket.
    const operation = accountSwitch.current.catch(() => {}).then(async () => {
      check();
      const data = normalize(incoming);
      await mergeSyncedPlaylists(data.playlists, base?.playlists);
      check();
      await recommendationManager.applySync(data.recommendation, base?.recommendation);
      for (;;) {
        check();
        const before = likesRef.current;
        const next = reconcile(base ? { version: 1, likes: base.likes, playlists: [] } : null,
          { version: 1, likes: data.likes, playlists: [] }, { version: 1, likes: before, playlists: [] }).likes;
        await AsyncStorage.setItem(accountKey(LIKES_KEY, scope), JSON.stringify(next));
        check();
        if (likesRef.current !== before) continue;
        likesRef.current = next;
        setLikes(next);
        return;
      }
    });
    accountSwitch.current = operation.catch(() => {});
    return operation;
  }, [recommendationManager, profileScope]);

  // 单曲循环只影响自动结束，手动上一首/下一首仍可切歌；分切也从自己的起点重播。
  const nextRef = useRef(next);
  nextRef.current = playMode === 'single'
    ? () => playIndex(queue, index, true, true)
    : () => next(true);
  const autoNextRef = useRef({ queue, isLive });
  autoNextRef.current = { queue, isLive, range, resolving };
  const endedToken = useRef(-1);
  const advanceOnce = () => {
    const s = autoNextRef.current;
    if (!s.queue.length || s.isLive || resolvingRef.current || pendingSeek.current?.isSegmentSwitch || endedToken.current === tokenRef.current) return;
    endedToken.current = tokenRef.current;
    nextRef.current();
  };
  useEventListener(player, 'playToEnd', () => {
    listening.flush();
    advanceOnce();
  });
  useEventListener(player, 'timeUpdate', ({ currentTime: time }) => {
    if (resolvingRef.current) return;
    listening.tick(time, player.playing && player.status === 'readyToPlay' && !pendingSeek.current);
    const pending = pendingSeek.current;
    if (pending) {
      // Native ticks queued before a seek must not rewind the scrubber or lyrics.
      // Manual scrubbing can recover to an adjusted native position after a
      // timeout. A segment switch must land first, even on a slow connection.
      const elapsed = Date.now() - pending.started;
      if ((pending.isSegmentSwitch || elapsed < 2500)
        && (time < pending.target - 0.5 || time > pending.target + 0.5 + elapsed / 1000)) return;
      pendingSeek.current = null;
    }
    setCurrentTime(time);
    const s = autoNextRef.current;
    if (s.range && player.playing && time >= s.range.to) advanceOnce();
  });

  const playing = !!isPlaying;

  const value = useMemo(() => ({
    queue, index, current, isLive, playMode, setPlayMode,
    playing,
    buffering: resolving || status === 'loading',
    position: isLive || resolving ? 0 : Math.max(0, Math.min(range ? range.to - range.from : Infinity, (currentTime || 0) - (range?.from || 0))),
    duration: isLive ? 0 : (range ? range.to - range.from : (player.duration || (current && current.duration) || 0)),
    playError,
    likes, isLiked, toggleLike, libraryReady, getSyncLibrary, applySyncLibrary,
    account, switchAccount,
    history,
    quality, setQuality,
    lyricSettings, updateLyricSettings,
    lyricEffect, setLyricEffect, seekRevision,
    recommendMode, setRecommendMode, recommendationManager, recommendationProfile,
    setVolume, pauseAll, resume,
    playQueue, playIndex, togglePlay, next, prev, seekTo,
    player, // 原始 VideoPlayer：播放页/视频页的 VideoView 共用
  }), [
    queue, index, current, isLive, playMode, setPlayMode, playing, status, currentTime,
    resolving, playError, likes, isLiked, toggleLike, libraryReady, getSyncLibrary, applySyncLibrary, account, switchAccount, history, quality, setQuality, lyricSettings, updateLyricSettings,
    lyricEffect, setLyricEffect, seekRevision, recommendMode, setRecommendMode, recommendationManager, recommendationProfile,
    setVolume, pauseAll, resume,
    playQueue, playIndex, togglePlay, next, prev, seekTo, player,
  ]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => useContext(PlayerContext);
