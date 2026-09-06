/* Biu Player RN · 首页：搜索胶囊 + 入口行（我的喜欢/热榜）+ 双栏瀑布流推荐 */
import { blend, isStrict } from '../../../renderer/recommendation-profile';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { initClient } from '../api/client';
import { beginRecommendation } from '../updates/networkGate';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import TrackCard from '../components/TrackCard';
import HomeBanner from '../components/HomeBanner';
import { DailyCard } from './DailyScreen';
import { IconHeart, IconNote, IconSearch } from '../components/icons';

const RECOMMEND_BATCH = 20;
const MAX_RECOMMEND_PAGES = 8;
const cardWeight = (track) => 1 + (String(track.title || '').length > 18 ? 0.24 : 0)
  + (track.recommendationReason ? 0.2 : 0);

function waterfallBlocks(items) {
  const columns = [[], []];
  const weights = [0, 0];
  // Balance the complete feed continuously. Restarting the weights for every
  // fetched page forced both columns onto a shared row and created large holes.
  items.forEach((track) => {
    const column = weights[0] <= weights[1] ? 0 : 1;
    columns[column].push(track);
    weights[column] += cardWeight(track);
  });
  return items.length ? [{ key: 'waterfall', columns }] : [];
}

export default function HomeScreen({ navigation }) {
  const { playQueue, likes, recommendMode = 'music', account, recommendationManager,
    recommendationProfile, resolveTrackUp } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
  const strictProfile = isStrict(recommendationProfile);
  const [mode, setMode] = useState('recommend'); // recommend | rank | likes
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [clientReady, setClientReady] = useState(false);
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
    if (more && (m !== 'recommend' || loadingMoreRef.current)) return;
    const token = ++requestRef.current;
    if (m === 'likes') {
      loadingMoreRef.current = false;
      setTracks(likes); setLoading(false); setLoadingMore(false); setError(null);
      return;
    }
    const finishUpdatePause = m === 'recommend' ? beginRecommendation() : null;
    loadingMoreRef.current = true;
    if (more) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const previous = more ? tracksRef.current : [];
      // Refresh replaces the list, but continues discovery instead of replaying page zero.
      const exclude = m === 'recommend' ? tracksRef.current.map((t) => t.bvid) : [];
      const profilePage = profilePageRef.current;
      // Wait for saved selection before requesting or displaying platform content.
      if (m === 'recommend' && recommendationManager) {
        await recommendationManager.ready();
        if (token !== requestRef.current) return;
        if (isStrict(recommendationManager.getSnapshot())) {
          const received = [], seen = new Set(exclude);
          const onBatch = (batch) => {
            if (token !== requestRef.current) return;
            const fresh = batch.filter((t) => { if (seen.has(t.bvid)) return false; seen.add(t.bvid); return true; });
            if (!fresh.length) return;
            received.push(...fresh);
            setTracks([...previous, ...received]);
            setLoading(false);
            setRefreshing(false);
            setLoadingMore(true);
          };
          const matches = await recommendationManager.recommend({ page: profilePage, mode: recommendMode,
            exclude, onBatch });
          if (token !== requestRef.current) return;
          profilePageRef.current = profilePage + 1;
          onBatch(matches);
          if (!received.length) setTracks(previous);
          return;
        }
      }
      const suggested = () => m === 'recommend' && recommendationManager
        ? recommendationManager.recommend({ page: profilePage, mode: recommendMode, exclude }).catch(() => [])
        : Promise.resolve([]);
      const finish = async (items) => {
        const personalized = await suggested();
        if (token !== requestRef.current) return;
        profilePageRef.current = profilePage + 1;
        // Keep the carousel platform-only; sample insertion slots in the actual waterfall.
        const banner = m === 'recommend' && !previous.length ? items.slice(0, 5) : [];
        const bannerIds = new Set(banner.map((t) => t.bvid));
        const merged = [...banner, ...blend(items.slice(banner.length),
          personalized.filter((t) => !bannerIds.has(t.bvid)))];
        setTracks([...previous, ...merged]);
        return merged;
      };
      let list;
      if (m === 'rank') {
        list = await bili.ranking();
      } else if (!account?.isLogin) {
        list = await bili.ranking();
      } else {
        const seen = new Set(exclude);
        list = [];
        let freshIdx = freshIdxRef.current;
        let fetchError;
        const append = (items) => {
          for (const track of items) {
            if (!track.bvid || seen.has(track.bvid)) continue;
            seen.add(track.bvid);
            list.push(track);
          }
        };
        for (let page = 0; page < MAX_RECOMMEND_PAGES && list.length < RECOMMEND_BATCH; page += 1) {
          let items;
          try {
            items = recommendMode === 'all'
              ? await bili.personalizedRecommendations(freshIdx, 30)
              : await bili.personalizedMusicRecommendations(freshIdx, 30);
          } catch (e) {
            fetchError = e;
            break;
          }
          if (token !== requestRef.current) return;
          freshIdx += 1;
          freshIdxRef.current = freshIdx;
          recommendationManager?.observeFeed(items);
          append(items);
          if (list.length) {
            setTracks([...previous, ...list]);
            setLoading(false);
            setLoadingMore(list.length < RECOMMEND_BATCH);
          }
        }
        if (token !== requestRef.current) return;
        // 个性结果不足时补音乐热榜，不混入其他分区，也不无限请求推荐接口。
        if (list.length < RECOMMEND_BATCH) {
          try {
            const ranked = await bili.ranking();
            if (token !== requestRef.current) return;
            append(ranked.filter((track) => !seen.has(track.bvid))
              .slice(0, RECOMMEND_BATCH - list.length)
              .map((track) => ({ ...track, recommendationReason: '音乐热榜' })));
          } catch (e) {
            fetchError = fetchError || e;
          }
        }
        if (token !== requestRef.current) return;
        const merged = await finish(list);
        if (token === requestRef.current && !merged?.length && !previous.length && fetchError) throw fetchError;
        return;
      }
      if (token === requestRef.current) {
        await finish(list);
      }
    } catch (e) {
      if (token === requestRef.current) {
        setError(String(e.message || e));
      }
    } finally {
      finishUpdatePause?.();
      if (token === requestRef.current) {
        loadingMoreRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [mode, likes, recommendMode, account?.isLogin, recommendationManager]);

  const loadMoreOnScroll = () => {
    if (mode === 'recommend' && (account?.isLogin || strictProfile)
      && scrollIntentRef.current && !loadingMore && !loading && !error) {
      scrollIntentRef.current = false;
      load(true);
    }
  };

  useEffect(() => {
    initClient().then(() => setClientReady(true));
  }, []);
  useEffect(() => {
    if (!clientReady || account === null || mode !== 'recommend') return;
    setTracks([]);
    tracksRef.current = [];
    freshIdxRef.current = 0;
    profilePageRef.current = 0;
    load(false, 'recommend');
  }, [clientReady, recommendMode, account?.isLogin, account?.mid, recommendationManager, recommendationProfile?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => {
    setMode(m);
    setTracks([]);
    tracksRef.current = [];
    setLoading(true);
    load(false, m);
  };

  const { bannerTracks, waterfall } = useMemo(() => {
    const bannerTracks = mode === 'recommend' ? tracks.slice(0, 5) : [];
    const bannerIds = new Set(bannerTracks.map((track) => track.bvid));
    // 按视频标识排除轮播内容，刷新和分页时保持两处推荐互不重复。
    const feed = tracks.filter((track) => !bannerIds.has(track.bvid));
    return { bannerTracks, waterfall: waterfallBlocks(feed) };
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
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}
        >
          <IconSearch size={15} color={colors.text2} />
          <Text style={styles.searchHint}>搜索歌曲、UP 主…</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.chipRow}>
        {chips.map(({ key, label, icon: Icon }) => (
          <TouchableOpacity
            key={key}
            style={[styles.chip, mode === key && styles.chipOn]}
            onPress={() => switchMode(key)}
          >
            {Icon ? <Icon size={13} color={mode === key ? colors.accent : colors.text2} /> : null}
            <Text style={[styles.chipText, mode === key && styles.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        ref={listRef}
        data={!loading ? waterfall : []}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        keyExtractor={(block) => block.key}
        renderItem={({ item: block }) => (
          <View style={styles.waterfallRow}>
            {block.columns.map((column, columnIndex) => (
              <View key={columnIndex} style={styles.waterfallColumn}>
                {column.map((track) => (
                  <TrackCard key={track.bvid || track.aid || `${track.title}:${track.up}`}
                    track={track}
                    onPress={() => playQueue(tracks, tracks.indexOf(track))}
                    onPressUp={canOpenTrackUp(track) ? () => openUp(track) : undefined}
                  />
                ))}
              </View>
            ))}
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
          // An empty next batch leaves the content height unchanged, so FlatList
          // may not emit onEndReached again. A new drag can still request a page.
          if (contentOffset.y >= 0 && contentSize.height - contentOffset.y - layoutMeasurement.height
            <= layoutMeasurement.height * 0.5) loadMoreOnScroll();
        }}
        ListHeaderComponent={<View><DailyCard navigation={navigation} />{!loading && bannerTracks.length > 0 && <HomeBanner tracks={bannerTracks} onPress={(_, index) => playQueue(tracks, index)} />}</View>}
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
  header: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  searchPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 999, paddingHorizontal: 14, height: 40,
  },
  searchHint: { color: colors.text3, fontSize: 13 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, height: 32, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: 'rgba(251,114,153,0.45)' },
  chipText: { color: colors.text2, fontSize: 12 },
  chipTextOn: { color: colors.accent, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 130 },
  feedError: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  waterfallRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  waterfallColumn: { flex: 1 },
  emptyBox: { alignItems: 'center', marginTop: 64, gap: 14 },
  emptyText: { color: colors.text2, fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
