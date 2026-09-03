/* Biu Player RN · 列表行（搜索结果 / 喜欢 / 历史）：方形小封面 + 标题 + UP 主 + 时长 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fmtDur } from '../theme';
import { imageHeaders } from '../api/client';
import { IconNote } from './icons';

export default function TrackRow({ track, onPress, onPressUp, active = false }) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={onPress}>
      {track.pic ? (
        <Image source={{ uri: track.pic, headers: imageHeaders() }} style={styles.cover} resizeMode="cover" />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <IconNote size={18} color={colors.accent} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={[styles.title, active && { color: colors.accent }]} numberOfLines={1}>
          {track.title}
        </Text>
        {onPressUp && track.up ? (
          <TouchableOpacity onPress={onPressUp} hitSlop={6}>
            <Text style={[styles.up, styles.upLink]} numberOfLines={1}>{track.up}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.up} numberOfLines={1}>{track.up}</Text>
        )}
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
  up: { color: colors.text2, fontSize: 11, marginTop: 3 },
  upLink: { color: colors.accent },
  dur: { color: colors.text3, fontSize: 11, fontVariant: ['tabular-nums'] },
});
