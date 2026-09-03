/* Biu Player RN · 视频页：原视频播放（Apple 风格：模糊封面背景 + 顶部 16:9 圆角视频）
 * 视频区与控制复用 src/components/VideoPane.js（useVideoSource 取流 + VideoPane 展示）；
 * 取流走 bili.videoUrl（platform=html5 的 progressive mp4 整文件流，含音轨）；
 * 与 PlayerContext 音频互斥：进入即 pauseAll()。
 */
import React, { useEffect, useRef } from 'react';
import {
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { colors, fmtDur } from '../theme';
import { imageHeaders, streamHeaders } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import VideoPane, { useVideoSource } from '../components/VideoPane';
import { IconBack, IconPause, IconPlay } from '../components/icons';

export default function VideoScreen({ route, navigation }) {
  const track = (route.params && route.params.track) || {};
  const { pauseAll } = usePlayer();

  const { source, error } = useVideoSource(track, true);

  const player = useVideoPlayer(null, (p) => { p.timeUpdateEventInterval = 0.5; });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime || 0,
  });

  const barWidth = useRef(1);

  // 进入即暂停全局音频（双 player 互斥），离开停视频
  useEffect(() => {
    pauseAll();
    return () => { player.pause(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 流就绪后装载并播放
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    player.replaceAsync({ uri: source, headers: streamHeaders() })
      .then(() => { if (!cancelled) player.play(); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [source, player]);

  const duration = player.duration || track.duration || 0;
  const position = currentTime || 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const buffering = status === 'loading' || !source;

  const seekAt = (evt) => {
    if (!duration) return;
    player.currentTime = (evt.nativeEvent.locationX / barWidth.current) * duration;
  };

  return (
    <View style={styles.root}>
      {track.pic ? (
        <ExpoImage
          source={{ uri: track.pic, headers: imageHeaders() }}
          style={StyleSheet.absoluteFill}
          blurRadius={50}
          contentFit="cover"
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,7,5,0.62)' }]} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
            <IconBack size={22} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>视频</Text>
          <View style={{ width: 22 }} />
        </View>

        <VideoPane
          player={player}
          buffering={buffering}
          error={error}
          style={styles.pane}
        />

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
          <Text style={styles.up} numberOfLines={1}>{track.up}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.playBtn}
            onPress={() => (isPlaying ? player.pause() : player.play())}
            activeOpacity={0.85}
          >
            {isPlaying ? <IconPause size={26} color="#fff" /> : <IconPlay size={26} color="#fff" />}
          </TouchableOpacity>
          <View
            style={styles.progressZone}
            onLayout={(e) => { barWidth.current = e.nativeEvent.layout.width; }}
            onStartShouldSetResponder={() => true}
            onResponderGrant={seekAt}
            onResponderMove={seekAt}
          >
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <View style={[styles.progressThumb, { left: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.time}>{fmtDur(position)} / {fmtDur(duration)}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  headerTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, letterSpacing: 2 },
  pane: { marginHorizontal: 16, marginTop: 12 },
  meta: { paddingHorizontal: 20, marginTop: 16 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 24 },
  up: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 5 },
  controls: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, marginTop: 18,
  },
  playBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  progressZone: { flex: 1, paddingVertical: 12, justifyContent: 'center' },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  progressThumb: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#fff', marginLeft: -5,
  },
  time: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontVariant: ['tabular-nums'] },
});
