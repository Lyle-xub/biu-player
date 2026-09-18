const {test}=require('node:test');const assert=require('node:assert/strict');
const I=require('../renderer/profile-interest'), R=require('../renderer/recommendation-profile').discovery, A=require('../renderer/profile-analysis');
const profile=(tags=['摄影'],interests={})=>({id:'p',name:'兴趣',tags:tags.map(name=>({name,weight:80})),interests:I.normalize(interests)});
test('general interests support nonmusic, missing tags, explicit negatives and product-name boundaries',()=>{
 for(const name of ['摄影','旅行','美食','软件','游戏','穿搭'])assert.equal(I.evaluate({title:name+'教学'},profile([name])).eligible,true,name);
 assert.equal(I.evaluate({title:'不是摄影教学'},profile()).eligible,false);
 assert.equal(I.evaluate({title:'摄影软件'},profile()).eligible,false);
 assert.equal(I.evaluate({title:'COS丝袜软件'},profile(['cos','丝袜'])).eligible,false);
 assert.equal(I.evaluate({title:'软件应用开发'},profile(['软件'])).eligible,true);
 assert.equal(I.evaluate({title:'构图实拍教学'},profile([],{description:'构图实拍教学'})).eligible,true);
});
test('explicit exclusions and author blocks beat all model signals; author preference cannot independently qualify',()=>{
 const p=profile(['摄影'],{avoid:['广告'],authors:[{mid:'2',mode:'block',at:1}]});p.learned={authors:[{mid:'1',weight:100}]};
 assert.equal(I.evaluate({title:'游戏',mid:'1'},p).eligible,false);
 const evidence={textCalibrated:true,textThreshold:.8,textSimilarity:1,visualCalibrated:true,visualThreshold:.8,visualSimilarity:1,sampleCount:5,authorCount:2,visualNeighbours:2};
 assert.equal(I.evaluate({title:'摄影广告',mid:'1'},p,evidence).eligible,false);
 assert.equal(I.evaluate({title:'摄影',mid:'2'},p,evidence).eligible,false);
 assert.equal(I.evaluate({title:'摄影',mid:'1'},p).score>80,true);
});
test('visual-only eligibility requires calibration, independent examples, enabled preference and quota',()=>{
 const p=profile();const base={sampleCount:5,authorCount:2,visualNeighbours:2,visualSimilarity:.97,visualThreshold:.9,visualCalibrated:true};
 assert.equal(I.evaluate({title:'日常'},p,base).visualOnly,true);
 for(const patch of [{visualCalibrated:false},{sampleCount:4},{authorCount:1},{visualNeighbours:1},{conflict:true}])assert.equal(I.evaluate({title:'日常'},p,{...base,...patch}).eligible,false);
 assert.equal(I.evaluate({title:'日常'},profile(['摄影'],{visualEnabled:false}),base).eligible,false);
 const tracks=Array.from({length:20},(_,i)=>({bvid:'BV'+i,title:i<10?'摄影':'日常'}));const evidence=Object.fromEntries(tracks.map(t=>[t.bvid,base]));
 const selected=R.rank(tracks,p,[],20,{evidence});const visual=selected.filter(t=>t.title==='日常').length;
 assert.ok(visual>0&&visual/selected.length<=.2);
});
test('extension merges preserve fields from old peers and persist explicit clears and restores',()=>{
 const a=profile(['摄影'],{description:'自然光摄影',avoid:['广告'],at:1,authors:[{mid:'2',name:'UP',mode:'block',at:1}]});
 const left=R.normalize({profiles:[a]}), old=R.normalize({profiles:[{id:'p',name:'旧端修改',tags:['旅行']}]});
 const merged=R.reconcile(undefined,left,old);
 assert.equal(merged.profiles[0].interests.description,'自然光摄影');
 const clear=I.normalize({description:'',avoid:[],at:2,authors:[{mid:'2',name:'UP',mode:'normal',at:2}]});
 const restored=I.merge(a.interests,clear);assert.equal(restored.description,'');assert.equal(restored.authors[0].mode,'normal');
 assert.deepEqual(I.merge(a.interests,clear),I.merge(clear,a.interests));
 assert.throws(()=>I.validate({...clear,description:'x'.repeat(501)}));
});
test('learning never transfers custom-profile behavior to another profile, and unsupported titles still contribute',()=>{
 const evidence=[{bvid:'BV1',profileId:'p',source:'likes',owner:'1',title:'建筑摄影',at:Date.now()}, {bvid:'BV2',source:'likes',owner:'2',title:'软件开发',tags:[],at:Date.now()}];
 assert.deepEqual(I.learn(evidence,[],'p').tags.map(t=>t.name),['建筑摄影']);
 assert.deepEqual(I.learn(evidence,[],'auto').tags.map(t=>t.name),['软件开发']);
 assert.deepEqual(I.learn(evidence,[],'other').tags,[]);
});
test('serialized analysis queue never blocks observe and cannot repopulate cache after clear',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let complete,active=0,peak=0,calls=0;
 const service=A.create({status:()=>({text:{enabled:true}}),encode:async()=>{calls++;peak=Math.max(peak,++active);const v=await new Promise(r=>complete=r);active--;return v;}});
 const p=profile();assert.equal(service.observe([{bvid:'BV1',title:'摄影实拍'}],p),undefined);
 t.mock.timers.tick(100);await Promise.resolve();assert.equal(calls,1);service.clear();complete(Array(512).fill(.1));await Promise.resolve();await Promise.resolve();
 assert.equal(service.evidence([{bvid:'BV1',title:'摄影实拍'}],p).BV1.textSimilarity,0);assert.equal(peak,1);service.dispose();
});

