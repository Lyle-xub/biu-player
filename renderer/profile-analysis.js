/* A bounded, serial, best-effort queue. Feed callers never await model work. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./profile-interest'));
  else root.BiuProfileAnalysis=factory(root.BiuProfileInterest);
})(typeof window==='object'?window:this,function(I){
  function create({encode, read=async()=>null, write=async()=>{}, status=()=>({}), canRun=()=>true, calibration={}}) {
    const cache=new Map(), queue=new Map(), listeners=new Set();
    let currentKind, consecutive=0, running=false, timer, closed=false, epoch=0, pauseUntil=0, lastError='', writing=Promise.resolve();
    const id=(kind,input)=>JSON.stringify([kind,input]);
    const publish=()=>listeners.forEach(fn=>fn());
    const enqueue=(kind,input)=> {
      if(!input || closed || !status()[kind]?.enabled) return;
      const key=id(kind,input); if(cache.has(key)||queue.has(key))return;
      queue.set(key,{kind,input,key}); while(queue.size>200)queue.delete(queue.keys().next().value);
      schedule();
    };
    const schedule=()=>{if(!running&&!timer&&!closed&&queue.size){timer=setTimeout(()=>{timer=null;drain();},100);timer.unref?.();}};
    async function drain(){
      if(running||closed)return;
      if(!canRun()||Date.now()<pauseUntil){timer=setTimeout(()=>{timer=null;schedule();},1000);timer.unref?.();return;}
      const candidates=[...queue.values()];
      const next=(consecutive<8 && candidates.find(v=>v.kind===currentKind)) || candidates.find(v=>v.kind!==currentKind) || candidates[0];if(!next)return;
      if(next.kind===currentKind)consecutive++;else{currentKind=next.kind;consecutive=1;}
      queue.delete(next.key); if(!status()[next.kind]?.enabled){schedule();return;}
      running=true; const generation=epoch, started=Date.now();
      try{
        let v=await read(next.key);
        if(!Array.isArray(v)||v.length!==512||v.some(x=>!Number.isFinite(x)))v=await encode(next.kind,next.input);
        if(generation!==epoch||closed)return;
        if(!Array.isArray(v)||v.length!==512||v.some(x=>!Number.isFinite(x)))throw Error('模型输出无效');
        cache.set(next.key,v);while(cache.size>2000)cache.delete(cache.keys().next().value);
        writing=writing.catch(()=>{}).then(()=>generation===epoch&&!closed?write(next.key,v):undefined).catch(()=>{});
        lastError='';
      }catch(e){lastError=e.message||'本地分析暂不可用';pauseUntil=Date.now()+30000;}
      finally{running=false;pauseUntil=Math.max(pauseUntil,Date.now()+Math.min(2000,Math.max(100,(Date.now()-started)*4)));publish();schedule();}
    }
    function seeds(profile){
      const removed=new Set((profile.interests?.removedSamples||[]).map(s=>s.bvid));
      return (profile.learned?.samples||[]).filter(s=>s.at>(profile.interests?.visualResetAt||0)&&!removed.has(s.bvid)&&!I.blocked(s,profile)
        &&(profile.id==='auto'||I.evaluate(s,profile).eligible)).slice(0,30);
    }
    function observe(items,profile){
      I.interests(profile).slice(0,8).forEach(t=>enqueue('text',t.name));
      (profile.interests?.avoid||[]).slice(0,30).forEach(t=>enqueue('text',t));
      seeds(profile).forEach(s=>{enqueue('text',s.title);if(profile.interests?.visualEnabled!==false)enqueue('image',s.pic);});
      for(const t of items.slice(0,32)){enqueue('text',t.title);if(profile.interests?.visualEnabled!==false)enqueue('image',t.pic);}
    }
    function evidence(items,profile){
      const active=status(), examples=seeds(profile);
      const textCalibration=calibration.text||active.text?.calibration, imageCalibration=calibration.image||active.image?.calibration;
      const vectors=[...new Map(examples.map(s=>[s.pic,s])).values()].map(s=>({s,v:cache.get(id('image',s.pic))})).filter(x=>x.v);
      const queries=I.interests(profile).slice(0,8).map(t=>cache.get(id('text',t.name))).filter(Boolean);
      const negatives=(profile.interests?.avoid||[]).map(t=>cache.get(id('text',t))).filter(Boolean);
      const out={};
      for(const t of items){
        const tv=active.text?.enabled&&cache.get(id('text',t.title)), iv=active.image?.enabled&&cache.get(id('image',t.pic));
        const neighbours=iv?vectors.filter(x=>x.s.bvid!==t.bvid).map(x=>({mid:x.s.owner,similarity:I.cosine(iv,x.v)})).sort((a,b)=>b.similarity-a.similarity):[];
        const visualThreshold=imageCalibration?.threshold??Infinity;
        out[t.bvid]={textSimilarity:tv?Math.max(0,...queries.map(v=>I.cosine(tv,v))):0,
          textCalibrated:!!tv&&queries.length>0&&textCalibration?.approved===true,textThreshold:textCalibration?.threshold??Infinity,
          visualSimilarity:neighbours[1]?.similarity||0,visualCalibrated:!!iv&&imageCalibration?.approved===true,visualThreshold,
          visualNeighbours:neighbours.filter(n=>n.similarity>=visualThreshold).length,
          conflict:!!tv&&textCalibration?.approved===true&&negatives.some(v=>I.cosine(tv,v)>=textCalibration.threshold),
          sampleCount:vectors.length,authorCount:new Set(vectors.map(x=>x.s.owner).filter(v=>/^[1-9]\d{0,19}$/.test(v||''))).size};
      }
      return out;
    }
    return {observe,evidence,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
      getState:()=>({running,pending:queue.size,error:lastError}),
      pause(ms=1500){pauseUntil=Math.max(pauseUntil,Date.now()+ms);},
      clear(){epoch++;cache.clear();queue.clear();publish();},
      flush:()=>writing,
      dispose(){closed=true;epoch++;clearTimeout(timer);queue.clear();cache.clear();listeners.clear();}};
  }
  return {create};
});
