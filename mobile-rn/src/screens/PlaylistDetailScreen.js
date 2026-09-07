/* Biu Player RN · 收藏夹详情：夹内视频列表（TrackRow 复用），点行整列表入队播放，
 * has_more 时触底翻页（pn 递增）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import TrackRow from '../components/TrackRow';
import PlaylistEditor from '../components/PlaylistEditor';
import { IconBack, IconEdit, IconPlaylist } from '../components/icons';

export default function PlaylistDetailScreen({ navigation, route }) {
  const { mediaId, title, intro } = route.params || {};
  const { playQueue, current, account, resolveTrackUp } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
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
  const requestRef = useRef(null), generation = useRef(0);

  const load = useCallback(async (more = false) => {
    if (!mediaId) { setError('缺少收藏夹参数'); setLoading(false); return; }
    if (more && requestRef.current) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const id = ++generation.current;
    const valid = () => id === generation.current && !controller.signal.aborted;
    if (more) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const page = more ? pageRef.current + 1 : 1;
      const r = await bili.favItems(mediaId, page, 40, { signal: controller.signal });
      if (!valid()) return;
      pageRef.current = page;
      setTotal(r.total); setHasMore(r.hasMore);
      setTracks(prev => more ? [...new Map([...prev, ...r.list].map(t => [t.bvid, t])).values()] : r.list);
    } catch (e) {
      if (valid()) setError(String(e.message || e));
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (valid()) { setLoading(false); setLoadingMore(false); }
    }
  }, [mediaId, account?.mid, account?.isLogin]);

  useEffect(() => {
    pageRef.current = 1; setTracks([]); setHasMore(false); setTotal(0);
    setFolder({ id: mediaId, title, desc: intro || '' });
    load(false);
    return () => { generation.current++; requestRef.current?.abort(); requestRef.current = null; };
  }, [load]);

  const openEditor = async () => {
    if (editLoading) return;
    setEditLoading(true); setEditError('');
    try {
      setFolder(await bili.favFolderInfo(mediaId)); setEditor(true);
      scrollRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
    catch (e) { setEditError(e.message || '收藏夹资料加载失败'); }
    finally { setEditLoading(false); }
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
      <FlatList
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        data={tracks}
        keyExtractor={track => track.bvid}
        initialNumToRender={12} maxToRenderPerBatch={6} windowSize={5}
        onEndReached={() => { if (hasMore && !loading && !error) load(true); }}
        onEndReachedThreshold={0.5}
        renderItem={({ item: t, index: i }) => <TrackRow
          track={t} active={!!current && current.bvid === t.bvid}
          onPress={() => playQueue(tracks, i)}
          onPressUp={canOpenTrackUp(t) ? () => openUp(t) : undefined}
        />}
        ListHeaderComponent={<>
        {editor ? <PlaylistEditor visible playlist={folder} onClose={() => setEditor(false)}
          onSave={async (changes) => {
            await bili.favFolderEdit(mediaId, changes.title, changes.desc);
            setFolder((previous) => ({ ...previous, ...changes }));
          }} /> : folder.desc ? <Text style={styles.description}>{folder.desc}</Text> : null}
        </>}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 64 }} />
          : !error ? <View style={styles.emptyBox}>
            <IconPlaylist size={30} color={colors.text3} />
            <Text style={styles.empty}>这个收藏夹是空的</Text>
          </View> : null}
        ListFooterComponent={error ? <View style={styles.emptyBox}>
          <Text style={styles.empty}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="重试" style={styles.actionBtn} onPress={() => load(tracks.length > 0)}>
            <Text style={styles.actionText}>重试</Text>
          </TouchableOpacity>
        </View> : loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}
      />
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
  editButton: { width: 48, height: 48, flexShrink: 0, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  actionBtn: {
    paddingHorizontal: 22, height: 48, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  actionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
