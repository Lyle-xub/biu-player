const {Worker}=require('node:worker_threads');
const path=require('node:path');
module.exports=function createProfileAI(directory){
 let worker,next=0;const pending=new Map();
 return {call(method,args){
  if(!['status','download','cancel','configure','encode','cache','clear'].includes(method))return Promise.reject(Error('未知分析操作'));
  if(!worker){worker=new Worker(path.join(__dirname,'profile-ai-worker.cjs'),{workerData:{directory}});
   worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.value);}});
   const owned=worker;
   const fail=()=>{if(worker!==owned)return;pending.forEach(p=>{clearTimeout(p.timer);p.reject(Error('本地分析已停止'));});pending.clear();worker=null;};worker.on('error',fail);worker.on('exit',fail);
  }
  return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('本地分析超时'));},method==='download'?600000:30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,method,args});});
 },close(){worker?.terminate();}};
};
