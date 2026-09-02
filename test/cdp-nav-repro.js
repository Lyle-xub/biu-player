/* CDP 复现：电台页点击导航「歌单」是否切换失败。
   用法：先 `npx electron . --remote-debugging-port=9223`，再 `node test/cdp-nav-repro.js` */
const http = require('http');
const WebSocket = require('ws');

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let d = '';
    res.on('data', (c) => d += c);
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = await getJson('http://127.0.0.1:9223/json');
  const page = targets.find((t) => t.url.includes('renderer/index.html'));
  if (!page) throw new Error('找不到主页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.on('open', r));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const res = r.result && r.result.result;
    return res && 'value' in res ? res.value : (res ? res.description : JSON.stringify(r.result));
  };

  await send('Runtime.enable');
  await send('Log.enable');

  console.log('初始 view =', await evalJs('document.body.dataset.view'));

  // 1. 进入电台页
  await evalJs(`go('radio')`);
  await sleep(800);
  console.log('go(radio) 后 view =', await evalJs('document.body.dataset.view'));

  // 2. 检查「歌单」按钮是否被遮挡（真实点击会命中的元素）
  console.log('歌单按钮中心的命中元素 =', await evalJs(`(() => {
    const b = document.querySelector('#mainNav button[data-v="library"]').getBoundingClientRect();
    const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return el ? el.tagName + '.' + el.className + ' (id=' + el.id + ')' : 'null（点在视口外）';
  })()`));
  console.log('按钮 rect =', await evalJs(`JSON.stringify(document.querySelector('#mainNav button[data-v="library"]').getBoundingClientRect())`));

  // 3. 真实点击「歌单」
  await evalJs(`document.querySelector('#mainNav button[data-v="library"]').click()`);
  await sleep(800);
  console.log('点击歌单后 view =', await evalJs('document.body.dataset.view'));

  // 4. 再试 收藏夹 / 回电台 对照
  await evalJs(`document.querySelector('#mainNav button[data-v="fav"]').click()`);
  await sleep(500);
  console.log('点击收藏夹后 view =', await evalJs('document.body.dataset.view'));

  const errors = events.filter((e) =>
    (e.method === 'Runtime.exceptionThrown') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  console.log('\n控制台错误/异常：');
  for (const e of errors) console.log(JSON.stringify(e.params).slice(0, 400));
  if (!errors.length) console.log('（无）');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
