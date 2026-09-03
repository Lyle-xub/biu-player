/* Biu Player RN · AMLL 风格歌词轨道（连续滚动 + 行级模糊 + 逐词白色光头）
 * 对照 github.com/amll-dev/applemusic-like-lyrics 视觉重做：
 * - 连续滚动：小数锚点 fracAnchor = 活跃行号 + 行内进度（line.from → 下一行.from，
 *   easeInOutQuad 缓动）；每次 position tick（PlayerContext ~250ms）重算全部可见行
 *   target，tx/ty/scale/opacity 用 300ms 线性 timing 追踪（native driver）——
 *   视觉上是歌词随播放缓缓上移，绝不一行行跳；seek/切行（漂移 >0.75s）用 200ms 快速就位。
 * - 行级模糊/明暗是 fracAnchor 距离 d = |i − fracAnchor| 的连续函数（不是离散档）：
 *   blur = d<0.15 ? 0 : min(6, d×2.2)（RN 0.86 新架构 View filter:[{blur}]，JS 线程按 tick
 *   直接写 style，仅可见 ~9 行参与）；opacity = max(.18, 1−d×.28)，|d|>4 为 0；
 *   scale = max(.85, 1−d×.04)。行间间距 14px，接近锚点平滑过渡到 18px。
 * - 活跃行逐词光头（整页单色白灰系，无粉色）：双层文本——底层整行 rgba(255,255,255,.45)
 *   + filter blur 1.2（未唱词的「灰+微糊」），前景层逐词 opacity 0→1 在词起唱 200ms 内
 *   crossfade 到纯白 #fff + 白色光晕（textShadowColor rgba(255,255,255,.9)、
 *   radius = 字号×.5、offset 0）；唱完的词保持白+光晕，整行唱完（position ≥ line.to）
 *   光晕 1s 内线性收敛到一半。词级时间轴沿用 buildLineTokens（Intl.Segmenter word
 *   粒度，回退字素均摊）；间奏 6 圆点复用同一套 token 机制，逐点点亮同为白色系。
 * - 保留：MaskedView 上下 alpha 渐隐遮罩（在 PlayerScreen）、左对齐、点行 seek、
 *   46% 焦点锚点、间奏行插入逻辑、非活跃行 numberOfLines={2}。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

const FOCUS_RATIO = 0.46;       // 活跃行垂直中心在容器高 ×0.46
const GAP_FAR = 14;             // 常规行距
const GAP_NEAR = 18;            // 锚点附近行距（连续过渡）
const WINDOW = 4;               // |d| > 4 完全透明
const TICK_MS = 300;            // 每 tick 连续追踪时长（线性）
const JUMP_MS = 200;            // seek/切行快速就位时长
const DRIFT_TOLERANCE = 0.75;   // position 跳变阈值（秒）
const WORD_FADE_MS = 200;       // 词 crossfade：灰+微糊 → 白+光晕
const GLOW_SETTLE_MS = 1000;    // 整行唱完光晕收敛时长
const GLOW_SETTLE_TO = 0.5;     // 收敛到一半
const UNSUNG_BLUR = 1.2;        // 活跃行未唱词微糊（px）
const GLOW_COLOR = 'rgba(255,255,255,0.9)';
const GLOW_RADIUS_SCALE = 0.5;  // 光晕半径 = 字号 × .5
const TOKEN_BASE = 'rgba(255,255,255,0.45)'; // 活跃行未唱词基色
const INACTIVE_COLOR = 'rgba(255,255,255,0.72)'; // 非活跃行灰白（再乘 tone.opacity 压暗）

const INTERLUDE_MIN_GAP = 3;
const INTERLUDE_TEXT = '......';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOutQuad = (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);
const EASE_JUMP = Easing.bezier(0.22, 0.61, 0.36, 1);

/* ---------- 词级时间轴合成（沿用 buildLineTokens） ---------- */
// Hermes 可能没有 Intl.Segmenter，回退 Array.from 字素
const lyricGraphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
const lyricWordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

