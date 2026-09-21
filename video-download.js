const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

async function saveVideo({ url, audioUrl, filePath, fetch, headers, ffmpeg, onProgress = () => {} }) {
  // Work beside the destination so committing the completed file is atomic.
  const dir = await fs.promises.mkdtemp(path.join(path.dirname(filePath), '.biu-download-'));
  const video = path.join(dir, 'video.mp4'), audio = path.join(dir, 'audio.m4a');
  const output = path.join(dir, 'output.mp4');
  async function download(source, target) {
    const response = await fetch(source, { headers });
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    let got = 0, notified = 0;
    const progress = new Transform({ transform(chunk, encoding, done) {
      got += chunk.length;
      if (got - notified >= 4 * 1024 * 1024) { notified = got; onProgress({ got, total }); }
      done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(target));
    if (!got || (total && total !== got)) throw new Error('下载文件不完整，请重试');
  }
  try {
    if (audioUrl && !fs.existsSync(ffmpeg)) throw new Error('缺少视频合并组件，请安装完整版本');
    await download(url, video);
    if (audioUrl) {
      await download(audioUrl, audio);
      await new Promise((resolve, reject) => {
        const task = spawn(ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', video, '-i', audio,
          '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', output], { windowsHide: true });
        let error = '';
        task.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
        task.on('error', reject);
        task.on('close', code => code === 0 ? resolve() : reject(new Error(`视频合并失败：${error || code}`)));
      });
    }
    await fs.promises.rename(audioUrl ? output : video, filePath);
    return { ok: true, path: filePath };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
module.exports = { saveVideo };
