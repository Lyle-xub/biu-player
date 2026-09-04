import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../player/PlayerContext';
import { colors } from '../theme';
import { current as dailyCurrent, dayKey, hash } from '../../../renderer/daily-recommendation';
import DefaultCover from '../components/DefaultCover';
import TrackRow from '../components/TrackRow';
import BottomSheet from '../components/BottomSheet';
import { IconBack, IconPlay, IconPlus, IconRepeat, IconMore } from '../components/icons';
import { createPlaylist } from '../store/playlists';

export function DailyCard({ navigation }) {
  const { recommendationManager: manager, recommendationProfile: state, libraryReady } = usePlayer();
  useEffect(() => {
    if (!libraryReady) return undefined;
    const refresh = () => manager.generateDaily().catch(() => {});
    const timer = setTimeout(refresh, 3000);
    const sub = AppState.addEventListener('change', (status) => { if (status === 'active') refresh(); });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [manager, libraryReady]);
  const daily = state?.daily, entry = daily && dailyCurrent(daily);
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="打开每日推荐" style={styles.card}
    onPress={() => navigation.navigate('Daily')}>
    <Cover profileId={daily?.profileId} small />
    <View style={styles.cardText}><Text style={styles.eyebrow}>DAILY MIX · {dayKey()}</Text><Text style={styles.cardTitle}>每日推荐</Text>
      <Text style={styles.accent}>{state?.dailyBusy ? '正在挑选…' : entry ? `${entry.tracks.length} 首 · 听听今天 ↗` : '开启今天的音乐 ↗'}</Text></View>
  </TouchableOpacity>;
}
function Cover({ profileId = 'auto', small = false }) {
  return <View style={[styles.cover, small && styles.smallCover]}><DefaultCover seed={20 + hash(dayKey() + profileId) % 12} style={StyleSheet.absoluteFill} />
    <Text style={[styles.date, small && { fontSize: 40 }]}>{dayKey().slice(-2)}</Text></View>;
}
export default function DailyScreen({ navigation }) {
  const { recommendationManager: manager, recommendationProfile: state, playQueue, current, libraryReady } = usePlayer();
  const entry = dailyCurrent(state.daily), tracks = entry?.tracks || [];
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(null), [message, setMessage] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { if (libraryReady) manager.generateDaily().catch(() => {}); }, [manager, libraryReady]);
  const run = async (action) => {
    if (saving || !libraryReady) return;
    setSaving(true); setMessage('');
    try { await action(); } catch (e) { setMessage(e.message || '操作失败，请重试'); }
    finally { setSaving(false); }
  };
  const button = (label, action, disabled = false, on = false) => <TouchableOpacity key={label} accessibilityRole="button"
    accessibilityLabel={label} disabled={disabled || saving || !libraryReady} onPress={() => run(action)}
    style={[styles.button, on && styles.on, (disabled || saving || !libraryReady) && { opacity: 0.4 }]}><Text style={styles.accent}>{label}</Text></TouchableOpacity>;
  const feedback = async (type, name) => {
    await manager.dailyAction({ type, name }); setSelected(null);
    setMessage(type === 'blocked' ? '已排除这个视频，可在画像设置中恢复' : '偏好已保存，重新生成或明天生效');
  };
  return <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.back}><IconBack size={22} color={colors.text} /></TouchableOpacity><Text style={styles.title}>每日推荐</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 130 + insets.bottom }}>
      <View style={styles.heading}><Cover profileId={state.daily.profileId} /><View style={styles.cardText}><Text style={styles.eyebrow}>{dayKey().replaceAll('-', ' / ')}</Text><Text style={styles.heroTitle}>今天，听点{ '\n' }喜欢的。</Text>
        <Text style={styles.hint}>熟悉的旋律，也留一点新发现。</Text></View></View>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="播放全部" disabled={!tracks.length || !libraryReady} onPress={() => playQueue(tracks)} style={[styles.playAll, (!tracks.length || !libraryReady) && styles.disabled]}><IconPlay size={18} color={colors.bg} /><Text style={styles.playText}>播放全部</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="保存为歌单" disabled={!tracks.length || saving || !libraryReady} onPress={() => run(async () => { await createPlaylist(`每日推荐 · ${entry.date}`, tracks, { desc: entry.themes.join(' · ') }); setMessage('已保存为本地歌单'); })} style={[styles.saveButton, (!tracks.length || saving || !libraryReady) && styles.disabled]}><IconPlus size={18} color={colors.text} /><Text style={styles.actionText}>存为歌单</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={entry?.error ? '继续获取' : '重新生成'} disabled={state.dailyBusy || saving || !libraryReady} onPress={() => run(() => manager.generateDaily(!entry?.error))} style={[styles.refreshButton, (state.dailyBusy || saving || !libraryReady) && styles.disabled]}><IconRepeat size={19} color={colors.text2} /></TouchableOpacity>
      </View>
      {!!(message || state.dailyError || entry?.error) && <Text accessibilityRole="alert" style={styles.message}>{message || state.dailyError || entry.error}</Text>}
      {state.dailyBusy && <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.hint}>正在分批挑选，下面的歌曲可以先听</Text></View>}
      <View style={styles.listHeading}><Text style={styles.listTitle}>今日歌单</Text><Text style={styles.hint}>{tracks.length} 首歌曲</Text></View>
      {tracks.map((track, i) => <View key={track.bvid} style={styles.trackItem}>
        <View style={styles.track}><View style={{ flex: 1 }}><TrackRow track={track} active={current?.bvid === track.bvid}
          onPress={() => playQueue(tracks, i)} onLongPress={() => setSelected(track)} /></View>
          <TouchableOpacity accessibilityLabel={`查看${track.title}的推荐理由和反馈`} onPress={() => setSelected(track)} style={styles.more}><IconMore size={20} color={colors.text2} /></TouchableOpacity></View>
      </View>)}
      {!tracks.length && !state.dailyBusy && <Text style={styles.message}>暂无匹配内容。可以先喜欢几首音乐，再重新生成。</Text>}
    </ScrollView>
    <BottomSheet visible={!!selected} onClose={() => setSelected(null)}>
      <ScrollView style={{ maxHeight: 420 }}><Text style={styles.sheetTitle}>{selected?.title}</Text><Text style={styles.message}>{selected?.recommendationReason}</Text>
        <View style={styles.wrap}>
          {button('不感兴趣', () => feedback('blocked', selected.bvid))}
          {(selected?.matchedTags || []).flatMap((name) => [button(`减少「${name}」`, () => feedback('muted', name)), button(`忽略标签「${name}」`, () => feedback('ignored', name))])}
        </View><Text style={styles.message}>减少会降低兴趣权重；忽略只移除标签贡献，不屏蔽视频。可在设置的画像中恢复。</Text></ScrollView>
    </BottomSheet>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' }, header: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  back: { padding: 6 }, title: { fontSize: 17, fontWeight: '600', color: colors.text },
  card: { marginHorizontal: 2, marginVertical: 12, padding: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 16 },
  cardText: { flex: 1, gap: 7 }, cardTitle: { fontSize: 22, fontWeight: '600', color: colors.text },
  cover: { width: 120, height: 120, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, smallCover: { width: 88, height: 88 },
  date: { color: '#fff', fontSize: 58, fontWeight: '600', fontVariant: ['tabular-nums'] },
  eyebrow: { color: colors.text3, fontSize: 10, letterSpacing: 0.7 }, hint: { color: colors.text2, fontSize: 12, lineHeight: 18 }, accent: { color: colors.accent, fontSize: 12 },
  heading: { flexDirection: 'row', padding: 20, margin: 14, gap: 18, alignItems: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.accentSoft },
  heroTitle: { color: colors.text, fontSize: 25, lineHeight: 33, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  button: { paddingHorizontal: 13, paddingVertical: 11, borderRadius: 18, backgroundColor: colors.card }, on: { backgroundColor: colors.accentSoft },
  message: { marginHorizontal: 18, marginVertical: 12, color: colors.text2, fontSize: 12, lineHeight: 20 },
  loading: { flexDirection: 'row', gap: 10, margin: 18, alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 18 },
  playAll: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 12, borderRadius: 24, backgroundColor: colors.accent },
  playText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  saveButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 12, borderRadius: 24, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  actionText: { color: colors.text, fontSize: 12 },
  refreshButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.card },
  disabled: { opacity: 0.4 },
  listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 18, marginTop: 6, marginBottom: 10 },
  listTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  trackItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardBorder, marginHorizontal: 4 },
  track: { flexDirection: 'row', alignItems: 'center' }, more: { paddingHorizontal: 18, paddingVertical: 16 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '600', margin: 18 },
});
