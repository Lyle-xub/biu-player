/* Biu Player RN · B 站 API 封装（移植自 renderer/api.js，window.bili.get → client.get）
 * endpoint 与参数与桌面端一致；返回结构与原 api 对象相同。
 */
import * as client from './client';

/* ---------- 工具 ---------- */
// 去掉搜索标题里的 <em class="keyword"> 高亮标签
export const stripEm = (s) => String(s || '').replace(/<[^>]+>/g, '');
// "m:ss" / "h:mm:ss" → 秒（搜索结果 duration 是字符串）
export function parseDur(d) {
  if (typeof d === 'number') return d;
  const parts = String(d || '0:00').split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + (n || 0), 0);
}
// 图片地址归一：协议相对 / http 统一补成 https
export function absImg(u) {
  if (!u) return null;
  if (u.startsWith('//')) return 'https:' + u;
  return u.replace(/^http:/, 'https:');
}
// 排行 / 搜索条目统一为 track（mid 供跳 UP 主空间页）
export function toTrack(v) {
  return {
    bvid: v.bvid || null,
    aid: v.aid || v.id || 0,
    cid: v.cid || 0,
    title: stripEm(v.title),
    up: (v.owner && v.owner.name) || v.author || '',
    mid: (v.owner && v.owner.mid) || v.mid || 0,
    duration: parseDur(v.duration),
    pic: v.pic ? absImg(v.pic) : null,
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
    mid: (item.owner && item.owner.mid) || (detail.owner && detail.owner.mid) || 0,
    duration: Number(item.duration || detail.duration || 0),
    pic: absImg(item.pic || detail.pic || ''),
    tid: detail.tid,
    tname: detail.tname || '音乐',
    recommendationReason: (item.rcmd_reason && item.rcmd_reason.content) || '',
    stat: item.stat || detail.stat || null,
  };
}

async function jget(url, opts) {
  const r = await client.get(url, opts);
  if (r.status !== 200) throw new Error(r.status === -1 ? (r.body || '网络请求失败') : ('HTTP ' + r.status));
  let d;
  try { d = JSON.parse(r.body); } catch (e) { throw new Error('接口返回解析失败'); }
  if (d.code !== 0) throw new Error(d.message || ('code ' + d.code));
  return d.data;
}

/* ---------- 接口 ---------- */

// 音乐区排行（首页推荐流不可用时的兜底列表）
export async function ranking() {
  const data = await jget('https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&ps=20');
  return (data.list || []).map(toTrack).filter((t) => t.duration > 30);
}

// 首页真实推荐信息流：WBI Web 推荐参数，再以视频详情严格筛选音乐分区
export async function recommendMusic(freshIdx = 0, limit = 12) {
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

    // 小批量补取分区字段，既保持推荐顺序，也避免同时发出大量详情请求
    for (let offset = 0; offset < candidates.length && result.length < limit; offset += 5) {
      const batch = candidates.slice(offset, offset + 5);
      const details = await Promise.all(batch.map((item) => view(item.bvid).catch(() => null)));
      batch.forEach((item, i) => {
        const detail = details[i];
        if (detail && isMusicPartition(detail) && Number(item.duration || detail.duration || 0) > 30) {
          result.push(recommendationToTrack(item, detail));
        }
      });
    }
  }
  return result.slice(0, limit);
}

// 视频搜索（筛掉 60 秒以内的短视频），返回 { list, numPages, page }
// order: '' 综合 / click 最多播放 / pubdate 最新发布 / dm 最多弹幕 / stow 最多收藏
// duration: 0 全部 / 1 <10 分钟 / 2 10-30 / 3 30-60 / 4 60+
export async function search(keyword, order = '', duration = 0, page = 1) {
  let url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword='
    + encodeURIComponent(keyword) + '&page=' + page;
  if (order) url += '&order=' + encodeURIComponent(order);
  if (duration) url += '&duration=' + duration;
  const data = await jget(url);
  const list = (data.result || [])
    .filter((v) => v.type === 'video')
    .map(toTrack)
    .filter((t) => t.bvid && t.duration > 60);
  return { list, numPages: data.numPages || 1, page: data.page || page };
}

