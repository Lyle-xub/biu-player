/* Shared subtitle fallback for Electron, the web bridge and React Native.
 * Wire layout: web/view field 1 → field 3 tracks → strings 3/4/5.
 * Reference: https://github.com/ccBilly-aipm/bilibili-ai-subtitle/blob/main/src/bilibili_ai_subtitle/protobuf.py
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuSubtitles = factory();
})(typeof window === 'object' ? window : this, function () {
  function byteFields(bytes) {
    let offset = 0;
    const fields = [];
    const invalid = () => { throw new Error('字幕元数据损坏'); };
    function varint(maxBytes, numeric = true) {
      let value = 0, factor = 1;
      for (let i = 0; i < maxBytes; i++) {
        if (offset >= bytes.length) invalid();
        const b = bytes[offset++];
        if (numeric) value += (b & 127) * factor;
        if (b < 128) return value;
        factor *= 128;
      }
      invalid();
    }
    while (offset < bytes.length) {
      const tag = varint(5), field = Math.floor(tag / 8), wire = tag % 8;
      if (!field || field > 0x1fffffff) invalid();
      if (wire === 0) { varint(10, false); continue; } // Skip uint64 IDs without losing precision.
      const length = wire === 2 ? varint(5) : wire === 1 ? 8 : wire === 5 ? 4 : invalid();
      if (length > bytes.length - offset) invalid();
      if (wire === 2) fields.push({ field, bytes: bytes.subarray(offset, offset + length) });
      offset += length;
    }
    return fields;
  }
  const utf8 = (bytes) => typeof TextDecoder === 'function'
    ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    : decodeURIComponent(Array.from(bytes, (b) => '%' + b.toString(16).padStart(2, '0')).join(''));
  function parseWebSubtitleResponse(input) {
    if (Array.isArray(input)) {
      if (input.length > 2 * 1024 * 1024 || input.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error('字幕元数据格式无效');
      input = Uint8Array.from(input);
    }
    if (!(input instanceof Uint8Array) || input.length > 2 * 1024 * 1024) throw new Error('字幕元数据不是二进制');
    const data = byteFields(input).find((f) => f.field === 1);
    if (!data) return [];
    return byteFields(data.bytes).filter((f) => f.field === 3).map((f) => {
      const fields = byteFields(f.bytes);
      const text = (number) => {
        const value = fields.find((item) => item.field === number);
        return value ? utf8(value.bytes) : '';
      };
      return { lan: text(3), lan_doc: text(4), subtitle_url: text(5) };
    }).filter((track) => track.subtitle_url);
  }
  function subtitleUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value.startsWith('//') ? 'https:' + value : value.replace(/^http:/, 'https:'));
      return url.protocol === 'https:' && /(^|\.)(hdslb\.com|bilibili\.com|bilivideo\.(com|cn))$/i.test(url.hostname)
        && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  async function fetchSubtitles(get, bvid, cid) {
    if (!/^BV[a-zA-Z0-9]+$/.test(bvid || '') || !/^[1-9]\d*$/.test(String(cid || ''))) return null;
    const referer = 'https://www.bilibili.com/video/' + bvid;
    const query = 'bvid=' + encodeURIComponent(bvid) + '&cid=' + encodeURIComponent(cid);
    async function request(url, opts = {}) {
      let timer;
      try {
        const response = await Promise.race([
          get(url, { referer, timeout: 8000, ...opts }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('字幕请求超时')), 8000); }),
        ]);
        if (response.status !== 200) throw new Error('字幕请求失败');
        return response.body;
      } finally { clearTimeout(timer); }
    }
    async function metadata(url, opts) {
      const json = JSON.parse(await request(url, opts));
      if (json.code !== 0) throw new Error('字幕接口不可用');
      return json.data;
    }
    async function readTracks(tracks) {
      if (!Array.isArray(tracks)) return null;
      const rank = (s) => /^(ai-)?zh|中文/i.test(String(s?.lan || '') + ' ' + String(s?.lan_doc || '')) ? 0 : 1;
      const tried = new Set();
      for (const track of [...tracks].sort((a, b) => rank(a) - rank(b))) {
        const url = subtitleUrl(track?.subtitle_url);
        if (!url || tried.has(url)) continue;
        tried.add(url);
        try {
          const json = JSON.parse(await request(url));
          const lines = (Array.isArray(json.body) ? json.body : []).map((line) => ({
            from: Number(line?.from), to: Number(line?.to), text: String(line?.content || '').trim(),
          })).filter((line) => line.text && Number.isFinite(line.from) && Number.isFinite(line.to) && line.from >= 0 && line.to > line.from)
            .sort((a, b) => a.from - b.from);
          if (lines.length) return lines;
        } catch { /* Try the next track, then refresh URLs via the new interface. */ }
      }
      return null;
    }
    let data;
    for (const path of ['wbi/v2', 'v2']) {
      try { data = await metadata('https://api.bilibili.com/x/player/' + path + '?' + query, { wbi: path === 'wbi/v2' }); break; }
      catch { /* The unsigned legacy interface still works for some videos. */ }
    }
    const existing = await readTracks(data?.subtitle?.subtitles);
    if (existing) return existing;
    try {
      const aid = data?.aid || (await metadata('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid)))?.aid;
      if (!/^[1-9]\d*$/.test(String(aid || ''))) return null;
      const params = new URLSearchParams({ oid: String(cid), pid: String(aid), type: '1',
        context_ext: JSON.stringify({ video_type: 1 }), cur_production_type: '0', preferred_language: 'ai-zh', playlist_switch: '0' });
      const bytes = await request('https://api.bilibili.com/x/v2/subtitle/web/view?' + params,
        { responseType: 'bytes', headers: { Accept: 'application/octet-stream' } });
      return await readTracks(parseWebSubtitleResponse(bytes));
    } catch { return null; }
  }
  return { fetchSubtitles, parseWebSubtitleResponse };
});
