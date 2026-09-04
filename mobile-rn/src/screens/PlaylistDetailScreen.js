/* Biu Player RN · 收藏夹详情：夹内视频列表（TrackRow 复用），点行整列表入队播放，
 * has_more 时触底翻页（pn 递增）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { usePlayer } from '../player/PlayerContext';
import TrackRow from '../components/TrackRow';
import PlaylistEditor from '../components/PlaylistEditor';
import { IconBack, IconEdit, IconPlaylist } from '../components/icons';

export default function PlaylistDetailScreen({ navigation, route }) {
  const { mediaId, title, intro } = route.params || {};
  const { playQueue, current, account } = usePlayer();
  const [folder, setFolder] = useState({ id: mediaId, title, desc: intro || '' });
  const [editor, setEditor] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [tracks, setTracks] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const pageRef = useRef(1);
  const scrollRef = useRef(null);

  const load = useCallback(async (more = false) => {
    if (!mediaId) { setError('缺少收藏夹参数'); setLoading(false); return; }
    if (more) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const page = more ? pageRef.current + 1 : 1;
      const r = await bili.favItems(mediaId, page);
      pageRef.current = page;
      setTotal(r.total);
      setHasMore(r.hasMore);
      setTracks((prev) => (more ? [...prev, ...r.list] : r.list));
    } catch (e) {
      console.warn('[PlaylistDetail] 收藏夹内容加载失败：', String(e.message || e));
      setError(String(e.message || e));
      if (!more) setTracks([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [mediaId]);

  useEffect(() => { load(false); }, [load]);

  const openEditor = async () => {
    if (editLoading) return;
    setEditLoading(true); setEditError('');
    try {
      setFolder(await bili.favFolderInfo(mediaId)); setEditor(true);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
    catch (e) { setEditError(e.message || '收藏夹资料加载失败'); }
    finally { setEditLoading(false); }
  };

  const onScroll = ({ nativeEvent }) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    if (!hasMore || loadingMore || loading) return;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 240) load(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{folder.title || title || '收藏夹'}</Text>
        <Text style={styles.count} numberOfLines={1}>{total ? `${total} 首` : ''}</Text>
        {account?.isLogin && !editor ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="编辑收藏夹"
          accessibilityState={{ disabled: editLoading, busy: editLoading }}
          disabled={editLoading} onPress={openEditor} style={styles.editButton}>
          {editLoading ? <ActivityIndicator size="small" color={colors.accent} /> : <IconEdit size={20} color={colors.accent} />}
        </TouchableOpacity> : null}
      </View>
      {editError ? <Text style={styles.editError}>{editError}</Text> : null}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={200}
      >
        {editor ? <PlaylistEditor visible playlist={folder} onClose={() => setEditor(false)}
          onSave={async (changes) => {
            await bili.favFolderEdit(mediaId, changes.title, changes.desc);
            setFolder((previous) => ({ ...previous, ...changes }));
          }} /> : folder.desc ? <Text style={styles.description}>{folder.desc}</Text> : null}
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 64 }} />
        ) : error ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>{error}</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => load(false)}>
              <Text style={styles.actionText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : !tracks.length ? (
          <View style={styles.emptyBox}>
            <IconPlaylist size={30} color={colors.text3} />
            <Text style={styles.empty}>这个收藏夹是空的</Text>
          </View>
        ) : (
          tracks.map((t, i) => (
            <TrackRow
              key={t.bvid || t.aid || i}
              track={t}
              active={!!current && current.bvid === t.bvid}
              onPress={() => playQueue(tracks, i)}
              onPressUp={t.mid ? () => navigation.navigate('Up', { mid: t.mid }) : undefined}
            />
          ))
        )}
        {loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  backBtn: { padding: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, minWidth: 0 },
  count: { color: colors.text3, fontSize: 12, paddingRight: 8 },
  content: { paddingBottom: 130 },
  emptyBox: { alignItems: 'center', marginTop: 96, gap: 14 },
  empty: { color: colors.text3, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  editError: { color: colors.danger, fontSize: 13, padding: 14 },
  description: { color: colors.text2, fontSize: 13, lineHeight: 21, padding: 14 },
  editButton: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  actionBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  actionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
