const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createLanSync}=require('../lan-sync');
const {createVideoCloudSync}=require('../video-cloud-sync');
const library={version:1,likes:[],playlists:[]};
async function cloud(t,hasKey=false) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'biu-lan-key-'));
  let authenticate=async()=>({isLogin:true,mid:'123'});
  const service=createVideoCloudSync({directory,api:{},runtime:{},readLibrary:()=>library,writeLibrary(){},
    auth:()=>authenticate(),protect:key=>'protected:'+key,unprotect:ref=>ref.slice(10)});
  t.after(()=>{service.stop();fs.rmSync(directory,{recursive:true,force:true});});
  await service.setAccount('123');
  if(hasKey){await service.configure({enabled:true});service.stop();}
  return {service,setAuth:fn=>{authenticate=fn;}};
}
for(const fromDesktop of [true,false])test(`encrypted LAN key transfer ${fromDesktop?'desktop to phone':'phone to desktop'} preserves switches and account isolation`,async t=>{
  const {syncLanCloudKey}=await import('../mobile-rn/src/cloud/lanKeyExchange.js');
  const desktop=(await cloud(t,fromDesktop)).service,phone=(await cloud(t,!fromDesktop)).service;
  const original=(fromDesktop?desktop:phone).exportRecovery();
  let advertisement;
  const server=createLanSync({host:'127.0.0.1',deviceId:'desktop-test',readLibrary:()=>library,writeLibrary(){},
    cloudKeyStatus:scope=>desktop.lanKeyStatus(scope),exchangeCloudKey:(value,scope,active)=>desktop.exchangeLanRecovery(value,scope,active),
    publish:options=>{advertisement=options;return()=>{};}});
  t.after(()=>server.stop());await server.configure('123',true);
  const request=async(peer,scope,route,body,signal)=>{
    assert.ok(!JSON.stringify(body || {}).includes(original.key),'recovery key must not appear in cleartext HTTP');
    const response=await fetch(`http://127.0.0.1:${advertisement.port}/v2/${route}`,{method:body?'POST':'GET',signal,
      headers:{Authorization:'Bearer '+advertisement.txt.token,'X-Biu-Account':scope},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!response.ok)throw Error(value.error);return value;
  };
  const remote=await request(null,'123','status');
  assert.ok(!JSON.stringify(remote).includes(original.key));assert.ok(!JSON.stringify(advertisement).includes(original.key));
  const args={peer:{id:'desktop-test'},scope:'123',clientId:'phone-test',remote:remote.cloudKey,local:phone.lanKeyStatus('123'),
    exchange:(value,scope,active)=>phone.exchangeLanRecovery(value,scope,active),request,randomBytes:crypto.randomBytes};
  assert.equal(await syncLanCloudKey(args),'synced');
  assert.equal(desktop.exportRecovery().key,original.key);assert.equal(phone.exportRecovery().key,original.key);
  assert.equal(desktop.status().enabled,fromDesktop);assert.equal(phone.status().enabled,!fromDesktop);
  assert.equal(await syncLanCloudKey({...args,local:phone.lanKeyStatus('123'),remote:(await request(null,'123','status')).cloudKey}),null);
  await assert.rejects(request(null,'456','status'),/账号不同/);
  // Ciphertext corruption must be rejected before the receiver's key callback.
  await assert.rejects(syncLanCloudKey({...args,remote:(await request(null,'123','status')).cloudKey,local:{channel:''},exchange:()=>{throw Error('should not import');},
    request:async(...params)=>{const value=await request(...params);value.ciphertext=(parseInt(value.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,'0')+value.ciphertext.slice(2);return value;}}));
  await server.configure('123',false);await assert.rejects(request(null,'123','status'));
});

test('automatic key import preserves a configured key and rechecks logout/opt-out after authentication',async t=>{
  const a=await cloud(t,true),b=await cloud(t,true),empty=await cloud(t);
  const before=b.service.exportRecovery();
  assert.equal((await b.service.exchangeLanRecovery(a.service.exportRecovery(),'123')).conflict,true);
  assert.deepEqual(b.service.exportRecovery(),before);
  await assert.rejects(empty.service.exchangeLanRecovery({...before,account:'456'},'123'),/账号/);
  await assert.rejects(empty.service.exchangeLanRecovery({...before,channel:'bad'},'123'),/校验/);
  let resolveAuth,active=true;
  empty.setAuth(()=>new Promise(resolve=>{resolveAuth=resolve;}));
  const pending=empty.service.exchangeLanRecovery(before,'123',()=>active);
  active=false;resolveAuth({isLogin:true,mid:'123'});
  await assert.rejects(pending,/取消/);assert.equal(empty.service.status().hasKey,false);
  const switched=empty.service.exchangeLanRecovery(before,'123');
  await empty.service.setAccount('456');resolveAuth({isLogin:true,mid:'123'});
  await assert.rejects(switched,/取消/);assert.equal(empty.service.status().hasKey,false);
});

test('an idle mobile library still receives a newly created desktop cloud key',async t=>{
  const root=path.resolve(__dirname,'../mobile-rn'),fromMobile=name=>require(require.resolve(name,{paths:[root]}));
  const filename=path.join(root,'src/store/lanSync.js');
  const {code}=fromMobile('@babel/core').transformSync(fs.readFileSync(filename,'utf8'),{filename,configFile:false,babelrc:false,plugins:[fromMobile('@babel/plugin-transform-modules-commonjs')]});
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name.startsWith('.')?require(path.resolve(path.dirname(filename),name)):fromMobile(name),module,module.exports);
  const {startAutoSync}=module.exports,{syncLanCloudKey}=await import('../mobile-rn/src/cloud/lanKeyExchange.js');
  const desktop=(await cloud(t)).service,phone=(await cloud(t)).service;
  let advertisement,applies=0,connected,received;
  const firstSync=new Promise(resolve=>{connected=resolve;}),keySync=new Promise(resolve=>{received=resolve;});
  const server=createLanSync({host:'127.0.0.1',deviceId:'desktop-test',interfaces:()=>[{address:'127.0.0.1'}],readLibrary:()=>library,writeLibrary(){},
    cloudKeyStatus:scope=>desktop.lanKeyStatus(scope),exchangeCloudKey:(value,scope,active)=>desktop.exchangeLanRecovery(value,scope,active),
    publish:options=>{advertisement=options;return()=>{};}});
  t.after(()=>server.stop());await server.configure('123',true);
  class Discovery extends require('node:events').EventEmitter {
    scan(){queueMicrotask(()=>this.emit('resolved',{...advertisement,addresses:['127.0.0.1']}));}
    stop(){} removeDeviceListeners(){}
  }
  const disk=new Map();
  const stop=startAutoSync({scope:'123',clientId:'phone-test',discovery:new Discovery(),interval:20,
    storage:{getItem:async key=>disk.get(key),setItem:async(key,value)=>disk.set(key,value)},
    getLibrary:()=>library,applyLibrary:()=>{applies++;},
    syncCloudKey:(peer,scope,remote,clientId,signal,request)=>syncLanCloudKey({peer,scope,remote,clientId,signal,request,
      local:phone.lanKeyStatus(scope),exchange:(value,account,active)=>phone.exchangeLanRecovery(value,account,active),randomBytes:crypto.randomBytes}),
    onStatus:state=>{if(state.connected)connected();if(phone.status().hasKey)received();}});
  t.after(stop);
  const timeout=setTimeout(()=>{stop();received();connected();},2000);t.after(()=>clearTimeout(timeout));
  await firstSync;assert.equal(applies,1);assert.equal(phone.status().hasKey,false);
  await desktop.configure({enabled:true});desktop.stop();
  await keySync;assert.equal(phone.exportRecovery().key,desktop.exportRecovery().key);
  assert.equal(applies,1,'key-only changes do not resend unchanged libraries');
  stop();
});
