/* Biu Player RN · 加入歌单面板（由播放页 BottomSheet 承载）：列出本地歌单（点选即加入，去重提示），
 * 底部输入框可「新建并加入」。数据层 = src/store/playlists.js（AsyncStorage 本地）。
 */
import React, { useRef, useState } from 'react';
import {
  FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { colors } from '../theme';
import { addToPlaylist, createPlaylist, usePlaylists } from '../store/playlists';
import { IconChevronRight, IconPlus, IconPlaylist } from './icons';
import RemoteImage from './RemoteImage';
import SheetContent from './SheetContent';

export default function PlaylistPicker({ track, onClose, onPick, excludeId, title = '加入歌单' }) {
  const { playlists, ready } = usePlaylists({ withStatus: true });
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  const flash = (text) => {
    setMsg(text);
  };

  const pick = async (pl) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMsg('');
    try {
      const r = await (onPick ? onPick(pl) : addToPlaylist(pl.id, track));
      if (r === 'added') { onClose(); return; }
      flash(r === 'dup' ? `「${pl.title}」里已有这首歌` : '加入失败');
    } catch (e) { flash(e.message || '加入失败'); }
    finally { locked.current = false; setBusy(false); }
  };

  const createAndAdd = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMsg('');
    try {
      const pl = await createPlaylist(newName, track && !onPick ? [track] : []);
      if (!pl) { flash('先输入歌单名'); return; }
      if (onPick) await onPick(pl);
      setNewName('');
      onClose();
    } catch (e) { flash(e.message || '新建失败'); }
    finally { locked.current = false; setBusy(false); }
  };

  return (
    <View style={styles.sheet}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <SheetContent loading={!ready} minHeight={160}><FlatList
        data={playlists.filter((playlist) => playlist.id !== excludeId)}
        keyExtractor={(p) => String(p.id)}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`选择歌单 ${item.title}`} accessibilityState={{ disabled: busy }}
            activeOpacity={0.6} disabled={busy} style={styles.row} onPress={() => pick(item)}>
            <RemoteImage uri={item.cover || item.tracks[0]?.pic} width={120} height={120} transition={0} style={styles.rowIcon}
              fallback={<View style={styles.coverFallback}><IconPlaylist size={20} color={colors.accent} /></View>} />
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowCount}>{item.tracks.length} 首</Text>
            </View>
            <IconChevronRight size={16} color={colors.text3} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>还没有本地歌单，在下面新建一个</Text>}
      /></SheetContent>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          placeholder="新建歌单…"
          placeholderTextColor={colors.text3}
          value={newName}
          editable={!busy}
          onChangeText={setNewName}
          maxLength={24}
        />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="新建并选择歌单" disabled={busy} style={styles.newBtn} onPress={createAndAdd}>
          <IconPlus size={15} color={colors.accent} />
          <Text style={styles.newBtnText}>新建{track ? '并加入' : ''}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flexShrink: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, backgroundColor: colors.card, borderRadius: 16, marginBottom: 8,
  },
  rowIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentSoft,
  },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: 14, fontWeight: '500' },
  rowCount: { color: colors.text3, fontSize: 11, marginTop: 4 },
  empty: { color: colors.text3, fontSize: 12, textAlign: 'center', paddingVertical: 22 },
  msg: { color: colors.accent, fontSize: 12, textAlign: 'center', marginTop: 6 },
  newRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  input: {
    flex: 1, height: 48, borderRadius: 12, paddingHorizontal: 14,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    color: colors.text, fontSize: 14, paddingVertical: 0,
  },
  newBtn: {
    minHeight: 48,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 12, backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: 'rgba(251,114,153,0.45)',
    paddingHorizontal: 14,
  },
  newBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
