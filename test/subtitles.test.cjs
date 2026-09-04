const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const subtitles = require('../renderer/subtitles');

function varint(value) {
  const bytes = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
}
function field(number, content) {
  const bytes = typeof content === 'string' ? [...Buffer.from(content)] : content;
  return [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
}
const track = (lan, url) => field(3, [8, ...Array(9).fill(255), 1, // uint64 ID larger than Number.MAX_SAFE_INTEGER
  ...field(3, lan), ...field(4, lan === 'en' ? 'English' : '中文（自动生成）'), ...field(5, url)]);
const wire = field(1, [10, 0, ...track('en', '//aisubtitle.hdslb.com/en.json'), ...track('ai-zh', '//aisubtitle.hdslb.com/zh.json')]);
const json = (data) => ({ status: 200, body: JSON.stringify({ code: 0, data }) });
const lyrics = { status: 200, body: JSON.stringify({ body: [{ from: 1.5, to: 3.25, content: ' 歌词测试 🎵 ' }] }) };

test('new subtitle protobuf preserves UTF-8 and skips uint64 / unknown fields, rejects truncated or invalid input', () => {
  const result = subtitles.parseWebSubtitleResponse(wire);
  assert.equal(result.length, 2);
  assert.equal(result[1].lan, 'ai-zh');
  assert.equal(result[1].lan_doc, '中文（自动生成）');
  assert.deepEqual(subtitles.parseWebSubtitleResponse([13, 0, 0, 0, 0, ...wire]), result);
  for (const input of [wire.slice(0, -1), [10, 255], [0], [10, -1], '<html>error</html>']) {
    assert.throws(() => subtitles.parseWebSubtitleResponse(input));
  }
  assert.deepEqual(subtitles.parseWebSubtitleResponse([]), []);
});

test('desktop and mobile use the same fallback, retain the selected part and prefer Chinese captions', async () => {
  for (const platform of ['desktop', 'mobile']) {
    const calls = [];
    const get = async (url, opts) => {
      calls.push({ url, opts });
      if (url.includes('/x/player/')) return json({ subtitle: { subtitles: [] } });
      if (url.includes('/x/web-interface/view')) return json({ aid: 12345, cid: 999 });
      if (url.includes('/x/v2/subtitle/web/view')) {
        const params = new URL(url).searchParams;
        assert.equal(params.get('oid'), '222', 'never substitute the first part CID from video info');
        assert.equal(params.get('pid'), '12345');
        assert.equal(params.get('preferred_language'), 'ai-zh');
        assert.deepEqual(JSON.parse(params.get('context_ext')), { video_type: 1 });
        assert.equal(opts.responseType, 'bytes');
        assert.equal(opts.headers.Accept, 'application/octet-stream');
        return { status: 200, body: wire };
      }
      assert.equal(url, 'https://aisubtitle.hdslb.com/zh.json');
      return lyrics;
    };
    let api;
    if (platform === 'desktop') {
      const context = vm.createContext({ window: { bili: { get }, BiuSubtitles: subtitles }, console, setTimeout, clearTimeout });
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/api.js'), 'utf8'), context);
      api = context.window.api;
    } else {
      const mobile = path.join(__dirname, '../mobile-rn');
      const babel = require(require.resolve('@babel/core', { paths: [mobile] }));
      const source = fs.readFileSync(path.join(mobile, 'src/api/bili.js'), 'utf8');
      const { code } = babel.transformSync(source, { configFile: false, babelrc: false,
        plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [mobile] })] });
      const module = { exports: {} };
      new Function('require', 'module', 'exports', code)((name) => name === './client' ? { get } : subtitles, module, module.exports);
      api = module.exports;
    }
    assert.deepEqual(await api.subtitles('BVtest123', 222), [{ from: 1.5, to: 3.25, text: '歌词测试 🎵' }]);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].opts.wbi, true);
    assert.ok(calls.every((call) => call.opts.referer === 'https://www.bilibili.com/video/BVtest123'));
  }
});

test('working legacy captions avoid extra calls; legacy errors or expired URLs fall back; absent/malformed new data returns null', async () => {
  for (const mode of ['working', 'expired', 'errors', 'missing', 'malformed']) {
    let newCalls = 0, unsignedCalls = 0;
    const get = async (url) => {
      if (url.includes('/x/player/')) {
        if (url.includes('/player/v2')) unsignedCalls++;
        if (mode === 'errors') throw new Error('network failure');
        return json({ aid: 12345, subtitle: { subtitles: [{ lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/old.json' }] } });
      }
      if (url.includes('/x/web-interface/view')) return json({ aid: 12345 });
      if (url.endsWith('/old.json')) return mode === 'working' ? lyrics : { status: 403, body: '' };
      if (url.includes('/x/v2/subtitle/web/view')) {
        newCalls++;
        return { status: 200, body: mode === 'missing' ? [] : mode === 'malformed' ? [10, 255] : wire };
      }
      return lyrics;
    };
    const result = await subtitles.fetchSubtitles(get, 'BVtest123', 222);
    assert.equal(result?.[0]?.text || null, ['missing', 'malformed'].includes(mode) ? null : '歌词测试 🎵');
    assert.equal(newCalls, mode === 'working' ? 0 : 1);
    assert.equal(unsignedCalls, mode === 'errors' ? 1 : 0);
  }
});

test('Electron bridge and RN transport preserve binary bytes and retain the existing authenticated request path', async () => {
  const bytes = [0, 255, 128, 195, 169];
  const response = () => ({ status: 200, arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    text: async () => 'existing text response', headers: { get: () => null } });
  let handler;
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf("  ipcMain.handle('bili:get'");
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  const context = vm.createContext({ ipcMain: { handle: (_, fn) => { handler = fn; } }, biliFetch: async () => response() });
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(Array.from((await handler(null, 'https://api.bilibili.com/test', { responseType: 'bytes' })).body), bytes);
  assert.equal((await handler(null, 'https://api.bilibili.com/test')).body, 'existing text response');

  const mobile = path.join(__dirname, '../mobile-rn');
  const babel = require(require.resolve('@babel/core', { paths: [mobile] }));
  const { code } = babel.transformSync(fs.readFileSync(path.join(mobile, 'src/api/client.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [mobile] })],
  });
  const module = { exports: {} };
  const authenticatedFetch = async (_, opts) => {
    assert.match(opts.headers.Cookie, /SESSDATA=fixture-session/);
    assert.equal(opts.headers.Accept, 'application/octet-stream');
    return response();
  };
  new Function('require', 'module', 'exports', 'fetch', code)((name) => name === '@react-native-async-storage/async-storage'
    ? { getItem: async () => JSON.stringify({ SESSDATA: 'fixture-session', buvid3: 'fixture-buvid' }) }
    : require(require.resolve(name, { paths: [mobile] })), module, module.exports, authenticatedFetch);
  const result = await module.exports.get('https://api.bilibili.com/test', { responseType: 'bytes', headers: { Accept: 'application/octet-stream' } });
  assert.deepEqual(result.body, bytes);
});
