/* Biu Player RN · UP 主空间页：头像/昵称/签名/粉丝数 + 投稿视频分页列表 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fmtCount } from '../theme';
import * as bili from '../api/bili';
import { imageHeaders } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import TrackRow from '../components/TrackRow';
import { IconBack, IconUser } from '../components/icons';

export default function UpScreen({ route, navigation }) {
  const { mid } = route.params || {};
  const { playQueue, current } = usePlayer();
  const [info, setInfo] = useState(null);
  const [stat, setStat] = useState(null);
  const [videos, setVideos] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const loadVideos = useCallback(async (p = 1) => {
    if (!mid) return;
    if (p === 1) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const r = await bili.upVideos(mid, p);
      setVideos((prev) => (p === 1 ? r.list : [...prev, ...r.list]));
      setTotal(r.total);
      setPage(p);
    } catch (e) {
      setError(String(e.message || e));
      if (p === 1) setVideos([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [mid]);

  useEffect(() => {
    if (!mid) { setError('缺少 UP 主 ID'); setLoading(false); return; }
    bili.upInfo(mid).then(setInfo).catch((e) => {
      console.warn('[UpScreen] upInfo 失败:', String((e && e.message) || e));
    });
    bili.upStat(mid).then(setStat).catch((e) => {
      console.warn('[UpScreen] upStat 失败:', String((e && e.message) || e));
    });
    loadVideos(1);
  }, [mid, loadVideos]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>UP 主空间</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.profileCard}>
        {info && info.face ? (
          <Image source={{ uri: info.face, headers: imageHeaders() }} style={styles.face} />
        ) : (
          <View style={[styles.face, styles.faceFallback]}>
            <IconUser size={24} color={colors.text3} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{(info && info.name) || `UP ${mid}`}</Text>
          {info && info.sign ? <Text style={styles.sign} numberOfLines={2}>{info.sign}</Text> : null}
          {stat ? (
            <Text style={styles.stat}>粉丝 {fmtCount(stat.fans)} · 关注 {fmtCount(stat.following)}</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.videoHead}>投稿视频{total ? `（${total}）` : ''}</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.hint}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadVideos(1)}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(t, i) => `${t.bvid || t.aid}-${i}`}
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              active={!!current && current.bvid === item.bvid}
              onPress={() => playQueue(videos, index)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 140 }}
          onEndReachedThreshold={0.3}
          onEndReached={() => {
            if (!loadingMore && videos.length < total) loadVideos(page + 1);
          }}
          ListEmptyComponent={(
            <View style={styles.center}><Text style={styles.hint}>TA 还没有投稿</Text></View>
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
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  headerTitle: { color: colors.text2, fontSize: 13, letterSpacing: 2 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 14, marginBottom: 10, padding: 16,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 20,
  },
  face: { width: 64, height: 64, borderRadius: 32 },
  faceFallback: {
    backgroundColor: '#1a1e14', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  name: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sign: { color: colors.text2, fontSize: 12, marginTop: 4, lineHeight: 17 },
  stat: { color: colors.text3, fontSize: 11, marginTop: 6 },
  videoHead: {
    color: colors.text, fontSize: 14, fontWeight: '600',
    paddingHorizontal: 16, marginTop: 8, marginBottom: 6,
  },
  center: { alignItems: 'center', marginTop: 48, gap: 14, paddingHorizontal: 32 },
  hint: { color: colors.text2, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
