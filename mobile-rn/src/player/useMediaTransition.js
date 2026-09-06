import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, useWindowDimensions } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Keep Android's route mounted until the entire sheet has moved below the screen.
// The transparent native route keeps the previous page visible underneath it.
export const mediaScreenOptions = Platform.OS === 'android' ? {
  presentation: 'transparentModal', animation: 'none', gestureEnabled: false,
  contentStyle: { backgroundColor: 'transparent' },
} : {
  animation: 'slide_from_bottom', gestureDirection: 'vertical',
  fullScreenGestureEnabled: true, animationMatchesGesture: true,
  // iOS cancels React touches when its native dismiss recognizer begins.
  // Keep dismissal on the header so it cannot steal the playback scrubber.
  gestureResponseDistance: { top: 0, bottom: 140 },
};

export default function useMediaTransition(navigation) {
  const android = Platform.OS === 'android';
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [layoutHeight, setLayoutHeight] = useState(0);
  const height = layoutHeight || window.height;
  const ready = layoutHeight > 0;
  const progress = useRef(new Animated.Value(android ? 1 : 0)).current;
  const closing = useRef(false);
  const onLayout = useCallback((e) => setLayoutHeight(e.nativeEvent.layout.height), []);

  useEffect(() => {
    // Lay out at the final size while offscreen, then move the complete page as one unit.
    if (!android || !ready || closing.current) return undefined;
    Animated.timing(progress, {
      toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
    return () => progress.stopAnimation();
  }, [android, ready, progress]);
  useEffect(() => () => progress.stopAnimation(), [progress]);

  usePreventRemove(android, ({ data }) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      // Re-dispatch the original action (including its visited-route marker).
      if (finished) navigation.dispatch(data.action);
      else closing.current = false;
    });
  });

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => android && !closing.current
      && g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5,
    onPanResponderGrant: () => progress.stopAnimation(),
    onPanResponderMove: (_, g) => progress.setValue(Math.max(0, Math.min(1, g.dy / height))),
    onPanResponderRelease: (_, g) => {
      if (g.dy > height * 0.16 || g.vy > 0.65) navigation.goBack();
      else Animated.spring(progress, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(progress, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 0 }).start();
    },
  }), [android, height, navigation, progress]);

  // Move the clipping edge up while the page moves down, revealing the existing tab bar
  // during the gesture. Opposite translations keep the page exactly under the finger.
  const footer = 49 + insets.bottom;
  const stops = [0, 0.25, 1];
  return {
    onLayout,
    viewportStyle: android ? { transform: [{ translateY: progress.interpolate({
      inputRange: stops, outputRange: [0, -footer, -footer], extrapolate: 'clamp',
    }) }] } : undefined,
    style: android ? { transform: [{ translateY: progress.interpolate({
      inputRange: stops, outputRange: [0, height * 0.25 + footer, height + footer], extrapolate: 'clamp',
    }) }] } : undefined,
    safeStyle: { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
    panHandlers: android ? pan.panHandlers : {},
  };
}
