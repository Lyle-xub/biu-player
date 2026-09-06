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

test('unknown durations are verified with bounded lookups while known singles are shown immediately', async () => {
  const pending = [];
  const manager = R.createManager({ read: async () => null, write: async () => {}, getLikes: () => [],
    get: (url) => {
      const query=new URL(url);
      if(query.pathname.includes('/search/')) {
        assert.equal(query.searchParams.get('keyword'),'日推');
        return Promise.resolve(response({result:query.searchParams.get('page')==='1'
          ? [track('known'), ...Array.from({length:8},(_,i)=>({...track(`unknown${i}`),duration:0}))].map(t=>({...t,type:'video'})) : []}));
      }
      return new Promise(resolve=>pending.push({url,resolve}));
    },
  });
  const generating = manager.generateDaily();
  await new Promise(setImmediate);
  assert.deepEqual(D.current(manager.getSnapshot().daily).tracks.map((t) => t.bvid), ['BVdailyknown']);
  // Resolve the two bounded batches; only in-range verified durations can join.
  for (let start = 0; start < 6;) {
    const end = pending.length;
    assert.ok(end > start && end - start <= 3);
    for (let i = start; i < end; i++) pending[i].resolve(response({ duration: i === 0 ? 180 : i === 1 ? 700 : 0, tid: 3 }));
    start = end;
    await new Promise(setImmediate);
  }
  const entry = await generating;
  assert.equal(pending.length, 6);
  assert.deepEqual(new Set(entry.tracks.map((t) => t.bvid)), new Set(['BVdailyknown', 'BVdailyunknown0']));
  manager.dispose();
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

test('daily generation streams stable prefixes, fixes the day, persists across restart and merges across devices', async () => {
  let disk, baseCalls = 0, searchCalls = 0;
  const seed = R.normalize({ auto: { evidence: [{ bvid: 'BVseed', source: 'likes', owner: 'seed', at: Date.now(), tags: ['钢琴'] }] } });
  seed.daily=D.normalize({candidates:[track('cached')],days:[{date:D.dayKey(),profileId:'auto',complete:true,tracks:[track('legacy')]}]});
  const pending = [], prefixes = [];
  const options = { read: async () => disk || seed, write: async (v) => { disk = structuredClone(v); }, getLikes: () => [],
    getDailyBase: async () => { baseCalls++; return Array.from({ length: 8 }, (_, i) => track(i)); },
    get: (url) => {searchCalls++;return new Promise((resolve) => pending.push({ resolve, url }));},
  };
  const manager = R.createManager(options);
  manager.subscribe(() => { const entry = D.current(manager.getSnapshot().daily); if (entry?.source===D.SOURCE && entry.tracks.length) prefixes.push(entry.tracks.map((v) => v.bvid)); });
  const generating = manager.generateDaily();
  await new Promise(setImmediate);
  assert.equal(D.current(manager.getSnapshot().daily).tracks.length, 0, 'old daily queues and feed candidates cannot bypass the 日推 search');
  assert.equal(baseCalls,0);
  assert.deepEqual(pending.map(v=>new URL(v.url).searchParams.get('keyword')),['日推','日推','日推']);
  assert.deepEqual(pending.map(v=>new URL(v.url).searchParams.get('order')),['pubdate','pubdate',null]);
  assert.equal(pending.length, 3);
  const batch = (offset) => ({ result: Array.from({ length: 8 }, (_, i) => ({ ...track(offset + i), type: 'video', typeid: 3, tag: '钢琴' })) });
  pending[1].resolve(response(batch(0))); await new Promise(setImmediate);
  assert.equal(D.current(manager.getSnapshot().daily).tracks.length, 8, 'a completed search page appears before the remaining requests finish');
  pending[0].resolve(response(batch(8))); pending[2].resolve(response(batch(16)));
  const entry = await generating;
  assert.equal(entry.tracks.length, 24); assert.equal(entry.complete, true);
  prefixes.forEach((prefix) => assert.deepEqual(entry.tracks.slice(0, prefix.length).map((v) => v.bvid), prefix));
  await manager.generateDaily(); assert.equal(searchCalls, 3); assert.equal(baseCalls,0);
  manager.dispose();
  const restored = R.createManager(options); await restored.generateDaily(); assert.equal(searchCalls, 3); assert.equal(baseCalls,0);
  const peer = R.createManager({ ...options, read: async () => null });
  await peer.applySync(await restored.exportSync());
  assert.deepEqual(D.current(peer.getSnapshot().daily).tracks, entry.tracks);
  await peer.dailyAction({ type: 'ignored', name: '钢琴' });
  assert.equal(peer.getSnapshot().auto.tags.length, 0);
  assert.equal(D.current(peer.getSnapshot().daily).tracks.length, 24, 'profile edits do not replace the current daily queue');
  await peer.dailyAction({ type: 'blocked', name: entry.tracks[0].bvid });
  assert.equal(D.current(peer.getSnapshot().daily).tracks.length, 23);
  const merged = R.reconcile(undefined, await restored.exportSync(), await peer.exportSync());
  assert.ok(merged.daily.ignored.some((v) => v.name === '钢琴' && v.active));
  assert.deepEqual(R.reconcile(merged, merged, merged), merged);
  restored.dispose(); peer.dispose();
});

test('daily strict selection rejects unrelated partitions and videos; failed searches preserve partial results with a bounded retry', async () => {
  let disk, calls = 0, blocked = true;
  const custom = R.normalize({ profiles: [{ id: 'piano', name: '钢琴', tags: ['钢琴'] }], daily: { profileId: 'piano' } });
  const manager = R.createManager({ read: async () => disk || custom, write: async (v) => { disk = v; }, getLikes: () => [],
    getDailyBase: async () => { throw new Error('strict daily must not request platform fallback'); },
    get: async () => {
      calls++;
      if (blocked) return { status: 412, body: '' };
      return response({ result: [{ ...track('short'), type: 'video', typeid: 3, tag: '钢琴', duration: 90 },
        { ...track('wrong'), title: '旅游', type: 'video', typeid: 3, tag: '旅游' },
        { ...track('partition'), type: 'video', typeid: 1, tag: '钢琴' }] });
    },
  });
  const failed = await manager.generateDaily(); assert.match(failed.error, /限制/); assert.equal(calls, 3);
  await manager.generateDaily(); assert.equal(calls, 3, 'no automatic retry storm');
  blocked = false;
  const result = await manager.generateDaily(true);
  assert.deepEqual(result.tracks.map((v) => v.bvid), ['BVdailyshort']);
  assert.equal(result.complete, false); assert.match(result.error, /只找到 1 首/);
  assert.equal(calls, 18, 'fewer than 15 matches searches at most five rounds of three pages');
  manager.dispose();
  assert.throws(() => D.validate({ ...D.normalize(), candidates: [{ bvid: 'bad' }] }), /同步数据/);
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
  const urls = [];
  const manager = R.createManager({ read: async () => R.normalize({ profiles: [{ id: 'mix', name: '混合', tags: [{ name: '阿门', weight: 100 }, { name: '钢琴', weight: 2 }, { name: '爵士', weight: 1 }] }], daily: { profileId: 'mix' } }),
    write: async () => {}, getLikes: () => [], get: async (url) => { urls.push(new URL(url)); return response({ result: [] }); } });
  await manager.generateDaily();
  assert.equal(urls.length, 15);
  assert.ok(urls.every(url=>url.searchParams.get('keyword')==='日推'));
  assert.deepEqual(urls.map(url=>[url.searchParams.get('order') || 'default',Number(url.searchParams.get('page'))]),[
    ['pubdate',1],['pubdate',2],['default',1],
    ['pubdate',3],['pubdate',4],['default',2],
    ['pubdate',5],['pubdate',6],['default',3],
    ['pubdate',7],['pubdate',8],['default',4],
    ['pubdate',9],['pubdate',10],['default',5],
  ]);
  manager.dispose();
});
