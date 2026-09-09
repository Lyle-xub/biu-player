const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/daily-recommendation');
const R = require('../renderer/recommendation-profile');
const track = (id, tags = ['钢琴']) => ({ bvid: `BVdaily${id}`, title: `钢琴作品 ${id}`, tags, tid: 3, mid: String(id), duration: 180 });
const response = (data) => ({ status: 200, body: JSON.stringify({ code: 0, data }) });

test('daily metadata distinguishes music, format and noise; ignores explicit negatives and applies user exclusions', () => {
  const input = { title: '【Dream Pop / Shoegaze】凌晨歌单', desc: '收录 Beach House、Slowdive。音乐分享官活动投稿，商务合作',
    tags: ['音乐推荐', '电台新星征集令', '歌单', '音乐分享官'] };
  const terms = D.extract(input);
  assert.ok(terms.some((v) => v.name === '梦幻流行' && v.source === '标题'));
  assert.ok(terms.some((v) => v.name === 'Beach House' && v.source === '简介'));
  assert.ok(terms.some((v) => v.name === '合集' && v.type === 'format'));
  assert.ok(!terms.some((v) => /分享官|征集令|音乐推荐/.test(v.name)));
  assert.ok(!D.semantic(input, ['shoegaze']).some((v) => v.name === '盯鞋' || v.type === 'format'));
  assert.ok(!D.semantic({ title: '不是后摇，只是歌名里的雨，告别失眠' }).length);
  assert.ok(!D.semantic({ title: 'rockstar' }).some((v) => v.name === '摇滚'));
});

test('daily recommendations exclude playlist/compilation videos including cached days, but keep singles and segment listening evidence', () => {
  ['深夜钢琴歌单', '爵士精选集', '华语金曲串烧', '音乐合集', '整张专辑', 'Full Album', 'Dream Pop mix', 'DJ SET'].forEach((title) => assert.ok(D.isCompilation({ title }), title));
  assert.ok(D.isCompilation({ title: '钢琴', tags: ['歌单'] }));
  ['钢琴单曲', 'Little Mix - Secret Love Song', 'Song (Original Mix)', 'Song (Remix)'].forEach((title) => assert.equal(D.isCompilation({ title }), false, title));
  assert.equal(D.isCompilation({ title: '钢琴单曲', desc: '来自专辑《钢琴精选集》' }), false);
  const input = [track('single'), { ...track('compilation'), title: '钢琴歌单' }];
  const interest = { tags: [{ name: '钢琴', weight: 100 }], long: [{ name: '钢琴', weight: 100 }], recent: [] };
  assert.deepEqual(D.select(input, D.normalize(), interest).map((v) => v.bvid), ['BVdailysingle']);
  const cached = D.normalize({ days: [{ date: D.dayKey(), profileId: 'auto', complete: true, tracks: input }] });
  assert.deepEqual(D.current(cached).tracks.map((v) => v.bvid), ['BVdailysingle']);
  assert.equal(D.current(cached).complete, false, 'old compilation slots may be replenished without reordering remaining singles');
  const profile = D.taste([{ bvid: 'BVsource', source: 'playlists', at: Date.now(), title: '钢琴单曲', tags: ['钢琴'] }], D.normalize());
  assert.equal(profile.tags[0].name, '钢琴', 'user-created playlists remain a source of musical interests');
});

