import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import RemoteImage from './RemoteImage';
import DefaultCover, { defaultCoverSeed } from './DefaultCover';
import { colors } from '../theme';

export default function PlaylistEditor({ visible, playlist, onClose, onSave, editCover = false }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    setTitle(playlist?.title || ''); setDesc(playlist?.desc || '');
    setCover(playlist?.cover || null); setError('');
  }, [visible, playlist?.id]); // Keep edits when the library refreshes in the background.
  const save = async () => {
    if (busy) return;
    if (!title.trim()) { setError('名称不能为空'); return; }
    setBusy(true); setError('');
    try { await onSave({ title: title.trim(), desc: desc.trim(), ...(editCover ? { cover } : {}) }); onClose(); }
    catch (e) { setError(e.message || '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const covers = [...new Set((playlist?.tracks || []).map((t) => t.pic).filter(Boolean))];
  if (!visible) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>编辑{editCover ? '歌单' : '收藏夹'}</Text>
      {editCover ? <>
        <View style={styles.coverRow}>
          <RemoteImage uri={cover} style={styles.preview} fallback={<DefaultCover seed={defaultCoverSeed(playlist?.id)} style={StyleSheet.absoluteFill} />} />
          <TouchableOpacity onPress={() => setCover(null)} accessibilityRole="button" accessibilityLabel="恢复默认封面">
            <Text style={styles.link}>恢复默认封面</Text>
          </TouchableOpacity>
        </View>
        {covers.length ? <>
          <Text style={styles.label}>使用歌曲封面</Text>
          <FlatList horizontal data={covers} keyExtractor={(uri) => uri} style={{ height: 62 }}
            renderItem={({ item, index }) => (
              <TouchableOpacity onPress={() => setCover(item)} accessibilityRole="button"
                accessibilityLabel={`使用第 ${index + 1} 张封面`} accessibilityState={{ selected: cover === item }}
                style={[styles.coverChoice, cover === item && { borderColor: colors.accent }]}>
                <RemoteImage uri={item} style={{ flex: 1 }} />
              </TouchableOpacity>
            )} />
        </> : null}
      </> : null}
      <Text style={styles.label}>名称</Text>
      <TextInput accessibilityLabel="名称" value={title} onChangeText={setTitle} maxLength={120}
        editable={!busy} style={styles.input} placeholderTextColor={colors.text3} placeholder="输入名称" />
      <Text style={styles.label}>简介</Text>
      <TextInput accessibilityLabel="简介" value={desc} onChangeText={setDesc} maxLength={2000}
        editable={!busy} multiline style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]}
        placeholderTextColor={colors.text3} placeholder="写一点关于这张歌单的介绍" />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <TouchableOpacity onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="保存修改" style={styles.save}>
        <Text style={styles.saveText}>{busy ? '正在保存…' : '保存修改'}</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={busy} onPress={onClose} accessibilityRole="button" accessibilityLabel="取消编辑" style={styles.cancel}>
        <Text style={styles.label}>取消</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, gap: 12 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
  label: { color: colors.text2, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, borderRadius: 12, color: colors.text, padding: 12, minHeight: 44 },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  preview: { width: 90, height: 90, borderRadius: 16, overflow: 'hidden' },
  coverChoice: { width: 60, height: 60, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', marginRight: 8 },
  link: { color: colors.accent, fontSize: 13 },
  save: { backgroundColor: colors.accent, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '600' },
  cancel: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: 13 },
});
