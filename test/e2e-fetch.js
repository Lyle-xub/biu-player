/* E2E 步骤 1：搜索 B 站音乐区长混剪 → 拉音频流 → ffmpeg 解码出三路 PCM
 * 产物写 /tmp/biu-e2e/：meta.json / a48k.f32 / a16k.f32 / a24k.s16
 * 运行：node test/e2e-fetch.js [关键词]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';
const OUT = '/tmp/biu-e2e';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';

/* ---- WBI 签名（移植自 main.js） ---- */
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16,
  24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52];
let wbiKeys = null;
let buvid3 = '';

async function bfetch(url, cookie = '') {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA, Referer: REFERER,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  return res;
}
async function ensureBuvid() {
  if (buvid3) return buvid3;
  const res = await bfetch('https://api.bilibili.com/x/frontend/finger/spi');
  const data = JSON.parse(await res.text());
  buvid3 = (data.data && data.data.b_3) || '';
  return buvid3;
}
async function getWbiKeys() {
  if (wbiKeys) return wbiKeys;
  const res = await bfetch('https://api.bilibili.com/x/web-interface/nav');
  const data = JSON.parse(await res.text());
  const wbi = data.data && data.data.wbi_img;
  const keyOf = (u) => u.split('/').pop().split('.')[0];
  wbiKeys = { img: keyOf(wbi.img_url), sub: keyOf(wbi.sub_url) };
  return wbiKeys;
}
async function signWbi(query) {
  const keys = await getWbiKeys();
  const raw = keys.img + keys.sub;
  const mixin = MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32);
  const params = new URLSearchParams(query);
  params.set('wts', Math.floor(Date.now() / 1000));
  const entries = [...params.entries()]
    .map(([k, v]) => [k, String(v).replace(/[!'()*]/g, '')])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const q = new URLSearchParams(entries).toString();
  const wrid = crypto.createHash('md5').update(q + mixin).digest('hex');
  return q + '&w_rid=' + wrid;
}
async function jget(url, wbi = false) {
  const finalUrl = wbi ? url.slice(0, url.indexOf('?')) + '?' + await signWbi(url.slice(url.indexOf('?') + 1)) : url;
  const res = await bfetch(finalUrl, `buvid3=${await ensureBuvid()}`);
  const d = JSON.parse(await res.text());
  if (d.code !== 0) throw new Error(d.message || ('code ' + d.code));
  return d.data;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const keyword = process.argv[2] || '华语金曲串烧 歌单';
  console.log('搜索:', keyword);
  const search = await jget('https://api.bilibili.com/x/web-interface/wbi/search/type?'
    + `search_type=video&keyword=${encodeURIComponent(keyword)}&order=click&duration=3&page=1`, true);
  const items = (search.result || []).filter((v) => v.duration && v.bvid);
  if (!items.length) throw new Error('搜索无结果');
  const toSec = (d) => String(d).split(':').reduce((a, b) => a * 60 + (+b), 0);
  const pick = items.find((v) => toSec(v.duration) >= 1200) || items[0];
  const bvid = pick.bvid;
  console.log('选中:', bvid, pick.title.replace(/<[^>]+>/g, ''), pick.duration);

  const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const cid = view.cid;
  console.log('时长:', view.duration, 's | cid:', cid, '| 分区:', view.tname);

  const q = `bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&fourk=1`;
  let play;
  try { play = await jget('https://api.bilibili.com/x/player/wbi/playurl?' + q, true); }
  catch (e) { play = await jget('https://api.bilibili.com/x/player/playurl?' + q); }
  const audios = (play.dash && play.dash.audio) || [];
  if (!audios.length) throw new Error('无 DASH 音频流');
  const best = [...audios].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  const audioUrl = best.baseUrl || best.base_url;
  console.log('音频码率:', best.bandwidth, 'bps，开始下载…');

  const res = await bfetch(audioUrl);
  if (!res.ok) throw new Error('音频下载失败 HTTP ' + res.status);
  const m4a = path.join(OUT, 'audio.m4a');
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(m4a, buf);
  console.log('下载完成:', (buf.length / 1048576).toFixed(1), 'MB');

  console.log('ffmpeg 解码三路 PCM…');
  execSync(`${FFMPEG} -y -v error -i "${m4a}" -ac 1 -ar 48000 -f f32le "${OUT}/a48k.f32"`);
  execSync(`${FFMPEG} -y -v error -i "${m4a}" -ac 1 -ar 16000 -f f32le "${OUT}/a16k.f32"`);
  execSync(`${FFMPEG} -y -v error -i "${m4a}" -ac 1 -ar 24000 -f s16le "${OUT}/a24k.s16"`);

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
    bvid, cid, title: view.title, duration: view.duration, desc: view.desc || '',
  }, null, 2));
  console.log('就绪：/tmp/biu-e2e/meta.json + a48k.f32 / a16k.f32 / a24k.s16');
})().catch((e) => { console.error('FAIL:', e.message || e); process.exit(1); });
