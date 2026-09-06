import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { colors } from '../theme';
import RemoteImage from './RemoteImage';
import DefaultCover from './DefaultCover';

export default function ShareCard({ track }) {
  const shot = useRef(null);
  const [busy, setBusy] = useState(false);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 48, 350);
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [float]);
  const share = async () => {
    if (busy || !shot.current) return;
    setBusy(true);
    try {
      const uri = await shot.current.capture();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '分享音乐卡片' });
    } finally { setBusy(false); }
  };
  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [
        { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [2, -5] }) },
        { rotate: float.interpolate({ inputRange: [0, 1], outputRange: ['-.22deg', '.22deg'] }) },
      ] }}>
      <ViewShot ref={shot} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
        <LinearGradient
          colors={['#34262c', '#161a13', '#090b08']}
          locations={[0, 0.55, 1]}
          style={[styles.canvas, { width: cardWidth }]}
        >
          <View style={styles.orbA} /><View style={styles.orbB} />
          <View style={styles.polaroid}>
            <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(255,255,255,.17)', 'rgba(255,255,255,.055)']}
              style={StyleSheet.absoluteFill} />
            <RemoteImage uri={track?.pic} width={900} height={900} style={styles.cover}
              fallback={<DefaultCover seed={track?.bvid || track?.title} style={StyleSheet.absoluteFill} />} />
            <View style={styles.caption}>
              <Text numberOfLines={2} style={styles.title}>{track?.title || 'Biu Player'}</Text>
              <View style={styles.metaRow}>
                <Text numberOfLines={1} style={styles.artist}>{track?.up || '未知音乐人'}</Text>
              </View>
              <View style={styles.rule} />
              <Text style={styles.brand}>BIU PLAYER · 今日留声</Text>
            </View>
          </View>
          <Text style={styles.corner}>PLAY / KEEP / SHARE</Text>
        </LinearGradient>
      </ViewShot>
      </Animated.View>
      <TouchableOpacity style={styles.button} onPress={share} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator size="small" color="#171810" /> : <Text style={styles.buttonText}>分享卡片</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 16, paddingBottom: 8 },
  canvas: { aspectRatio: 3 / 4, padding: 22, overflow: 'hidden', borderRadius: 24 },
  orbA: { position: 'absolute', width: 210, height: 210, borderRadius: 105, left: -80, top: -45, backgroundColor: 'rgba(251,114,153,.19)' },
  orbB: { position: 'absolute', width: 180, height: 180, borderRadius: 90, right: -65, bottom: 36, backgroundColor: 'rgba(156,190,117,.13)' },
  polaroid: {
    flex: 1, padding: 13, paddingBottom: 18, borderRadius: 13,
    backgroundColor: 'rgba(245,242,232,.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,.42)', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: .38, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
  cover: { width: '100%', aspectRatio: 1, borderRadius: 7, overflow: 'hidden', backgroundColor: '#171a14' },
  caption: { flex: 1, paddingHorizontal: 7, paddingTop: 15 },
  title: { color: '#fff', fontSize: 20, lineHeight: 27, fontWeight: '700', letterSpacing: .3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  artist: { flex: 1, color: 'rgba(255,255,255,.68)', fontSize: 12 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,.22)', marginTop: 13, marginBottom: 10 },
  brand: { color: '#ff85a7', fontSize: 10, fontWeight: '700', letterSpacing: 2.1 },
  corner: { position: 'absolute', right: 18, bottom: 7, color: 'rgba(255,255,255,.24)', fontSize: 7, letterSpacing: 1.4 },
  button: { minWidth: 150, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#171810', fontSize: 13, fontWeight: '700' },
});
