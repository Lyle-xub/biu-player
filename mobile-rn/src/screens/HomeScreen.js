/* Biu Player RN · 首页：搜索胶囊 + 入口行（我的喜欢/热榜）+ 双栏瀑布流推荐 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { initClient } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import TrackCard from '../components/TrackCard';
import { IconHeart, IconNote, IconSearch } from '../components/icons';

export default function HomeScreen({ navigation }) {
  const { playQueue, likes } = usePlayer();
  const [mode, setMode] = useState('recommend'); // recommend | rank | likes
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const freshIdxRef = useRef(1);

  const load = useCallback(async (more = false, m = mode) => {
    if (m === 'likes') { setTracks(likes); setLoading(false); setError(null); return; }
    if (more) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      let list;
      if (m === 'rank') {
        list = await bili.ranking();
      } else {
        list = await bili.recommendMusic(freshIdxRef.current, 12);
        freshIdxRef.current += 3;
        if (!list.length) list = await bili.ranking(); // 推荐被风控时兜底热榜
      }
      setTracks((prev) => (more ? [...prev, ...list] : list));
    } catch (e) {
      setError(String(e.message || e));
      if (!more) setTracks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [mode, likes]);

  useEffect(() => {
    initClient().then(() => load(false, mode));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => {
    setMode(m);
    setLoading(true);
    load(false, m);
  };

  // 双栏瀑布流：按列高近似交替分配
  const columns = useMemo(() => {
    const left = []; const right = [];
    tracks.forEach((t, i) => ((i % 2 === 0 ? left : right).push(t)));
    return [left, right];
  }, [tracks]);

  const onScroll = ({ nativeEvent }) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    if (mode === 'likes' || loadingMore || loading) return;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 240) {
      load(true);
    }
  };

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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(false); }}
            tintColor={colors.accent}
          />
        )}
        onScroll={onScroll}
        scrollEventThrottle={200}
      >
        {loading && !refreshing ? (
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
        ) : (
          <View style={styles.masonry}>
            {columns.map((col, ci) => (
              <View key={ci} style={styles.column}>
                {col.map((t) => (
                  <TrackCard
                    key={`${t.bvid || t.aid}-${tracks.indexOf(t)}`}
                    track={t}
                    onPress={() => playQueue(tracks, tracks.indexOf(t))}
                    onPressUp={t.mid ? () => navigation.navigate('Up', { mid: t.mid }) : undefined}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
        {loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
  masonry: { flexDirection: 'row', gap: 12 },
  column: { flex: 1 },
  emptyBox: { alignItems: 'center', marginTop: 64, gap: 14 },
  emptyText: { color: colors.text2, fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
