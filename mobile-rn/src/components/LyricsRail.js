/* Monet-style lyric rail: measured glyph sweep, independent lingering word glow.
 * Reference: chthollyphile/folia-major MonetWordSweep + monetLyricsModel.
 * One native clock drives static glyph masks; simple mode uses one fill per wrapped text row.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, AppState, Easing, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { buildLineTokens, splitLyricGraphemes, sweepFrames, glowFrames, LYRIC_CLOCK_AHEAD, shouldResetLyricClock } from '../player/lyricMotion';
export { buildLineTokens, attachLyricInterludes } from '../player/lyricMotion';

const FOCUS_RATIO = 0.46;       // 活跃行垂直中心在容器高 ×0.46
const GAP_FAR = 14;             // 常规行距
const GAP_NEAR = 18;            // 锚点附近行距
const WINDOW = 4;               // |d| > 4 完全透明
const SCROLL_MS = 420;          // 切行滚动时长（spotify-lyrics 式：仅活跃行变化时滚一次）
const UNSUNG_BLUR = 1.2;        // 活跃行未唱词微糊（px）
const TOKEN_BASE = 'rgba(255,255,255,0.45)'; // 活跃行未唱词基色
const INACTIVE_COLOR = 'rgba(255,255,255,0.72)'; // 非活跃行灰白（再乘 tone.opacity 压暗）

/* folia-major MonetWordSweep 光晕常量（glowShadow 的紧光与宽光双层） */
const GLOW_RADIUS_ONE = 0.28;
const GLOW_RADIUS_TWO = 0.65;

/* folia 光带前沿：edgeSoftness = clamp(font×0.45, 6, 16)px 柔边（resolveMonetSweepEdgeSoftness） */
const sweepEdge = (font) => clamp(font * 0.45, 6, 16);
// 字素宽度估算（onLayout 实测值就绪前的兜底）：全角 ≈ 字号，半角 ≈ 0.56×字号
const estimateCharWidth = (ch, font) => {
  if (/^\s$/.test(ch)) return font * 0.33;
  return (/[⺀-鿿豈-﫿　-￯]/).test(ch) ? font : font * 0.56;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const EASE_SCROLL = Easing.bezier(0.22, 0.61, 0.36, 1);
const isIOS = Platform?.OS === 'ios';

// React Native's View filter blur is unreliable on iOS. CoreText also skips the
// shadow when the glyph fill is fully transparent, so keep the lyric fill and
// draw the soft shadow behind it. A faint fill is enough for glow-only copies.
const glyphStyle = (color, radius = 0, shadowOnly = false) => (isIOS && radius > 0 ? {
  color: shadowOnly ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.16)',
  textShadowColor: color,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: radius * 1.35,
} : { color });

const iosGlowStyle = (radius, alpha) => ({
  color: 'rgba(255,255,255,0.025)',
  textShadowColor: `rgba(255,255,255,${alpha})`,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: radius,
});

/* ---------- 整数锚点与行级函数（切行才滚动，参考 react-native-spotify-lyrics） ---------- */
// d = |i − anchor|（anchor = activeIndex 整数）的函数
function lineTone(d, simple, active) {
  if (simple) return { scale: active ? 1.05 : Math.max(0.88, 0.96 - d * 0.02),
    opacity: d > WINDOW ? 0 : active ? 1 : Math.max(0.22, 0.76 - d * 0.12), blur: active ? 0 : Math.min(6, d * 2.2) };
  if (d > WINDOW) return { scale: 0.85, opacity: 0, blur: 6 };
  return {
    scale: Math.max(0.85, 1 - d * 0.04),
    opacity: Math.max(0.18, 1 - d * 0.28),
    blur: d < 0.15 ? 0 : Math.min(6, d * 2.2),
  };
}

// 行距：离锚点越近越接近 18px，越远越接近 14px
function gapBetween(a, b, f) {
  const closeness = clamp(1 - Math.min(Math.abs(a - f), Math.abs(b - f)), 0, 1);
  return GAP_FAR + (GAP_NEAR - GAP_FAR) * closeness;
}

