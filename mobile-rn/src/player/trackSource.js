import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { view } from '../api/bili';

const pending = new Map();
const valid = (source) => typeof source?.title === 'string' && source.title.trim()
  && typeof source?.up === 'string' && source.up.trim() && Number(source.mid) > 0;

// Public video metadata is shared by every segment, including old synced lists
// that predate parentTitle/parentUp. Never overwrite the recognized song fields.
export function fetchTrackSource(bvid) {
  if (!bvid) return Promise.resolve(null);
  if (pending.has(bvid)) return pending.get(bvid);
  const request = (async () => {
    const key = `biu.video-source.${bvid}`;
    try {
      const cached = JSON.parse(await AsyncStorage.getItem(key));
      if (valid(cached)) return cached;
    } catch {}
    const detail = await view(bvid);
    const source = { title: detail?.title, up: detail?.owner?.name || detail?.up,
      mid: detail?.owner?.mid || detail?.mid };
    if (!valid(source)) return null;
    await AsyncStorage.setItem(key, JSON.stringify(source)).catch(() => {});
    return source;
  })().catch(() => null).finally(() => pending.delete(bvid));
  pending.set(bvid, request);
  return request;
}

export function useTrackSource(track) {
  const bvid = track?.parentBvid || track?.bvid;
  const missing = !!track?.isSegment && !!bvid && (!track.parentTitle || !track.parentUp || !track.parentMid);
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    if (!missing) return;
    let active = true;
    fetchTrackSource(bvid).then((source) => { if (active && source) setResolved({ bvid, source }); });
    return () => { active = false; };
  }, [bvid, missing]);
  if (!track?.isSegment || resolved?.bvid !== bvid) return track;
  return { ...track, parentBvid: bvid,
    parentTitle: track.parentTitle || resolved.source.title,
    parentUp: track.parentUp || resolved.source.up,
    parentMid: track.parentMid || resolved.source.mid };
}
