import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

// Keep the real subtree mounted and measured under the placeholder. Lists and
// WebViews can finish loading without changing their identity during the reveal.
export default function SheetContent({ loading = false, minHeight = 160, fill = false, style, children }) {
  const opacity = useRef(new Animated.Value(loading ? 0 : 1)).current;
  const previousLoading = useRef(loading);
  const [placeholder, setPlaceholder] = useState(loading);
  useLayoutEffect(() => {
    const wasLoading = previousLoading.current; previousLoading.current = loading;
    opacity.stopAnimation();
    if (loading) { opacity.setValue(0); setPlaceholder(true); return undefined; }
    if (!wasLoading) return undefined;
    let cancelled = false;
    const finish = () => { if (!cancelled) { opacity.setValue(1); setPlaceholder(false); } };
    const animation = Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (finished) finish(); });
    // Native animation callbacks may be lost during app suspension.
    const timer = setTimeout(finish, 220);
    return () => { cancelled = true; clearTimeout(timer); animation.stop(); };
  }, [loading, opacity]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && !loading) { opacity.stopAnimation(); opacity.setValue(1); setPlaceholder(false); }
    });
    return () => sub.remove();
  }, [loading, opacity]);
  return <View style={[styles.container, fill && { flex: 1 }, { minHeight }, style]}>
    <Animated.View testID="sheet-content" pointerEvents={loading ? 'none' : 'auto'}
      accessibilityElementsHidden={loading} importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
      style={[styles.content, fill && { flex: 1 }, { opacity }]}>{children}</Animated.View>
    {placeholder && <Animated.View testID="sheet-placeholder" pointerEvents="none" accessible
      accessibilityLabel="正在加载面板内容" accessibilityState={{ busy: true }}
      style={[StyleSheet.absoluteFill, styles.placeholder, { opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
      <View style={[styles.bar, { width: '36%', height: 16, marginBottom: 14 }]} />
      {[0, 1, 2].map(i => <View key={i} style={styles.row}><View style={styles.square} />
        <View style={styles.lines}><View style={[styles.bar, { width: i === 1 ? '64%' : '82%' }]} /><View style={[styles.bar, styles.short]} /></View>
      </View>)}
    </Animated.View>}
  </View>;
}
const styles = StyleSheet.create({ container: { flexShrink: 1 }, content: { flexShrink: 1 },
  placeholder: { backgroundColor: colors.bgSoft, paddingVertical: 8, gap: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' }, square: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cardBorder },
  lines: { flex: 1, gap: 9 }, bar: { height: 10, borderRadius: 5, backgroundColor: colors.cardBorder }, short: { width: '44%', opacity: .55 },
});
