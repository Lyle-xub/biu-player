import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { trackKeyOf } from '../player/track';

export const PLAYLIST_ROW_HEIGHT = 76;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function reorderTarget(top, scroll, header, count) {
  return clamp(Math.round((top + scroll - header) / PLAYLIST_ROW_HEIGHT), 0, Math.max(0, count - 1));
}

export function reorderScrollStep(top, viewport, scroll, contentHeight, elapsed = 16) {
  const center = top + PLAYLIST_ROW_HEIGHT / 2;
  const edge = Math.min(80, viewport / 4);
  const speed = center < edge ? -(edge - center) / edge
    : center > viewport - edge ? (center - viewport + edge) / edge : 0;
  return clamp(scroll + speed * 12 * Math.min(elapsed, 32) / 16, 0, Math.max(0, contentHeight - viewport));
}

function Grip({ disabled, label, arm, adjust, index, count }) {
  return <View onStartShouldSetResponder={() => { if (!disabled) arm(); return false; }}
    accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityValue={{ min: 1, max: count, now: index + 1 }} accessibilityState={{ disabled }}
    accessibilityActions={[{ name: 'increment', label: '下移' }, { name: 'decrement', label: '上移' }]}
    onAccessibilityAction={(e) => {
      if (!disabled && ['increment', 'decrement'].includes(e.nativeEvent.actionName)) {
        adjust(e.nativeEvent.actionName === 'increment' ? 1 : -1);
      }
    }} style={styles.grip}>
    <Text style={styles.gripText}>≡</Text>
  </View>;
}

