import React, { useId, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Path, Pattern, Stop } from 'react-native-svg';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient as GlassGradient } from 'expo-linear-gradient';
import RemoteImage from '../components/RemoteImage';
import { colors } from '../theme';
import { visibleWheelSlots, wheelGeometry, wheelPosition, wrap } from './discoveryGesture';

// The folder contents are actual video covers; opening lifts the collage and
// folds the translucent front down, with the name printed on that front.
function GlassFolder({ target, open }) {
  const id = useId().replace(/:/g, '');
  const covers = [...new Set((target.covers || []).filter(Boolean))].slice(0, 4);
  const contents = useAnimatedStyle(() => ({ transform: [{ translateY: -10 * open.value }] }));
  const front = useAnimatedStyle(() => ({ transformOrigin: 'bottom', transform: [
    { perspective: 400 }, { rotateX: `${-35 * open.value}deg` },
  ] }));
  return <View style={s.folder}>
    <Svg width={104} height={78} viewBox="0 0 100 82" style={StyleSheet.absoluteFill}>
      <Defs><LinearGradient id={`${id}back`} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={colors.bgSoft} /><Stop offset="1" stopColor={colors.bg} />
      </LinearGradient></Defs>
      <Path d="M4 24 Q4 15 14 15 H44 Q49 15 55 9 L62 3 H87 Q96 3 96 13 V68 H4Z"
        fill={`url(#${id}back)`} stroke={colors.accentSoft} strokeWidth="1" />
    </Svg>
    <Animated.View testID="discovery-folder-covers" style={[s.collage, contents]}>
      {covers.map((uri, index) => <RemoteImage key={uri} uri={uri} width={120} height={120}
        cachePolicy="memory-disk" transition={0} style={{ width: covers.length === 1 || (covers.length === 3 && index === 2) ? '100%' : '50%',
          height: covers.length <= 2 ? '100%' : '50%' }} />)}
    </Animated.View>
    <Animated.View testID="discovery-folder-front" style={[s.front, front]}>
      <Svg width={104} height={64} viewBox="0 0 100 66" preserveAspectRatio="none">
        <Defs><LinearGradient id={`${id}glass`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.text} stopOpacity="0.08" />
          <Stop offset="0.45" stopColor={colors.bgSoft} stopOpacity="0.36" />
          <Stop offset="1" stopColor={colors.bg} stopOpacity="0.92" />
        </LinearGradient></Defs>
        <Path d="M1 12 Q1 2 12 2 H35 Q40 2 44 6 L54 15 Q57 18 63 18 H88 Q99 18 99 28 V53 Q99 65 87 65 H13 Q1 65 1 53Z"
          fill={`url(#${id}glass)`} stroke={colors.cardBorder} strokeWidth="1" />
      </Svg>
      <View style={s.folderCopy}>
        <Text style={s.title} numberOfLines={2}>{target.title}</Text>
        <Text style={s.subtitle} numberOfLines={1}>{target.subtitle}</Text>
      </View>
    </Animated.View>
  </View>;
}
const WheelItem = React.memo(function WheelItem({ target, slot, count, height, rotation, hover }) {
  const { radius, halfHeight } = wheelGeometry(count, height);
  const open = useDerivedValue(() => withTiming(hover.value === slot ? 1 : 0, { duration: 180 }));
  const position = useAnimatedStyle(() => {
    const p = wheelPosition(slot, rotation.value, count, radius);
    return { opacity: p.front && Math.abs(p.y) <= halfHeight ? 1 : 0,
      transform: [{ translateX: p.x }, { translateY: p.y }, { scale: 1 + 0.08 * open.value }] };
  });
  return <Animated.View pointerEvents="none" style={[s.item, position]}>
    <GlassFolder target={target} open={open} />
  </Animated.View>;
});
export const DiscoveryWheelHaze = React.memo(function DiscoveryWheelHaze({ blurTarget, bounds, width, height, count, visibility, open }) {
  const id = useId().replace(/:/g, '');
  const { radius } = wheelGeometry(count, height);
  const canvasWidth = Math.min(width, 280);
  const canvasHeight = height - bounds.top - bounds.bottom;
  // Concentric with the folder ring, including its offscreen center. Feather
  // outward from the folders instead of masking a full-height rectangular strip.
  const cx = canvasWidth + radius - 52, cy = height / 2 - bounds.top;
  // Halve the reach from the screen edge (197 -> 98.5), including the feather.
  const outerRadius = radius + 46.5;
  const appearance = useAnimatedStyle(() => ({ opacity: visibility.value * 0.72,
    transform: [{ translateX: 24 * (1 - visibility.value) }] }));
  if (!width || !height) return null;
  return (
    <Animated.View pointerEvents="none" style={[s.haze, bounds, appearance]}>
      <MaskedView pointerEvents="none" androidRenderingMode="hardware" style={StyleSheet.absoluteFill}
        maskElement={<Svg width="100%" height="100%" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
          <Defs><RadialGradient id={`${id}frost`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={outerRadius}>
            <Stop offset="0" stopColor="#000" />
            <Stop offset={(radius - 32) / outerRadius} stopColor="#000" />
            <Stop offset={(radius - 1) / outerRadius} stopColor="#000" stopOpacity="0.4" />
            <Stop offset={(radius + 26) / outerRadius} stopColor="#000" stopOpacity="0.08" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </RadialGradient></Defs>
          <Rect width={canvasWidth} height={canvasHeight} fill={`url(#${id}frost)`} />
        </Svg>}>
        <BlurView testID="discovery-wheel-blur" blurTarget={blurTarget} blurMethod="dimezisBlurView"
          intensity={open ? 100 : 0} blurReductionFactor={4} tint="systemThinMaterialLight" style={StyleSheet.absoluteFill} />
        <GlassGradient pointerEvents="none" colors={['rgba(246,249,252,0.18)', 'rgba(207,219,229,0.06)', 'rgba(235,242,248,0.12)']}
          locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} style={StyleSheet.absoluteFill}>
          <Defs><Pattern id={`${id}grain`} patternUnits="userSpaceOnUse" width="16" height="16">
            <Path d="M1 2h.7v.7h-.7z M9 1h.5v.5h-.5z M5 7h.8v.8h-.8z M13 5h.6v.6h-.6z M2 12h.5v.5h-.5z M11 11h.8v.8h-.8z M7 15h.6v.6h-.6z" fill="#fff" fillOpacity="0.35" />
            <Path d="M4 1h.5v.5h-.5z M12 3h.7v.7h-.7z M1 8h.6v.6h-.6z M8 10h.5v.5h-.5z M14 14h.7v.7h-.7z M4 14h.6v.6h-.6z" fill="#354453" fillOpacity="0.16" />
          </Pattern></Defs>
          <Rect width={canvasWidth} height={canvasHeight} fill={`url(#${id}grain)`} />
          <Circle cx={cx} cy={cy} r={radius + 16.5} fill="none" stroke="#eef8ff" strokeOpacity="0.08" strokeWidth="0.8" />
        </Svg>
      </MaskedView>
    </Animated.View>
  );
});

