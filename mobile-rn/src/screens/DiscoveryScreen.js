import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, runOnUI, useAnimatedStyle, useFrameCallback, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { VideoView } from 'expo-video';
import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeProfile } from '../../../renderer/recommendation-profile';
import { usePlayer } from '../player/PlayerContext';
import { trackKeyOf } from '../player/track';
import { clearDiscoveryPreloads, preloadDiscoveryQueue } from '../player/discoveryPreload';
import { addToPlaylist, usePlaylists } from '../store/playlists';
import * as bili from '../api/bili';
import RemoteImage from '../components/RemoteImage';
import BottomSheet from '../components/BottomSheet';
import Overlay from '../components/Overlay';
import { IconCheck, IconChevronDown, IconPlaylist, IconProfileSwitch } from '../components/icons';
import { colors, fmtDur } from '../theme';
import DiscoveryWheel, { DiscoveryWheelHaze } from './DiscoveryWheel';
import { buildRelatedRun, filterDiscoveryCandidates, yieldDiscoveryWork } from './discoveryFeed';
import { createDiscoveryExclusions } from './discoveryExclusions';
import { readDiscoveryFolders, writeDiscoveryFolders, folderCoverEntry, folderCoverFresh } from './discoveryFolders';
import { DISCOVERY_LOW_WATER, DISCOVERY_TARGET, readDiscoveryQueue, writeDiscoveryQueue } from './discoveryQueue';
import { cardExitTiming, clamp, coastWheel, resolveDiscoveryGesture, wheelEdgeSpeed, wheelGeometry, wheelHit, wheelPosition, wrap } from './discoveryGesture';

const SPRING = { damping: 23, stiffness: 260 };
const coverImages = (tracks) => {
  const images = new Set();
  for (const track of tracks || []) {
    if (track.pic) images.add(track.pic);
    if (images.size === 4) break;
  }
  return [...images];
};

function DiscoveryCardFrame({ cardKey, motionKey, x, y, scale, children, ...props }) {
  // Each keyed card owns its mapper and initial native style. A newly mounted
  // card must never inherit the previous card's offscreen exit transform.
  const style = useAnimatedStyle(() => {
    const ownsMotion = motionKey.value === cardKey;
    const dx = ownsMotion ? x.value : 0;
    return { transform: [
      { translateX: dx }, { translateY: ownsMotion ? y.value : 0 },
      { rotate: `${clamp(dx / 45, -8, 8)}deg` }, { scale: ownsMotion ? scale.value : 1 },
    ] };
  });
  return <Animated.View {...props} style={[s.cardBounds, style]}>{children}</Animated.View>;
}

export const DiscoveryCard = React.memo(function DiscoveryCard({ track, player, visible, videoSource, buffering, error, playing, continuous = false }) {
  const currentRevision = useRef(null);
  const sourceRevision = visible && videoSource?.key === trackKeyOf(track) ? videoSource.revision : null;
  // Autoplay replaces the item on this very surface. Keep its mount identity:
  // queue/source metadata updates must not cover playback.
  const revision = visible && continuous && currentRevision.current !== null ? currentRevision.current : sourceRevision;
  const canAttach = revision !== null;
  currentRevision.current = revision;
  // Native first-frame presentation owns visibility. A JS overlay waiting for
  // onFirstFrameRender can conceal an already playing picture when events lag.
  return <View style={s.card}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View testID="discovery-backdrop" style={[StyleSheet.absoluteFill, s.backdrop]}>
        <RemoteImage uri={track.pic} width={720} height={960} blurRadius={32} cachePolicy="memory-disk" style={StyleSheet.absoluteFill} />
        <View style={s.tint} />
      </View>
      {canAttach && <VideoView key={revision} testID="discovery-video" player={player} surfaceType="textureView"
        style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false}
        keepScreenAwake={false} useExoShutter />}
    </View>
    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.82)']} locations={[0.5, 1]} style={StyleSheet.absoluteFill} />
    <View style={s.badge}>
      {buffering ? <ActivityIndicator size="small" color={colors.accent} /> : <View style={s.dot} />}
      <Text style={s.badgeText}>{error ? '播放失败 · 点击重试' : buffering ? '正在加载视频' : playing ? '正在播放' : '已暂停 · 点击继续'}</Text>
    </View>
    {error ? <View style={s.videoError}><Text style={s.errorText}>{error}</Text></View> : null}
    <View style={s.copy}>
      <Text style={s.title} numberOfLines={2}>{track.title}</Text>
      <Text style={s.up} numberOfLines={1}>{track.up || '未知 UP 主'}</Text>
      <View style={s.meta}><Text style={s.metaText}>{track.tname || '为你推荐'}</Text>
        {!!track.duration && <Text style={s.metaText}>{fmtDur(track.duration)}</Text>}</View>
    </View>
  </View>;
});