// One clock for the entire rail. Small native sample jitter adjusts speed, never rewinds
// the visual position; explicit seeks and pause/buffering reset immediately.
function useLyricClock(position, playing, revision) {
  const time = useRef(new Animated.Value(position)).current;
  const previous = useRef(null);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  const running = playing && foreground;
  useLayoutEffect(() => {
    const sample = { pos: position, ts: performance.now(), playing: running, revision };
    time.stopAnimation();
    if (shouldResetLyricClock(previous.current, sample)) time.setValue(position);
    previous.current = sample;
    if (running) {
      Animated.timing(time, { toValue: position + LYRIC_CLOCK_AHEAD, duration: LYRIC_CLOCK_AHEAD * 1000,
        easing: Easing.linear, useNativeDriver: true, isInteraction: false }).start();
    }
    return () => time.stopAnimation();
  }, [position, running, revision, time]);
  return time;
}

/* ---------- 单行：target 仅在切行（或行高测出）时变化，420ms 平滑滚动一次 ---------- */
const RailLine = React.memo(function RailLine({
  line, target, font, state, onPress, onMeasure, time, simple, measureGlyphs, layoutReady,
}) {
  const anims = useRef({
    tx: new Animated.Value(target.tx),
    ty: new Animated.Value(target.ty),
    sc: new Animated.Value(target.scale),
    op: new Animated.Value(target.opacity),
  }).current;
  const positioned = useRef(false);

  useLayoutEffect(() => {
    // First layout is measurement, not a lyric transition. Reveal all rows at their
    // measured positions together instead of animating out of overlapping estimates.
    const values = [[anims.tx, target.tx], [anims.ty, target.ty], [anims.sc, target.scale], [anims.op, target.opacity]];
    if (!positioned.current || !layoutReady) {
      values.forEach(([value, toValue]) => value.setValue(toValue));
    } else {
      Animated.parallel(values.map(([value, toValue]) => Animated.timing(value, {
        toValue, duration: SCROLL_MS, easing: EASE_SCROLL, useNativeDriver: true,
      }))).start();
    }
    positioned.current = layoutReady;
    return () => values.forEach(([value]) => value.stopAnimation());
  }, [target.tx, target.ty, target.scale, target.opacity, layoutReady, anims]);

  const tokens = line.tokens || [];
  const padH = font * 0.72;
  const padT = font * 0.16;
  const padB = font * 0.34;
  const textStyle = [
    styles.lineText,
    {
      fontSize: font,
      lineHeight: font * 1.18,
      fontWeight: '700',
    },
    line.interlude && { letterSpacing: font * 0.32 },
  ];

  const blur = target.blur >= 0.15 ? Math.round(target.blur * 10) / 10 : 0;
  const lineFilter = !isIOS && blur ? { filter: [{ blur }] } : null;

  return (
    <Animated.View
      pointerEvents={target.opacity > 0.01 ? 'auto' : 'none'}
      onLayout={onMeasure}
      style={[
        styles.line,
        {
          paddingHorizontal: padH,
          paddingTop: padT,
          paddingBottom: padB,
          opacity: anims.op,
          transform: [{ translateX: anims.tx }, { translateY: anims.ty }, { scale: anims.sc }],
        },
      ]}
    >
      <TouchableOpacity activeOpacity={1} onPress={onPress} disabled={!!line.interlude}>
        {simple ? <SimpleLine line={line} state={state} time={time} textStyle={textStyle} blur={blur} lineFilter={lineFilter} />
        : <View style={[styles.wordRow, lineFilter]}>
          {tokens.map((token, i) => (
            <SweepWord key={`${i}:${token.text}:${font}`} token={token} font={font} textStyle={textStyle}
              state={state} lineEnd={line.to} time={time} measureGlyphs={measureGlyphs} blur={blur} />
          ))}
        </View>}
      </TouchableOpacity>
    </Animated.View>
  );
}, (prev, next) => (
  prev.line === next.line
  && prev.state === next.state
  && prev.font === next.font
  && prev.time === next.time
  && prev.simple === next.simple
  && prev.measureGlyphs === next.measureGlyphs
  && prev.layoutReady === next.layoutReady
  && prev.target.tx === next.target.tx
  && prev.target.ty === next.target.ty
  && prev.target.scale === next.target.scale
  && prev.target.opacity === next.target.opacity
  && prev.target.blur === next.target.blur
));