test('shared dictionary excludes listening/recommendation campaigns and formats without losing real styles or artists', () => {
  const noises = ['听歌', '日推', '# 日推 #', '听歌向', '听歌分享', '听歌打卡', '听歌日常', '沉浸式听歌', '一起听音乐',
    '每日推荐', '每日推歌', '日推歌曲', '日推音乐', '日推宝藏歌曲', '今日份音乐', '今天好歌分享', '每日一曲', '每日一歌',
    '每天一首好歌', '宝藏歌曲', '小众音乐', '冷门歌曲', '私藏', '私人', '自用', '私人歌单', '高质量音乐推荐',
    '网易云日推', 'QQ音乐热歌榜', '抖音热歌', '歌曲安利', '音乐安利', '好听到单曲循环', '开口跪', '前奏杀',
    '音乐分享官', '音乐安利官', '电台新星征集令', '2026音乐创作激励计划', '新星计划', '创作挑战', '音乐投稿大赛',
    '2025bilibili跨年晚会', '第三回合', '第12期', 'daily', 'music recommendations', 'fyp', '一键三连'];
  noises.forEach((name) => assert.deepEqual(D.semantic({ tags: [name] }), [], name));
  const formats = ['歌单', '合集', '100首合集', '一小时循环', '单曲循环', '无限循环', '完整版', '纯享版', '歌词版',
    '动态歌词', '中英字幕', '高音质', '无损音乐', 'HI-RES', '4K', '1080P', '官方MV', '演唱会', 'Livehouse', 'remix', 'OST', 'BGM'];
  formats.forEach((name) => assert.deepEqual(D.semantic({ tags: [name] }), [], name));
  const styles = ['后摇', '日语', '日文歌曲', '音乐剧', '古典', '民谣', '京剧', '昆曲', '钢琴', '小提琴', '手碟', '女声',
    '伤感', '梦幻', '90年代', '学习', '深夜', 'dream pop', 'post-rock', 'drum and bass', 'jazz fusion', 'metalcore',
    'City Pop', 'VOCALOID', 'Synthesizer V', 'ambient', 'Beach House', '宇多田光', '独立音乐人甲'];
  styles.forEach((name) => assert.ok(D.semantic({ tags: [name] }).length > 0, name));
  assert.deepEqual(D.semantic({ title: '【post-rock】作品' }).map((v) => v.name), ['后摇']);
  assert.deepEqual(D.semantic({ tags: ['Dream Pop', 'dream pop', '梦幻流行'] }).map((v) => v.name), ['梦幻流行']);
  assert.deepEqual(D.semantic({ tags: ['伤感音乐推荐'] }).map((v) => v.name), ['伤感']);
  const legacy = R.normalize({ auto: { tags: ['听歌', '日推', '钢琴', '音乐剧'] } });
  assert.deepEqual(legacy.auto.tags.map((v) => v.name), ['钢琴', '音乐剧']);
  const learned = R.normalize({ auto: { evidence: [{ bvid: 'BVdictionary', source: 'likes', owner: 'up', at: Date.now(), tags: noises.slice(0, 27).concat('音乐剧', '钢琴') }] } });
  assert.deepEqual(new Set(learned.auto.tags.map((v) => v.name)), new Set(['音乐剧', '钢琴']));
  const explicit = R.normalize({ profiles: [{ id: 'manual', name: '自定义日推', tags: ['日推'] }], activeId: 'manual' });
  assert.equal(R.activeProfile(explicit).tags[0].name, '日推', 'never rewrite explicitly authored strict profiles');
});

test('fixed single-track duration boundaries and segment lengths survive legacy settings and sync', async () => {
  const state = D.normalize(), interest = { tags: [], long: [], recent: [] };
  const candidates = [0, 59, 60, 600, 601].map((duration) => ({ ...track(duration), duration }));
  const selected = D.select(candidates, state, interest);
  assert.deepEqual(new Set(selected.map((t) => t.duration)), new Set([60, 600]));
  assert.equal(D.withinDuration({ duration: 3600, isSegment: true, from: 100, to: 280 }, state.duration), true);
  assert.equal(D.withinDuration({ duration: 180, isSegment: true, from: 0, to: 30 }, state.duration), false);
  const cached = D.normalize({ days: [{ date: D.dayKey(), profileId: 'auto', tracks: candidates, complete: true, rounds: 3 }] });
  assert.equal(D.current(cached).tracks.length, 2);
  assert.equal(D.current(cached).rounds, 0);
  let disk;
  const options = { read: async () => disk || { daily: { duration: { min: 120, max: 480, at: 100 } } }, write: async (v) => { disk = structuredClone(v); }, getLikes: () => [] };
  const manager = R.createManager(options);
  await manager.ready();
  const exported = await manager.exportSync();
  assert.deepEqual([exported.daily.duration.min, exported.daily.duration.max], [60, 600]);
  assert.deepEqual(D.merge(state, exported.daily).duration, D.merge(exported.daily, state).duration);
  const peer = R.createManager({ ...options, read: async () => null, write: async () => {} });
  await peer.applySync(exported);
  assert.deepEqual(peer.getSnapshot().daily.duration, exported.daily.duration);
  const restored = R.createManager(options); await restored.ready();
  assert.deepEqual(restored.getSnapshot().daily.duration, exported.daily.duration);
  assert.throws(() => D.validate({ ...state, duration: { min: 60, max: Infinity, at: 1 } }), /同步数据/);
  manager.dispose(); peer.dispose(); restored.dispose();
});


