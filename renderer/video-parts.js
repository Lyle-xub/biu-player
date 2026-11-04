/* Bilibili pages are independent media sources under one BV identifier. */
(function (root) {
  const partKey = (track) => Number(track?.page) > 1 && track.cid ? `${track.bvid}:p:${track.cid}` : track?.bvid;
  function fromDetail(bvid, detail) {
    if (!bvid || !Array.isArray(detail?.pages)) return [];
    const seen = new Set();
    const parts = [];
    for (const item of detail.pages) {
      const cid = Number(item?.cid), page = Number(item?.page);
      if (!Number.isSafeInteger(cid) || cid <= 0 || !Number.isSafeInteger(page) || page < 1 || seen.has(cid)) continue;
      seen.add(cid);
      parts.push({ bvid, cid, page, aid: detail.aid, parentTitle: detail.title, title: (typeof item.part === 'string' && item.part.trim()) || `P${page}`,
        duration: Number(item.duration) || 0, pic: typeof detail.pic === 'string' ? detail.pic.replace(/^(?:http:)?\/\//, 'https://') : undefined,
        dimension: item.dimension, up: detail.owner?.name, mid: detail.owner?.mid });
    }
    return parts.length > 1 ? parts.sort((a, b) => a.page - b.page) : [];
  }
  function currentPart(track, parts) {
    if (!track?.bvid || track.isSegment || track.isLive || parts?.[0]?.bvid !== track.bvid) return null;
    return track.cid ? parts.find(part => part.cid === Number(track.cid)) || null : parts[0];
  }
  function select(queue, index, current, parts, cid) {
    if (!current?.bvid || current.isLive || current.isSegment || parts?.[0]?.bvid !== current.bvid) return null;
    const target = cid === 'all' ? 0 : parts.findIndex(part => String(part.cid) === String(cid));
    if (target < 0) return null;
    const active = queue[index];
    if (!active || active.isSegment || partKey(active) !== partKey(current)) return { tracks: parts, index: target };
    let start = index, end = index + 1;
    const sameGroup = (track) => track?.bvid === current.bvid && !track.isSegment && Number(track.page) > 0;
    if (sameGroup(active)) {
      while (sameGroup(queue[start - 1])) start--;
      while (sameGroup(queue[end])) end++;
    }
    return { tracks: [...queue.slice(0, start), ...parts, ...queue.slice(end)], index: start + target };
  }
  const url = (track) => `https://www.bilibili.com/video/${track.bvid}${Number(track.page) > 1 ? `/?p=${track.page}` : ''}`;
  const api = { fromDetail, currentPart, select, partKey, url };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiuVideoParts = api;
})(typeof window !== 'undefined' ? window : globalThis);
