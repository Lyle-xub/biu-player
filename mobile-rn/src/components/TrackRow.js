/* Biu Player RN · 列表行（搜索结果 / 喜欢 / 历史）：方形小封面 + 标题 + UP 主 + 时长 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fmtDur } from '../theme';
import { IconNote } from './icons';
import RemoteImage from './RemoteImage';
import { TrackTitle, TrackArtist } from './TrackAttribution';
import { useTrackSource } from '../player/trackSource';

export default function TrackRow({ track: originalTrack, onPress, onPressUp, onLongPress, active = false }) {
  const track = useTrackSource(originalTrack);
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={onPress} onLongPress={onLongPress} delayLongPress={380}>
      <RemoteImage uri={track.pic} width={180} height={180} style={styles.cover}
        fallback={<View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
          <IconNote size={18} color={colors.accent} />
        </View>} />
      <View style={styles.body}>
        <TrackTitle track={track} style={[styles.title, active && { color: colors.accent }]} />
        <View style={styles.upRow}><TrackArtist track={track} onPressUp={onPressUp} style={styles.up} /></View>
      </View>
      <Text style={styles.dur}>{fmtDur(track.duration)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  cover: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#1a1e14' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: '500' },
  upRow: { marginTop: 3 },
  up: { color: colors.text2, fontSize: 11 },
  dur: { color: colors.text3, fontSize: 11, fontVariant: ['tabular-nums'] },
});