test('exposure cannot create a taste; actual listening qualifies and a seek does not count as listening', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1780000000000 });
  const events = [], listener = D.tracker((v) => events.push(v));
  listener.start(track('listen'), { manual: true, search: true });
  listener.tick(0, true);
  for (let i = 1; i <= 120; i++) { t.mock.timers.tick(1000); listener.tick(i, true); }
  assert.ok(D.qualified(events.at(-1)));
  const before = events.at(-1).seconds;
  t.mock.timers.tick(1000); listener.tick(1000, true); listener.flush();
  assert.equal(events.at(-1).seconds, before);
  listener.tick(1000, false); t.mock.timers.tick(100000); listener.tick(1100, true); listener.flush();
  assert.equal(events.at(-1).seconds, before, 'paused or missing progress cannot count as listening');
  const state = D.observe(D.normalize(), [track('feed')]);
  assert.deepEqual(D.taste([{ bvid: 'BVfeed', source: 'feed', tags: ['摇滚'], at: Date.now() }], state).tags, []);
  const learned = D.feedback(state, events.at(-1));
  assert.equal(D.taste([], learned).tags[0].name, '钢琴');
  assert.equal(D.feedback(learned, events.at(-1)).events.length, 1, 'checkpoints update the same session');
});

test('seven-day exposure exclusion survives queue replacement and sync, and expires at exactly seven days', t => {
  const now = Date.now(), day = 86400000;
  t.mock.method(Date, 'now', () => now);
  const interest = { tags: [], long: [], recent: [] };
  const old = D.normalize({ days: [{ date: D.dayKey(now), profileId: 'other-profile', generatedAt: now - day,
    tracks: [track('seen')] }] });
  const refreshed = D.normalize({ ...old, days: [{ date: D.dayKey(now), profileId: 'auto', generatedAt: now,
    tracks: [track('new')] }] });
  const remote = D.normalize({ shown: [{ bvid: track('remote').bvid, at: now - 6 * day },
    { bvid: track('expired').bvid, at: now - 7 * day }] });
  const synced = D.validate(JSON.parse(JSON.stringify(D.merge(refreshed, remote))));
  const input = ['seen', 'new', 'remote', 'expired', 'fresh'].map(id => track(id));
  assert.deepEqual(new Set(D.select(input, synced, interest).map(v => v.bvid)), new Set(['BVdailyexpired', 'BVdailyfresh']));
  const continued = D.select(input, synced, interest, [track('new')]);
  assert.equal(continued[0].bvid, 'BVdailynew', 'continuing the current queue keeps its already displayed prefix');
  assert.deepEqual(D.merge(refreshed, remote).shown, D.merge(remote, refreshed).shown);
});




test('daily diversity survives early single-tag batches; explicit single-tag profiles stay strict', async () => {
  const names = ['阿门', '钢琴', '爵士', '民谣'];
  const tags = names.map((name, i) => ({ name, weight: 100 - i * 10 }));
  const interest = { tags, long: tags, recent: tags }, state = D.normalize();
  const batch = (name) => Array.from({ length: 24 }, (_, i) => ({ ...track(`${names.indexOf(name)}x${i}`, [name]), title: `作品 ${names.indexOf(name)} / ${i}` }));
  let out = D.select(batch('阿门'), state, interest);
  assert.equal(out.length, 4, 'unclassified repeated tag cannot fill the first page');
  const prefix = out.map((t) => t.bvid);
  for (const name of names.slice(1)) out = D.select(batch(name), state, interest, out);
  assert.equal(out.length, 24);
  assert.deepEqual(out.slice(0, 4).map((t) => t.bvid), prefix);
  assert.equal(out.filter((t) => t.matchedTags.includes('阿门')).length, 4);
  for (const name of names.slice(1)) assert.ok(out.filter((t) => t.matchedTags[0] === name).length <= 8);
  assert.equal(D.select(batch('阿门'), state, interest, [], 24, { tags: [tags[0]] }).length, 24);
});

