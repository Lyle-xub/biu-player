/* Biu Player RN · 全局播放状态
 * 点播：expo-audio 单一 AudioPlayer 常驻（useAudioPlayer），切歌用 replace()；
 * 直播（track.isLive）：expo-video VideoPlayer 播 HLS 流（expo-audio 对 HLS 支持不可靠），
 *   只听声音不渲染 VideoView；无进度条，seekTo 跳过，prev/next 当作换台。
 * 喜欢 / 历史 / 音质设置持久化到 AsyncStorage（喜欢 = 本地歌单）。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as bili from '../api/bili';
import { streamHeaders } from '../api/client';

const LIKES_KEY = 'biu.likes';
const HISTORY_KEY = 'biu.history';
const QUALITY_KEY = 'biu.quality';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const livePlayer = useVideoPlayer(null);
  const { isPlaying: livePlaying } = useEvent(livePlayer, 'playingChange', { isPlaying: livePlayer.playing });

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [resolving, setResolving] = useState(false);
  const [playError, setPlayError] = useState(null);
  const [likes, setLikes] = useState([]);
  const [history, setHistory] = useState([]);
  const [quality, setQualityState] = useState(1);
  const tokenRef = useRef(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
    (async () => {
      try {
        const [l, h, q] = await Promise.all([
          AsyncStorage.getItem(LIKES_KEY),
          AsyncStorage.getItem(HISTORY_KEY),
          AsyncStorage.getItem(QUALITY_KEY),
        ]);
        if (l) setLikes(JSON.parse(l) || []);
        if (h) setHistory(JSON.parse(h) || []);
        if (q !== null) setQualityState(Number(q));
      } catch (e) { /* 本地数据损坏时从空开始 */ }
    })();
  }, []);

  const current = index >= 0 && index < queue.length ? queue[index] : null;
  const isLive = !!(current && current.isLive);

  const persist = useCallback((key, val) => {
    AsyncStorage.setItem(key, JSON.stringify(val)).catch(() => {});
  }, []);

  const playIndex = useCallback(async (list, i) => {
    const t = list[i];
    if (!t) return;
    setQueue(list);
    setIndex(i);
    setResolving(true);
    setPlayError(null);
    const token = ++tokenRef.current;
    try {
      if (t.isLive) {
        // 电台：HLS 走 expo-video，点播播放器静音让位
        player.pause();
        const url = await bili.livePlayUrl(t.roomid);
        if (token !== tokenRef.current) return;
        livePlayer.replaceAsync({ uri: url, headers: streamHeaders(), contentType: 'hls' })
          .then(() => { if (token === tokenRef.current) livePlayer.play(); })
          .catch(() => {});
      } else {
        livePlayer.pause();
        let cid = t.cid;
        if (!cid) {
          const v = await bili.view(t.bvid);
          cid = v && v.cid;
          // 回填 cid，避免重复请求
          if (cid) {
            t.cid = cid;
            setQueue((q) => q.map((item) => (item === t || item.bvid === t.bvid ? { ...item, cid } : item)));
          }
        }
        if (!cid) throw new Error('无法获取视频分 P 信息');
        const url = await bili.playUrl(t.bvid, cid, quality);
        if (token !== tokenRef.current) return; // 已被更新的切歌请求取代
        player.replace({ uri: url, headers: streamHeaders() });
        player.play();
        setHistory((h) => {
          const next = [t, ...h.filter((x) => x.bvid !== t.bvid)].slice(0, 100);
          persist(HISTORY_KEY, next);
          return next;
        });
      }
    } catch (e) {
      if (token !== tokenRef.current) return;
      setPlayError(String(e.message || e));
    } finally {
      if (token === tokenRef.current) setResolving(false);
    }
  }, [player, livePlayer, quality, persist]);

  const playQueue = useCallback((tracks, i = 0) => playIndex(tracks, i), [playIndex]);

  const next = useCallback(() => {
    if (!queue.length) return;
    playIndex(queue, (index + 1) % queue.length);
  }, [queue, index, playIndex]);

  const prev = useCallback(() => {
    if (!queue.length) return;
    playIndex(queue, (index - 1 + queue.length) % queue.length);
  }, [queue, index, playIndex]);

  const togglePlay = useCallback(() => {
    if (!current) return;
    if (current.isLive) {
      if (livePlayer.playing) livePlayer.pause();
      else livePlayer.play();
      return;
    }
    if (player.playing) player.pause();
    else player.play();
  }, [player, livePlayer, current]);

  const seekTo = useCallback((sec) => {
    if (current && current.isLive) return; // 直播不可拖
    player.seekTo(Math.max(0, sec)).catch(() => {});
  }, [player, current]);

  // 恢复当前曲目播放（与 pauseAll 配对，用于视频页返回后继续音频）
  const resume = useCallback(() => {
    if (!current) return;
    try {
      if (current.isLive) livePlayer.play();
      else player.play();
    } catch (e) { /* 忽略 */ }
  }, [player, livePlayer, current]);

  // 音量（expo-audio 播放器内音量，0~1；仅作用于点播流）
  const setVolume = useCallback((v) => {
    try { player.volume = Math.max(0, Math.min(1, v)); } catch (e) { /* 忽略 */ }
  }, [player]);

  // 互斥暂停（进视频页等场景）：两个 player 都暂停
  const pauseAll = useCallback(() => {
    try { player.pause(); } catch (e) {}
    try { livePlayer.pause(); } catch (e) {}
  }, [player, livePlayer]);

  const setQuality = useCallback((q) => {
    setQualityState(q);
    persist(QUALITY_KEY, q);
  }, [persist]);

  const trackKey = (t) => t && (t.bvid || String(t.roomid || '') || String(t.aid));
  const isLiked = useCallback(
    (t) => !!t && likes.some((x) => trackKey(x) === trackKey(t)),
    [likes],
  );
  const toggleLike = useCallback((t) => {
    if (!t) return;
    setLikes((list) => {
      const k = trackKey(t);
      const next = list.some((x) => trackKey(x) === k)
        ? list.filter((x) => trackKey(x) !== k)
        : [t, ...list];
      persist(LIKES_KEY, next);
      return next;
    });
  }, [persist]);

  // 播完自动下一首（直播流不会触发 didJustFinish）
  useEffect(() => {
    if (status.didJustFinish && queue.length && !isLive) next();
  }, [status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  const playing = isLive ? !!livePlaying : !!status.playing;

  const value = useMemo(() => ({
    queue, index, current, isLive,
    playing,
    buffering: resolving || (!isLive && !!status.isBuffering),
    position: isLive ? 0 : (status.currentTime || 0),
    duration: isLive ? 0 : (status.duration || (current && current.duration) || 0),
    playError,
    likes, isLiked, toggleLike,
    history,
    quality, setQuality,
    setVolume, pauseAll, resume,
    playQueue, playIndex, togglePlay, next, prev, seekTo,
  }), [
    queue, index, current, isLive, playing, status.isBuffering, status.currentTime, status.duration,
    resolving, playError, likes, isLiked, toggleLike, history, quality, setQuality,
    setVolume, pauseAll, resume,
    playQueue, playIndex, togglePlay, next, prev, seekTo,
  ]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => useContext(PlayerContext);
