// Bundle the actual desktop editor/algorithms and their vendored WASM for an offline WebView.
// Run automatically by Metro; no remote scripts or separate service are required.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Desktop split source changed: ${start}`);
  return source.slice(a, b);
}
function build() {
  const shazamRoot = path.dirname(require.resolve('shazamio-core/package.json', { paths: [path.join(root, 'mobile-rn'), root] }));
  const api = read('renderer/api.js'), app = read('renderer/app.js');
  const html = between(read('renderer/index.html'), '<div class="pl-dialog-mask" id="splitMask"', '<!-- ============ 手动匹配歌词');
  const panel = between(app, 'let splitSource = null;', '/* ---------- HLS 直播')
    .replace("if (!(t.duration > 240))", "if (!(t.duration > 0))")
    .replace("window.addEventListener('resize', () => { if (splitPopFor >= 0) closeSplitPop(); });", '');
  const events = between(app, "  $('splitCancel').addEventListener", "  $('ppQueue').addEventListener")
    .replace('超长视频，识曲走 24kHz 兜底源', '按需解码原始采样率片段');
  const detector = between(api, '    let segments;\n    if (mode', '    // MixSplitR 波形:'.replace(':', '：'));
  const css = between(read('renderer/styles.css'), '.split-panel {', '/* 手动匹配歌词面板 */');
  const afp = fs.readFileSync(path.join(root, 'vendor/ncm/afp.wasm')).toString('base64');
  const shazam = fs.readFileSync(path.join(shazamRoot, 'web/shazamio-core_bg.wasm')).toString('base64');
  const ncm = read('vendor/ncm/sandbox.bundle.cjs')
    .replace('let interval = setInterval(() => {', 'const started = Date.now(); let interval = setInterval(() => { if (Date.now() - started > 15000) { clearInterval(interval); reject(new Error("指纹模块加载超时")); return; }')
    .replace('return resolve(Ke(result_buf.buffer))', 'converted_buf.delete(); return resolve(Ke(result_buf.buffer))');
  const shazamJs = fs.readFileSync(path.join(shazamRoot, 'web/shazamio-core.js'), 'utf8')
    .replace(/export (function|class) /g, '$1 ').replace('export { initSync }', '')
    .replace('export default __wbg_init;', '')
    .replace("new URL('shazamio-core_bg.wasm', import.meta.url)", "null");
  const wasm = `/* shazamio-core license:\n${fs.readFileSync(path.join(shazamRoot, 'LICENSE'), 'utf8')}\n*/
    const ncm = (() => {
      const module = { exports: {} }, __dirname = '';
      const require = (name) => name === 'crypto' ? window.crypto : name === 'path'
        ? { join: () => 'afp.wasm' } : { readFile: (_, done) => done(fromBase64(${JSON.stringify(afp)})) };
      ${ncm}
      return module.exports;
    })();
    const shazam = (() => { ${shazamJs}
      return { init: () => __wbg_init(fromBase64(${JSON.stringify(shazam)})), DecodedSignature };
    })();`;
  const script = [read('mobile-rn/src/split/bootstrap.js'), api, read('renderer/split-decode.js'),
    `function detectSegments(env, totalDur, mode) { ${detector} return result; }`,
    wasm, panel, read('mobile-rn/src/split/runtime.js'), events, 'setupMobileSplit();'].join('\n');
  const output = JSON.stringify(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${css}\n${read('mobile-rn/src/split/mobile.css')}</style></head><body>${html}<script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
  const target = path.join(root, 'mobile-rn/src/split/editor.generated.json');
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) fs.writeFileSync(target, output);
}
module.exports = build;
if (require.main === module) build();