const M = require('../renderer/daily-music-source');
const immediateSlots = t => { const timeout = global.setTimeout; t.mock.method(global, 'setTimeout', (fn, ms, ...args) => timeout(fn, ms === 350 ? 0 : ms, ...args)); };
const catalogProfile = () => R.normalize({ profiles:[{id:'piano',name:'钢琴',tags:['钢琴']}],daily:{profileId:'piano'} });
function catalogGet(url) {
  const u=new URL(url),q=u.searchParams;
  if(u.pathname==='/api/playlist/list') return {status:200,body:JSON.stringify({code:200,playlists:Array.from({length:3},(_,i)=>({id:Number(q.get('offset'))+i+1,name:'钢琴歌单'}))})};
  if(u.pathname==='/api/playlist/detail') return {status:200,body:JSON.stringify({code:200,result:{tracks:Array.from({length:60},(_,i)=>{
    const id=Number(q.get('id'))*100+i;return {id,name:`作品${id}`,duration:180000,artists:[{name:`歌手${id}`,id}]};
  })}})};
  if(u.pathname.includes('/search/type')) {
    const id=q.get('keyword').match(/作品(\d+)/)?.[1];
    assert.ok(id);assert.equal(q.get('order'),'totalrank');
    return response({result:[{bvid:`BVcover${id}`,title:`作品${id} 歌手${id} 钢琴谱`,duration:'03:00',typeid:3},
      {bvid:`BVcatalog${id}`,title:`作品${id} 歌手${id}`,duration:'03:00',typeid:3}]});
  }
  throw Error('unexpected '+u.pathname);
}

test('catalog matching uses source aliases, rejects scores and mismatched recordings, and does not confuse short artist names',()=>{
  const s={title:'이름에게',artists:['IU'],aliases:['致姓名'],artistAliases:[],duration:289};
  assert.ok(M.matchScore(s,{title:'IU 致姓名',duration:290})>0);
  assert.equal(M.matchScore(s,{title:'IU 致姓名 Bass Tab 贝斯谱',duration:289}),0);
  assert.equal(M.matchScore(s,{title:'IU 致姓名 架子鼓动态谱',duration:289}),0);
  assert.equal(M.matchScore(s,{title:'【鏡音レン】IU 致姓名',duration:289}),0);
  for(const extra of ['谱乐园','ニコカラ','ベースカバー','花絮']) assert.equal(M.matchScore(s,{title:`IU 致姓名 ${extra}`,duration:289}),0);
  assert.equal(M.matchScore(s,{title:'premium 致姓名',duration:289}),0);
  assert.equal(M.matchScore(s,{title:'IU 致姓名 live',duration:289}),0);
  assert.equal(M.matchScore(s,{title:'IU 致姓名',duration:20}),0);
  assert.ok(M.matchScore({title:'満ちてゆく',artists:['藤井風'],aliases:[],artistAliases:['藤井风','Fujii Kaze'],duration:311},
    {title:'満ちてゆく - 藤井风',duration:312})>0);
  assert.equal(M.plans({tags:[{name:'Cosplay',weight:100},{name:'日语',weight:50}]}).length,1);
});

test('catalog songs retain seven-day identities through queue replacement, platform IDs, profile changes, and sync', t=>{
  const now=Date.now(),day=86400000;t.mock.method(Date,'now',()=>now);
  const s={source:'netease',id:'123',title:'名称',artists:['歌手'],aliases:['Name'],artistAliases:['Singer']};
  const a={...track('a'),song:s}, b={...track('b'),song:{source:'qq',id:'qq123',title:'Name',artists:['Singer']}};
  const old=D.normalize({days:[{date:D.dayKey(),profileId:'piano',generatedAt:now-6*day,tracks:[a]}]});
  const replaced=D.normalize({...old,days:[]});
  const synced=D.validate(JSON.parse(JSON.stringify(D.merge(replaced,D.normalize()))));
  assert.equal(D.selectSongs([b],synced).length,0,'another source and another upload of the song remain excluded');
  assert.deepEqual(D.merge(replaced,D.normalize()).shownSongs,D.merge(D.normalize(),replaced).shownSongs);
  const expired=D.normalize({...synced,shownSongs:synced.shownSongs.map(v=>({...v,at:now-7*day})),shown:[]});
  assert.equal(D.selectSongs([b],expired).length,1);
  assert.throws(()=>D.validate({...D.normalize(),shownSongs:[{key:'invalid',at:now}]}),/同步数据/);
});

