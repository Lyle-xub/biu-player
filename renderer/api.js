/* Biu Player · B 站 API 封装
 * Electron 内走 window.bili 桥（主进程带 UA/Referer/buvid3 发请求）；
 * 纯浏览器打开（无 window.bili）时回退到设计稿 mock 数据，保证可预览。
 */

const hasBridge = typeof window.bili !== 'undefined';

/* ---------- 伪封面生成器（mock 模式 / 无封面时占位） ---------- */
function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function coverSVG(seed, w = 400) {
  const r = mulberry(seed * 7919 + 13);
  const h1 = Math.floor(r() * 360), h2 = (h1 + 40 + r() * 80) % 360;
  const c1 = `hsl(${h1} 48% ${36 + r() * 20}%)`;
  const c2 = `hsl(${h2} 52% ${20 + r() * 16}%)`;
  const c3 = `hsl(${(h1 + 160) % 360} 65% 72%)`;
  const g = `g${seed}`;
  const shapes = [
    `<circle cx="${w * (.6 + r() * .3)}" cy="${w * (.2 + r() * .25)}" r="${w * .18}" fill="${c3}" opacity=".55"/>
     <circle cx="${w * .25}" cy="${w * .75}" r="${w * .28}" fill="${c2}" opacity=".8"/>`,
    `<path d="M0 ${w * .78} Q ${w * .5} ${w * (.55 + r() * .15)} ${w} ${w * .78} L ${w} ${w} L 0 ${w}Z" fill="${c3}" opacity=".45"/>
     <circle cx="${w * .3}" cy="${w * .3}" r="${w * .13}" fill="${c3}" opacity=".7"/>`,
    `<rect x="${w * .1}" y="${w * .15}" width="${w * .38}" height="${w * .28}" fill="${c3}" opacity=".6" rx="14" transform="rotate(-6 ${w * .1} ${w * .15})"/>
     <rect x="${w * .42}" y="${w * .45}" width="${w * .42}" height="${w * .32}" fill="${c2}" rx="14" transform="rotate(4 ${w * .42} ${w * .45})"/>`,
    `<ellipse cx="${w * (.3 + r() * .4)}" cy="${w * .35}" rx="${w * .3}" ry="${w * .12}" fill="${c2}" opacity=".85"/>
     <ellipse cx="${w * .55}" cy="${w * .62}" rx="${w * .34}" ry="${w * .13}" fill="${c3}" opacity=".4"/>`
  ];
  return `<svg viewBox="0 0 ${w} ${w}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="${r() > .5 ? 1 : 0}" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${w}" height="${w}" fill="url(#${g})"/>${shapes[Math.floor(r() * shapes.length)]}</svg>`;
}

/* ---------- 设计稿 mock 数据（浏览器预览降级用） ---------- */
const MOCK_SONGS = [
  ['直到世界尽头', '果味VC', 299, 1], ['山 海', '草东没有派对', 252, 2],
  ['凄美地', '郭顶', 276, 3], ['杀死那个石家庄人', '万能青年旅店', 344, 4],
  ['普通朋友', '陶喆', 257, 5], ['夜 曲', '周杰伦', 226, 6],
  ['起风了', '买辣椒也用券', 325, 7], ['干 杯', '五月天', 288, 8],
  ['想见你想见你想见你', '八三夭', 242, 9], ['红 豆', '王菲', 237, 10],
  ['恋爱ing', '五月天', 215, 11], ['晴 天', '周杰伦', 269, 12],
];
const MOCK_COMMENTS = [
  ['秋名山车神', '秋夜的风有点凉，可我还是不想早点回家。', '2.1 万', 94],
  ['前奏一响', '从首页刷到，前奏一响直接泪目，青春回来了。', '8763', 97],
  ['高三晚自习', '这首歌陪我走过了整个高三，谢谢果味VC。', '6542', 100],
];
const MOCK_RADIOS = [
  ['陪伴学习', 24000, 58, '学习自习'], ['华语金曲台', 18000, 61, '华语'],
  ['深夜电台', 9672, 64, '聊天电台'], ['ACG 音乐台', 12000, 67, 'ACG'],
];

// mock 曲目统一为真实数据同构的 track
function mockTracks() {
  return MOCK_SONGS.map(([t, up, dur, seed], i) => ({
    bvid: null, aid: 0, cid: 0, title: t, up, duration: dur, pic: null, seed: 200 + i * 3,
  }));
}

/* ---------- 工具 ---------- */
// 去掉搜索标题里的 <em class="keyword"> 高亮标签
const stripEm = (s) => String(s || '').replace(/<[^>]+>/g, '');
// "m:ss" / "h:mm:ss" → 秒（搜索结果 duration 是字符串）
function parseDur(d) {
  if (typeof d === 'number') return d;
  const parts = String(d || '0:00').split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + (n || 0), 0);
}
// 排行 / 搜索条目统一为 track
function toTrack(v) {
  return {
    bvid: v.bvid || null,
    aid: v.aid || v.id || 0,
    cid: v.cid || 0,
    mid: v.owner?.mid || v.mid || 0,
    title: stripEm(v.title),
    tid: Number(v.tid || v.typeid) || 0, tags: v.tags || (typeof v.tag === 'string' ? v.tag.split(',') : []),
    desc: String(v.desc || v.description || '').slice(0, 1500),
    up: (v.owner && v.owner.name) || v.author || '',
    duration: parseDur(v.duration),
    pic: v.pic ? (v.pic.startsWith('//') ? 'https:' + v.pic : v.pic.replace(/^http:/, 'https:')) : null,
  };
}

const MUSIC_TIDS = new Set([3, 28, 29, 30, 31, 59, 130, 193, 194, 243, 244, 265, 267]);
const MUSIC_TNAME_RE = /音乐|原创|翻唱|演奏|电音|乐评|乐器|声乐|VOCALOID|UTAU|MV/i;
const isMusicPartition = (detail) => !!detail && (
  MUSIC_TIDS.has(Number(detail.tid)) || MUSIC_TNAME_RE.test(String(detail.tname || ''))
);

function recommendationToTrack(item, detail) {
  return {
    bvid: item.bvid || detail.bvid || null,
    aid: item.id || detail.aid || 0,
    cid: detail.cid || 0,
    title: stripEm(item.title || detail.title),
    up: (item.owner && item.owner.name) || (detail.owner && detail.owner.name) || '',
    duration: Number(item.duration || detail.duration || 0),
    pic: (item.pic || detail.pic || '').replace(/^http:/, 'https:'),
    mid: item.owner?.mid || detail.owner?.mid || 0,
    tid: detail.tid,
    tags: detail.tags || (typeof item.tag === 'string' ? item.tag.split(',') : []),
    desc: String(detail.desc || item.description || '').slice(0, 1500),
    tname: detail.tname || '音乐',
    recommendationReason: item.rcmd_reason && item.rcmd_reason.content || '',
    stat: item.stat || detail.stat || null,
  };
}

function withApiTimeout(promise, ms = 8000, message = 'B 站接口请求超时') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// 图片地址归一：B 站接口常返回协议相对（//i0.hdslb.com/…）或 http 地址，
// file:// 页面里协议相对会被解析成 file:// 导致裂图，统一补成 https
function absImg(u) {
  if (!u) return null;
  if (u.startsWith('//')) return 'https:' + u;
  return u.replace(/^http:/, 'https:');
}

async function jget(url, opts) {
  // IPC/网络偶发不返回时必须主动结束；否则 videoManifest 会缓存永久 pending 的 Promise。
  const r = await withApiTimeout(window.bili.get(url, opts), 8000);
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const d = JSON.parse(r.body);
  if (d.code !== 0) throw new Error(d.message || ('code ' + d.code));
  return d.data;
}

const VIDEO_QUALITY_NAMES = {
  6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60',
  80: '1080P', 100: '智能修复', 112: '1080P+', 116: '1080P60',
  120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K',
};
const videoManifestCache = new Map();

/* ---------- MixSplitR：长视频分切检测与歌曲匹配 ---------- */
// 解析简介/评论里的时间轴文本（"03:25 歌名" 一行一条），to 取下一行起点
function parseTimestampLines(text, totalDuration) {
  const segs = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    const m = line.match(/(\d{1,3})[:：](\d{1,2})(?:[:：](\d{1,2}))?/);
    if (!m) return;
    const sec = m[3] !== undefined
      ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])
      : (+m[1]) * 60 + (+m[2]);
    if (totalDuration && sec >= totalDuration) return;
    let name = line.replace(m[0], ' ')
      .replace(/^[Pp]?\d{1,2}[.、)）]?\s*/, '')
      .replace(/^[\s\-—–·:：|丨]+/, '')
      .replace(/[\s\-—–|丨]+$/, '')
      .trim();
    if (!name || name.length > 60) return;
    segs.push({ from: sec, name });
  });
  segs.sort((a, b) => a.from - b.from);
  const dedup = segs.filter((s, i) => i === 0 || s.from !== segs[i - 1].from);
  return dedup.map((s, i) => ({
    from: s.from,
    to: i + 1 < dedup.length ? dedup[i + 1].from : (totalDuration || s.from + 180),
    name: s.name,
  })).filter((s) => s.to > s.from + 5);
}

// LRC → [{ from, to, text }]：支持一行多时间标签，to 取下一行起点
function parseLrc(lrc) {
  const out = [];
  String(lrc || '').split(/\r?\n/).forEach((raw) => {
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) return;
    (raw.match(/\[[^\]]*\]/g) || []).forEach((tag) => {
      const m = tag.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
      if (m) out.push({ from: (+m[1]) * 60 + parseFloat(m[2]), text });
    });
  });
  out.sort((a, b) => a.from - b.from);
  return out.map((l, i) => ({
    from: l.from,
    to: i + 1 < out.length ? out[i + 1].from : l.from + 6,
    text: l.text,
  }));
}