// UP 主搜索，返回 { list: [{ mid, name, fans, videos, sign, pic }], numPages }
export async function searchUps(keyword, page = 1) {
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
}

// 视频详情：cid / aid / pic / owner / pages / stat
export async function view(bvid) {
  return jget('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
}

// 播放地址：优先 dash 音频，退化 durl
// quality: 0 标准(最低码率) 1 高品(最高码率) 2 无损(优先 flac，需登录/大会员)
export async function playUrl(bvid, cid, quality = 1) {
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
}

// UP 主空间信息（名字 / 头像 / 签名 / 等级）
// space/wbi/acc/info 对匿名（无登录 Cookie）请求常 -352 风控；带齐 web 端参数可缓解，
// 仍失败则回退 x/web-interface/card（匿名可用，字段在 data.card 里）
export async function upInfo(mid) {
  if (!mid) return null;
  try {
    const data = await jget(
      `https://api.bilibili.com/x/space/wbi/acc/info?mid=${mid}&platform=web&web_location=333.999`,
      { wbi: true });
    return {
      mid: data.mid, name: data.name || '',
      face: absImg(data.face),
      sign: data.sign || '', level: data.level || 0,
    };
  } catch (e) {
    const data = await jget(`https://api.bilibili.com/x/web-interface/card?mid=${mid}`);
    const card = data.card || {};
    return {
      mid: Number(card.mid) || Number(mid) || 0, name: card.name || '',
      face: absImg(card.face),
      sign: card.sign || '', level: card.level || 0,
    };
  }
}

// UP 主粉丝 / 关注数
export async function upStat(mid) {
  if (!mid) return { fans: 0, following: 0 };
  const data = await jget(`https://api.bilibili.com/x/relation/stat?vmid=${mid}`);
  return { fans: data.follower || 0, following: data.following || 0 };
}

// UP 主投稿视频（WBI 签名）
// space 系接口风控（HTTP 412 / -352）随机性强，实测匿名请求成败交替 → 最多重试 3 次（退避 0.8s/1.6s）
export async function upVideos(mid, page = 1, ps = 30) {
  if (!mid) return { list: [], total: 0 };
  const url = `https://api.bilibili.com/x/space/wbi/arc/search?mid=${mid}&pn=${page}&ps=${ps}`
    + '&order=pubdate&platform=web&web_location=1550101';
  let data = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      data = await jget(url, { wbi: true }); // eslint-disable-line no-await-in-loop
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); // eslint-disable-line no-await-in-loop
    }
  }
  if (!data) throw lastErr;
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
        title: v.title, up: v.author || '', mid: Number(mid) || 0,
        duration, pic: absImg(v.pic),
      };
    }),
  };
}

