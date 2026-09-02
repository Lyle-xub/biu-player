/* CDP 复现 2：真实鼠标事件路径（Input.dispatchMouseEvent）+ 电台直播播放中切换导航。
   用法：先 `npx electron . --remote-debugging-port=9223`，再 `node test/cdp-nav-repro2.js` */
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
  const realClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const clickNav = async (v) => {
    const rect = JSON.parse(await evalJs(
      `JSON.stringify(document.querySelector('#mainNav button[data-v="${v}"]').getBoundingClientRect())`));
    const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
    const hit = await evalJs(`(() => { const el = document.elementFromPoint(${x}, ${y});
      return el ? el.tagName + '.' + el.className : 'null'; })()`);
    await realClick(x, y);
    await sleep(600);
    const view = await evalJs('document.body.dataset.view');
    console.log(`真实点击 [${v}] @(${x},${y}) 命中=${hit} → view=${view} ${view === v ? 'OK' : '*** 失败 ***'}`);
    return view;
  };

  await send('Runtime.enable');
  await send('Log.enable');

  // 场景 A：无播放，电台页真实鼠标点击
  await evalJs(`go('radio')`);
  await sleep(700);
  await clickNav('library');
  await clickNav('fav');
  await clickNav('radio');

  // 场景 B：电台直播播放中（点第一张电台卡开播，回电台页，再点歌单）
  const hasCard = await evalJs(`!!document.querySelector('.view-radio .gcard')`);
  if (hasCard) {
    await evalJs(`document.querySelector('.view-radio .gcard').click()`);
    await sleep(2500);
    console.log('点电台卡后 view =', await evalJs('document.body.dataset.view'),
      '| live =', await evalJs('document.body.classList.contains("live-on")'));
    await evalJs(`go('radio')`); // 回到电台列表页（直播继续播）
    await sleep(700);
    await clickNav('library');
    await clickNav('fav');
    await clickNav('radio');
  } else {
    console.log('（电台列表为空，跳过场景 B）');
  }

  const errors = events.filter((e) =>
    e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  console.log('\n控制台错误/异常：');
  for (const e of errors) console.log(JSON.stringify(e.params).slice(0, 300));
  if (!errors.length) console.log('（无）');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
