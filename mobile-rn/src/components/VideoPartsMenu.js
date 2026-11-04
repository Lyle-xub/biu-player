import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Overlay from './Overlay';
import { IconChevronDown } from './icons';
import { colors, radius } from '../theme';

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 46;

function PartMenuSurface({ anchor, parts, current, onClose, onSelect }) {
  const root = useRef(null);
  const [frame, setFrame] = useState(null);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const measure = ({ nativeEvent: { layout: { width, height } } }) => {
    root.current?.measureInWindow((x, y) => setFrame({ x, y, width, height }));
  };
  useEffect(() => {
    if (!frame) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: 180,
      easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [frame, progress]);

  let panel = null;
  if (frame) {
    const gap = 8, margin = 12;
    const safeTop = Math.max(0, insets.top - frame.y) + margin;
    const safeBottom = frame.height - insets.bottom - margin;
    const anchorTop = anchor.y - frame.y;
    const above = anchorTop - gap - safeTop;
    const below = safeBottom - anchorTop - anchor.height - gap;
    const idealHeight = Math.min(HEADER_HEIGHT + ROW_HEIGHT * parts.length, frame.height * 0.56, 420);
    // A title near the status bar cannot fit a usable menu above it.
    const opensUp = above >= Math.min(idealHeight, HEADER_HEIGHT + ROW_HEIGHT * 3) || above > below;
    const height = Math.min(idealHeight, Math.max(0, opensUp ? above : below));
    const leftEdge = insets.left + margin, rightEdge = frame.width - insets.right - margin;
    const width = Math.min(320, rightEdge - leftEdge);
    const left = Math.min(Math.max(anchor.x - frame.x, leftEdge), rightEdge - width);
    const top = opensUp ? anchorTop - gap - height : anchorTop + anchor.height + gap;
    const rowIndex = parts.findIndex(part => part.cid === current.cid);
    const listHeight = height - HEADER_HEIGHT;
    const scrollY = Math.max(0, Math.min((rowIndex - 1) * ROW_HEIGHT, parts.length * ROW_HEIGHT - listHeight));
    if (width > 0 && listHeight > 0) panel = (
      <Animated.View testID="player-parts-menu" style={[styles.panel, { top, left, width, height,
        opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
        <View style={styles.heading}>
          <Text style={styles.headingText}>视频分 P</Text>
          <Text style={styles.count}>共 {parts.length} P</Text>
        </View>
        <ScrollView style={styles.list} contentOffset={{ x: 0, y: scrollY }} keyboardShouldPersistTaps="handled">
          {parts.map(part => {
            const selected = part.cid === current.cid;
            return (
              <Pressable key={part.cid} accessibilityRole="button" accessibilityLabel={`播放 P${part.page}：${part.title}`}
                accessibilityState={{ selected }} onPress={() => onSelect(part.cid)}
                style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}>
                <Text style={[styles.badge, selected && styles.accent]}>P{part.page}</Text>
                <Text numberOfLines={1} style={[styles.title, selected && styles.accent]}>{part.title}</Text>
                {selected && <Text accessible={false} style={styles.accent}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
    );
  }
  return (
    <View ref={root} testID="player-parts-overlay" collapsable={false} onLayout={measure} style={StyleSheet.absoluteFill}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭分 P 菜单"
        onPress={onClose} style={[StyleSheet.absoluteFill, styles.backdrop]} />
      {panel}
    </View>
  );
}

export default function VideoPartsMenu({ parts, current, onSelect }) {
  const button = useRef(null);
  const request = useRef(0);
  const [anchor, setAnchor] = useState(null);
  const { width, height } = useWindowDimensions();
  const close = useCallback(() => { request.current++; setAnchor(null); }, []);
  useEffect(() => {
    close();
    return () => { request.current++; };
  }, [width, height, close]);
  const open = () => {
    const id = ++request.current;
    button.current?.measureInWindow((x, y, w, h) => {
      if (request.current === id && w > 0 && h > 0) setAnchor({ x, y, height: h });
    });
  };
  return (
    <>
      <View ref={button} testID="player-parts-anchor" collapsable={false}>
        <Pressable testID="player-parts-trigger" hitSlop={6} onPress={open} style={[styles.trigger, anchor && styles.selected]}
          accessibilityRole="button" accessibilityLabel={`选择分 P：P${current.page} ${current.title}`}
          accessibilityState={{ expanded: !!anchor }}>
          <IconChevronDown size={14} color={anchor ? colors.accent : colors.text} />
        </Pressable>
      </View>
      {anchor && (
        <Overlay onClose={close}>
          <PartMenuSurface anchor={anchor} parts={parts} current={current} onClose={close}
            onSelect={cid => { close(); onSelect(cid); }} />
        </Overlay>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.22)' },
  panel: { position: 'absolute', backgroundColor: colors.bgSoft, borderRadius: radius.card,
    borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden', paddingHorizontal: 5,
    shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  heading: { height: HEADER_HEIGHT - 2, paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headingText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  count: { color: colors.text2, fontSize: 11 },
  list: { flex: 1 },
  row: { height: ROW_HEIGHT, paddingHorizontal: 8, gap: 9, borderRadius: 9, flexDirection: 'row', alignItems: 'center' },
  selected: { backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.7 },
  badge: { minWidth: 34, textAlign: 'center', paddingHorizontal: 4, paddingVertical: 3, borderRadius: 6,
    backgroundColor: colors.card, color: colors.text2, fontSize: 11, fontVariant: ['tabular-nums'] },
  title: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13 },
  accent: { color: colors.accent },
});
