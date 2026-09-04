export function segmentRange(track) {
  if (!track?.isSegment) return null;
  const from = Math.max(0, Number(track.from) || 0);
  const to = Number(track.to ?? (from + Number(track.duration)));
  return Number.isFinite(to) && to > from ? { from, to } : null;
}

export function trackKeyOf(track) {
  if (!track) return '';
  const base = track.bvid || String(track.roomid || track.aid || '');
  const range = segmentRange(track);
  return range ? `${base}:${track.cid || 0}:${range.from}:${range.to}` : base;
}

export function segmentTracks(track, segments) {
  return segments.filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to > s.from && s.from >= 0).map((s, index) => ({
    ...track, parentBvid: track.parentBvid || track.bvid,
    parentTitle: track.parentTitle || track.title, isSegment: true,
    title: s.match?.title || String(s.name || '').trim() || `片段 ${index + 1}`,
    up: s.match?.artist || track.up, pic: s.match?.pic || track.pic,
    lyricRef: s.match && (s.match.id || s.match.songmid)
      ? { source: s.match.lrcSource || s.match.source, id: s.match.id, songmid: s.match.songmid } : undefined,
    from: s.from, to: s.to, duration: s.to - s.from,
  }));
}