/* ---------- 歌词候选（QQ / 网易云双源，后续歌词功能用） ---------- */
export async function searchSongCandidates(name) {
  if (!name) return [];
  const fetchNetease = async () => {
    try {
      const r = await client.get('https://music.163.com/api/search/get/web?s='
        + encodeURIComponent(name) + '&type=1&limit=6&offset=0');
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
      const r = await client.get('https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w='
        + encodeURIComponent(name) + '&format=json&p=1&n=6&t=0',
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
  const [ne, qq] = await Promise.all([fetchNetease(), fetchQQ()]);
  return [...qq, ...ne];
}

/* ---------- 歌词（移植自 renderer/api.js：parseLrc / lyricForMatch / searchLyric / subtitles） ---------- */
// LRC → [{ from, to, text }]：支持一行多时间标签，to 取下一行起点
export function parseLrc(lrc) {
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

// base64(utf-8) 解码：Hermes 有 atob/TextDecoder，缺失时纯 JS 兜底（QQ 歌词体用）
function b64ToUtf8(b64) {
  let bin;
  if (typeof atob === 'function') {
    bin = atob(b64);
  } else {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let str = '';
    let i = 0;
    const clean = String(b64).replace(/[^A-Za-z0-9+/=]/g, '');
    while (i < clean.length) {
      const e1 = CHARS.indexOf(clean[i++]);
      const e2 = CHARS.indexOf(clean[i++]);
      const e3 = CHARS.indexOf(clean[i++]);
      const e4 = CHARS.indexOf(clean[i++]);
      const c1 = (e1 << 2) | (e2 >> 4);
      const c2 = ((e2 & 15) << 4) | (e3 >> 2);
      const c3 = ((e3 & 3) << 6) | e4;
      str += String.fromCharCode(c1);
      if (e3 !== 64) str += String.fromCharCode(c2);
      if (e4 !== 64) str += String.fromCharCode(c3);
    }
    bin = str;
  }
  if (typeof TextDecoder === 'function') {
    return new TextDecoder('utf-8').decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  }
  return decodeURIComponent(bin.split('').map((ch) =>
    '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

// 按匹配结果拉 LRC 时间轴：QQ 走 fcg_query_lyric_new.fcg（base64 歌词体），网易云走 api/song/lyric
export async function lyricForMatch(match) {
  if (!match) return null;
  const src = match.lrcSource || match.source;
  try {
    if (src === 'qq' && match.songmid) {
      const r = await client.get(
        'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' + match.songmid
        + '&format=json&nobase64=0&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0',
        { referer: 'https://y.qq.com/' });
      if (r.status !== 200) return null;
      const d = JSON.parse(r.body);
      if (!d.lyric) return null; // 纯音乐 / 无歌词
      const lines = parseLrc(b64ToUtf8(d.lyric));
      return lines.length >= 3 ? lines : null;
    }
    if (src === 'netease' && match.id) {
      const r = await client.get(`https://music.163.com/api/song/lyric?id=${match.id}&lv=1`);
      if (r.status !== 200) return null;
      const d = JSON.parse(r.body);
      if (d.nolyric || d.pureMusic || !d.lrc || !d.lrc.lyric) return null;
      const lines = parseLrc(d.lrc.lyric);
      return lines.length >= 3 ? lines : null;
    }
  } catch (e) { /* 歌词失败不影响播放 */ }
  return null;
}

// 单曲歌词搜索：网易云搜索 → 按时长挑歌 → 拉 LRC；命中失败返回 null，调用方可回退 AI 字幕
export async function searchLyric(title, artist, durationSec) {
  if (!title) return null;
  try {
    // B 站标题噪音多：去书名号/方括号/画质与"官方/MV"等修饰词
    let q = String(title)
      .replace(/【[^】]*】/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[《》「」]/g, ' ')
      .replace(/\b(official|music video|mv|hd|4k|1080p|lyric|lyrics)\b/gi, ' ')
      .replace(/(官方|完整版|无损|高音质|音质|歌词版|字幕版)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (q.length < 2) q = String(title).trim();
    const queries = [q];
    if (artist && !q.includes(artist)) queries.push(`${q} ${artist}`);
    let songs = [];
    for (const query of queries) {
      const r = await client.get('https://music.163.com/api/search/get/web?s='
        + encodeURIComponent(query) + '&type=1&limit=8&offset=0');
      if (r.status !== 200) continue;
      const d = JSON.parse(r.body);
      songs = (d.result && d.result.songs) || [];
      if (songs.length) break;
    }
    if (!songs.length) return null;
    // 时长相近优先（容忍 10s；全不匹配且差距 >15s 视为搜错，放弃）
    let pick = songs[0];
    if (durationSec > 0) {
      const near = songs
        .filter((s) => Math.abs((s.duration || 0) / 1000 - durationSec) <= 10)
        .sort((a, b) => Math.abs(a.duration / 1000 - durationSec) - Math.abs(b.duration / 1000 - durationSec));
      if (near.length) pick = near[0];
      else if (Math.abs((pick.duration || 0) / 1000 - durationSec) > 15) return null;
    }
    const r2 = await client.get(`https://music.163.com/api/song/lyric?id=${pick.id}&lv=1`);
    if (r2.status !== 200) return null;
    const d2 = JSON.parse(r2.body);
    if (d2.nolyric || d2.pureMusic || !d2.lrc || !d2.lrc.lyric) return null;
    const lines = parseLrc(d2.lrc.lyric);
    return lines.length >= 3 ? lines : null;
  } catch (e) {
    return null;
  }
}

// AI 字幕歌词：x/player/v2 → subtitle_url → 时间轴（B 站字幕列表需登录）
export async function subtitles(bvid, cid) {
  if (!bvid || !cid) return null;
  const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid}`;
  let data;
  try {
    data = await jget('https://api.bilibili.com/x/player/wbi/v2?' + q, { wbi: true });
  } catch (e) {
    try {
      data = await jget('https://api.bilibili.com/x/player/v2?' + q);
    } catch (e2) { return null; }
  }
  const subs = data.subtitle && data.subtitle.subtitles;
  if (!subs || !subs.length) return null;
  const sub = subs.find((s) => /zh|chi|中文/i.test(s.lan || '')) || subs[0];
  const url = absImg(sub.subtitle_url || '');
  if (!url) return null;
  const r = await client.get(url);
  if (r.status !== 200) return null;
  try {
    const json = JSON.parse(r.body);
    const lines = (json.body || [])
      .filter((l) => l && l.content)
      .map((l) => ({ from: +l.from || 0, to: +l.to || 0, text: String(l.content).trim() }));
    return lines.length ? lines : null;
  } catch (e) { return null; }
}

/* ---------- 直播电台（移植自 renderer/api.js：rooms / livePlayUrl） ---------- */
// 音乐电台直播列表（parent_area_id=5 电台区），支持分页
export async function rooms(page = 1) {
  const data = await jget(`https://api.live.bilibili.com/room/v1/area/getRoomList?platform=web&parent_area_id=5&page=${page}&page_size=12`);
  // 不同接口版本可能返回数组或 {list}，统一兼容
  const list = Array.isArray(data) ? data : ((data && (data.list || data.rooms)) || []);
  return list.map((r) => ({
    title: r.title, up: r.uname, online: r.online,
    pic: absImg(r.cover || r.system_cover || ''), area: r.area_v2_name,
    roomid: r.roomid, isLive: true, duration: 0,
  }));
}

// 直播间 HLS 地址：getRoomPlayInfo，优先 fMP4 再退 TS
export async function livePlayUrl(roomid) {
  const data = await jget(
    `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomid}` +
    '&protocol=0,1&format=0,1,2&codec=0&qn=10000&platform=web&ptype=8'
  );
  if (!data || data.live_status !== 1) throw new Error('当前直播间未开播');
  const streams = data.playurl_info && data.playurl_info.playurl && data.playurl_info.playurl.stream;
  const hls = (streams || []).find((stream) => stream.protocol_name === 'http_hls');
  const formats = (hls && hls.format) || [];
  const format = formats.find((item) => item.format_name === 'fmp4')
    || formats.find((item) => item.format_name === 'ts') || formats[0];
  const codecs = (format && format.codec) || [];
  const codec = codecs.find((item) => item.codec_name === 'avc') || codecs[0];
  const endpoint = codec && codec.url_info && codec.url_info[0];
  if (!codec || !endpoint || !endpoint.host) throw new Error('直播间暂无可用 HLS 流');
  return endpoint.host + codec.base_url + endpoint.extra;
}

/* ---------- 原视频播放（简化自 renderer/api.js videoDownloadInfo：progressive 单文件流） ----------
 * RN 端 expo-video 只能播单 URI，桌面端 DASH 双轨（视频轨 + 独立音轨）不适用；
 * 用 platform=html5 的 mp4 整文件流（含音轨），1080P 需登录，未登录 360P/480P。
 */
export async function videoUrl(bvid, cid, quality) {
  if (!bvid || !cid) throw new Error('缺少视频参数');
  const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid}&type=mp4&platform=html5&high_quality=1`
    + (quality ? `&qn=${quality}` : '');
  let data;
  try {
    data = await jget('https://api.bilibili.com/x/player/wbi/playurl?' + q, { wbi: true });
  } catch (e) {
    data = await jget('https://api.bilibili.com/x/player/playurl?' + q);
  }
  if (data.durl && data.durl.length) return data.durl[0].url;
  throw new Error('无可用视频地址');
}
