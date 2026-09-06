import React, { useId, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import RemoteImage from '../components/RemoteImage';
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
        <Stop offset="0" stopColor="#287c91" /><Stop offset="1" stopColor="#17222c" />
      </LinearGradient></Defs>
      <Path d="M4 24 Q4 15 14 15 H44 Q49 15 55 9 L62 3 H87 Q96 3 96 13 V68 H4Z" fill={`url(#${id}back)`} />
    </Svg>
    <Animated.View testID="discovery-folder-covers" style={[s.collage, contents]}>
      {covers.map((uri, index) => <RemoteImage key={uri} uri={uri} width={120} height={120}
        cachePolicy="memory-disk" transition={0} style={{ width: covers.length === 1 || (covers.length === 3 && index === 2) ? '100%' : '50%',
          height: covers.length <= 2 ? '100%' : '50%' }} />)}
    </Animated.View>
    <Animated.View testID="discovery-folder-front" style={[s.front, front]}>
      <Svg width={104} height={64} viewBox="0 0 100 66" preserveAspectRatio="none">
        <Defs><LinearGradient id={`${id}glass`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#eef9ff" stopOpacity="0.08" />
          <Stop offset="0.45" stopColor="#14252e" stopOpacity="0.24" />
          <Stop offset="1" stopColor="#071017" stopOpacity="0.88" />
        </LinearGradient></Defs>
        <Path d="M1 12 Q1 2 12 2 H35 Q40 2 44 6 L54 15 Q57 18 63 18 H88 Q99 18 99 28 V53 Q99 65 87 65 H13 Q1 65 1 53Z"
          fill={`url(#${id}glass)`} stroke="#fff" strokeOpacity="0.45" strokeWidth="1" />
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
function DiscoveryWheel({ targets, height, rotation, hover, visibility }) {
  const [center, setCenter] = useState(0);
  const { radius, halfHeight } = wheelGeometry(targets.length, height);
  const count = targets.length;
  // Also align the idle window to the retained angle after returning to this tab.
  useAnimatedReaction(() => count ? wrap(Math.round(-rotation.value / (180 / count)), count * 2) : null,
    (slot, previous) => { if (slot !== null && slot !== previous) runOnJS(setCenter)(slot); }, [count]);
  const appearance = useAnimatedStyle(() => ({ opacity: visibility.value, transform: [{ translateX: 24 * (1 - visibility.value) }] }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, appearance]}>
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
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  edge: { position: 'absolute', right: 24, color: '#a6adb2', fontSize: 10 },
  item: { position: 'absolute', right: 12, top: -39, width: 104, height: 78 },
  folder: { width: 104, height: 78, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
  collage: { position: 'absolute', top: 17, left: 4, right: 4, height: 55, borderRadius: 8, overflow: 'hidden',
    backgroundColor: '#203640', flexDirection: 'row', flexWrap: 'wrap' },
  front: { position: 'absolute', bottom: 0, left: 0, width: 104, height: 64 },
  folderCopy: { position: 'absolute', left: 9, right: 8, bottom: 6 },
  title: { color: '#fff', fontSize: 11, lineHeight: 13, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 3 },
  subtitle: { color: '#c9d6df', fontSize: 8, lineHeight: 10, marginTop: 2 },
});
