/* Biu Player RN · B 站 API 封装（移植自 renderer/api.js，window.bili.get → client.get）
 * endpoint 与参数与桌面端一致；返回结构与原 api 对象相同。
 */
import * as client from './client';
import { fetchSubtitles } from '../../../renderer/subtitles';

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
    tid: Number(v.tid || v.typeid) || 0, tags: v.tags || (typeof v.tag === 'string' ? v.tag.split(',') : []),
    desc: String(v.desc || v.description || '').slice(0, 1500),
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
    tags: detail.tags || (typeof item.tag === 'string' ? item.tag.split(',') : []),
    desc: String(detail.desc || item.description || '').slice(0, 1500),
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
  const data = await jget('https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&ps=100');
  return (data.list || []).map(toTrack);
}

// B 站首页的真实个性推荐。该接口依赖当前账号 Cookie，并直接保留服务端推荐顺序。
export async function personalizedRecommendations(freshIdx = 0, limit = 12) {
  const index = Math.max(0, Number(freshIdx) || 0);
  const query = new URLSearchParams({
    version: '1', feed_version: 'V8', homepage_ver: '1', ps: String(Math.min(30, Math.max(1, limit))),
    fresh_idx: String(index), brush: String(index), fresh_type: '4',
  });
  const data = await jget(
    'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?' + query,
    { wbi: true },
  );
  const seen = new Set();
  return (data.item || [])
    .filter((item) => {
      if (item.goto !== 'av' || !item.bvid || !item.owner
        || seen.has(item.bvid)) return false;
      seen.add(item.bvid);
      return true;
    })
    .slice(0, Math.max(1, limit))
    .map((item) => recommendationToTrack(item, item));
}

// 保留个性推荐顺序，只补取当前页的视频详情并筛出音乐分区；不跨页补足数量。
export async function personalizedMusicRecommendations(freshIdx = 0, limit = 20) {
  const candidates = await personalizedRecommendations(freshIdx, limit);
  const music = [];
  for (let offset = 0; offset < candidates.length; offset += 5) {
    const batch = candidates.slice(offset, offset + 5);
    const details = await Promise.all(batch.map((item) => view(item.bvid).catch(() => null)));
    batch.forEach((item, index) => {
      const detail = details[index];
      if (!detail || !isMusicPartition(detail)) return;
      music.push({
        ...item,
        aid: detail.aid || item.aid,
        cid: detail.cid || item.cid,
        mid: detail.owner?.mid || item.mid,
        tid: detail.tid,
    tags: detail.tags || (typeof item.tag === 'string' ? item.tag.split(',') : []),
    desc: String(detail.desc || item.description || '').slice(0, 1500),
        tname: detail.tname || '音乐',
      });
    });
  }
  return music;
}

// 视频搜索（不按时长排除短视频），返回 { list, numPages, page }
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
    .filter((t) => t.bvid);
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

/* ---------- 视频页互动（移植自 renderer/api.js：arcRelation / likeVideo / coinVideo /
 * favFoldersWithState / favDeal；POST 的 csrf 由 client.post 从 Cookie 罐 bili_jct 自动补） ----------
 * 点赞/投币/收藏需登录；未登录接口返回 -101，由调用方降级提示。 */
// 稿件与当前用户的关系：{ like, coin, favorite }（0/1）；未登录/失败返回 null
export async function arcRelation(bvid) {
  if (!bvid) return null;
  try {
    return await jget(
      `https://api.bilibili.com/x/web-interface/archive/relation?bvid=${encodeURIComponent(bvid)}`,
      { wbi: true });
  } catch (e) { return null; }
}

// 点赞 / 取消点赞：like 1 点赞 3 取消
export async function likeVideo(aid, like) {
  if (!aid) throw new Error('缺少稿件 aid');
  const r = await client.post('https://api.bilibili.com/x/web-interface/archive/like', { aid, like: like ? 1 : 3 });
  if (r.status !== 200) throw new Error(r.status === -1 ? (r.body || '网络请求失败') : ('HTTP ' + r.status));
  const d = JSON.parse(r.body);
  if (d.code !== 0) throw new Error(d.code === -101 ? '请先登录 B 站账号' : (d.message || ('code ' + d.code)));
  return true;
}

