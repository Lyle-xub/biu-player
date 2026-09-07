import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
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
  useEffect(() => {
    if (visible || !present) return undefined;
    // Cosmetic cleanup only. Input is released immediately via active={visible},
    // including interrupted animations and app suspension without a callback.
    const timer = setTimeout(onHidden, 350);
    return () => clearTimeout(timer);
  }, [visible, present, onHidden]);

  if (!visible && !present) return null;
  const displayed = visible ? { children, style, animationType } : content.current;
  return (
    <Overlay onClose={onClose} active={visible}>
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
  const drag = useRef(new Animated.Value(0)).current;
  const dragEvent = React.useMemo(() => Animated.event([{ nativeEvent: { translationY: drag } }],
    { useNativeDriver: true }), [drag]);
  const centered = placement === 'center';

  useEffect(() => {
    let cancelled = false;
    if (visible) { drag.stopAnimation(); drag.setValue(0); }
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0, duration: visible ? 280 : 220,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !cancelled && !visible) onHidden();
    });
    return () => { cancelled = true; animation.stop(); };
  }, [visible, progress, drag, onHidden]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      progress.stopAnimation(); progress.setValue(visible ? 1 : 0);
      drag.stopAnimation(); drag.setValue(0);
      if (!visible) onHidden();
    });
    return () => subscription.remove();
  }, [visible, progress, drag, onHidden]);

  const onDragState = ({ nativeEvent: event }) => {
    if (!visible) return;
    if (event.state === State.BEGAN) { drag.stopAnimation(); return; }
    if (event.oldState !== State.ACTIVE) return;
    const distance = Math.max(0, event.translationY || 0);
    const threshold = Math.min(120, Math.max(56, height * 0.2));
    if (event.state === State.END && (distance >= threshold || (distance > 12 && event.velocityY > 800))) {
      Keyboard.dismiss(); onClose();
    } else {
      Animated.spring(drag, { toValue: 0, damping: 24, stiffness: 260, mass: 1, useNativeDriver: true }).start();
    }
  };

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
          opacity: animationType === 'fade' ? progress : 1,
          transform: [{ translateY: Animated.add(animationType === 'fade' ? 0
            : progress.interpolate({ inputRange: [0, 1], outputRange: [height || windowHeight, 0] }),
          drag.interpolate({ inputRange: [0, windowHeight], outputRange: [0, windowHeight], extrapolate: 'clamp' })) }],
        }]}>
        {!centered && <PanGestureHandler enabled={visible} minDist={4} maxPointers={1}
          onGestureEvent={dragEvent} onHandlerStateChange={onDragState}>
          <Animated.View testID="sheet-drag-handle" collapsable={false} style={styles.handleArea}
            accessible accessibilityRole="button" accessibilityLabel="下拉关闭面板"
            accessibilityActions={[{ name: 'activate', label: '关闭面板' }]}
            onAccessibilityTap={onClose} onAccessibilityAction={onClose}>
            <View accessible={false} style={styles.handle} />
          </Animated.View>
        </PanGestureHandler>}
        {children}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.62)' },
  handleArea: { height: 36, marginTop: -8, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.text3 },
  sheet: {
    backgroundColor: colors.bgSoft, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: colors.cardBorder, padding: 18, maxHeight: '68%',
  },
  dialog: { width: '88%', maxWidth: 420, maxHeight: '100%', borderRadius: 24, padding: 22 },
});
