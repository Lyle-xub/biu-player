// Read-only live smoke test. Reuses the app's song/video search implementations.
// Usage: node scripts/daily-music-smoke.cjs [artist] [output.json]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const artist = process.argv[2] || '周杰伦';
const output = process.argv[3] || '/tmp/biu-daily-music-smoke.json';
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const songKey = song => `${norm(song.title)}:${norm(song.artist)}`;
function judge(song, video, expectedArtist = artist) {
  const title = norm(video.title), delta = Math.abs(video.duration - song.duration);
  const reasons = [];
  if (!title.includes(norm(song.title))) reasons.push('歌名不匹配');
  if (!title.includes(norm(expectedArtist))) reasons.push('歌手未出现在标题');
  if (/翻唱|伴奏|教学|教程|解说|盘点|合集|串烧|琴谱|鼓谱|曲谱|简谱|五线谱|指弹|cover|reaction|\bAI\b/i.test(video.title)) reasons.push('版本或内容类型不符');
  const live = /live|现场|演唱会/i;
  if (live.test(song.title) !== live.test(video.title)) reasons.push('现场与录音室版本不一致');
  if (!(song.duration > 0 && video.duration > 0) || delta > Math.max(20, song.duration * 0.15)) reasons.push('时长不符');
  return { accepted: !reasons.length, deltaSeconds: Math.round(delta), reasons };
}
const fixture = { title: '晴天', artist, duration: 269 };
assert.equal(judge(fixture, { title: `${artist} 晴天`, duration: 270 }).accepted, true);
assert.equal(judge(fixture, { title: `${artist} 晴天 翻唱`, duration: 270 }).accepted, false);
assert.equal(judge(fixture, { title: `${artist} 晴天 合集`, duration: 3600 }).accepted, false);
assert.equal(judge(fixture, { title: `${artist} 夜曲`, duration: 270 }).accepted, false);
assert.equal(judge(fixture, { title: `${artist} 晴天 钢琴谱`, duration: 269 }).accepted, false);
assert.equal(judge(fixture, { title: `${artist} 晴天 动态鼓谱`, duration: 269 }).accepted, false);
assert.equal(judge(fixture, { title: `${artist} 晴天 Live`, duration: 269 }).accepted, false);
assert.equal(judge({ ...fixture, title: '晴天 (Live)' }, { title: `${artist} 晴天 Live`, duration: 269 }).accepted, true);
const trace = [];
let buvid = '';
async function get(url, options = {}) {
  const u = new URL(url), started = performance.now();
  const row = { host: u.hostname, path: u.pathname };
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0', Referer: options.referer || 'https://www.bilibili.com/' };
    if (u.hostname.endsWith('bilibili.com') && buvid) headers.Cookie = `buvid3=${buvid}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(7500) });
    const body = await response.text();
    row.http = response.status;
    try { row.code = JSON.parse(body).code; } catch {}
    return { status: response.status, body };
  } catch (error) { row.error = error.message; throw error; }
  finally { row.ms = Math.round(performance.now() - started); trace.push(row); }
}
const window = { bili: { get } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/api.js'), 'utf8'),
  { window, console, URLSearchParams, TextDecoder, atob, setTimeout, clearTimeout });
async function ensureVisitor() {
  try {
    const response = await get('https://api.bilibili.com/x/frontend/finger/spi');
    buvid = JSON.parse(response.body).data?.b_3 || '';
  } catch {}
}
async function main() {
  const start = performance.now();
  const sourceStart = performance.now();
  const [qq, netease] = await Promise.all(['qq', 'netease'].map(source => window.api.searchSongCandidates(artist, { source, limit: 12 })));
  const sourceMs = Math.round(performance.now() - sourceStart);
  // Interleave the two providers before deduplicating; fix the sample before searching Bilibili.
  const all = qq.flatMap((item, i) => [item, netease[i]]).concat(netease.slice(qq.length)).filter(Boolean);
  const seen = new Set(), songs = all.filter(song => {
    const key = songKey(song);
    if (!norm(song.artist).includes(norm(artist)) || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 6);
  await ensureVisitor();
  const results = [];
  for (let i = 0; i < songs.length; i += 3) {
    results.push(...await Promise.all(songs.slice(i, i + 3).map(async song => {
      const started = performance.now();
      try {
        const response = await window.api.search(`${song.title} ${artist}`, 'totalrank');
        const ranked = response.list.map(video => ({ bvid: video.bvid, title: video.title, up: video.up,
          duration: video.duration, url: `https://www.bilibili.com/video/${video.bvid}`, ...judge(song, video) }))
          .sort((a, b) => Number(b.accepted) - Number(a.accepted) || a.deltaSeconds - b.deltaSeconds);
        const selected = ranked.find(video => video.accepted) || null;
        return { song, count: response.list.length, selected, topCandidates: ranked.slice(0, 3), ms: Math.round(performance.now() - started) };
      } catch (error) { return { song, error: error.message, ms: Math.round(performance.now() - started) }; }
    })));
  }
  const report = { at: new Date().toISOString(), artist, profileScope: '歌手兴趣召回样例；未读取用户画像，未验证曲风歌单召回、七天去重或实际播放',
    auth: '匿名访客；未读取登录凭据', concurrency: 3, sourceCounts: { qq: qq.length, netease: netease.length },
    sourceMs, totalMs: Math.round(performance.now() - start), sampled: songs.length,
    metadataMatches: results.filter(row => row.selected).length, errors: results.filter(row => row.error).length, results, trace };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!songs.length || !report.metadataMatches) process.exitCode = 1;
}
module.exports = { api: window.api, get, judge, norm, ensureVisitor, trace };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
