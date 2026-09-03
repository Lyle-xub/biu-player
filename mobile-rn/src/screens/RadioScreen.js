/* Biu Player RN · 电台：B 站直播音乐电台（parent_area_id=5），双栏网格 + 触底翻页
 * 播放走 PlayerContext 的 isLive 分支（expo-video HLS，仅音频）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fmtCount } from '../theme';
import * as bili from '../api/bili';
import { initClient } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import { IconRadio } from '../components/icons';
import RemoteImage from '../components/RemoteImage';

function RoomCard({ room, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.card, active && styles.cardActive]} activeOpacity={0.85} onPress={onPress}>
      <View>
        <RemoteImage uri={room.pic} width={720} height={450} style={styles.cover}
          fallback={<View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
            <IconRadio size={26} color={colors.accent} />
          </View>} />
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>{room.title}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.up} numberOfLines={1}>{room.up}</Text>
        {room.online ? <Text style={styles.online}>{fmtCount(room.online)}在看</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export default function RadioScreen() {
  const { playQueue, current, playing } = usePlayer();
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (p = 1) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const rooms = await bili.rooms(p);
      setList((prev) => (p === 1 ? rooms : [...prev, ...rooms.filter((r) => !prev.some((x) => x.roomid === r.roomid))]));
      setPage(p);
    } catch (e) {
      setError(String(e.message || e));
      if (p === 1) setList([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { initClient().then(() => load(1)); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <IconRadio size={18} color={colors.accent} />
        <Text style={styles.headerTitle}>音乐电台</Text>
        <Text style={styles.headerHint}>B 站直播 · 电台分区</Text>
      </View>
      {loading && !refreshing ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.hint}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(1)}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={list}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          keyExtractor={(r) => String(r.roomid)}
          renderItem={({ item, index: i }) => (
            <View style={{ flex: 1 }}>
              <RoomCard
                room={item}
                active={!!current && current.isLive && current.roomid === item.roomid && playing}
                onPress={() => playQueue(list, i)}
              />
            </View>
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(1); }}
              tintColor={colors.accent}
            />
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (!loadingMore && list.length) load(page + 1); }}
          ListEmptyComponent={(
            <View style={styles.center}><Text style={styles.hint}>暂时没有正在直播的电台</Text></View>
          )}
          ListFooterComponent={loadingMore
            ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 14 }} />
            : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
  },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  headerHint: { color: colors.text3, fontSize: 11, marginLeft: 'auto' },
  listContent: { paddingHorizontal: 14, paddingBottom: 140 },
  card: {
    marginBottom: 14,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 16, overflow: 'hidden',
  },
  cardActive: { borderColor: 'rgba(251,114,153,0.6)' },
  cover: { width: '100%', aspectRatio: 16 / 10, backgroundColor: '#1a1e14' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  livePill: {
    position: 'absolute', left: 8, top: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(9,11,7,0.72)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { color: colors.accent, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  title: {
    color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '500',
    marginHorizontal: 10, marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 10, marginTop: 4, marginBottom: 10, gap: 6,
  },
  up: { color: colors.text2, fontSize: 11, flexShrink: 1 },
  online: { color: colors.text3, fontSize: 10 },
  center: { alignItems: 'center', marginTop: 64, gap: 14, paddingHorizontal: 32 },
  hint: { color: colors.text2, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
