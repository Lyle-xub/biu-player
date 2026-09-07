// Uses an exported local profile snapshot; never writes back to the app's store.
// node scripts/daily-profile-smoke.cjs /tmp/biu-daily-profile-input.json
const fs = require('node:fs');
const { api, get, judge, norm, ensureVisitor, trace } = require('./daily-music-smoke.cjs');
const D = require('../renderer/daily-recommendation');
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const categoryMap = { 日语: '日语', 治愈: '治愈', 电子: '电子', 纯音乐: '轻音乐', 乡村: '乡村', 古风: '古风', 国风: '古风', 'City Pop': '日语' };
async function json(url) {
  const r = await get(url, { referer: 'https://music.163.com/' });
  const d = JSON.parse(r.body);
  if (r.status !== 200 || d.code !== 200) throw Error(`HTTP ${r.status}, code ${d.code}`);
  return d;
}
async function batches(items, fn, limit = 3) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  return out;
}
async function main() {
  const start = performance.now();
  const selectedTags = profile.tags.filter(t => categoryMap[t.name]).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const pools = await batches(selectedTags, async tag => {
    try {
      const category = categoryMap[tag.name];
      const data = await json('https://music.163.com/api/playlist/list?' + new URLSearchParams({ cat: category, order: 'hot', limit: '2', offset: '0' }));
      const playlists = (data.playlists || []).slice(0, 2);
      const songs = [];
      // Bounded sequential detail lookups within each category.
      for (const list of playlists) {
        const detail = await json('https://music.163.com/api/playlist/detail?id=' + list.id);
        const playlist = detail.result || detail.playlist;
        for (const song of (playlist?.tracks || []).slice(0, 10)) songs.push({
          id: song.id, title: song.name, artist: (song.artists || song.ar || []).map(a => a.name).join('/'),
          duration: (song.duration || song.dt || 0) / 1000, source: 'netease',
          profileTag: tag.name, playlistId: list.id, playlistName: list.name,
        });
      }
      return { tag, category, playlists: playlists.map(p => ({ id: p.id, name: p.name })), songs };
    } catch (error) { return { tag, error: error.message, songs: [] }; }
  });
  const sourceMs = Math.round(performance.now() - start);
  const seen = new Set(), songs = [];
  for (const pool of pools) {
    let count = 0;
    for (const song of pool.songs) {
      const key = norm(song.title) + ':' + norm(song.artist);
      if (seen.has(key) || !song.artist || !song.duration) continue;
      seen.add(key); songs.push(song);
      if (++count === 3) break;
    }
  }
  const previous = new Set((profile.daily?.shown || []).filter(x => Date.now() - x.at < 7 * 86400000).map(x => x.bvid));
  await ensureVisitor();
  const results = await batches(songs, async song => {
    const started = performance.now(), primaryArtist = song.artist.split('/')[0];
    try {
      const data = await api.search(`${song.title} ${primaryArtist}`, 'totalrank');
      const ranked = data.list.map(v => {
        const assessment = judge(song, v, primaryArtist);
        if (previous.has(v.bvid)) { assessment.accepted = false; assessment.reasons.push('最近七天已展示'); }
        return { title: v.title, bvid: v.bvid, duration: v.duration, up: v.up, ...assessment, url: `https://www.bilibili.com/video/${v.bvid}` };
      }).sort((a, b) => Number(b.accepted) - Number(a.accepted) || a.deltaSeconds - b.deltaSeconds);
      return { song, count: data.list.length, selected: ranked.find(v => v.accepted) || null, topCandidates: ranked.slice(0, 3), ms: Math.round(performance.now() - started) };
    } catch (error) { return { song, error: error.message, ms: Math.round(performance.now() - started) }; }
  });
  const report = { at: new Date().toISOString(), profileName: profile.profileName, profileId: profile.profileId,
    tags: profile.tags, selectedTags, method: '网易云按画像标签取分类歌单，每类固定取三首，再匿名搜索 B 站。标签归属仅依据歌单分类，未逐首验证。',
    unmappedTags: profile.tags.filter(t => D.category(t.name) === 'tag').map(t => t.name),
    mappings: Object.fromEntries(selectedTags.map(t => [t.name, categoryMap[t.name]])),
    pools: pools.map(({ songs, ...p }) => ({ ...p, candidateCount: songs.length })),
    sourceMs, totalMs: Math.round(performance.now() - start), sampled: songs.length,
    metadataMatches: results.filter(r => r.selected).length, errors: results.filter(r => r.error).length,
    previousSevenDayVideos: previous.size, results, trace };
  fs.writeFileSync('/tmp/biu-daily-profile-smoke.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.sampled || !report.metadataMatches) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
