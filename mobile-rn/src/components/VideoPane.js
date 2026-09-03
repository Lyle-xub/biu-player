/* Biu Player RN · 可复用视频面板（PlayerScreen 内嵌 / VideoScreen 路由共用）
 * useVideoSource(track, enabled)：按曲目懒取 progressive mp4 流地址（bili.videoUrl），
 *   enabled=false 时不请求；换曲目自动重置。
 * VideoPane({player, buffering, error})：16:9 圆角黑底 VideoView + loading / error 遮罩。
 *   不持有 player——由调用方 useVideoPlayer 创建，便于绑定自绘控制。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { VideoView } from 'expo-video';
import { colors } from '../theme';
import * as bili from '../api/bili';

export function useVideoSource(track, enabled) {
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const bvid = track && track.bvid;

  // 换曲目重置
  useEffect(() => {
    setSource(null);
    setError(null);
  }, [bvid]);

  useEffect(() => {
    if (!enabled || !bvid || source || error) return;
    let cancelled = false;
    (async () => {
      try {
        let cid = track.cid;
        if (!cid) {
          const v = await bili.view(bvid);
          cid = v && v.cid;
        }
        if (!cid) throw new Error('无法获取视频分 P 信息');
        const url = await bili.videoUrl(bvid, cid);
        if (!cancelled) setSource(url);
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, bvid, source, error]); // eslint-disable-line react-hooks/exhaustive-deps

  return { source, error };
}

export default function VideoPane({ player, buffering, error, style }) {
  return (
    <View style={[styles.videoWrap, style]}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
      />
      {buffering && !error ? (
        <View style={styles.videoOverlay}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}
      {error ? (
        <View style={styles.videoOverlay}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>（原视频流需要登录才有高清晰度）</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  videoWrap: {
    aspectRatio: 16 / 9, borderRadius: 14, overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  video: { flex: 1 },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  errorHint: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
});
