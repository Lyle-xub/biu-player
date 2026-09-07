import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePlayer } from '../player/PlayerContext';
import { trackKeyOf } from '../player/track';
import { addToPlaylist, removeFromPlaylist, transferPlaylistTrack } from '../store/playlists';
import * as bili from '../api/bili';
import BottomSheet from './BottomSheet';
import PlaylistPicker from './PlaylistPicker';
import RemoteImage from './RemoteImage';
import { IconBack, IconCheck, IconChevronDown, IconChevronRight, IconHeart, IconNote, IconPlaylist, IconShare, IconStar, IconTrash } from './icons';
import { colors } from '../theme';

export function useTrackActions(source, playlistId) {
  const context = usePlayer();
  const scope = context.account?.isLogin ? String(context.account.mid) : '';
  const latestScope = useRef(scope); latestScope.current = scope;
  const [track, setTrack] = useState(null), [error, setError] = useState('');
  useEffect(() => { setTrack(null); setError(''); }, [scope, source, playlistId]);
  const removeTrack = (item) => {
    if (latestScope.current !== scope) throw new Error('账号已切换，请重新操作');
    return source === 'playlist' ? removeFromPlaylist(playlistId, trackKeyOf(item)) : context.removeCollectionTrack(item, source);
  };
  return {
    open: (item) => { setError(''); setTrack(item); },
    remove: async (item) => {
      setError('');
      try { await removeTrack(item); }
      catch (reason) { if (latestScope.current === scope) setError(reason.message || '删除失败，请重试'); }
    },
    feedback: error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null,
    sheet: track ? <TrackActionsSheet key={`${scope}:${trackKeyOf(track)}`} track={track} source={source} playlistId={playlistId}
      removeTrack={removeTrack} onClose={() => setTrack(null)} /> : null,
  };
}

