const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(reply) {
  const calls = [], diagnostics = [];
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout,
    window: { bili: {
      get: async (url, options) => {
        const request = { url: new URL(url), options };
        calls.push(request);
        return reply(request, calls.length);
      },
      playbackDiagnostic: payload => diagnostics.push(payload),
    } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/api.js'), 'utf8'), context);
  return { api: context.window.api, calls, diagnostics };
}
const json = data => ({ status: 200, body: JSON.stringify({ code: 0, data }) });
const dash = (audio = [{ bandwidth: 128000, baseUrl: 'https://cdn.test/audio.m4s' }]) => ({ dash: { audio } });

test('code=0 without audio falls through to another endpoint instead of ending playback', async () => {
  for (const empty of [null, {}, { dash: {} }, { dash: { audio: [] } }, { durl: [] }]) {
    const h = harness((_request, count) => json(count === 1 ? empty : dash()));
    assert.equal(await h.api.playUrl('BV1Qh41167CV', 371787559), 'https://cdn.test/audio.m4s');
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].options.wbi, true);
    assert.equal(h.calls[1].url.pathname, '/x/player/playurl');
  }
});

test('the exact no-address server error falls back to HTML5 while preserving the selected part', async () => {
  const h = harness(({ url }) => url.searchParams.get('platform') === 'html5'
    ? json({ durl: [{ url: 'https://cdn.test/progressive.mp4' }] })
    : { status: 200, body: JSON.stringify({ code: -404, message: '无播放地址' }) });
  assert.equal(await h.api.playUrl('BV1Qh41167CV', 371787559), 'https://cdn.test/progressive.mp4');
  assert.equal(h.calls.length, 3);
  for (const { url } of h.calls) {
    assert.equal(url.searchParams.get('bvid'), 'BV1Qh41167CV');
    assert.equal(url.searchParams.get('cid'), '371787559');
    assert.notEqual(url.pathname, '/x/web-interface/playurl');
  }
});

test('invalid FLAC and missing base URLs cannot mask valid AAC or backup URLs', async () => {
  const data = dash([
    { bandwidth: 900000, baseUrl: '' },
    { bandwidth: 192000, base_url: 'http://cdn.test/high.m4s' },
    { bandwidth: 64000, backup_url: ['//cdn.test/low.m4s'] },
  ]);
  data.dash.flac = { display: true, audio: { baseUrl: '' } };
  const h = harness(() => json(data));
  assert.equal(await h.api.playUrl('BVtest', 222, 2), 'https://cdn.test/high.m4s');
  assert.equal(await h.api.playUrl('BVtest', 222, 0), 'https://cdn.test/low.m4s');
});

test('normal DASH and eligible lossless streams retain quality selection without extra requests', async () => {
  const data = dash([{ bandwidth: 64000, baseUrl: 'https://cdn.test/low' },
    { bandwidth: 192000, baseUrl: 'https://cdn.test/high' }]);
  data.dash.flac = { display: true, audio: { base_url: 'https://cdn.test/lossless' } };
  const h = harness(() => json(data));
  assert.equal(await h.api.playUrl('BVtest', 222, 0), 'https://cdn.test/low');
  assert.equal(await h.api.playUrl('BVtest', 222, 1), 'https://cdn.test/high');
  assert.equal(await h.api.playUrl('BVtest', 222, 2), 'https://cdn.test/lossless');
  assert.equal(h.calls.length, 3);
});

test('permanent no-address failures stop after three attempts and log codes without signed URLs', async () => {
  const h = harness(() => ({ status: 200, body: JSON.stringify({ code: -404, message: '无播放地址' }) }));
  await assert.rejects(h.api.playUrl('BVtest', 222), error => error.code === -404 && /无播放地址/.test(error.message));
  assert.equal(h.calls.length, 3);
  assert.equal(h.diagnostics.filter(item => item.event === 'playurl-failure').length, 3);
  assert.ok(h.diagnostics.every(item => item.apiCode === -404 && item.status === 200));
  assert.ok(!JSON.stringify(h.diagnostics).includes('https://'));
});

test('malformed and multipart manifests never silently return undefined or play only the first part', async () => {
  for (const data of [dash([{ baseUrl: 'javascript:bad' }]),
    { durl: [{ url: 'https://cdn.test/part1' }, { url: 'https://cdn.test/part2' }] }]) {
    const h = harness(() => json(data));
    await assert.rejects(h.api.playUrl('BVtest', 222), /无可用播放地址|多段/);
    assert.equal(h.calls.length, 3);
  }
});
