/* One download manifest contract for the desktop and native clients. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuVideoDownload = factory();
})(typeof window === 'object' ? window : this, function () {
  const names = { 6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60',
    80: '1080P', 100: '智能修复', 112: '1080P+', 116: '1080P60', 120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K' };
  const urlOf = track => {
    const value = track?.baseUrl || track?.base_url || track?.url;
    if (typeof value !== 'string') return null;
    const url = value.replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
    return /^https:\/\//.test(url) ? url : null;
  };
  function qualitiesOf(data, codecs = [7, 12, 13]) {
    const qualities = new Map();
    const add = (quality, label) => {
      quality = Number(quality);
      if (quality > 0) qualities.set(quality, { quality, label: label || qualities.get(quality)?.label || names[quality] || `清晰度 ${quality}` });
    };
    (data.accept_quality || []).forEach((q, i) => add(q, data.accept_description?.[i]));
    (data.support_formats || []).forEach(f => add(f.quality, f.new_description || f.display_desc || f.description));
    (data.dash?.video || []).forEach(t => add(t.id));
    if (data.durl?.length) add(data.quality);
    const hasAudio = (data.dash?.audio || []).some(t => urlOf(t) && (!t.codecs || /^mp4a/i.test(t.codecs)));
    const actual = new Set((hasAudio ? data.dash?.video || [] : [])
      .filter(t => urlOf(t) && codecs.includes(Number(t.codecid))).map(t => Number(t.id)));
    if (data.durl?.length === 1 && urlOf(data.durl[0])) actual.add(Number(data.quality));
    return [...qualities.values()].filter(q => actual.has(q.quality)).sort((a, b) => b.quality - a.quality);
  }
  async function resolve(request, bvid, cid, quality, codecs = [7, 12, 13]) {
    if (!bvid || !cid) throw new Error('缺少视频参数');
    const requested = Number(quality) || 0;
    const query = `bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${requested || 127}&fnver=0&fnval=4048&fourk=1`;
    let data, failure;
    for (const signed of [true, false]) {
      try {
        data = await request(`https://api.bilibili.com/x/player/${signed ? 'wbi/' : ''}playurl?${query}`, signed ? { wbi: true } : undefined);
        if (data?.dash?.video?.length || (data?.durl?.length === 1 && urlOf(data.durl[0]))) break;
        if (data?.durl?.length > 1) throw new Error('该视频返回多段媒体，暂不支持下载');
        throw new Error('接口未返回视频流');
      } catch (error) { data = null; failure = error; }
    }
    if (!data) throw failure;
    const qualities = qualitiesOf(data, codecs);
    // Advertised accept_quality/support_formats can include VIP-only tiers.
    // Only advertise tracks actually returned to this account, with usable codecs.
    if (!requested) {
      if (!qualities.length) throw new Error('当前账号没有可下载的视频清晰度');
      return { qualities };
    }
    const label = qualities.find(q => q.quality === requested)?.label || names[requested] || `清晰度 ${requested}`;
    const videos = (data.dash?.video || []).filter(t => Number(t.id) === requested && urlOf(t));
    const video = videos.filter(t => codecs.includes(Number(t.codecid)))
      .sort((a, b) => codecs.indexOf(Number(a.codecid)) - codecs.indexOf(Number(b.codecid)) || Number(b.bandwidth) - Number(a.bandwidth))[0];
    if (video) {
      const audio = [...(data.dash.audio || [])].filter(t => urlOf(t) && (!t.codecs || /^mp4a/i.test(t.codecs)))
        .sort((a, b) => Number(b.bandwidth) - Number(a.bandwidth))[0];
      if (!audio) throw new Error('接口未返回可合并的音轨，请重试');
      return { url: urlOf(video), audioUrl: urlOf(audio), quality: requested, label, format: 'mp4', qualities };
    }
    if (videos.length) throw new Error('此清晰度的编码暂不支持在当前设备保存，请选择其他档位');
    if (Number(data.quality) === requested && data.durl?.length === 1 && urlOf(data.durl[0])) {
      return { url: urlOf(data.durl[0]), quality: requested, label, format: /flv/.test(data.format || '') ? 'flv' : 'mp4', qualities };
    }
    throw new Error('当前账号未获得所选清晰度的视频流，请检查登录或大会员权限后重试');
  }
  return { resolve, qualitiesOf };
});
