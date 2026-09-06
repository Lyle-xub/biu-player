import { joinLyricSeparators, splitLyricGraphemes } from './lyricMotion';

// Two physical slots, independent of scroll/seek history. Interlude markers
// must not change which side owns the next actual lyric.
export function prepareSystemLyrics(lines) {
  return lines.filter((line) => line.text && !line.interlude).map((line, index) => {
    let end = 0;
    // Folia's buildMonetDisplayTokens renders line-timed LRC as one token. Splitting
    // it into guessed language words makes WidgetKit interpolate several masks at
    // once whenever one system update crosses a word boundary.
    const tokens = line.tokens?.length && line.tokens.map((token) => token.text).join('') === line.text
      ? joinLyricSeparators(line.tokens)
      : [{ text: line.text, timed: true, t0: line.from, t1: line.to }];
    const words = tokens.map((token) => {
      const graphemeCount = splitLyricGraphemes(token.text).length;
      end += graphemeCount;
      const timed = token.timed && Number.isFinite(token.t0) && Number.isFinite(token.t1) && token.t1 > token.t0;
      // Millisecond precision avoids repeating long decimals in ActivityKit's
      // 4 KB payload; word text is encoded once in the full line above.
      const range = [end, timed ? Math.round(token.t0 * 1000) / 1000 : -1,
        timed ? Math.round(token.t1 * 1000) / 1000 : -1];
      if (timed && token.graphemeTimings?.length === graphemeCount) {
        token.graphemeTimings.forEach((timing) => {
          range.push(Math.round(timing.startTime * 1000) / 1000,
            Math.round(timing.endTime * 1000) / 1000);
        });
      }
      return range;
    });
    return { id: `${index}:${line.from}`, text: line.text, from: line.from, to: line.to, words };
  });
}

export function systemLyricSlots(lines, position) {
  if (!lines.length) return { slots: [null, null], activeSlot: 0 };
  // A lyric owns its row until the next lyric actually starts. This lets the
  // current scan finish and remain filled throughout instrumental gaps.
  let index = 0;
  for (let i = 1; i < lines.length && position >= lines[i].from; i += 1) index = i;
  const activeSlot = index % 2;
  const slots = [null, null];
  slots[activeSlot] = lines[index];
  slots[1 - activeSlot] = lines[index + 1] || null;
  return { slots, activeSlot };
}
