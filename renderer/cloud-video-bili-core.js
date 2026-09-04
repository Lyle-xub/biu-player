/* Shared cloud protocol; platform adapters supply storage and cryptography. */
module.exports = function ({ fs, path, crypto, Buffer }) {
/* Creator-center web APIs; authenticated requests stay in Electron's main process. */
const MEMBER = 'https://member.bilibili.com';
const PREFIX = 'BIU_VIDEO_SYNC_V2:';
function descriptor(meta, key) {
  const data = Buffer.from(JSON.stringify(meta)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return `${PREFIX}${data}.${crypto.createHmac('sha256', key).update(data).digest('hex')}`;
}
function parseDescriptor(desc, key) {
  const match = String(desc || '').match(/BIU_VIDEO_SYNC_V2:([\w-]{1,4096})\.([a-f0-9]{64})/);
  if (!match) return null;
  const mac = crypto.createHmac('sha256', key).update(match[1]).digest();
  if (!crypto.timingSafeEqual(mac, Buffer.from(match[2], 'hex'))) return null;
  let m; try { m = JSON.parse(Buffer.from(match[1], 'base64')); } catch { return null; }
  if (m.version !== 2 || !/^[a-f0-9]{32}$/.test(m.snapshotId) || !/^[a-zA-Z0-9-]{8,64}$/.test(m.device)
    || !/^[a-f0-9]{16}$/.test(m.channel) || !['A', 'B'].includes(m.slot) || !Number.isSafeInteger(m.sequence) || m.sequence < 1) return null;
  if (!Array.isArray(m.parts) || m.parts.length<1 || m.parts.length>2 || new Set(m.parts.map(p=>p.slot)).size!==m.parts.length
    || m.parts.some(p=>!['A','B'].includes(p.slot) || !/^[a-f0-9]{32}$/.test(p.snapshotId || '') || !/^[\w-]{1,240}$/.test(p.filename || '') || !Number.isSafeInteger(p.sequence) || p.sequence<1)) return null;
  if (!m.parts.some(p=>p.snapshotId===m.snapshotId && p.slot===m.slot && p.sequence===m.sequence)) return null;
  return m;
}
function cdnUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['bilivideo.com', 'bilivideo.cn'].some(h => u.hostname === h || u.hostname.endsWith('.' + h))) throw new Error('平台返回了不支持的视频地址');
  return u.href;
}
function createBiliVideoApi({ request, uploadFetch, csrf, coverFile }) {
  async function timed(fetcher,url,options,timeout) {
    const controller=new AbortController(),abort=()=>controller.abort();
    if(options.signal?.aborted)abort();
    options.signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,timeout);
    try{return await fetcher(url,{...options,signal:controller.signal,timeout});}
    finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
  }
  async function json(url, options = {}) {
    const res = await timed(request,url,options,45000);
    if (!res.ok) throw new Error(`B 站请求失败（HTTP ${res.status}）`);
    const value = await res.json();
    if (value.code !== undefined && value.code !== 0) throw new Error(`B 站接口拒绝请求（${value.code}）：${String(value.message || value.msg || '请稍后重试').slice(0,160)}`);
    return value.data === undefined ? value : value.data;
  }
  async function list(channel, key, signal) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const data = await json(`${MEMBER}/x/web/archives?status=pubed,not_pubed,is_pubing&pn=${page}&ps=20&keyword=${encodeURIComponent('Biu 云同步')}`, { signal });
      const rows = data.arc_audits || [];
      for (const row of rows) {
        const archive = row.Archive || row.archive;
        if (!archive || !/^BV\w+$/.test(archive.bvid)) continue;
        const meta = parseDescriptor(archive.desc, key);
        if (meta?.channel === channel) all.push({ ...archive, meta });
        else if (String(archive.desc || '').includes(PREFIX)) throw new Error('账号已有视频云同步稿件，请导入原设备的恢复密钥；不会新建第二个稿件');
      }
      const size = Number(data.page?.ps) || 20;
      if (!rows.length || page * size >= Number(data.page?.count || rows.length)) return all;
    }
    throw new Error('云端稿件超过查询范围，请先减少历史稿件');
  }
  async function streams(bvid, signal, snapshotId) {
    const detail = await json(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { signal });
    const page = snapshotId ? detail.pages?.find(p => String(p.part).includes(snapshotId)) : detail.pages?.[0];
    const cid = page?.cid || (!snapshotId ? detail.cid : null);
    if (!cid) throw new Error('视频正在转码或审核');
    const data = await json(`https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=4048&fourk=1`, { wbi: true, signal });
    const video = data.dash?.video || [];
    const result = {};
    for (const [name, id] of [['360p',16],['480p',32],['720p',64],['1080p',80]]) {
      const matches = video.filter(v => Number(v.id) === id && (v.codecid === 7 || /avc/.test(v.codecs || ''))).sort((a,b) => a.bandwidth-b.bandwidth);
      const selected = matches[0];
      if (selected) result[name] = { url: cdnUrl(selected.baseUrl || selected.base_url), width: selected.width, height: selected.height, bandwidth: selected.bandwidth, cid };
    }
    return result;
  }
  async function upload(file, signal, emit) {
    const total = fs.statSync(file).size;
    if (total > 512*1024*1024) throw new Error('本次同步视频超过 512 MB');
    const pre = await json(`${MEMBER}/preupload?${new URLSearchParams({ r:'upos', profile:'ugcupos/bup', ssl:'1', version:'2.8.12', build:'2081200', name:path.basename(file), size:String(total) })}`, { signal });
    const endpoint = String(pre.endpoint || '').replace(/^\/\//, 'https://');
    const url = cdnUrl(endpoint + '/' + String(pre.upos_uri || '').replace('upos://',''));
    const headers = { 'X-Upos-Auth': pre.auth };
    const storage = async (target, opts) => {
      const response = await timed(uploadFetch,target,{...opts,headers:{...headers,...opts.headers},signal},120000);
      if (!response.ok) throw new Error(`视频素材上传失败（HTTP ${response.status}）`);
      return response;
    };
    const init = await (await storage(url+'?uploads&output=json', { method:'POST' })).json();
    if (!init.upload_id) throw new Error('无法初始化上传');
    const chunkSize = Number(pre.chunk_size);
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 65536 || chunkSize > 32*1024*1024) throw new Error('不支持的上传分块大小');
    const chunks = Math.ceil(total/chunkSize), parts = [];
    const fileHandle = await fs.promises.open(file, 'r');
    try {
      for (let chunk=0; chunk<chunks; chunk++) {
        const start=chunk*chunkSize, end=Math.min(total,start+chunkSize), buffer=Buffer.alloc(end-start);
        const { bytesRead } = await fileHandle.read(buffer,0,buffer.length,start);
        if (bytesRead!==buffer.length) throw new Error('上传视频文件读取不完整');
        const query = new URLSearchParams({ uploadId:init.upload_id, chunks:String(chunks), total:String(total), chunk:String(chunk), size:String(buffer.length), partNumber:String(chunk+1), start:String(start), end:String(end) });
        const response = await storage(url+'?'+query,{method:'PUT',body:buffer});
        await response.arrayBuffer();
        parts.push({partNumber:chunk+1,eTag:'etag'});
        emit({type:'upload',bytes:end,total});
      }
    } finally { await fileHandle.close(); }
    const query = new URLSearchParams({ name:path.basename(file), uploadId:init.upload_id, biz_id:String(pre.biz_id), output:'json', profile:'ugcupos/bup' });
    const merged = await (await storage(url+'?'+query,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parts})})).json();
    if (merged.OK!==1) throw new Error('视频上传分片合并失败');
    return path.basename(pre.upos_uri,path.extname(pre.upos_uri));
  }
  async function submit({ file, meta, key, existing, signal, emit }) {
    const filename = await upload(file,signal,emit);
    const token = await csrf();
    if (!token) throw new Error('请重新登录 B 站后同步');
    let cover = existing?.cover;
    if (!cover) {
      const data = await json(`${MEMBER}/x/vu/web/cover/up`, {method:'POST',signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({cover:'data:image/png;base64,'+fs.readFileSync(coverFile).toString('base64'),csrf:token}).toString()});
      cover=data.url;
    }
    // Only signed, app-owned slots are editable. Never adopt an arbitrary user BV.
    if (existing) {
      const old = parseDescriptor(existing.desc,key);
      if (!old || old.channel!==meta.channel || !Array.isArray(old.parts)) throw new Error('不能替换非本同步空间的稿件');
    }
    const parts = [...(existing?.meta.parts || []).filter(p=>p.slot!==meta.slot), {slot:meta.slot,snapshotId:meta.snapshotId,sequence:meta.sequence,device:meta.device,filename}].sort((a,b)=>b.sequence-a.sequence);
    const manifest = {...meta,parts};
    const body = {copyright:1,source:'',tid:231,title:`Biu 云同步 ${meta.channel}`,cover,
      desc:'Biu Player 个人加密音乐库同步。仅自己可见，解密密钥保存在设备。\n'+descriptor(manifest,key),
      tag:'编程',dynamic:'',no_reprint:1,open_elec:0,is_only_self:1,interactive:0,act_reserve_create:0,
      videos:parts.map(p=>({filename:p.filename,title:`Biu ${p.slot} ${p.snapshotId}`,desc:''})),...(existing?{aid:existing.aid}:{}),csrf:token};
    const current = await list(meta.channel,key,signal);
    if (existing ? current.length!==1 || current[0].meta.snapshotId!==existing.meta.snapshotId : current.length!==0) throw new Error('云端版本在上传期间发生变化，请重新合并后同步');
    const result = await json(`${MEMBER}/x/vu/web/${existing?'edit':'add/v3'}?csrf=${encodeURIComponent(token)}`, {method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const bvid = result.bvid || existing?.bvid;
    if (!/^BV\w+$/.test(bvid || '')) throw new Error('稿件提交结果不明确，请刷新云端状态后重试');
    return {bvid,aid:result.aid || existing?.aid,cover,desc:body.desc,title:body.title,meta:manifest};
  }
  return { list, streams, submit };
}

return { createBiliVideoApi, descriptor, parseDescriptor, cdnUrl };
};
