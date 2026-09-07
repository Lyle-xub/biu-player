import { useMemo } from 'react';
import { PanResponder, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Native-stack owns entry AND removal. No transparent route may remain above
// the app while JavaScript waits for an animation's completion callback.
export const mediaScreenOptions = {
  presentation: 'card', animation: 'slide_from_bottom', gestureDirection: 'vertical',
  fullScreenGestureEnabled: true, animationMatchesGesture: true,
  gestureResponseDistance: { top: 0, bottom: 140 },
};

export default function useMediaTransition(navigation) {
  const insets = useSafeAreaInsets();
  // Android has no native swipe-to-dismiss. Keep the header's downward shortcut,
  // but dispatch back directly; playback controls never participate in this pan.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Platform.OS === 'android'
      && g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5,
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.dy > 8 && g.vy > 0.65) navigation.goBack();
    },
  }), [navigation]);
  return {
    safeStyle: { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
    panHandlers: Platform.OS === 'android' ? pan.panHandlers : {},
  };
}