// 投币：n = 1/2 枚
export async function coinVideo(aid, n = 1) {
  if (!aid) throw new Error('缺少稿件 aid');
  const r = await client.post('https://api.bilibili.com/x/web-interface/coin/add', { aid, multiply: n, select_like: 0 });
  if (r.status !== 200) throw new Error(r.status === -1 ? (r.body || '网络请求失败') : ('HTTP ' + r.status));
  const d = JSON.parse(r.body);
  if (d.code !== 0) throw new Error(d.code === -101 ? '请先登录 B 站账号' : (d.message || ('code ' + d.code)));
  return true;
}

// 我创建的收藏夹 + 当前稿件在各夹中的收藏状态（fav_state）；未登录返回 null
export async function favFoldersWithState(aid) {
  if (!aid) return null;
  const auth = await client.authStatus();
  if (!auth || !auth.isLogin) return null;
  const data = await jget(
    `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${auth.mid}&type=2&rid=${aid}`);
  return (data.list || []).map((f) => ({
    id: f.id, title: f.title, count: f.media_count,
    favored: Number(f.fav_state) === 1,
  }));
}

// 收藏 / 取消收藏：rid=aid, type=2（视频），add/del 为收藏夹 id 数组
export async function favDeal(aid, addIds = [], delIds = []) {
  if (!aid) throw new Error('缺少稿件 aid');
  const r = await client.post('https://api.bilibili.com/x/v3/fav/resource/deal', {
    rid: aid, type: 2,
    add_media_ids: addIds.join(','),
    del_media_ids: delIds.join(','),
    platform: 'web',
  });
  if (r.status !== 200) throw new Error(r.status === -1 ? (r.body || '网络请求失败') : ('HTTP ' + r.status));
  const d = JSON.parse(r.body);
  if (d.code !== 0) throw new Error(d.code === -101 ? '请先登录 B 站账号' : (d.message || ('code ' + d.code)));
  return true;
}

/* ---------- 评论（桌面端热评预览用 x/v2/reply sort=2；RN 端做完整列表 + 翻页） ---------- */
export async function replies(aid, page = 1, ps = 12) {
  const data = await jget(
    `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&pn=${page}&ps=${ps}`);
  const list = (data.replies || []).map((r) => ({
    rpid: r.rpid,
    name: (r.member && r.member.uname) || '',
    avatar: r.member && r.member.avatar ? absImg(r.member.avatar) : null,
    message: (r.content && r.content.message) || '',
    like: r.like || 0,
    ctime: r.ctime || 0,
  }));
  return {
    list,
    total: (data.page && data.page.count) || 0,
    // page.num × ps 未到 count 则还有下一页
    hasMore: !!data.page && (data.page.num || page) * (data.page.size || ps) < (data.page.count || 0),
  };
}

/* ---------- 下载（移植自 renderer/api.js videoDownloadInfo：type=mp4 整文件流 +
 * accept_quality 档位列表；实际下载由调用方走 expo-file-system） ---------- */
export async function videoDownloadInfo(bvid, cid, quality) {
  const data = await progressiveVideoInfo(bvid, cid, quality);
  if (quality && Number(data.quality) !== Number(quality)) {
    throw new Error('当前账号或整文件流不支持所选清晰度，请选择其他档位');
  }
  const qualities = (data.accept_quality || []).map((qn, i) => ({
    quality: qn,
    label: (data.accept_description || [])[i] || `${qn}P`,
  }));
  return {
    url: data.durl[0].url,
    quality: data.quality,
    label: (qualities.find((item) => item.quality === data.quality) || {}).label || `${data.quality}P`,
    format: /flv/.test(data.format || '') ? 'flv' : 'mp4',
    qualities: qualities.length ? qualities : [{ quality: data.quality, label: '默认清晰度' }],
  };
}

