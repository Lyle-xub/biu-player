const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createVideoCloudSync}=require('../video-cloud-sync');
const {descriptor,parseDescriptor,createBiliVideoApi}=require('../cloud-video-bili');
const {normalize}=require('../renderer/library-sync');
const lib=ids=>({version:1,likes:ids.map(i=>({bvid:'BV'+i,title:'Song '+i})),playlists:[]});
function backend(){
  let archive=null, ready=true, count=0, edits=0;const data=new Map();
  return {
    data,get archive(){return archive;},get count(){return count;},get edits(){return edits;},set ready(v){ready=v;},
    api:{list:async()=>archive?[structuredClone(archive)]:[],streams:async()=>{if(!ready)throw Error('review');return {'360p':{url:'https://cdn.bilivideo.com/a',height:360},'480p':{url:'https://cdn.bilivideo.com/b',height:480}};},
      submit:async({meta,existing})=>{if(existing)edits++;else count++;const part={...meta,filename:'file'+meta.sequence};const parts=[part,...(archive?.meta.parts || []).filter(p=>p.slot!==meta.slot)];archive={bvid:'BVshared',aid:123,meta:{...meta,parts},desc:'signed'};return structuredClone(archive);}},
    runtime:{ensure:async()=>{},run:async(req,signal,event)=>{if(signal.aborted)throw Error('aborted');if(req.operation==='encode'){const id=crypto.randomBytes(16).toString('hex');data.set(id,req.library);return {snapshotId:id};}fs.mkdirSync(path.dirname(req.output),{recursive:true});fs.writeFileSync(req.output,JSON.stringify(data.get(req.snapshotId)));event({type:'symbol',symbols:7,needed:7});return {passed:true};}}
  };
}
function device(t,b,initial=lib([1])) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'biu-cloud-'));let library=normalize(initial),account='123';
  const service=createVideoCloudSync({directory,api:b.api,runtime:b.runtime,auth:async()=>({isLogin:true,mid:account}),readLibrary:()=>library,writeLibrary:(_,value)=>{library=value;},protect:s=>'protected:'+s,unprotect:s=>s.slice(10)});
  t.after(()=>{service.stop();fs.rmSync(directory,{recursive:true,force:true});});
  return {service,directory,get library(){return library;},set library(v){library=normalize(v);},set account(v){account=v;}};
}
test('default off; intervals persist; import shares one BV, next writes edit and retain two parts',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');assert.equal(a.service.status().enabled,false);
  await a.service.configure({enabled:true,intervalHours:24});await a.service.run();assert.equal(b.count,1);
  const c=device(t,b,lib([2]));await c.service.setAccount('123');await c.service.importRecovery(a.service.exportRecovery());
  assert.equal(c.service.status().enabled,false);await c.service.configure({enabled:true});await c.service.run();
  assert.equal(b.count,1);assert.equal(b.edits,1);assert.equal(b.archive.meta.parts.length,2);
  assert.deepEqual(c.library.likes.map(x=>x.bvid),['BV2','BV1']);
  a.library=lib([1,3]);await a.service.run();assert.equal(b.count,1);assert.equal(b.edits,2);assert.equal(b.archive.meta.parts.length,2);
  assert.deepEqual(new Set(a.library.likes.map(x=>x.bvid)),new Set(['BV1','BV2','BV3']));
  await a.service.configure({enabled:false});await assert.rejects(a.service.run(),/未开启/);
  const disk=JSON.parse(fs.readFileSync(path.join(a.directory,'123/state.json')));assert.equal(disk.intervalHours,24);assert.equal(disk.enabled,false);
});
test('pending verification survives restart and never resubmits',async t=>{
  const b=backend(),a=device(t,b);b.ready=false;await a.service.setAccount('123');await a.service.configure({enabled:true});await a.service.run();
  assert.equal(a.service.status().pending,true);assert.equal(a.service.status().lastSync,0);await a.service.run();assert.equal(b.count,1);
  await a.service.setAccount('');await a.service.setAccount('123');b.ready=true;await a.service.run();
  assert.equal(b.count,1);assert.equal(a.service.status().pending,false);assert.ok(a.service.status().lastSync);
});
test('loading a video preview does not upload or decode the library',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});await a.service.run();
  a.service.stop();
  const uploads=b.count+b.edits,library=structuredClone(a.library);
  b.runtime.run=async()=>{throw Error('preview must not start the codec');};
  assert.equal(await a.service.loadPreview(),'https://cdn.bilivideo.com/a');
  assert.equal(b.count+b.edits,uploads);assert.deepEqual(a.library,library);
  await a.service.setAccount('');assert.equal(await a.service.loadPreview(),'');
});
test('wrong account and unsupported intervals rejected without writing',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await assert.rejects(a.service.configure({intervalHours:1}),/间隔/);
  a.account='456';await assert.rejects(a.service.configure({enabled:true}),/对应/);assert.equal(b.count,0);
});
test('recovery receiver cannot create a second video before original device publishes',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});a.service.stop();
  const c=device(t,b);await c.service.setAccount('123');await c.service.importRecovery(a.service.exportRecovery());await c.service.configure({enabled:true});
  await assert.rejects(c.service.run(),/原设备/);assert.equal(b.count,0);
});
test('read-only restore never uploads; insufficient/corrupt decode does not replace library',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});await a.service.run();
  const c=device(t,b,lib([2]));await c.service.setAccount('123');await c.service.importRecovery(a.service.exportRecovery());
  b.runtime.run=async()=>{throw Error('corrupt');};await assert.rejects(c.service.run(true),/无法恢复/);assert.equal(c.library.likes[0].bvid,'BV2');assert.equal(b.count,1);assert.equal(b.edits,0);
});
test('signed index prevents tampering and validates two-part structure',()=>{
  const key=crypto.randomBytes(32),part={slot:'A',snapshotId:'a'.repeat(32),filename:'valid_file',sequence:1};
  const meta={version:2,channel:'b'.repeat(16),device:'test-device',...part,parts:[part]};
  const signed=descriptor(meta,key);assert.deepEqual(parseDescriptor(signed,key),meta);
  assert.equal(parseDescriptor(signed,crypto.randomBytes(32)),null);
  assert.equal(parseDescriptor(descriptor({...meta,parts:[part,part]},key),key),null);
});
test('creator API uses shared aid and preserves previous P, no key/CSRF in returned persisted data',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'biu-uploader-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'video.mp4');fs.writeFileSync(file,'video');
  const key=crypto.randomBytes(32),part={slot:'A',snapshotId:'a'.repeat(32),filename:'oldfile',sequence:1,device:'device-one'};
  const meta={version:2,channel:'b'.repeat(16),...part,parts:[part]};const old={aid:123,bvid:'BVshared',cover:'cover',meta,desc:descriptor(meta,key)};
  let submitted;
  const api=createBiliVideoApi({csrf:async()=>'csrf-secret',coverFile:file,uploadFetch:async(_url,options)=>new Response(JSON.stringify(options.method==='POST'?{upload_id:'id',OK:1}:{})),
    request:async(url,opts)=>{
      if(url.includes('/preupload'))return Response.json({chunk_size:65536,auth:'upload-secret',endpoint:'//upos.bilivideo.com',upos_uri:'upos://bucket/newfile.mp4',biz_id:1});
      if(url.includes('/archives?'))return Response.json({code:0,data:{page:{ps:20,count:1},arc_audits:[{Archive:old}]}});
      if(url.includes('/edit?')){submitted=JSON.parse(opts.body);return Response.json({code:0,data:{bvid:'BVshared',aid:123}});}
      throw Error(url);
    }});
  const next={...meta,slot:'B',sequence:2,snapshotId:'c'.repeat(32)};delete next.parts;
  const result=await api.submit({file,meta:next,key,existing:old,emit:()=>{},signal:new AbortController().signal});
  assert.equal(submitted.aid,123);assert.equal(submitted.is_only_self,1);assert.equal(submitted.videos.length,2);assert.equal(submitted.videos[1].filename,'oldfile');
  assert.doesNotMatch(JSON.stringify(result),/csrf-secret|upload-secret/);assert.equal(result.bvid,'BVshared');
});
test('missing known archive never creates another submission',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});await a.service.run();
  b.api.list=async()=>[];a.library=lib([1,2]);await assert.rejects(a.service.run(),/不会另建/);assert.equal(b.count,1);
});
test('disable aborts an active encoder before publishing and persists disabled state',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});
  let started;const ready=new Promise(r=>started=r);
  b.runtime.run=async(_req,signal)=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});started();});
  const job=a.service.run();const rejected=assert.rejects(job,/aborted/);await ready;
  await a.service.configure({enabled:false});await rejected;assert.equal(b.count,0);assert.equal(a.service.status().busy,false);assert.equal(a.service.status().enabled,false);
});
test('scheduled unchanged sync skips upload; explicit refresh edits the same BV',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});await a.service.run();
  await a.service.run();assert.equal(b.edits,0);await a.service.run(false,true);assert.equal(b.edits,1);assert.equal(b.count,1);assert.equal(b.archive.meta.parts.length,2);
});
test('corrupt next-account state cannot retain or export the previous account key',async t=>{
  const b=backend(),a=device(t,b);await a.service.setAccount('123');await a.service.configure({enabled:true});a.service.stop();
  fs.mkdirSync(path.join(a.directory,'456'));fs.writeFileSync(path.join(a.directory,'456/state.json'),'invalid');
  a.account='456';await assert.rejects(a.service.setAccount('456'),/损坏/);assert.equal(a.service.status().hasKey,false);assert.equal(a.service.status().enabled,false);
  assert.throws(()=>a.service.exportRecovery(),/尚未/);await assert.rejects(a.service.configure({enabled:true}),/损坏/);
});

test('background pause aborts current work without disabling the account or restarting its timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const b=backend(),a=device(t,b);let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const original=b.runtime.run;
  b.runtime.run=async(req,signal,event)=>{entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('paused')),{once:true}));};
  await a.service.setAccount('123');await a.service.configure({enabled:true});
  const running=a.service.run();await started;a.service.stop();await assert.rejects(running,/paused/);
  b.runtime.run=original;t.mock.timers.tick(24*3600000);await Promise.resolve();await Promise.resolve();
  assert.equal(a.service.status().busy,false);assert.equal(a.service.status().enabled,true);assert.equal(b.count,0);
  a.service.resume();await a.service.run();assert.equal(b.count,1);
});
