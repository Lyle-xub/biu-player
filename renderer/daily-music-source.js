/* Shared catalog-to-video pipeline. Network is injected on desktop, web and RN. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./daily-recommendation'));
  else root.BiuDailyMusic = factory(root.BiuDaily);
})(typeof window === 'object' ? window : this, function(D) {
  const categories = {
    日语:'日语', 日系:'日语', 欧美音乐:'欧美', 欧美:'欧美', 华语:'华语', 韩语:'韩语', 粤语:'粤语',
    二次元:'ACG', ACG:'ACG', VOCALOID:'ACG', 流行:'流行', 摇滚:'摇滚', 民谣:'民谣', 电子:'电子',
    纯音乐:'轻音乐', 轻音乐:'轻音乐', 钢琴:'钢琴', 吉他:'吉他', 爵士:'爵士', 古典:'古典', 乡村:'乡村',
    国风:'古风', 古风:'古风', 治愈:'治愈', 温柔:'治愈', 放松:'放松', 安静:'安静', 伤感:'伤感',
    通勤:'地铁', 工作:'工作', 学习:'学习', 运动:'运动', 'City Pop':'日语', 后摇:'后摇', 说唱:'说唱',
  };
  const nonmusic = /^(cos(play)?|美女|美妆|发型|丝袜|黑丝|白丝|穿搭|颜值|性感|舞蹈)$/i;
  const norm = D.songText;
  const queryString = values => Object.entries(values).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  const names = list => (Array.isArray(list) ? list : []).filter(v => typeof v === 'string').slice(0, 8);
  function song(raw, source = 'netease') {
    const artists = raw.artists || raw.ar || raw.singer || [];
    const value = D.songInfo({ source, id: raw.songmid || raw.id, title: raw.name || raw.songname,
      artists: artists.map(a => a.name), aliases: [...names(raw.alias), ...names(raw.alia), ...names(raw.transNames), ...names(raw.tns)],
      artistAliases: artists.flatMap(a => [...names(a.alias), ...names(a.alia), ...names(a.transNames), ...(a.trans ? [a.trans] : [])]) });
    return value && { ...value, duration: Number(raw.interval || (raw.duration || raw.dt) / 1000) || 0,
      artistIds: artists.map(a => a.id).filter(v => Number(v) > 0).slice(0, 3) };
  }
  function decode(body, kind) {
    const d = JSON.parse(body);
    if (d.code !== 200 && d.code !== 0) throw Error(d.message || d.msg || `音乐源请求失败（${d.code}）`);
    if (kind === 'playlists') return (d.playlists || d.result?.playlists || []).slice(0, 4).map(p => ({ id:p.id, name:p.name }));
    if (kind === 'playlist') return ((d.result || d.playlist)?.tracks || []).slice(0, 160).map(v => song(v)).filter(Boolean);
    if (kind === 'songs') return (d.result?.songs || []).slice(0, 30).map(v => song(v)).filter(Boolean);
    if (kind === 'qq') return (d.data?.song?.list || []).slice(0, 30).map(v => song(v, 'qq')).filter(Boolean);
    if (kind === 'artist') return [...names(d.artist?.alias), ...names(d.artist?.transNames), ...(d.artist?.trans ? [d.artist.trans] : [])];
    if (kind === 'videos') return (d.data?.result || []).filter(v => /^BV\w+$/.test(v.bvid || '')).slice(0, 30).map(v => ({
      bvid: v.bvid, aid:v.aid, mid:v.mid, title:String(v.title || '').replace(/<[^>]*>/g, '').replace(/&amp;/g,'&'),
      duration: typeof v.duration === 'string' ? v.duration.split(':').reduce((a,b) => a*60 + Number(b),0) : Number(v.duration)||0,
      tid:Number(v.typeid || v.tid)||0, up:v.author || '', pic:String(v.pic || '').replace(/^\/\//,'https://'),
      tags:typeof v.tag === 'string' ? v.tag.split(',') : [], desc:String(v.description || '').slice(0,1500),
    }));
    throw Error('未知音乐源数据');
  }
  function plans(profile) {
    const seen = new Set();
    return (profile.tags || []).filter(t => !nonmusic.test(t.name)).sort((a,b) => b.weight-a.weight).flatMap(t => {
      const name = D.canonical(t.name), category = categories[name] || categories[t.name];
      const key = category || name;
      if (seen.has(key) || (!category && D.category(name)!=='artist')) return [];
      seen.add(key); return [{ name:t.name, category, weight:t.weight || 1 }];
    }).slice(0, 8);
  }
  const forbidden = /翻唱|伴奏|教学|教程|解说|盘点|合集|串烧|琴谱|鼓谱|曲谱|乐谱|简谱|五线谱|贝斯谱|动态谱|架子鼓.*谱|指弹|\b(tab|cover|reaction|mashup|medley|compilation|playlist|ai)\b/i;
  function matchScore(s, v) {
    const title = norm(v.title);
    if (!title || forbidden.test(v.title) || D.isCompilation(v) || !(s.duration > 0 && v.duration >= 60 && v.duration <= 600)) return 0;
    const alternate = /谱|カラオケ|ニコカラ|カバー|歌ってみた|弾いてみた|off[ -]?vocal|instrumental|花絮|幕后|预告|teaser|trailer|making.of/i;
    if (alternate.test(v.title) && !alternate.test(s.title)) return 0;
    const voice = /初音|[镜鏡]音|猫村|重音|洛天依|可不|小春六花|星尘/g;
    const credits = [...s.artists || [], ...s.artistAliases || []].join(' ');
    if ([...v.title.matchAll(voice)].some(m => !credits.includes(m[0]))) return 0;
    const live = /live|现场|演唱会/i;
    if (live.test(s.title) !== live.test(v.title)) return 0;
    const remix = /remix|伴奏|翻唱|加速|慢速|sped.?up|slowed/i;
    if (remix.test(s.title) !== remix.test(v.title)) return 0;
    if (![s.title, ...s.aliases || []].some(n => norm(n).length >= 2 && title.includes(norm(n)))) return 0;
    if (![...s.artists || [], ...s.artistAliases || []].some(n => {
      if (/^[a-z0-9 ._-]+$/i.test(n)) return new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*') + '(?=$|[^a-z0-9])','i').test(v.title);
      return norm(n).length >= 2 && title.includes(norm(n));
    })) return 0;
    const delta = Math.abs(s.duration - v.duration);
    return delta <= Math.max(15, s.duration * 0.12) ? 100 - delta / Math.max(1,s.duration)*100 : 0;
  }
  // Serialize start slots, not responses: at most three searches start per second.
  let searchSlot = Promise.resolve();
  function paceSearch() {
    const slot = searchSlot;
    searchSlot = slot.then(() => new Promise(resolve => setTimeout(resolve, 350)));
    return slot;
  }
  function create({ get, profile, state, decode: parse = decode, stopped = () => false, cache = new Map() }) {
    const queries = plans(profile), seenSongs = new Set(), artistCache = new Map();
    let cursor = 0, lastError = null, limited = null;
    async function request(url, kind) {
      if (stopped()) throw Error('已取消生成');
      if (kind === 'videos' && limited) throw limited;
      const saved = cache.get(url);
      if (saved && Date.now() - saved.at < 30 * 60000) return saved.value;
      cache.delete(url);
      const job = (async () => {
        if (kind === 'videos') { await paceSearch(); if (limited) throw limited; }
        if (stopped()) throw Error('已取消生成');
        let timer;
        const response = await Promise.race([Promise.resolve().then(() => get(url, { referer:url.includes('bilibili.com')?'https://www.bilibili.com/':url.includes('qq.com')?'https://y.qq.com/':'https://music.163.com/' })),
          new Promise((_,reject) => { timer = setTimeout(() => reject(Error('推荐接口请求超时')),8000); })]).finally(() => clearTimeout(timer));
        if (stopped()) throw Error('已取消生成');
        if (response.status !== 200) {
          const error = Error(`推荐接口请求失败（HTTP ${response.status}）`);
          if(kind === 'videos' && [412,429].includes(response.status)) limited = error;
          throw error;
        }
        return parse(response.body, kind);
      })();
      if(cache.size>=60)cache.delete(cache.keys().next().value);
      cache.set(url,{at:Date.now(),value:job});
      try { return await job; } catch(e) { cache.delete(url); lastError=e; throw e; }
    }
    async function collect(plan, round) {
      const day = D.hash(D.dayKey() + plan.name);
      if (plan.category) {
        const offset = ((day % 4) + round) * 3;
        const lists = await request('https://music.163.com/api/playlist/list?' + queryString({cat:plan.category,order:'hot',limit:3,offset}), 'playlists');
        const rows = [];
        // Sequential details keep the global three-plan batch at three requests.
        for (const p of lists) rows.push(await request('https://music.163.com/api/playlist/detail?id='+p.id,'playlist').catch(() => []));
        const out=[];
        const length=Math.max(0,...rows.map(v=>v.length));
        for(let i=0;i<length;i++) for(const row of rows) if(row.length) {
          const s=row[(i+day%row.length)%row.length];
          out.push({...s,matchedTags:[plan.name],reason:`${plan.name} · 音乐歌单`});
        }
        return out;
      }
      const q=encodeURIComponent(plan.name);
      const ne=await request(`https://music.163.com/api/search/get/web?s=${q}&type=1&limit=30&offset=${round*30}`,'songs').catch(()=>[]);
      const qq=await request(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${q}&format=json&p=${round+1}&n=30&t=0`,'qq').catch(()=>[]);
      // Unknown tags may be song/artist names, never accept arbitrary search hits.
      return [...ne,...qq].filter(s => [...s.artists,s.title,...s.aliases,...s.artistAliases].some(n => norm(n)===norm(plan.name)))
        .map(s=>({...s,matchedTags:[plan.name],reason:`${plan.name} · 歌曲检索`}));
    }
    const pool=[];
    async function next() {
      if (!queries.length) throw Error('画像中暂无可用于选歌的音乐偏好，请添加曲风、语种或歌手');
      const round=cursor++, batches=[];
      // Include all selected interests before matching, so the first category
      // cannot fill the entire day while the others have not been queried yet.
      for(let i=0;i<queries.length;i+=3) {
        if(stopped())throw Error('已取消生成');
        batches.push(...await Promise.all(queries.slice(i,i+3).map(p=>collect(p,round).catch(e=>{lastError=e;return [];}))));
      }
      if(batches.every(rows=>!rows.length) && lastError) throw lastError;
      const priorSongs=new Set(D.recentSongs(state()).map(v=>v.key));
      const max=Math.max(0,...batches.map(v=>v.length));
      for(let i=0;i<max;i++) for(const rows of batches) {
        const s=rows[i]; if(!s || s.duration<60 || s.duration>600) continue;
        const keys=D.songKeys({song:s});
        if(keys.some(k=>seenSongs.has(k)||priorSongs.has(k)))continue;
        keys.forEach(k=>seenSongs.add(k));pool.push(s);
      }
      return pool;
    }
    async function resolve(s) {
      if (stopped()) return null;
      const daily=state(), excluded=new Set([...daily.shown.map(v=>v.bvid),...D.activeRules(daily.blocked)]);
      const prior=new Set(D.recentSongs(daily).map(v=>v.key));
      if(D.songKeys({song:s}).some(k=>prior.has(k)))return null;
      // Backfill exclusion for old daily videos that predate catalog identities.
      if(daily.candidates.some(v=>excluded.has(v.bvid)&&matchScore(s,v)>0))return null;
      const query = async (title, artist) => {
        const videos=await request('https://api.bilibili.com/x/web-interface/search/type?'+queryString({search_type:'video',keyword:`${title} ${artist}`,order:'totalrank',page:1}),'videos');
        return videos.filter(v=>!excluded.has(v.bvid)).map(v=>({v,score:matchScore(s,v)})).filter(v=>v.score>0).sort((a,b)=>b.score-a.score)[0]?.v;
      };
      let hit=await query(s.title,s.artists[0]);
      if(!hit && s.source==='netease' && s.artistIds?.length) {
        const id=s.artistIds[0];
        if(!artistCache.has(id)) artistCache.set(id,request('https://music.163.com/api/artist/'+id,'artist').catch(()=>[]));
        s.artistAliases=[...new Set([...s.artistAliases,...await artistCache.get(id)])].slice(0,8);
      }
      if(!hit) {
        const title=s.aliases.find(n=>/[\u3400-\u9fff]/.test(n)) || s.aliases[0] || s.title;
        const artist=s.artistAliases.find(n=>/[\u3400-\u9fff]/.test(n)) || s.artistAliases[0] || s.artists[0];
        hit=await query(title,artist);
      }
      return hit ? {...hit,song:s,matchedTags:s.matchedTags,recommendationReason:`${s.reason} · ${s.title}`} : null;
    }
    return { next, resolve, pool, queries, get error(){return lastError;} };
  }
  return { create, plans, decode, matchScore, song };
});
