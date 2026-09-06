/* Public source metadata is shared by all segments; recognized fields stay intact. */
(function(root) {
  function create({ view, get, set }) {
    const pending = new Map(), sources = new Map();
    function sourceTrack(t) {
      if (!t?.isSegment) return t;
      const bvid = t.parentBvid || t.bvid;
      const cached = sources.get(bvid) || get(`biu-video-source:${bvid}`, null);
      return cached ? { ...t, parentTitle: t.parentTitle || cached.title,
        parentUp: t.parentUp || cached.up, parentMid: t.parentMid || cached.mid } : t;
    }
    async function resolveSourceTrack(t) {
      const known = sourceTrack(t), bvid = t?.parentBvid || t?.bvid;
      if (!t?.isSegment || !bvid || (known.parentTitle && known.parentUp && known.parentMid)) return known;
      if (!pending.has(bvid)) {
        const request = Promise.resolve().then(() => view(bvid)).then(detail => {
          const source = { title: detail?.title, up: detail?.owner?.name || detail?.up,
            mid: detail?.owner?.mid || detail?.mid };
          if (source.title && source.up && Number(source.mid) > 0) {
            sources.set(bvid, source);
            set(`biu-video-source:${bvid}`, source);
          }
        }).catch(() => {}).finally(() => pending.delete(bvid));
        pending.set(bvid, request);
      }
      await pending.get(bvid);
      return sourceTrack(t);
    }
    return { sourceTrack, resolveSourceTrack };
  }
  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiuTrackSource = api;
})(typeof window !== 'undefined' ? window : globalThis);
