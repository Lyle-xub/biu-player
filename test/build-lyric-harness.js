#!/usr/bin/env node
/* 从 renderer/app.js 抽取真实歌词模块，包进可截图的独立页面，用于验证 Monet 逐词效果。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
const startMark = '/* ---------- 歌词：B 站 AI 字幕时间轴';
const endMark = '/* 封面取色';
const start = appSrc.indexOf(startMark);
const end = appSrc.indexOf(endMark);
if (start < 0 || end < 0) throw new Error('歌词模块标记未找到');
const lyricCode = appSrc.slice(start, end);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../renderer/styles.css">
<style>
  :root { --art-1: rgb(214, 178, 120); --art-2: rgb(140, 110, 70); --art-3: rgb(40, 32, 20); }
  html, body { height: 100%; margin: 0; background:
    radial-gradient(120% 90% at 20% 10%, rgba(140,110,70,.55), transparent 60%),
    radial-gradient(100% 100% at 85% 90%, rgba(90,70,45,.6), transparent 55%),
    linear-gradient(160deg, #2b2318, #171208 70%);
    overflow: hidden; }
  .lyrics { position: relative !important; top: 0 !important; height: 660px; width: 980px; margin: 20px 0 0 40px; }
</style>
</head>
<body>
<div class="lyrics" id="lyrics"><div class="hint">加载中</div></div>
<script>
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let fakeTime = 0;
  const state = { current: null };
  const authState = { isLogin: true };
  const deskLyricOnRef = { on: false };
  var deskLyricOn = false;
  const api = {
    hasBridge: false,
    subtitles: async () => ([
      { from: 6, to: 9.6, text: '如果 你让我' },
      { from: 10, to: 14.6, text: '整个宇宙 我都想让你拥有' },
      { from: 15, to: 19.8, text: '以你为念的星宿 陪你到时间尽头' },
      { from: 20.2, to: 24.6, text: '就跟我走 若世界狂如洪流' },
      { from: 25, to: 30, text: '用我渺小的温柔 换你浩瀚的自由' },
    ]),
  };
  const activeMedia = () => ({ currentTime: fakeTime, duration: 120, paused: false });
  const videoModeOn = () => false;
</script>
<script>
${lyricCode}
</script>
<script>
  (async () => {
    const track = {};
    state.current = track;
    await loadLyrics(track);
    const params = new URLSearchParams(location.search);
    fakeTime = parseFloat(params.get('t') || '12');
    syncLyric(true);
    syncLyric();
    requestAnimationFrame(() => { syncLyric(); document.title = 'ready'; });
  })();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'lyric-harness.html'), html);
console.log('harness written');