function TrackActionsSheet({ track, source, playlistId, removeTrack, onClose }) {
  const context = usePlayer();
  const [mode, setMode] = useState('menu'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [folders, setFolders] = useState([]), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  const live = useRef(true), locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const check = () => { if (!live.current) throw new Error('操作面板已关闭，请重新操作'); };
  const run = async (action) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { check(); await action(); if (live.current) onClose(); }
    catch (reason) { if (live.current) setError(reason.message || '操作失败，请重试'); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => {
    if (mode !== 'favorites') return;
    if (!context.account?.isLogin) { setError('请先登录 B 站账号'); return; }
    let current = true;
    setLoading(true); setError('');
    bili.favFolders(context.account.mid).then((items) => { if (current) setFolders(items); })
      .catch((reason) => { if (current) setError(reason.message || '收藏夹加载失败'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [mode, context.account?.isLogin, context.account?.mid, retry]);
  const pickPlaylist = async (playlist) => {
    check();
    setBusy(true);
    try {
      if (mode === 'move' && source === 'playlist') {
        await transferPlaylistTrack(playlistId, playlist.id, trackKeyOf(track));
      } else {
        const result = await addToPlaylist(playlist.id, track);
        if (!result) throw new Error('目标歌单已被删除');
        if (mode === 'move') { check(); await removeTrack(track); }
      }
      return 'added';
    } finally { if (live.current) setBusy(false); }
  };
  const favorite = (folder) => run(async () => {
    const aid = Number(track.aid) || Number((await bili.view(track.parentBvid || track.bvid)).aid);
    check();
    if (!aid) throw new Error('无法获取视频信息');
    await bili.favDeal(aid, [folder.id]);
  });
  const item = (label, action, Icon, { disabled = false, danger = false, detail, accessibilityLabel = label } = {}) => <TouchableOpacity key={label} accessibilityRole="button"
    accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={action}
    activeOpacity={0.6} style={[styles.item, (busy || disabled) && styles.disabled]}>
    <View style={[styles.icon, danger && styles.dangerIcon]}><Icon size={20} color={danger ? colors.danger : colors.text2} /></View>
    <View style={styles.itemBody}><Text style={[styles.label, danger && { color: colors.danger }]}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}</View>
    {!danger ? <IconChevronRight size={16} color={colors.text3} /> : null}
  </TouchableOpacity>;
  const quickAction = (label, action, Icon, selected, disabled = false) => <TouchableOpacity accessibilityRole="button"
    accessibilityLabel={label} accessibilityState={{ disabled: busy || disabled, selected }} disabled={busy || disabled}
    onPress={action} activeOpacity={0.6} style={[styles.quickAction, selected && styles.selected, busy && styles.disabled]}>
    <Icon size={23} color={selected ? colors.accent : colors.text2} filled={selected} />
    <Text style={[styles.quickLabel, selected && { color: colors.accent }]}>{label}</Text>
  </TouchableOpacity>;
  const switchMode = (value) => { setError(''); setMode(value); };
  const liked = context.isLiked(track), inLibrary = context.isInLibrary(track);
  const collectionName = source === 'likes' ? '我的喜欢' : source === 'library' ? '音乐库' : '歌单';
  return <BottomSheet visible onClose={onClose} style={styles.sheet}>
    <View style={styles.header}>
      <RemoteImage uri={track.pic} width={160} height={160} transition={0} style={styles.cover}
        fallback={<View style={styles.coverFallback}><IconNote size={24} color={colors.accent} /></View>} />
      <View style={styles.headerBody}>
        <Text numberOfLines={2} style={styles.title}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{[track.up || track.parentUp, collectionName].filter(Boolean).join(' · ')}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭操作菜单" onPress={onClose} style={styles.close}>
        <IconChevronDown size={21} color={colors.text2} />
      </TouchableOpacity>
    </View>
    {mode !== 'menu' ? <View style={styles.navigation}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="返回操作菜单" disabled={busy}
        onPress={() => switchMode('menu')} style={styles.back}><IconBack size={20} color={colors.text2} /></TouchableOpacity>
      <Text style={styles.sectionTitle}>{mode === 'move' ? '移到其他歌单' : mode === 'playlist' ? '加入歌单' : '加入 B 站收藏夹'}</Text>
    </View> : null}
    {mode === 'playlist' || mode === 'move' ? <PlaylistPicker track={track} onClose={() => { if (live.current) onClose(); }} onPick={pickPlaylist}
      title={null} excludeId={mode === 'move' && source === 'playlist' ? playlistId : undefined} /> :
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {mode === 'menu' ? <>
          <View style={styles.quickRow}>
            {quickAction(liked ? '取消喜欢' : '喜欢', () => run(() => context.toggleLike(track)), IconHeart, liked)}
            {quickAction(inLibrary ? '已在音乐库' : '加入音乐库', () => run(() => context.toggleLibrary(track)), inLibrary ? IconCheck : IconNote, inLibrary, inLibrary)}
          </View>
          <View style={styles.group}>
            {item('加入歌单', () => switchMode('playlist'), IconPlaylist)}
            <View style={styles.divider} />
            {item('移到其他歌单', () => switchMode('move'), IconShare)}
            <View style={styles.divider} />
            {item('加入 B 站收藏夹', () => switchMode('favorites'), IconStar)}
          </View>
          <View style={styles.deleteGroup}>
            {item(source === 'library' && liked ? '删除并取消喜欢' : '从当前列表删除', () => run(() => removeTrack(track)), IconTrash, { danger: true })}
          </View>
        </> : <>
          {loading ? <View style={styles.status}><ActivityIndicator color={colors.accent} /><Text style={styles.detail}>正在加载收藏夹</Text></View> :
            <View style={folders.length ? styles.group : undefined}>{folders.map((folder) => item(folder.title, () => favorite(folder), IconStar,
              { accessibilityLabel: `加入「${folder.title}」`, detail: Number.isFinite(folder.media_count) ? `${folder.media_count} 个视频` : undefined }))}</View>}
          {!loading && !error && !folders.length ? <Text style={styles.empty}>暂无收藏夹，请先在 B 站创建</Text> : null}
          {error && context.account?.isLogin ? item('重新加载收藏夹', () => setRetry((n) => n + 1), IconStar) : null}
        </>}
      </ScrollView>}
    {busy ? <View style={styles.status}><ActivityIndicator color={colors.accent} /><Text style={styles.detail}>正在保存</Text></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </BottomSheet>;
}
const styles = StyleSheet.create({
  sheet: { maxHeight: '86%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  cover: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.card },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBody: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontWeight: '600', fontSize: 16, lineHeight: 22 },
  subtitle: { color: colors.text3, fontSize: 12, marginTop: 5 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.card },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  quickAction: { flex: 1, minHeight: 82, padding: 12, gap: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.card },
  selected: { backgroundColor: colors.accentSoft },
  quickLabel: { color: colors.text2, fontSize: 13, fontWeight: '500' },
  group: { backgroundColor: colors.card, borderRadius: 18, overflow: 'hidden' },
  deleteGroup: { marginTop: 12, backgroundColor: colors.card, borderRadius: 18 },
  item: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dangerIcon: { backgroundColor: 'rgba(255,107,129,0.10)', borderRadius: 10 },
  itemBody: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 15 },
  detail: { color: colors.text3, fontSize: 12, marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.cardBorder, marginLeft: 58, marginRight: 16 },
  disabled: { opacity: 0.5 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14 },
  error: { color: colors.danger, padding: 12, fontSize: 13 },
  empty: { color: colors.text3, padding: 16, textAlign: 'center' },
});
