// Browser-only fingerprint pipeline for the split editor.
async function identifyAudioClip(clip, sourceRate, log = () => {}) {
  const length = clip.length / sourceRate;
  if (length < 3) throw new Error("音频太短，请再听几秒");
  try {
    log('网易云识曲：正在生成音频指纹…');
    const pcm = await renderClipRate(clip, sourceRate, 48000);
    const probeFrom = length > 10 ? 4 : 0, probeLength = Math.min(6, length - probeFrom);
    const encoded = await ncm.Encode({ sampleRate: 48000, getChannelData: () => pcm }, probeFrom, probeLength, 0);
    const hit = await rpc('netease', { encoded, duration: probeLength });
    if (hit) { log(`网易云命中：${hit.title} · ${hit.artist}`); return hit; }
  } catch (error) { log(`网易云识曲：${error.message || error}`); }
  log('网易云未命中，回退 Shazam…');
  await shazam.init();
  const start = length > 16 ? 4 : 0;
  const pcm = await renderClipRate(clip.subarray(Math.floor(start * sourceRate), Math.floor(Math.min(length, start + 12) * sourceRate)), sourceRate, 16000);
  const signature = shazam.DecodedSignature.new(pcm, 16000, 1);
  try {
    const hit = await rpc('shazam', { uri: signature.uri, samplems: signature.samplems });
    log(hit ? `Shazam 命中：${hit.title} · ${hit.artist}` : 'Shazam 未命中');
    return hit;
  } finally { signature.free(); }
}
