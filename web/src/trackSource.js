import { useEffect, useState } from 'react';
import BiuTrackSource from '../../renderer/track-source.js';

export const { sourceTrack, resolveSourceTrack } = BiuTrackSource.create({
  view: bvid => window.api.view(bvid),
  get: (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
});
export function useTrackSource(track) {
  const [resolved, setResolved] = useState(null);
  const bvid = track?.parentBvid || track?.bvid;
  const known = sourceTrack(track);
  const missing = !!track?.isSegment && (!known.parentTitle || !known.parentUp || !known.parentMid);
  useEffect(() => {
    if (!missing) return;
    let active = true;
    resolveSourceTrack(track).then(value => { if (active) setResolved({ bvid, value }); });
    return () => { active = false; };
  }, [bvid, missing]);
  return resolved?.bvid === bvid && track?.isSegment
    ? { ...known, parentTitle: known.parentTitle || resolved.value.parentTitle,
      parentUp: known.parentUp || resolved.value.parentUp, parentMid: known.parentMid || resolved.value.parentMid } : known;
}