/* ---------- 分切：B 站章节 / 简介检测；音频分析与指纹在 SplitPanel 的本地 WebView 运行。 ---------- */
export function parseTimestampLines(text, totalDuration) {
  const segs = [];
  // CUE uses mm:ss:frames (75 frames/second), not hh:mm:ss.
  if (/^\s*TRACK\s+\d+\s+AUDIO/im.test(text) && /^\s*INDEX\s+01\s+/im.test(text)) {
    let title = '', trackNumber = '';
    String(text).split(/\r?\n/).forEach((line) => {
      const track = line.match(/^\s*TRACK\s+(\d+)\s+AUDIO/i);
      if (track) { trackNumber = track[1]; title = ''; return; }
      const name = line.match(/^\s*TITLE\s+"?(.+?)"?\s*$/i);
      if (name && trackNumber) title = name[1];
      const index = line.match(/^\s*INDEX\s+01\s+(\d+):(\d{2}):(\d{2})/i);
      if (index && trackNumber && +index[2] < 60 && +index[3] < 75) {
        segs.push({ from: +index[1] * 60 + +index[2] + +index[3] / 75, name: title || `曲目 ${trackNumber}` });
      }
    });
    const sorted = segs.filter((s) => !totalDuration || s.from < totalDuration).sort((a, b) => a.from - b.from);
    return sorted.map((s, i) => ({ ...s, to: sorted[i + 1]?.from ?? (totalDuration || s.from + 180) })).filter((s) => s.to > s.from);
  }
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    const m = line.match(/(\d{1,3})[:：](\d{1,2})(?:[:：](\d{1,2}))?/);
    if (!m) return;
    const sec = m[3] !== undefined
      ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])
      : (+m[1]) * 60 + (+m[2]);
    if (+m[2] >= 60 || (m[3] !== undefined && +m[3] >= 60)) return;
    if (totalDuration && sec >= totalDuration) return;
    const name = line.replace(m[0], ' ')
      .replace(/^(?:[Pp]\d{1,2}\s*|\d{1,2}[.、)）]\s*)/, '')
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
  })).filter((s) => s.to > s.from);
}

export async function mixSplitDetect(bvid, cid, duration) {
  if (!bvid) return [];
  // 1. 视频章节
  try {
    const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid || 0}`;
    let data = null;
    try { data = await jget('https://api.bilibili.com/x/player/wbi/v2?' + q, { wbi: true }); }
    catch (e) { data = await jget('https://api.bilibili.com/x/player/v2?' + q); }
    const pts = ((data && data.view_points) || [])
      .filter((p) => p && p.content && isFinite(+p.from) && +p.from >= 0 && (!duration || +p.from < duration))
      .map((p) => ({ from: +p.from, name: String(p.content).trim() }))
      .sort((a, b) => a.from - b.from)
      .filter((p, i, list) => !i || p.from !== list[i - 1].from);
    if (pts.length) {
      return pts.map((s, i) => ({
        from: s.from,
        to: i + 1 < pts.length ? pts[i + 1].from : (duration || s.from + 180),
        name: s.name,
      })).filter((s) => s.to > s.from);
    }
  } catch (e) { /* 无章节则走简介解析 */ }
  // 2. 简介时间轴
  try {
    const d = await view(bvid);
    return parseTimestampLines(d && d.desc, duration);
  } catch (e) {
    return [];
  }
}

/* ---------- 收藏夹（移植自 renderer/api.js favFolders / favItems，无需 WBI，靠登录 Cookie） ----------
 * 未登录调用时接口返回 -101，由调用方做降级提示；与桌面端一致不做匿名兜底。 */
// 我创建的收藏夹列表
export async function favFolders(mid) {
  if (!mid) throw new Error('缺少用户 mid');
  const data = await jget(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
  return (data.list || []).map((f) => ({
    id: f.id,
    title: f.title,
    count: f.media_count || 0,
    intro: f.intro || '',
    pic: f.cover ? absImg(f.cover) : null,
  }));
}

export async function favFolderInfo(mediaId) {
  const data = await jget(`https://api.bilibili.com/x/v3/fav/folder/info?media_id=${mediaId}`);
  return { id: mediaId, title: data.title || '', desc: data.intro || '' };
}

export async function favFolderEdit(mediaId, title, intro) {
  if (!mediaId || !String(title || '').trim()) throw new Error('收藏夹名称不能为空');
  const r = await client.post('https://api.bilibili.com/x/v3/fav/folder/edit', {
    media_id: mediaId, title: title.trim(), intro: String(intro || '').trim(),
  });
  if (r.status !== 200) throw new Error('收藏夹保存失败：HTTP ' + r.status);
  const data = JSON.parse(r.body);
  if (data.code !== 0) throw new Error(data.message || '收藏夹保存失败');
  return true;
}

// 收藏夹内容（分页），稿件映射为 track；已失效视频（attr=1）直接过滤
export async function favItems(mediaId, page = 1, ps = 40) {
  const data = await jget(
    `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${mediaId}&pn=${page}&ps=${ps}`);
  const list = (data.medias || [])
    .filter((m) => m && m.bvid && Number(m.attr) !== 1)
    .map((m) => ({
      bvid: m.bvid, aid: m.id, cid: 0,
      title: m.title, up: (m.upper && m.upper.name) || '',
      mid: (m.upper && m.upper.mid) || 0,
      duration: m.duration || 0,
      pic: m.cover ? absImg(m.cover) : null,
    }));
  return {
    list,
    hasMore: !!data.has_more,
    total: (data.info && data.info.media_count) || 0,
  };
}

