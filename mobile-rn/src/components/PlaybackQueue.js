import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PLAY_MODES, usePlayer } from '../player/PlayerContext';
import { trackKeyOf } from '../player/track';
import { colors } from '../theme';
import { IconRepeat, IconShuffle } from './icons';

const MODE_LABELS = { loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };

// Both player entries render this content inside the shared, inset-aware BottomSheet.
export default function PlaybackQueue({ onClose }) {
  const { queue, index, playIndex, playMode, setPlayMode } = usePlayer();
  const nextMode = PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length];

  return <>
    <View style={styles.header}>
      <Text style={styles.title}>播放列表（{queue.length}）</Text>
      <TouchableOpacity style={styles.mode} activeOpacity={0.7}
        accessibilityRole="button" accessibilityLabel={`播放模式：${MODE_LABELS[playMode]}`}
        accessibilityHint={`点击切换为${MODE_LABELS[nextMode]}，循环模式不影响直播`}
        onPress={() => setPlayMode(nextMode)}>
        {playMode === 'shuffle' ? <IconShuffle size={18} color={colors.accent} />
          : <IconRepeat size={18} color={colors.accent} single={playMode === 'single'} />}
        <Text style={styles.modeText}>{MODE_LABELS[playMode]}</Text>
      </TouchableOpacity>
    </View>
    <FlatList style={styles.list} data={queue} showsVerticalScrollIndicator={false}
      keyExtractor={(item, i) => `${trackKeyOf(item)}-${i}`}
      renderItem={({ item, index: i }) => (
        <TouchableOpacity style={[styles.row, i === index && styles.selected]}
          accessibilityRole="button" accessibilityLabel={`播放 ${item.title}`}
          accessibilityState={{ selected: i === index }}
          onPress={() => { playIndex(queue, i); onClose(); }}>
          <Text style={[styles.number, i === index && styles.active]}>{i + 1}</Text>
          <View style={styles.info}>
            <Text style={[styles.name, i === index && styles.active]} numberOfLines={1}>{item.title}</Text>
            {!!item.up && <Text style={styles.up} numberOfLines={1}>{item.up}</Text>}
          </View>
          {item.isLive && <Text style={styles.live}>LIVE</Text>}
        </TouchableOpacity>
      )}
      ListEmptyComponent={<Text style={styles.empty}>播放列表为空</Text>}
    />
  </>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingHorizontal: 8, paddingBottom: 8, gap: 8 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flexGrow: 1 },
  mode: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 7, paddingHorizontal: 8, borderRadius: 12 },
  modeText: { color: colors.accent, fontSize: 12 },
  list: { flexGrow: 0, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, gap: 10 },
  selected: { backgroundColor: colors.accentSoft },
  number: { width: 28, color: colors.text3, fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14 },
  active: { color: colors.accent },
  up: { color: colors.text3, fontSize: 11, marginTop: 4 },
  live: { color: colors.accent, fontSize: 9, fontWeight: '700' },
  empty: { color: colors.text3, textAlign: 'center', paddingVertical: 28 },
});
