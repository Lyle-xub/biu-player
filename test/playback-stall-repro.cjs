// Real Chromium media regression: a paused connection resumes from its buffer,
// resolves play(), then stops receiving bytes without emitting a media error.
// Requires FFmpeg on PATH (or BIU_FFMPEG). Run: electron test/playback-stall-repro.cjs
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setPath('userData', path.join(app.getPath('temp'), 'biu-playback-stall-repro'));

app.whenReady().then(async () => {
  const audioBytes = execFileSync(process.env.BIU_FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '60', '-c:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '0', '-id3v2_version', '0',
    '-f', 'mp3', 'pipe:1',
  ], { maxBuffer: 2 * 1024 * 1024 });
  let win;
  const server = http.createServer((req, res) => {
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1]) || 0;
    res.writeHead(start ? 206 : 200, {
      'Content-Type': 'audio/mpeg', 'Content-Length': audioBytes.length - start,
      'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
      ...(start ? { 'Content-Range': `bytes ${start}-${audioBytes.length - 1}/${audioBytes.length}` } : {}),
    });
    console.log('Media request:', req.url, req.headers.range || 'full');
    if (req.url === '/stale.mp3') res.write(audioBytes.subarray(start, Math.max(start, 16000 * 6)));
    else res.end(audioBytes.subarray(start));
  });
  const deadline = setTimeout(() => { console.error('Repro timed out'); app.exit(1); }, 35000);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, webPreferences: {
      nodeIntegration: true, contextIsolation: false, backgroundThrottling: false,
    } });
    win.webContents.on('console-message', (_event, _level, message) => console.log('[media]', message));
    await win.loadURL('about:blank');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const { create } = require(${JSON.stringify(process.env.BIU_RECOVERY_MODULE || path.join(__dirname, '../renderer/playback-recovery.js'))});
      const audio = document.createElement('audio'); audio.muted = true;
      document.body.append(audio);
      const track = { bvid: 'test', cid: 1 };
      const events = [], errors = [];
      let refreshes = 0, clockOffset = 0, recoveredAt = null;
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const manager = create({ read: () => ({ track, media: audio, sound: audio }),
        now: () => Date.now() + clockOffset,
        report: error => errors.push(error.message),
        refresh: async (snapshot, valid) => {
          refreshes++; recoveredAt = snapshot.position;
          audio.src = ${JSON.stringify(origin + '/fresh.mp3')};
          await new Promise((resolve, reject) => {
            audio.onloadedmetadata = resolve; audio.onerror = reject;
          });
          if (!valid()) return;
          audio.currentTime = snapshot.position;
          await audio.play();
        },
      });
      manager.bind(audio);
      for (const name of ['play', 'pause', 'playing', 'waiting', 'stalled', 'error']) {
        audio.addEventListener(name, () => {
          events.push({ name, time: +audio.currentTime.toFixed(2) });
          console.log(name, audio.currentTime, audio.readyState);
        });
      }
      audio.addEventListener('error', () => manager.handleError(audio));
      audio.src = ${JSON.stringify(origin + '/stale.mp3')};
      await audio.play();
      while (audio.currentTime < .2) await wait(30);
      audio.pause();
      await wait(50); clockOffset = 2 * 60 * 1000;
      await manager.resume();
      const playResolved = !audio.paused;
      const started = Date.now();
      while (Date.now() - started < 22000 && !refreshes) await wait(100);
      await wait(300);
      const result = { playResolved, refreshes, recoveredAt, time: audio.currentTime,
        readyState: audio.readyState, error: audio.error?.code || null, errors, events };
      manager.cancel(); audio.pause(); audio.removeAttribute('src'); audio.load();
      return result;
    })()`);
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.playResolved, true);
    assert.equal(result.error, null);
    assert.equal(result.refreshes, 1, 'silent buffer starvation must refresh the signed source');
    assert.ok(result.time > result.recoveredAt, 'playback advances after recovery');
    assert.deepEqual(result.errors, []);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    clearTimeout(deadline);
    win?.destroy(); server.closeAllConnections(); server.close();
  }
}).catch(error => { console.error(error); app.exit(1); });