/* ---------- 歌词候选（QQ / 网易云双源，后续歌词功能用） ---------- */
export async function searchSongCandidates(name, { source, limit = 6 } = {}) {
  if (!name) return [];
  const fetchNetease = async () => {
    try {
      const r = await client.get('https://music.163.com/api/search/get/web?s='
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
      const r = await client.get('https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w='
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

// 单曲歌词搜索：QQ 优先，未命中可用歌词再查网易云；两源失败由调用方回退字幕。
export async function searchLyric(title, artist, durationSec) {
  if (!title) return null;
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
        songs = await searchSongCandidates(query, { source, limit: 8 });
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
      const lines = await lyricForMatch(pick);
      if (lines?.length) return lines;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 旧播放器字幕优先；无可用字幕时回退新版 Protobuf 接口，沿用当前登录态。
export async function subtitles(bvid, cid) {
  return fetchSubtitles(client.get, bvid, cid);
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

// 已关注且正在直播的主播，沿用当前账号 Cookie。
export async function followedLives() {
  const data = await jget('https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList?hit_ab=false');
  const seen = new Set();
  return ((data && (data.rooms || data.list)) || [])
    .filter((r) => {
      const id = String(r.roomid || '');
      if (!id || Number(r.live_status) !== 1 || seen.has(id)) return false;
      seen.add(id); return true;
    })
    .map((r) => ({
      roomid: r.roomid, title: r.title, up: r.uname, online: r.online || 0,
      pic: absImg(r.cover_from_user || r.keyframe || r.cover || r.face || ''),
      face: absImg(r.face || ''), area: r.area_v2_name || r.area_name,
      isLive: true, duration: 0,
    }));
}

// 与桌面端一致，读取最近弹幕供播放页轮询。
export async function liveDanmaku(roomid) {
  if (!roomid) return [];
  const data = await jget(`https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${encodeURIComponent(roomid)}&room_type=0`);
  return ((data && data.room) || []).filter((item) => typeof item.text === 'string' && item.text.trim())
    .map((item) => ({ text: item.text, nickname: item.nickname || '', uid: item.uid, timeline: item.timeline }));
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
 * 用 type=mp4 的整文件流（含音轨），1080P 需登录，未登录 360P/480P。
 * 注意：wbi 版 playurl 在登录态/风控下可能返回 code=0 但 durl 为空——
 * 因此「durl 为空」也视为失败，继续换下一个接口（未签名 html5 → wbi html5 → fnval=1）。
 */
async function progressiveVideoInfo(bvid, cid, quality) {
  if (!bvid || !cid) throw new Error('缺少视频参数');
  const base = `bvid=${encodeURIComponent(bvid)}&cid=${cid}`;
  const html5 = `${base}&type=mp4&platform=html5&high_quality=1`
    + (quality ? `&qn=${quality}` : '');
  const attempts = [
    { url: 'https://api.bilibili.com/x/player/playurl?' + html5 },
    { url: 'https://api.bilibili.com/x/player/wbi/playurl?' + html5, wbi: true },
    { url: 'https://api.bilibili.com/x/player/playurl?' + base + '&type=mp4&fnval=1&fourk=1' + (quality ? `&qn=${quality}` : '') },
  ];
  let lastErr = new Error('无可用视频地址');
  let fallback;
  for (const att of attempts) {
    try {
      const data = await jget(att.url, att.wbi ? { wbi: true } : undefined); // eslint-disable-line no-await-in-loop
      if (data?.durl?.length === 1 && data.durl[0].url) {
        if (!quality || Number(data.quality) === Number(quality)) return data;
        // Some HTML5 responses ignore qn. Try the remaining endpoints before accepting a lower quality.
        fallback ||= data;
        continue;
      }
      if (data?.durl?.length > 1) throw new Error('该视频返回多段媒体，暂不支持整文件播放或下载');
      lastErr = new Error('接口未返回整文件流（可能触发风控）');
    } catch (e) {
      lastErr = e;
    }
    console.warn('[bili.videoUrl] 取流尝试失败：', String((lastErr && lastErr.message) || lastErr));
  }
  if (fallback) return fallback;
  throw lastErr;
}

export async function videoUrl(bvid, cid, quality) {
  const info = await progressiveVideoInfo(bvid, cid, quality);
  return info.durl[0].url;
}
