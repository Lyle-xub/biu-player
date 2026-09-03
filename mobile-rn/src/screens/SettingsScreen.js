/* Biu Player RN · 设置：只收 RN 端真实生效的项（桌面端的弹幕/背景模糊/桌面歌词等
 * RN 没有对应实现，不做摆设按钮）。
 * 在线音质：数据源 PlayerContext quality/setQuality（AsyncStorage biu.quality 持久化），
 * 作用于切歌后的取流档位（标准 = qn 32 省流，高品 = 默认最高可用档）。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { IconBack } from '../components/icons';
import LanSyncCard from '../components/LanSyncCard';

const QUALITIES = [
  { q: 0, label: '标准', desc: '480P 档整文件流，省流量' },
  { q: 1, label: '高品', desc: '默认最高可用档，登录后可达 1080P' },
];
const LYRIC_EFFECTS = [
  { key: 'simple', label: '简单', desc: '默认效果：当前行放大，随进度从左向右变白，保留前后行模糊。' },
  { key: 'monet', label: '莫奈光效', desc: '柔边光带沿字形移动，保留柔光与景深，适合性能较好的设备。' },
];
const RECOMMEND_MODES = [
  { key: 'music', label: '音乐分区推荐', desc: '从真实个性推荐中只保留音乐区内容，默认使用此模式。' },
  { key: 'all', label: '全部推荐', desc: '显示账号完整的个性推荐，不限制内容分区。' },
];

export default function SettingsScreen({ navigation }) {
  const {
    quality, setQuality, lyricEffect, setLyricEffect, recommendMode, setRecommendMode,
  } = usePlayer();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>设置</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>首页</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>个性推荐范围</Text>
          <Text style={styles.rowDesc}>切换后首页自动刷新</Text>
          <View style={styles.seg}>
            {RECOMMEND_MODES.map(({ key, label }) => (
              <TouchableOpacity key={key} accessibilityRole="radio" accessibilityLabel={label}
                accessibilityState={{ checked: recommendMode === key }}
                style={[styles.segBtn, recommendMode === key && styles.segBtnOn]}
                onPress={() => setRecommendMode(key)}>
                <Text style={[styles.segText, recommendMode === key && styles.segTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.qualityDesc}>
            {(RECOMMEND_MODES.find((item) => item.key === recommendMode) || RECOMMEND_MODES[0]).desc}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>播放</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>在线音质</Text>
          <Text style={styles.rowDesc}>对下一首起生效</Text>
          <View style={styles.seg}>
            {QUALITIES.map(({ q, label }) => (
              <TouchableOpacity
                key={q}
                style={[styles.segBtn, quality === q && styles.segBtnOn]}
                onPress={() => setQuality(q)}
              >
                <Text style={[styles.segText, quality === q && styles.segTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.qualityDesc}>
            {(QUALITIES.find((x) => x.q === quality) || QUALITIES[1]).desc}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>歌词</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>歌词动效</Text>
          <Text style={styles.rowDesc}>立即生效，自动保存</Text>
          <View style={styles.seg}>
            {LYRIC_EFFECTS.map(({ key, label }) => (
              <TouchableOpacity key={key} accessibilityRole="radio" accessibilityLabel={label}
                accessibilityState={{ checked: lyricEffect === key }}
                style={[styles.segBtn, lyricEffect === key && styles.segBtnOn]}
                onPress={() => setLyricEffect(key)}>
                <Text style={[styles.segText, lyricEffect === key && styles.segTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.qualityDesc}>
            {(LYRIC_EFFECTS.find((x) => x.key === lyricEffect) || LYRIC_EFFECTS[0]).desc}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>同步</Text>
        <LanSyncCard />

        <Text style={styles.sectionTitle}>关于</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.rowTitle}>Biu Player RN</Text>
            <Text style={styles.aboutValue}>Expo SDK 57</Text>
          </View>
          <Text style={styles.rowDesc}>B 站音乐播放器 · 与桌面端共享同一套接口逻辑</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  backBtn: { padding: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  content: { paddingBottom: 130 },
  sectionTitle: {
    color: colors.text3, fontSize: 12, letterSpacing: 1,
    paddingHorizontal: 18, marginTop: 14, marginBottom: 8,
  },
  card: {
    marginHorizontal: 14, marginBottom: 6, padding: 16,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 16,
  },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  rowDesc: { color: colors.text3, fontSize: 11, marginTop: 4 },
  seg: {
    flexDirection: 'row', gap: 6, marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4,
  },
  segBtn: {
    flex: 1, height: 34, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  segBtnOn: { backgroundColor: colors.accentSoft },
  segText: { color: colors.text2, fontSize: 13 },
  segTextOn: { color: colors.accent, fontWeight: '600' },
  qualityDesc: { color: colors.text3, fontSize: 11, marginTop: 10 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aboutValue: { color: colors.text3, fontSize: 12 },
});