test('preference events retain their profile through normalization and cross-device merges',()=>{
 const a=R.normalize({profiles:[profile()]});const recorded=R.recordEvidence(a,{bvid:'BVphoto',title:'摄影',mid:42,pic:'https://i0.hdslb.com/image.jpg'},'playlists','p');
 assert.equal(recorded.auto.tags.length,0,'recording does not immediately learn');
 const received=R.reconcile(undefined,a,JSON.parse(JSON.stringify(recorded)));
 assert.equal(received.auto.evidence[0].profileId,'p');
 const trained=R.normalize(received,true);
 assert.equal(trained.profiles[0].learned.authors[0].mid,'42');
 assert.equal(trained.auto.tags.length,0,'custom feedback does not leak into recent profile');
});
test('calibration fails closed without enough independent labeled cases or a matching model version',()=>{
 const C=require('../renderer/profile-calibration');const value={approved:true,positiveCount:50,negativeCount:50,modelId:'v1',reviewedBy:'reviewer',threshold:.8,totalCount:200,testCount:100,acceptedCount:20,precision:.95,datasetHash:'a'.repeat(64)};
 assert.equal(C.approved(value,'v1'),true);
 for(const patch of [{approved:false},{negativeCount:0},{modelId:'old'},{precision:.94},{acceptedCount:0},{reviewedBy:''},{totalCount:199},{testCount:99},{threshold:NaN}])assert.equal(C.approved({...value,...patch},'v1'),false);
});
test('tokenizer preserves case and punctuation matching the pinned BERT normalizer',()=>{
 const T=require('../renderer/profile-tokenizer');const vocab={'[CLS]':101,'[SEP]':102,'[UNK]':100,'中':1,'文':2,'c':3,'+':4,'#':5};
 assert.deepEqual(T.encode('中文 C++ c#',vocab),[101,1,2,100,4,4,3,5,102]);
 assert.deepEqual(T.encode('中文'.repeat(100),vocab).length,128);
});
test('description and author-rule edits change feed selection but renaming does not',async()=>{
 let disk=R.normalize({profiles:[profile()],activeId:'p'});
 const manager=R.createManager({read:async()=>disk,write:async s=>disk=s,getLikes:()=>[]});await manager.ready();
 await manager.edit({type:'interests',id:'p',patch:{description:'实拍摄影'}});assert.equal(manager.getSnapshot().revision,1);
 await manager.edit({type:'save',id:'p',name:'新名字',tags:disk.profiles[0].tags});assert.equal(manager.getSnapshot().revision,1);
 manager.dispose();
});

test('streamed visual quota carries previous batches and excludes blocked sample owners',()=>{
 const p=profile(['摄影'],{authors:[{mid:'2',mode:'block',at:1}]});
 assert.equal(I.blocked({owner:'2',title:'摄影'},p),true);
 const evidence={BVv:{sampleCount:5,authorCount:2,visualNeighbours:2,visualSimilarity:.97,visualThreshold:.9,visualCalibrated:true}};
 const prior=R.rank(Array.from({length:4},(_,i)=>({bvid:'BVp'+i,title:'摄影'})),p);
 const visual=R.rank([{bvid:'BVv',title:'日常'}],p,[],1,{evidence,prior});
 assert.equal(visual.length,1);assert.equal(visual[0].recommendationVisualOnly,true);
 assert.equal(R.rank([{bvid:'BVv',title:'日常'}],p,[],1,{evidence,prior:[...prior,...visual]}).length,0);
});

