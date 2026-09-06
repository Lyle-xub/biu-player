/* Biu Player RN · 历史记录：最近播放独立页（数据源 = PlayerContext history /
 * AsyncStorage biu.history），TrackRow 复用，点行整列表入队播放。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import { trackKeyOf } from '../player/track';
import TrackRow from '../components/TrackRow';
import { IconBack, IconClock } from '../components/icons';

export default function HistoryScreen({ navigation }) {
  const { history, playQueue, current, resolveTrackUp } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>最近播放</Text>
        <Text style={styles.count}>{history.length ? `${history.length} 首` : ''}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {history.length ? (
          history.map((t, i) => (
            <TrackRow
              key={trackKeyOf(t) || i}
              track={t}
              active={trackKeyOf(current) === trackKeyOf(t)}
              onPress={() => playQueue(history, i)}
              onPressUp={canOpenTrackUp(t) ? () => openUp(t) : undefined}
            />
          ))
        ) : (
          <View style={styles.emptyBox}>
            <IconClock size={30} color={colors.text3} />
            <Text style={styles.empty}>还没有播放记录{'\n'}随便点一首歌就会出现在这里</Text>
          </View>
        )}
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
  count: { color: colors.text3, fontSize: 12, paddingRight: 8 },
  content: { paddingBottom: 130 },
  emptyBox: { alignItems: 'center', marginTop: 96, gap: 14 },
  empty: { color: colors.text3, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