function splitLyricGraphemes(text) {
  if (!text) return [];
  if (lyricGraphemeSegmenter) return Array.from(lyricGraphemeSegmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

export function buildLineTokens(text, from, to) {
  const segments = lyricWordSegmenter
    ? Array.from(lyricWordSegmenter.segment(text))
    : splitLyricGraphemes(text).map((ch) => ({
      segment: ch,
      isWordLike: !/^\s$/.test(ch) && !/^\p{P}$/u.test(ch),
    }));
  const timedGraphemes = segments.reduce(
    (sum, seg) => sum + (seg.isWordLike ? splitLyricGraphemes(seg.segment).length : 0), 0);
  const unit = timedGraphemes > 0 ? Math.max(0, to - from) / timedGraphemes : 0;
  let cursor = from;
  return segments.map((seg, index) => {
    const tokenText = seg.segment;
    if (!seg.isWordLike || unit <= 0) {
      return { text: tokenText, t0: null, t1: null, timed: false };
    }
    const count = splitLyricGraphemes(tokenText).length;
    const t0 = cursor;
    const t1 = index === segments.length - 1 ? to : cursor + unit * count;
    cursor = t1;
    return { text: tokenText, t0, t1, timed: true };
  }).filter((token) => token.text);
}

/* 间奏圆点：间隔 > 3s 插入 '......'，6 个圆点均分时长 */
export function attachLyricInterludes(lines) {
  const result = [];
  const createInterlude = (start, end) => {
    const duration = Math.max(0, end - start);
    const wordDuration = duration / 6;
    return {
      from: start, to: end, text: INTERLUDE_TEXT, interlude: true,
      tokens: Array.from({ length: 6 }, (_, index) => ({
        text: '.', timed: true,
        t0: start + index * wordDuration,
        t1: start + (index + 1) * wordDuration,
      })),
    };
  };
  if (lines.length && lines[0].from > INTERLUDE_MIN_GAP) {
    result.push(createInterlude(0.5, lines[0].from - 0.5));
  }
  lines.forEach((line, index) => {
    result.push(line);
    const next = lines[index + 1];
    if (next && next.from - line.to > INTERLUDE_MIN_GAP) {
      result.push(createInterlude(line.to + 0.05, next.from - 0.05));
    }
  });
  return result;
}

/* ---------- 连续锚点与行级连续函数 ---------- */
// fracAnchor：活跃行号 + 行内进度（easeInOutQuad 让起步/收尾更柔）
function computeFracAnchor(lines, activeIndex, position) {
  const n = lines.length;
  if (!n || activeIndex < 0) return 0;
  const line = lines[activeIndex];
  const next = lines[activeIndex + 1];
  if (!next || next.from <= line.from) return activeIndex;
  const p = clamp((position - line.from) / (next.from - line.from), 0, 1);
  return activeIndex + easeInOutQuad(p);
}

// d = |i − fracAnchor|（小数）的连续函数
function lineTone(d) {
  if (d > WINDOW) return { scale: 0.85, opacity: 0, blur: 6 };
  return {
    scale: Math.max(0.85, 1 - d * 0.04),
    opacity: Math.max(0.18, 1 - d * 0.28),
    blur: d < 0.15 ? 0 : Math.min(6, d * 2.2),
  };
}

// 行距：离锚点越近越接近 18px，越远越接近 14px（连续）
function gapBetween(a, b, f) {
  const closeness = clamp(1 - Math.min(Math.abs(a - f), Math.abs(b - f)), 0, 1);
  return GAP_FAR + (GAP_NEAR - GAP_FAR) * closeness;
}

function useLyricFont() {
  const { width } = useWindowDimensions();
  return clamp(width * 0.034, 30, 48);
}

/* ---------- 前景层逐词 span：v=透明度（crossfade），g=白色光晕 ---------- */
function TokenSpan({ token, vals, font }) {
  if (!vals) return <Text style={{ color: '#fff' }}>{token.text}</Text>;
  const shadowColor = vals.g.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0)', GLOW_COLOR],
  });
  const shadowRadius = vals.g.interpolate({
    inputRange: [0, 1],
    outputRange: [0, font * GLOW_RADIUS_SCALE],
  });
  return (
    <Animated.Text
      style={{
        opacity: vals.v,
        color: '#fff',
        textShadowColor: shadowColor,
        textShadowRadius: shadowRadius,
        textShadowOffset: { width: 0, height: 0 },
      }}
    >
      {token.text}
    </Animated.Text>
  );
}

