import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { appUpdates, useAppUpdates } from '../updates/service';

function UpdateAction({ state }) {
  const busy = state.phase === 'checking' || state.phase === 'downloading';
  const label = state.phase === 'ready' ? '安装更新' : state.phase === 'available' ? (Platform.OS === 'ios' ? '前往更新' : '下载更新') : busy ? '请稍候' : '检查更新';
  const action = state.phase === 'ready' ? appUpdates.install : state.phase === 'available' ? appUpdates.download : appUpdates.check;
  return <TouchableOpacity accessibilityRole="button" disabled={busy || !state.loaded || !state.supported}
    onPress={action} style={[styles.button, (busy || !state.supported) && { opacity: 0.5 }]}>
    <Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>;
}
export default function AppUpdateCard() {
  const state = useAppUpdates();
  return <View style={styles.card}>
    <View style={styles.row}><Text style={styles.title}>应用更新</Text><Text style={styles.desc}>v{state.currentVersion}</Text></View>
    {['enabled', ...(Platform.OS === 'ios' ? [] : ['autoDownload'])].map(key => <View style={styles.row} key={key}>
      <Text style={styles.label}>{key === 'enabled' ? '自动检测更新' : 'Wi-Fi 下自动下载'}</Text>
      <Switch accessibilityLabel={key === 'enabled' ? '自动检测更新' : 'Wi-Fi 下自动下载'} value={state[key]}
        disabled={!state.loaded || !state.supported} onValueChange={value => appUpdates.configure({ [key]: value })}
        thumbColor={state[key] ? colors.accent : colors.text2} trackColor={{ false: colors.cardBorder, true: colors.accentSoft }} />
    </View>)}
    <Text accessibilityLiveRegion="polite" style={styles.desc}>{!state.supported ? '开发预览不安装更新，请使用正式安装包' : state.message || '启动和返回应用时自动检测，不打断播放'}</Text>
    {state.phase === 'downloading' && <View style={styles.track}><View style={[styles.progress, { width: `${Math.max(0, Math.min(100, state.progress || 0))}%` }]} /></View>}
    <View style={styles.actions}>
      {!!state.checkedAt && <Text style={styles.desc}>上次检查 {new Date(state.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>}
      {state.phase === 'downloading' && <Text style={styles.desc}>{Math.round(state.progress || 0)}%</Text>}
      <UpdateAction state={state} />
    </View>
  </View>;
}
export function AppUpdateNotice() {
  const state = useAppUpdates();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState('');
  useEffect(() => { void appUpdates.start(); }, []);
  const key = `${state.version}:${state.phase === 'ready' ? 'ready' : 'available'}`;
  if (!['available', 'ready'].includes(state.phase) || !state.supported || dismissed === key) return null;
  return <View style={[styles.notice, { top: insets.top + 12 }]}>
    <View style={styles.row}><Text style={styles.title}>Biu Player {state.version}</Text>
      <TouchableOpacity accessibilityLabel="稍后更新" onPress={() => setDismissed(key)} hitSlop={10}><Text style={styles.desc}>稍后</Text></TouchableOpacity></View>
    <Text style={styles.desc}>{state.message}</Text>
    <View style={styles.actions}><UpdateAction state={state} /></View>
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 14, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  label: { color: colors.text2, fontSize: 13, flex: 1 },
  desc: { color: colors.text3, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 },
  button: { backgroundColor: colors.accentSoft, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  track: { height: 3, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.cardBorder },
  progress: { height: 3, backgroundColor: colors.accent },
  notice: { position: 'absolute', left: 18, right: 18, zIndex: 120, elevation: 24, borderRadius: 20,
    borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.bgSoft, padding: 18, gap: 12 },
});
