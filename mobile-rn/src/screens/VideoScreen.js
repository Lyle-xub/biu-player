/* Biu Player RN · 视频页：原视频播放（Apple 风格：模糊封面背景 + 顶部 16:9 圆角视频）
 * 单 player 架构：直接显示 PlayerContext 的唯一 expo-video player（与播放页同一个，
 * 画面/声音/进度连续，进入不暂停不重载）；控制复用 context 的 playing/position/togglePlay。
 */
import React, { useRef } from 'react';
import {
  Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import useMediaTransition from '../player/useMediaTransition';
import VideoActionBar from '../components/VideoActionBar';
import { colors, fmtDur } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import VideoPane from '../components/VideoPane';
import RemoteImage from '../components/RemoteImage';
import { IconBack, IconPause, IconPlay } from '../components/icons';

export default function VideoScreen({ route, navigation }) {
  const transition = useMediaTransition(navigation);
  const focused = useIsFocused();
  const routeTrack = (route.params && route.params.track) || {};
  const {
    current, playing, buffering, position, duration, playError, togglePlay, seekTo, player,
  } = usePlayer();
  // 路由参数里的 track 可能与当前曲目错位（切过歌）：画面跟随 current，元信息优先 current
  const track = current || routeTrack;

  const barWidth = useRef(1);

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const seekAt = (evt) => {
    if (!duration) return;
    seekTo((evt.nativeEvent.locationX / barWidth.current) * duration);
  };

  return (
    <Animated.View style={[styles.viewport, transition.viewportStyle]} onLayout={transition.onLayout}>
      <Animated.View style={[styles.root, transition.style]}>
        <RemoteImage uri={track.pic} width={720} height={1280}
          style={StyleSheet.absoluteFill} blurRadius={50} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,7,5,0.62)' }]} />

        <View style={[styles.safe, transition.safeStyle]}>
          <View style={styles.header} {...transition.panHandlers}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
              <IconBack size={22} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>视频</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
            <VideoPane
              visible={focused}
              player={player}
              buffering={buffering}
              error={playError}
              cover={track.pic}
              style={styles.pane}
            />

            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
              <Text style={styles.up} numberOfLines={1}>{track.up}</Text>
            </View>

            <View style={{ paddingHorizontal: 16 }}>
              <VideoActionBar track={track} onShowLyrics={() => navigation.popTo('Player', { showLyrics: true })} />
            </View>
            <View style={styles.controls}>
              <TouchableOpacity
                style={styles.playBtn}
                onPress={togglePlay}
                activeOpacity={0.85}
              >
                {playing ? <IconPause size={26} color="#fff" /> : <IconPlay size={26} color="#fff" />}
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
          </ScrollView>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
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
