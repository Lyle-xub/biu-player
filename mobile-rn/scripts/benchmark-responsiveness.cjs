// Synthetic workload, not a device FPS claim. Same bundled code in both runs.
const { Worker } = require('node:worker_threads');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const file = require('./build-compute.cjs')();
const compute = require(file)();
const profile = require('../../renderer/recommendation-profile');
const count = Number(process.argv[2]) || 3000;
const tracks = Array.from({ length: count }, (_, i) => ({ bvid: 'BVperf' + i, cid: i + 1,
  title: '音乐收藏 · ' + i, up: 'UP' + i % 70, duration: 180, pic: 'https://i.example/cover.jpg' }));
const state = profile.normalize({ auto: { evidence: tracks.map((t, i) => ({ bvid: t.bvid, owner: t.up,
  source: 'likes', at: Date.now() - i * 10000, title: t.title, tags: ['音乐', '翻唱', '钢琴', '流行'] })) } });
const library = { version: 1, likes: tracks, library: tracks,
  playlists: [{ id: 1, title: '收藏', tracks }], recommendation: state, discoveryRecommendation: state };
const jobs = [['libraryReconcile', library, library, library], ['librarySnapshot', library],
  ['seal', library, 'ab'.repeat(32), 'cd'.repeat(12), 'benchmark', []]];
async function measure(name, run) {
  const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable();
  await new Promise(r => setTimeout(r, 10));
  const start = performance.now();
  for (const job of jobs) await run(job);
  const elapsed = performance.now() - start;
  await new Promise(r => setTimeout(r, 10)); delay.disable();
  return { name, tracks: count, elapsedMs: Math.round(elapsed), maxEventLoopDelayMs: +(delay.max / 1e6).toFixed(1) };
}
(async () => {
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    const compute=require(workerData)();parentPort.on('message',job=>{
      try{parentPort.postMessage({value:compute(...job)});}catch(e){parentPort.postMessage({error:e.message});}
    });parentPort.postMessage({ready:true});`, { eval: true, workerData: file });
  try {
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const before = await measure('original JS synchronous algorithms', job => compute(...job));
    const after = await measure('same algorithms on worker', job => new Promise((resolve, reject) => {
      worker.once('message', message => message.error ? reject(Error(message.error)) : resolve()); worker.postMessage(job);
    }));
    console.log(JSON.stringify({ platform: process.platform, runtime: process.version, before, after }, null, 2));
  } finally { await worker.terminate(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
