import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { usePlayer } from '../player/PlayerContext';
import { activeProfile, parseTagsText, tagsText } from '../../../renderer/recommendation-profile';
import { colors } from '../theme';
import ProfilePortrait from './ProfilePortrait';

function StatusDot() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const timing = (toValue) => Animated.timing(opacity, { toValue, duration: 2200,
      easing: Easing.bezier(0.42, 0, 0.58, 1), useNativeDriver: true, isInteraction: false });
    const animation = Animated.loop(Animated.sequence([timing(1), timing(0.35)]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View pointerEvents="none" accessible={false} style={[styles.statusDot, { opacity }]} />;
}

export default function RecommendationProfileCard() {
  const { recommendationManager: manager, recommendationProfile: state, libraryReady, account } = usePlayer();
  const scope = account?.isLogin ? String(account.mid) : '';
  return manager && state ? <Editor key={scope} manager={manager} state={state} ready={libraryReady} /> : null;
}
function Editor({ manager, state, ready }) {
  const [flipped, setFlipped] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ignoredText, setIgnoredText] = useState('');
  const profile = activeProfile(state);
  const disabled = !ready || !state.ready || saving || state.busy;
  const run = async (action) => {
    setSaving(true); setError('');
    try { await action(); setDraft(null); setConfirmDelete(false); }
    catch (e) { setError(e.message || '保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const button = (label, onPress, selected = false, leading = null) => <TouchableOpacity key={label} disabled={disabled && label !== '重新读取画像'}
    accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={[styles.button, selected && styles.selected, disabled && { opacity: 0.45 }]}>
    {leading}<Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>;
  return <View style={styles.card}>
<View style={styles.headingRow}><Text style={styles.heading}>我的推荐画像</Text><Text style={styles.archive}>PERSONAL ARCHIVE</Text></View>
    {button(state.enabled ? '画像推荐已开启' : '画像推荐已关闭', () => run(() => manager.edit({ type: 'enable', enabled: !state.enabled })), state.enabled, state.enabled ? <StatusDot /> : null)}
    <ProfilePortrait profile={profile} ready={ready && state.ready} flipped={flipped} onFlip={() => setFlipped((value) => !value)} />
    {!!(error || state.error) && <Text style={styles.error}>{error || state.error}</Text>}
    {flipped && <View style={styles.details}>
    <Text style={styles.hint}>持续累积喜欢、自建歌单与有效收听。推荐信息流只进入候选库；长期兴趣与最近 14 天行为共同影响选曲。</Text>
    <View style={styles.wrap}>
      {[state.auto, ...state.profiles].map((p) => <React.Fragment key={p.id}>{button(p.name + (state.activeId === p.id ? ' · 使用中' : ''),
        () => run(() => manager.edit({ type: 'select', id: p.id })), state.activeId === p.id)}</React.Fragment>)}
    </View>
    <Text style={styles.hint}>{profile.id === 'auto' ? `累计分析 ${state.auto.samples} 个视频${state.auto.pending ? ` · ${state.auto.pending} 个待分析` : ''} · 喜欢 ${state.auto.sources?.likes || 0} / 歌单 ${state.auto.sources?.playlists || 0} / 信息流 ${state.auto.sources?.feed || 0}`
      : '自定义画像 · 仅推荐标题或标签匹配的视频，不混入其他推荐；多个标签匹配任意一个，权重影响排序'}{!state.enabled ? ' · 当前未用于首页推荐' : ''}</Text>
    {state.busy && <ActivityIndicator color={colors.accent} />}
    <Text style={styles.heading}>画像忽略标签</Text>
    <Text style={styles.hint}>已自动过滤音乐推荐、音乐分享官、征集令等平台标签。歌单、合集、MV 等只识别为内容形式，不参与音乐兴趣。</Text>
    <View style={styles.wrap}>{profile.tags.map((tag) => button(`忽略 ${tag.name}`, () => run(() => manager.dailyAction({ type: 'ignored', name: tag.name }))))}</View>
    <TextInput accessibilityLabel="添加忽略标签" value={ignoredText} onChangeText={setIgnoredText} maxLength={40}
      placeholder="输入不想参与画像的标签" placeholderTextColor={colors.text3} style={styles.input} />
    {button('添加忽略', () => run(async () => { await manager.dailyAction({ type: 'ignored', name: ignoredText }); setIgnoredText(''); }))}
    <View style={styles.wrap}>{['ignored', 'muted', 'blocked'].flatMap((type) => (state.daily?.[type] || []).filter((v) => v.active)
      .map((v) => button(`恢复${type === 'blocked' ? '视频' : type === 'muted' ? '权重' : '标签'} ${v.name}`, () => run(() => manager.dailyAction({ type, name: v.name, active: false })))))}</View>
    <Text style={styles.hint}>画像立即重算；当天每日推荐保持稳定，可在每日推荐中重新生成。</Text>
    {!state.ready && state.error ? button('重新读取画像', () => run(() => manager.ready())) : null}
    <View style={styles.wrap}>
      {button('更新近期画像', () => run(() => manager.refresh(true)))}
      {button('新建画像', () => { setDraft({ name: '', text: '' }); setConfirmDelete(false); })}
      {button(profile.id === 'auto' ? '编辑并另存' : '编辑画像', () => {
        setDraft({ id: profile.id === 'auto' ? undefined : profile.id, name: profile.id === 'auto' ? '我的兴趣' : profile.name, text: tagsText(profile.tags) });
        setConfirmDelete(false);
      })}
      {profile.id !== 'auto' && button('删除画像', () => setConfirmDelete(true))}
    </View>
    {confirmDelete && <View style={styles.wrap}>
      <Text style={styles.hint}>删除「{profile.name}」？</Text>
      {button('确认删除', () => run(() => manager.edit({ type: 'delete', id: profile.id })))}
      {button('保留画像', () => setConfirmDelete(false))}
    </View>}
    {draft && <View style={styles.form}>
      <TextInput accessibilityLabel="画像名称" placeholder="画像名称" placeholderTextColor={colors.text3}
        maxLength={40} value={draft.name} style={styles.input} onChangeText={(name) => setDraft({ ...draft, name })} />
      <Text style={styles.hint}>每行一个标签，可写「古典:80」。权重为 1–100，不填默认 50，最多 30 个。</Text>
      <TextInput accessibilityLabel="画像标签与权重" multiline textAlignVertical="top" placeholder={'古典:80\n钢琴:60'}
        placeholderTextColor={colors.text3} value={draft.text} style={[styles.input, { minHeight: 120 }]} onChangeText={(text) => setDraft({ ...draft, text })} />
      <View style={styles.wrap}>
        {button('保存并使用', () => run(() => manager.edit({ type: 'save', id: draft.id, name: draft.name, tags: parseTagsText(draft.text) })))}
        {draft.id && button('另存为新画像', () => run(() => manager.edit({ type: 'save', name: draft.name + ' 副本', tags: parseTagsText(draft.text) })))}
        {button('取消编辑', () => setDraft(null))}
      </View>
    </View>}
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 14, marginVertical: 8, padding: 16, gap: 12, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  archive: { fontSize: 8, letterSpacing: 1, color: colors.text3 },
  details: { gap: 12, borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 16 },
  heading: { color: colors.text, fontWeight: '600', fontSize: 14 },
  hint: { color: colors.text3, fontSize: 12, lineHeight: 18 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent,
    boxShadow: `0 0 8px ${colors.accent}` },
  selected: { backgroundColor: colors.accentSoft }, buttonText: { color: colors.accent, fontSize: 12 },
  error: { color: colors.danger, fontSize: 12 },
  form: { gap: 10 }, input: { color: colors.text, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 10, padding: 12 },
});
