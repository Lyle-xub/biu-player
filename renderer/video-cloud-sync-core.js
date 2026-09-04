/* Shared cloud protocol; platform adapters supply storage and cryptography. */
module.exports = function ({ fs, path, crypto, Buffer }) {
const { normalize, reconcile } = require('./library-sync');
const INTERVALS = [3,6,12,24];
const fingerprint = v => crypto.createHash('sha256').update(JSON.stringify(normalize(v))).digest('hex');
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700});
  fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});
  fs.renameSync(file+'.tmp',file);
}
function createVideoCloudSync({ directory, api, runtime, auth, readLibrary, writeLibrary, protect, unprotect, onStatus=()=>{}, now=Date.now }) {
  let scope='', config=null, running=null, controller=null, timer=null, logs=[], progress={}, preview='', decoded='', error='', paused=false;
  const fileFor = s => path.join(directory,s,'state.json');
  function load(s) {
    const file=fileFor(s);
    if (!fs.existsSync(file)) return {enabled:false,intervalHours:3,device:crypto.randomUUID(),heads:{},slots:{},sequence:0,lastSync:0,nextRun:0};
    try {
      const value=JSON.parse(fs.readFileSync(file));
      if (!INTERVALS.includes(value.intervalHours) || !value.device || !value.heads || !value.slots) throw Error();
      return value;
    } catch { throw new Error('云同步配置损坏，请从恢复文件恢复密钥；不会自动覆盖原配置'); }
  }
  const save = () => atomic(fileFor(scope),config);
  function trimVideoCache() {
    const root=path.join(directory,scope,'snapshots');
    try {
      const folders=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory() && /^[a-f0-9-]{36}$/.test(d.name))
        .map(d=>({path:path.join(root,d.name),time:fs.statSync(path.join(root,d.name)).mtimeMs})).sort((a,b)=>b.time-a.time);
      for(const old of folders.slice(3))if(old.path!==config?.pending?.folder)fs.rmSync(old.path,{recursive:true,force:true});
    } catch { /* Cache cleanup must not change a verified sync result. */ }
  }
  function remember(snapshotId, library) {
    config.history ||= {};
    delete config.history[snapshotId];config.history[snapshotId]=library;
    const ids=Object.keys(config.history);while(ids.length>8)delete config.history[ids.shift()];
  }
  const key = () => Buffer.from(unprotect(config.secret),'hex');
  function status() {
    return {scope,signedIn:!!scope,enabled:!!config?.enabled,intervalHours:config?.intervalHours || 3,busy:!!running,
      lastSync:config?.lastSync || 0,nextRun:config?.nextRun || 0,hasKey:!!config?.secret,
      bvid:config?.pending?.archive.bvid || config?.activeBvid || '',pending:!!config?.pending,
      preview,decoded,error,progress,logs:logs.slice(-140)};
  }
  const publish = () => onStatus(status());
  function emit(event) {
    const labels={setup:event.message,encode:event.message || `生成网格 ${event.frames}/${event.total}`,upload:`上传 ${event.bytes}/${event.total} 字节`,
      download:`读取 ${event.bytes}/${event.total || '?'} 字节`,frame:`解码第 ${event.frame} 帧 · ${event.mediaSeconds}s`,
      symbol:`有效数据包 ${event.symbols}/${event.needed}`,verified:`AES-GCM 与数据摘要验证通过${event.verifiedSeconds!=null?` · ${event.verifiedSeconds}s · 已读取 ${(100*event.downloadFraction).toFixed(1)}%`:''}`};
    progress={...progress,...event};
    if(event.type==='upload' || event.type==='download')progress.transfer=event.type;
    // Frame/download counters are live; avoid adding hundreds of redundant log lines.
    if (!['frame','download'].includes(event.type) || now()-(emit.last || 0)>250) {
      logs.push({at:now(),type:event.type,message:labels[event.type] || event.message || event.type});
      logs=logs.slice(-140);emit.last=now();
    }
    publish();
  }
  function schedule() {
    clearTimeout(timer);
    if (paused || !scope || !config?.enabled) return;
    const delay=config.pending ? 45000 : Math.max(1000,(config.nextRun || now())-now());
    timer=setTimeout(()=>run().catch(()=>{}),Math.min(delay,2147483647));timer.unref?.();
  }
  async function ensureAccount(expected) {
    const who=await auth();
    if (!who.isLogin || String(who.mid)!==expected) throw new Error('请登录此音乐库对应的 B 站账号');
  }
  function stop() { paused=true;clearTimeout(timer);controller?.abort(); }
  function resume() { paused=false;schedule(); }
  async function loadPreview() {
    const ownScope=scope, bvid=status().bvid;
    if(!ownScope || !bvid)return '';
    await ensureAccount(ownScope);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      const streams=await api.streams(bvid,controller.signal);
      if(scope!==ownScope || status().bvid!==bvid)return '';
      return Object.values(streams).sort((a,b)=>(a.bandwidth || Infinity)-(b.bandwidth || Infinity))[0]?.url || '';
    } finally {clearTimeout(timer);}
  }
  async function setAccount(next) {
    next=String(next || '');
    if (!/^\d{0,20}$/.test(next)) throw new Error('同步账号无效');
    if (next===scope && config) return status();
    stop(); if (running) await running.catch(()=>{});
    scope=next;logs=[];progress={};preview='';decoded='';error='';config=null;paused=false;
    try { config=next?load(next):null; } catch(e) {error=e.message;publish();throw e;}
    schedule();publish();return status();
  }
  async function configure(patch) {
    if (!scope) throw new Error('请先登录 B 站');
    if (!config) throw new Error(error || '云同步配置尚未加载');
    await ensureAccount(scope);
    if ('intervalHours' in patch && !INTERVALS.includes(Number(patch.intervalHours))) throw new Error('不支持的同步间隔');
    if (patch.enabled===false) {stop();if(running)await running.catch(()=>{});}
    const previous=JSON.parse(JSON.stringify(config));
    try {
    if ('intervalHours' in patch) {config.intervalHours=Number(patch.intervalHours);config.nextRun=config.lastSync?config.lastSync+config.intervalHours*3600000:now();}
    if (typeof patch.enabled==='boolean') config.enabled=patch.enabled;
    if (config.enabled) paused=false;
    if (config.enabled && !config.secret) {
      const secret=crypto.randomBytes(32);
      config.secret=protect(secret.toString('hex'));
      config.channel=crypto.createHash('sha256').update(secret).digest('hex').slice(0,16);
      config.nextRun=now();
    }
    save();} catch(e) {config=previous;throw e;}
    schedule();publish();return status();
  }
  async function decodeArchive(archive,signal,gate=false) {
    const streams=await api.streams(archive.bvid,signal,archive.meta.snapshotId);
    const options=gate?['360p','480p']:Object.keys(streams).sort((a,b)=>(streams[a].bandwidth || Infinity)-(streams[b].bandwidth || Infinity));
    if (!options.length) throw new Error('视频尚未完成转码');
    let result, problem;
    for (const quality of options) {
      const media=streams[quality];
      if (!media || gate && media.height!==Number(quality.slice(0,-1))) throw new Error('360p / 480p 转码尚未就绪');
      preview=media.url;
      emit({type:'decode',message:`开始流式读取 ${quality} · ${archive.bvid}`});
      const out=path.join(directory,scope,'decoded-'+crypto.randomUUID()+'.json');
      try {
        const proof=await runtime.run({operation:'decode',url:media.url,key:key().toString('hex'),snapshotId:archive.meta.snapshotId,output:out},signal,emit);
        const raw=JSON.parse(fs.readFileSync(out));
        result=normalize(raw);
        config.lastRead={quality,snapshotId:archive.meta.snapshotId,receivedBytes:proof.receivedBytes,totalBytes:proof.totalBytes,seconds:proof.verifiedSeconds,symbols:proof.symbols,scannedFrames:proof.scannedFrames};
        decoded=JSON.stringify(result,null,2).slice(0,32000);
        publish();
        if (!gate) break;
      } catch(e) {problem=e;if(gate)throw e;}
      finally {try{fs.unlinkSync(out);}catch{}}
    }
    if (!result) throw problem || new Error('没有可恢复的视频版本');
    return result;
  }
  async function checkPending(signal) {
    if (!config.pending) return true;
    const pending=config.pending;
    try {
      const current=await api.list(config.channel,key(),signal);
      const latest=current[0];
      if(latest && latest.meta.sequence>=pending.archive.meta.sequence && latest.meta.snapshotId!==pending.archive.meta.snapshotId && !latest.meta.parts?.some(p=>p.snapshotId===pending.archive.meta.snapshotId)) {
        config.pending=null;save();emit({type:'conflict',message:'检测到其他设备同时更新，将合并最新版本后重试'});return true;
      }
      const restored=await decodeArchive(pending.archive,signal,true);
      if (fingerprint(restored)!==pending.hash) throw new Error('云端回读与待发布快照不同');
      if (signal.aborted) throw new Error('同步已停止');
      config.archive=pending.archive;config.base=restored;config.baseSequence=pending.archive.meta.sequence;remember(pending.archive.meta.snapshotId,restored);
      config.activeBvid=pending.archive.bvid;config.lastPublishedHash=pending.hash;config.lastPublishedSnapshot=pending.archive.meta.snapshotId;config.baseSnapshotId=pending.archive.meta.snapshotId;
      config.pending=null;config.lastSync=now();config.nextRun=now()+config.intervalHours*3600000;
      save();emit({type:'complete',message:'云端 360p / 480p 均验证通过，已保留上一快照分 P'});return true;
    } catch(e) {
      if(signal.aborted)throw e;
      // Keep the previous verified slot; never mark an unverified candidate as synced.
      emit({type:'waiting',message:'等待平台转码或审核；本地数据和上一版本已保留'});
      error=now()-pending.createdAt>24*3600000?'候选稿件超过一天仍未验证，请到创作中心检查审核结果':'';
      save();return false;
    }
  }
  async function work(readOnly,signal,ownScope,force) {
    await ensureAccount(ownScope);
    if(!config.secret)throw new Error('请先开启云同步或导入恢复密钥');
    const secret=key();
    if(config.pending){await runtime.ensure(signal,emit);if (!await checkPending(signal)) return;force=false;}
    emit({type:'query',message:'检查同账号的云端快照'});
    const archives=await api.list(config.channel,secret,signal);
    if(archives.length>1)throw new Error('检测到多个同步稿件，请先在创作中心确认保留哪一个；不会继续覆盖');
    await runtime.ensure(signal,emit);
    const archive=archives[0];
    if(!archive && (config.archive || config.activeBvid || config.lastPublishedSnapshot))throw new Error('暂时查不到原同步稿件，请检查审核或删除状态；不会另建稿件');
    if(archive) {
      config.archive=archive;
      if(config.baseSequence && archive.meta.sequence<config.baseSequence)throw new Error('云端索引仍是旧版本，稍后重试');
      const known=config.baseSnapshotId;
      if(known!==archive.meta.snapshotId) {
        let remote;
        for(const part of [...(archive.meta.parts || [])].sort((a,b)=>b.sequence-a.sequence)) {
          try{remote=await decodeArchive({...archive,meta:{...archive.meta,...part}},signal);}
          catch(e){if(signal.aborted)throw e;emit({type:'fallback',message:'当前快照尚不可读，尝试上一分 P'});continue;}
          if(signal.aborted || scope!==ownScope)throw new Error('同步已停止');
          const local=normalize(await readLibrary(scope));
          const common=archive.meta.parentSnapshotId && config.history?.[archive.meta.parentSnapshotId] || config.base || null;
          const merged=reconcile(common,local,remote);
          await writeLibrary(scope,merged,local);
          config.base=remote;config.baseSnapshotId=part.snapshotId;config.baseSequence=part.sequence;remember(part.snapshotId,remote);
          config.activeBvid=archive.bvid;save();
          emit({type:'merge',message:`已合并 ${merged.likes.length} 首喜欢、${merged.playlists.length} 个歌单`});break;
        }
        if(!remote)throw new Error('云端两个快照都无法恢复，已保留本地数据');
        if(config.baseSnapshotId!==archive.meta.snapshotId) {
          emit({type:'waiting',message:'最新分 P 仍在转码审核，本次只读取上一快照，不覆盖待审核更新'});
          config.nextRun=now()+60000;save();return;
        }
      }
    }
    if(readOnly) {
      if(!decoded) {
        const latest=archives.sort((a,b)=>b.meta.sequence-a.meta.sequence)[0];
        if(latest)await decodeArchive(latest,signal);
        else emit({type:'idle',message:'尚无云端视频，开启自动同步后会创建'});
      }
      return;
    }
    const library=normalize(await readLibrary(scope)),hash=fingerprint(library);
    if(!force && archive && (hash===config.lastPublishedHash && archive.meta.snapshotId===config.lastPublishedSnapshot || config.base && hash===fingerprint(config.base))){config.lastSync=now();config.nextRun=now()+config.intervalHours*3600000;save();emit({type:'idle',message:'音乐库没有变化，无需上传'});return;}
    if(!archive && config.imported)throw new Error('等待原设备创建同步稿件；导入密钥的设备不会另建稿件');
    const slot=archive?.meta.slot==='A'?'B':'A';
    const folder=path.join(directory,scope,'snapshots',crypto.randomUUID());
    const parents=archive?[archive.meta.snapshotId]:[];
    emit({type:'encode',message:'正在生成加密快照'});
    const encoded=await runtime.run({operation:'encode',library,key:secret.toString('hex'),folder,device:config.device,parents},signal,emit);
    const meta={version:2,channel:config.channel,device:config.device,slot,sequence:(archive?.meta.sequence || 0)+1,snapshotId:encoded.snapshotId,parentSnapshotId:archive?.meta.snapshotId || null};
    if(signal.aborted)throw new Error('同步已停止');
    const submitted=await api.submit({file:path.join(folder,'video.mp4'),meta,key:secret,existing:archive,signal,emit});
    // Persist submission before polling; restart resumes verification, never resubmits it.
    config.sequence=meta.sequence;config.pending={archive:submitted,hash,folder,createdAt:now()};config.nextRun=now()+45000;save();
    emit({type:'submitted',message:`稿件已提交 ${submitted.bvid}，等待转码与回读验证`});
    await checkPending(signal);
  }
  function run(readOnly=false,force=false) {
    if(running)return running;
    if(!scope || !config?.enabled && !readOnly)return Promise.reject(new Error('视频云同步未开启'));
    paused=false;
    controller=new AbortController();const signal=controller.signal,ownScope=scope;
    error='';progress={};decoded='';
    running=Promise.resolve().then(()=>work(readOnly,signal,ownScope,force)).catch(e=>{
      if(!signal.aborted){error=e.message;emit({type:'error',message:error});if(config){config.nextRun=now()+15*60000;save();}}
      throw e;
    }).finally(()=>{trimVideoCache();running=null;controller=null;publish();schedule();});
    publish();return running;
  }
  function exportRecovery() {
    if(!config?.secret)throw new Error('尚未创建同步密钥');
    return {version:2,account:scope,key:key().toString('hex'),channel:config.channel,bvid:config.archive?.bvid || config.pending?.archive.bvid || ''};
  }
  function lanKeyStatus(expected) {
    return expected && scope===expected && config ? {channel:config.channel || ''} : null;
  }
  async function exchangeLanRecovery(value, expected, isActive=()=>true) {
    if(!lanKeyStatus(expected) || !isActive())throw new Error('云同步账号尚未就绪');
    await ensureAccount(expected);
    // Recheck after authentication: logout, LAN opt-out and a concurrent import must win.
    if(!lanKeyStatus(expected) || !isActive())throw new Error('局域网密钥同步已取消');
    if(value!==null) {
      if(value?.version!==2 || String(value.account)!==expected || !/^[a-f0-9]{64}$/.test(value.key || ''))throw new Error('恢复密钥无效或属于其他账号');
      const channel=crypto.createHash('sha256').update(Buffer.from(value.key,'hex')).digest('hex').slice(0,16);
      if(channel!==value.channel)throw new Error('恢复密钥校验失败');
      if(config.secret && key().toString('hex')!==value.key)return {conflict:true,recovery:null};
      if(!config.secret) {
        const before=config;
        config={...config,secret:protect(value.key),channel,imported:true,nextRun:now()};
        try{save();}catch(e){config=before;throw e;}
        error='';emit({type:'key',message:'已从同账号局域网设备同步云同步密钥'});schedule();
      }
    }
    return {conflict:false,recovery:config.secret?exportRecovery():null};
  }
  async function importRecovery(value) {
    if(!scope || value?.version!==2 || String(value.account)!==scope || !/^[a-f0-9]{64}$/.test(value.key || ''))throw new Error('恢复文件无效或属于其他账号');
    await ensureAccount(scope);stop();if(running)await running.catch(()=>{});
    const channel=crypto.createHash('sha256').update(Buffer.from(value.key,'hex')).digest('hex').slice(0,16);
    if(channel!==value.channel)throw new Error('恢复文件校验失败');
    config={enabled:false,intervalHours:config?.intervalHours || 3,device:crypto.randomUUID(),heads:{},slots:{},sequence:0,lastSync:0,nextRun:now(),secret:protect(value.key),channel,imported:true};
    save();decoded='';preview='';error='';publish();return status();
  }
  return {status,setAccount,configure,run,stop,resume,loadPreview,exportRecovery,importRecovery,lanKeyStatus,exchangeLanRecovery};
}

return {createVideoCloudSync,INTERVALS,fingerprint};
};