test('catalog generation streams a stable queue of at least fifteen, persists it, and never repeats songs on force/restart/sync',async t=>{
  immediateSlots(t);
  let disk=catalogProfile(),calls=0,inflight=0,peak=0;
  const prefixes=[];
  const options={read:async()=>disk,write:async v=>{disk=structuredClone(v);},getLikes:()=>[],get:async url=>{
    calls++;inflight++;peak=Math.max(peak,inflight);await new Promise(setImmediate);inflight--;return catalogGet(url);
  }};
  const manager=R.createManager(options);
  manager.subscribe(()=>{const e=D.current(manager.getSnapshot().daily);if(e?.tracks.length)prefixes.push(e.tracks.map(t=>t.bvid));});
  const first=await manager.generateDaily();
  assert.equal(first.complete,true);assert.equal(first.tracks.length,24);assert.ok(peak<=3);
  prefixes.forEach(prefix=>assert.deepEqual(first.tracks.slice(0,prefix.length).map(t=>t.bvid),prefix));
  assert.ok(prefixes.some(p=>p.length>0&&p.length<15),'partial batches appear immediately');
  const before=calls;await manager.generateDaily();assert.equal(calls,before,'today reads from persistent cache');
  const firstKeys=new Set(first.tracks.flatMap(D.songKeys));
  const second=await manager.generateDaily(true);
  assert.ok(second.tracks.length>=15);assert.ok(second.tracks.every(t=>D.songKeys(t).every(k=>!firstKeys.has(k))));
  manager.dispose();
  const restored=R.createManager(options);const beforeRestore=calls;await restored.generateDaily();assert.equal(calls,beforeRestore);
  const peer=R.createManager({...options,read:async()=>null,write:async()=>{}});
  await peer.applySync(await restored.exportSync());
  assert.deepEqual(peer.getSnapshot().daily.shownSongs,restored.getSnapshot().daily.shownSongs);
  const third=await peer.generateDaily(true);
  const seen=new Set([...first.tracks,...second.tracks].flatMap(D.songKeys));
  assert.ok(third.tracks.length>=15);assert.ok(third.tracks.every(t=>D.songKeys(t).every(k=>!seen.has(k))));
  restored.dispose();peer.dispose();
});

test('catalog outages retain partial results, remain retryable, and never count fewer than fifteen as complete',async t=>{
  immediateSlots(t);
  let disk=catalogProfile(),calls=0,blocked=false;
  const manager=R.createManager({read:async()=>disk,write:async v=>{disk=v;},getLikes:()=>[],get:async url=>{
    calls++;if(blocked)return {status:412,body:''};
    if(url.includes('/search/type')){const result=catalogGet(url);if(++videos===3)blocked=true;return result;}
    return catalogGet(url);
  }});
  let videos=0;
  const first=await manager.generateDaily();assert.equal(first.tracks.length,3);assert.equal(first.complete,false);assert.match(first.error,/412/);
  const before=calls;await manager.generateDaily();assert.equal(calls,before,'no immediate automatic retry storm');
  blocked=false;const second=await manager.generateDaily(true);assert.ok(second.tracks.length>=15);
  assert.ok(second.tracks.every(t=>!first.tracks.some(old=>old.bvid===t.bvid)));manager.dispose();
});

test('seven successive daily queues each contain fifteen or more distinct songs across restarts',async t=>{
  immediateSlots(t);
  let now=Date.now(),disk=catalogProfile();t.mock.method(Date,'now',()=>now);
  const seen=new Set();
  for(let day=0;day<7;day++){
    const manager=R.createManager({read:async()=>disk,write:async v=>{disk=v;},getLikes:()=>[],get:async url=>catalogGet(url)});
    const entry=await manager.generateDaily();
    assert.ok(entry.tracks.length>=15,`day ${day+1}: ${entry.error}`);
    for(const track of entry.tracks){
      const keys=D.songKeys(track);assert.ok(keys.every(k=>!seen.has(k)));keys.forEach(k=>seen.add(k));
    }
    manager.dispose();now+=86400000;
  }
});

