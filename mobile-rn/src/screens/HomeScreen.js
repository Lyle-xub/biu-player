/* Biu Player RN · 首页：搜索胶囊 + 入口行（我的喜欢/热榜）+ 双栏瀑布流推荐 */
import { blend, isStrict } from '../../../renderer/recommendation-profile';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { beginRecommendation } from '../updates/networkGate';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import TrackCard from '../components/TrackCard';
import HomeBanner from '../components/HomeBanner';
import { DailyCard } from './DailyScreen';
import { IconHeart, IconNote, IconSearch } from '../components/icons';

const RECOMMEND_BATCH = 30;
const INITIAL_RECOMMEND_MIN = 15;
const MAX_RECOMMEND_PAGES = 12;
// Sparse music/profile batches must leave something in the actual feed.
const bannerCount = (items) => Math.min(5, Math.max(0, items.length - 1));

export default function HomeScreen({ navigation }) {
  const { playQueue, likes, recommendMode = 'music', account, recommendationManager,
    recommendationProfile, homeProfileRevision, homeStrictProfile, resolveTrackUp } = usePlayer(['playQueue', 'likes', 'recommendMode', 'account',
      'recommendationManager', 'homeProfileRevision', 'homeStrictProfile', 'resolveTrackUp']);
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
  const strictProfile = homeStrictProfile ?? isStrict(recommendationProfile);
  const [mode, setMode] = useState('recommend'); // recommend | rank | likes
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const activeRequest = useRef(null);
  const screenActive = useRef(true), deferredLoad = useRef(null), loadRef = useRef(null);
  const accountKey = account?.isLogin ? String(account.mid || 'signed-in') : 'guest';
  // Manager revisions cover explicit selection/filter edits, not background learning or hydration.
  const selection = homeProfileRevision ?? recommendationProfile?.revision;
  const profilePageRef = useRef(0);
  const freshIdxRef = useRef(0);
  const tracksRef = useRef([]);
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const scrollIntentRef = useRef(false);
  const listRef = useRef(null);
  tracksRef.current = tracks;

  useEffect(() => navigation.addListener?.('homeDoublePress', () => {
    scrollIntentRef.current = false;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }), [navigation]);

  const load = useCallback(async (more = false, m = mode) => {
    if (!screenActive.current) { deferredLoad.current = { more, mode: m }; return; }
    if (more && (m !== 'recommend' || loadingMoreRef.current)) return;
    const token = ++requestRef.current;
    activeRequest.current?.abort();
    if (m === 'likes') {
      loadingMoreRef.current = false;
      setTracks(likes); setLoading(false); setRefreshing(false); setLoadingMore(false); setError(null);
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const interrupted = new Promise((_, reject) => controller.signal.addEventListener('abort', () =>
      reject(new Error(timedOut ? '首页推荐请求超时，请重试' : '推荐请求已取消')), { once: true }));
    const wait = (promise) => Promise.race([promise, interrupted]);
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 18000);
    const finishUpdatePause = m === 'recommend' ? beginRecommendation() : null;
    loadingMoreRef.current = true;
    if (more) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const previous = more ? tracksRef.current : [];
      const target = more ? RECOMMEND_BATCH : INITIAL_RECOMMEND_MIN;
      // Refresh replaces the list, but continues discovery instead of replaying page zero.
      const exclude = m === 'recommend' ? tracksRef.current.map((t) => t.bvid) : [];
      const profilePage = profilePageRef.current;
      // Profile matching is an enrichment pass. It must never delay the platform
      // feed, especially while the saved profile is being restored.
      const suggested = () => m === 'recommend' && recommendationManager
        ? recommendationManager.recommend({ page: profilePage, mode: recommendMode, exclude }).catch(() => [])
        : Promise.resolve([]);
      const finish = (items) => {
        // Optional profile searches can take much longer than the platform feed.
        // Publish now; enrich in the background without holding pagination open.
        if (token !== requestRef.current || controller.signal.aborted) return;
        if (items.length) setTracks([...previous, ...items]);
        setLoading(false);
        setRefreshing(false);
        loadingMoreRef.current = false;
        setLoadingMore(false);
        profilePageRef.current = profilePage + 1;
        suggested().then((personalized) => {
          if (token !== requestRef.current || controller.signal.aborted || !personalized.length) return;
          const banner = m === 'recommend' && !previous.length ? items.slice(0, bannerCount(items)) : [];
          const bannerIds = new Set(banner.map((t) => t.bvid));
          const merged = [...banner, ...blend(items.slice(banner.length),
            personalized.filter((t) => !bannerIds.has(t.bvid)))];
          if (merged.length) { setTracks([...previous, ...merged]); setError(null); }
        });
      };
      let list;
      if (m === 'rank') {
        list = await wait(bili.ranking());
      } else if (!account?.isLogin) {
        // Guests use the public recommendation endpoint only as their source;
        // logged-in feeds never mix in ranking items as a supplement.
        list = await wait(bili.ranking());
      } else {
        const seen = new Set(exclude);
        list = [];
        let freshIdx = freshIdxRef.current, attempts = 0;
        let fetchError, metadataFailures = 0, stopped = false;
        const pages = new AbortController();
        const cancelPages = () => pages.abort();
        controller.signal.addEventListener('abort', cancelPages, { once: true });
        const cancelledPages = new Promise((_, reject) => pages.signal.addEventListener('abort', () =>
          reject(new Error('推荐补页已结束')), { once: true }));
        const append = (items) => {
          if (token !== requestRef.current || controller.signal.aborted || pages.signal.aborted) return;
          for (const track of items) {
            if (!track.bvid || seen.has(track.bvid)) continue;
            seen.add(track.bvid);
            list.push(track);
          }
          if (list.length) {
            setTracks([...previous, ...list]);
            setLoading(false);
            setRefreshing(false);
            setLoadingMore(list.length < target);
          }
        };
        const relatedSeeds = new Set(), relatedTasks = [];
        const fetchRelated = async (bvid) => {
          try {
            const items = await wait(Promise.race([bili.homeRelatedRecommendations(bvid, {
              music: recommendMode !== 'all', onBatch: append, signal: pages.signal,
            }), cancelledPages]));
            append(items);
          } catch { /* An optional related lookup cannot stop the Web feed. */ }
        };
        const appendRecommendations = (items) => {
          append(items);
          if (pages.signal.aborted || token !== requestRef.current || typeof bili.homeRelatedRecommendations !== 'function') return;
          // Expand two original recommendations only; related results never seed recursive lookups.
          for (const item of items) {
            if (relatedSeeds.size >= 2) break;
            if (!item.bvid || relatedSeeds.has(item.bvid)) continue;
            relatedSeeds.add(item.bvid);
            relatedTasks.push(fetchRelated(item.bvid));
          }
        };
        const fetchPage = async () => {
          const page = freshIdx++;
          attempts += 1;
          // Reserve before dispatch so concurrent responses cannot reuse or rewind the cursor.
          freshIdxRef.current = freshIdx;
          let pageLoaded = false;
          try {
            const items = await wait(Promise.race([bili.homeRecommendations(page, RECOMMEND_BATCH, {
              music: recommendMode !== 'all', onBatch: appendRecommendations, onPageLoaded: () => { pageLoaded = true; }, signal: pages.signal,
            }), cancelledPages]));
            if (token !== requestRef.current || controller.signal.aborted) return;
            metadataFailures = 0;
            fetchError = null;
            appendRecommendations(items);
          } catch (e) {
            if (token !== requestRef.current || pages.signal.aborted) return;
            fetchError = e;
            // Stop scheduling on feed failure or repeated metadata outages; retain healthy in-flight pages.
            if (!pageLoaded || ++metadataFailures >= 2) stopped = true;
          }
        };
        const worker = async () => {
          while (!stopped && !pages.signal.aborted && list.length < target && attempts < MAX_RECOMMEND_PAGES && token === requestRef.current)
            await fetchPage();
        };
        try {
          // Start distinct Web pages immediately; seed-related lookups stream alongside them.
          await Promise.all(Array.from({ length: 3 }, worker));
          await Promise.all(relatedTasks);
        } finally {
          controller.signal.removeEventListener('abort', cancelPages);
        }
        if (token !== requestRef.current) return;
        recommendationManager?.observeFeed(list);
        if (timedOut && list.length < target) throw new Error('首页推荐请求超时，请重试');
        finish(list);
        if (list.length < target) {
          if (fetchError) throw fetchError;
          if (previous.length + list.length < INITIAL_RECOMMEND_MIN)
            throw new Error(`本轮暂未获取足够推荐（已有 ${previous.length + list.length} 个），可重试继续补充`);
        }
        return;
      }
      if (token === requestRef.current) {
        finish(list);
      }
    } catch (e) {
      if (token === requestRef.current) {
        setError(String(e.message || e));
      }
    } finally {
      clearTimeout(deadline);
      finishUpdatePause?.();
      if (activeRequest.current === controller) activeRequest.current = null;
      if (token === requestRef.current) {
        loadingMoreRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [mode, likes, recommendMode, account?.isLogin, recommendationManager]);
  loadRef.current = load;
  useEffect(() => {
    const blur = navigation.addListener?.('blur', () => {
      screenActive.current = false;
      if (activeRequest.current) {
        deferredLoad.current = { more: tracksRef.current.length > 0, mode };
        requestRef.current++;
        const abandoned = activeRequest.current; activeRequest.current = null;
        setTimeout(() => abandoned.abort(), 0);
      }
      loadingMoreRef.current = false;
      setLoading(false); setRefreshing(false); setLoadingMore(false);
    });
    const focus = navigation.addListener?.('focus', () => {
      screenActive.current = true;
      const pending = deferredLoad.current; deferredLoad.current = null;
      if (pending) setTimeout(() => {
        if (screenActive.current) loadRef.current(pending.more, pending.mode);
        else deferredLoad.current ||= pending;
      }, 32);
    });
    return () => { blur?.(); focus?.(); };
  }, [navigation, mode]);

  const loadMoreOnScroll = () => {
    if (mode === 'recommend' && scrollIntentRef.current && !loadingMore && !loading) {
      scrollIntentRef.current = false;
      load(true);
    }
  };

  useEffect(() => () => { screenActive.current = false; requestRef.current += 1; activeRequest.current?.abort(); }, []);
  const previousAccount = useRef(accountKey);
  useEffect(() => {
    if (account === null || mode !== 'recommend') return;
    // Only account changes clear personal content. Profile sync/refresh retains cards until replacement succeeds.
    if (previousAccount.current !== accountKey) {
      setTracks([]); tracksRef.current = []; freshIdxRef.current = 0; profilePageRef.current = 0;
    }
    previousAccount.current = accountKey;
    load(false, 'recommend');
  }, [recommendMode, accountKey, account === null, recommendationManager, selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => {
    setMode(m);
    setTracks([]);
    tracksRef.current = [];
    setLoading(true);
    load(false, m);
  };

  const { bannerTracks, waterfall } = useMemo(() => {
    const bannerTracks = mode === 'recommend' ? tracks.slice(0, bannerCount(tracks)) : [];
    const bannerIds = new Set(bannerTracks.map((track) => track.bvid));
    // 按视频标识排除轮播内容，刷新和分页时保持两处推荐互不重复。
    const feed = tracks.filter((track) => !bannerIds.has(track.bvid));
    return { bannerTracks, waterfall: feed };
  }, [tracks, mode]);

  const chips = [
    { key: 'likes', label: '我的喜欢', icon: IconHeart },
    { key: 'rank', label: '热榜', icon: IconNote },
    { key: 'recommend', label: '推荐', icon: null },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.searchPill}
          hitSlop={{ top: 2, bottom: 2 }}
          accessibilityRole="button"
          accessibilityLabel="搜索视频、UP 主"
          activeOpacity={0.8}
          onPress={() => navigation.navigate('SearchInput')}
        >
          <IconSearch size={15} color={colors.text2} />
          <Text style={styles.searchHint}>搜索视频、UP 主…</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.chipRow}>
        {chips.map(({ key, label, icon: Icon }) => (
          <TouchableOpacity
            key={key}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === key }}
            style={[styles.chip, { flexGrow: label.length + (Icon ? 1.5 : 0) }, mode === key && styles.chipOn]}
            onPress={() => switchMode(key)}
          >
            {Icon ? <Icon size={13} color={mode === key ? colors.accent : colors.text2} /> : null}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.chipText, mode === key && styles.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlashList
        keyboardShouldPersistTaps="handled"
        ref={listRef}
        data={waterfall}
        masonry
        numColumns={2}
        optimizeItemArrangement
        keyExtractor={(track) => String(track.bvid || track.aid || `${track.title}:${track.up}`)}
        renderItem={({ item: track }) => (
          <View style={styles.masonryItem}>
            <TrackCard track={track}
              onPress={() => playQueue(tracks, tracks.indexOf(track))}
              onPressUp={canOpenTrackUp(track) ? () => openUp(track) : undefined}
            />
          </View>
        )}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(false); }}
            tintColor={colors.accent}
          />
        )}
        onEndReachedThreshold={0.5}
        onScrollBeginDrag={() => { scrollIntentRef.current = true; }}
        onEndReached={() => { if (tracks.length) loadMoreOnScroll(); }}
        onScrollEndDrag={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          // An empty next batch leaves the content height unchanged, so the list
          // may not emit onEndReached again. A new drag can still request a page.
          if (contentOffset.y >= 0 && contentSize.height - contentOffset.y - layoutMeasurement.height
            <= layoutMeasurement.height * 0.5) loadMoreOnScroll();
        }}
        ListHeaderComponent={<View style={styles.feedHeader}><DailyCard navigation={navigation} />{bannerTracks.length > 0 && <HomeBanner tracks={bannerTracks} onPress={(_, index) => playQueue(tracks, index)} />}</View>}
        ListEmptyComponent={loading && !refreshing ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
        ) : error && !tracks.length ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load(false)}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : !tracks.length ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {mode === 'likes' ? '还没有喜欢的歌曲，去播放页点小心心吧'
                : mode === 'recommend' && strictProfile ? '暂无匹配当前画像的视频，可继续向下滑动或调整标签、推荐范围' : '暂时没有内容'}
            </Text>
          </View>
        ) : null}
        ListFooterComponent={error && tracks.length ? (
          <View style={styles.feedError}>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load(true)}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : loadingMore
          ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 },
  searchPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 999, paddingHorizontal: 14, height: 40,
  },
  searchHint: { color: colors.text3, fontSize: 13 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, flexBasis: 0,
    paddingHorizontal: 6, height: 32, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: 'rgba(251,114,153,0.45)' },
  chipText: { color: colors.text2, fontSize: 12, flexShrink: 1 },
  chipTextOn: { color: colors.accent, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 8, paddingBottom: 130 },
  feedError: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  masonryItem: { paddingHorizontal: 6 },
  feedHeader: { paddingHorizontal: 6 },
  emptyBox: { alignItems: 'center', marginTop: 64, gap: 14 },
  emptyText: { color: colors.text2, fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: {
    paddingHorizontal: 22, height: 48, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
