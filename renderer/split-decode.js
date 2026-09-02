/* Biu Player · 分切流式解码（MixSplitR 分析用）
 * 背景：整轨 decodeAudioData 会把长视频一次性解码成 Float32 多声道
 * （2 小时 48k 立体声 ≈ 2.4GB），渲染进程 OOM 直接黑屏。
 * 这里改为「解封装 MP4/fMP4 → WebCodecs AudioDecoder 逐帧解码 → 边解码边
 * 混单声道/重采样」，内存占用只与输出 PCM 成正比，任意时长都不会爆。
 *
 * 暴露 window.splitDecodeAacStream(u8, opts)：
 *   u8:   完整音频文件字节（B 站 DASH 音频为 AAC，普通 MP4 或 fMP4 封装）
 *   opts: { duration 标称时长(秒), keepSrc 是否保留原始采样率单声道, onProgress(0..1) }
 * 返回 { pcm, rate, srcPcm, srcRate, duration }：
 *   pcm  = Int16Array @24000Hz 单声道（包络检测 + 识曲兜底源）
 *   srcPcm/srcRate = Int16Array @原始采样率 单声道（识曲 clip 源；keepSrc=false 时为 null）
 * 解析/解码失败会抛错，由调用方回退到旧解码路径。
 */
(function () {
'use strict';

/* ---------- MP4 box 遍历 ---------- */
function* walkBoxes(u8, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = (u8[p] * 0x1000000) + ((u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    let head = p + 8;
    if (size === 1) {
      size = 0;
      for (let i = 0; i < 8; i++) size = size * 256 + u8[p + 8 + i];
      head = p + 16;
    } else if (size === 0) size = end - p;
    if (size < head - p || p + size > end) return; // 越界即截断
    yield { type, head, end: p + size, start: p };
    p += size;
  }
}
const findBox = (u8, start, end, type) => {
  for (const b of walkBoxes(u8, start, end)) if (b.type === type) return b;
  return null;
};
const u32 = (u8, p) => ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
const u64 = (u8, p) => u32(u8, p) * 0x100000000 + u32(u8, p + 4);
const u16 = (u8, p) => (u8[p] << 8) | u8[p + 1];

/* ---------- esds → AudioSpecificConfig ---------- */
function readTlv(u8, p, end) {
  if (p >= end) return null;
  const tag = u8[p++];
  let len = 0;
  for (let i = 0; i < 4 && p < end; i++) {
    const b = u8[p++];
    len = (len << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { tag, content: p, end: Math.min(p + len, end) };
}
function parseEsds(u8, start, end) {
  let p = start + 4; // 跳过 version/flags
  const es = readTlv(u8, p, end);
  if (!es || es.tag !== 0x03) throw new Error('esds 缺少 ES_Descriptor');
  p = es.content + 2; // ES_ID
  const flags = u8[p++];
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + u8[p];
  if (flags & 0x20) p += 2;
  const dc = readTlv(u8, p, es.end);
  if (!dc || dc.tag !== 0x04) throw new Error('esds 缺少 DecoderConfigDescriptor');
  const oti = u8[dc.content]; // objectTypeIndication（AAC = 0x40）
  const ds = readTlv(u8, dc.content + 13, dc.end);
  if (!ds || ds.tag !== 0x05) throw new Error('esds 缺少 DecoderSpecificInfo');
  return { oti, asc: u8.slice(ds.content, ds.end) };
}

/* ---------- moov：解码参数（ASC / 采样率 / 声道 / timescale） ---------- */
function parseMoov(u8, moov) {
  const trak = findBox(u8, moov.head, moov.end, 'trak');
  if (!trak) throw new Error('moov 缺少 trak');
  const mdia = findBox(u8, trak.head, trak.end, 'mdia');
  const mdhd = mdia && findBox(u8, mdia.head, mdia.end, 'mdhd');
  if (!mdhd) throw new Error('缺少 mdhd');
  const timescale = u8[mdhd.head] === 1 ? u32(u8, mdhd.head + 20) : u32(u8, mdhd.head + 12);
  const minf = findBox(u8, mdia.head, mdia.end, 'minf');
  const stbl = minf && findBox(u8, minf.head, minf.end, 'stbl');
  const stsd = stbl && findBox(u8, stbl.head, stbl.end, 'stsd');
  if (!stsd) throw new Error('缺少 stsd');
  // 第一个 sample entry（mp4a）
  let p = stsd.head + 8; // version/flags + entry_count
  const entryType = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
  if (entryType !== 'mp4a' && entryType !== 'enca') throw new Error('不是 AAC 音轨（' + entryType + '）');
  const channels = u16(u8, p + 24);
  const sampleRate = u32(u8, p + 32) >>> 16;
  let asc = null, oti = 0x40;
  for (const b of walkBoxes(u8, p + 36, p + u32(u8, p))) {
    if (b.type === 'esds') { const r = parseEsds(u8, b.head, b.end); asc = r.asc; oti = r.oti; break; }
  }
  if (!asc) throw new Error('缺少 esds 解码参数');
  return { timescale, sampleRate, channels, asc, oti, stbl };
}

/* ---------- 普通 MP4 样本表（stts/stsc/stsz/stco） ---------- */
function parseSampleTable(u8, stbl) {
  const bStts = findBox(u8, stbl.head, stbl.end, 'stts');
  const bStsc = findBox(u8, stbl.head, stbl.end, 'stsc');
  const bStsz = findBox(u8, stbl.head, stbl.end, 'stsz');
  const bStco = findBox(u8, stbl.head, stbl.end, 'stco') || findBox(u8, stbl.head, stbl.end, 'co64');
  if (!bStts || !bStsc || !bStsz || !bStco) return null;
  const sampleCount = u32(u8, bStsz.head + 8);
  if (!sampleCount) return null;
  // 每样本时长（stts 展开）
  const durs = new Uint32Array(sampleCount);
  {
    const n = u32(u8, bStts.head + 4);
    let p = bStts.head + 8, idx = 0;
    for (let i = 0; i < n && idx < sampleCount; i++, p += 8) {
      const cnt = u32(u8, p), delta = u32(u8, p + 4);
      durs.fill(delta, idx, Math.min(idx + cnt, sampleCount));
      idx += cnt;
    }
  }
  // 每样本字节数
  const sizes = new Uint32Array(sampleCount);
  {
    const fixed = u32(u8, bStsz.head + 4);
    if (fixed) sizes.fill(fixed);
    else for (let i = 0; i < sampleCount; i++) sizes[i] = u32(u8, bStsz.head + 12 + i * 4);
  }
  // chunk 偏移
  const isCo64 = bStco.type === 'co64';
  const chunkCount = u32(u8, bStco.head + 4);
  const chunkOff = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i++)
    chunkOff[i] = isCo64 ? u64(u8, bStco.head + 8 + i * 8) : u32(u8, bStco.head + 8 + i * 4);
  // stsc：chunk → samplesPerChunk
  const stscN = u32(u8, bStsc.head + 4);
  const stsc = [];
  for (let i = 0, p = bStsc.head + 8; i < stscN; i++, p += 12)
    stsc.push({ first: u32(u8, p) - 1, spc: u32(u8, p + 4) });
  // 拼样本
  const samples = new Array(sampleCount);
  let si = 0, ts = 0, ei = 0;
  for (let c = 0; c < chunkCount && si < sampleCount; c++) {
    while (ei + 1 < stsc.length && stsc[ei + 1].first <= c) ei++;
    let off = chunkOff[c];
    for (let k = 0; k < stsc[ei].spc && si < sampleCount; k++, si++) {
      samples[si] = { off, size: sizes[si], ts };
      ts += durs[si];
      off += sizes[si];
    }
  }
  return si === sampleCount ? samples : null;
}

/* ---------- fMP4：moof(traf: tfhd/tfdt/trun) + mdat ---------- */
function parseFragment(u8, moof, samples) {
  const traf = findBox(u8, moof.head, moof.end, 'traf');
  if (!traf) return;
  const tfhd = findBox(u8, traf.head, traf.end, 'tfhd');
  const tfdt = findBox(u8, traf.head, traf.end, 'tfdt');
  if (!tfhd) return;
  const tf = u32(u8, tfhd.head) & 0xffffff;
  let p = tfhd.head + 4; // track_ID
  let baseOff = 0, defDur = 0, defSize = 0;
  let baseIsMoof = !!(tf & 0x020000);
  if (tf & 0x1) { baseOff = u64(u8, p); p += 8; }
  if (tf & 0x2) p += 4;
  if (tf & 0x8) { defDur = u32(u8, p); p += 4; }
  if (tf & 0x10) { defSize = u32(u8, p); p += 4; }
  if (tf & 0x20) p += 4;
  if (!baseOff) baseIsMoof = true;
  let dts = 0;
  if (tfdt) dts = u8[tfdt.head] === 1 ? u64(u8, tfdt.head + 4) : u32(u8, tfdt.head + 4);
  for (const trun of walkBoxes(u8, traf.head, traf.end)) {
    if (trun.type !== 'trun') continue;
    const fl = u32(u8, trun.head) & 0xffffff;
    let q = trun.head + 4;
    const count = u32(u8, q); q += 4;
    let dataOff = 0;
    if (fl & 0x1) { dataOff = u32(u8, q); q += 4; }
    if (fl & 0x4) q += 4; // first_sample_flags
    let off = (baseIsMoof ? moof.start : baseOff) + dataOff;
    for (let i = 0; i < count; i++) {
      const dur = (fl & 0x100) ? u32(u8, q) : defDur; if (fl & 0x100) q += 4;
      const size = (fl & 0x200) ? u32(u8, q) : defSize; if (fl & 0x200) q += 4;
      if (fl & 0x400) q += 4;
      if (fl & 0x800) q += 4;
      if (size > 0 && off + size <= u8.length) samples.push({ off, size, ts: dts });
      dts += dur;
      off += size;
    }
  }
}

function demuxAac(u8) {
  const moov = findBox(u8, 0, u8.length, 'moov');
  if (!moov) throw new Error('不是有效的 MP4/M4A 文件');
  const info = parseMoov(u8, moov);
  let samples = parseSampleTable(u8, info.stbl);
  if (!samples) {
    // fMP4：顺序收集所有 moof 里的样本
    samples = [];
    for (const b of walkBoxes(u8, 0, u8.length)) if (b.type === 'moof') parseFragment(u8, b, samples);
    if (!samples.length) throw new Error('未找到音频样本');
  }
  return { ...info, samples };
}

/* ---------- WebCodecs 流式解码 + 混单声道 + 双路输出 ---------- */
async function splitDecodeAacStream(u8, opts = {}) {
  if (typeof AudioDecoder !== 'function') throw new Error('当前环境不支持 WebCodecs');
  const { timescale, sampleRate, channels, asc, oti, samples } = demuxAac(u8);
  const rate = 24000;
  const durEst = opts.duration || (samples.length ? samples[samples.length - 1].ts / timescale : 0);
  const keepSrc = !!opts.keepSrc;
  // 预分配输出（按标称时长 + 1s 余量），写入时钳位防溢出
  const pcm = new Int16Array(Math.ceil((durEst + 1) * rate));
  const srcPcm = keepSrc ? new Int16Array(Math.ceil((durEst + 1) * sampleRate)) : null;
  const ratio = sampleRate / rate;

  let srcWritten = 0;   // srcPcm 已写采样数（全局源位置）
  let out24 = 0;        // 24k 输出已写采样数
  let tail = 0;         // 上一帧最后一个单声道采样（跨帧插值用）
  let hasTail = false;
  let decodeErr = null;

  const mix = new Float32Array(8192); // 复用缓冲，帧大时扩容
  let mixBuf = mix;
  const decoder = new AudioDecoder({
    output: (frame) => {
      try {
        const n = frame.numberOfFrames;
        if (mixBuf.length < n) mixBuf = new Float32Array(n);
        // 混单声道：各声道 f32-planar 拷贝后平均
        const chPlanes = [];
        let alloc = 0;
        for (let c = 0; c < frame.numberOfChannels; c++) {
          const size = frame.allocationSize({ planeIndex: c, format: 'f32-planar' });
          const plane = new Float32Array(size / 4);
          frame.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
          chPlanes.push(plane);
          alloc += size;
        }
        for (let i = 0; i < n; i++) {
          let v = 0;
          for (let c = 0; c < chPlanes.length; c++) v += chPlanes[c][i] || 0;
          mixBuf[i] = v / chPlanes.length;
        }
        // 原始采样率单声道 int16（识曲 clip 源）
        if (srcPcm) {
          const end = Math.min(srcWritten + n, srcPcm.length);
          for (let i = srcWritten; i < end; i++)
            srcPcm[i] = Math.max(-1, Math.min(1, mixBuf[i - srcWritten])) * 32767;
        }
        // 线性插值重采样到 24kHz
        const g0 = srcWritten;
        for (;;) {
          const pos = out24 * ratio;
          const i0 = Math.floor(pos);
          if (i0 + 1 >= g0 + n) break; // 需要下一帧
          const v0 = i0 < g0 ? (hasTail ? tail : mixBuf[0]) : mixBuf[i0 - g0];
          const v1 = mixBuf[i0 + 1 - g0];
          if (out24 < pcm.length) pcm[out24] = Math.max(-1, Math.min(1, v0 + (v1 - v0) * (pos - i0))) * 32767;
          out24++;
        }
        tail = mixBuf[n - 1];
        hasTail = true;
        srcWritten += n;
        frame.close();
      } catch (e) { decodeErr = decodeErr || e; frame.close(); }
    },
    error: (e) => { decodeErr = e; },
  });
  const aot = asc[0] >> 3; // AudioSpecificConfig 前 5bit 为 audioObjectType
  decoder.configure({
    codec: oti === 0x40 ? `mp4a.40.${aot || 2}` : 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    description: asc,
  });

  // 分批喂样本，回报 decode 进度
  const total = samples.length;
  const BATCH = 3000;
  for (let i = 0; i < total; i += BATCH) {
    for (let j = i; j < Math.min(i + BATCH, total); j++) {
      const s = samples[j];
      decoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round((s.ts * 1e6) / timescale),
        duration: 0,
        data: u8.subarray(s.off, s.off + s.size),
      }));
    }
    if (opts.onProgress) opts.onProgress(Math.min(1, (i + BATCH) / total));
    if (decodeErr) break;
    await new Promise((r) => setTimeout(r, 0)); // 让出主线程，保持 UI 响应
  }
  await decoder.flush().catch(() => {});
  decoder.close();
  if (decodeErr) throw decodeErr;
  if (!srcWritten) throw new Error('未解码出任何音频帧');

  const duration = srcWritten / sampleRate;
  return {
    pcm: out24 >= pcm.length ? pcm : pcm.subarray(0, out24),
    rate,
    srcPcm: srcPcm ? (srcWritten >= srcPcm.length ? srcPcm : srcPcm.subarray(0, srcWritten)) : null,
    srcRate: sampleRate,
    duration,
  };
}

window.splitDecodeAacStream = splitDecodeAacStream;
})();
