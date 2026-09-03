/* Biu Player RN · 迷你播放条：悬浮在底部 tab 栏上方，有 current 才显示 */
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme';
import { imageHeaders } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import { IconNext, IconPause, IconPlay } from './icons';

export default function MiniBar() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { current, isLive, playing, buffering, togglePlay, next, position, duration } = usePlayer();
  if (!current) return null;

  const progress = !isLive && duration > 0 ? Math.min(1, position / duration) : 0;
  // 贴底 tab 栏默认高度 49 + 安全区
  const bottom = 49 + insets.bottom + 8;

  return (
    <TouchableOpacity
      style={[styles.bar, { bottom }]}
      activeOpacity={0.9}
      onPress={() => navigation.navigate('Player')}
    >
      {current.pic ? (
        <Image source={{ uri: current.pic, headers: imageHeaders() }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]} />
      )}
      <View style={styles.info}>
        <View style={styles.titleRow}>
          {isLive ? (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
        </View>
        <Text style={styles.up} numberOfLines={1}>{current.up}</Text>
      </View>
      <TouchableOpacity style={styles.ctrlBtn} onPress={togglePlay} hitSlop={8}>
        {playing ? <IconPause size={18} color="#fff" /> : <IconPlay size={18} color="#fff" />}
      </TouchableOpacity>
      <TouchableOpacity style={styles.ctrlBtn} onPress={next} hitSlop={8}>
        <IconNext size={18} color="rgba(255,255,255,0.85)" />
      </TouchableOpacity>
      {isLive ? null : (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 10, right: 10, height: 58,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(23,26,18,0.92)',
    borderRadius: 18,
    borderWidth: 1, borderColor: colors.cardBorder,
    paddingHorizontal: 9,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  cover: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1e14' },
  coverFallback: { borderWidth: 1, borderColor: colors.cardBorder },
  info: { flex: 1, minWidth: 0, marginLeft: 10, marginRight: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveBadge: {
    backgroundColor: colors.accent, borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  liveBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 13, fontWeight: '500', flexShrink: 1 },
  up: { color: colors.text2, fontSize: 10, marginTop: 2 },
  ctrlBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute', left: 14, right: 14, bottom: 4, height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden',
  },
  progressFill: { height: 2, backgroundColor: colors.accent },
});
