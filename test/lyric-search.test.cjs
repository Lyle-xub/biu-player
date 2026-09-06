const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const mobile = path.join(root, 'mobile-rn');

function loadApi(platform, get) {
  if (platform === 'desktop') {
    const window = { bili: { get } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer/api.js'), 'utf8'),
      { window, console, URLSearchParams, TextDecoder, atob, setTimeout, clearTimeout });
    return window.api;
  }
  const babel = require(require.resolve('@babel/core', { paths: [mobile] }));
  const { code } = babel.transformFileSync(path.join(mobile, 'src/api/bili.js'), {
    configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [mobile] })],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === './client') return { get };
    if (name === './mediaUrl') return { mediaUrl: value => value };

    if (name === '../../../renderer/subtitles') return require('../renderer/subtitles');
    throw new Error('Unexpected import: ' + name);
  }, module, module.exports);
  return module.exports;
}

for (const platform of ['desktop', 'mobile']) test(`${platform}: QQ lyrics first, duration matching and NetEase fallback`, async () => {
  let scenario = 'hit';
  const calls = [];
  const lrc = (text) => `[00:00]${text}\n[00:10]第二行\n[00:20]第三行`;
  const api = loadApi(platform, async (url, options) => {
    const u = new URL(url);
    calls.push({ url: u, options });
    const response = (data) => ({ status: 200, body: JSON.stringify(data) });
    if (u.pathname.includes('client_search_cp')) {
      if (scenario === 'network') throw new Error('QQ unavailable');
      const empty = scenario === 'empty' || scenario === 'none'
        || (scenario === 'artist' && !u.searchParams.get('w').includes('歌手'));
      return response({ data: { song: { list: empty ? [] : [
        { songname: '晴天', songmid: 'wrong', interval: 240 },
        { songname: '晴天', songmid: 'near', interval: scenario === 'duration' ? 250 : 182 },
      ] } } });
    }
    if (u.pathname.includes('fcg_query_lyric')) {
      assert.equal(u.searchParams.get('songmid'), 'near');
      assert.equal(options.referer, 'https://y.qq.com/');
      return response({ lyric: Buffer.from(scenario === 'no-lyrics' ? '[00:00]纯音乐' : lrc('QQ歌词')).toString('base64') });
    }
    if (u.pathname.includes('/search/')) return response({ result: { songs: scenario === 'none' ? [] : [
      { id: 1, name: '晴天', duration: 180000, artists: [{ name: '歌手' }] },
    ] } });
    if (u.pathname.includes('/lyric')) return response({ lrc: { lyric: lrc('网易云歌词') } });
    throw new Error('Unexpected request: ' + url);
  });
  for (scenario of ['hit', 'artist', 'empty', 'network', 'duration', 'no-lyrics', 'none']) {
    calls.length = 0;
    const result = await api.searchLyric('某某演唱《晴天》完整版', '歌手', 180);
    assert.equal(calls[0].url.searchParams.get('w'), '晴天');
    assert.equal(calls[0].url.searchParams.get('n'), '8');
    const qqHit = scenario === 'hit' || scenario === 'artist';
    assert.equal(result?.[0]?.text ?? null, scenario === 'none' ? null : qqHit ? 'QQ歌词' : '网易云歌词', scenario);
    const neteaseIndex = calls.findIndex((c) => c.url.hostname === 'music.163.com');
    assert.equal(neteaseIndex === -1, qqHit, 'NetEase is requested only after QQ fails');
    if (scenario === 'no-lyrics') assert.ok(neteaseIndex > calls.findIndex((c) => c.url.pathname.includes('fcg_query_lyric')));
    if (scenario === 'duration') assert.ok(!calls.some((c) => c.url.pathname.includes('fcg_query_lyric')));
  }
  scenario = 'hit'; calls.length = 0;
  const manual = await api.searchSongCandidates('晴天');
  assert.deepEqual(Array.from(manual, (c) => c.source), ['qq', 'qq', 'netease']);
  assert.equal(calls.find((c) => c.url.hostname === 'music.163.com').url.searchParams.get('limit'), '6');
  assert.equal(calls.find((c) => c.url.hostname === 'c.y.qq.com').url.searchParams.get('n'), '6');
});