function DiscoveryWheel({ targets, height, rotation, hover, visibility }) {
  const [center, setCenter] = useState(0);
  const { radius, halfHeight } = wheelGeometry(targets.length, height);
  const count = targets.length;
  // Also align the idle window to the retained angle after returning to this tab.
  useAnimatedReaction(() => count ? wrap(Math.round(-rotation.value / (180 / count)), count * 2) : null,
    (slot, previous) => { if (slot !== null && slot !== previous) runOnJS(setCenter)(slot); }, [count]);
  const appearance = useAnimatedStyle(() => ({ opacity: visibility.value, transform: [{ translateX: 24 * (1 - visibility.value) }] }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.wheelLayer, appearance]}>
    <View style={[s.ring, { width: radius * 2, height: radius * 2, borderRadius: radius,
      right: 52 - radius * 2, top: height / 2 - radius }]} />
    <Text style={[s.edge, { top: height / 2 - halfHeight - 20 }]}>↑ 贴边加速</Text>
    <Text style={[s.edge, { top: height / 2 + halfHeight + 5 }]}>↓ 贴边加速</Text>
    <View style={{ position: 'absolute', top: height / 2, right: 0 }}>
      {visibleWheelSlots(center, count, height).map((slot) => <WheelItem key={slot} target={targets[slot % count]}
        slot={slot} count={targets.length} height={height} rotation={rotation} hover={hover} />)}
    </View>
  </Animated.View>;
}
export default React.memo(DiscoveryWheel);
const s = StyleSheet.create({
  haze: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 280, maxWidth: '100%', overflow: 'hidden', zIndex: 1 },
  wheelLayer: { zIndex: 2 },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  edge: { position: 'absolute', right: 24, color: '#a6adb2', fontSize: 10 },
  item: { position: 'absolute', right: 12, top: -39, width: 104, height: 78 },
  folder: { width: 104, height: 78, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
  collage: { position: 'absolute', top: 17, left: 4, right: 4, height: 55, borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.bgSoft, flexDirection: 'row', flexWrap: 'wrap' },
  front: { position: 'absolute', bottom: 0, left: 0, width: 104, height: 64 },
  folderCopy: { position: 'absolute', left: 9, right: 8, bottom: 6 },
  title: { color: colors.text, fontSize: 11, lineHeight: 13, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 3 },
  subtitle: { color: colors.text2, fontSize: 8, lineHeight: 10, marginTop: 2 },
});