/* ---------- 单行：target 每 tick 连续变化，300ms 线性追踪 ---------- */
const RailLine = React.memo(function RailLine({
  line, target, font, state, jump, onPress, onMeasure, position, playing,
}) {
  const anims = useRef({
    tx: new Animated.Value(target.tx),
    ty: new Animated.Value(target.ty),
    sc: new Animated.Value(target.scale),
    op: new Animated.Value(target.opacity),
  }).current;

  useEffect(() => {
    const duration = jump ? JUMP_MS : TICK_MS;
    const easing = jump ? EASE_JUMP : Easing.linear;
    Animated.parallel([
      Animated.timing(anims.tx, { toValue: target.tx, duration, easing, useNativeDriver: true }),
      Animated.timing(anims.ty, { toValue: target.ty, duration, easing, useNativeDriver: true }),
      Animated.timing(anims.sc, { toValue: target.scale, duration, easing, useNativeDriver: true }),
      Animated.timing(anims.op, { toValue: target.opacity, duration, easing, useNativeDriver: true }),
    ]).start();
  }, [target.tx, target.ty, target.scale, target.opacity, jump]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- 活跃行逐词光头调度 ----- */
  const tokens = line.tokens || [];
  const tokenVals = useMemo(
    () => tokens.map((tok) => (tok.timed ? { v: new Animated.Value(0), g: new Animated.Value(0) } : null)),
    [tokens],
  );
  const running = useRef([]);
  const baseRef = useRef({ pos: 0, ts: 0 });
  const settleDoneRef = useRef(false);

  const stopTokens = () => {
    running.current.forEach((a) => a.stop());
    running.current = [];
  };

  // 按 now 重排程：已唱词直接驻留（白+光晕），未唱词 delay 到 t0 后 200ms crossfade
  const reschedule = (now) => {
    stopTokens();
    baseRef.current = { pos: now, ts: Date.now() };
    settleDoneRef.current = false;
    tokens.forEach((tok, i) => {
      if (!tok.timed) return;
      const vals = tokenVals[i];
      const sung = now >= tok.t0;
      vals.v.setValue(sung ? 1 : 0);
      vals.g.setValue(sung ? 1 : 0);
      if (sung) return;
      const anim = Animated.sequence([
        Animated.delay(Math.max(0, (tok.t0 - now) * 1000)),
        Animated.parallel([
          Animated.timing(vals.v, {
            toValue: 1, duration: WORD_FADE_MS, easing: Easing.linear, useNativeDriver: false,
          }),
          Animated.timing(vals.g, {
            toValue: 1, duration: WORD_FADE_MS, easing: Easing.linear, useNativeDriver: false,
          }),
        ]),
      ]);
      running.current.push(anim);
      anim.start();
    });
  };

  const setTokensFinal = (v, g) => {
    tokens.forEach((tok, i) => {
      if (!tok.timed) return;
      tokenVals[i].v.setValue(v);
      tokenVals[i].g.setValue(g);
    });
  };

  // 整行唱完：光晕 1s 内收敛一半（别骤降）
  const settleGlow = () => {
    const settles = [];
    tokens.forEach((tok, i) => {
      if (!tok.timed) return;
      tokenVals[i].v.setValue(1);
      settles.push(Animated.timing(tokenVals[i].g, {
        toValue: GLOW_SETTLE_TO, duration: GLOW_SETTLE_MS, easing: Easing.linear, useNativeDriver: false,
      }));
    });
    if (settles.length) {
      const anim = Animated.parallel(settles);
      running.current.push(anim);
      anim.start();
    }
  };

  // 行状态切换：active 排程 / passed 全部驻留（光晕半收敛）/ waiting 全部复位
  useEffect(() => {
    if (state === 'active') reschedule(position);
    else {
      stopTokens();
      if (state === 'passed') setTokensFinal(1, GLOW_SETTLE_TO);
      else setTokensFinal(0, 0);
    }
    return stopTokens;
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // 暂停冻结，恢复时按新 now 重排程
  useEffect(() => {
    if (state !== 'active') return;
    if (playing) reschedule(position);
    else {
      stopTokens();
      baseRef.current = { pos: position, ts: Date.now() };
    }
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // seek 漂移检测 + 行唱完光晕收敛
  useEffect(() => {
    if (state !== 'active' || !playing) return;
    const { pos, ts } = baseRef.current;
    const expected = pos + (Date.now() - ts) / 1000;
    if (Math.abs(position - expected) > 0.3) {
      reschedule(position);
      return;
    }
    if (!settleDoneRef.current && position >= line.to) {
      settleDoneRef.current = true;
      stopTokens();
      settleGlow();
    }
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasTokens = state === 'active' && tokens.length > 0;
  const padH = font * 0.72;
  const padT = font * 0.16;
  const padB = font * 0.34;
  const textStyle = [
    styles.lineText,
    {
      fontSize: font,
      lineHeight: font * 1.18,
      fontWeight: state === 'active' ? '700' : '600',
    },
    line.interlude && { letterSpacing: font * 0.32 },
  ];

  // 行级模糊：filter 是 View style prop（Text 不支持），包一层 View；JS 线程按 tick 写
  const lineBlur = target.blur >= 0.15 ? { filter: [{ blur: Math.round(target.blur * 10) / 10 }] } : null;

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
      {hasTokens ? (
        <>
          {/* 底层：整行灰白 + 微糊（未唱词透出的部分）；绝对定位，与前景同 padding 对齐 */}
          <View
            pointerEvents="none"
            style={[styles.underlay, { paddingHorizontal: padH, paddingTop: padT, paddingBottom: padB }, { filter: [{ blur: UNSUNG_BLUR }] }]}
          >
            <Text style={[textStyle, { color: TOKEN_BASE }]}>{line.text}</Text>
          </View>
          {/* 前景层（在流内，定义行高）：逐词 200ms crossfade 到纯白 + 白色光晕；
              无定时 token（空格/标点）跟随前一个词的 v/g */}
          <Text
            style={textStyle}
            onPress={line.interlude ? undefined : onPress}
          >
            {(() => {
              let lastTimed = -1;
              return tokens.map((tok, i) => {
                if (tok.timed) lastTimed = i;
                return (
                  <TokenSpan
                    key={i}
                    token={tok}
                    vals={lastTimed >= 0 ? tokenVals[lastTimed] : null}
                    font={font}
                  />
                );
              });
            })()}
          </Text>
        </>
      ) : (
        <View style={lineBlur}>
          <Text
            style={[textStyle, { color: INACTIVE_COLOR }]}
            numberOfLines={2}
            onPress={line.interlude ? undefined : onPress}
          >
            {line.text}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}, (prev, next) => (
  prev.line === next.line
  && prev.state === next.state
  && prev.font === next.font
  && prev.jump === next.jump
  && prev.position === next.position
  && prev.playing === next.playing
  && prev.target.tx === next.target.tx
  && prev.target.ty === next.target.ty
  && prev.target.scale === next.target.scale
  && prev.target.opacity === next.target.opacity
  && prev.target.blur === next.target.blur
));

export default function LyricsRail({ lines, activeIndex, onSeek, height, width, position, playing }) {
  const lyricFont = useLyricFont();
  const [heights, setHeights] = useState({}); // index -> 未缩放布局高（含 padding）
  const lastPosRef = useRef(position);

  // 行级时间 → 词级时间轴（间奏行的圆点 token 在 attachLyricInterludes 已合成）
  const linesWithTokens = useMemo(
    () => lines.map((l) => (l.tokens ? l : { ...l, tokens: buildLineTokens(l.text, l.from, l.to) })),
    [lines],
  );

  // 行高未测时的估算值（单行：行高 + 上下 padding）
  const estH = lyricFont * 1.18 + lyricFont * 0.5;

  const n = linesWithTokens.length;
  const fracAnchor = computeFracAnchor(linesWithTokens, activeIndex, position);
  // position 跳变（seek / 切歌）→ 快速就位；否则连续追踪
  const jump = Math.abs(position - lastPosRef.current) > DRIFT_TOLERANCE;
  useEffect(() => { lastPosRef.current = position; }, [position]);

  const targets = useMemo(() => {
    if (!n || !height || !width) return [];
    const h = linesWithTokens.map((_, i) => heights[i] || estH);
    const tones = linesWithTokens.map((_, i) => lineTone(Math.abs(i - fracAnchor)));
    const hs = h.map((v, i) => v * tones[i].scale);

    // 从第 0 行顺序累加（行距是 fracAnchor 的连续函数），再把 fracAnchor
    // 处（相邻两行中心的 lerp）对齐到容器高 ×0.46
    const top = new Array(n).fill(0);
    for (let i = 1; i < n; i += 1) {
      top[i] = top[i - 1] + hs[i - 1] + gapBetween(i - 1, i, fracAnchor);
    }
    const fi = clamp(Math.floor(fracAnchor), 0, n - 1);
    const ci = clamp(fi + 1, 0, n - 1);
    const frac = clamp(fracAnchor - fi, 0, 1);
    const centerAt = (top[fi] + hs[fi] / 2)
      + ((top[ci] + hs[ci] / 2) - (top[fi] + hs[fi] / 2)) * frac;
    const offset = height * FOCUS_RATIO - centerAt;

    // RN 中心缩放 → left-top 原点补偿：视觉左缘 = tx + W(1−s)/2，视觉顶缘 = ty + h(1−s)/2
    return linesWithTokens.map((_, i) => {
      const s = tones[i].scale;
      return {
        scale: s,
        opacity: tones[i].opacity,
        blur: tones[i].blur,
        tx: -width * (1 - s) / 2,
        ty: top[i] + offset - h[i] * (1 - s) / 2,
      };
    });
  }, [linesWithTokens, fracAnchor, heights, height, width, n, estH]);

  return (
    <View style={{ flex: 1 }}>
      {linesWithTokens.map((line, i) => {
        const state = i === activeIndex ? 'active' : i < activeIndex ? 'passed' : 'waiting';
        return (
          <RailLine
            key={`${i}-${line.from}`}
            line={line}
            target={targets[i] || { tx: 0, ty: -200, scale: 0.85, opacity: 0, blur: 6 }}
            font={lyricFont}
            state={state}
            jump={jump}
            position={state === 'active' ? position : 0}
            playing={state === 'active' ? playing : false}
            onPress={() => onSeek && onSeek(line)}
            onMeasure={(e) => {
              const h = e.nativeEvent.layout.height;
              setHeights((prev) => (Math.abs((prev[i] || 0) - h) > 0.5 ? { ...prev, [i]: h } : prev));
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute', left: 0, top: 0, right: 0,
  },
  lineText: {
    color: INACTIVE_COLOR,
  },
  underlay: {
    position: 'absolute', left: 0, top: 0, right: 0,
  },
});
