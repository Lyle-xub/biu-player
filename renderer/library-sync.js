/* Shared wire format for desktop and RN. Merge is additive: absence is not a deletion. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuLibrarySync = factory();
})(typeof window === 'object' ? window : this, function () {
  const MAX_TRACKS = 20000;
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max = 2048) => typeof v === 'string' && v.length <= max;
  function track(v) {
    if (!object(v) || (v.isLive ? !(Number(v.roomid) > 0) : !/^BV\w+$/.test(v.bvid || ''))) throw new Error('歌曲数据无效');
    const out = {};
    for (const k of ['bvid', 'aid', 'cid', 'mid', 'title', 'up', 'duration', 'roomid', 'area', 'online', 'parentBvid', 'parentTitle']) {
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
    let count = likes.length;
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
    return { version: 1, likes, playlists };
  }
  function merge(a, b) {
    const local = normalize(a), remote = normalize(b);
    const playlists = new Map(local.playlists.map((p) => [String(p.id), p]));
    remote.playlists.forEach((p) => {
      const existing = playlists.get(String(p.id));
      playlists.set(String(p.id), existing
        ? { ...p, ...existing, tracks: unique([...existing.tracks, ...p.tracks], trackKey) } : p);
    });
    return normalize({ version: 1, likes: unique([...local.likes, ...remote.likes], trackKey), playlists: [...playlists.values()] });
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
  return { normalize, merge, trackKey, privateIPv4, endpoint };
});
