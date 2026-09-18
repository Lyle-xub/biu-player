const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const models=require('./renderer/profile-models.json'), tokenizer=require('./renderer/profile-tokenizer');
const calibration=require('./renderer/profile-calibration').resolve(require('./renderer/profile-calibration.json'),models);
const root=workerData.directory, flags={text:false,image:false}, progress={}, downloads=new Map();
let session,sessionKind,vocab,busy=Promise.resolve();
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const folder=k=>path.join(root,models[k].id);
const valid=k=>{if(!Object.hasOwn(models,k))throw Error('未知模型');};
const ready=fs.mkdir(root,{recursive:true}).then(()=>fs.readFile(path.join(root,'settings.json'),'utf8').then(s=>Object.assign(flags,JSON.parse(s))).catch(()=>{}));
async function status(){await ready;const out={};for(const k of Object.keys(models)){const installed=await fs.access(path.join(folder(k),'ready')).then(()=>true,()=>false);out[k]={...models[k],calibration:calibration[k],installed,enabled:installed&&flags[k]===true,progress:progress[k]};}return out;}
async function download(k){
 valid(k);await ready;if(progress[k]!==undefined)return status();const controller=new AbortController();downloads.set(k,controller);progress[k]=0;
 const tmp=folder(k)+'.partial';await fs.mkdir(tmp,{recursive:true});
 try {let done=0,total=models[k].files.reduce((n,f)=>n+f.bytes,0);
 for(const file of models[k].files){
  const response=await fetch(file.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(180000)])});if(!response.ok)throw Error('模型下载失败：'+response.status);
  const handle=await fs.open(path.join(tmp,file.name),'w'),hash=crypto.createHash('sha256');let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>file.bytes)throw Error('模型大小校验失败');await handle.write(chunk);hash.update(chunk);progress[k]=(done+size)/total;}}
  finally{await handle.close();}
  if(size!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('模型校验失败');done+=size;
 }
 await fs.writeFile(path.join(tmp,'ready'),'1');await fs.rm(folder(k),{recursive:true,force:true});await fs.rename(tmp,folder(k));flags[k]=true;
 await fs.writeFile(path.join(root,'settings.json'),JSON.stringify(flags));
 }finally{downloads.delete(k);delete progress[k];await fs.rm(tmp,{recursive:true,force:true});}return status();
}
async function configure({kind,enabled,remove}){valid(kind);await ready;if(downloads.has(kind))throw Error('请先取消模型下载');flags[kind]=enabled===true&&!remove;await fs.writeFile(path.join(root,'settings.json'),JSON.stringify(flags));
 if(sessionKind===kind && !flags[kind]){await session?.release();session=null;sessionKind=null;}
 if(remove)await fs.rm(folder(kind),{recursive:true,force:true});return status();}
async function encode({kind,input}){
 valid(kind);if(!(await status())[kind].enabled)throw Error('模型未启用');
 const ort=require('onnxruntime-node');
 if(sessionKind!==kind){await session?.release();session=null;sessionKind=null;session=await ort.InferenceSession.create(path.join(folder(kind),models[kind].files[0].name),{intraOpNumThreads:1,interOpNumThreads:1,executionMode:'sequential'});sessionKind=kind;}
 let feeds;
 if(kind==='text'){
  vocab ||=JSON.parse(await fs.readFile(path.join(folder(kind),'tokenizer.json'),'utf8')).model.vocab;
  const ids=tokenizer.encode(input,vocab);
  feeds=Object.fromEntries(session.inputNames.map(name=>[name,new ort.Tensor('int64',BigInt64Array.from(ids.map(v=>BigInt(name==='input_ids'?v:name==='attention_mask'?1:0))),[1,ids.length])]));
 }else{
  const url=new URL(input);if(url.protocol!=='https:'||!/(^|\.)hdslb\.com$/i.test(url.hostname))throw Error('封面来源不支持');
  url.pathname=url.pathname.replace(/@[^/]+$/,'')+'@512w_512h_0e.webp';
  const response=await fetch(url,{headers:{Referer:'https://www.bilibili.com/'},signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('封面暂不可用');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('封面过大');chunks.push(chunk);}
  const sharp=require('sharp');const bytes=await sharp(Buffer.concat(chunks),{limitInputPixels:16000000}).rotate().resize(256,256,{fit:'cover',position:'centre',kernel:'linear'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
  let sum=0,squares=0;for(let i=0;i<bytes.length;i+=3){const x=(bytes[i]+bytes[i+1]+bytes[i+2])/765;sum+=x;squares+=x*x;}if(squares/65536-(sum/65536)**2<.0001)throw Error('封面缺少可识别内容');
  const values=new Float32Array(3*256*256),mean=[.48145466,.4578275,.40821073],std=[.26862954,.26130258,.27577711];
  for(let i=0;i<256*256;i++)for(let c=0;c<3;c++)values[c*256*256+i]=(bytes[i*3+c]/255-mean[c])/std[c];
  feeds={pixel_values:new ort.Tensor('float32',values,[1,3,256,256])};
 }
 const result=await session.run(feeds),values=Array.from(result[session.outputNames[0]].data.slice(0,512));
 const norm=Math.sqrt(values.reduce((n,v)=>n+v*v,0));if(!norm||values.some(v=>!Number.isFinite(v)))throw Error('模型输出无效');return values.map(v=>v/norm);
}
const cacheFolder=path.join(root,'vectors');
async function cache({key,value}){if(typeof key!=='string'||key.length>10000)throw Error('缓存键无效');await fs.mkdir(cacheFolder,{recursive:true});const file=path.join(cacheFolder,digest(JSON.stringify([models.text.id,models.image.id,key]))+'.json');
 if(value===undefined)return fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
 if(!Array.isArray(value)||value.length!==512||value.some(v=>!Number.isFinite(v)))return;
 await fs.writeFile(file,JSON.stringify(value));const entries=await fs.readdir(cacheFolder);if(entries.length>2000){const stats=await Promise.all(entries.map(async name=>({name,at:(await fs.stat(path.join(cacheFolder,name))).mtimeMs})));for(const item of stats.sort((a,b)=>a.at-b.at).slice(0,entries.length-2000))await fs.unlink(path.join(cacheFolder,item.name));}
}
parentPort.on('message',({id,method,args})=>{
 const run=async()=>{try{let value;
 if(method==='status')value=await status();else if(method==='download')value=await download(args);else if(method==='cancel'){downloads.get(args)?.abort();value=true;}else if(method==='configure')value=await configure(args);else if(method==='encode')value=await encode(args);else if(method==='cache')value=await cache(args);else if(method==='clear'){await fs.rm(cacheFolder,{recursive:true,force:true});value=true;}else throw Error('未知分析操作');parentPort.postMessage({id,value});
 }catch(error){parentPort.postMessage({id,error:error.message});}};
 if(method==='status'||method==='download'||method==='cancel')run();else busy=busy.catch(()=>{}).then(run);
});
