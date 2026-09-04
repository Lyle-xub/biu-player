import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import { colors } from '../theme';

const android = Platform.OS === 'android';
export const pageScreenOptions = android ? {
  presentation: 'transparentModal', animation: 'none', gestureEnabled: false,
  contentStyle: { backgroundColor: 'transparent' },
} : {
  animation: 'slide_from_right', gestureEnabled: true, fullScreenGestureEnabled: true,
  contentStyle: { backgroundColor: colors.bg },
};

export default function PageTransition({ navigation, children }) {
  const focused = useIsFocused();
  const window = useWindowDimensions();
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [exiting, setExiting] = useState(false);
  const closing = useRef(false);
  const progress = useRef(new Animated.Value(android ? 1 : 0)).current;
  const ready = layoutWidth > 0;
  const onLayout = useCallback((e) => setLayoutWidth(e.nativeEvent.layout.width), []);
  useEffect(() => {
    if (!android || !ready || closing.current) return undefined;
    Animated.timing(progress, {
      toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
    return () => progress.stopAnimation();
  }, [ready, progress]);
  useEffect(() => () => progress.stopAnimation(), [progress]);

  // A native pop can drop the React subtree before Android finishes drawing it.
  // Keep the focused route (and its live content) until the complete page exits.
  usePreventRemove(android && focused, ({ data }) => {
    if (closing.current) return;
    closing.current = true; setExiting(true);
    Animated.timing(progress, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) navigation.dispatch(data.action);
      else { closing.current = false; setExiting(false); }
    });
  });

  if (!android) return children;
  return (
    <View style={styles.viewport} onLayout={onLayout}>
      <Animated.View pointerEvents={exiting ? 'none' : 'auto'} style={[styles.page, {
        transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, layoutWidth || window.width] }) }],
      }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  page: { flex: 1 },
});
