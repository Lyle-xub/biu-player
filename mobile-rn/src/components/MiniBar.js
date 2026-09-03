/* Biu Player RN · 迷你播放条：悬浮在底部 tab 栏上方，有 current 才显示 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { IconNext, IconNote, IconPause, IconPlay, IconQueue } from './icons';
import BottomSheet from './BottomSheet';
import PlaybackQueue from './PlaybackQueue';
import RemoteImage from './RemoteImage';

const RING_RADIUS = 23;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function GlassBackground({ blurTarget }) {
  return (
    <View testID="mini-player-glass" pointerEvents="none" style={styles.glassClip}>
      <BlurView
        blurTarget={blurTarget}
        blurMethod="dimezisBlurView"
        intensity={72}
        blurReductionFactor={3}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(11,14,9,0.22)', 'rgba(3,5,2,0.40)']}
        locations={[0, 0.42, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export default function MiniBar({ blurTarget }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { current, isLive, playing, togglePlay, next, position, duration } = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  if (!current) return null;

  const progress = !isLive && Number.isFinite(duration) && duration > 0 && Number.isFinite(position)
    ? Math.max(0, Math.min(1, position / duration)) : 0;
  // 贴底 tab 栏默认高度 49 + 安全区
  const bottom = 49 + insets.bottom + 8;

  return (
    <>
      <View style={[styles.bar, { bottom }]}>
        <GlassBackground blurTarget={blurTarget} />
        <TouchableOpacity style={styles.openPlayer} activeOpacity={0.9}
          accessibilityRole="button" accessibilityLabel={`打开播放页：${current.title}`}
          onPress={() => navigation.navigate('Player')}>
          <View style={styles.coverRing}>
            <RemoteImage uri={current.pic} width={160} height={160} style={styles.cover} cachePolicy="memory-disk"
              fallback={<View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
                <IconNote size={17} color={colors.accent} />
              </View>} />
            {!isLive && <Svg width={50} height={50} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Circle cx={25} cy={25} r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
              <Circle cx={25} cy={25} r={RING_RADIUS} fill="none" stroke={colors.accent} strokeWidth={2}
                strokeLinecap="round" strokeDasharray={[RING_LENGTH, RING_LENGTH]}
                strokeDashoffset={RING_LENGTH * (1 - progress)} opacity={progress > 0 ? 1 : 0}
                rotation={-90} origin="25,25" />
            </Svg>}
          </View>
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
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={togglePlay}
          accessibilityRole="button" accessibilityLabel={playing ? '暂停' : '播放'}>
          {playing ? <IconPause size={18} color="#fff" /> : <IconPlay size={18} color="#fff" />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={next}
          accessibilityRole="button" accessibilityLabel={isLive ? '下一电台' : '下一首'}>
          <IconNext size={18} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={() => setQueueOpen(true)}
          accessibilityRole="button" accessibilityLabel="打开播放列表">
          <IconQueue size={20} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
      </View>
      <BottomSheet visible={queueOpen} onClose={() => setQueueOpen(false)} style={styles.queueSheet}>
        <PlaybackQueue onClose={() => setQueueOpen(false)} />
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 10, right: 10, height: 58,
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 18,
    paddingLeft: 4, paddingRight: 6,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  glassClip: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 58,
    overflow: 'hidden', borderRadius: 18, zIndex: 0,
    backgroundColor: 'rgba(18,21,14,0.34)',
  },
  openPlayer: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', height: '100%', zIndex: 1,
  },
  coverRing: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  cover: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1e14' },
  coverFallback: { borderWidth: 1, borderColor: colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, marginLeft: 8, marginRight: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveBadge: {
    backgroundColor: colors.accent, borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  liveBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 13, fontWeight: '500', flexShrink: 1 },
  up: { color: colors.text2, fontSize: 10, marginTop: 2 },
  ctrlBtn: {
    width: 44, height: 48, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  queueSheet: { maxHeight: '62%' },
});
