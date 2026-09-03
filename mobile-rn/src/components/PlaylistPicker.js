/* Biu Player RN · 加入歌单面板（由播放页 BottomSheet 承载）：列出本地歌单（点选即加入，去重提示），
 * 底部输入框可「新建并加入」。数据层 = src/store/playlists.js（AsyncStorage 本地）。
 */
import React, { useState } from 'react';
import {
  FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { colors } from '../theme';
import { addToPlaylist, createPlaylist, usePlaylists } from '../store/playlists';
import { IconPlus, IconPlaylist } from './icons';

export default function PlaylistPicker({ track, onClose }) {
  const playlists = usePlaylists();
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');

  const flash = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 1600);
  };

  const pick = async (pl) => {
    const r = await addToPlaylist(pl.id, track);
    if (r === 'added') { onClose(); return; }
    flash(r === 'dup' ? `「${pl.title}」里已有这首歌` : '加入失败');
  };

  const createAndAdd = async () => {
    const pl = await createPlaylist(newName);
    if (!pl) { flash('先输入歌单名'); return; }
    setNewName('');
    if (track) await addToPlaylist(pl.id, track);
    onClose();
  };

  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>加入歌单</Text>
      <FlatList
        data={playlists}
        keyExtractor={(p) => String(p.id)}
        style={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => pick(item)}>
            <View style={styles.rowIcon}>
              <IconPlaylist size={17} color={colors.accent} />
            </View>
            <Text style={styles.rowName} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.rowCount}>{item.tracks.length} 首</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>还没有本地歌单，在下面新建一个</Text>}
      />
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          placeholder="新建歌单…"
          placeholderTextColor={colors.text3}
          value={newName}
          onChangeText={setNewName}
          maxLength={24}
        />
        <TouchableOpacity style={styles.newBtn} onPress={createAndAdd}>
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
    paddingVertical: 11, paddingHorizontal: 6,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  rowName: { color: colors.text, fontSize: 14, flex: 1, minWidth: 0 },
  rowCount: { color: colors.text3, fontSize: 11 },
  empty: { color: colors.text3, fontSize: 12, textAlign: 'center', paddingVertical: 22 },
  msg: { color: colors.accent, fontSize: 12, textAlign: 'center', marginTop: 6 },
  newRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  input: {
    flex: 1, height: 42, borderRadius: 12, paddingHorizontal: 14,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    color: colors.text, fontSize: 14, paddingVertical: 0,
  },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 12, backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: 'rgba(251,114,153,0.45)',
    paddingHorizontal: 14,
  },
  newBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
