/* Shared wire format for desktop and RN. First contact merges; snapshots track deletions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./recommendation-profile'));
  else root.BiuLibrarySync = factory(root.BiuRecommendation);
})(typeof window === 'object' ? window : this, function (recommendation) {
  const MAX_TRACKS = 20000;
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max = 2048) => typeof v === 'string' && v.length <= max;
  function track(v) {
    if (!object(v) || (v.isLive ? !(Number(v.roomid) > 0) : !/^BV\w+$/.test(v.bvid || ''))) throw new Error('歌曲数据无效');
    const out = {};
    for (const k of ['bvid', 'aid', 'cid', 'mid', 'title', 'up', 'duration', 'roomid', 'area', 'online', 'parentBvid', 'parentTitle', 'parentUp', 'parentMid', 'addedAt']) {
      if (text(v[k]) || Number.isFinite(v[k])) out[k] = v[k];
    }
    if (text(v.pic, 8192) && /^https?:\/\//i.test(v.pic)) out.pic = v.pic;
    if (v.isLive) out.isLive = true;
    if (v.isSegment) {
      if (!Number.isFinite(v.from) || v.from < 0 || !Number.isFinite(v.to) || v.to <= v.from) throw new Error('分切歌曲时间无效');
      Object.assign(out, { isSegment: true, from: v.from, to: v.to, duration: v.to - v.from });
    }
    if (object(v.lyricRef) && ['qq', 'netease', 'ncm'].includes(v.lyricRef.source)) {
      out.lyricRef = { source: v.lyricRef.source };
      for (const k of ['id', 'songmid']) if (text(v.lyricRef[k], 256) || Number.isFinite(v.lyricRef[k])) out.lyricRef[k] = v.lyricRef[k];
    }
    return out;
  }
  const trackKey = (t) => t.isLive ? `live:${t.roomid}` : t.isSegment
    ? `${t.bvid}:${t.cid || 0}:${t.from}:${t.to}` : t.bvid;
  function tracks(values) {
    if (!Array.isArray(values) || values.length > MAX_TRACKS) throw new Error('歌曲数量无效或超过 20000 首');
    return unique(values.map(track), trackKey);
  }
  function unique(values, key) {
    const result = new Map();
    values.forEach((v) => { if (!result.has(key(v))) result.set(key(v), v); });
    return [...result.values()];
  }
  function normalize(v) {
    if (!object(v) || v.version !== 1 || !Array.isArray(v.playlists) || v.playlists.length > 1000) throw new Error('同步数据格式或版本不兼容');
    const likes = tracks(v.likes);
    const library = tracks(v.library || []);
    let count = likes.length + library.length;
    const playlists = v.playlists.map((p) => {
      if (!object(p) || !(text(p.id, 128) && p.id || Number.isSafeInteger(p.id) && p.id > 0)
        || !text(p.title) || !p.title.trim()) throw new Error('歌单数据无效');
      const out = { id: p.id, title: p.title, tracks: tracks(p.tracks) };
      count += out.tracks.length;
      if (count > MAX_TRACKS) throw new Error('本次同步歌曲总数超过 20000 首');
      if (Number.isFinite(p.createdAt)) out.createdAt = p.createdAt;
      if (text(p.desc, 8192)) out.desc = p.desc;
      if (text(p.cover, 512000) && /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(p.cover)) out.cover = p.cover;
      return out;
    });
    if (new Set(playlists.map((p) => String(p.id))).size !== playlists.length) throw new Error('歌单标识重复');
    return { version: 1, likes, library, playlists,
      ...(v.recommendation === undefined ? {} : { recommendation: recommendation.syncState(v.recommendation) }) };
  }
  function merge(a, b) {
    const local = normalize(a), remote = normalize(b);
    const playlists = new Map(local.playlists.map((p) => [String(p.id), p]));
    remote.playlists.forEach((p) => {
      const existing = playlists.get(String(p.id));
      playlists.set(String(p.id), existing
        ? { ...p, ...existing, tracks: unique([...existing.tracks, ...p.tracks], trackKey) } : p);
    });
    return normalize({ version: 1, likes: unique([...local.likes, ...remote.likes], trackKey),
      library: unique([...local.library, ...remote.library], trackKey), playlists: [...playlists.values()],
      recommendation: recommendation.reconcile(undefined, local.recommendation, remote.recommendation) });
  }
  // First contact is additive. Later exchanges compare with the last shared copy,
  // so a removal is distinguishable from a song the other device has never seen.
  function reconcile(base, local, remote) {
    if (!base) return merge(local, remote);
    base = normalize(base); local = normalize(local); remote = normalize(remote);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function list(before, left, right, key, combine) {
      const b = new Map(before.map((v) => [key(v), v]));
      const l = new Map(left.map((v) => [key(v), v]));
      const r = new Map(right.map((v) => [key(v), v]));
      const keys = (values) => values.map(key);
      // Prefer a changed remote order; otherwise keep the local order.
      const order = same(keys(before).filter((k) => r.has(k)), keys(right))
        ? [...l.keys(), ...r.keys()] : [...r.keys(), ...l.keys()];
      return [...new Set(order)].flatMap((k) => {
        if (b.has(k) && (!l.has(k) || !r.has(k))) return [];
        if (!l.has(k)) return [r.get(k)];
        if (!r.has(k)) return [l.get(k)];
        return [combine ? combine(b.get(k), l.get(k), r.get(k))
          : same(b.get(k), r.get(k)) ? l.get(k) : r.get(k)];
      });
    }
    const playlists = list(base.playlists, local.playlists, remote.playlists, (p) => String(p.id), (b, l, r) => {
      const result = { ...l };
      for (const field of ['title', 'desc', 'cover', 'createdAt']) {
        if (b && !same(b[field], r[field])) {
          if (r[field] === undefined) delete result[field]; else result[field] = r[field];
        }
      }
      result.tracks = list(b?.tracks || [], l.tracks, r.tracks, trackKey);
      return result;
    });
    return normalize({ version: 1, likes: list(base.likes, local.likes, remote.likes, trackKey),
      library: list(base.library, local.library, remote.library, trackKey), playlists,
      recommendation: recommendation.reconcile(base.recommendation, local.recommendation, remote.recommendation) });
  }
  function privateIPv4(address) {
    const parts = String(address).split('.');
    if (parts.length !== 4 || parts.some((s) => !/^(0|[1-9]\d{0,2})$/.test(s) || +s > 255)) return false;
    const [a, b] = parts.map(Number);
    return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
  }
  function endpoint(value) {
    const input = String(value || '').trim().replace(/^http:\/\//i, '').replace(/\/$/, '');
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(input);
    if (!match || !privateIPv4(match[1]) || +match[2] < 1 || +match[2] > 65535) throw new Error('请输入电脑显示的局域网地址和端口，例如 192.168.1.10:43821');
    return `http://${match[1]}:${Number(match[2])}`;
  }
  return { normalize, merge, reconcile, trackKey, privateIPv4, endpoint };
});
