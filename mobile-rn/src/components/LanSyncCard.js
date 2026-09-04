import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useLanSync } from '../store/LanSyncProvider';
import { colors } from '../theme';

export default function LanSyncCard() {
  const sync = useLanSync();
  return <View style={styles.card}>
    <View style={styles.row}>
      <Text style={styles.title}>局域网自动同步</Text>
      <Switch accessibilityLabel="局域网自动同步" value={sync.enabled}
        disabled={!sync.ready || sync.saving} onValueChange={sync.setEnabled}
        thumbColor={sync.enabled ? colors.accent : colors.text2}
        trackColor={{ false: colors.cardBorder, true: colors.accentSoft }}
        ios_backgroundColor={colors.bgSoft} />
    </View>
    <Text style={styles.desc}>默认开启。在同一 Wi-Fi 打开两端，登录相同账号后自动同步我喜欢、自建歌单、推荐画像及云同步密钥，无需输入地址。</Text>
    <Text accessibilityLiveRegion="polite" style={styles.desc}>{sync.message}</Text>
    {!!sync.cloudKeyMessage&&<Text accessibilityLiveRegion="polite" style={styles.desc}>{sync.cloudKeyMessage}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 14, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  desc: { color: colors.text3, fontSize: 12, lineHeight: 19, marginTop: 8 },
});
