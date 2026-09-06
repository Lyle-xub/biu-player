import AsyncStorage from '@react-native-async-storage/async-storage';

// Local negative feedback is separate from both recommendation profiles.
export function createDiscoveryExclusions(scope) {
  const key = `biu.discovery-exclusions@${scope || 'guest'}`;
  const blocked = new Set(), pending = new Set();
  let writes = Promise.resolve();
  const ready = AsyncStorage.getItem(key).then((raw) => {
    const data = JSON.parse(raw || '{}');
    for (const id of Array.isArray(data.blocked) ? data.blocked : []) if (typeof id === 'string') blocked.add(id);
    for (const id of Array.isArray(data.pending) ? data.pending : []) if (typeof id === 'string') pending.add(id);
  }).catch(() => {});
  const save = () => {
    writes = writes.catch(() => {}).then(() => ready).then(() => AsyncStorage.setItem(key,
      JSON.stringify({ blocked: [...blocked], pending: [...pending] })));
    return writes;
  };
  return {
    ready, pending,
    has: (track) => blocked.has(track?.bvid) || blocked.has(track?.relatedTo),
    reject(track) { blocked.add(track.bvid); pending.add(track.bvid); return save(); },
    addRelated(bvid, items) {
      if (!pending.has(bvid)) return null;
      items.forEach((item) => { if (item?.bvid) blocked.add(item.bvid); });
      pending.delete(bvid);
      return save();
    },
  };
}
