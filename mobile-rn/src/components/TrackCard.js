/* Biu Player RN · 瀑布流卡片：封面 + 标题 + UP 主 + 播放量/时长；按下 scale 0.97 反馈 */
import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import { fmtCount, fmtDur } from '../theme';
import { IconNote } from './icons';
import RemoteImage from './RemoteImage';

export default function TrackCard({ track, onPress, onPressUp }) {
  const play = track.stat && track.stat.view;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View>
        <RemoteImage uri={track.pic} width={720} height={450} style={styles.cover}
          fallback={<View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
            <IconNote size={28} color={colors.accent} />
          </View>} />
        <View style={styles.durPill}>
          <Text style={styles.durText}>{fmtDur(track.duration)}</Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
      <View style={styles.metaRow}>
        {onPressUp && track.up ? (
          <TouchableOpacity onPress={onPressUp} hitSlop={6} style={{ flexShrink: 1 }}>
            <Text style={[styles.up, styles.upLink]} numberOfLines={1}>{track.up}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.up} numberOfLines={1}>{track.up}</Text>
        )}
        {play ? <Text style={styles.count}>{fmtCount(play)}播放</Text> : null}
      </View>
      {track.recommendationReason ? (
        <Text style={styles.reason} numberOfLines={1}>{track.recommendationReason}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  cover: { width: '100%', aspectRatio: 16 / 10, backgroundColor: '#1a1e14' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  durPill: {
    position: 'absolute', right: 8, bottom: 8,
    backgroundColor: 'rgba(9,11,7,0.72)',
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
  },
  durText: { color: colors.text, fontSize: 10, fontVariant: ['tabular-nums'] },
  title: {
    color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '500',
    marginHorizontal: 10, marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 10, marginTop: 4, marginBottom: 10, gap: 6,
  },
  up: { color: colors.text2, fontSize: 11, flexShrink: 1 },
  upLink: { color: colors.accent },
  count: { color: colors.text3, fontSize: 10 },
  reason: { color: colors.accent, fontSize: 10, marginHorizontal: 10, marginBottom: 8, marginTop: -4 },
});