test('changing daily profile does not wait for a pending catalog request or allow its late result to overwrite selection',async()=>{
  let finish;
  const manager=R.createManager({read:async()=>catalogProfile(),write:async()=>{},getLikes:()=>[],
    get:()=>new Promise(resolve=>{finish=resolve;})});
  const generating=manager.generateDaily();await new Promise(setImmediate);
  assert.equal(typeof finish,'function');
  await manager.dailyAction({type:'profile',id:'auto'});
  assert.equal(manager.getSnapshot().daily.profileId,'auto');
  finish({status:200,body:JSON.stringify({code:200,playlists:[]})});
  await generating;assert.equal(manager.getSnapshot().daily.profileId,'auto');manager.dispose();
});


test('daily generation survives repeated unchanged and learned-profile syncs between three-song batches', async t => {
  immediateSlots(t);
  let disk = catalogProfile(), manager, syncs = 0, begins = 0, finishes = 0;
  manager = R.createManager({ read: async () => disk, write: async value => { disk = value; }, getLikes: () => [],
    beginDaily: () => { begins++; return () => { finishes++; }; },
    get: async url => {
      if (url.includes('/search/type')) {
        const base = await manager.exportSync(), incoming = structuredClone(base);
        if (++syncs % 2 === 0) { incoming.auto.updatedAt = Date.now(); incoming.auto.tags = [{name:'爵士',weight:80}]; }
        await manager.applySync(incoming, base);
      }
      return catalogGet(url);
    },
  });
  t.after(() => manager.dispose());
  const result = await manager.generateDaily();
  assert.ok(syncs >= 15);
  assert.ok(result.tracks.length >= 15, result.error);
  assert.equal(result.complete, true);
  assert.equal(begins, 1); assert.equal(finishes, 1);
  await manager.generateDaily();
  assert.equal(begins, 1, 'cached queues do not reserve foreground work');
});

test('syncing a changed daily filter cancels old results and releases foreground priority', async () => {
  let finish, released = 0;
  const manager = R.createManager({read:async()=>catalogProfile(),write:async()=>{},getLikes:()=>[],
    beginDaily: () => () => { released++; }, get:()=>new Promise(resolve=>{finish=resolve;})});
  const generating = manager.generateDaily(); await new Promise(setImmediate);
  const before = await manager.exportSync(), incoming = structuredClone(before);
  incoming.profiles[0].tags = [{name:'爵士',weight:100}];
  await manager.applySync(incoming, before);
  finish({status:200,body:JSON.stringify({code:200,playlists:[]})});
  await generating;
  assert.equal(manager.getSnapshot().profiles[0].tags[0].name, '爵士');
  assert.equal(D.current(manager.getSnapshot().daily).tracks.length, 0);
  assert.equal(released, 1);
  manager.dispose();
});


test('streamed daily progress persists exposure without recomputing the complete profile after each batch', async t => {
  immediateSlots(t);
  let disk = catalogProfile(), normalizations = 0, progress = 0;
  const manager = R.createManager({read:async()=>disk,write:async v=>{disk=v;},getLikes:()=>[],get:async url=>catalogGet(url),
    compute: async (operation, ...args) => {
      switch (operation) {
        case 'profileNormalize': normalizations++; return R.normalize(args[0]);
        case 'dailyNormalize': progress++; return D.normalize(args[0]);
        case 'dailyTaste': return D.taste(...args);
        case 'dailySourceDecode': return M.decode(...args);
        case 'dailySelectSongs': return D.selectSongs(...args);
        default: throw Error(operation);
      }
    },
  });
  t.after(()=>manager.dispose());
  const result = await manager.generateDaily();
  assert.ok(result.tracks.length >= 15);
  assert.ok(progress > 3, 'partial queues still persist as songs arrive');
  assert.equal(normalizations, 2, 'one initial read and one final learned-profile refresh');
  assert.equal(disk.daily.shown.length, result.tracks.length);
  assert.equal(disk.daily.shownSongs.length, new Set(result.tracks.flatMap(D.songKeys)).size);
  assert.deepEqual(disk, R.normalize(disk), 'the final sync snapshot remains fully normalized');
});