test('calibration CLI uses a held-out split and rejects duplicate-content leakage',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'biu-calibration-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const input=path.join(dir,'labels.json'),output=path.join(dir,'report.json');
 const data={kind:'text',reviewedBy:'test fixture',samples:Array.from({length:200},(_,i)=>({id:String(i),group:String(i),split:i<100?'calibration':'test',score:i%2?.9:.2,label:!!(i%2)}))};
 const run=()=>{fs.writeFileSync(input,JSON.stringify(data));return spawnSync(process.execPath,[path.join(__dirname,'../scripts/calibrate-profile.cjs'),input,output],{encoding:'utf8'});};
 assert.equal(run().status,0);
 const report=JSON.parse(fs.readFileSync(output));assert.equal(report.approved,true);assert.equal(report.precision,1);assert.equal(report.testCount,100);
 data.samples[100].group='0';assert.notEqual(run().status,0);
});

test('a calibrated threshold cannot authorize missing or disabled model output',()=>{
 const service=A.create({encode:async()=>[],calibration:{text:{approved:true,threshold:0},image:{approved:true,threshold:0}},status:()=>({text:{enabled:false},image:{enabled:false}})});
 const p=profile(),track={bvid:'BVnotloaded',title:'无关内容'};
 const evidence=service.evidence([track],p)[track.bvid];
 assert.equal(evidence.textCalibrated,false);assert.equal(evidence.visualCalibrated,false);
 assert.equal(I.evaluate(track,p,evidence).eligible,false);service.dispose();
});

test('multimodal matching and learning are discovery-only; homepage keeps its prior rules',()=>{
 const Home=require('../renderer/recommendation-profile');
 const p=profile(['摄影'],{description:'旅行',avoid:['广告']});
 const track={bvid:'BVads',title:'摄影广告',mid:'1'};
 assert.equal(Home.rank([track],p).length,1,'homepage uses the old tag/title rules');
 assert.equal(R.rank([track],p).length,0,'discovery applies its own exclusions');
 assert.equal(Home.rank([{bvid:'BVtravel',title:'旅行日常'}],p).length,0);
 assert.equal(R.rank([{bvid:'BVtravel',title:'旅行日常'}],p).length,1);
 const input={profiles:[p],auto:{evidence:[{bvid:'BVphoto',profileId:'p',title:'摄影',owner:'1',source:'likes',tags:['摄影'],at:Date.now()}]}};
 assert.equal(Home.normalize(input).profiles[0].learned,undefined);
 assert.equal(R.normalize(input).profiles[0].learned.authors[0].mid,'1');
 const analysis={observe(){throw Error('homepage must not use local AI');}};
 const home=Home.createManager({analysis,read:async()=>null,write:async()=>{},getLikes:()=>[]});
 assert.equal(home.analysis,null);home.dispose();
});

test('discovery descriptions accept explicit single-character interests',()=>{
 const p=profile([],{description:'摄影、脚、旅行'});
 assert.deepEqual(I.interests(p).map(t=>t.name),['摄影','脚','旅行']);
 assert.deepEqual(I.terms('脚'),[],'single characters in arbitrary titles are not learned as interests');
});

test('background normalize and sync keep discovery and homepage engines separate',()=>{
 const compute=require('../mobile-rn/scripts/build-compute.cjs');const run=require(compute())();
 const library=require('../renderer/library-sync');
 const p=profile(['摄影']);const input={profiles:[p],auto:{evidence:[{bvid:'BVp',profileId:'p',owner:'2',source:'likes',tags:['摄影'],at:1}]}};
 assert.equal(run('profileNormalize',input,true).profiles[0].learned,undefined);
 const discovery=run('discoveryNormalize',input,true);
 assert.equal(discovery.profiles[0].learned.authors[0].mid,'2');
 const synced=library.normalize({version:1,likes:[],playlists:[],recommendation:require('../renderer/recommendation-profile').normalize(input),discoveryRecommendation:discovery});
 assert.equal(synced.discoveryRecommendation.profiles[0].learned.authors[0].mid,'2');
 assert.equal(synced.recommendation.profiles[0].learned,undefined);
});

test('discovery preference edits do not wait on a background tag request',async()=>{
 let respond;const network=new Promise(r=>respond=r);
 const p=profile();let disk=R.normalize({profiles:[p],activeId:'p'});
 const manager=R.createManager({read:async()=>disk,write:async s=>disk=s,getLikes:()=>[{bvid:'BVwaiting',profileId:'p',title:'摄影',mid:'1'}],get:()=>network});
 await manager.ready();const refresh=manager.refresh(true);
 for(let i=0;i<10&&!manager.getSnapshot().busy;i++)await Promise.resolve();
 assert.equal(manager.getSnapshot().busy,true);
 try{
   await manager.edit({type:'interests',id:'auto',patch:{description:'旅行'}});
   assert.equal(manager.getSnapshot().auto.interests.description,'旅行');
 }finally{respond({status:200,body:JSON.stringify({code:0,data:[{tag_name:'摄影'}]})});await refresh;manager.dispose();}
 assert.equal(disk.auto.interests.description,'旅行','finishing the old request preserves newer preferences');
});