function MovingRow({ shift, hidden, animate, children }) {
  const y = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => {
    if (!animate) { y.setValue(0); return undefined; }
    const animation = Animated.timing(y, { toValue: shift, duration: 130, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [shift, animate, y]);
  return <Animated.View style={[styles.row, { opacity: hidden ? 0 : 1, transform: [{ translateY: y }] }]}>{children}</Animated.View>;
}

export default function ReorderablePlaylist({ data, enabled, disabled, renderItem, header, empty, bottomInset, onMove, onDraggingChange }) {
  const list = useRef(null);
  const geometry = useRef({ height: 0, header: 0, scroll: 0, content: 0 });
  const session = useRef(null);
  const armedIndex = useRef(null);
  const frame = useRef(null);
  const top = useRef(new Animated.Value(0)).current;
  const [drag, setDrag] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const items = preview || data;
  const latest = useRef();
  latest.current = { data, items, onMove, onDraggingChange };
  const stopFrame = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  const clear = () => {
    stopFrame(); session.current = null; top.stopAnimation(); setDrag(null);
    latest.current.onDraggingChange?.(false);
  };
  useEffect(() => {
    // A sync/account change invalidates the order captured at gesture start.
    if (session.current && session.current.data !== data) clear();
  }, [data]);
  useEffect(() => () => { stopFrame(); session.current = null; top.stopAnimation(); }, [top]);

  const update = () => {
    const s = session.current, g = geometry.current;
    if (!s || s.ending) return;
    s.top = clamp(s.startTop + s.dy, 0, Math.max(0, g.height - PLAYLIST_ROW_HEIGHT));
    top.setValue(s.top);
    const to = reorderTarget(s.top, g.scroll, g.header, s.data.length);
    if (to !== s.to) { s.to = to; setDrag({ ...s }); }
  };
  const tick = (now) => {
    const s = session.current, g = geometry.current;
    if (!s || s.ending) return;
    const offset = reorderScrollStep(s.top, g.height, g.scroll, g.content, s.time ? now - s.time : 16);
    s.time = now;
    if (offset !== g.scroll) { g.scroll = offset; list.current?.scrollToOffset({ offset, animated: false }); update(); }
    frame.current = requestAnimationFrame(tick);
  };
  const begin = (index) => {
    if (!enabled || disabled || saving || session.current || !geometry.current.height) return;
    const g = geometry.current;
    const s = { from: index, to: index, data: items, item: items[index], dy: 0,
      startTop: g.header + index * PLAYLIST_ROW_HEIGHT - g.scroll };
    s.top = s.startTop;
    session.current = s; top.setValue(s.top); setDrag({ ...s });
    latest.current.onDraggingChange?.(true);
    frame.current = requestAnimationFrame(tick);
  };
  const move = (dy) => { if (session.current) { session.current.dy = dy; update(); } };
  const end = (cancelled) => {
    const s = session.current;
    if (!s || s.ending) return;
    s.ending = true; stopFrame();
    const destination = cancelled ? s.from : s.to;
    const g = geometry.current;
    Animated.timing(top, {
      toValue: g.header + destination * PLAYLIST_ROW_HEIGHT - g.scroll,
      duration: 120, useNativeDriver: true,
    }).start(async ({ finished }) => {
      if (!finished || session.current !== s) return;
      if (cancelled || destination === s.from) { clear(); return; }
      const next = [...s.data]; next.splice(destination, 0, next.splice(s.from, 1)[0]);
      setPreview(next); setSaving(true); clear();
      try { await latest.current.onMove(trackKeyOf(s.item), destination); }
      finally { setPreview(null); setSaving(false); }
    });
  };
  const gestures = useRef();
  gestures.current = { begin, move, end };
  // The stationary viewport owns the gesture: the source row may be virtualized
  // away during edge scrolling without cancelling the drag.
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => { armedIndex.current = null; return false; },
    onStartShouldSetPanResponder: () => armedIndex.current !== null,
    onPanResponderGrant: () => { gestures.current.begin(armedIndex.current); armedIndex.current = null; },
    onPanResponderMove: (_, gesture) => gestures.current.move(gesture.dy),
    onPanResponderRelease: () => gestures.current.end(false),
    onPanResponderTerminate: () => gestures.current.end(true),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);
  const rowContent = (item, index, floating = false) => <>
    <View style={styles.content}>{renderItem({ item, index })}</View>
    {enabled ? <Grip label={`拖动重排 ${item.title}`} disabled={disabled || saving || floating}
      arm={() => { if (!session.current) armedIndex.current = index; }} index={index} count={items.length}
      adjust={(delta) => {
        const destination = clamp(index + delta, 0, items.length - 1);
        if (destination !== index) onMove(trackKeyOf(item), destination);
      }} /> : null}
  </>;
  return (
    <View {...pan.panHandlers} style={styles.viewport} onLayout={(e) => { geometry.current.height = e.nativeEvent.layout.height; }}>
      <FlatList ref={list} data={items} keyExtractor={trackKeyOf} extraData={drag}
        keyboardShouldPersistTaps="handled" scrollEnabled={!drag} removeClippedSubviews={!drag}
        onScroll={(e) => { geometry.current.scroll = e.nativeEvent.contentOffset.y; update(); }} scrollEventThrottle={16}
        onContentSizeChange={(_, height) => { geometry.current.content = height; }}
        contentContainerStyle={{ paddingBottom: bottomInset + 30 }}
        ListHeaderComponent={<View onLayout={(e) => { geometry.current.header = e.nativeEvent.layout.height; }}>{header}</View>}
        ListEmptyComponent={empty}
        renderItem={({ item, index }) => {
          const shift = !drag ? 0 : index > drag.from && index <= drag.to ? -PLAYLIST_ROW_HEIGHT
            : index < drag.from && index >= drag.to ? PLAYLIST_ROW_HEIGHT : 0;
          return <MovingRow shift={shift} animate={!!drag} hidden={!!drag && index === drag.from}>{rowContent(item, index)}</MovingRow>;
        }} />
      {drag ? <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.row, styles.floating, { transform: [{ translateY: top }] }]}>
        {rowContent(drag.item, drag.from, true)}
      </Animated.View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  row: { height: PLAYLIST_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1, minWidth: 0 },
  grip: { width: 44, height: PLAYLIST_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  gripText: { color: colors.accent, fontSize: 28 },
  floating: { position: 'absolute', top: 0, left: 4, right: 4, zIndex: 10, elevation: 10,
    backgroundColor: colors.bgSoft, borderRadius: 14, borderWidth: 1, borderColor: colors.accent,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});