export default function DiscoveryScreen({ navigation }) {
  const context = usePlayer();
  const { account, discoveryRecommendMode = 'all', discoveryRecommendationManager: manager,
    discoveryRecommendationProfile: profileState, current: playingTrack, player,
    playing, buffering, playError, queueSource, playQueue, syncDiscoveryQueue, resume, videoSource, quality, automaticVideoTransition } = context;
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const pagePaddingBottom = 127 + insets.bottom;
  const wheelBlurBounds = useMemo(() => ({
    top: -(s.header.height + insets.top),
    bottom: -(s.footer.height + pagePaddingBottom),
  }), [insets.top, pagePaddingBottom]);
  const playlists = usePlaylists();
  const [tracks, setTracks] = useState([]);
  const [index, setIndex] = useState(0);
  const [cardGeneration, setCardGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [favoriteCovers, setFavoriteCovers] = useState({});
  const folderCacheRef = useRef({ scope: '', folders: [], covers: {} });
  const [folderError, setFolderError] = useState('');
  const [folderRetry, setFolderRetry] = useState(0);
  const [wheelOpen, setWheelOpen] = useState(false);
  const wheelBlurTarget = useRef(null);
  const [wheelReady, setWheelReady] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [message, setMessage] = useState('');
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [motionRevision, setMotionRevision] = useState(0);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const relatedTask = useRef(0);
  const pendingDislike = useRef(null);
  const pendingDrop = useRef(null);
  const stage = useRef(null);
  const page = useRef({ generation: 0, loading: false, cursor: null, seen: new Set(), related: new Set(), pending: [], checked: 0 });
  const requests = useRef(new Set());
  const emptySearches = useRef(0);
  const mounted = useRef(true);
  const toastTimer = useRef(null);
  const playback = useRef({ requested: '', pending: false });
  const actions = useRef({});
  const latest = useRef({});
  const active = focused && appActive;
  const [mediaActive, setMediaActive] = useState(false);
  useEffect(() => {
    if (!active) { setMediaActive(false); return; }
    const timer = setTimeout(() => setMediaActive(true), 32);
    return () => clearTimeout(timer);
  }, [active]);
  const exclusions = useMemo(() => createDiscoveryExclusions(account?.isLogin ? account.mid : ''), [account?.isLogin, account?.mid]);
  const relatedRequests = useMemo(() => new Map(), [exclusions]);
  const track = tracks[index];
  const hasTrack = !!track;
  const cardKey = trackKeyOf(track);
  const playingKey = trackKeyOf(playingTrack);
  const targets = useMemo(() => [
    { key: 'library', kind: 'library', title: '音乐库', subtitle: `${context.libraryTracks?.length || 0} 个视频`, covers: coverImages(context.libraryTracks) },
    { key: 'likes', kind: 'likes', title: '我喜欢', subtitle: `${context.likes?.length || 0} 个视频`, covers: coverImages(context.likes) },
    ...playlists.map((p) => ({ key: `playlist:${p.id}`, kind: 'playlist', id: p.id,
      title: p.title, subtitle: `${p.tracks?.length || 0} 个视频`, covers: coverImages(p.tracks) })),
    ...favorites.map((f) => ({ key: `favorite:${f.id}`, kind: 'favorite', id: f.id,
      title: f.title, subtitle: `${f.count} 个视频`, covers: favoriteCovers[f.id]?.uris || [f.pic].filter(Boolean) })),
  ], [playlists, favorites, favoriteCovers, context.likes, context.libraryTracks]);
  const targetKeys = targets.map((target) => target.key).join('|');
  latest.current = { tracks, index, track, targets, context, active, exclusions };

  function appendTracks(items) {
    setTracks((old) => {
      const seen = new Set(old.map((item) => item.bvid));
      const next = items.filter((item) => {
        if (seen.has(item.bvid) || exclusions.has(item)) return false;
        seen.add(item.bvid); return true;
      });
      return next.length ? [...old, ...next] : old;
    });
  }

  function pruneExcluded() {
    const state = latest.current;
    if (!mounted.current || state.exclusions !== exclusions || pendingDislike.current === trackKeyOf(state.track)) return;
    const remaining = state.tracks.slice(state.index);
    const next = remaining.filter((item) => !exclusions.has(item));
    if (next.length === remaining.length) return;
    if (trackKeyOf(next[0]) !== trackKeyOf(state.track)) {
      setCardGeneration((n) => n + 1);
    }
    latest.current = { ...state, tracks: next, index: 0, track: next[0] };
    setTracks(next); setIndex(0);
    state.context.syncDiscoveryQueue(next);
  }
  function relatedFor(bvid, signal) {
    if (!relatedRequests.has(bvid)) {
      const request = bili.relatedVideos(bvid, { signal, timeout: 6000, retry: false }).catch((error) => { if (relatedRequests.get(bvid) === request) relatedRequests.delete(bvid); throw error; });
      relatedRequests.set(bvid, request);
      if (relatedRequests.size > 200) relatedRequests.delete(relatedRequests.keys().next().value);
    }
    return relatedRequests.get(bvid);
  }
  function excludeRelated(bvid) {
    if (!latest.current.active) return;
    const controller = new AbortController(); requests.current.add(controller);
    relatedFor(bvid, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      const saved = exclusions.addRelated(bvid, items);
      if (saved) { pruneExcluded(); saved.catch(() => notify('不喜欢记录保存失败，本次浏览仍生效')); }
    }).catch(() => {}).finally(() => requests.current.delete(controller)); // Persisted pending seeds retry on the next refill.
  }

  const stopSearch = useCallback(() => {
    latest.current.active = false;
    const feed = page.current;
    if (feed.suspended) return;
    feed.suspended = true;
    feed.resume = feed.resume || feed.loading;
    feed.generation++; feed.loading = false;
    if (feed.working?.length) feed.pending = feed.working;
    feed.working = null;
    const abandoned = [...requests.current]; requests.current.clear();
    // Invalidate results above immediately. Native cancellation and its listener
    // fan-out run after the navigation dispatch has returned.
    setTimeout(() => abandoned.forEach(controller => controller.abort()), 0);
    relatedRequests.clear(); relatedTask.current++;
    if (mounted.current) { setLoading(false); setRelatedLoading(false); }
  }, [relatedRequests]);
  useEffect(() => navigation.addListener?.('blur', stopSearch), [navigation, stopSearch]);

  const x = useSharedValue(0), y = useSharedValue(0), scale = useSharedValue(1);
  const motionKey = useSharedValue(cardKey);
  const rotation = useSharedValue(0), velocity = useSharedValue(0);
  const dragging = useSharedValue(false), busy = useSharedValue(false);
  const visibility = useSharedValue(0), hover = useSharedValue(-1);
  const pointerX = useSharedValue(0), pointerY = useSharedValue(0);
  const stageX = useSharedValue(0), stageY = useSharedValue(0);
  const stageWidth = useSharedValue(0), stageHeight = useSharedValue(0);
  const count = useSharedValue(targets.length), lastY = useSharedValue(0);
  const enabled = useSharedValue(active);
  const deckIndex = useSharedValue(index), deckLength = useSharedValue(tracks.length);

  useLayoutEffect(() => {
    deckIndex.value = index; deckLength.value = tracks.length;
  }, [index, tracks.length]);

  useLayoutEffect(() => {
    // The new frame already mounts at rest. Transfer ownership only after all
    // outgoing animations are cancelled and their values reset in one UI job.
    runOnUI((key) => {
      'worklet';
      cancelAnimation(x); cancelAnimation(y); cancelAnimation(scale);
      x.value = 0; y.value = 0; scale.value = 1;
      motionKey.value = key; busy.value = false;
    })(cardKey);
  }, [cardKey]);

  const notify = useCallback((text) => {
    if (!mounted.current) return;
    clearTimeout(toastTimer.current);
    setMessage(text);
    toastTimer.current = setTimeout(() => setMessage(''), 2600);
  }, []);
  const resetMotion = useCallback((animated = true) => {
    if (!mounted.current) return;
    runOnUI((animate) => {
      'worklet';
      dragging.value = false; busy.value = false; hover.value = -1;
      velocity.value = 0;
      [x, y, scale, rotation, visibility].forEach(cancelAnimation);
      visibility.value = animate ? withTiming(0, { duration: 160 }) : 0;
      x.value = animate ? withSpring(0, SPRING) : 0;
      y.value = animate ? withSpring(0, SPRING) : 0;
      scale.value = animate ? withSpring(1, SPRING) : 1;
    })(animated);
    setWheelOpen(false);
    setMotionRevision((revision) => revision + 1);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') stopSearch(); setAppActive(state === 'active'); });
    return () => {
      mounted.current = false; stopSearch(); subscription.remove();
      clearTimeout(toastTimer.current); enabled.value = false;
      [x, y, scale, rotation, visibility].forEach(cancelAnimation);
    };
  }, []);
  useEffect(() => {
    enabled.value = active;
    if (!active) {
      stopSearch();
      pendingDislike.current = null; pendingDrop.current = null;
      resetMotion(false);
    } else { page.current.suspended = false; pruneExcluded(); }
  }, [active, resetMotion, exclusions, stopSearch]);
  useEffect(() => {
    if (!active || !hasTrack) { setWheelReady(false); return; }
    const timer = setTimeout(() => setWheelReady(true), 350);
    return () => clearTimeout(timer);
  }, [active, hasTrack]);
  useEffect(() => {
    count.value = targets.length;
    if (wheelOpen || dragging.value) resetMotion();
  }, [targetKeys, resetMotion]);
  const measureStage = useCallback((event) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height }); stageWidth.value = width; stageHeight.value = height;
    stage.current?.measureInWindow((left, top) => { stageX.value = left; stageY.value = top; });
    resetMotion();
  }, [resetMotion]);

  useEffect(() => {
    let live = true;
    const scope = account?.isLogin ? String(account.mid) : '';
    setFolderError('');
    if (folderCacheRef.current.scope !== scope) {
      setFavorites([]); setFavoriteCovers({});
      folderCacheRef.current = { scope, folders: [], covers: {} };
    }
    if (scope && active) (async () => {
      const cached = await readDiscoveryFolders(scope);
      if (!live) return;
      folderCacheRef.current = cached;
      setFavorites(cached.folders); setFavoriteCovers(cached.covers);
      try {
        const folders = await bili.favFolders(account.mid);
        if (!live) return;
        const cache = { ...folderCacheRef.current, folders };
        folderCacheRef.current = cache; setFavorites(folders);
        writeDiscoveryFolders(cache).catch(() => {});
      } catch { if (live) setFolderError('收藏夹更新失败，点击重试'); }
    })();
    return () => { live = false; };
  }, [account?.isLogin, account?.mid, folderRetry, active]);

  useEffect(() => {
    if (!wheelOpen || !active || !account?.isLogin) return;
    let live = true;
    const scope = String(account.mid);
    (async () => {
      const missing = favorites.filter((folder) => !folderCoverFresh(folderCacheRef.current.covers[folder.id], folder));
      for (let i = 0; i < missing.length && live; i += 2) {
        const batch = await Promise.all(missing.slice(i, i + 2).map(async (folder) => {
          try { return [folder.id, folderCoverEntry(folder, coverImages((await bili.favItems(folder.id, 1, 4)).list))]; }
          catch { return null; } // Keep the existing collage; failed requests are not cached as empty folders.
        }));
        if (folderCacheRef.current.scope !== scope) return;
        const cache = { ...folderCacheRef.current, covers: {
          ...folderCacheRef.current.covers, ...Object.fromEntries(batch.filter(Boolean)),
        } };
        folderCacheRef.current = cache;
        // Finish persisting an in-flight batch even if the wheel was closed.
        writeDiscoveryFolders(cache).catch(() => {});
        if (mounted.current) setFavoriteCovers(cache.covers);
      }
    })();
    return () => { live = false; };
  }, [wheelOpen, active, favorites, account?.isLogin, account?.mid]);

  const load = useCallback(async (reset = false) => {
    const feed = page.current;
    if (reset) feed.needsReset = true;
    if (!latest.current.active) return;
    reset = reset || feed.needsReset;
    if (feed.loading && !reset) return;
    feed.controller?.abort();
    const controller = new AbortController(); requests.current.add(controller); feed.controller = controller;
    feed.needsReset = false;
    const generation = reset ? ++feed.generation : feed.generation;
    if (reset) { emptySearches.current = 0; feed.seen = new Set(); feed.related = new Set(); feed.pending = []; feed.working = null; feed.checked = 0; setChecked(0); feed.cursor = null; setTracks([]); setIndex(0); setCardGeneration((n) => n + 1); resetMotion(); }
    feed.loading = true; setLoading(true); setSearching(false); setError('');
    const observed = [];
    try {
      await yieldDiscoveryWork(controller.signal);
      await manager?.ready();
      await exclusions.ready;
      if (generation !== feed.generation || !mounted.current) return;
      if (!latest.current.active) { if (reset) feed.needsReset = true; return; }
      [...exclusions.pending].slice(0, 4).forEach(excludeRelated);
      const snapshot = manager?.getSnapshot();
      if (!snapshot || snapshot.ready === false) throw new Error('画像尚未就绪，请稍后重试');
      const selectedProfile = snapshot.activeId === 'auto' ? snapshot.auto : snapshot.profiles?.find((item) => item.id === snapshot.activeId);
      if (snapshot.enabled !== false && !selectedProfile?.tags?.length) throw new Error('当前画像没有可用标签，请先编辑画像或选择原生推荐');
      const isValid = () => !controller.signal.aborted && generation === feed.generation && mounted.current
        && manager?.getSnapshot()?.revision === snapshot.revision;
      const isCurrent = () => isValid() && latest.current.active;
      let available = reset ? 0 : Math.max(0, latest.current.tracks.length - latest.current.index);
      if (reset) {
        const cached = (await readDiscoveryQueue(latest.current.context.account?.isLogin ? latest.current.context.account.mid : '', snapshot, discoveryRecommendMode))
          .filter((item) => !exclusions.has(item));
        if (!isValid()) return;
        if (!latest.current.active) { feed.needsReset = true; return; }
        if (cached.length) {
          available = cached.length; setTracks(cached);
          cached.forEach((item) => feed.seen.add(item.bvid));
        }
      }
      let added = 0;
      for (let attempt = 0; attempt < 4 && (attempt === 0 || available + added < DISCOVERY_TARGET) && isCurrent(); attempt++) {
        await yieldDiscoveryWork(controller.signal);
        if (!isCurrent()) return;
        let candidates = feed.pending;
        feed.pending = [];
        if (!candidates.length) {
          const cursor = Number(feed.cursor || 0);
          const items = await bili.personalizedRecommendations(cursor, 30, { signal: controller.signal, timeout: 8000, retry: false });
          if (!isValid()) return;
          feed.cursor = cursor + 1;
          candidates = items.filter((item) => {
            if (!item?.bvid || feed.seen.has(item.bvid) || exclusions.has(item)) return false;
            feed.seen.add(item.bvid); return true;
          }).map((item) => ({ ...item, discoveryOrigin: 'feed' }));
        }
        // Retain undelivered candidates while their cancellable checks run.
        // Returning to the tab resumes them without waiting for the old request.
        if (!isCurrent()) { if (isValid()) feed.pending = candidates; return; }
        feed.working = candidates;
        try {
          const selected = await filterDiscoveryCandidates(candidates, snapshot,
            (matches) => {
              const next = matches.filter((item) => !exclusions.has(item));
              added += next.length;
              const delivered = new Set(matches.map(item => item.bvid));
              feed.working = (feed.working || []).filter(item => !delivered.has(item.bvid));
              observed.push(...next);
              if (next.length) appendTracks(next);
            }, isCurrent, discoveryRecommendMode, { signal: controller.signal });
          if (!isCurrent() && isValid()) {
            const delivered = new Set(selected.map((item) => item.bvid));
            feed.pending = candidates.filter((item) => !delivered.has(item.bvid));
          }
        } catch (reason) {
          if (isValid()) feed.pending = reason.retryCandidates || candidates;
          throw reason;
        }
        if (!isCurrent()) return;
        feed.working = null;
        feed.checked += candidates.length; setChecked(feed.checked);
      }
      if (generation !== feed.generation || !mounted.current) return;
      while (feed.seen.size > 2000) feed.seen.delete(feed.seen.values().next().value);
      emptySearches.current = added ? 0 : emptySearches.current + 1;
      if (emptySearches.current >= 4) {
        emptySearches.current = 0;
        throw new Error(`已检查 ${feed.checked} 条推荐，最近几批未命中画像标签。可继续获取或切换画像`);
      }
      setSearching(available + added < DISCOVERY_TARGET);
      // Record delivered videos once per refill, not every rejected candidate page.
      if (observed.length) {
        await yieldDiscoveryWork(controller.signal);
        if (isCurrent()) manager?.observeFeed(observed);
      }
    } catch (reason) {
      if (!controller.signal.aborted && generation === feed.generation && mounted.current) {
        setError(reason.message || '推荐加载失败，点击重试');
      }
    } finally {
      requests.current.delete(controller);
      if (generation === feed.generation && mounted.current) { feed.loading = false; setLoading(false); }
    }
  }, [manager, resetMotion, exclusions, discoveryRecommendMode]);
  useEffect(() => {
    load(true);
    return () => { page.current.controller?.abort(); page.current.generation++; page.current.loading = false; };
  }, [load, profileState?.revision, account?.mid]);
  useEffect(() => {
    if (active && (page.current.needsReset || page.current.resume)) {
      page.current.resume = false;
      load(!!page.current.needsReset);
    }
  }, [active, load]);
  useEffect(() => {
    if (searching && tracks.length - index >= DISCOVERY_TARGET) { setSearching(false); return; }
    if (!active || loading || error || tracks.length - index >= (searching ? DISCOVERY_TARGET : DISCOVERY_LOW_WATER)) return;
    // Empty filtered pages are not the end of a Web recommendation stream.
    // Continue with the next page, backing off while the chosen topic is scarce.
    const delay = searching ? Math.min(30000, 1500 * 2 ** Math.min(5, emptySearches.current)) : 0;
    const timer = setTimeout(() => load(), delay);
    return () => clearTimeout(timer);
  }, [active, index, tracks.length, load, error, loading, searching]);
  useEffect(() => {
    if (loading || !account?.isLogin || !tracks.length) return;
    const snapshot = manager?.getSnapshot();
    const timer = setTimeout(() => {
      writeDiscoveryQueue(account.mid, snapshot, tracks.slice(index + 1), discoveryRecommendMode).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [loading, account?.isLogin, account?.mid, manager, profileState?.revision, tracks, index, discoveryRecommendMode]);
  useEffect(() => {
    if (index > 80) { setTracks((old) => old.slice(index - 12)); setIndex(12); }
  }, [index]);

  useEffect(() => {
    const feed = page.current;
    // Expand visited native-feed seeds once, never recursively crawl related videos.
    if (!active || track?.discoveryOrigin !== 'feed' || !feed.seen.has(cardKey) || feed.related.has(cardKey)) return;
    feed.related.add(cardKey);
    while (feed.related.size > 1000) feed.related.delete(feed.related.values().next().value);
    const controller = new AbortController(); requests.current.add(controller);
    const generation = feed.generation;
    const snapshot = manager?.getSnapshot();
    const isCurrent = () => !controller.signal.aborted && mounted.current && latest.current.active && generation === feed.generation
      && manager?.getSnapshot()?.revision === snapshot?.revision;
    (async () => {
      let candidates = [];
      const delivered = new Set();
      const seen = feed.seen, expanded = feed.related;
      let released = false;
      const releasePending = () => {
        if (released) return;
        released = true;
        expanded.delete(cardKey);
        candidates.forEach((item) => { if (!delivered.has(item.bvid)) seen.delete(item.bvid); });
      };
      // Release reservations at abort time, before a returning screen starts
      // another request; an old transport may settle much later.
      controller.signal.addEventListener('abort', releasePending, { once: true });
      try {
        const items = await relatedFor(track.bvid, controller.signal);
        if (!isCurrent()) return;
        if (exclusions.has(track)) { excludeRelated(track.bvid); return; }
        candidates = items.filter((item) => {
          if (!item?.bvid || feed.seen.has(item.bvid) || exclusions.has(item)) return false;
          feed.seen.add(item.bvid); return true;
        }).map((item) => ({ ...item, discoveryOrigin: 'related', relatedTo: track.bvid }));
        let added = 0;
        await filterDiscoveryCandidates(candidates, snapshot, (matches) => {
          const next = matches.filter((item) => !exclusions.has(item)).slice(0, Math.max(0, 6 - added));
          added += next.length;
          next.forEach((item) => delivered.add(item.bvid));
          if (next.length) appendTracks(next);
        }, () => isCurrent() && !exclusions.has(track) && added < 6, discoveryRecommendMode, { signal: controller.signal });
      } catch (reason) {
        if (isCurrent()) {
          feed.related.delete(cardKey);
          reason.retryCandidates?.forEach((item) => feed.seen.delete(item.bvid));
        }
      } finally {
        requests.current.delete(controller);
        controller.signal.removeEventListener('abort', releasePending);
        if (!isCurrent()) releasePending();
      } // Native recommendations remain playable if this optional expansion fails.
    })();
  }, [active, cardKey, manager, profileState?.revision, exclusions, discoveryRecommendMode]);

  // A single arbiter handles card selection and external queue changes. A pending
  // selection cannot be overwritten by the previous track while its URL resolves.
  useEffect(() => {
    const session = playback.current;
    if (!active || !mediaActive) { session.requested = ''; session.pending = false; return; }
    if (!track) return;
    if (session.requested !== cardKey) {
      session.requested = cardKey;
      session.pending = playingKey !== cardKey;
      if (playingKey === cardKey && !playError) { if (!playing) resume(); }
      else playQueue(tracks, index, 0, 'discovery');
    } else if (playingKey === cardKey) {
      session.pending = false;
    } else if (!session.pending && queueSource === 'discovery') {
      const next = tracks.findIndex((item) => trackKeyOf(item) === playingKey);
      if (next >= 0 && !busy.value && !dragging.value) {
        if (!automaticVideoTransition) setCardGeneration((n) => n + 1);
        session.requested = playingKey; resetMotion(); setIndex(next);
      }
    }
  }, [active, mediaActive, cardKey, playingKey, playing, playError, queueSource, tracks, index, playQueue, resume, resetMotion, motionRevision, automaticVideoTransition]);

  useEffect(() => {
    if (active && cardKey === playingKey && queueSource === 'discovery') syncDiscoveryQueue(tracks);
  }, [active, cardKey, playingKey, queueSource, tracks, syncDiscoveryQueue]);

  const preloadScope = account?.isLogin ? account.mid : '';
  useEffect(() => {
    return () => clearDiscoveryPreloads({ defer: true });
  }, [active, quality, preloadScope]);
  useEffect(() => {
    if (active && mediaActive) preloadDiscoveryQueue(tracks.slice(index + 1, index + 4), quality, preloadScope);
  }, [active, mediaActive, tracks, index, quality, preloadScope]);

  const invoke = useCallback((name, ...args) => actions.current[name]?.(...args), []);
  const flyOut = useCallback((nextIndex, key, dx, dy, vy, direction, action = 'complete') => {
    'worklet';
    const toY = direction * (stageHeight.value + 80);
    const config = cardExitTiming(dy, toY, vy);
    busy.value = true;
    if (action === 'dislike') runOnJS(invoke)('prepareDislike', key);
    x.value = withTiming(dx * 0.15, config);
    scale.value = withTiming(0.92, config);
    y.value = withTiming(toY, config, (finished) => {
      if (finished && enabled.value) runOnJS(invoke)(action, nextIndex, key);
    });
  }, [invoke]);
  const dropIntoFolder = useCallback((nextIndex, key, slot, angle) => {
    'worklet';
    busy.value = true; velocity.value = 0; cancelAnimation(rotation);
    const point = wheelPosition(slot, angle, count.value, wheelGeometry(count.value, stageHeight.value).radius);
    const toX = stageWidth.value / 2 - 52 + point.x;
    const config = cardExitTiming(x.value, toX, 0);
    // Start native motion before JS performs storage, HTTP or profile learning.
    runOnJS(invoke)('saveDrop', nextIndex, key, slot % count.value);
    x.value = withTiming(toX, config);
    scale.value = withTiming(0.08, config);
    y.value = withTiming(point.y, config, (finished) => {
      if (finished && enabled.value) runOnJS(invoke)('dropAnimated', key);
    });
  }, [invoke]);
  const wheelFrame = useFrameCallback(useCallback((frame) => {
    'worklet';
    if (!enabled.value || !visibility.value) return;
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame || 0) / 1000);
    if (dragging.value) {
      const speed = wheelEdgeSpeed(pointerX.value, pointerY.value, stageWidth.value, stageHeight.value, count.value);
      rotation.value = wrap(rotation.value + speed * dt, 360);
      hover.value = wheelHit(pointerX.value, pointerY.value, stageWidth.value, stageHeight.value, rotation.value, count.value);
    } else if (velocity.value) {
      const next = coastWheel(rotation.value, velocity.value, dt);
      rotation.value = next.rotation; velocity.value = next.velocity;
      if (!next.velocity) {
        const step = 180 / Math.max(1, count.value);
        rotation.value = withSpring(Math.round(rotation.value / step) * step, SPRING);
      }
    }
  }, []), false);
  useEffect(() => {
    wheelFrame.setActive(active && wheelOpen);
    return () => wheelFrame.setActive(false);
  }, [wheelFrame, active, wheelOpen]);

  const cardGesture = useMemo(() => Gesture.Pan().minDistance(7).maxPointers(1)
    .onStart(() => {
      if (busy.value || !enabled.value) return;
      cancelAnimation(x); cancelAnimation(y); cancelAnimation(scale); cancelAnimation(rotation);
      velocity.value = 0; dragging.value = false; hover.value = -1;
    })
    .onUpdate((event) => {
      if (busy.value || !enabled.value) return;
      x.value = event.translationX; y.value = event.translationY;
      pointerX.value = event.absoluteX - stageX.value; pointerY.value = event.absoluteY - stageY.value;
      if (!dragging.value && event.translationX > 24 && event.translationX > Math.abs(event.translationY) * 0.8) {
        dragging.value = true; visibility.value = withTiming(1, { duration: 160 });
        scale.value = withTiming(0.38, { duration: 180 }); runOnJS(invoke)('open');
      }
      if (dragging.value) hover.value = wheelHit(pointerX.value, pointerY.value, stageWidth.value, stageHeight.value, rotation.value, count.value);
    })
    .onEnd((event) => {
      if (busy.value || !enabled.value) return;
      const wasDragging = dragging.value;
      const slot = wasDragging ? wheelHit(event.absoluteX - stageX.value, event.absoluteY - stageY.value,
        stageWidth.value, stageHeight.value, rotation.value, count.value) : -1;
      dragging.value = false; busy.value = true;
      const result = resolveDiscoveryGesture({ dx: event.translationX, dy: event.translationY,
        vx: event.velocityX, vy: event.velocityY, index: deckIndex.value, trackCount: deckLength.value,
        dragging: wasDragging, targetIndex: slot });
      if (result.type === 'target') {
        dropIntoFolder(result.nextIndex, motionKey.value, slot, rotation.value); return;
      }
      if (result.type === 'related') {
        x.value = withSpring(0, SPRING); y.value = withSpring(0, SPRING); scale.value = withSpring(1, SPRING);
        busy.value = false; runOnJS(invoke)('related', motionKey.value); return;
      }
      if (result.type === 'dislike' || (result.type === 'next' && result.nextIndex < deckLength.value)) {
        // No JS round trip between release and the first frame of the exit.
        flyOut(result.nextIndex, motionKey.value, event.translationX, event.translationY,
          event.velocityY, result.type === 'dislike' ? 1 : -1, result.type === 'dislike' ? 'dislike' : 'complete');
        return;
      }
      runOnJS(invoke)('finish', event.translationX, event.translationY, event.velocityX, event.velocityY, wasDragging, slot, rotation.value);
    })
    .onFinalize((_event, success) => { if (!success && !busy.value) runOnJS(invoke)('reset'); }), [invoke, flyOut, dropIntoFolder]);
  const tapGesture = useMemo(() => Gesture.Tap().maxDistance(7).onEnd((_event, success) => {
    if (success && !busy.value && enabled.value) runOnJS(invoke)('tap');
  }), [invoke]);
  const likeGesture = useMemo(() => Gesture.LongPress().minDuration(450).maxDistance(7).onStart(() => {
    if (!busy.value && enabled.value) runOnJS(invoke)('like');
  }), [invoke]);
  const gesture = useMemo(() => Gesture.Race(cardGesture, likeGesture, tapGesture), [cardGesture, likeGesture, tapGesture]);
  const wheelGesture = useMemo(() => Gesture.Pan().minDistance(4).maxPointers(1)
    .onStart(() => { cancelAnimation(rotation); velocity.value = 0; lastY.value = 0; hover.value = -1; })
    .onUpdate((event) => {
      if (busy.value) return;
      const { radius } = wheelGeometry(count.value, stageHeight.value);
      rotation.value = wrap(rotation.value + (event.translationY - lastY.value) / radius * 180 / Math.PI, 360);
      lastY.value = event.translationY;
    })
    .onEnd((event) => {
      if (busy.value) return;
      const { radius, step } = wheelGeometry(count.value, stageHeight.value);
      velocity.value = clamp(event.velocityY / radius * 180 / Math.PI, -1600, 1600);
      if (Math.abs(velocity.value) < 0.6) { velocity.value = 0; rotation.value = withSpring(Math.round(rotation.value / step) * step, SPRING); }
    }).onFinalize((_event, success) => { if (!success) velocity.value = 0; }), []);

  const cardLayerStyle = useAnimatedStyle(() => ({
    // Keep the card raised through release/drop and the spring back to rest.
    zIndex: dragging.value || scale.value < 0.99 ? 3 : 0,
  }));

  const backStyle = useAnimatedStyle(() => ({ transform: [
    { scale: 0.94 + clamp((Math.abs(x.value) + Math.abs(y.value)) / 400, 0, 1) * 0.06 },
  ], opacity: 0.45 }));

  const save = async (target, item) => {
    const c = latest.current.context;
    if (target.kind === 'library') { if (!c.isInLibrary(item)) await c.toggleLibrary(item); }
    else if (target.kind === 'likes') { if (!c.isLiked(item)) await c.toggleLike(item); }
    else if (target.kind === 'playlist') {
      const result = await addToPlaylist(target.id, item);
      if (!result) throw new Error('歌单已被删除，请重新选择');
    } else {
      if (!c.account?.isLogin) throw new Error('请先登录 B 站账号');
      const aid = Number(item.aid) || Number((await bili.view(item.bvid)).aid);
      if (!aid) throw new Error('无法获取视频信息，请重试');
      if (latest.current.context.account?.mid !== c.account.mid) throw new Error('账号已切换，请重新收藏');
      await bili.favDeal(aid, [target.id]);
      if (folderCacheRef.current.scope === String(c.account.mid)) {
        const cache = folderCacheRef.current;
        const folder = cache.folders.find((entry) => entry.id === target.id);
        if (folder) {
          const entry = folderCoverEntry(folder, [item.pic, ...(cache.covers[target.id]?.uris || [])]);
          entry.at = 0; // Show the saved cover immediately; recheck the server on the next opening.
          const updated = { ...cache, covers: { ...cache.covers, [target.id]: entry } };
          folderCacheRef.current = updated;
          if (mounted.current) setFavoriteCovers(updated.covers);
          writeDiscoveryFolders(updated).catch(() => {});
        }
      }
    }
    notify(`已加入「${target.title}」`);
  };
  actions.current = {
    open: () => setWheelOpen(true), reset: resetMotion,
    prepareDislike: (key) => {
      const state = latest.current;
      if (!mounted.current || !state.active || trackKeyOf(state.track) !== key || pendingDislike.current === key) return;
      pendingDislike.current = key;
      exclusions.reject(state.track).catch(() => notify('不喜欢记录保存失败，本次浏览仍生效'));
      excludeRelated(state.track.bvid);
    },
    dislike: (_nextIndex, key) => {
      const state = latest.current;
      if (!mounted.current || !state.active || trackKeyOf(state.track) !== key) return;
      actions.current.prepareDislike(key);
      pendingDislike.current = null;
      hover.value = -1; visibility.value = 0; setWheelOpen(false);
      pruneExcluded();
      notify('已标记不喜欢，并移除相关视频');
    },
    saveDrop: (_nextIndex, key, targetIndex) => {
      const state = latest.current;
      if (!mounted.current || !state.active || trackKeyOf(state.track) !== key) return;
      const operation = { key, generation: page.current.generation, animated: false, saved: false };
      pendingDrop.current = operation;
      save(state.targets[targetIndex], state.track).then(() => {
        operation.saved = true; actions.current.finishDrop(operation);
      }).catch((reason) => {
        operation.error = reason; actions.current.finishDrop(operation);
      });
    },
    dropAnimated: (key) => {
      const operation = pendingDrop.current;
      if (operation?.key !== key) return;
      operation.animated = true; actions.current.finishDrop(operation);
    },
    finishDrop: (operation) => {
      if (pendingDrop.current !== operation || !operation.animated || (!operation.saved && !operation.error)) return;
      pendingDrop.current = null;
      const state = latest.current;
      if (!mounted.current || !state.active || operation.generation !== page.current.generation || trackKeyOf(state.track) !== operation.key) return;
      if (operation.error) { notify(operation.error.message || '保存失败，请重试'); resetMotion(); return; }
      const nextIndex = state.index + 1;
      if (nextIndex >= state.tracks.length) { load(); resetMotion(); return; }
      actions.current.complete(nextIndex, operation.key);
    },
    related: async (key) => {
      const state = latest.current;
      if (!state.active || trackKeyOf(state.track) !== key) return;
      const controller = new AbortController(); requests.current.add(controller);
      const task = ++relatedTask.current, generation = page.current.generation;
      const snapshot = manager?.getSnapshot();
      const isCurrent = () => !controller.signal.aborted && mounted.current && latest.current.active && task === relatedTask.current
        && generation === page.current.generation && manager?.getSnapshot()?.revision === snapshot?.revision && !exclusions.has(state.track);
      const alreadyWatched = new Set(state.tracks.slice(0, state.index + 1).map((item) => item.bvid));
      setRelatedLoading(true); notify('正在准备接下来的 20 个相关视频');
      try {
        const matches = await buildRelatedRun(state.track, snapshot, relatedFor,
          (item) => exclusions.has(item) || alreadyWatched.has(item.bvid), isCurrent, discoveryRecommendMode, { signal: controller.signal });
        if (!isCurrent()) return;
        const currentState = latest.current;
        const watched = new Set(currentState.tracks.slice(0, currentState.index + 1).map((item) => item.bvid));
        const next = matches.filter((item) => !exclusions.has(item) && !watched.has(item.bvid));
        if (!next.length) { notify('暂未找到符合画像的相关视频，保留当前推荐'); return; }
        const ids = new Set(next.map((item) => item.bvid));
        ids.forEach((id) => page.current.seen.add(id));
        const queue = [...currentState.tracks.slice(0, currentState.index + 1), ...next,
          ...currentState.tracks.slice(currentState.index + 1).filter((item) => !ids.has(item.bvid))];
        latest.current = { ...currentState, tracks: queue };
        setTracks(queue); currentState.context.syncDiscoveryQueue(queue);
        notify(next.length === 20 ? '接下来 20 个视频已换为相关推荐' : `找到 ${next.length} 个符合画像的相关视频，已优先安排`);
      } catch (reason) { if (isCurrent()) notify(reason.message || '相关视频获取失败，请再左滑重试'); }
      finally { requests.current.delete(controller); if (task === relatedTask.current && mounted.current) setRelatedLoading(false); }
    },
    complete: (nextIndex, key) => {
      if (!mounted.current || !latest.current.active || trackKeyOf(latest.current.track) !== key) return;
      hover.value = -1; visibility.value = 0; setWheelOpen(false); setCardGeneration((n) => n + 1); setIndex(nextIndex);
    },
    tap: () => {
      const state = latest.current;
      if (playError || playingKey !== cardKey) playQueue(state.tracks, state.index, 0, 'discovery');
      else if (!playing) resume();
      else navigation.navigate('Player');
    },
    like: () => { if (track) save(targets[1], track).catch((reason) => notify(reason.message)); },
    finish: async (dx, dy, vx, vy, wasDragging, slot, angle) => {
      busy.value = true;
      const state = latest.current;
      const key = trackKeyOf(state.track);
      const generation = page.current.generation;
      const result = resolveDiscoveryGesture({ dx, dy, vx, vy, index: state.index, trackCount: state.tracks.length,
        dragging: wasDragging, targetIndex: slot < 0 ? -1 : slot % state.targets.length });
      if (result.type === 'cancel') { resetMotion(); return; }
      if (result.type === 'dislike') { runOnUI(flyOut)(result.nextIndex, key, dx, dy, vy, 1, 'dislike'); return; }
      if (result.type === 'related') { resetMotion(); actions.current.related(key); return; }
      if (result.type === 'target') { runOnUI(dropIntoFolder)(result.nextIndex, key, slot, angle); return; }
      if (!mounted.current || !latest.current.active || generation !== page.current.generation || key !== trackKeyOf(latest.current.track)) return;
      if (result.nextIndex >= state.tracks.length) { load(); notify('正在获取下一张卡片'); resetMotion(); return; }
      if (result.type === 'next') {
        runOnUI(flyOut)(result.nextIndex, key, dx, dy, vy, -1);
        return;
      }
    },
  };

  const profile = profileState ? activeProfile(profileState) : null;
  const selectProfile = async (id) => {
    if (!manager || profileSaving) return;
    setProfileSaving(true); setProfileError('');
    try {
      await manager.edit(id === null ? { type: 'enable', enabled: false } : { type: 'select', id, enabled: true });
      setProfileOpen(false);
    } catch (reason) { setProfileError(reason.message || '画像切换失败，请重试'); }
    finally { setProfileSaving(false); }
  };
  const currentMatches = cardKey === playingKey;
  const continuous = automaticVideoTransition && queueSource === 'discovery';
  const followingAutoplay = continuous && playback.current.requested === cardKey && !playback.current.pending;
  return <SafeAreaView style={[s.safe, { paddingBottom: pagePaddingBottom }]} edges={['top']}>
    <View style={s.header}>
      <View><Text style={s.eyebrow}>CARD DISCOVERY</Text><Text style={s.heading}>发现卡片</Text></View>
      <TouchableOpacity testID="discovery-profile-toggle" accessibilityRole="button" accessibilityLabel="切换画像"
        disabled={!manager} onPress={() => { resetMotion(); setProfileError(''); setProfileOpen(true); }} style={s.profileButton}>
        <View style={s.profileIcon}><IconProfileSwitch size={21} color={colors.accent} /></View>
        <View style={s.profileButtonCopy}><Text style={s.profileButtonHint}>切换画像</Text>
          <Text numberOfLines={1} style={s.profileButtonName}>{profileState?.enabled ? profile?.name || '近期画像' : '原生推荐'}</Text></View>
        <IconChevronDown size={14} color={colors.text3} />
      </TouchableOpacity>
    </View>
    <View ref={stage} collapsable={false} style={s.stage} onLayout={measureStage}>
      {track ? <>
        <GestureDetector gesture={gesture}>
          <View testID="discovery-card-gesture-region" collapsable={false} style={StyleSheet.absoluteFill}
            accessible accessibilityLabel={`${track.title}。上滑下一张，下滑不喜欢并移除相关视频，左滑推荐20个相关视频，右拖收藏，长按喜欢，点击播放详情。`}
            accessibilityActions={[{ name: 'increment', label: '下一张' }, { name: 'decrement', label: '不喜欢并移除相关视频' },
              { name: 'related', label: '接下来推荐20个相关视频' }]}
            onAccessibilityAction={(event) => {
              if (busy.value) return;
              if (event.nativeEvent.actionName === 'related') { actions.current.related(cardKey); return; }
              const next = event.nativeEvent.actionName === 'increment';
              actions.current.finish(0, next ? -80 : 80, 0, 0, false, -1, 0);
            }} />
        </GestureDetector>
        {/* Keep one video surface in a visual-only portal. Only its native stacking
            order changes during a drag; input and accessibility stay in the page. */}
        <Overlay active={false}>
          <View testID="discovery-wheel-overlay" pointerEvents="none"
            style={[StyleSheet.absoluteFill, { top: -wheelBlurBounds.top, bottom: -wheelBlurBounds.bottom }]}>
            {tracks[index + 1] ? <Animated.View pointerEvents="none" style={[s.cardBounds, s.back, backStyle]} /> : null}
            <Animated.View testID="discovery-card-layer" pointerEvents="none"
              style={[StyleSheet.absoluteFill, cardLayerStyle]}>
              <BlurTargetView ref={wheelBlurTarget} pointerEvents="none" collapsable={false} style={[StyleSheet.absoluteFill, wheelBlurBounds]}>
                <View testID="discovery-blur-card-region" pointerEvents="none" collapsable={false}
                  style={[StyleSheet.absoluteFill, { top: -wheelBlurBounds.top, bottom: -wheelBlurBounds.bottom }]}>
                  <DiscoveryCardFrame key={cardGeneration} cardKey={cardKey} motionKey={motionKey} x={x} y={y} scale={scale}
                    testID="discovery-card" collapsable={false}>
                    <View pointerEvents="none" style={s.cardContent}>
                      <DiscoveryCard track={track} player={player} visible={active && (currentMatches || followingAutoplay)} videoSource={videoSource}
                        continuous={continuous}
                        buffering={!currentMatches || buffering} error={currentMatches ? playError : null} playing={currentMatches && playing} />
                    </View>
                  </DiscoveryCardFrame>
                </View>
              </BlurTargetView>
            </Animated.View>
            {active && (wheelReady || wheelOpen) && <DiscoveryWheelHaze blurTarget={wheelBlurTarget} bounds={wheelBlurBounds} width={layout.width}
              height={layout.height} count={targets.length} visibility={visibility} open={wheelOpen} />}
            {active && (wheelReady || wheelOpen) && <DiscoveryWheel targets={targets} height={layout.height} rotation={rotation} hover={hover}
              visibility={visibility} open={wheelOpen} />}
          </View>
        </Overlay>
        <GestureDetector gesture={wheelGesture}>
          <Animated.View testID="discovery-wheel-touch" collapsable={false} pointerEvents={wheelOpen ? 'auto' : 'none'} style={s.wheelTouch}
            accessible accessibilityRole="adjustable" accessibilityLabel="收藏轮盘，上下拖动选择，松手惯性滑行"
            accessibilityActions={[{ name: 'increment', label: '下一个收藏位置' }, { name: 'decrement', label: '上一个收藏位置' }, { name: 'activate', label: '收藏当前卡片' }]}
            onAccessibilityAction={(event) => {
              if (busy.value) return;
              const step = 180 / targets.length;
              velocity.value = 0; cancelAnimation(rotation);
              if (event.nativeEvent.actionName === 'activate') {
                const target = targets[wrap(Math.round(-rotation.value / step), targets.length)];
                save(target, track).catch((reason) => notify(reason.message));
              } else {
                rotation.value = wrap(Math.round(rotation.value / step) * step + (event.nativeEvent.actionName === 'increment' ? -step : step), 360);
                const target = targets[wrap(Math.round(-rotation.value / step), targets.length)]; notify(target.title);
              }
            }} />
        </GestureDetector>
      </> : loading || searching ? <View style={s.empty}><ActivityIndicator color={colors.accent} />
        <Text style={s.errorText}>正在按视频标签匹配画像…{checked > 0 ? `\n已检查 ${checked} 条推荐` : ''}</Text></View> : <TouchableOpacity style={s.empty}
        accessibilityRole="button" accessibilityLabel="重新获取推荐"
        onPress={() => load()}>
        <Text style={s.errorText}>{error || '暂时没有推荐卡片'}</Text><Text style={s.retry}>重新获取</Text>
      </TouchableOpacity>}
    </View>
    <View style={s.footer}>
      <View style={s.footerCopy}>
      <Text style={s.hints}>↑ 下一张　↓ 不喜欢　← 20 个相关　右拖收藏</Text>
      {folderError ? <TouchableOpacity onPress={() => setFolderRetry((v) => v + 1)}><Text style={s.retry}>{folderError}</Text></TouchableOpacity> :
        error && track ? <TouchableOpacity onPress={() => load()}><Text style={s.retry}>{error}</Text></TouchableOpacity> :
          <Text style={s.profile}>{relatedLoading ? '正在准备 20 个相关视频 · 当前视频继续播放' : loading || searching ? `正在匹配视频标签 · 已检查 ${checked} 条推荐` : `${profileState?.enabled ? profile?.name || '近期画像' : '原生推荐'} · Web 推荐与相关视频`}</Text>}
      </View>
      <TouchableOpacity testID="discovery-wheel-toggle" accessibilityRole="button" accessibilityLabel={wheelOpen ? '关闭收藏轮盘' : '打开收藏轮盘'}
        onPress={() => { if (wheelOpen) resetMotion(); else { visibility.value = withTiming(1, { duration: 180 }); setWheelOpen(true); } }}
        style={s.wheelButton}><IconPlaylist size={17} color={colors.text2} /><Text style={s.wheelButtonText}>{wheelOpen ? '收起' : '收藏'}</Text></TouchableOpacity>
    </View>
    <BottomSheet visible={profileOpen} onClose={() => setProfileOpen(false)}>
      <Text style={s.sheetTitle}>切换推荐画像</Text>
      <Text style={s.sheetHint}>从你的 B 站 Web 推荐与相关视频中，筛选符合画像的内容。</Text>
      <ScrollView style={s.profileList}>
        {[{ id: null, name: '原生推荐', tags: [] }, ...(profileState ? [profileState.auto, ...profileState.profiles] : [])].map((item) => {
          const selected = item.id === null ? !profileState?.enabled : profileState?.enabled && profileState.activeId === item.id;
          return <TouchableOpacity key={item.id || 'native'} accessibilityRole="radio" accessibilityLabel={`使用画像：${item.name}`}
            accessibilityState={{ checked: !!selected, disabled: profileSaving }} disabled={profileSaving}
            onPress={() => selectProfile(item.id)} style={[s.profileRow, selected && s.profileRowSelected]}>
            <View style={s.profileRowCopy}><Text style={s.profileRowName}>{item.name}</Text>
              <Text numberOfLines={2} style={s.sheetHint}>{item.id === null ? '保留 B 站推荐，不作画像筛选' : item.tags?.length ? item.tags.slice(0, 4).map((tag) => tag.name).join(' · ') : '暂无可用标签，完善画像后显示推荐'}</Text></View>
            {selected ? <IconCheck size={20} color={colors.accent} /> : null}
          </TouchableOpacity>;
        })}
      </ScrollView>
      {profileSaving ? <ActivityIndicator color={colors.accent} /> : null}
      {!!profileError && <Text style={s.errorText}>{profileError}</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="管理推荐画像"
        onPress={() => { setProfileOpen(false); navigation.navigate('Settings'); }} style={s.manageProfiles}><Text style={s.retry}>管理与新建画像</Text></TouchableOpacity>
    </BottomSheet>
    {message ? <View pointerEvents="none" style={s.toast}><Text accessibilityLiveRegion="polite" style={s.toastText}>{message}</Text></View> : null}
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, overflow: 'hidden' },
  header: { height: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 8, letterSpacing: 2, color: colors.text3 },
  heading: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 3 },
  wheelButton: { minHeight: 44, paddingHorizontal: 12, borderRadius: 22, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.05)' },
  wheelButtonText: { fontSize: 12, color: colors.text2 },
  profileButton: { minHeight: 44, maxWidth: '58%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, paddingRight: 10, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.05)' },
  profileIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  profileButtonCopy: { flexShrink: 1 },
  profileButtonHint: { color: colors.text3, fontSize: 9 },
  profileButtonName: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 2 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: 8 },
  sheetHint: { color: colors.text3, fontSize: 11, lineHeight: 18 },
  profileList: { flexGrow: 0, marginTop: 14 },
  profileRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, marginBottom: 6 },
  profileRowSelected: { backgroundColor: colors.accentSoft },
  profileRowCopy: { flex: 1 },
  profileRowName: { color: colors.text, fontSize: 14, fontWeight: '500', marginBottom: 3 },
  manageProfiles: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, minHeight: 100, alignItems: 'center', justifyContent: 'center' },
  cardBounds: { position: 'absolute', top: 10, bottom: 10, left: 17, right: 17 },
  cardContent: { flex: 1 },
  card: { flex: 1, borderRadius: 26, overflow: 'hidden', backgroundColor: '#0c1012', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  back: { borderRadius: 26, overflow: 'hidden', backgroundColor: '#283239' },
  backdrop: { backgroundColor: '#0c1012' },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,12,0.38)' },
  badge: { position: 'absolute', top: 16, left: 16, flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.58)' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  badgeText: { color: '#fff', fontSize: 10 },
  copy: { position: 'absolute', left: 20, right: 20, bottom: 22 },
  title: { color: '#fff', fontSize: 21, lineHeight: 28, fontWeight: '700' },
  up: { color: '#d1d4d7', fontSize: 12, marginTop: 8 },
  meta: { flexDirection: 'row', gap: 10, marginTop: 14 },
  metaText: { color: '#c5cbd0', fontSize: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)' },
  videoError: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 28 },
  errorText: { color: colors.text2, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  wheelTouch: { zIndex: 3, position: 'absolute', right: 0, top: 0, bottom: 0, width: 216 },
  footer: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 17, gap: 8 },
  footerCopy: { flex: 1, gap: 5 },
  hints: { color: colors.text2, fontSize: 10 },
  profile: { color: colors.text3, fontSize: 9 },
  retry: { color: colors.accent, fontSize: 11, padding: 4 },
  empty: { padding: 24, alignItems: 'center', gap: 12 },
  toast: { position: 'absolute', bottom: 140, alignSelf: 'center', maxWidth: '90%', paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 20, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: '#171e24' },
  toastText: { color: '#fff', fontSize: 12 },
});
