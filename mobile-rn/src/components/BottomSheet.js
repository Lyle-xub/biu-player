import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

export default function BottomSheet({ visible, onClose, animationType = 'slide', style, children }) {
  const [present, setPresent] = useState(visible);
  const [shown, setShown] = useState(false);
  const content = useRef({ children, style, animationType });
  useLayoutEffect(() => {
    if (visible) {
      setPresent(true);
      content.current = { children, style, animationType };
    }
  }, [visible, children, style, animationType]);
  const onHidden = useCallback(() => { setPresent(false); setShown(false); }, []);

  if (!visible && !present) return null;
  const displayed = visible ? { children, style, animationType } : content.current;
  return (
    <Modal visible transparent animationType="none" hardwareAccelerated onRequestClose={onClose}
      onShow={() => setShown(true)} statusBarTranslucent navigationBarTranslucent>
      {/* Keep the modal window and its inset measurement stationary. */}
      <SafeAreaProvider>
        <SheetSurface visible={visible} shown={shown} onHidden={onHidden} onClose={onClose}
          animationType={displayed.animationType} style={displayed.style}>
          {displayed.children}
        </SheetSurface>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetSurface({ visible, shown, onHidden, onClose, animationType, style, children }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const ready = shown && height > 0;

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
    <KeyboardAvoidingView style={styles.mask} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}
        accessibilityRole="button" accessibilityLabel="关闭面板" />
      <Animated.View pointerEvents={visible ? 'auto' : 'none'}
        onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, style, {
          // Insets come from the fixed provider, never from the moving sheet's position.
          paddingBottom: insets.bottom + 18,
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
});
