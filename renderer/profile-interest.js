/* Platform-independent interests. Derived vectors never enter the sync document. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuProfileInterest = factory();
})(typeof window === 'object' ? window : this, function() {
  const text = (v, n = 500) => String(v || '').normalize('NFKC').replace(/<[^>]*>/g, '').trim().slice(0, n);
  const key = v => text(v).toLowerCase();
  const list = v => Array.isArray(v) ? v : [];
  const time = v => Math.max(0, Number.isFinite(v) ? v : 0);
  const noise = /^(热门|推荐|必看|一键三连|创作激励|音乐分享官|活动投稿|征集令)$/;
  const names = values => [...new Set(list(values).map(v => text(typeof v === 'string' ? v : v?.name, 40)).filter(v => v && !noise.test(v)))].slice(0, 30);
  function normalize(v) {
    if (!v || typeof v !== 'object') return undefined;
    return { version: 1, description: text(v.description), avoid: names(v.avoid), visualEnabled: v.visualEnabled !== false,
      at: time(v.at), visualResetAt: time(v.visualResetAt),
      authors: list(v.authors).filter(a => /^[1-9]\d{0,19}$/.test(String(a?.mid))).slice(-200).map(a => ({
        mid: String(a.mid), name: text(a.name, 100), mode: ['ignore','block'].includes(a.mode) ? a.mode : 'normal', at: time(a.at) })),
      removedSamples: list(v.removedSamples).filter(s => s?.bvid).slice(-500).map(s => ({ bvid: text(s.bvid,40), at: time(s.at) })),
    };
  }
  function learned(v) {
    if(!v || typeof v!=='object') return undefined;
    return {tags:list(v.tags).slice(0,30).map(t=>({name:text(t.name,40),weight:Math.max(1,Math.min(100,Number(t.weight)||1))})),
      authors:list(v.authors).filter(a=>/^[1-9]\d{0,19}$/.test(a?.mid)).slice(0,50).map(a=>({mid:String(a.mid),name:text(a.name,100),weight:Math.max(0,Math.min(10000,Number(a.weight)||0))})),
      samples:list(v.samples).filter(a=>a?.bvid).slice(0,200).map(a=>({bvid:text(a.bvid,40),title:text(a.title),pic:text(a.pic,2048),owner:text(a.owner,40),up:text(a.up,100),source:text(a.source,20),at:time(a.at),tags:names(a.tags),profileId:text(a.profileId,40)}))};
  }
  function selection(value) {
    const v=normalize(value);
    return v ? [v.description,v.avoid,v.visualEnabled,v.visualResetAt,v.authors.filter(a=>a.mode!=='normal').map(a=>[a.mid,a.mode]).sort(),v.removedSamples.map(s=>s.bvid).sort()] : ['',[],true,0,[],[]];
  }
  function validate(v) {
    if (v === undefined) return;
    if (!v || v.version !== 1 || typeof v.description !== 'string' || v.description.length > 500
      || !Array.isArray(v.avoid) || v.avoid.length > 30 || v.avoid.some(x => typeof x !== 'string' || x.length > 40)
      || !Array.isArray(v.authors) || v.authors.length > 200 || v.authors.some(a => !/^[1-9]\d{0,19}$/.test(a?.mid) || !['normal','ignore','block'].includes(a.mode))
      || !Array.isArray(v.removedSamples) || v.removedSamples.length > 500
      || !Number.isFinite(v.at) || !Number.isFinite(v.visualResetAt)) throw Error('扩展画像数据无效');
  }
  function merge(a,b) {
    a=normalize(a); b=normalize(b); if (!a || !b) return a || b;
    const later=(x,y)=> x.at > y.at || x.at === y.at && JSON.stringify(x)>JSON.stringify(y) ? x:y;
    const join=(x,y,id)=> { const m=new Map(); [...x,...y].forEach(v=>m.set(v[id],m.has(v[id])?later(m.get(v[id]),v):v)); return [...m.values()].sort((a,b)=>a.at-b.at || (a[id]<b[id]?-1:1)); };
    return normalize({...later(a,b),visualResetAt:Math.max(a.visualResetAt,b.visualResetAt),authors:join(a.authors,b.authors,'mid'),removedSamples:join(a.removedSamples,b.removedSamples,'bvid')});
  }
  function contains(source, term, { title = false } = {}) {
    source=key(source); term=key(term); if (!term) return false;
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re = new RegExp(/[a-z0-9]/i.test(term) ? `(^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])` : escaped,'g');
    let match;
    while ((match=re.exec(source))) {
      if (!/(不是|并非|不要|告别|非|not\s+)\s*$/i.test(source.slice(Math.max(0,match.index-8),match.index))
        && (!title || /软件|应用|插件|代码|模拟器/.test(term) || !/^[^\s，。,、；;]{0,12}(软件|应用|插件|代码|模拟器)/.test(source.slice(match.index+match[0].length)))) return true;
    }
    return false;
  }
  // General-language fallback; no music vocabulary or category allowlist.
  function terms(value) {
    return [...new Set(text(value).split(/[\s,，。;；、!！?？:：|/【】《》「」()（）]+/)
      .map(x=>x.replace(/^(我喜欢|我想看|偏好|喜欢|关于|学习|适合)/,''))
      .filter(x=>x.length>=2 && x.length<=20 && !noise.test(x) && !/^(不要|不喜欢|少一些|排除)/.test(x)))].slice(0,20);
  }
  function interests(profile) {
    const result=list(profile?.tags).map(t=>({name:text(t.name || t,40),weight:Number(t.weight)||50}));
    for (const name of terms(profile?.interests?.description)) if (!result.some(t=>key(t.name)===key(name))) result.push({name,weight:40});
    return result;
  }
  const ownerId=track=>String(track.mid || track.owner?.mid || (typeof track.owner==='string'?track.owner:'') || '');
  function blocked(track, profile) {
    const p=profile?.interests;
    if (!p) return false;
    if (p.authors?.some(a=>a.mid===ownerId(track) && a.mode==='block')) return true;
    return list(p.avoid).some(term => contains(track.title,term) || names(track.tags).some(t=>contains(t,term)));
  }
  function learn(evidence, events, profileId='auto', now=Date.now()) {
    const records=new Map();
    for (const e of list(evidence)) {
      if (profileId!=='auto' && e.profileId!==profileId) continue;
      if (e.profileId && e.profileId!==profileId) continue;
      records.set(e.bvid,{...e,weight:e.source==='likes'?5:e.source==='playlists'?3:e.source==='listens'?1:0});
    }
    for (const e of list(events)) {
      if ((e.profileId || 'auto')!==profileId || e.seconds<Math.min(60,Math.max(8,(e.track?.duration || 100)*0.6))) continue;
      if (!e.track?.bvid || records.has(e.track.bvid)) continue;
      records.set(e.track.bvid,{...e.track,owner:String(e.track.mid || ''),at:e.at,weight:1,source:'listens'});
    }
    const authors=new Map(), counts=new Map(), totals=new Map();
    for (const e of records.values()) if(e.weight>0) {
      const mid=String(e.owner || e.mid || '');
      const w=e.weight*Math.max(0.1,Math.pow(0.5,Math.max(0,now-e.at)/86400000/30));
      if (/^[1-9]\d{0,19}$/.test(mid)) { const a=authors.get(mid)||{mid,name:e.up || e.ownerName || mid,weight:0}; a.weight+=w; authors.set(mid,a); }
      const tags=names(e.tags), found=tags.length?tags:terms(e.title);
      for (const name of found) { counts.set(name,(counts.get(name)||0)+1); totals.set(name,(totals.get(name)||0)+w/Math.sqrt(Math.max(1,found.length))); }
    }
    const sorted=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,30), max=sorted[0]?.[1]||1;
    return { tags:sorted.map(([name,w])=>({name,weight:Math.max(1,Math.round(w/max*100))})),
      authors:[...authors.values()].sort((a,b)=>b.weight-a.weight).slice(0,50),
      samples:[...records.values()].filter(e=>e.weight>1 && /^https?:\/\//.test(e.pic||'')).sort((a,b)=>b.at-a.at).slice(0,200) };
  }
  function cosine(a,b) {
    if (!a || !b || a.length!==b.length || !a.length) return 0;
    let dot=0,x=0,y=0;
    for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))return 0;dot+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}
    return x && y ? Math.max(-1,Math.min(1,dot/Math.sqrt(x*y))):0;
  }
  function evaluate(track, profile, evidence={}) {
    if(blocked(track,profile)||evidence.conflict) return {eligible:false,score:0,reasons:[],visualOnly:false};
    const labels=names(track.tags);
    const matches=interests(profile).filter(t=>labels.some(n=>key(n)===key(t.name)) || contains(track.title,t.name,{title:true}));
    const lexical=matches.reduce((n,t)=>n+t.weight,0);
    // Thresholds are supplied only by a held-out calibration artifact, never guessed.
    const semantic=!!evidence.textCalibrated && evidence.textSimilarity>=evidence.textThreshold;
    const visual=profile?.interests?.visualEnabled!==false && !!evidence.visualCalibrated && evidence.sampleCount>=5
      && evidence.authorCount>=2 && evidence.visualNeighbours>=2 && evidence.visualSimilarity>=evidence.visualThreshold && !evidence.conflict;
    const eligible=lexical>0 || semantic || visual;
    const author=list(profile?.learned?.authors).find(a=>a.mid===ownerId(track));
    const ignore=profile?.interests?.authors?.some(a=>a.mid===ownerId(track) && a.mode==='ignore');
    const authorBonus=author&&!ignore?Math.min(15,Math.log1p(author.weight)*5):0;
    return {eligible,visualOnly:eligible&&!lexical&&!semantic,matches,
      score:eligible?lexical+Math.max(0,Number(evidence.textSimilarity)||0)*30+Math.max(0,Number(evidence.visualSimilarity)||0)*10+authorBonus:0,
      reasons:[...(matches.length?[`画像 · ${matches.slice(0,2).map(t=>t.name).join(' / ')}`]:semantic?['标题接近你的兴趣']:visual?['封面接近你收藏的视频']:[]),...(eligible&&authorBonus?['来自常看的 UP 主']:[])]};
  }
  return {normalize,selection,learned,validate,merge,contains,terms,interests,blocked,learn,cosine,evaluate};
});
