import { segmentLyricWords } from 'biu-lyric-monet';

const INTERLUDE_MIN_GAP = 3;
const INTERLUDE_TEXT = '......';

/* ---------- 词级时间轴合成（沿用 buildLineTokens） ---------- */
// iOS uses the native Natural Language tokenizer above to match desktop's
// semantic word boundaries. These fallbacks cover Android, tests and runtimes
// where the native helper is unavailable.
const lyricGraphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
const lyricWordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

export function splitLyricGraphemes(text) {
  if (!text) return [];
  if (lyricGraphemeSegmenter) return Array.from(lyricGraphemeSegmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

// Hermes on iOS does not consistently expose Intl.Segmenter. Keeping every CJK
// grapheme as its own word turns the two Folia glow shadows into visible tiles.
// Group neighbouring glyphs into short word-like runs while retaining punctuation
// and enough break opportunities for wrapped lyric lines.
export function fallbackLyricWordSegments(text) {
  const result = [];
  let run = [];
  const flush = () => {
    while (run.length) result.push({ segment: run.splice(0, 4).join(''), isWordLike: true });
  };
  splitLyricGraphemes(text).forEach((grapheme) => {
    if (/^\s$/u.test(grapheme) || /^\p{P}$/u.test(grapheme)) {
      flush();
      result.push({ segment: grapheme, isWordLike: false });
    } else {
      run.push(grapheme);
    }
  });
  flush();
  return result;
}

export function buildLineTokens(text, from, to) {
  const nativeSegments = segmentLyricWords?.(text);
  const segments = nativeSegments?.length ? nativeSegments : lyricWordSegmenter
    ? Array.from(lyricWordSegmenter.segment(text))
    : fallbackLyricWordSegments(text);
  const timedGraphemes = segments.reduce(
    (sum, seg) => sum + (seg.isWordLike ? splitLyricGraphemes(seg.segment).length : 0), 0);
  const unit = timedGraphemes > 0 ? Math.max(0, to - from) / timedGraphemes : 0;
  let cursor = from;
  return joinLyricSeparators(segments.map((seg, index) => {
    const tokenText = seg.segment;
    if (!seg.isWordLike || unit <= 0) {
      return { text: tokenText, t0: null, t1: null, timed: false };
    }
    const count = splitLyricGraphemes(tokenText).length;
    const t0 = cursor;
    const t1 = index === segments.length - 1 ? to : cursor + unit * count;
    cursor = t1;
    return { text: tokenText, t0, t1, timed: true };
  }).filter((token) => token.text));
}

// Punctuation and spaces share the neighbouring word's geometry and clock.
// Keeping them as untimed drawing runs left holes in the sweep and made the
// horizontal scroll cursor jump at every separator.
export function joinLyricSeparators(tokens) {
  const result = [];
  let prefix = '';
  for (const token of tokens) {
    if (!token.timed && /^[\s\p{P}\p{S}]+$/u.test(token.text)) {
      if (result.length) {
        const previous = result[result.length - 1];
        previous.text += token.text;
        if (previous.graphemeTimings?.length) {
          previous.graphemeTimings = previous.graphemeTimings.concat(
            splitLyricGraphemes(token.text).map(() => ({ startTime: previous.t1, endTime: previous.t1 })),
          );
        }
      }
      else prefix += token.text;
    } else {
      const next = { ...token, text: prefix + token.text };
      if (prefix && token.graphemeTimings?.length) {
        next.graphemeTimings = splitLyricGraphemes(prefix)
          .map(() => ({ startTime: token.t0, endTime: token.t0 }))
          .concat(token.graphemeTimings);
      }
      result.push(next);
      prefix = '';
    }
  }
  if (prefix) result.push({ text: prefix, timed: false, t0: null, t1: null });
  return result;
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


const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Folia Monet: interpolate the measured glyph boundary, then extend the soft edge
// so the last glyph is completely filled at the word end. Times are seconds.
export function sweepEndAt(time, token, offsets, edge) {
  const full = offsets.at(-1) || 0;
  if (time <= token.t0 || full <= 0) return 0;
  if (time >= token.t1) return full + edge;
  const count = offsets.length - 1;
  const timings = token.graphemeTimings;
  let width = 0;
  if (timings?.length === count) {
    for (let i = 0; i < count; i += 1) {
      const start = Math.max(token.t0, timings[i].startTime);
      const end = Math.max(start, timings[i].endTime);
      if (time < start) { width = offsets[i]; break; }
      if (time <= end) {
        width = offsets[i] + (offsets[i + 1] - offsets[i])
          * clamp((time - start) / Math.max(0.001, end - start), 0, 1);
        break;
      }
      width = offsets[i + 1];
    }
  } else {
    const cursor = clamp((time - token.t0) / Math.max(0.001, token.t1 - token.t0), 0, 1) * count;
    const i = Math.min(Math.floor(cursor), count - 1);
    width = offsets[i] + (offsets[i + 1] - offsets[i]) * (cursor - i);
  }
  return width + edge * clamp(width / full, 0, 1);
}

export function glowAt(time, token, lineEnd) {
  if (time <= token.t0) return 0;
  const rise = Math.max(0.001, token.t1 - token.t0) * 1.18;
  const peak = token.t0 + rise;
  const end = Math.max(peak + 0.18, lineEnd, token.t1 + 1.05);
  const p = time <= peak ? clamp((time - token.t0) / rise, 0, 1)
    : 1 - clamp((time - peak) / Math.max(0.18, end - peak), 0, 1);
  return p * p * (3 - 2 * p);
}

// Compile the same measured-glyph trajectory into native interpolation segments.
// Timing gaps remain flat; equal-duration fallback still respects each glyph's width.
export function sweepFrames(token, offsets, edge) {
  const count = offsets.length - 1;
  if (count < 1 || !Number.isFinite(token.t0) || !Number.isFinite(token.t1) || token.t1 <= token.t0) {
    return { inputRange: [0, 1], outputRange: [0, 0], extrapolate: 'clamp' };
  }
  const times = token.graphemeTimings?.length === count
    ? token.graphemeTimings.flatMap((t) => [t.startTime, t.endTime])
    : Array.from({ length: count + 1 }, (_, i) => token.t0 + (token.t1 - token.t0) * i / count);
  const inputRange = [...new Set([token.t0, ...times, token.t1])]
    .filter((t) => t >= token.t0 && t <= token.t1).sort((a, b) => a - b);
  return { inputRange, outputRange: inputRange.map((t) => sweepEndAt(t, token, offsets, edge)), extrapolate: 'clamp' };
}

export function glowFrames(token, lineEnd) {
  const peak = token.t0 + Math.max(0.001, token.t1 - token.t0) * 1.18;
  const end = Math.max(peak + 0.18, lineEnd, token.t1 + 1.05);
  const inputRange = Array.from({ length: 25 }, (_, i) => i <= 12
    ? token.t0 + (peak - token.t0) * i / 12 : peak + (end - peak) * (i - 12) / 12);
  return { inputRange, outputRange: inputRange.map((t) => glowAt(t, token, lineEnd) * 0.88), extrapolate: 'clamp' };
}

// Predict where a normal 250ms playback sample should be. The UI owns a
// continuous native clock; this bound is only used to recognize real drift.
export const LYRIC_CLOCK_AHEAD = 0.6;
export function lyricTimeAt(clock, now) {
  return clock.pos + (clock.playing ? clamp((now - clock.ts) / 1000, 0, LYRIC_CLOCK_AHEAD) : 0);
}

export function shouldResetLyricClock(previous, sample) {
  return !previous || !sample.playing || sample.playing !== previous.playing
    || sample.revision !== previous.revision
    || Math.abs(sample.pos - lyricTimeAt(previous, sample.ts)) > 0.35;
}
