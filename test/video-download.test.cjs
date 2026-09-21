const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { resolve, qualitiesOf } = require('../renderer/video-download');
const { saveVideo } = require('../video-download');

const video = (id, codecid = 7) => ({ id, codecid, base_url: `https://cdn/${id}-${codecid}.m4s` });
const manifest = () => ({ accept_quality: [127, 120, 112, 80, 64, 32],
  accept_description: ['8K', '4K', '1080P+', '1080P', '720P', '480P'],
  support_formats: [{ quality: 125, new_description: 'HDR' }],
  dash: { video: [video(120, 12), video(80), video(80, 12), video(64), video(32)],
    audio: [{ id: 30280, codecs: 'mp4a.40.2', bandwidth: 128000, baseUrl: 'https://cdn/audio.m4s' }] } });

test('only real downloadable tiers appear; VIP declarations do not create options', async () => {
  const calls = [];
  const info = await resolve(async (url, options) => { calls.push([new URL(url), options]); return manifest(); }, 'BV1', 1);
  assert.deepEqual(info.qualities.map(q => q.quality), [120, 80, 64, 32]);
  assert.equal(calls[0][0].searchParams.get('fnval'), '4048');
  assert.equal(calls[0][0].searchParams.get('qn'), '127');
  assert.equal(calls[0][0].searchParams.has('platform'), false);
  assert.equal(calls[0][1].wbi, true);
  const noAudio = manifest(); noAudio.dash.audio = [];
  assert.deepEqual(qualitiesOf(noAudio), []);
  assert.deepEqual(qualitiesOf({ quality: 32, accept_quality: [80, 32], durl: [{ url: 'https://cdn/a' }] }), [{ quality: 32, label: '480P' }]);
});

test('codec aliases, deduplication, exact quality and separate audio survive selection', async () => {
  const info = await resolve(async () => manifest(), 'BV1', 1, 80);
  assert.equal(info.url, 'https://cdn/80-7.m4s');
  assert.equal(info.audioUrl, 'https://cdn/audio.m4s');
  assert.equal(info.format, 'mp4');
  await assert.rejects(resolve(async () => manifest(), 'BV1', 1, 112), /未获得所选清晰度/);
  const av1 = manifest(); av1.dash.video = [video(120, 13)];
  assert.deepEqual(qualitiesOf(av1, [7, 12]), []);
  await assert.rejects(resolve(async () => av1, 'BV1', 1, 120, [7, 12]), /编码暂不支持/);
});

test('empty signed manifests fall through and multi-part files never download just part one', async () => {
  let calls = 0;
  const info = await resolve(async () => ++calls === 1 ? {} : manifest(), 'BV1', 1);
  assert.equal(calls, 2); assert.equal(info.qualities.length, 4);
  await assert.rejects(resolve(async () => ({ durl: [{ url: 'a' }, { url: 'b' }] }), 'BV1', 1), /多段媒体/);
});

test('desktop failure preserves the destination and cleans incomplete transfers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-download-test-'));
  try {
    const filePath = path.join(dir, 'existing.mp4'); fs.writeFileSync(filePath, 'original');
    await assert.rejects(saveVideo({ url: 'test', filePath, fetch: async () => new Response('short', { headers: { 'content-length': '100' } }) }), /不完整/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(dir), ['existing.mp4']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const ffmpeg = path.resolve(__dirname, '../dist/cloud-runtime', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
test('real desktop export contains both video and audio, without transcoding', { skip: !fs.existsSync(ffmpeg) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-download-mux-'));
  try {
    const v = path.join(dir, 'v.mp4'), a = path.join(dir, 'a.m4a'), output = path.join(dir, 'result.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=25', '-t', '1', '-c:v', 'libx264', '-movflags', '+dash+frag_keyframe+empty_moov', v]);
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac', '-movflags', '+dash+frag_keyframe+empty_moov', a]);
    await saveVideo({ url: 'video', audioUrl: 'audio', filePath: output, ffmpeg,
      fetch: async url => new Response(fs.readFileSync(url === 'video' ? v : a)) });
    execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.biu-download-')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Apple native passthrough exports real fragmented video and audio tracks', {
  skip: process.platform !== 'darwin' || !fs.existsSync(ffmpeg),
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-native-mux-'));
  try {
    const source = fs.readFileSync(path.join(__dirname, '../mobile-rn/modules/biu-media-export/ios/BiuMediaExportModule.swift'), 'utf8');
    // Compile the actual production mux method, without loading Expo/RN.
    const body = source.slice(source.indexOf('  private static func problem'), source.lastIndexOf('}')).replaceAll('private static func', 'static func');
    const swift = path.join(dir, 'Export.swift'), runner = path.join(dir, 'export');
    fs.writeFileSync(swift, `import Foundation\nimport AVFoundation\nstruct Export {\n${body}\n}\n@main struct Runner { static func main() async throws { try await Export.mux(CommandLine.arguments[1], CommandLine.arguments[2], CommandLine.arguments[3]) } }`);
    execFileSync('xcrun', ['swiftc', '-parse-as-library', swift, '-o', runner], { stdio: 'pipe', timeout: 60000 });
    const v = path.join(dir, 'v.mp4'), a = path.join(dir, 'a.m4a'), output = path.join(dir, 'out.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25', '-t', '1', '-c:v', 'libx264', '-movflags', '+dash+frag_keyframe+empty_moov', v]);
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac', '-movflags', '+dash+frag_keyframe+empty_moov', a]);
    execFileSync(runner, [v, a, output].map(p => pathToFileURL(p).href), { timeout: 30000, stdio: 'pipe' });
    execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
