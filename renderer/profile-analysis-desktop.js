(function(root){
  let state={}, loading;const listeners=new Set();
  const call=(method,args)=>root.bili?.profileAI?root.bili.profileAI(method,args):Promise.reject(Error('请在新版桌面应用中使用本地 AI'));
  const notify=()=>listeners.forEach(fn=>fn());
  async function ready(){if(!loading)loading=call('status').then(v=>{state=v;notify();}).catch(()=>{});return loading;}
  const create = typeof module==='object' && module.exports ? require('./profile-analysis').create : root.BiuProfileAnalysis.create;
  const calibration = typeof module==='object'&&module.exports ? require('./profile-calibration').resolve(require('./profile-calibration.json'),require('./profile-models.json')) : {};
  const analysis=create({calibration,status:()=>state,encode:(kind,input)=>call('encode',{kind,input}),
    canRun:()=>{const audio=root.document.querySelector('audio');return !root.document.hidden && !(audio&&!audio.paused&&audio.readyState<3);},
    read:key=>call('cache',{key}),write:(key,value)=>call('cache',{key,value})});
  const models={ready,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>state,
    async download(kind){const timer=setInterval(()=>call('status').then(v=>{state=v;notify();}).catch(()=>{}),1000);
      try{state=await call('download',kind);notify();}finally{clearInterval(timer);await call('status').then(v=>{state=v;notify();}).catch(()=>{});}},
    async cancel(kind){await call('cancel',kind);},
    async configure(args){state=await call('configure',args);analysis.clear();notify();},
    async clear(){analysis.clear();await analysis.flush();await call('clear');}};
  root.document.addEventListener('pointerdown',()=>analysis.pause(1000),{passive:true});
  root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)analysis.pause(5000);});
  root.BiuLocalAnalysis={analysis,models};
})(typeof window==='object'?window:this);