// Native text layout supplies visual rows, so a wrapped lyric finishes the first
// row before filling the next. Only the active lyric has a single static mask.
function SimpleLine({ line, state, time, textStyle, blur, lineFilter }) {
  const [rows, setRows] = useState([]);
  const fills = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + row.width, 0);
    let before = 0;
    const duration = Math.max(0.001, line.to - line.from);
    return rows.map((row) => {
      const from = line.from + duration * before / total;
      before += row.width;
      const to = line.from + duration * before / total;
      return { ...row, fill: time.interpolate({ inputRange: [from, to], outputRange: [-row.width, 0], extrapolate: 'clamp' }) };
    });
  }, [rows, time, line.from, line.to]);
  const color = state === 'passed' ? '#fff' : TOKEN_BASE;
  return <View style={lineFilter}>
    <Text style={[textStyle, glyphStyle(color, blur)]}
      onTextLayout={(e) => {
        const next = e.nativeEvent.lines.filter((row) => row.width > 0).map(({ x, y, width, height }) => ({ x, y, width, height }));
        setRows((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
      }}>{line.text}</Text>
    {state === 'active' && rows.length > 0 ? <MaskedView pointerEvents="none" androidRenderingMode="hardware"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}
      maskElement={<Text style={[textStyle, { color: '#fff' }]}>{line.text}</Text>}>
      {fills.map((row, i) => <View key={i} style={{ position: 'absolute', left: row.x, top: row.y,
        width: row.width, height: row.height, overflow: 'hidden' }}>
        <Animated.View style={{ flex: 1, backgroundColor: '#fff', transform: [{ translateX: row.fill }] }} />
      </View>)}
    </MaskedView> : null}
  </View>;
}

// Prefix measurements retain kerning/shaping, unlike separate per-character Text nodes.
// The same whole-word Text supplies the base, mask content and glow, preventing drift.
const SweepWord = React.memo(function SweepWord({ token, font, textStyle, state, lineEnd, time, measureGlyphs, blur }) {
  const grapes = useMemo(() => splitLyricGraphemes(token.text), [token.text]);
  const [width, setWidth] = useState(0);
  const [offsets, setOffsets] = useState([]);
  const edge = sweepEdge(font);
  const timed = token.timed && Number.isFinite(token.t0) && Number.isFinite(token.t1) && token.t1 > token.t0;
  const active = state === 'active' && timed;
  const baseColor = state === 'passed' ? '#fff' : TOKEN_BASE;
  const baseBlur = isIOS ? Math.max(blur, active ? UNSUNG_BLUR : 0) : 0;
  const padding = font * 0.5;
  const glowPadding = font * 0.72;
  const full = width || grapes.reduce((sum, ch) => sum + estimateCharWidth(ch, font), 0);

  const xs = useMemo(() => {
    const measured = [0];
    grapes.forEach((ch, i) => measured.push(Math.min(full, Math.max(measured[i],
      offsets[i + 1] ?? measured[i] + estimateCharWidth(ch, font)))));
    measured[measured.length - 1] = full;
    return measured;
  }, [grapes, offsets, full, font]);
  const front = useMemo(() => timed ? time.interpolate(sweepFrames(token, xs, edge)) : 0,
    [timed, time, token, xs, edge]);
  const glow = useMemo(() => timed ? time.interpolate(glowFrames(token, lineEnd)) : 0,
    [timed, time, token, lineEnd]);

  if (/^\s+$/.test(token.text)) return <View style={{ width: font * 0.3 * grapes.length }} />;

  return (
    <View style={styles.wordBlock}>
      <View style={!isIOS && active ? { filter: [{ blur: UNSUNG_BLUR }] } : undefined}>
        <Text onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={[textStyle, glyphStyle(baseColor, baseBlur)]}>{token.text}</Text>
      </View>
      {timed && measureGlyphs ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { opacity: 0 }]}>
          {grapes.slice(0, -1).map((_, i) => (
            <Text key={i} numberOfLines={1}
              onLayout={(e) => {
                const measured = e.nativeEvent.layout.width;
                setOffsets((prev) => {
                  if (prev[i + 1] === measured) return prev;
                  const next = [...prev]; next[i + 1] = measured; return next;
                });
              }}
              style={[textStyle, { position: 'absolute' }]}>{grapes.slice(0, i + 1).join('')}</Text>
          ))}
        </View> : null}
      {active ? <>
        {isIOS ? <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: -glowPadding, bottom: -glowPadding,
            left: -glowPadding, right: -glowPadding, opacity: glow }}>
          {/* Both shadows use the complete shaped word. Per-glyph Text nodes clip
              CoreText shadows into visible rectangular tiles on iOS. */}
          <Text style={[textStyle, iosGlowStyle(font * GLOW_RADIUS_TWO, 0.42),
            { padding: glowPadding }]}>{token.text}</Text>
          <Text style={[textStyle, iosGlowStyle(font * GLOW_RADIUS_ONE, 0.88),
            { position: 'absolute', left: 0, top: 0, right: 0, padding: glowPadding }]}>{token.text}</Text>
        </Animated.View> : <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: -padding, bottom: -padding, left: -padding, right: -padding,
            padding, opacity: glow, filter: [{ blur: font * GLOW_RADIUS_ONE }] }}>
          <Text style={[textStyle, { color: '#fff' }]}>{token.text}</Text>
        </Animated.View>}
        <MaskedView pointerEvents="none" androidRenderingMode="hardware"
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', left: 0, right: 0, top: -padding, bottom: -padding }}
          maskElement={<Text style={[textStyle, { color: '#fff', paddingVertical: padding }]}>{token.text}</Text>}>
          {/* The glyph bitmap stays fixed; only gradient content moves on the UI thread. */}
          <Animated.View style={{ position: 'absolute', top: 0, bottom: 0,
            left: -full - edge, width: full + edge, transform: [{ translateX: front }] }}>
            <LinearGradient colors={['#fff', '#fff', 'rgba(255,255,255,0.92)', 'transparent']}
              locations={[0, full / (full + edge), (full + edge * 0.45) / (full + edge), 1]}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
          </Animated.View>
        </MaskedView>
      </> : null}
    </View>
  );
});

