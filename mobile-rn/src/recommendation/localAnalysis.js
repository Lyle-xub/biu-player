import { analysisInputIdle } from './analysisGate';
import { AppState } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { File, Directory, Paths } from 'expo-file-system';
import { createDownloadResumable, writeAsStringAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import md5 from 'js-md5';
import { resolve as resolveCalibration } from '../../../renderer/profile-calibration';
import calibration from '../../../renderer/profile-calibration.json';
import { create } from '../../../renderer/profile-analysis';
import models from '../../../renderer/profile-models.json';
import { backgroundCompute } from '../performance/backgroundCompute';
const native=requireOptionalNativeModule('BiuProfileAI');
const root=new Directory(Paths.document,'profile-ai');
const vectors=new Directory(root,'vectors');
let flags={}, tokenReady=false, state={}, readyPromise, memoryHold=0, playbackBusy=false;
const listeners=new Set();
const tasks=new Map(), downloads=new Map();
const folder=kind=>new Directory(root,models[kind].id);
const cacheKey=key=>md5(JSON.stringify([models.text.id,models.image.id,key]));
const emit=()=>listeners.forEach(fn=>fn());
async function ready(){
 if(!readyPromise)readyPromise=(async()=>{root.create({idempotent:true,intermediates:true});vectors.create({idempotent:true,intermediates:true});
  try{const saved=JSON.parse(await new File(root,'settings.json').text());flags={text:saved?.text===true,image:saved?.image===true};}catch{}
  const next={};
  for(const kind of ['text','image'])next[kind]={...models[kind],installed:new File(folder(kind),'ready').exists,enabled:!!native&&flags[kind]===true&&new File(folder(kind),'ready').exists};
  state=next;emit();})();
 return readyPromise;
}
async function saveFlags(){await writeAsStringAsync(new File(root,'settings.json').uri,JSON.stringify(flags));}
async function download(kind){
 await ready();if(!native)throw Error('请安装包含本地 AI 模块的新版本');if(tasks.has(kind))return tasks.get(kind);
 const operation=(async()=>{const temporary=new Directory(root,models[kind].id+'.partial');temporary.create({idempotent:true,intermediates:true});
  let downloaded=0;const total=models[kind].files.reduce((n,f)=>n+f.bytes,0);state={...state,[kind]:{...state[kind],progress:0}};emit();
  try{for(const item of models[kind].files){
   const destination=new File(temporary,item.name);
   const task=createDownloadResumable(item.url,destination.uri,{},event=>{state={...state,[kind]:{...state[kind],progress:(downloaded+event.totalBytesWritten)/total}};emit();});
   downloads.set(kind,task);
   let deadline;
   const result=await Promise.race([task.downloadAsync(),new Promise((_,reject)=>{deadline=setTimeout(()=>{task.pauseAsync().catch(()=>{});reject(Error('模型下载超时'));},180000);})]).finally(()=>clearTimeout(deadline));
   if(result?.status!==200||destination.size!==item.bytes||await native.hashFile(destination.uri)!==item.sha256)throw Error('模型下载或校验失败');
   downloaded+=item.bytes;
  }
  await native.release();if(folder(kind).exists)folder(kind).delete();temporary.move(folder(kind));
  await writeAsStringAsync(new File(folder(kind),'ready').uri,'1');flags[kind]=true;await saveFlags();
  state={...state,[kind]:{...models[kind],installed:true,enabled:true}};
  }catch(error){state={...state,[kind]:{...state[kind],progress:undefined,error:error.message}};throw error;}
  finally{downloads.delete(kind);tasks.delete(kind);emit();}
 })();tasks.set(kind,operation);return operation;
}
async function configure({kind,enabled,remove}){
 await ready();if(tasks.has(kind))throw Error('模型正在下载，请稍后操作');
 flags[kind]=enabled===true&&!remove;await saveFlags();await native?.release();
 if(remove&&folder(kind).exists)folder(kind).delete();if(kind==='text'&&remove)tokenReady=false;
 state={...state,[kind]:{...models[kind],installed:new File(folder(kind),'ready').exists,enabled:flags[kind]&&new File(folder(kind),'ready').exists}};analysis.clear();emit();
}
async function encode(kind,input){
 await ready();if(!native||!state[kind]?.enabled||!await native.available())throw Error('设备繁忙或模型未启用');
 let payload;
 if(kind==='text'){
  const tokenizer=tokenReady?undefined:await new File(folder('text'),'tokenizer.json').text();
  payload=JSON.stringify(await backgroundCompute('profileTokenize',input,tokenizer));tokenReady=true;
 }else{
  const url=new URL(input);if(url.protocol!=='https:'||!/(^|\.)hdslb\.com$/i.test(url.hostname))throw Error('封面来源不支持');
  url.pathname=url.pathname.replace(/@[^/]+$/,'')+'@512w_512h_0e.webp';
  const uri=url.toString();let cached=await Image.getCachePathAsync(uri);
  if(!cached){await Image.prefetch(uri,{cachePolicy:'disk',headers:{Referer:'https://www.bilibili.com/'}});cached=await Image.getCachePathAsync(uri);}
  if(!cached)throw Error('封面暂不可用');payload=cached.startsWith('file:')?cached:'file://'+cached;
 }
 return JSON.parse(await native.encode(kind,new File(folder(kind),models[kind].files[0].name).uri,payload));
}
let lastPrune=0;
export const analysis=create({calibration:resolveCalibration(calibration,models),encode,status:()=>state,canRun:()=>AppState.currentState==='active'&&analysisInputIdle()&&!playbackBusy&&Date.now()>memoryHold,
 read:async key=>{await ready();try{return JSON.parse(await new File(vectors,cacheKey(key)+'.json').text());}catch{return null;}},
 write:async(key,value)=>{await writeAsStringAsync(new File(vectors,cacheKey(key)+'.json').uri,JSON.stringify(value));
  if(Date.now()-lastPrune>60000){lastPrune=Date.now();await native?.trimCache(vectors.uri,2000);}
 }});
export const setAnalysisPlaybackBusy=busy=>{playbackBusy=busy;if(busy)analysis.pause(1500);};
export const pauseAnalysis=()=>analysis.pause(1500);
AppState.addEventListener('change',value=>{if(value!=='active'){analysis.pause(2000);native?.release().catch(()=>{});}});
AppState.addEventListener('memoryWarning',()=>{memoryHold=Date.now()+60000;analysis.clear();native?.release().catch(()=>{});});
export const modelManager={ready,download,configure,async cancel(kind){await downloads.get(kind)?.pauseAsync();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>state,
 async clear(){await ready();analysis.clear();await analysis.flush();await native?.trimCache(vectors.uri,0);}};
