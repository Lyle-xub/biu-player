/* Biu Player RN · 首页：搜索胶囊 + 入口行（我的喜欢/热榜）+ 双栏瀑布流推荐 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { initClient } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import TrackCard from '../components/TrackCard';
import HomeBanner from '../components/HomeBanner';
import { IconHeart, IconNote, IconSearch } from '../components/icons';

const WATERFALL_BATCH = 8;
const RECOMMEND_BATCH = 20;
const MAX_RECOMMEND_PAGES = 8;
const cardWeight = (track) => 1 + (String(track.title || '').length > 18 ? 0.24 : 0)
  + (track.recommendationReason ? 0.2 : 0);

function waterfallBlocks(items) {
  const blocks = [];
  for (let start = 0; start < items.length; start += WATERFALL_BATCH) {
    const columns = [[], []];
    const weights = [0, 0];
    items.slice(start, start + WATERFALL_BATCH).forEach((track) => {
      const column = weights[0] <= weights[1] ? 0 : 1;
      columns[column].push(track);
      weights[column] += cardWeight(track);
    });
    blocks.push({ key: `waterfall-${start}`, columns });
  }
  return blocks;
}

export default function HomeScreen({ navigation }) {
  const { playQueue, likes, recommendMode = 'music', account } = usePlayer();
  const [mode, setMode] = useState('recommend'); // recommend | rank | likes
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [clientReady, setClientReady] = useState(false);
  const freshIdxRef = useRef(1);
  const tracksRef = useRef([]);
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  tracksRef.current = tracks;

  const load = useCallback(async (more = false, m = mode) => {
    if (more && (m !== 'recommend' || loadingMoreRef.current)) return;
    const token = ++requestRef.current;
    if (m === 'likes') {
      loadingMoreRef.current = false;
      setTracks(likes); setLoading(false); setLoadingMore(false); setError(null);
      return;
    }
    loadingMoreRef.current = true;
    if (more) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      let list;
      if (m === 'rank') {
        list = await bili.ranking();
      } else if (!account?.isLogin) {
        list = await bili.ranking();
      } else {
        const previous = more ? tracksRef.current : [];
        const seen = new Set(previous.map((track) => track.bvid));
        list = [];
        let freshIdx = more ? freshIdxRef.current : 0;
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
        if (!list.length && !previous.length && fetchError) throw fetchError;
        setTracks([...previous, ...list]);
        return;
      }
      if (token === requestRef.current) {
        setTracks((prev) => (more ? [...prev, ...list] : list));
      }
    } catch (e) {
      if (token === requestRef.current) {
        setError(String(e.message || e));
        if (!more) setTracks([]);
      }
    } finally {
      if (token === requestRef.current) {
        loadingMoreRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [mode, likes, recommendMode, account?.isLogin]);

  useEffect(() => {
    initClient().then(() => setClientReady(true));
  }, []);
  useEffect(() => {
    if (!clientReady || account === null || mode !== 'recommend') return;
    freshIdxRef.current = 1;
    load(false, 'recommend');
  }, [clientReady, recommendMode, account?.isLogin]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => {
    setMode(m);
    setLoading(true);
    load(false, m);
  };

  // 轮播预览前 5 条，信息流保留完整结果，避免音乐筛选后条目少时被轮播占空。
  const bannerTracks = mode === 'recommend' ? tracks.slice(0, 5) : [];
  const waterfall = useMemo(() => waterfallBlocks(tracks), [tracks]);

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
        data={!loading && !error ? waterfall : []}
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
                    onPressUp={track.mid ? () => navigation.navigate('Up', { mid: track.mid }) : undefined}
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
        onEndReached={() => {
          if (mode === 'recommend' && account?.isLogin
            && !loadingMore && !loading && !error && tracks.length) load(true);
        }}
        ListHeaderComponent={!loading && !error && bannerTracks.length ? (
          <HomeBanner tracks={bannerTracks} onPress={(_, index) => playQueue(tracks, index)} />
        ) : null}
        ListEmptyComponent={loading && !refreshing ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
        ) : error ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load(false)}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : !tracks.length ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {mode === 'likes' ? '还没有喜欢的歌曲，去播放页点小心心吧' : '暂时没有内容'}
            </Text>
          </View>
        ) : null}
        ListFooterComponent={loadingMore
          ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          : mode === 'recommend' && account?.isLogin && !loading && !error ? (
            <TouchableOpacity style={styles.loadMoreBtn} accessibilityRole="button"
              accessibilityLabel="加载更多推荐" onPress={() => load(true)}>
              <Text style={styles.retryText}>加载更多</Text>
            </TouchableOpacity>
          ) : null}
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
  waterfallRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  waterfallColumn: { flex: 1 },
  emptyBox: { alignItems: 'center', marginTop: 64, gap: 14 },
  emptyText: { color: colors.text2, fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  loadMoreBtn: { alignSelf: 'center', paddingHorizontal: 22, paddingVertical: 16 },
});
