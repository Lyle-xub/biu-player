// Isolated fixture: actual React shell/controller/styles; no account or user data is accessed.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../web/src/App.jsx';
import { publish } from '../web/src/store.js';
import '../renderer/styles.css';
import '../mobile/mobile.css';

createRoot(document.getElementById('root')).render(<App />);
const tools = document.createElement('aside');
tools.style.cssText = 'position:fixed;left:8px;top:150px;z-index:100;background:#101010e8;color:white;padding:10px;border-radius:12px;font:12px monospace;max-width:300px';
tools.innerHTML = '<button id="seedPerf">加载 144 张卡片</button> <button id="runPerf">滚动采样</button> <button id="appendPerf">追加 12 张</button> <button id="wheelPerf">纵向手势测试</button><pre id="perfResult" style="white-space:pre-wrap">就绪后加载样本</pre>';
document.body.appendChild(tools);
const report = (data) => { document.getElementById('perfResult').textContent = JSON.stringify(data, null, 2); };
const imageDecode = HTMLImageElement.prototype.decode;
let decodes = 0;
HTMLImageElement.prototype.decode = function (...args) { decodes++; return imageDecode.apply(this, args); };
const image = (i) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${i * 47 % 360} 55% 57%)"/><stop offset="1" stop-color="#152235"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="220" cy="210" r="145" fill="#ffffff40"/><path d="M0 470 Q300 220 600 470V600H0Z" fill="#101b3370"/><text x="40" y="530" fill="white" font-size="44">音乐推荐 ${i + 1}</text></svg>`);
const track = (i) => ({ bvid: `fixture-${i}`, title: `音乐推荐 ${i + 1} · 夏日歌单与生活的每个瞬间`, up: '音乐分享', duration: 240, pic: image(i) });
let tracks = [];
document.getElementById('seedPerf').onclick = () => {
  if (!window.biuUi) { report({ status: '界面仍在启动，请稍后再加载样本' }); return; }
  window.biuUi.go('library');
  tracks = Array.from({ length: 144 }, (_, i) => track(i));
  publish('lib.rec', { tracks, hint: null });
  report({ seeded: tracks.length });
};
document.getElementById('appendPerf').onclick = () => {
  const before = decodes;
  const previous = document.querySelector('#grid-rec .gcard');
  const started = performance.now();
  tracks = [...tracks, ...Array.from({ length: 12 }, (_, i) => track(tracks.length + i))];
  publish('lib.rec', { tracks, hint: null });
  requestAnimationFrame(() => requestAnimationFrame(() => report({
    appended: 12, cards: tracks.length, decodeCalls: decodes - before,
    commitMs: +(performance.now() - started).toFixed(1),
    firstCardRetained: previous === document.querySelector('#grid-rec .gcard'),
  })));
};
document.getElementById('wheelPerf').onclick = () => {
  const shelf = document.querySelector('.shelf');
  const selected = () => shelf.querySelector('[aria-current="true"]')?.id;
  const before = selected();
  const event = new WheelEvent('wheel', { deltaX: 5, deltaY: 90, bubbles: true, cancelable: true });
  shelf.dispatchEvent(event);
  report({ deltaX: 5, deltaY: 90, verticalPrevented: event.defaultPrevented, before, after: selected() });
};
document.getElementById('runPerf').onclick = () => {
  const view = document.querySelector('.view-library');
  const button = document.getElementById('runPerf');
  button.disabled = true;
  const start = performance.now(), frames = [], longTasks = [];
  let last = start;
  const observer = new PerformanceObserver((entries) => longTasks.push(...entries.getEntries().map((e) => e.duration)));
  observer.observe({ type: 'longtask', buffered: false });
  const extent = Math.min(6000, view.scrollHeight - view.clientHeight);
  const tick = (now) => {
    if (now - start > 300) frames.push(now - last);
    last = now;
    const t = Math.min(1, (now - start) / 8000);
    view.scrollTop = extent * (1 - Math.cos(t * Math.PI * 4)) / 2;
    if (t < 1) requestAnimationFrame(tick);
    else {
      observer.disconnect(); button.disabled = false;
      const sorted = [...frames].sort((a, b) => a - b);
      report({ cards: document.querySelectorAll('.gcard').length, samples: frames.length,
        meanMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
        p95Ms: +sorted[Math.floor(sorted.length * .95)].toFixed(2),
        over25ms: frames.filter((x) => x > 25).length,
        maxMs: +Math.max(...frames).toFixed(2), longTasks: longTasks.length,
        longTaskMs: +longTasks.reduce((a, b) => a + b, 0).toFixed(1),
        glassLayers: document.querySelectorAll('.gcard .count').length });
    }
  };
  requestAnimationFrame(tick);
};
