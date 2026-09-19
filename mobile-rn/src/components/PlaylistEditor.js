import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import RemoteImage from './RemoteImage';
import DefaultCover, { defaultCoverSeed } from './DefaultCover';
import { pickPlaylistCover } from '../media/playlistCover';
import { colors } from '../theme';

export default function PlaylistEditor({ visible, playlist, onClose, onSave, editCover = false }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const session = useRef(0);
  const pickingRef = useRef(false);
  useEffect(() => {
    session.current++;
    pickingRef.current = false; setPicking(false); setBusy(false);
    if (!visible) return;
    setTitle(playlist?.title || ''); setDesc(playlist?.desc || '');
    setCover(playlist?.cover || null); setError('');
    return () => { session.current++; };
  }, [visible, playlist?.id]); // Keep edits when the library refreshes in the background.
  const uploadCover = async () => {
    if (pickingRef.current || busy) return;
    const token = session.current;
    pickingRef.current = true; setPicking(true); setError('');
    try {
      const next = await pickPlaylistCover();
      if (token === session.current && next) setCover(next);
    } catch (e) {
      if (token === session.current) setError(e.message || '无法选择图片，请重试');
    } finally {
      if (token === session.current) { pickingRef.current = false; setPicking(false); }
    }
  };
  const save = async () => {
    if (busy || pickingRef.current) return;
    if (!title.trim()) { setError('名称不能为空'); return; }
    const token = session.current;
    setBusy(true); setError('');
    try { await onSave({ title: title.trim(), desc: desc.trim(), ...(editCover ? { cover } : {}) }); if (token === session.current) onClose(); }
    catch (e) { if (token === session.current) setError(e.message || '保存失败，请重试'); }
    finally { if (token === session.current) setBusy(false); }
  };
  const covers = [...new Set((playlist?.tracks || []).map((t) => t.pic).filter(Boolean))];
  if (!visible) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>编辑{editCover ? '歌单' : '收藏夹'}</Text>
      {editCover ? <>
        <View style={styles.coverRow}>
          <TouchableOpacity onPress={uploadCover} disabled={busy || picking} accessibilityRole="button" accessibilityLabel="选择歌单封面" style={styles.preview}>
            <RemoteImage uri={cover} style={StyleSheet.absoluteFill} fallback={<DefaultCover seed={defaultCoverSeed(playlist?.id)} style={StyleSheet.absoluteFill} />} />
            <View style={styles.coverBadge}><Text style={styles.coverBadgeText}>更换封面</Text></View>
          </TouchableOpacity>
          <View style={styles.coverInfo}>
            <TouchableOpacity onPress={uploadCover} disabled={busy || picking} accessibilityRole="button" accessibilityLabel="从相册选择" style={styles.upload}>
              <Text style={styles.link}>{picking ? '正在处理…' : '从相册选择'}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>裁剪为方形，随歌单同步</Text>
            <TouchableOpacity disabled={busy || picking || !cover} onPress={() => setCover(null)} accessibilityRole="button" accessibilityLabel="恢复默认封面" style={styles.reset}>
              <Text style={[styles.label, !cover && { opacity: 0.4 }]}>恢复默认封面</Text>
            </TouchableOpacity>
          </View>
        </View>
        {covers.length ? <>
          <Text style={styles.label}>使用歌曲封面</Text>
          <FlatList horizontal data={covers} keyExtractor={(uri) => uri} style={{ height: 62 }}
            renderItem={({ item, index }) => (
              <TouchableOpacity disabled={busy || picking} onPress={() => setCover(item)} accessibilityRole="button"
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
      <TouchableOpacity onPress={save} disabled={busy || picking} accessibilityRole="button" accessibilityLabel="保存修改" style={styles.save}>
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
  coverInfo: { flex: 1, alignItems: 'flex-start', gap: 6 },
  upload: { backgroundColor: colors.accentSoft, paddingHorizontal: 16, minHeight: 40, justifyContent: 'center', borderRadius: 20 },
  hint: { fontSize: 11, color: colors.text3 },
  reset: { minHeight: 32, justifyContent: 'center' },
  coverBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 6, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  coverBadgeText: { fontSize: 11, color: '#fff' },
  coverChoice: { width: 60, height: 60, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', marginRight: 8 },
  link: { color: colors.accent, fontSize: 13 },
  save: { backgroundColor: colors.accent, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '600' },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: 13 },
});
