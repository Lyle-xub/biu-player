import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, fmtDur } from '../theme';

const clamp = (value) => Math.max(0, Math.min(1, value));

export default function ProgressScrubber({ position, duration, isLive, playing, seekRevision, onSeek }) {
  const [width, setWidth] = useState(1);
  const [active, setActive] = useState(false);
  const [preview, setPreview] = useState(position);
  const dragging = useRef(false);
  const origin = useRef(null);
  const target = useRef(position);
  const lastLabel = useRef(0);
  const progress = duration > 0 ? clamp(position / duration) : 0;
  const animated = useRef(new Animated.Value(progress)).current;
  const touch = useRef(new Animated.Value(0)).current;
  const revision = useRef(seekRevision);

  useLayoutEffect(() => {
    if (dragging.current) return undefined;
    // An explicit seek is already under the finger. Do not animate from an old tick.
    if (revision.current !== seekRevision || !playing) animated.setValue(progress);
    revision.current = seekRevision;
    const animation = Animated.timing(animated, {
      toValue: duration > 0 ? clamp((position + (playing ? 0.25 : 0)) / duration) : 0,
      duration: 250, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [position, duration, playing, seekRevision, progress, animated]);
  useLayoutEffect(() => {
    const animation = Animated.timing(touch, {
      toValue: active ? 1 : 0, duration: active ? 120 : 180,
      easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [active, touch]);

  const update = (event, forceLabel = false) => {
    const { pageX, locationX } = event.nativeEvent;
    const x = origin.current !== null && Number.isFinite(pageX) ? pageX - origin.current : locationX;
    if (!Number.isFinite(x)) return target.current;
    const ratio = clamp(x / width);
    target.current = ratio * duration;
    // Only transforms change on movement: no width/left layout or React render per frame.
    animated.setValue(ratio);
    const now = Date.now();
    if (forceLabel || now - lastLabel.current >= 80) {
      lastLabel.current = now;
      setPreview(target.current);
    }
    return target.current;
  };
  const finish = (event, cancelled = false) => {
    if (!dragging.current) return;
    const value = cancelled ? position : update(event, true);
    dragging.current = false;
    if (!cancelled) onSeek(value);
    else Animated.timing(animated, { toValue: progress, duration: 180,
      easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    setActive(false);
  };
  const shown = active ? preview : position;
  const translateX = animated.interpolate({ inputRange: [0, 1], outputRange: [0, width] });

  if (isLive) return <Text style={styles.liveHint}>直播中 · 无法拖动进度</Text>;
  return <View>
    <View style={styles.zone} accessibilityRole="adjustable" accessibilityLabel="播放进度"
      accessibilityValue={{ min: 0, max: Math.round(duration || 0), now: Math.round(shown || 0), text: fmtDur(shown) }}
      accessibilityActions={[{ name: 'increment', label: '快进 10 秒' }, { name: 'decrement', label: '后退 10 秒' }]}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (actionName === 'increment' || actionName === 'decrement') {
          onSeek(Math.max(0, Math.min(duration, position + (actionName === 'increment' ? 10 : -10))));
        }
      }}
      onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => duration > 0}
      onMoveShouldSetResponder={() => duration > 0}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        dragging.current = true;
        animated.stopAnimation();
        const { pageX, locationX } = event.nativeEvent;
        origin.current = Number.isFinite(pageX) && Number.isFinite(locationX) ? pageX - locationX : null;
        update(event, true);
        setActive(true);
      }}
      onResponderMove={(event) => { if (dragging.current) update(event); }}
      onResponderRelease={(event) => finish(event)}
      onResponderTerminate={(event) => finish(event, true)}>
      <Animated.View pointerEvents="none" style={[styles.bubble, { opacity: touch,
        transform: [{ translateX: animated.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, width - 58)] }) },
          { translateY: touch.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }],
      }]}><Text style={styles.bubbleText}>{fmtDur(preview)}</Text></Animated.View>
      <Animated.View pointerEvents="none" style={[styles.track, {
        transform: [{ scaleY: touch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
      }]}>
        <Animated.View style={[styles.fill, { transform: [{ translateX: animated.interpolate({
          inputRange: [0, 1], outputRange: [-width, 0],
        }) }] }]} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.thumb, {
        transform: [{ translateX }, { scale: touch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
      }]} />
    </View>
    <View style={styles.timeRow}>
      <Text style={[styles.time, active && styles.timeActive]}>{fmtDur(shown)}</Text>
      <Text style={styles.time}>{fmtDur(duration)}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  zone: { paddingTop: 22, paddingBottom: 12, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.22)' },
  fill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  thumb: { position: 'absolute', left: -5, bottom: 9, width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.text, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 } },
  bubble: { position: 'absolute', left: 0, top: -10, width: 58, height: 26,
    alignItems: 'center', justifyContent: 'center', borderRadius: 9,
    backgroundColor: 'rgba(20,22,16,0.94)', borderWidth: 1, borderColor: colors.cardBorder },
  bubbleText: { color: colors.text, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontVariant: ['tabular-nums'] },
  timeActive: { color: colors.accent },
  liveHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
});