export default function LyricsRail({ lines, activeIndex, onSeek, height, width, position, playing, effect = 'simple', clockRevision = 0 }) {
  const simple = effect !== 'monet';
  const time = useLyricClock(position, playing, clockRevision);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const lyricFont = clamp(windowWidth * 0.034, 30, 48);
  const requestedAnchor = clamp(activeIndex, 0, Math.max(0, lines.length - 1));
  const [layout, setLayout] = useState({ lines, width, lyricFont, fontScale, simple, revision: 0, heights: {}, anchor: requestedAnchor });
  // Reset before committing rows, not in a passive effect that can erase onLayout
  // results. Remount the rows so even unchanged heights are reported for this layout.
  if (layout.lines !== lines || layout.width !== width || layout.lyricFont !== lyricFont
    || layout.fontScale !== fontScale || layout.simple !== simple) {
    setLayout({ lines, width, lyricFont, fontScale, simple, revision: layout.revision + 1, heights: {}, anchor: requestedAnchor });
  }
  const { heights } = layout; // index -> 未缩放布局高（含 padding）
  const seekRef = useRef(onSeek);
  useLayoutEffect(() => { seekRef.current = onSeek; }, [onSeek]);

  // 行级时间 → 词级时间轴（间奏行的圆点 token 在 attachLyricInterludes 已合成）
  const linesWithTokens = useMemo(
    () => simple ? lines : lines.map((l) => (l.tokens ? l : { ...l, tokens: buildLineTokens(l.text, l.from, l.to) })),
    [lines, simple],
  );

  // 行高未测时的估算值（单行：行高 + 上下 padding）
  const estH = lyricFont * 1.18 + lyricFont * 0.5;

  const n = linesWithTokens.length;
  // 整数锚点：一行唱的过程中不变 → 各行 target 不变 → 列表静止；
  // 只有切行时 anchor 变 → RailLine 以 420ms EASE_SCROLL 平滑滚动一次
  // Measure the destination offscreen before moving there. A seek must not hide
  // the entire rail while newly visible rows report their wrapped heights.
  const anchor = layout.anchor;
  if (anchor !== requestedAnchor && linesWithTokens.every((_, i) => Math.abs(i - requestedAnchor) > WINDOW || heights[i] > 0)) {
    setLayout((previous) => ({ ...previous, anchor: requestedAnchor }));
  }
  const layoutReady = linesWithTokens.every((_, i) => Math.abs(i - anchor) > WINDOW || heights[i] > 0);

  const targets = useMemo(() => {
    if (!n || !height || !width) return [];
    const h = linesWithTokens.map((_, i) => heights[i] || estH);
    const tones = linesWithTokens.map((_, i) => lineTone(Math.abs(i - anchor), simple, i === activeIndex));
    const hs = h.map((v, i) => v * tones[i].scale);

    // 从第 0 行顺序累加行高，再把锚点行中心对齐到容器高 ×0.46
    const top = new Array(n).fill(0);
    for (let i = 1; i < n; i += 1) {
      top[i] = top[i - 1] + hs[i - 1] + gapBetween(i - 1, i, anchor);
    }
    const offset = height * FOCUS_RATIO - (top[anchor] + hs[anchor] / 2);

    // RN 中心缩放 → left-top 原点补偿：视觉左缘 = tx + W(1−s)/2，视觉顶缘 = ty + h(1−s)/2
    return linesWithTokens.map((_, i) => {
      const s = tones[i].scale;
      const visualTop = top[i] + offset;
      // 简单模式没有整层渐隐 mask，提前淡出越过上边缘的行，避免被顶栏硬截断。
      const topVisibility = simple ? clamp(visualTop / (lyricFont * 1.5), 0, 1) : 1;
      return {
        scale: s,
        opacity: tones[i].opacity * topVisibility,
        blur: tones[i].blur,
        tx: -width * (1 - s) / 2,
        ty: top[i] + offset - h[i] * (1 - s) / 2,
      };
    });
  }, [linesWithTokens, anchor, activeIndex, heights, height, width, n, estH, simple]);

  if (!(height > 0 && width > 0)) return <View style={{ flex: 1 }} />;

  const rows = (
    <View style={{ flex: 1, opacity: layoutReady ? 1 : 0 }} pointerEvents={layoutReady ? 'auto' : 'none'}>
      {linesWithTokens.map((line, i) => {
        if (Math.abs(i - anchor) > WINDOW + 2 && Math.abs(i - requestedAnchor) > WINDOW + 2) return null;
        const state = i === activeIndex ? 'active' : i < activeIndex ? 'passed' : 'waiting';
        return (
          <RailLine
            key={`${layout.revision}:${i}-${line.from}`}
            line={line}
            target={targets[i] || { tx: 0, ty: -200, scale: 0.85, opacity: 0, blur: 6 }}
            font={lyricFont}
            state={state}
            time={time}
            simple={simple}
            layoutReady={layoutReady}
            measureGlyphs={!simple && (state === 'active' || i === activeIndex + 1)}
            onPress={() => seekRef.current?.(line)}
            onMeasure={(e) => {
              const h = e.nativeEvent.layout.height;
              if (!Number.isFinite(h) || h <= 0) return;
              setLayout((prev) => (prev.revision === layout.revision && Math.abs((prev.heights[i] || 0) - h) > 0.5
                ? { ...prev, heights: { ...prev.heights, [i]: h } } : prev));
            }}
          />
        );
      })}
    </View>
  );
  return simple ? rows : <MaskedView style={{ flex: 1 }} androidRenderingMode="hardware"
    maskElement={<LinearGradient colors={['transparent', '#000', '#000', 'transparent']}
      locations={[0, 0.13, 0.76, 1]} style={{ flex: 1 }} />}>
    {rows}
  </MaskedView>;
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute', left: 0, top: 0, right: 0,
  },
  lineText: {
    color: INACTIVE_COLOR,
  },
  wordRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start',
  },
  wordBlock: {
    position: 'relative', overflow: 'visible', // 柔光层必须能溢出词块，Android 不裁剪
  },
});
