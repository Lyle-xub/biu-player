import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { view } from '../api/bili';

const pending = new Map();
const sources = new Map();
const valid = (source) => typeof source?.title === 'string' && source.title.trim()
  && typeof source?.up === 'string' && source.up.trim() && Number(source.mid) > 0;

// Public video metadata is shared by every segment, including old synced lists
// that predate parentTitle/parentUp. Never overwrite the recognized song fields.
export function fetchTrackSource(bvid) {
  if (!bvid) return Promise.resolve(null);
  if (sources.has(bvid)) return Promise.resolve(sources.get(bvid));
  if (pending.has(bvid)) return pending.get(bvid);
  const request = (async () => {
    const key = `biu.video-source.${bvid}`;
    try {
      const cached = JSON.parse(await AsyncStorage.getItem(key));
      if (valid(cached)) { sources.set(bvid, cached); return cached; }
    } catch {}
    if (sources.has(bvid)) return sources.get(bvid);
    const detail = await view(bvid);
    const source = { title: detail?.title, up: detail?.owner?.name || detail?.up,
      mid: detail?.owner?.mid || detail?.mid };
    if (!valid(source)) return null;
    sources.set(bvid, source);
    await AsyncStorage.setItem(key, JSON.stringify(source)).catch(() => {});
    return source;
  })().catch(() => sources.get(bvid) || null).finally(() => pending.delete(bvid));
  pending.set(bvid, request);
  return request;
}

export function useTrackSource(track) {
  const bvid = track?.parentBvid || track?.bvid;
  const missing = !!track?.isSegment && !!bvid && (!track.parentTitle || !track.parentUp || !track.parentMid);
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    if (track?.isSegment && bvid && !missing) {
      const source = { title: track.parentTitle, up: track.parentUp, mid: track.parentMid };
      const cached = sources.get(bvid);
      if (valid(source) && (source.title !== cached?.title || source.up !== cached?.up || source.mid !== cached?.mid)) {
        sources.set(bvid, source);
        AsyncStorage.setItem(`biu.video-source.${bvid}`, JSON.stringify(source)).catch(() => {});
      }
    }
    if (!missing) return;
    let active = true;
    fetchTrackSource(bvid).then((source) => { if (active && source) setResolved({ bvid, source }); });
    return () => { active = false; };
  }, [bvid, missing, track?.isSegment, track?.parentTitle, track?.parentUp, track?.parentMid]);
  // FlatList recycles rows. Read the shared cache during render so remounting or
  // returning to this video never blanks attribution while AsyncStorage loads.
  if (!track?.isSegment) return track;
  const source = sources.get(bvid) || (resolved && resolved.bvid === bvid ? resolved.source : null);
  if (!source) return track;
  return { ...track, parentBvid: bvid,
    parentTitle: track.parentTitle || source.title,
    parentUp: track.parentUp || source.up,
    parentMid: track.parentMid || source.mid };
}
