/* Biu Player RN · 可复用视频面板（PlayerScreen 内嵌 / VideoScreen 路由共用）
 * 固定 16:9 完整显示画面；封面图的模糊副本形成同色系边框与柔光。
 * 不持有 player——单 player 架构下 player 来自 PlayerContext，两个屏只是显示同一画面。
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { VideoView } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { colors } from '../theme';
import { imageHeaders } from '../api/client';
import { optimizedImageUri } from './RemoteImage';

export default function VideoPane({ player, buffering, error, cover, style, visible = true, isLive = false, children }) {
  return (
    <View style={[styles.videoWrap, style]}>
      {cover ? <ExpoImage pointerEvents="none" source={{ uri: optimizedImageUri(cover, 1280, 720), headers: imageHeaders() }}
        style={styles.coverGlow} contentFit="cover" blurRadius={28} /> : null}
      <View style={styles.frame}>
        {cover ? <ExpoImage pointerEvents="none" source={{ uri: optimizedImageUri(cover, 1280, 720), headers: imageHeaders() }}
          style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={18} /> : null}
        <View style={styles.surface}>
          {visible ? <VideoView
            player={player}
            surfaceType="textureView"
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            useExoShutter
          /> : null}
          {children}
          {buffering && !error ? (
            <View style={styles.videoOverlay}>
              <ActivityIndicator color={colors.accent} size="large" />
            </View>
          ) : null}
          {error ? (
            <View style={styles.videoOverlay}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorHint}>{isLive ? '直播可能已结束或连接中断，点播放键重试' : '（原视频流需要登录才有高清晰度；点播放键可重试）'}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  videoWrap: {
    aspectRatio: 16 / 9, borderRadius: 16, alignSelf: 'stretch',
  },
  coverGlow: {
    position: 'absolute', left: -8, right: -8, top: -8, bottom: -8,
    borderRadius: 24, opacity: 0.42,
  },
  frame: {
    ...StyleSheet.absoluteFill, borderRadius: 16, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  surface: {
    position: 'absolute', top: 2, right: 2, bottom: 2, left: 2,
    borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#080908',
  },
  video: { ...StyleSheet.absoluteFill, borderRadius: 14 },
  videoOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  errorHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
});
