/* 播放快照只保存曲目身份和控制状态，不保存会过期的 CDN/HLS 播放地址。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuPlaybackSession = factory();
})(typeof window === 'object' ? window : this, function () {
  const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const key = (t) => !t ? '' : t.isLive ? `live:${t.roomid}`
    : `${t.bvid}:${t.cid || ''}:${t.isSegment ? `${t.from}-${t.to}` : ''}`;
  function track(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.isLive ? !(Number(value.roomid) > 0) : !/^BV[\w]+$/.test(value.bvid || '')) return null;
    const out = {};
    for (const name of ['bvid', 'aid', 'cid', 'title', 'up', 'duration', 'pic', 'roomid', 'area', 'online']) {
      if (typeof value[name] === 'string' || Number.isFinite(value[name])) out[name] = value[name];
    }
    if (typeof out.pic !== 'string' || out.pic.startsWith('blob:')) delete out.pic;
    if (value.isLive) out.isLive = true;
    if (value.isSegment && number(value.to) > number(value.from)) {
      Object.assign(out, { isSegment: true, from: Math.max(0, number(value.from)), to: value.to });
    }
    if (value.lyricRef && typeof value.lyricRef === 'object') {
      out.lyricRef = {};
      for (const name of ['source', 'id', 'songmid']) {
        const field = value.lyricRef[name];
        if (typeof field === 'string' || Number.isFinite(field)) out.lyricRef[name] = field;
      }
    }
    return out;
  }
  function normalize(value) {
    if (!value || typeof value !== 'object' || value.version !== 1) return null;
    const entries = Array.isArray(value.queue) ? value.queue.map(track) : [];
    const queue = entries.filter(Boolean);
    const current = track(value.current);
    const preferred = Number.isInteger(value.qi) && value.qi >= 0 && entries[value.qi];
    const qi = current && preferred && key(preferred) === key(current)
      ? entries.slice(0, value.qi).filter(Boolean).length
      : current ? queue.findIndex((t) => key(t) === key(current)) : -1;
    return {
      version: 1, queue, current, qi,
      queueName: typeof value.queueName === 'string' ? value.queueName : '',
      position: current?.isLive ? 0 : Math.max(0, number(value.position)),
      playing: !!current && value.playing === true,
      volume: Math.max(0, Math.min(1, number(value.volume, .8))),
      muted: value.muted === true,
      playMode: ['loop', 'one', 'shuffle'].includes(value.playMode) ? value.playMode : 'loop',
      videoMode: !current?.isLive && value.videoMode === true,
      view: ['library', 'fav', 'radio', 'playing'].includes(value.view) ? value.view : 'library',
    };
  }
  function resumePosition(t, position, duration) {
    if (t?.isLive) return 0;
    const limit = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    const from = t?.isSegment ? Math.max(0, number(t.from)) : 0;
    const start = from < limit ? from : 0;
    const end = Math.min(limit, t?.isSegment ? number(t.to, Infinity) : Infinity);
    const desired = Math.max(start, number(position, start));
    return end > start && desired >= end - .25 ? start : desired;
  }
  return { normalize, resumePosition };
});
