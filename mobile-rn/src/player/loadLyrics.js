import * as bili from '../api/bili';
import { attachLyricInterludes } from './lyricMotion';
import { segmentRange } from './track';

// B 站字幕常用音符包裹正文；播放器与系统歌词共用同一清洗和匹配路径。
export const cleanLyricText = (text) => String(text || '')
  .replace(/^[\s♪♫♬♩♭♮♯]+|[\s♪♫♬♩♭♮♯]+$/gu, '')
  .trim();

export async function loadTrackLyrics(track, setting) {
  if (!track || track.isLive) return [];
  let lines = setting?.lines;
  if (!lines && track.lyricRef && setting?.match !== null) {
    lines = await bili.lyricForMatch(track.lyricRef);
  }
  if (!lines) lines = await bili.searchLyric(track.title, track.up, track.duration || 0);
  if (!lines && track.bvid && track.cid) {
    lines = await bili.subtitles(track.bvid, track.cid).catch(() => null);
    const range = segmentRange(track);
    if (range && lines) {
      lines = lines
        .filter((line) => line.to > range.from && line.from < range.to)
        .map((line) => ({
          ...line,
          from: Math.max(0, line.from - range.from),
          to: Math.min(range.to, line.to) - range.from,
        }));
    }
  }
  const cleaned = (lines || [])
    .map((line) => ({ ...line, text: cleanLyricText(line.text) }))
    .filter((line) => line.interlude || line.text);
  return cleaned.length ? attachLyricInterludes(cleaned) : [];
}
