const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const root = path.resolve(__dirname, '../mobile-rn');
const file = require('../mobile-rn/scripts/build-compute.cjs')();
const babel = require(require.resolve('@babel/core', { paths: [root] }));
const fixture = require('./fixtures/video-cloud-python.json');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const hermes = path.join(root, 'ios/Pods/hermes-engine/destroot');
test('production iOS and Android worklet factories execute in Hermes, including config, profiles and cloud crypto', {
  skip: process.platform !== 'darwin' || !fs.existsSync(hermes),
}, t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-hermes-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const framework = path.join(hermes, 'Library/Frameworks/universal/hermesvm.xcframework/macos-arm64_x86_64');
  const runner = path.join(folder, 'runner');
  execFileSync('clang++', ['-std=c++17', path.join(__dirname, 'mobile-hermes-run.cpp'), '-I', path.join(hermes, 'include'),
    '-F', framework, '-framework', 'hermesvm', '-Wl,-rpath,' + framework, '-o', runner]);
  const expected = require('../renderer/library-sync').normalize(fixture.library);
  for (const platform of ['ios', 'android']) {
    const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file, configFile: false, babelrc: false, cwd: root,
      presets: [require.resolve('babel-preset-expo', { paths: [path.join(root, 'node_modules/expo')] })],
      caller: { name: 'metro', bundler: 'metro', platform, engine: 'hermes', projectRoot: root,
        isDev: false, isServer: false, supportsStaticESM: false },
    });
    const module = { exports: {} };
    new Function('module', 'exports', code)(module, module.exports);
    assert.deepEqual(Object.keys(module.exports.__closure), []);
    const script = path.join(folder, platform + '.js');
    fs.writeFileSync(script, `
      const make = eval('(' + ${JSON.stringify(module.exports.__initData.code)} + ')');
      const compute = make.call({__closure:{}}), fixture = ${JSON.stringify(fixture)};
      const config = {device:'phone',intervalHours:3,heads:{},slots:{},secret:'keep-existing-key'};
      if (compute('parse', compute('stringify', config)).secret !== config.secret) throw Error('config');
      const profile = compute('profileNormalize', {profiles:[{id:'p',name:'美女',tags:['cos']}],activeId:'p'});
      if (profile.profiles[0].tags[0].name !== 'cos') throw Error('profile');
      const daily = compute('profileNormalize', {daily:{shown:[{bvid:'BVseen',at:Date.now()-60000}]}}).daily;
      const selected = compute('dailySelect', [
        {bvid:'BVseen',title:'钢琴作品一',duration:180,tid:3},
        {bvid:'BVfresh',title:'钢琴作品二',duration:180,tid:3}
      ], daily, {tags:[],long:[],recent:[]});
      if (selected.length !== 1 || selected[0].bvid !== 'BVfresh') throw Error('seven-day selection');
      const songs = compute('dailySourceDecode', JSON.stringify({code:200,result:{tracks:[{id:1,name:'晴天',duration:269000,artists:[{name:'周杰伦'}]}]}}), 'playlist');
      if(songs[0].title !== '晴天' || songs[0].duration !== 269) throw Error('catalog decode');
      const candidate = {bvid:'BVmusic',title:'晴天 周杰伦',duration:269,tid:3,song:songs[0]};
      const queue = compute('dailySelectSongs', [candidate], daily, [], 24, 2);
      if(queue.length !== 1 || !queue[0].song.id) throw Error('catalog selection');
      const saved = compute('profileNormalize', {daily:{days:[{date:'2026-01-01',profileId:'auto',generatedAt:Date.now(),tracks:queue}]}}).daily;
      if(compute('dailySelectSongs', [{...candidate,bvid:'BVother'}], saved).length) throw Error('song exposure');
      const library = compute('librarySnapshot', fixture.library).library;
      if (JSON.stringify(library) !== ${JSON.stringify(JSON.stringify(expected))}) throw Error('library exports');
      const decoded = compute('unseal', fixture.payload, fixture.key, fixture.snapshotId);
      const sealed = compute('seal', decoded, fixture.key, 'ab'.repeat(12), 'phone', []);
      if (JSON.stringify(compute('unseal', sealed.payload, fixture.key, sealed.snapshotId)) !== JSON.stringify(decoded)) throw Error('crypto');
      'ok';
    `);
    assert.equal(execFileSync(runner, [script], { encoding: 'utf8' }).trim(), 'ok', platform);
  }
});

