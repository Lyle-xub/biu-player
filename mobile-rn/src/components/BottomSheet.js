import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import Overlay from './Overlay';

export default function BottomSheet({ visible, onClose, animationType = 'slide', placement = 'bottom', style, children }) {
  const [present, setPresent] = useState(visible);
  const content = useRef({ children, style, animationType });
  useLayoutEffect(() => {
    if (visible) {
      setPresent(true);
      content.current = { children, style, animationType };
    }
  }, [visible, children, style, animationType]);
  const onHidden = useCallback(() => setPresent(false), []);

  if (!visible && !present) return null;
  const displayed = visible ? { children, style, animationType } : content.current;
  return (
    <Overlay onClose={onClose}>
      <SheetSurface visible={visible} placement={placement} onHidden={onHidden} onClose={onClose}
        animationType={displayed.animationType} style={displayed.style}>
        {displayed.children}
      </SheetSurface>
    </Overlay>
  );
}

function SheetSurface({ visible, placement, onHidden, onClose, animationType, style, children }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const ready = height > 0;
  const centered = placement === 'center';

  useEffect(() => {
    if (!ready) {
      if (!visible) onHidden();
      return undefined;
    }
    let cancelled = false;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0, duration: visible ? 280 : 220,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !cancelled && !visible) onHidden();
    });
    return () => { cancelled = true; animation.stop(); };
  }, [visible, ready, progress, onHidden]);

  return (
    <KeyboardAvoidingView style={[styles.mask, { paddingTop: insets.top + 12 },
      centered && { justifyContent: 'center', alignItems: 'center', paddingBottom: insets.bottom + 12 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}
        accessibilityRole="button" accessibilityLabel="关闭面板" />
      <Animated.View pointerEvents={visible ? 'auto' : 'none'}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, style, centered && styles.dialog, {
          // Read insets from the stationary application root.
          paddingBottom: centered ? 22 : insets.bottom + 18,
          marginLeft: insets.left, marginRight: insets.right,
          opacity: animationType === 'fade' ? progress : (height ? 1 : 0),
          transform: [{ translateY: animationType === 'fade' ? 0
            : progress.interpolate({ inputRange: [0, 1], outputRange: [height || windowHeight, 0] }) }],
        }]}>
        {children}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: {
    backgroundColor: colors.bgSoft, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: colors.cardBorder, padding: 18, maxHeight: '68%',
  },
  dialog: { width: '88%', maxWidth: 420, maxHeight: '100%', borderRadius: 24, padding: 22 },
});