async function videoManifest(bvid, cid, force = false) {
  const key = `${bvid}:${cid}`;
  // force：签名流地址可能已过期，必须放弃缓存重新拉取
  if (force) videoManifestCache.delete(key);
  const cached = videoManifestCache.get(key);
  if (cached && Date.now() - cached.time < 4 * 60 * 1000) return cached.promise;
  const promise = (async () => {
    // DASH 才能稳定取得 1080P 及以上视频；4048 = DASH + 4K + 杜比视界 + 8K + AV1。
    const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=127&fnver=0&fnval=4048&fourk=1`;
    try {
      return await jget('https://api.bilibili.com/x/player/wbi/playurl?' + q, { wbi: true });
    } catch (error) {
      return jget('https://api.bilibili.com/x/player/playurl?' + q);
    }
  })();
  videoManifestCache.set(key, { time: Date.now(), promise });
  promise.catch(() => videoManifestCache.delete(key));
  return promise;
}

function playableDashVideos(data) {
  const videos = data && data.dash && Array.isArray(data.dash.video) ? data.dash.video : [];
  // Chromium/Electron 对 AVC/H.264 最稳定；避免误选 HEVC/AV1 后报像素格式不支持。
  const avc = videos.filter((item) => Number(item.codecid) === 7 || /^avc1/i.test(item.codecs || ''));
  if (avc.length) return avc;
  const probe = document.createElement('video');
  return videos.filter((item) => {
    const codec = item.codecs || '';
    return codec && probe.canPlayType(`video/mp4; codecs="${codec}"`) !== '';
  });
}

function availableVideoQualities(data) {
  const streams = playableDashVideos(data);
  const streamIds = new Set(streams.map((item) => Number(item.id)));
  const formats = new Map((data.support_formats || []).map((item) => [Number(item.quality), item]));
  return [...streamIds].sort((a, b) => b - a).map((quality) => {
    const format = formats.get(quality) || {};
    return {
      quality,
      label: format.new_description || format.display_desc || VIDEO_QUALITY_NAMES[quality] || `${quality}P`,
    };
  });
}

/* ---------- MixSplitR Transition 模式：novelty 能量跃迁检测 ----------
 * 移植自 mixsplitr_autotracklist.py 的纯音频路径（无 essentia/spectral 层，
 * assist 支撑项用静音锚点代替，权重结构照源码）。分段结构 { start, end, confidence, boundaryConfidence }。
 */
const SPLIT_DB_FLOOR = -120; // 源码 _DBFS_FLOOR
const splitClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 细粒度能量包络：50ms 帧 / 50ms hop 的均方能量（等效源码毫秒级 _window_dbfs 的分辨率）
function splitBuildEnvelope(pcm, rate) {
  const hop = 0.05;
  const frame = Math.max(1, Math.round(rate * hop));
  const n = Math.floor(pcm.length / frame);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const base = i * frame;
    let sum = 0;
    for (let j = 0; j < frame; j += 2) { const v = pcm[base + j] / 32768; sum += v * v; }
    e[i] = sum / Math.ceil(frame / 2);
  }
  return { e, hop, total: pcm.length / rate };
}

// 等效 _window_dbfs：center ± halfWindowMs 内的平均能量 → dBFS
function splitWindowDb(env, centerSec, halfWindowMs = 160) {
  const lo = Math.max(0, centerSec - halfWindowMs / 1000);
  const hi = Math.min(env.total, centerSec + halfWindowMs / 1000);
  if (hi <= lo) return SPLIT_DB_FLOOR;
  const i0 = Math.floor(lo / env.hop);
  const i1 = Math.min(env.e.length, Math.ceil(hi / env.hop));
  if (i1 <= i0) return SPLIT_DB_FLOOR;
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += env.e[i];
  const mean = sum / (i1 - i0);
  return mean > 1e-12 ? 10 * Math.log10(mean) : SPLIT_DB_FLOOR;
}

// 等效 _anchor_has_audible_sides：候选点两侧必须有声
function splitAudibleSides(env, pointSec, sideOffsetSec, minSideDbfs) {
  const left = splitWindowDb(env, Math.max(0, pointSec - sideOffsetSec), 220);
  const right = splitWindowDb(env, pointSec + sideOffsetSec, 220);
  return left > minSideDbfs && right > minSideDbfs;
}

// 等效 _boundary_novelty_score：±0.24s/±0.92s 处 150/260ms 半窗 dBFS 差分 + 跨尺度斜率
function splitNoveltyScore(env, pointSec) {
  const leftNear = splitWindowDb(env, Math.max(0, pointSec - 0.24), 150);
  const rightNear = splitWindowDb(env, pointSec + 0.24, 150);
  const leftFar = splitWindowDb(env, Math.max(0, pointSec - 0.92), 260);
  const rightFar = splitWindowDb(env, pointSec + 0.92, 260);
  const nearDelta = Math.abs(rightNear - leftNear);
  const farDelta = Math.abs(rightFar - leftFar);
  const slopeDelta = Math.abs((rightNear - rightFar) - (leftNear - leftFar));
  return splitClamp((nearDelta * 0.58 + farDelta * 0.22 + slopeDelta * 0.30) / 10, 0, 2);
}

// 等效 _boundary_macro_novelty_score：±2.5s/±5.5s 大窗口能量差 + 跨尺度斜率
function splitMacroNoveltyScore(env, pointSec) {
  const leftMed = splitWindowDb(env, Math.max(0, pointSec - 2.5), 1500);
  const rightMed = splitWindowDb(env, pointSec + 2.5, 1500);
  const leftWide = splitWindowDb(env, Math.max(0, pointSec - 5.5), 2500);
  const rightWide = splitWindowDb(env, pointSec + 5.5, 2500);
  const medDelta = Math.abs(rightMed - leftMed);
  const wideDelta = Math.abs(rightWide - leftWide);
  const macroSlope = Math.abs((rightMed - rightWide) - (leftMed - leftWide));
  return splitClamp((medDelta * 0.50 + wideDelta * 0.25 + macroSlope * 0.25) / 10, 0, 2);
}

// 等效 _essentia_proximity_support（assist 换成静音锚点）：高斯衰减累积，半径 1.8s
function splitAssistSupport(pointSec, assistPoints, radiusSec = 1.8) {
  if (!assistPoints || !assistPoints.length) return 0;
  const radius = Math.max(0.1, radiusSec);
  const sigma = Math.max(0.08, radius * 0.45);
  let support = 0;
  const lower = pointSec - radius;
  const upper = pointSec + radius;
  for (const item of assistPoints) {
    const point = item.point;
    if (point < lower) continue;
    if (point > upper) break;
    const d = Math.abs(point - pointSec);
    support += item.confidence * Math.exp(-(d * d) / (2 * sigma * sigma));
  }
  return splitClamp(support, 0, 2);
}

// 等效 _detect_split_style_silence_anchors：min_silence=1600ms、-42dB，区间中点作为锚点
function splitDetectSilenceAnchors(env, minSilenceSec = 1.6, threshDb = -42) {
  const dbOf = (i) => (env.e[i] > 1e-12 ? 10 * Math.log10(env.e[i]) : SPLIT_DB_FLOOR);
  const ranges = [];
  for (let i = 0; i < env.e.length;) {
    if (dbOf(i) >= threshDb) { i++; continue; }
    let j = i;
    while (j < env.e.length && dbOf(j) < threshDb) j++;
    if ((j - i) * env.hop >= minSilenceSec) ranges.push([i * env.hop, j * env.hop]);
    i = j;
  }
  const mergeGap = Math.max(0.025, minSilenceSec / 3); // 源码 merge_gap = min_silence // 3
  const merged = [];
  ranges.forEach(([s, e]) => {
    if (merged.length && s <= merged[merged.length - 1][1] + mergeGap) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else merged.push([s, e]);
  });
  // 锚点置信度为 JS 侧补充（源码锚点无置信度）：静音越久越可信
  return merged
    .map(([s, e]) => ({ point: (s + e) / 2, duration: e - s, confidence: splitClamp((e - s) / 3, 0.3, 1) }))
    .filter((a) => a.point > 0 && a.point < env.total)
    .sort((a, b) => a.point - b.point);
}

// 等效 _detect_novelty_transition_points：0.5s 步长扫描 + 自适应阈值三连 + 邻域峰值提取
function splitDetectNoveltyPoints(env, assistPoints, minSegmentSec = 30) {
  const total = env.total;
  if (total <= 6) return [];
  const minSeg = Math.max(8, minSegmentSec);
  const step = minSeg <= 48 ? 0.5 : 0.75;
  const samples = [];
  for (let p = 2; p <= total - 2 + 1e-9; p += step) {
    if (!splitAudibleSides(env, p, 0.55, -58)) continue; // ±0.55s 处必须有声（> -58 dBFS）
    const novelty = splitNoveltyScore(env, p);
    const macro = splitMacroNoveltyScore(env, p);
    const assist = splitAssistSupport(p, assistPoints);
    const centerDb = splitWindowDb(env, p, 180);
    const quietBonus = splitClamp((-centerDb - 26) / 18, 0, 1);
    samples.push({
      point: Math.round(p * 1000) / 1000,
      score: novelty * 0.48 + macro * 0.40 + quietBonus * 0.12 + assist * 0.25,
    });
  }
  if (samples.length < 5) return [];
  const raw = samples.map((s) => s.score);
  const peakScore = Math.max(...raw);
  if (peakScore <= 0) return [];
  const ordered = [...raw].sort((a, b) => a - b);
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const quantile = (f) => ordered[Math.max(0, Math.min(ordered.length - 1, Math.floor(ordered.length * f)))];
  // 邻域半径随预期段长缩放：min_seg=30、step=0.5 → ±3s
  const radius = Math.max(2, Math.min(6, Math.round(minSeg / (step * 8))));
  const extract = (threshold) => {
    const peaks = [];
    for (let i = radius; i < samples.length - radius; i++) {
      const cur = samples[i].score;
      if (cur < threshold) continue;
      let nbMax = -Infinity;
      for (let j = i - radius; j <= i + radius; j++) nbMax = Math.max(nbMax, samples[j].score);
      if (cur + 1e-6 < nbMax) continue;
      peaks.push({
        point: samples[i].point,
        confidence: Math.round(splitClamp(cur / Math.max(0.35, peakScore), 0, 1) * 1000) / 1000,
      });
    }
    return peaks;
  };
  const minUseful = Math.max(4, Math.min(14, Math.ceil(total / 300)));
  const thresholds = [
    Math.max(0.18, quantile(0.72) * 1.08, mean * 1.18),
    Math.max(0.14, quantile(0.60) * 1.02, mean * 1.06),
    Math.max(0.1, quantile(0.48) * 0.96, mean * 0.96),
  ];
  let peaks = [];
  for (const th of thresholds) {
    peaks = extract(th);
    if (peaks.length >= minUseful) break;
  }
  const maxCand = Math.max(8, Math.min(320, Math.ceil(total / Math.max(8, minSeg * 0.55)) * 4));
  if (peaks.length > maxCand) {
    peaks = peaks.sort((a, b) => b.confidence - a.confidence).slice(0, maxCand)
      .sort((a, b) => a.point - b.point);
  }
  return peaks;
}

// 等效 _combine_transition_points：多源候选按 1.1s 半径聚类，多源/多支撑加分
function splitCombineTransitionPoints(namedSets, mergeRadiusSec = 1.1) {
  const candidates = [];
  namedSets.forEach(([sourceName, points, sourceWeight]) => {
    const source = sourceName || 'transition';
    const weight = Math.max(0.25, sourceWeight);
    (points || []).forEach((item) => {
      if (!(item.point > 0)) return;
      const confidence = splitClamp(item.confidence || 0, 0, 1);
      candidates.push({
        point: Math.round(item.point * 1000) / 1000,
        confidence,
        source,
        scoreWeight: weight * Math.max(0.2, confidence),
      });
    });
  });
  if (!candidates.length) return [];
  candidates.sort((a, b) => a.point - b.point);
  const mergeRadius = Math.max(0.15, mergeRadiusSec);
  const clusters = [];
  candidates.forEach((cand) => {
    const cluster = clusters[clusters.length - 1];
    if (!cluster || Math.abs(cand.point - cluster.point) > mergeRadius) {
      clusters.push({
        point: cand.point, weightSum: cand.scoreWeight,
        maxConfidence: cand.confidence, supportCount: 1, sources: new Set([cand.source]),
      });
      return;
    }
    const totalWeight = Math.max(1e-6, cluster.weightSum + cand.scoreWeight);
    cluster.point = Math.round(((cluster.point * cluster.weightSum) + (cand.point * cand.scoreWeight)) / totalWeight * 1000) / 1000;
    cluster.weightSum = totalWeight;
    cluster.maxConfidence = Math.max(cluster.maxConfidence, cand.confidence);
    cluster.supportCount += 1;
    cluster.sources.add(cand.source);
  });
  return clusters.map((cluster) => ({
    point: cluster.point,
    confidence: Math.round(splitClamp(
      cluster.maxConfidence + 0.12 * Math.max(0, cluster.sources.size - 1) + 0.04 * Math.max(0, cluster.supportCount - 1),
      0, 1) * 1000) / 1000,
    sources: [...cluster.sources].sort(),
  }));
}

// 等效 _start_times_from_transition_points：来源加分 → selection_gap 去重 → min_gap 约束
function splitStartTimesFromPoints(points, total, minSegmentSec = 30) {
  if (total <= 0) return [0];
  const minGap = Math.max(8, Math.min(180, minSegmentSec));
  const candidates = [];
  (points || []).forEach((item) => {
    if (!(item.point > 0) || item.point >= total) return;
    const sources = [...new Set(item.sources || [])].sort();
    let sourceBonus = 0;
    if (sources.length >= 2) sourceBonus += 0.2;
    if (sources.includes('silence')) sourceBonus += 0.08; // 源码中是 essentia 位
    if (sources.length === 1 && sources[0] === 'novelty') sourceBonus -= 0.04;
    candidates.push({
      point: Math.round(item.point * 1000) / 1000,
      confidence: item.confidence || 0,
      score: splitClamp((item.confidence || 0) + sourceBonus, 0, 1.25),
    });
  });
  if (!candidates.length) return [0];
  const durationScale = splitClamp(total / 900, 0, 1);
  let selectionGap = minGap + Math.min(12, Math.max(4, minGap * 0.55)) * durationScale;
  selectionGap = Math.max(minGap, Math.min(40, selectionGap));
  const better = (cand, inc) => {
    if (!inc) return true;
    if (cand.score > inc.score + 1e-6) return true;
    if (Math.abs(cand.score - inc.score) <= 1e-6) {
      if (cand.confidence > inc.confidence + 1e-6) return true;
      if (Math.abs(cand.confidence - inc.confidence) <= 1e-6) return cand.point < inc.point;
    }
    return false;
  };
  candidates.sort((a, b) => a.point - b.point);
  const selected = [0];
  let lastKept = 0;
  let pending = null;
  candidates.forEach((cand) => {
    if (!pending) { pending = cand; return; }
    if (cand.point - pending.point < selectionGap) {
      if (better(cand, pending)) pending = cand;
      return;
    }
    if (pending.point - lastKept >= minGap) {
      lastKept = pending.point;
      selected.push(pending.point);
    }
    pending = cand;
  });
  if (pending && pending.point - lastKept >= minGap) selected.push(pending.point);
  return [...new Set(selected)].filter((t) => t >= 0 && t < total).sort((a, b) => a - b);
}

// 等效 _segments_from_transition_candidates：边界点 → 连续覆盖全长的分段
function splitSegmentsFromPoints(points, total) {
  const seen = new Set();
  const ordered = (points || [])
    .map((p) => ({ point: Math.round(p.point * 1000) / 1000, confidence: splitClamp(p.confidence || 0, 0, 1) }))
    .filter((p) => p.point > 0 && p.point < total && !seen.has(p.point) && seen.add(p.point))
    .sort((a, b) => a.point - b.point);
  const starts = [0, ...ordered.map((p) => p.point)];
  const segments = starts.map((start, idx) => {
    const end = idx + 1 >= starts.length ? total : starts[idx + 1];
    if (end <= start) return null;
    const bc = idx > 0 ? ordered[idx - 1].confidence : 0;
    return { start, end, confidence: bc, boundaryConfidence: bc };
  }).filter(Boolean);
  return segments.length ? segments : [{ start: 0, end: total, confidence: 0, boundaryConfidence: 0 }];
}

// 等效 _refine_audio_only_transition_boundaries：在 backtrack/forward 窗口内找综合分最高点精修边界
function splitRefineBoundaries(env, segments, assistPoints, minSegmentSec = 30) {
  if (segments.length < 2) return segments;
  const minSeg = minSegmentSec;
  const backtrack = Math.min(16, Math.max(6, minSeg * 0.45));
  const forward = Math.min(6, Math.max(1.5, minSeg * 0.12));
  const step = minSeg <= 60 ? 0.25 : 0.5;
  const minSide = Math.max(5, Math.min(14, minSeg * 0.22));
  for (let idx = 1; idx < segments.length; idx++) {
    const prev = segments[idx - 1];
    const curr = segments[idx];
    const base = curr.start;
    const lower = Math.max(prev.start + minSide, base - backtrack);
    const upper = Math.min(curr.end - minSide, base + forward);
    if (upper <= lower) continue;
    const originalConf = splitClamp(curr.boundaryConfidence || 0, 0, 1);
    let bestCandidate = base;
    let bestScore = null;
    let bestConf = originalConf;
    for (let cand = lower; cand <= upper + 1e-9; cand += step) {
      if (!splitAudibleSides(env, cand, 0.55, -60)) continue;
      const leftDb = splitWindowDb(env, Math.max(0, cand - 0.35), 170);
      const rightDb = splitWindowDb(env, cand + 0.35, 170);
      const centerDb = splitWindowDb(env, cand, 170);
      const energyJump = Math.abs(rightDb - leftDb);
      const novelty = splitNoveltyScore(env, cand);
      const macro = splitMacroNoveltyScore(env, cand);
      const assist = splitAssistSupport(cand, assistPoints);
      const quietNorm = splitClamp((-centerDb - 28) / 18, 0, 1);
      const jumpNorm = splitClamp(energyJump / 8, 0, 1);
      const noveltyNorm = splitClamp(novelty / 1.15, 0, 1);
      const macroNorm = splitClamp(macro / 1.15, 0, 1);
      const assistNorm = splitClamp(assist / 0.9, 0, 1);
      const distNorm = splitClamp(Math.abs(cand - base) / Math.max(1, backtrack + forward), 0, 1);
      const earlierBias = splitClamp((base - cand) / Math.max(1, backtrack), 0, 1);
      const confidence = splitClamp(
        noveltyNorm * 0.38 + macroNorm * 0.32 + jumpNorm * 0.18 + quietNorm * 0.12 + assistNorm * 0.28,
        0, 1);
      const score = novelty * 1.05 + macro * 0.95 + energyJump * 0.16 + quietNorm * 0.24
        + (1 - distNorm) * 0.16 + earlierBias * 0.22 + assist * 0.65;
      let isBetter = false;
      if (bestScore === null) isBetter = true;
      else if (score > bestScore + 1e-6) isBetter = true;
      else if (Math.abs(score - bestScore) <= 1e-6) {
        if (confidence > bestConf + 1e-6) isBetter = true;
        else if (Math.abs(confidence - bestConf) <= 1e-6 && cand < bestCandidate) isBetter = true;
      }
      if (isBetter) {
        bestCandidate = cand;
        bestScore = score;
        bestConf = confidence;
      }
    }
    if (Math.abs(bestCandidate - base) < 0.08 && bestConf <= originalConf + 0.03) continue;
    prev.end = bestCandidate;
    curr.start = bestCandidate;
    curr.boundaryConfidence = Math.round(bestConf * 1000) / 1000;
  }
  return segments;
}

// 等效 _merge_weak_audio_only_boundaries：弱边界（低置信 + 局部谷值/邻段过短）合并，
// assist 点 4s 半径内且合并后 >85s 的边界受保护
function splitMergeWeakBoundaries(segments, assistPoints, minSegmentSec = 30) {
  if (segments.length < 3) return segments;
  const assistSecs = (assistPoints || []).map((p) => p.point).sort((a, b) => a - b);
  const hasAssistSupport = (boundarySec) =>
    assistSecs.some((s) => Math.abs(s - boundarySec) <= 4);
  const values = segments.slice(1).map((s) => splitClamp(s.boundaryConfidence || 0, 0, 1));
  let weakFloor = 0.34;
  if (values.length) {
    const ordered = [...values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(ordered.length - 1, Math.floor(ordered.length * 0.43)));
    weakFloor = Math.max(0.32, Math.min(0.58, ordered[idx]));
  }
  let changed = true;
  while (changed && segments.length >= 3) {
    changed = false;
    for (let i = 1; i < segments.length;) {
      const curr = segments[i];
      const prev = segments[i - 1];
      const conf = splitClamp(curr.boundaryConfidence || 0, 0, 1);
      const prevDur = prev.end - prev.start;
      const currDur = curr.end - curr.start;
      if (hasAssistSupport(curr.start) && prevDur + currDur > 85) { i++; continue; }
      const prevConf = i > 1 ? splitClamp(segments[i - 1].boundaryConfidence || 0, 0, 1) : null;
      const nextConf = i < segments.length - 1 ? splitClamp(segments[i + 1].boundaryConfidence || 0, 0, 1) : null;
      let localValley = false;
      if (prevConf !== null && nextConf !== null) {
        localValley = conf + 0.06 < Math.max(prevConf, nextConf);
      } else if (prevConf !== null || nextConf !== null) {
        localValley = conf + 0.10 < (prevConf !== null ? prevConf : nextConf);
      }
      const shortAdjacent = Math.min(prevDur, currDur) < minSegmentSec * 1.25;
      if (conf < weakFloor && (localValley || shortAdjacent)) {
        prev.end = curr.end;
        segments.splice(i, 1);
        changed = true;
        continue;
      }
      i++;
    }
  }
  return segments;
}

// 等效 _merge_short_segments 的纯音频形态：无识别结果时 match_key 全未知，
// 短段并入置信度较高的一侧（同级取左）；首段 <35s 右并入（intro buildup 误切）
function splitMergeShortSegments(segments, minimumDuration) {
  if (segments.length < 3) return segments;
  if (segments[0].end - segments[0].start < 35 && segments.length >= 2) {
    segments[1].start = segments[0].start;
    segments.shift();
  }
  let i = 1;
  while (i < segments.length - 1) {
    const seg = segments[i];
    if (seg.end - seg.start >= minimumDuration) { i++; continue; }
    const prev = segments[i - 1];
    const next = segments[i + 1];
    if ((prev.confidence || 0) >= (next.confidence || 0)) prev.end = seg.end;
    else next.start = seg.start;
    segments.splice(i, 1);
  }
  return segments;
}

// 等效 _normalize_segment_boundaries：clamp + 保持连续 + 末段顶到总长
function splitNormalizeSegments(segments, total) {
  const out = [];
  let cursor = 0;
  segments.forEach((s, idx) => {
    let start = Math.max(cursor, s.start);
    let end = Math.max(start + 1, s.end);
    if (idx === segments.length - 1) end = total;
    else if (end > total) end = total;
    if (end <= start) return;
    out.push({ start, end });
    cursor = end;
  });
  return out;
}

// 等效 _fallback_interval_segments：检测失败时按 180s 等间隔切
function splitFallbackSegments(total, intervalSec = 180) {
  const out = [];
  const interval = Math.max(60, intervalSec);
  for (let start = 0; start < total; start += interval) {
    out.push({ start, end: Math.min(total, start + interval) });
  }
  return out;
}

// 高质量重采样：单声道 Float32 → 任意目标采样率（48k 网易云识曲 / 16k Shazam 识曲）。
// 走 OfflineAudioContext 渲染（浏览器内置重采样器，带抗混叠），
// 与官方识曲客户端「真实采样 → 指纹」的输入形态一致。
// srcRate 恰为目标采样率时原样返回；无 OfflineAudioContext 时退化为线性插值（不变调）。
async function renderClipRate(monoFloat, srcRate, dstRate) {
  if (srcRate === dstRate) return monoFloat;
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) {
    const outLen = Math.max(1, Math.round(monoFloat.length * dstRate / srcRate));
    const out = new Float32Array(outLen);
    const ratio = srcRate / dstRate; // 每个输出采样对应输入的位置步进
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(monoFloat.length - 1, i0 + 1);
      const frac = pos - i0;
      out[i] = monoFloat[i0] + (monoFloat[i1] - monoFloat[i0]) * frac;
    }
    return out;
  }
  const outLen = Math.max(1, Math.round(monoFloat.length * dstRate / srcRate));
  const ctx = new AC(1, outLen, dstRate);
  const buf = ctx.createBuffer(1, monoFloat.length, srcRate);
  buf.copyToChannel(monoFloat, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

// 从整轨 PCM 截取 [fromSec, fromSec+lenSec) 并重采样到 dstRate 的 Float32 单声道 clip。
// 优先用原始采样率源 hires（{ pcm: Int16Array, rate }），缺省时用 24kHz 整轨 PCM 兜底。
async function segmentClipFloat(hires, pcmInt16, fromSec, lenSec, dstRate) {
  const src = hires && hires.pcm && hires.rate ? hires : { pcm: pcmInt16, rate: 24000 };
  const a = Math.max(0, Math.floor(fromSec * src.rate));
  const b = Math.min(src.pcm.length, Math.ceil((fromSec + lenSec) * src.rate));
  if (b <= a) return null;
  const slice = src.pcm.subarray(a, b);
  const f = new Float32Array(slice.length);
  for (let i = 0; i < slice.length; i++) f[i] = slice[i] / 32768;
  return renderClipRate(f, src.rate, dstRate);
}

/* ---------- 对外 API ---------- */
const api = {
  hasBridge,

  // Electron 自定义协议保留 Range 请求并补齐 Referer，规避媒体元素直接访问 CDN 的 CORS/403。
  // 移动版（window.bili.mediaProxy 存在时）改走同源 /media 代理。
  media(url) {
    if (!hasBridge || !url) return url;
    return typeof window.bili.mediaProxy === 'function'
      ? window.bili.mediaProxy(url)
      : `biu-media://stream/?url=${encodeURIComponent(url)}`;
  },

  // 音乐区排行（首页推荐流不可用时的兜底列表）
  async ranking() {
    if (!hasBridge) return mockTracks();
    const data = await jget('https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&ps=20');
    return (data.list || []).map(toTrack);
  },

  // 首页真实推荐信息流：沿用 PiliPlus 的 WBI Web 推荐参数，再以视频详情严格筛选音乐分区。
  async recommendMusic(freshIdx = 0, limit = 12, mode = 'music') {
    if (!hasBridge) return mockTracks().slice(0, limit);
    const result = [];
    const seen = new Set();
    for (let page = 0; page < 3 && result.length < limit; page += 1) {
      const index = freshIdx + page;
      const query = new URLSearchParams({
        version: '1', feed_version: 'V8', homepage_ver: '1', ps: '20',
        fresh_idx: String(index), brush: String(index), fresh_type: '4',
      });
      const data = await jget(
        'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?' + query,
        { wbi: true },
      );
      const candidates = (data.item || []).filter((item) =>
        item.goto === 'av' && item.bvid && item.owner && !seen.has(item.bvid));
      candidates.forEach((item) => seen.add(item.bvid));
      if (mode === 'all') {
        result.push(...candidates.map((item) => recommendationToTrack(item, item)));
        continue;
      }

      // 小批量补取分区字段，既保持推荐顺序，也避免同时发出大量详情请求。
      for (let offset = 0; offset < candidates.length && result.length < limit; offset += 5) {
        const batch = candidates.slice(offset, offset + 5);
        const details = await Promise.all(batch.map((item) =>
          api.view(item.bvid).catch(() => null)));
        batch.forEach((item, i) => {
          const detail = details[i];
          if (detail && isMusicPartition(detail)) {
            result.push(recommendationToTrack(item, detail));
          }
        });
      }
    }
    return result.slice(0, limit);
  },

  // 视频搜索（不按时长排除短视频），返回 { list, numPages, page }
  // order: '' 综合 / click 最多播放 / pubdate 最新发布 / dm 最多弹幕 / stow 最多收藏
  // duration: 0 全部 / 1 <10 分钟 / 2 10-30 / 3 30-60 / 4 60+
  async search(keyword, order = '', duration = 0, page = 1) {
    if (!hasBridge) {
      return { list: mockTracks().filter((t) => t.title.includes(keyword) || t.up.includes(keyword)), numPages: 1, page: 1 };
    }
    let url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword='
      + encodeURIComponent(keyword) + '&page=' + page;
    if (order) url += '&order=' + encodeURIComponent(order);
    if (duration) url += '&duration=' + duration;
    const data = await jget(url);
    const list = (data.result || [])
      .filter((v) => v.type === 'video')
      .map(toTrack)
      .filter((t) => t.bvid);
    return { list, numPages: data.numPages || 1, page: data.page || page };
  },

  /* ---------- UP 主：搜索 / 关注 / 空间 ---------- */
  // UP 主搜索（按名字匹配用户，不是相关视频的作者聚合）
  // 返回 { list: [{ mid, name, fans, videos, sign, pic }], numPages }
  async searchUps(keyword, page = 1) {
    if (!hasBridge) return { list: [], numPages: 1 };
    const data = await jget('https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword='
      + encodeURIComponent(keyword) + '&page=' + page);
    const list = (data.result || [])
      .filter((u) => u.mid && u.uname)
      .map((u) => ({
        mid: u.mid,
        name: String(u.uname).replace(/<[^>]+>/g, ''),
        fans: u.fans || 0,
        videos: u.videos || 0,
        sign: u.usign || '',
        pic: absImg(u.upic),
      }));
    return { list, numPages: data.numPages || 1 };
  },

  // 关注状态：attribute 2=已关注 6=互关；未登录/失败返回 0（WBI 签名，relation 接口风控需要）
  async upRelation(mid) {
    if (!hasBridge || !mid) return 0;
    try {
      const data = await jget(`https://api.bilibili.com/x/relation/acc/info?mid=${mid}`, { wbi: true });
      return data.attribute || 0;
    } catch (e) {
      console.warn('关注状态查询失败:', e);
      return 0;
    }
  },

  // 关注 / 取关：act 1 关注 2 取关；csrf 由主进程自动补
  async followUp(mid, follow) {
    if (!hasBridge || !mid) throw new Error('预览模式不支持关注');
    const r = await withApiTimeout(window.bili.post(
      'https://api.bilibili.com/x/relation/modify', { fid: mid, act: follow ? 1 : 2, re_src: 11 }),
      8000, '关注操作超时');
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const d = JSON.parse(r.body);
    if (d.code !== 0) throw new Error(d.code === -101 ? '请先登录 B 站账号' : (d.message || ('code ' + d.code)));
    return true;
  },

  // 稿件与当前用户的关系：{ like, coin, favorite }（0/1）；未登录/失败返回 null
  async arcRelation(bvid) {
    if (!hasBridge || !bvid) return null;
    try {
      return await jget(
        `https://api.bilibili.com/x/web-interface/archive/relation?bvid=${encodeURIComponent(bvid)}`,
        { wbi: true });
    } catch (e) { return null; }
  },

  // 点赞 / 取消点赞：like 1 点赞 3 取消；csrf 由主进程自动补
  async likeVideo(aid, like) {
    if (!hasBridge || !aid) throw new Error('预览模式不支持点赞');
    const r = await withApiTimeout(window.bili.post(
      'https://api.bilibili.com/x/web-interface/archive/like', { aid, like: like ? 1 : 3 }),
      8000, '点赞操作超时');
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const d = JSON.parse(r.body);
    if (d.code !== 0) throw new Error(d.code === -101 ? '请先登录 B 站账号' : (d.message || ('code ' + d.code)));
    return true;
  },

  // 投币：n = 1/2 枚；csrf 由主进程自动补
  async coinVideo(aid, n = 1) {
    if (!hasBridge || !aid) throw new Error('预览模式不支持投币');
    const r = await withApiTimeout(window.bili.post(
      'https://api.bilibili.com/x/web-interface/coin/add', { aid, multiply: n, select_like: 0 }),
      8000, '投币操作超时');
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const d = JSON.parse(r.body);
    if (d.code !== 0) throw new Error(d.code === -101 ? '请先登录 B 站账号' : (d.message || ('code ' + d.code)));
    return true;
  },

  // 上报观看记录到 B 站历史（需登录；csrf 由主进程自动补）。
  // progress 为视频内播放进度（秒，分切段传段起点）；未登录/失败静默返回 false
  async historyReport(t, progress = 0) {
    if (!hasBridge || !t || t.isLive || !t.bvid) return false;
    let aid = t.aid;
    if (!aid) {
      try { const v = await api.view(t.bvid); aid = v && v.aid; } catch (e) {}
    }
    if (!aid) return false;
    try {
      const r = await withApiTimeout(window.bili.post(
        'https://api.bilibili.com/x/v2/history/report',
        { aid, cid: t.cid || 0, progress: Math.max(0, Math.round(progress)) }),
        8000, '观看记录上报超时');
      if (r.status !== 200) return false;
      return JSON.parse(r.body).code === 0;
    } catch (e) { return false; }
  },
  // UP 主空间信息（名字 / 头像 / 签名 / 等级）
  async upInfo(mid) {
    if (!hasBridge || !mid) return null;
    const data = await jget(`https://api.bilibili.com/x/space/wbi/acc/info?mid=${mid}`, { wbi: true });
    return {
      mid: data.mid, name: data.name || '',
      face: absImg(data.face),
      sign: data.sign || '', level: data.level || 0,
    };
  },

  // UP 主粉丝 / 关注数
  async upStat(mid) {
    if (!hasBridge || !mid) return { fans: 0, following: 0 };
    const data = await jget(`https://api.bilibili.com/x/relation/stat?vmid=${mid}`);
    return { fans: data.follower || 0, following: data.following || 0 };
  },

  // UP 主投稿视频（WBI 签名；order: pubdate 最新 / click 最多播放 / stow 最多收藏）
  async upVideos(mid, page = 1, ps = 30) {
    if (!hasBridge || !mid) return { list: [], total: 0 };
    const data = await jget(
      `https://api.bilibili.com/x/space/wbi/arc/search?mid=${mid}&pn=${page}&ps=${ps}&order=pubdate`,
      { wbi: true });
    const vlist = (data.list && data.list.vlist) || [];
    return {
      total: (data.page && data.page.count) || 0,
      list: vlist.filter((v) => v.bvid).map((v) => {
        // length 为 "mm:ss" / "hh:mm:ss" 文本
        const parts = String(v.length || '0:0').split(':').map(Number);
        const duration = parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : parts[0] * 60 + (parts[1] || 0);
        return {
          bvid: v.bvid, aid: v.aid, cid: 0,
          title: v.title, up: v.author || '',
          duration, pic: absImg(v.pic),
        };
      }),
    };
  },

  // UP 主动态：简化成 { kind, title, text, bvid, pic, time }；offset 分页游标
  async upDynamics(mid, offset = '') {
    if (!hasBridge || !mid) return { list: [], offset: '', hasMore: false };
    const data = await jget(
      `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${mid}&timezone_offset=-480`
      + (offset ? `&offset=${encodeURIComponent(offset)}` : ''));
    const list = (data.items || []).map((it) => {
      const author = (it.modules && it.modules.module_author) || {};
      const dyn = (it.modules && it.modules.module_dynamic) || {};
      const major = dyn.major || null;
      let kind = 'word';
      let title = '';
      let text = (dyn.desc && dyn.desc.text) || '';
      let bvid = null;
      let pic = null;
      if (major && major.type === 'MAJOR_TYPE_ARCHIVE' && major.archive) {
        kind = 'video';
        title = major.archive.title || '';
        bvid = major.archive.bvid || null;
        pic = absImg(major.archive.cover);
        if (!text) text = major.archive.desc || '';
      } else if (major && major.type === 'MAJOR_TYPE_OPUS' && major.opus) {
        title = major.opus.title || '';
        if (!text && major.opus.summary) text = major.opus.summary.text || '';
        const pics = major.opus.pics || [];
        if (pics.length) pic = absImg(pics[0].url);
      } else if (major && major.type === 'MAJOR_TYPE_DRAW' && major.draw) {
        const items = major.draw.items || [];
        if (items.length) pic = absImg(items[0].src);
      }
      return { kind, title, text, bvid, pic, time: author.pub_time || '' };
    }).filter((d) => d.title || d.text || d.bvid);
    return { list, offset: data.offset || '', hasMore: !!data.has_more };
  },

  // 视频详情：cid / aid / pic / owner / pages / stat
  async view(bvid) {
    if (!hasBridge) return null;
    return jget('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
  },

  // 播放地址：优先 dash 音频，退化 durl
  // 参考 wood3n/biu：主用 WBI 签名的 x/player/wbi/playurl，抗风控更好
  // quality: 0 标准(最低码率) 1 高品(最高码率) 2 无损(优先 flac，需登录/大会员)
  async playUrl(bvid, cid, quality = 1) {
    if (!hasBridge) return null;
    const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&fourk=1`;
    let data;
    try {
      data = await jget('https://api.bilibili.com/x/player/wbi/playurl?' + q, { wbi: true });
    } catch (e) {
      try {
        data = await jget('https://api.bilibili.com/x/player/playurl?' + q);
      } catch (e2) {
        data = await jget('https://api.bilibili.com/x/web-interface/playurl?' + q);
      }
    }
    const dash = data.dash;
    if (dash) {
      // 无损：flac 通道（display=false 多为无权限，退回最高码率）
      if (quality >= 2 && dash.flac && dash.flac.audio && dash.flac.display !== false) {
        const f = dash.flac.audio;
        return f.baseUrl || f.base_url;
      }
      if (dash.audio && dash.audio.length) {
        const audios = [...dash.audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        const pick = quality === 0 ? audios[audios.length - 1] : audios[0];
        return pick.baseUrl || pick.base_url;
      }
    }
    if (data.durl && data.durl.length) return data.durl[0].url;
    throw new Error('无可用播放地址');
  },

  // 返回当前账号、当前稿件真正拿得到且具有视频流的清晰度档位。
  async videoQualities(bvid, cid, force = false) {
    if (!hasBridge) return null;
    return availableVideoQualities(await videoManifest(bvid, cid, force));
  },

  // 原视频地址：1080P 以上使用 DASH 的 AVC 视频轨，声音沿用播放器现有音频轨。
  async videoUrl(bvid, cid, quality = 80, force = false) {
    if (!hasBridge) return null;
    const data = await videoManifest(bvid, cid, force);
    const qualities = availableVideoQualities(data);
    if (!qualities.length) throw new Error('没有 Chromium 可播放的视频清晰度');
    const requested = Number(quality) || 80;
    const selectedQuality = qualities.some((item) => item.quality === requested)
      ? requested
      : (qualities.find((item) => item.quality <= requested) || qualities[qualities.length - 1]).quality;
    const candidates = playableDashVideos(data)
      .filter((item) => Number(item.id) === selectedQuality)
      .sort((a, b) => {
        const aAvc = Number(a.codecid) === 7 || /^avc1/i.test(a.codecs || '') ? 1 : 0;
        const bAvc = Number(b.codecid) === 7 || /^avc1/i.test(b.codecs || '') ? 1 : 0;
        return bAvc - aAvc || Number(b.bandwidth || 0) - Number(a.bandwidth || 0);
      });
    const item = candidates[0];
    if (!item) throw new Error('所选清晰度没有可播放的视频轨');
    return {
      url: item.baseUrl || item.base_url,
      backups: item.backup_url || item.backupUrl || [],
      quality: selectedQuality,
      label: (qualities.find((entry) => entry.quality === selectedQuality) || {}).label,
      format: 'dash',
      codec: item.codecs || '',
      separateAudio: true,
      qualities,
      requestedQuality: requested,
    };
  },

  // 整文件下载（mp4/flv，含音轨）：请求非 DASH 的 playurl（type=mp4，无 fnval）。
  // 不传 quality 时返回当前默认档，并附带 accept_quality 可下载档位列表（菜单用）。
  // 返回 { url, quality, label, format, qualities }
  async videoDownloadInfo(bvid, cid, quality) {
    if (!hasBridge) throw new Error('当前环境不支持下载');
    const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid}&type=mp4&platform=html5&high_quality=1`
      + (quality ? `&qn=${quality}` : '');
    let data;
    try { data = await jget('https://api.bilibili.com/x/player/wbi/playurl?' + q, { wbi: true }); }
    catch (e) { data = await jget('https://api.bilibili.com/x/player/playurl?' + q); }
    if (!data || !data.durl || !data.durl.length) throw new Error('该视频暂不支持整文件下载');
    const qualities = (data.accept_quality || []).map((qn, i) => ({
      quality: qn,
      label: (data.accept_description || [])[i] || `${qn}P`,
    }));
    return {
      url: data.durl[0].url,
      quality: data.quality,
      label: (qualities.find((item) => item.quality === data.quality) || {}).label || `${data.quality}P`,
      format: /flv/.test(data.format || '') ? 'flv' : 'mp4',
      qualities,
    };
  },

  // MixSplitR 分切检测：优先 B 站章节（view_points），其次简介时间轴文本。
  // MixSplitR 桌面端生成的时间表可通过面板「导入时间表」按钮读入，走同一解析。
  async mixSplitDetect(bvid, cid, duration) {
    if (!hasBridge || !bvid) return [];
    // 1. 视频章节
    try {
      const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid || 0}`;
      let data = null;
      try { data = await jget('https://api.bilibili.com/x/player/wbi/v2?' + q, { wbi: true }); }
      catch (e) { data = await jget('https://api.bilibili.com/x/player/v2?' + q); }
      const pts = ((data && data.view_points) || [])
        .filter((p) => p && p.content && isFinite(+p.from))
        .map((p) => ({ from: +p.from, name: String(p.content).trim() }))
        .sort((a, b) => a.from - b.from);
      if (pts.length >= 2) {
        return pts.map((s, i) => ({
          from: s.from,
          to: i + 1 < pts.length ? pts[i + 1].from : (duration || s.from + 180),
          name: s.name,
        })).filter((s) => s.to > s.from + 5);
      }
    } catch (e) { /* 无章节则走简介解析 */ }
    // 2. 简介时间轴
    try {
      const d = await api.view(bvid);
      return parseTimestampLines(d && d.desc, duration);
    } catch (e) {
      return [];
    }
  },

  // 解析 MixSplitR 导出的时间表 / 任意"时间 + 歌名"文本为分段
  parseTracklistText(text, totalDuration) {
    return parseTimestampLines(text, totalDuration);
  },

  // 本地智能分切（MixSplitR 纯应用内实现，不依赖外部工具）：
  // 拉高品音频 → Web Audio 解码 → 重采样 24kHz 单声道 → 50ms 能量包络 → 按 mode 分切。
  // mode = 'transition'（默认）：novelty 能量跃迁扫描（micro/macro 差分 + 静音锚点 assist）→
  //        连续分段 → 边界精修 → 弱边界/短段/尾段合并 → 180s 等间隔兜底；
  // mode = 'silence'：纯静音间隙分切（≥1.6s、-42dB 的静音区间中点作为边界）；
  // mode = 'interval'：180s 等间隔分切。
  // 产出三份数据：24000Hz int16 PCM（包络检测 + 识曲兜底源）、≤20000 点波形 peaks、
  // 以及原始采样率单声道 int16 srcPcm（识曲从这里截取 clip 再转成真实 48k/16kHz）。
  // onProgress(phase, ratio)：phase = download / decode / analyze
  async splitAnalyzeAudio(bvid, cid, duration, onProgress, mode = 'transition') {
    if (!hasBridge || !bvid) throw new Error('当前环境不支持本地分析');
    const url = await api.playUrl(bvid, cid, 1); // 高品：识曲指纹需要更干净的声音
    if (!url) throw new Error('无法获取音频流');
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error('音频下载失败（HTTP ' + res.status + '）');
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress) onProgress('download', total ? got / total : 0);
    }
    const bytes = new Uint8Array(got);
    let off = 0;
    chunks.forEach((c) => { bytes.set(c, off); off += c.length; });
    if (onProgress) onProgress('decode', 0);
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new AC(1, 1, 44100);
    const audio = await ctx.decodeAudioData(bytes.buffer);
    if (onProgress) onProgress('analyze', 0);

    const sr = audio.sampleRate;
    const chA = audio.getChannelData(0);
    const chB = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
    const totalDur = duration || audio.duration;

    // 整轨单声道 int16 @ 原始采样率（44.1/48k）：分段识曲的 clip 直接从这里截取，
    // 避免「原始 → 24k → 48k」两次线性插值把指纹高频细节磨没（识曲链路见 identifySegmentAudio）。
    // 超长视频（> ~2 小时）为控制内存不保留，识曲自动退回 24k 插值链路。
    const SRC_MAX_BYTES = 768 * 1024 * 1024;
    let srcPcm = null;
    if (audio.length * 2 <= SRC_MAX_BYTES) {
      srcPcm = new Int16Array(audio.length);
      for (let i = 0; i < audio.length; i++) {
        const v = chB ? (chA[i] + chB[i]) / 2 : chA[i];
        srcPcm[i] = Math.max(-1, Math.min(1, v)) * 32767;
      }
    }

    // 混单声道 + 线性插值重采样到 24000Hz 的 int16 PCM
    // （用于分切能量包络检测；无 srcPcm 时也作为识曲 clip 的兜底源）
    const rate = 24000;
    const pcmLen = Math.max(1, Math.round(audio.duration * rate));
    const pcm = new Int16Array(pcmLen);
    const ratio = sr / rate; // 每个输出采样对应源 PCM 的位置步进
    for (let i = 0; i < pcmLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(audio.length - 1, i0 + 1);
      const frac = pos - i0;
      let v0 = chA[i0];
      let v1 = chA[i1];
      if (chB) { v0 = (v0 + chB[i0]) / 2; v1 = (v1 + chB[i1]) / 2; }
      pcm[i] = Math.max(-1, Math.min(1, v0 + (v1 - v0) * frac)) * 32767;
    }

    // —— 分切检测（按用户选择的 mode）——
    const env = splitBuildEnvelope(pcm, rate);
    let segments;
    if (mode === 'interval') {
      segments = splitFallbackSegments(totalDur, 180); // 固定 180s 等间隔
    } else if (mode === 'silence') {
      // 纯静音间隙：静音区间中点直接作为候选边界（不做 novelty 扫描）
      const anchors = splitDetectSilenceAnchors(env);
      const points = anchors.map((a) => ({ point: a.point, confidence: a.confidence, sources: ['silence'] }));
      const starts = splitStartTimesFromPoints(points, totalDur, 30);
      if (starts.length > 1) {
        const kept = new Set(starts.slice(1));
        const selected = points.filter((p) => kept.has(Math.round(p.point * 1000) / 1000));
        segments = splitSegmentsFromPoints(selected, totalDur);
        segments = splitMergeShortSegments(segments, Math.max(30 * 0.55, 10));
        segments = splitNormalizeSegments(segments, totalDur);
      } else {
        segments = splitFallbackSegments(totalDur, 180);
      }
    } else {
      // Transition 模式（默认）：novelty 能量跃迁 + 静音锚点 assist
      const anchors = splitDetectSilenceAnchors(env); // 静音锚点充当 assist 支撑项
      const noveltyPoints = splitDetectNoveltyPoints(env, anchors, 30);
      const transitionPoints = splitCombineTransitionPoints([
        ['silence', anchors, 1.0],   // 源码中 essentia 的权重位
        ['novelty', noveltyPoints, 0.92],
      ]);
      const startTimes = splitStartTimesFromPoints(transitionPoints, totalDur, 30);
      if (startTimes.length > 1) {
        const kept = new Set(startTimes.slice(1));
        const selected = transitionPoints.filter((p) =>
          kept.has(Math.round(p.point * 1000) / 1000));
        segments = splitSegmentsFromPoints(selected, totalDur);
        segments = splitRefineBoundaries(env, segments, anchors, 30);
        segments = splitMergeWeakBoundaries(segments, anchors, 30);
        // 文件末尾 <35s 且 boundary_confidence <0.35 的尾段并入前段
        if (segments.length >= 2) {
          const last = segments[segments.length - 1];
          if (last.end - last.start < 35 && (last.boundaryConfidence || 0) < 0.35) {
            segments[segments.length - 2].end = last.end;
            segments.pop();
          }
        }
        segments = splitMergeShortSegments(segments, Math.max(30 * 0.55, 10));
        segments = splitNormalizeSegments(segments, totalDur);
      } else {
        segments = splitFallbackSegments(totalDur, 180); // 检测失败：180s 等间隔兜底
      }
    }
    const result = segments.slice(0, 60).map((s) => ({
      from: Math.round(s.start * 10) / 10,
      to: Math.round(s.end * 10) / 10,
      name: '',
    }));

    // MixSplitR 波形：步长 = 总采样/20000，每桶 max-abs，归一化到 [0,1]
    const step = Math.max(1, Math.floor(audio.length / 20000));
    const bucketCount = Math.ceil(audio.length / step);
    const raw = new Float32Array(bucketCount);
    let peakMax = 0;
    for (let i = 0; i < bucketCount; i++) {
      const start = i * step;
      const end = Math.min(audio.length, start + step);
      let m = 0;
      for (let j = start; j < end; j += 2) {
        const a = Math.abs(chA[j]);
        if (a > m) m = a;
        if (chB) { const b = Math.abs(chB[j]); if (b > m) m = b; }
      }
      raw[i] = m;
      if (m > peakMax) peakMax = m;
    }
    const peaks = new Float32Array(bucketCount);
    const norm = peakMax > 1e-6 ? 1 / peakMax : 0;
    for (let i = 0; i < bucketCount; i++) peaks[i] = raw[i] * norm;

    return { segs: result, pcm, rate, peaks, duration: totalDur, srcPcm, srcRate: sr };
  },

  // Shazam 识曲：主进程 shazamio-core WASM 签名 → amp.shazam.com 匹配。
  // pcm16k 为 16kHz 单声道 Float32 的 ArrayBuffer。
  // 返回 { title, artist, album, year, genre, pic, source: 'shazam' }，无结果返回 null
  async shazamIdentify(pcm16k) {
    if (!hasBridge || !pcm16k) return null;
    if (typeof window.bili.shazamRecognize !== 'function') return null; // 主进程尚未接入 shazamio-core
    const r = await window.bili.shazamRecognize({ pcm: pcm16k });
    if (!r || !r.title) return null;
    return { ...r, source: 'shazam' };
  },

  // 网易云听歌识曲：主进程 afp 指纹 → interface.music.163.com 匹配。
  // pcm 为已重采样好的 48kHz Float32 的 ArrayBuffer，from/len 为该缓冲内的秒区间。
  // 返回 { title, artist, album, pic, source: 'netease' }，无结果返回 null
  async neteaseIdentify(pcm, from, len) {
    if (!hasBridge || !pcm) return null;
    const list = await window.bili.ncmRecognize({ pcm, from, len });
    if (!list || !list.length) return null;
    const song = list[0];
    let pic = null;
    try {
      const r = await window.bili.get(
        `https://music.163.com/api/song/detail/?id=${song.id}&ids=[${song.id}]`);
      if (r.status === 200) {
        const s = (JSON.parse(r.body).songs || [])[0];
        pic = s && s.album && s.album.picUrl ? s.album.picUrl.replace(/^http:/, 'https:') : null;
      }
    } catch (e) { /* 封面失败不阻塞识别 */ }
    return { title: song.title, artist: song.artist, album: song.album, pic, source: 'netease', id: song.id };
  },

  // 分段识别编排（MixSplitR 链路）：先网易云，未命中回退 Shazam。
  // 网易云：原始 44.1/48k 音频 → 截取段首最长 25s clip → 重采样成真实 48kHz →
  //         Encode(clip, 4, 6, 0) → POST interface.music.163.com（主进程）。
  // Shazam：段首 4s 起最长 12s clip → 重采样成 16kHz → shazamio-core 签名 → amp.shazam.com。
  // pcmInt16 为整轨单声道 int16 @24000Hz（无 hires 时的识曲兜底源），segFrom/segTo 单位：秒；
  // hires 为 { pcm: Int16Array, rate } 原始采样率单声道源（splitAnalyzeAudio 的 srcPcm/srcRate）；
  // onLog(msg) 可选，回报识别链路事件（面板日志用）。
  async identifySegmentAudio(pcmInt16, segFrom, segTo, hires, onLog) {
    if (!hasBridge || !pcmInt16) return null;
    const segDur = segTo - segFrom;
    if (segDur <= 0) return null;
    const log = typeof onLog === 'function' ? onLog : () => {};
    const clipLen = Math.min(segDur, 25);
    // 网易云：优先从原始采样率源截取（单次高质量重采样，指纹细节最完整）
    const clip48 = await segmentClipFloat(hires, pcmInt16, segFrom, clipLen, 48000);
    if (clip48) {
      const probeFrom = clipLen > 10 ? 4 : 0; // 跳过段首淡入/说话，4s 起取 6s 探针
      const probeLen = Math.min(6, clipLen);
      log(`网易云识曲：截取 ${Math.round(clipLen)}s clip，探针 ${probeFrom}s 起 ${probeLen}s`);
      const hit = await api.neteaseIdentify(clip48.buffer, probeFrom, probeLen);
      if (hit) {
        log(`网易云命中：${hit.title}${hit.artist ? ' - ' + hit.artist : ''}`);
        return hit;
      }
      log('网易云未命中，回退 Shazam…');
    } else {
      log('分段超出音频范围，跳过网易云识曲');
    }
    // Shazam 回退：段首 4s 起最长 12s（Shazam 只需几秒音频，短 clip 指纹更聚焦）
    const shFrom = clipLen > 16 ? 4 : 0;
    const shLen = Math.min(12, clipLen - shFrom);
    const clip16 = shLen > 3 ? await segmentClipFloat(hires, pcmInt16, segFrom + shFrom, shLen, 16000) : null;
    if (clip16) {
      log(`Shazam 识曲：${Math.round(segFrom + shFrom)}s 起 ${Math.round(shLen)}s clip`);
      const hit = await api.shazamIdentify(clip16.buffer);
      if (hit) {
        log(`Shazam 命中：${hit.title}${hit.artist ? ' - ' + hit.artist : ''}`);
        return hit;
      }
      log('Shazam 未命中');
    }
    return null;
  },

  // 联网搜索歌曲候选：并行搜 QQ 音乐 + 网易云，返回合并候选列表（QQ 在前）。
  // QQ 候选封面由 albummid 直拼 y.gtimg.cn 图床（无需二次请求）；网易云候选封面按需 resolveSongCover。
  // 返回 [{ title, artist, duration, pic, source: 'qq' | 'netease', id?, albummid? }]；两源都失败返回 []
  async searchSongCandidates(name, { source, limit = 6 } = {}) {
    if (!hasBridge || !name) return [];
    const fetchNetease = async () => {
      try {
        const r = await window.bili.get('https://music.163.com/api/search/get/web?s='
          + encodeURIComponent(name) + `&type=1&limit=${limit}&offset=0`);
        if (r.status !== 200) return [];
        return (((JSON.parse(r.body).result || {}).songs) || []).map((s) => ({
          title: s.name,
          artist: (s.artists || []).map((a) => a.name).join('/'),
          duration: (s.duration || 0) / 1000,
          id: s.id,
          pic: null,
          source: 'netease',
        }));
      } catch (e) { return []; } // 单源失败不阻塞另一源
    };
    const fetchQQ = async () => {
      try {
        const r = await window.bili.get('https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w='
          + encodeURIComponent(name) + `&format=json&p=1&n=${limit}&t=0`,
          { referer: 'https://y.qq.com/' });
        if (r.status !== 200) return [];
        const list = ((JSON.parse(r.body).data || {}).song || {}).list || [];
        const clean = (v) => String(v || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
        return list.map((s) => ({
          title: clean(s.songname),
          artist: (s.singer || []).map((a) => clean(a.name)).filter(Boolean).join('/'),
          duration: Number(s.interval) || 0, // QQ 的 interval 单位就是秒
          songmid: s.songmid,
          albummid: s.albummid,
          pic: s.albummid
            ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : null,
          source: 'qq',
        })).filter((s) => s.title);
      } catch (e) { return []; }
    };
    const [ne, qq] = await Promise.all([
      source === 'qq' ? [] : fetchNetease(), source === 'netease' ? [] : fetchQQ(),
    ]);
    return [...qq, ...ne]; // QQ 在前：手动填名匹配默认采用 QQ 结果
  },

  // 补封面：候选已有 pic 直接用；网易云候选按 id 走详情接口现取
  async resolveSongCover(cand) {
    if (!hasBridge || !cand) return null;
    if (cand.pic) return cand.pic;
    if (cand.source === 'netease' && cand.id) {
      try {
        const r = await window.bili.get(
          `https://music.163.com/api/song/detail/?id=${cand.id}&ids=[${cand.id}]`);
        if (r.status === 200) {
          const s = (JSON.parse(r.body).songs || [])[0];
          return s && s.album && s.album.picUrl ? s.album.picUrl.replace(/^http:/, 'https:') : null;
        }
      } catch (e) { /* 封面失败不阻塞匹配 */ }
    }
    return null;
  },

  // 联网匹配歌曲完整信息：QQ 源优先（手动填名的默认结果），源内按时长就近挑歌。
  // 返回 { title, artist, duration, pic, source }；两源都失败返回 null
  async matchSong(name, durationSec) {
    const candidates = await api.searchSongCandidates(name);
    if (!candidates.length) return null;
    // 源内挑歌：时长差 ≤12s 内取最接近的，否则取第一个
    const pickFrom = (list) => {
      if (!list.length) return null;
      if (!(durationSec > 0)) return list[0];
      const near = list
        .filter((c) => c.duration > 0 && Math.abs(c.duration - durationSec) <= 12)
        .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec));
      return near[0] || list[0];
    };
    const pick = pickFrom(candidates.filter((c) => c.source === 'qq'))
      || pickFrom(candidates.filter((c) => c.source === 'netease'));
    const pic = await api.resolveSongCover(pick);
    return {
      title: pick.title,
      artist: pick.artist,
      duration: pick.duration,
      pic,
      source: pick.source,
      id: pick.id,
      songmid: pick.songmid,
    };
  },

  // 按匹配结果拉 LRC 时间轴：QQ 走 fcg_query_lyric_new.fcg（base64 歌词体），
  // 网易云走 api/song/lyric。返回 parseLrc 后的 [{ from, to, text }]（相对歌曲起点），失败返回 null
  async lyricForMatch(match) {
    if (!hasBridge || !match) return null;
    const src = match.lrcSource || match.source; // 识别链可另带可拉词的源（Shazam → QQ/网易云）
    try {
      if (src === 'qq' && match.songmid) {
        const r = await window.bili.get(
          'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' + match.songmid
          + '&format=json&nobase64=0&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0',
          { referer: 'https://y.qq.com/' });
        if (r.status !== 200) return null;
        const d = JSON.parse(r.body);
        if (!d.lyric) return null; // 纯音乐 / 无歌词
        // QQ 歌词体是 base64(utf-8)，TextDecoder 还原
        const text = new TextDecoder('utf-8')
          .decode(Uint8Array.from(atob(d.lyric), (ch) => ch.charCodeAt(0)));
        const lines = parseLrc(text);
        return lines.length >= 3 ? lines : null;
      }
      if (src === 'netease' && match.id) {
        const r = await window.bili.get(`https://music.163.com/api/song/lyric?id=${match.id}&lv=1`);
        if (r.status !== 200) return null;
        const d = JSON.parse(r.body);
        if (d.nolyric || d.pureMusic || !d.lrc || !d.lrc.lyric) return null;
        const lines = parseLrc(d.lrc.lyric);
        return lines.length >= 3 ? lines : null;
      }
    } catch (e) {
      console.error('匹配歌词拉取失败', e);
    }
    return null;
  },

  // 单曲歌词搜索：QQ 优先，未命中可用歌词再查网易云；各源按时长挑歌。
  // 命中失败（无结果 / 时长差太多 / 纯音乐）返回 null，由调用方回退 AI 字幕
  async searchLyric(title, artist, durationSec) {
    if (!hasBridge || !title) return null;
    try {
      // 优先使用书名号内的歌名；没有明确歌名时再清洗视频标题。
      const songTitle = String(title).match(/《([^《》]+)》/)?.[1].trim();
      let q = songTitle || String(title)
        .replace(/【[^】]*】/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[《》「」]/g, ' ')
        .replace(/\b(official|music video|mv|hd|4k|1080p|lyric|lyrics)\b/gi, ' ')
        .replace(/(官方|完整版|无损|高音质|音质|歌词版|字幕版)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!songTitle && q.length < 2) q = String(title).trim();
      const queries = [q];
      if (artist && !q.includes(artist)) queries.push(`${q} ${artist}`);
      for (const source of ['qq', 'netease']) {
        let songs = [];
        for (const query of queries) {
          songs = await api.searchSongCandidates(query, { source, limit: 8 });
          if (songs.length) break;
        }
        if (!songs.length) continue;
        // 容忍 10s 取最接近者，否则仅接受搜索首项时长差不超过 15s。
        let pick = songs[0];
        if (durationSec > 0) {
          const near = songs.filter((s) => Math.abs(s.duration - durationSec) <= 10)
            .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec));
          if (near.length) pick = near[0];
          else if (Math.abs(pick.duration - durationSec) > 15) continue;
        }
        const lines = await api.lyricForMatch(pick);
        if (lines?.length) return lines;
      }
      return null;
    } catch (e) {
      console.error('歌词搜索失败', e);
      return null;
    }
  },

  // 旧播放器字幕优先；无可用字幕时回退新版 Protobuf 接口，沿用当前登录态。
  // 返回 [{ from, to, text }]，无字幕返回 null。
  async subtitles(bvid, cid) {
    if (!hasBridge) return null;
    return window.BiuSubtitles.fetchSubtitles(window.bili.get, bvid, cid);
  },

  // 历史弹幕 XML：原视频直播模式叠加使用。
  async danmaku(cid) {
    if (!hasBridge || !cid) return [];
    const r = await window.bili.get(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`);
    if (r.status !== 200) return [];
    const xml = new DOMParser().parseFromString(r.body, 'text/xml');
    return [...xml.querySelectorAll('d')].slice(0, 1200).map((node) => {
      const p = (node.getAttribute('p') || '').split(',');
      return {
        time: +p[0] || 0,
        mode: +p[1] || 1,
        size: Math.min(24, Math.max(12, +p[2] || 18)),
        color: '#' + Math.max(0, +p[3] || 16777215).toString(16).padStart(6, '0'),
        text: (node.textContent || '').trim().slice(0, 80),
      };
    }).filter((item) => item.text && item.mode <= 3).sort((a, b) => a.time - b.time);
  },

  // 热门评论（sort=2 按热度）
  async replies(aid) {
    if (!hasBridge) {
      return MOCK_COMMENTS.map(([n, t, l, s]) => ({ uname: n, message: t, like: l, seed: s }));
    }
    const data = await jget(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&ps=5`);
    return (data.replies || []).map((r) => ({
      uname: r.member && r.member.uname,
      message: r.content && r.content.message,
      like: r.like,
      avatar: r.member && (r.member.avatar || r.member.face || ''),
    }));
  },

  // 音乐电台直播列表（parent_area_id=5 电台区），支持分页下滑加载
  async rooms(page = 1) {
    if (!hasBridge) {
      return MOCK_RADIOS.map(([t, online, seed, area]) => ({
        title: t, uname: 'Biu 电台', online, cover: null, seed, area, roomid: 0,
      }));
    }
    const data = await jget(`https://api.live.bilibili.com/room/v1/area/getRoomList?platform=web&parent_area_id=5&page=${page}&page_size=12`);
    // 不同接口版本可能返回数组或 {list}，统一兼容。
    const list = Array.isArray(data) ? data : ((data && (data.list || data.rooms)) || []);
    return list.map((r) => ({
      title: r.title, uname: r.uname, online: r.online,
      cover: r.cover || r.system_cover || null, area: r.area_v2_name,
      roomid: r.roomid,
    }));
  },

  // 关注的主播中正在直播的房间（需登录，最多返回前 10 个，含头像/在线人数）
  async followedLives() {
    if (!hasBridge) return [];
    const data = await jget('https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList?hit_ab=false');
    return ((data && (data.rooms || data.list)) || [])
      .filter((r) => Number(r.live_status) === 1 && r.roomid)
      .map((r) => ({
        roomid: r.roomid, title: r.title, uname: r.uname, face: r.face,
        online: r.online || 0, area: r.area_v2_name || r.area_name,
        cover: r.cover_from_user || r.keyframe || null,
      }));
  },

  // 直播间最近弹幕（HTTP 轮询用；真正的实时弹幕需要 WebSocket 长连）
  async liveDanmaku(roomid) {
    if (!hasBridge || !roomid) return [];
    const data = await jget(`https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${roomid}&room_type=0`);
    return ((data && data.room) || []).map((item) => ({
      text: item.text, nickname: item.nickname, uid: item.uid, timeline: item.timeline,
    }));
  },

  // 直播间 HLS 地址。旧的 room/v1/playUrl 已于 2026 年下线，
  // 改用直播网页当前的 getRoomPlayInfo，优先 fMP4，再退到 TS。
  async livePlayUrl(roomid) {
    const data = await jget(
      `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomid}` +
      '&protocol=0,1&format=0,1,2&codec=0&qn=10000&platform=web&ptype=8'
    );
    if (!data || data.live_status !== 1) throw new Error('当前直播间未开播');
    const streams = data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.stream;
    const hls = (streams || []).find((stream) => stream.protocol_name === 'http_hls');
    const formats = hls && hls.format || [];
    const format = formats.find((item) => item.format_name === 'fmp4') ||
      formats.find((item) => item.format_name === 'ts') || formats[0];
    const codecs = format && format.codec || [];
    const codec = codecs.find((item) => item.codec_name === 'avc') || codecs[0];
    const endpoint = codec && codec.url_info && codec.url_info[0];
    if (!codec || !endpoint || !endpoint.host) throw new Error('直播间暂无可用 HLS 流');
    return endpoint.host + codec.base_url + endpoint.extra;
  },

  // 当前登录用户（Cookie 由 Electron session 自动携带）
  async nav() {
    if (!hasBridge) return null;
    return jget('https://api.bilibili.com/x/web-interface/nav');
  },

  // 我创建的收藏夹列表
  async favFolders(mid) {
    const data = await jget(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
    return (data.list || []).map((f, i) => {
      const cover = f.cover ? f.cover.replace(/^http:/, 'https:') : null;
      return { id: f.id, title: f.title, count: f.media_count, cover, pic: cover,
        intro: f.intro || '', seed: 44 + i * 3 };
    });
  },

  // 收藏夹详情（标题 / 简介 / 封面），编辑前回填用
  async favFolderInfo(mediaId) {
    if (!hasBridge || !mediaId) return null;
    const data = await jget(`https://api.bilibili.com/x/v3/fav/folder/info?media_id=${mediaId}`);
    return data ? { title: data.title || '', intro: data.intro || '', cover: data.cover || '' } : null;
  },

  // 重命名收藏夹 / 修改简介，同步到 B 站；csrf 由主进程自动补
  async favFolderEdit(mediaId, title, intro) {
    if (!hasBridge || !mediaId) throw new Error('预览模式不支持编辑收藏夹');
    const r = await withApiTimeout(window.bili.post(
      'https://api.bilibili.com/x/v3/fav/folder/edit', {
        media_id: mediaId, title, intro,
      }), 8000, '收藏夹编辑超时');
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const d = JSON.parse(r.body);
    if (d.code !== 0) throw new Error(d.message || ('code ' + d.code));
    return true;
  },

  // 我创建的收藏夹 + 当前稿件在各夹中的收藏状态（fav_state）；未登录返回 null
  async favFoldersWithState(aid) {
    if (!hasBridge || !aid) return null;
    const auth = await api.nav();
    if (!auth || !auth.isLogin) return null;
    const data = await jget(
      `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${auth.mid}&type=2&rid=${aid}`);
    return (data.list || []).map((f, i) => ({
      id: f.id, title: f.title, count: f.media_count,
      favored: Number(f.fav_state) === 1, seed: 44 + i * 3,
    }));
  },

  // 收藏 / 取消收藏：rid=aid, type=2（视频），add/del 为收藏夹 id 数组；csrf 由主进程自动补
  async favDeal(aid, addIds = [], delIds = []) {
    if (!hasBridge || !aid) throw new Error('预览模式不支持收藏');
    const r = await withApiTimeout(window.bili.post(
      'https://api.bilibili.com/x/v3/fav/resource/deal', {
        rid: aid, type: 2,
        add_media_ids: addIds.join(','),
        del_media_ids: delIds.join(','),
        platform: 'web',
      }), 8000, '收藏操作超时');
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const d = JSON.parse(r.body);
    if (d.code !== 0) throw new Error(d.message || ('code ' + d.code));
    return true;
  },

  // 收藏夹内容
  async favItems(mediaId) {
    const data = await jget(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&ps=40`);
    return (data.medias || []).map((m) => ({
      bvid: m.bvid, aid: m.id, cid: 0,
      title: m.title, up: (m.upper && m.upper.name) || '',
      duration: m.duration || 0,
      pic: m.cover ? m.cover.replace(/^http:/, 'https:') : null,
    }));
  },

  // 图片 → dataURL（封面取色，避免 canvas 跨域污染）
  async image(url) {
    if (!hasBridge || !url) return null;
    return window.bili.image(url);
  },
};

// 供 React 版前端（ES 模块）复用：挂到全局对象，模块内未限定标识符可经全局对象解析到。
// 旧版渲染层是经典脚本共享词法作用域，这两行对它无副作用。
window.api = api;
window.coverSVG = coverSVG;
