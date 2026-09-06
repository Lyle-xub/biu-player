import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import { deletePlaylist, movePlaylistTrack, removePlaylistTracks, trackKeyOf, updatePlaylist, usePlaylists } from '../store/playlists';
import TrackRow from '../components/TrackRow';
import ConfirmDialog from '../components/Dialog';
import PlaylistEditor from '../components/PlaylistEditor';
import ReorderablePlaylist from '../components/ReorderablePlaylist';
import RemoteImage from '../components/RemoteImage';
import DefaultCover, { defaultCoverSeed } from '../components/DefaultCover';
import { IconBack, IconCheck, IconEdit, IconPlay, IconReorder, IconTrash } from '../components/icons';

export default function LocalPlaylistScreen({ navigation, route }) {
  const { id } = route.params || {};
  const playlists = usePlaylists();
  const { playQueue, current, resolveTrackUp } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
  const insets = useSafeAreaInsets();
  const pl = playlists.find((p) => p.id === id);
  const tracks = pl?.tracks || [];
  const [confirm, setConfirm] = useState(null);
  const [editor, setEditor] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const selectedKeys = tracks.map(trackKeyOf).filter((key) => selected.has(key));
  const run = async (action) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e.message || '保存失败，请重试'); }
    finally { locked.current = false; setBusy(false); }
  };
  const toggle = (key) => setSelected((before) => {
    const next = new Set(before); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  const remove = (keys) => setConfirm({ title: '移除歌曲',
    message: `从「${pl.title}」移除 ${keys.length} 首歌曲？`, confirmText: '移除', destructive: true,
    onConfirm: () => run(async () => { await removePlaylistTracks(id, keys); setSelected(new Set()); }) });
  const deleteList = () => setConfirm({ title: '删除歌单',
    message: `确定删除「${pl.title}」吗？此操作不可恢复。`, confirmText: '删除', destructive: true,
    onConfirm: () => run(async () => { await deletePlaylist(id); navigation.goBack(); }) });
  const button = (label, Icon, action, disabled = false, danger = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={action}
      accessibilityState={{ disabled: disabled || busy || dragging }}
      disabled={disabled || busy || dragging} style={[styles.button, (disabled || busy || dragging) && { opacity: 0.35 }]}>
      <Icon size={20} color={danger ? colors.danger : colors.accent} />
    </TouchableOpacity>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.back}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{pl?.title || '歌单'}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <ReorderablePlaylist data={tracks} enabled={editing} disabled={busy} bottomInset={insets.bottom}
        onDraggingChange={setDragging} onMove={(key, index) => run(() => movePlaylistTrack(id, key, index))}
        header={pl ? <>
          {editor ? <PlaylistEditor visible playlist={pl} editCover onClose={() => setEditor(false)}
            onSave={(changes) => updatePlaylist(id, changes)} /> : <View style={styles.hero}>
            <RemoteImage uri={pl.cover} style={styles.cover}
              fallback={<DefaultCover seed={defaultCoverSeed(id)} style={StyleSheet.absoluteFill} />} />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={styles.heroTitle}>{pl.title}</Text>
              <Text style={styles.description}>{pl.desc || '自建歌单'}</Text>
            </View>
          </View>}
          <View style={styles.actions}>
            <Text style={styles.count} numberOfLines={1}>{tracks.length} 首歌曲</Text>
            {button('播放全部', IconPlay, () => playQueue(tracks, 0), !tracks.length)}
            {!editor ? button('编辑资料', IconEdit, () => { setEditing(false); setEditor(true); }) : null}
            {button(editing ? '完成重排' : '重排', editing ? IconCheck : IconReorder,
              () => { setEditing(!editing); setSelected(new Set()); }, editor)}
            {button('删除歌单', IconTrash, deleteList, editor, true)}
          </View>
          {editing ? <><Text style={styles.hint}>按住右侧拖块调整顺序，松手自动保存</Text><View style={styles.actions}>
            <Text style={styles.count} numberOfLines={1}>已选 {selectedKeys.length} 首</Text>
            {button(selectedKeys.length === tracks.length && tracks.length ? '取消全选' : '全选', IconCheck,
              () => setSelected(selectedKeys.length === tracks.length ? new Set() : new Set(tracks.map(trackKeyOf))), !tracks.length)}
            {button(`移除所选 ${selectedKeys.length} 首`, IconTrash, () => remove(selectedKeys), !selectedKeys.length, true)}
          </View></> : null}
        </> : null}
        renderItem={({ item: t, index }) => (
          <View style={styles.track}>
            <View style={styles.trackRow}>
              {editing ? <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={`选择 ${t.title}`}
                accessibilityState={{ checked: selected.has(trackKeyOf(t)) }} onPress={() => toggle(trackKeyOf(t))} style={styles.check}>
                <Text style={{ color: colors.accent, fontSize: 20 }}>{selected.has(trackKeyOf(t)) ? '●' : '○'}</Text>
              </TouchableOpacity> : null}
              <View style={{ flex: 1 }}>
                <TrackRow track={t} active={trackKeyOf(current) === trackKeyOf(t)}
                  onPress={() => editing ? toggle(trackKeyOf(t)) : playQueue(tracks, index)}
                  onLongPress={() => remove([trackKeyOf(t)])}
                  onPressUp={!editing && canOpenTrackUp(t) ? () => openUp(t) : undefined} />
              </View>
            </View>
          </View>
        )}
        empty={<Text style={styles.empty}>{pl ? '歌单里还没有歌曲\n在播放页菜单中选择「加入歌单」' : '歌单不存在或已被删除'}</Text>} />
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: 14 },
  back: { padding: 16 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  hero: { flexDirection: 'row', padding: 18, gap: 18, alignItems: 'center' },
  cover: { width: 100, height: 100, borderRadius: 18, overflow: 'hidden' },
  heroTitle: { color: colors.text, fontSize: 19, fontWeight: '600' },
  description: { color: colors.text2, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  count: { flex: 1, minWidth: 0, color: colors.text2, fontSize: 13 },
  button: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.card },
  track: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardBorder },
  trackRow: { flexDirection: 'row', alignItems: 'center' },
  check: { paddingLeft: 14, paddingVertical: 20, minWidth: 36, alignItems: 'center' },
  hint: { color: colors.text3, fontSize: 12, paddingHorizontal: 18, paddingBottom: 10 },
  error: { color: colors.danger, fontSize: 13, padding: 12 },
  empty: { color: colors.text3, fontSize: 13, textAlign: 'center', lineHeight: 22, marginTop: 50 },
});