test('compiled worklet is self-contained and preserves desktop crypto, hashes and independent profiles without browser globals', () => {
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), { filename: file, configFile: false, babelrc: false,
    plugins: [require.resolve('react-native-worklets/plugin', { paths: [root] })] });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  assert.deepEqual(Object.keys(module.exports.__closure), [], 'worker factory cannot capture RN-only modules or constructors');
  const sandbox = vm.createContext({});
  const make = vm.runInContext('(' + module.exports.__initData.code + ')', sandbox);
  const compute = make.call(module.exports);
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(compute('unseal', fixture.payload, fixture.key, fixture.snapshotId)), fixture.library);
  const R = require('../renderer/recommendation-profile'), L = require('../renderer/library-sync');
  const data = { ...fixture.library, recommendation: R.normalize({ profiles: [{ id: 'main', name: '音乐', tags: ['钢琴'] }] }),
    discoveryRecommendation: R.normalize({ profiles: [{ id: 'discovery', name: '美女', tags: ['cos'] }] }) };
  const result = plain(compute('librarySnapshot', data));
  assert.deepEqual(result.library, L.normalize(data));
  assert.equal(result.revision, require('node:crypto').createHash('md5').update(JSON.stringify(L.normalize(data))).digest('hex'));
  assert.equal(compute('libraryNormalize', data, { discovery: false }).discoveryRecommendation, undefined);
  const encoded = compute('seal', data, fixture.key, 'ab'.repeat(12), 'worker-phone', []);
  assert.deepEqual(plain(compute('unseal', encoded.payload, fixture.key, encoded.snapshotId)), data);
  assert.throws(() => compute('unseal', encoded.payload, '00'.repeat(32), encoded.snapshotId));
  assert.throws(() => compute('libraryNormalize', { version: 1, likes: [{ bvid: 'invalid' }], playlists: [] }));
});

test('real worker executes a large sync merge while the caller event loop keeps servicing input turns', async () => {
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const compute=require(workerData)();
    parentPort.on('message',job=>{try{parentPort.postMessage({value:compute(...job)});}catch(e){parentPort.postMessage({error:e.message});}});
    parentPort.postMessage({ready:true});`, { eval: true, workerData: file });
  let timer;
  try {
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const tracks = Array.from({ length: 5000 }, (_, i) => ({ bvid: 'BVworker' + i, title: '歌曲 ' + i }));
    const before = { version: 1, likes: tracks, library: [], playlists: [] };
    const local = { ...before, likes: tracks.slice(1) }, remote = { ...before, likes: [...tracks, { bvid: 'BVnew' }] };
    let turns = 0; timer = setInterval(() => turns++, 1);
    const response = new Promise((resolve, reject) => {
      worker.once('message', result => result.error ? reject(Error(result.error)) : resolve(result.value));
    });
    worker.postMessage(['libraryReconcile', before, local, remote]);
    const result = await response;
    assert.ok(turns > 0, 'computation leaves the calling event loop free');
    assert.deepEqual(result, require('../renderer/library-sync').reconcile(before, local, remote));
    assert.ok(!result.likes.some(track => track.bvid === 'BVworker0'), 'three-way merge still preserves deletions');
    assert.ok(result.likes.some(track => track.bvid === 'BVnew'));
  } finally { clearInterval(timer); await worker.terminate(); }
});
