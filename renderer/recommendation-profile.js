/* Shared by desktop and React Native: account-scoped interests and recommendations. */
(function (root, factory) {
  const make = (D, M, I) => {
    const compareText = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator().compare : (a,b) => a.localeCompare(b);
    const home = factory(D, M, I, false, compareText);
    home.discovery = factory(D, M, I, true, compareText);
    return home;
  };
  if (typeof module === 'object' && module.exports) module.exports = make(require('./daily-recommendation'), require('./daily-music-source'), require('./profile-interest'));
  else root.BiuRecommendation = make(root.BiuDaily, root.BiuDailyMusic, root.BiuProfileInterest);
})(typeof window === 'object' ? window : this, function (D, M, I, multimodal, compareText) {
  const MUSIC = new Set([3, 28, 29, 30, 31, 59, 130, 193, 194, 243, 244, 265, 267]);
  const DAILY_MIN_TRACKS = 15;
  const DAILY_MAX_ROUNDS = 10;
  const clean = (value) => String(value || '').normalize('NFKC').replace(/<[^>]*>/g, '').trim().slice(0, 40);
  const keyOf = (value) => clean(value).toLowerCase();
  function tags(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).flatMap((item) => {
      const name = clean(typeof item === 'string' ? item : item?.name || item?.tag_name);
      const key = keyOf(name);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ name, weight: Math.round(Math.max(1, Math.min(100, Number(item?.weight) || 50))) }];
    }).slice(0, 30);
  }
  const SOURCE_WEIGHT = { likes: 1, playlists: 0.65, listens: 0.4, feed: 0 };
  function mergeEvidence(...lists) {
    const byVideo = new Map();
    for (const item of lists.flat()) {
      if (!item || typeof item.bvid !== 'string' || !item.bvid || item.bvid.length > 40
        || !Object.hasOwn(SOURCE_WEIGHT, item.source)) continue;
      const next = { bvid: item.bvid, source: item.source, owner: clean(item.owner || item.bvid),
        profileId: clean(item.profileId), pic: String(item.pic || '').slice(0,2048), up: String(item.up || '').slice(0,100),
        title: String(item.title || '').slice(0, 500), desc: String(item.desc || '').slice(0, 1500),
        at: Math.max(0, Number(item.at) || 0),
        ...(Array.isArray(item.tags) ? { tags: tags(item.tags).map((t) => t.name).sort() }
          : item.retryAt ? { retryAt: Math.max(0, Number(item.retryAt) || 0) } : {}) };
      const evidenceKey=next.bvid+(multimodal?':'+(next.profileId || 'auto'):'');
      const old = byVideo.get(evidenceKey);
      if (!old) { byVideo.set(evidenceKey, next); continue; }
      const labels = old.tags && next.tags
        ? (JSON.stringify(old.tags) < JSON.stringify(next.tags) ? old.tags : next.tags) : old.tags || next.tags;
      byVideo.set(evidenceKey, { bvid: next.bvid,
        profileId: old.profileId || next.profileId, pic: [old.pic,next.pic].filter(Boolean).sort()[0] || '', up: [old.up,next.up].filter(Boolean).sort()[0] || '',
        title: [old.title, next.title].filter(Boolean).sort()[0] || '', desc: [old.desc, next.desc].filter(Boolean).sort()[0] || '',
        source: SOURCE_WEIGHT[old.source] >= SOURCE_WEIGHT[next.source] ? old.source : next.source,
        owner: old.owner === old.bvid ? next.owner : next.owner === next.bvid ? old.owner : old.owner < next.owner ? old.owner : next.owner,
        at: Math.min(old.at, next.at),
        ...(labels ? { tags: labels } : { retryAt: Math.max(old.retryAt || 0, next.retryAt || 0) }) });
    }
    return [...byVideo.values()].sort((a, b) => a.at - b.at || compareText(a.bvid, b.bvid));
  }
  function accumulated(evidence, previous = {}) {
    const successful = evidence.filter((v) => Array.isArray(v.tags));
    const latest = evidence.reduce((max, v) => Math.max(max, v.at), 0);
    return { ...previous, id: 'auto', name: '近期画像', evidence,
      tags: successful.length ? infer(successful.map((v) => ({
        track: { bvid: v.bvid, mid: v.owner }, tags: v.tags, index: 0,
        // Old interests retain a baseline; new observations gently steer the cumulative profile.
        weight: SOURCE_WEIGHT[v.source] * Math.max(0.25, Math.pow(0.5, (latest - v.at) / (90 * 86400000))),
      }))) : (previous.tags || []),
      samples: successful.length, pending: evidence.length - successful.length,
      sources: Object.fromEntries(Object.keys(SOURCE_WEIGHT).map((source) => [source, successful.filter((v) => v.source === source).length])),
    };
  }
  function normalize(value, learn = true) {
    const profiles = [], ids = new Set(['auto']);
    for (const p of Array.isArray(value?.profiles) ? value.profiles.slice(0, 20) : []) {
      const id = clean(p?.id), name = clean(p?.name);
      if (!id || !name || ids.has(id)) continue;
      ids.add(id); profiles.push({ id, name, tags: tags(p.tags), ...(p.interests ? { interests: I.normalize(p.interests) } : {}), ...(p.learned ? { learned: I.learned(p.learned) } : {}) });
    }
    const auto = { id: 'auto', name: '近期画像', tags: tags(value?.auto?.tags),
      ...(value?.auto?.interests ? { interests: I.normalize(value.auto.interests) } : {}), ...(value?.auto?.learned ? { learned: I.learned(value.auto.learned) } : {}),
      updatedAt: Number(value?.auto?.updatedAt) || 0, fingerprint: String(value?.auto?.fingerprint || '').slice(0, 2000),
      samples: Math.max(0, Number(value?.auto?.samples) || 0), failures: Math.max(0, Number(value?.auto?.failures) || 0),
      sources: Object.fromEntries(['likes', 'playlists', 'feed'].map((key) => [key,
        Math.max(0, Math.floor(Number(value?.auto?.sources?.[key]) || 0))])) };
    if (Array.isArray(value?.auto?.evidence)) {
      auto.evidence = mergeEvidence(value.auto.evidence);
      auto.pending = auto.evidence.filter((v) => !Array.isArray(v.tags)).length;
      auto.samples = auto.evidence.length - auto.pending;
      auto.sources = Object.fromEntries(Object.keys(SOURCE_WEIGHT).map((source) =>
        [source, auto.evidence.filter((v) => v.source === source && Array.isArray(v.tags)).length]));
    }
    const daily = D.normalize(value?.daily);
    if (!ids.has(daily.profileId)) daily.profileId = 'auto';
    if (learn && multimodal) {
      for (const p of [auto,...profiles]) {
        const learned = I.learn(auto.evidence || [], daily.events, p.id);
        if(learned.tags.length || learned.authors.length || learned.samples.length) p.learned=learned;
        if(p.id==='auto' && (auto.evidence || daily.events.length)) p.tags = tags([...D.taste((auto.evidence || []).filter(e=>!e.profileId || e.profileId==='auto'),{...daily,events:daily.events.filter(e=>!e.profileId || e.profileId==='auto')}).tags,...learned.tags]);
      }
    }
    if (multimodal) auto.tags = auto.tags.filter(v => D.category(v.name)!=='noise' && !D.activeRules(daily.ignored).includes(v.name));
    else if (auto.evidence && learn) auto.tags = D.taste(auto.evidence, daily).tags;
    else auto.tags = auto.tags.filter(v => !['noise','format'].includes(D.category(v.name)) && !D.activeRules(daily.ignored).includes(v.name));
    return { version: 1, enabled: value?.enabled !== false, activeId: ids.has(value?.activeId) ? value.activeId : 'auto', auto, profiles, daily };
  }
  const activeProfile = (state) => state.profiles.find((p) => p.id === state.activeId) || state.auto;
  const isStrict = (state) => !!state?.enabled && state.activeId !== 'auto'
    && !!state.profiles?.some((p) => p.id === state.activeId);
  // Background learning must not invalidate an already visible feed. Only a
  // changed selection or custom filter requires removing the previous results.
  const feedSelection = (state) => JSON.stringify([state.enabled,
    state.enabled ? state.activeId : null, isStrict(state) ? activeProfile(state).tags : null, multimodal && state.enabled ? I.selection(activeProfile(state).interests) : null]);
  const feedChanged = (before, after) => feedSelection(before) !== feedSelection(after);
  // Missing data means an older peer, not a request to delete its profiles.
  function syncState(value) {
    if (value === undefined) return undefined;
    if (!value || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 20
      || typeof value.enabled !== 'boolean' || typeof value.activeId !== 'string'
      || new Set(value.profiles.map((p) => p?.id)).size !== value.profiles.length
      || value.profiles.some((p) => !p || typeof p.id !== 'string' || !p.id || p.id === 'auto' || p.id.length > 40
        || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40)
      || [value.auto, ...value.profiles].some((p) => !p || !Array.isArray(p.tags) || p.tags.length > 30
        || p.tags.some((tag) => !tag || typeof tag.name !== 'string' || !tag.name.trim() || tag.name.length > 40
          || !Number.isFinite(tag.weight) || tag.weight < 1 || tag.weight > 100))) {
      throw new Error('推荐画像同步数据无效或超过数量限制');
    }
    if (value.auto.evidence !== undefined && (!Array.isArray(value.auto.evidence)
      || value.auto.evidence.some((v) => !v || typeof v.bvid !== 'string' || !v.bvid || v.bvid.length > 40
        || !Object.hasOwn(SOURCE_WEIGHT, v.source) || typeof v.owner !== 'string' || v.owner.length > 40
        || !Number.isFinite(v.at) || v.at < 0 || (v.retryAt !== undefined && (!Number.isFinite(v.retryAt) || v.retryAt < 0)) || (v.tags !== undefined && (!Array.isArray(v.tags) || v.tags.length > 30
          || v.tags.some((name) => typeof name !== 'string' || !name || name.length > 40)))))) {
      throw new Error('画像累计分析记录无效');
    }
    [value.auto,...value.profiles].forEach(p=>I.validate(p.interests));
    D.validate(value.daily);
    return normalize(value, false);
  }
  function reconcile(base, local, remote) {
    local = syncState(local); remote = syncState(remote); base = syncState(base);
    if (!local || !remote) return local || remote;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const before = new Map((base?.profiles || []).map((p) => [p.id, p]));
    const left = new Map(local.profiles.map((p) => [p.id, p]));
    const right = new Map(remote.profiles.map((p) => [p.id, p]));
    const profiles = [...new Set([...left.keys(), ...right.keys()])].flatMap((id) => {
      if (before.has(id) && (!left.has(id) || !right.has(id))) return [];
      const l = left.get(id), r = right.get(id), b = before.get(id);
      if (!l || !r) return [l || r];
      if (!b) return [{...l,interests:I.merge(l.interests,r.interests)}];
      return [{ id, name: same(b.name, r.name) ? l.name : r.name,
        tags: same(b.tags, r.tags) ? l.tags : r.tags, interests:I.merge(l.interests,r.interests), learned:l.learned || r.learned }];
    });
    if (profiles.length > 20) throw new Error('合并后超过 20 份推荐画像，请先删除不需要的画像');
    const initial = local.profiles.length || local.auto.updatedAt || !local.enabled ? local : remote;
    const remoteNewer = remote.auto.updatedAt > local.auto.updatedAt || (remote.auto.updatedAt === local.auto.updatedAt
      && JSON.stringify(remote.auto.tags) > JSON.stringify(local.auto.tags));
    const result = { ...initial, profiles, auto: {...(remoteNewer ? remote.auto : local.auto), interests:I.merge(local.auto.interests,remote.auto.interests)} };
    if (local.auto.evidence || remote.auto.evidence) {
      result.auto = { ...result.auto, evidence: mergeEvidence(local.auto.evidence || [], remote.auto.evidence || []) };
    }
    for (const field of ['enabled', 'activeId']) {
      if (base) result[field] = same(base[field], remote[field]) ? local[field] : remote[field];
    }
    result.daily = D.merge(local.daily, remote.daily);
    return normalize(result, false);
  }
  function recentLikes(likes) {
    const seen = new Set();
    return (likes || []).filter((t) => {
      if (t?.isLive || !t?.bvid || seen.has(t.bvid)) return false;
      seen.add(t.bvid); return true;
    });
  }
  function recentSamples(likes, playlists = [], feed = []) {
    const seen = new Set();
    const groups = [
      { source: 'likes', tracks: likes },
      { source: 'playlists', tracks: playlists.flatMap((p) => p?.tracks || []) },
      { source: 'feed', tracks: feed },
    ].map((group) => recentLikes(group.tracks).filter((track) => {
      if (seen.has(track.bvid)) return false; seen.add(track.bvid); return true;
    }).map((track, index) => ({ track, index, source: group.source, weight: SOURCE_WEIGHT[group.source] })));
    const out = [];
    for (let i = 0; i < Math.max(...groups.map((g) => g.length)); i++) {
      for (const group of groups) if (group[i]) out.push(group[i]);
    }
    return out;
  }
  function infer(samples) {
    const owners = new Map(), weights = new Map();
    samples.forEach(({ track }) => { const id = track.mid || track.up || track.bvid; owners.set(id, (owners.get(id) || 0) + 1); });
    samples.forEach(({ track, tags: sourceTags, index, weight = 1 }) => {
      const valid = D.semantic({ ...track, tags: sourceTags });
      const contribution = weight * Math.pow(0.5, index / 8) / Math.sqrt(Math.max(1, valid.length))
        / Math.sqrt(owners.get(track.mid || track.up || track.bvid));
      valid.forEach(({ name }) => {
        const key = keyOf(name), previous = weights.get(key) || { name, weight: 0 };
        weights.set(key, { name: previous.name, weight: previous.weight + contribution });
      });
    });
    const ranked = [...weights.values()].map((tag) => ({ ...tag, weight: Math.log1p(tag.weight) }))
      .sort((a, b) => b.weight - a.weight).slice(0, 20);
    const max = ranked[0]?.weight || 1;
    return ranked.map((tag) => ({ ...tag, weight: Math.max(1, Math.round(tag.weight / max * 100)) }));
  }
  async function request(get, url) {
    let timer;
    const response = await Promise.race([
      Promise.resolve().then(() => get(url)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('推荐接口请求超时')), 8000); }),
    ]).finally(() => clearTimeout(timer));
    if (response.status !== 200) throw new Error(response.status === 412 || response.status === 429
      ? '推荐请求暂时被 B 站限制，请稍后重试' : '推荐接口暂时无法连接');
    const json = JSON.parse(response.body);
    if (json.code !== 0) throw new Error(json.message || '推荐接口请求失败');
    return json.data;
  }
  async function mapLimit(items, fn, stopOnFailure = false) {
    const results = [], deadline = Date.now() + 12000;
    for (let i = 0; i < items.length; i += 3) {
      if (Date.now() > deadline) break;
      const batch = await Promise.all(items.slice(i, i + 3).map((item, offset) => fn(item, i + offset)));
      results.push(...batch);
      if (stopOnFailure && !batch.some(Boolean)) break;
    }
    return results;
  }
  const tagCache = new Map();
  async function videoTags(get, bvid) {
    const cached = tagCache.get(bvid);
    if (cached && Date.now() - cached.at < 86400000) return cached.tags;
    const result = tags(await request(get, 'https://api.bilibili.com/x/tag/archive/tags?bvid=' + encodeURIComponent(bvid)));
    tagCache.set(bvid, { at: Date.now(), tags: result });
    if (tagCache.size > 200) tagCache.delete(tagCache.keys().next().value);
    return result;
  }
  function prepareBuild(recent, previous, force) {
    // Old versions retained video IDs in the fingerprint, but not their tags: backfill those once.
    const legacy = previous.evidence ? [] : String(previous.fingerprint || '').split(',').flatMap((entry) => {
      const [source, bvid] = entry.split(':');
      return bvid && Object.hasOwn(SOURCE_WEIGHT, source) ? [{ bvid, source, owner: bvid, at: previous.updatedAt || 0 }] : [];
    });
    const evidence = mergeEvidence(previous.evidence || legacy, recent.map(({ track, source }) => ({
      bvid: track.bvid, owner: String(track.mid || track.up || track.bvid), source, at: Date.now(),
      title: track.title, desc: track.desc || track.description, pic:track.pic, up:track.up, profileId:track.profileId,
    })));
    const pending = evidence.filter((v) => !Array.isArray(v.tags) && (force || !v.retryAt || v.retryAt <= Date.now()));
    // Bound work per turn, not the number of videos retained. Continue the queue in the background.
    const batch = pending.slice(0, 12);
    return { evidence, batch };
  }
  function finishBuild(evidence, batch, results, previous, hasRecent) {
    const successful = results.filter(Boolean);
    const failed = results.flatMap((v, i) => v ? [] : [{ ...batch[i], retryAt: Date.now() + 60000 }]);
    return { ...accumulated(mergeEvidence(evidence, successful, failed), previous),
      failures: results.filter((v) => !v).length, fingerprint: '',
      updatedAt: successful.length || hasRecent ? Date.now() : previous.updatedAt,
    };
  }
  async function build(recent, get, previous, force, compute) {
    const { evidence, batch } = compute ? await compute('profileBuildPrepare', recent, previous, force) : prepareBuild(recent, previous, force);
    const results = await mapLimit(batch, async (video) => {
      try { return { ...video, tags: (await videoTags(get, video.bvid)).map((t) => t.name) }; } catch { return null; }
    });
    return compute ? compute('profileBuildFinish', evidence, batch, results, previous, !!recent.length)
      : finishBuild(evidence, batch, results, previous, !!recent.length);
  }
  function recordEvidence(state,track,source,profileId) {
    if(!track?.bvid || !['likes','playlists'].includes(source)) return state;
    if(profileId!=='auto'&&!state.profiles.some(p=>p.id===profileId))return state;
    const value={bvid:track.bvid,owner:String(track.mid || track.up || track.bvid),up:track.up,pic:track.pic,title:track.title,desc:track.desc,source,profileId,at:Date.now(),...(Array.isArray(track.tags)?{tags:tags(track.tags).map(t=>t.name)}:{})};
    return {...state,auto:{...state.auto,evidence:mergeEvidence(state.auto.evidence||[],[value])}};
  }
  // Weighted round robin: strong interests recur more often; weaker ones still get discovery slots.
  function queries(profile, page = 0, batchSize) {
    const list = tags(multimodal ? I.interests(profile) : profile?.tags).sort((a, b) => b.weight - a.weight).slice(0, 12);
    if (!list.length) return [];
    const counts = list.map(() => 0), selected = [];
    const batch = batchSize || Math.min(3, list.length), offset = Math.max(0, Math.min(1000, Math.floor(page))) * batch;
    for (let i = 0; i < offset + batch; i++) {
      let best = 0;
      for (let j = 1; j < list.length; j++) if (list[j].weight / (counts[j] + 1) > list[best].weight / (counts[best] + 1)) best = j;
      counts[best]++;
      if (i >= offset) selected.push({ ...list[best], page: counts[best] });
    }
    return selected;
  }
  const interestKey = (name) => ['cos', 'cosplay', 'coser', 'cos正片', 'cosplay正片'].includes(keyOf(name)) ? 'cosplay' : keyOf(name);
  function titleMatches(title, name) {
    const word = keyOf(name);
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (interestKey(name) === 'cosplay') return /(^|[^a-z0-9])cos(?:play|er)?($|[^a-z0-9])/i.test(title);
    return /^[a-z0-9]/i.test(word) || /[a-z0-9]$/i.test(word)
      ? new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(title) : title.includes(word);
  }
  function legacyRank(candidates, profile, excluded = [], limit = 18, { tagsOnly = false } = {}) {
    const seen = new Set(excluded), selected = [], owners = new Map(), interests = tags(profile?.tags);
    const pool = candidates.filter((track) => {
      if (!track.bvid || seen.has(track.bvid)) return false;
      seen.add(track.bvid); return true;
    }).map((track) => {
      const names = new Set(tags(track.tags).map((tag) => interestKey(tag.name)));
      const title = String(track.title || '').normalize('NFKC').toLowerCase();
      const matches = interests.filter((tag) => names.has(interestKey(tag.name))
        // A broad hosiery interest includes its specific types, not vice versa.
        || (keyOf(tag.name) === '丝袜' && ['黑丝', '白丝', '肉丝', '连裤袜', '长筒袜'].some((name) => names.has(name)))
        || (!tagsOnly && titleMatches(title, tag.name)));
      const score = matches.reduce((sum, tag) => sum + tag.weight, 0);
      return { track, score, matches };
    }).filter((item) => item.score > 0);
    while (pool.length && selected.length < limit) {
      pool.sort((a, b) => b.score / (1 + (owners.get(b.track.mid || b.track.up) || 0) * 0.7)
        - a.score / (1 + (owners.get(a.track.mid || a.track.up) || 0) * 0.7));
      const { track, matches } = pool.shift();
      const owner = track.mid || track.up;
      owners.set(owner, (owners.get(owner) || 0) + 1);
      selected.push({ ...track, recommendationReason: `画像 · ${matches.slice(0, 2).map((tag) => tag.name).join(' / ')}` });
    }
    return selected;
  }
  function rank(candidates, profile, excluded = [], limit = 18, { tagsOnly = false, evidence = {}, prior = [] } = {}) {
    if (!multimodal) return legacyRank(candidates, profile, excluded, limit, {tagsOnly});
    const seen = new Set(excluded), selected = [], owners = new Map();
    const pool = candidates.filter(track => {
      if (!track?.bvid || seen.has(track.bvid)) return false;
      seen.add(track.bvid); return true;
    }).map(track => {
      // Preserve explicit aliases while sharing the same general theme gate.
      const labels=tags(track.tags).map(t=>t.name);
      if(labels.some(n=>interestKey(n)==='cosplay') || !tagsOnly && !/(cos(?:play|er)?|丝袜)(软件|应用|插件|代码)/i.test(track.title||'') && /(^|[^a-z0-9])cos(?:play|er)?($|[^a-z0-9])/i.test(track.title||'')) labels.push('cos','cosplay','coser');
      if(labels.some(n=>['黑丝','白丝','肉丝','连裤袜','长筒袜'].includes(n))) labels.push('丝袜');
      const value=I.evaluate({...track,title:tagsOnly?'':track.title,tags:labels},profile,evidence[track.bvid]);
      return {track,...value};
    }).filter(v=>v.eligible);
    let visualCount=prior.filter(t=>t.recommendationVisualOnly===true).length;
    while(pool.length && selected.length<limit) {
      pool.sort((a,b)=>b.score/(1+(owners.get(b.track.mid || b.track.up)||0)*0.7)-a.score/(1+(owners.get(a.track.mid || a.track.up)||0)*0.7));
      const index=pool.findIndex(v=>!v.visualOnly || visualCount<Math.floor((prior.length+selected.length+1)*0.2));
      if(index<0) break;
      const [next]=pool.splice(index,1);
      if(next.visualOnly) visualCount++;
      const owner=next.track.mid || next.track.up; owners.set(owner,(owners.get(owner)||0)+1);
      selected.push({...next.track,recommendationVisualOnly:next.visualOnly,recommendationReason:next.reasons.join(' · ')});
    }
    return selected;
  }
  async function recommend(profile, { get, page = 0, mode = 'music', exclude = [], strict = false, onBatch, daily = false, analyze = null }) {
    // Stream three distinct comprehensive-search pages per round.
    const dailyPage = Math.max(0, Math.floor(page));
    const searches = daily ? [0, 1, 2].map((offset) => ({ name: '日推', page: dailyPage * 3 + offset + 1, order: 'totalrank' }))
      : queries(profile, page, strict ? 3 : undefined);
    const seen = new Set(exclude), result = [], candidates = [];
    let failure;
    const resolveTrack = async (v) => {
      try {
        // Search already includes title, duration, partition and tags. Fetching
        // two extra endpoints per result caused hundreds of requests and HTTP 412.
        let detail = { ...v, aid: v.aid || v.id, tid: Number(v.typeid || v.tid),
          duration: typeof v.duration === 'number' ? v.duration
            : String(v.duration || '').split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0) };
        if (!v.title || v.duration == null || (mode === 'music' && !detail.tid)) {
          detail = await request(get, 'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(v.bvid));
        }
        if (!detail || (mode === 'music' && !MUSIC.has(Number(detail.tid)))) return null;
        let labels = tags(typeof v.tag === 'string' ? v.tag.split(',') : v.tags);
        if (v.tag == null && v.tags == null && !rank([{ ...detail, bvid: v.bvid }], profile).length) {
          try { labels = await videoTags(get, v.bvid); } catch(error) { if (!multimodal) throw error; failure=error; }
        }
        return { bvid: v.bvid, aid: detail.aid, cid: detail.cid, title: String(detail.title || '').replace(/<[^>]*>/g, '').slice(0, 500),
          up: detail.owner?.name || v.author || '', mid: detail.owner?.mid || v.mid,
          pic: String(detail.pic || v.pic || '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:'),
          duration: Number(detail.duration) || 0, tags: labels, tid: detail.tid, desc: detail.desc || v.description || '' };
      } catch (error) { failure = error; return null; }
    };
    await mapLimit(searches, async (query) => {
      let videos;
      try {
        const data = await request(get, 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword='
          + encodeURIComponent(query.name) + '&page=' + query.page
          + (query.order ? '&order=' + encodeURIComponent(query.order) : '')
          + (mode === 'music' ? '&tids=3' : ''));
        videos = (data.result || []).filter((v) => v.type === 'video' && v.bvid).slice(0, strict || daily ? 20 : 8)
          .filter((v) => {
            if (seen.has(v.bvid)) return false;
            seen.add(v.bvid); return true;
          });
      } catch (error) { failure = error; return; }
      const details = (await mapLimit(videos, resolveTrack)).filter(Boolean);
      analyze?.observe?.(details,profile);
      if (daily) {
        candidates.push(...details);
        if (details.length) onBatch?.(details, { order: 'totalrank' });
        return;
      }
      if (!strict) { candidates.push(...details); return; }
      // Publish completed pages without reordering the cards already shown.
      const batch = rank(details, profile, exclude, Math.max(0, 48 - result.length), {evidence:analyze?.evidence?.(details,profile) || {},prior:result});
      if (batch.length) {
        result.push(...batch);
        onBatch?.(batch);
      }
    });
    if (daily) result.push(...candidates);
    else if (!strict) result.push(...rank(candidates, profile, exclude,18,{evidence:analyze?.evidence?.(candidates,profile) || {}}));
    if (!result.length && failure) throw failure;
    return result;
  }
  function blend(base, suggested, random = Math.random) {
    const seen = new Set();
    const unique = (track) => {
      if (!track?.bvid || seen.has(track.bvid)) return false;
      seen.add(track.bvid); return true;
    };
    const discovery = base.filter(unique), candidates = suggested.filter(unique);
    // At most one profile insertion per four platform videos (20% of the result).
    const count = Math.min(candidates.length, Math.floor(discovery.length / 4));
    if (!count) return discovery;
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const insertions = new Map(), slots = discovery.map((_, index) => index);
    for (let i = 0; i < count; i++) {
      // Sample the whole batch without replacement: no mandatory insertion near its beginning.
      const [slot] = slots.splice(Math.floor(random() * slots.length), 1);
      insertions.set(slot, candidates[i]);
    }
    const out = [];
    discovery.forEach((track, index) => {
      out.push(track);
      if (insertions.has(index)) out.push(insertions.get(index));
    });
    return out;
  }
  function createManager({ read, write, get, getLikes, getPlaylists = () => [], compute, analysis = null, beginDaily = () => () => {} }) {
    if (!multimodal) analysis = null;
    else if (compute) {
      const execute = compute;
      compute = (operation, ...args) => execute(operation.startsWith('profile') ? 'discovery' + operation.slice(7) : operation, ...args);
    }
    let snapshot = { ...normalize(null), ready: false, busy: false, error: '', revision: 0 };
    let initial, building, dailyBuilding, dailyEpoch = 0, writes = Promise.resolve(), edits = Promise.resolve();
    let refreshTimer, disposed = false, syncValue;
    let observed = [], observing = false;
    const scheduleLearning = () => {
      if (disposed || refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (dailyBuilding) scheduleLearning();
        else refresh().catch(() => {}).finally(scheduleLearning);
      }, 15 * 60 * 1000);
      refreshTimer.unref?.();
    };
    const normalizeAsync = (value, learn = false) => compute ? compute('profileNormalize', value, learn) : Promise.resolve(normalize(value, learn));
    const selectSongs = (...args) => compute ? compute('dailySelectSongs', ...args) : Promise.resolve(D.selectSongs(...args));
    // Account-local search cursors survive pull-to-refresh; never sync browsing history.
    const strictFeeds = new Map(), dailyCache = new Map();
    const listeners = new Set();
    const emit = (patch) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); };
    const ready = () => initial || (initial = Promise.resolve().then(read).then(normalizeAsync).then((value) => {
      syncValue = value; emit({ ...value, ready: true, error: '' }); scheduleLearning();
    })
      .catch((error) => { initial = null; emit({ error: '画像读取失败，请重试' }); throw error; }));
    // Syncing exposure history or learned interests must not cancel a running
    // daily queue. Only an explicit selection/filter change invalidates it.
    const dailySelection = (state) => JSON.stringify([state.daily.profileId,
      state.profiles.find(p => p.id === state.daily.profileId)?.tags,
      ...['ignored', 'muted', 'blocked'].map(key => D.activeRules(state.daily[key]))]);
    const commit = (next, refresh, normalizedInput = false) => {
      let normalized, resetFeed;
      const task = writes.catch(() => {}).then(async () => {
        const value = typeof next === 'function' ? await next(snapshot) : next;
        if (!value) return; // An unchanged sync must not rewrite/publish the profile.
        normalized = normalizedInput ? value : await normalizeAsync(value);
        resetFeed = typeof refresh === 'function' ? refresh(snapshot, normalized) : refresh;
        return write(normalized);
      }).then(() => {
        if (!normalized) return;
        if (dailySelection(snapshot) !== dailySelection(normalized)) dailyEpoch++;
        syncValue = normalized;
        emit({ ...normalized, error: '', revision: snapshot.revision + (resetFeed ? 1 : 0) });
      });
      writes = task; return task;
    };
    async function refresh(force = false) {
      await ready();
      if (disposed) return;
      if (building) return building;
      clearTimeout(refreshTimer); refreshTimer = null;
      building = Promise.resolve().then(getPlaylists).then(async (playlists) => {
        const source = recentSamples(getLikes(), playlists, []);
        const knownSource = new Set(source.map((v) => v.track.bvid));
        snapshot.daily.events.filter(D.qualified).forEach((event) => {
          if (!knownSource.has(event.track.bvid)) { knownSource.add(event.track.bvid); source.push({ track: {...event.track,profileId:event.profileId || 'auto'}, source: 'listens' }); }
        });
        const known = new Map((snapshot.auto.evidence || []).map((v) => [v.bvid+':'+(v.profileId||'auto'), v]));
        const changed = source.some((s) => !known.has(s.track.bvid+':'+(s.track.profileId||'auto'))
          || SOURCE_WEIGHT[s.source] > SOURCE_WEIGHT[known.get(s.track.bvid+':'+(s.track.profileId||'auto')).source]);
        if (!force && !changed && snapshot.auto.evidence
          && !snapshot.auto.evidence.some((v) => !v.tags && (!v.retryAt || v.retryAt <= Date.now()))) {
          await commit(current => normalizeAsync(current, true), false, true);
          return;
        }
        emit({ busy: true, error: '' });
        const auto = await build(source, get, snapshot.auto, force, compute);
        if (disposed) return;
        await commit((current) => normalizeAsync({ ...current, auto: multimodal ? {...auto,interests:I.merge(auto.interests,current.auto.interests),evidence:mergeEvidence(auto.evidence||[],current.auto.evidence||[])} : auto }, true),
          (current) => force && current.enabled && current.activeId === 'auto', true);
        if (auto.failures) emit({ error: '部分视频标签暂未获取，已保留累计画像，可稍后重试' });
      })
        .catch((error) => { emit({ error: error.message }); })
        .finally(() => {
          building = null; emit({ busy: false });
          scheduleLearning();
        });
      return building;
    }
    async function edit(action) {
      await ready();
      if (building && !multimodal) await building;
      await writes.catch(() => {});
      const next = await normalizeAsync(snapshot);
      if (action.type === 'enable') next.enabled = !!action.enabled;
      else if (action.type === 'select') {
        next.activeId = action.id;
        if (typeof action.enabled === 'boolean') next.enabled = action.enabled;
      }
      else if (action.type === 'delete') {
        next.profiles = next.profiles.filter((p) => p.id !== action.id);
        if (next.activeId === action.id) next.activeId = 'auto';
      } else if (action.type === 'interests') {
        if (!multimodal) throw Error('扩展画像仅用于发现页');
        const p = action.id==='auto' ? next.auto : next.profiles.find(p=>p.id===action.id);
        if (!p) throw Error('画像不存在');
        p.interests=I.normalize({...p.interests,...action.patch,at:Date.now()});
      } else if (action.type === 'save') {
        const name = clean(action.name), labels = tags(action.tags);
        if (!name || (!labels.length && (!multimodal || !String(action.interests?.description ?? next.profiles.find(p=>p.id===action.id)?.interests?.description ?? '').trim()))) throw new Error(multimodal ? '请填写画像名称，并添加兴趣主题或描述' : '请填写画像名称并添加至少一个标签');
        const old = next.profiles.find((p) => p.id === action.id);
        if (!old && next.profiles.length >= 20) throw new Error('最多保存 20 份画像，请先删除不需要的画像');
        const id = old?.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        const profile = { ...old, id, name, tags: labels, ...(multimodal ? {interests:I.normalize({...old?.interests,...action.interests,at:Date.now()})} : {}) };
        next.profiles = old ? next.profiles.map((p) => p.id === id ? profile : p) : [...next.profiles, profile];
        next.activeId = id;
      }
      try { await commit(next, feedChanged); } catch (error) { emit({ error: '画像保存失败，请重试' }); throw error; }
    }
    const enqueue = (operation) => { const task = edits.catch(() => {}).then(operation); edits = task; return task; };
    async function generateDaily(force = false) {
      await ready();
      if (disposed) return;
      if (dailyBuilding) return dailyBuilding;
      const cached = D.current(snapshot.daily);
      const old = cached?.source === D.SOURCE ? cached : null;
      if (!force && old && (old.complete || old.error && Date.now() - old.updatedAt < 60000)) return old;
      const finishDaily = beginDaily();
      dailyBuilding = (async () => {
        emit({ dailyBusy: true, dailyError: '' });
        const profileId = snapshot.profiles.some(p => p.id === snapshot.daily.profileId) ? snapshot.daily.profileId : 'auto';
        const strict = profileId === 'auto' ? null : snapshot.profiles.find(p => p.id === profileId);
        const ignored = new Set(D.activeRules(snapshot.daily.ignored).map(D.canonical));
        const searchProfile = { tags: (strict?.tags || snapshot.auto.tags).filter(t => !ignored.has(D.canonical(t.name))) };
        const epoch = dailyEpoch, deadline = Date.now() + 90000;
        const stopped = () => disposed || epoch !== dailyEpoch || snapshot.daily.profileId !== profileId;
        const source = M.create({ get, cache: dailyCache, profile: searchProfile, state: () => snapshot.daily, stopped: () => stopped() || Date.now() >= deadline,
          decode: compute ? (body,kind) => compute('dailySourceDecode',body,kind) : M.decode });
        let entry = !force && old && old.profileId === profileId ? { ...old } : {
          date: D.dayKey(), profileId, source: D.SOURCE, profileName: strict?.name || '自动画像', generatedAt: Date.now(), updatedAt: Date.now(),
          tracks: [], complete: false, rounds: 0, error: '', themes: searchProfile.tags.slice(0, 3).map((v) => v.name),
        };
        const save = async (final = false) => {
          if (stopped()) return;
          entry.updatedAt = Date.now();
          const saved = { ...entry, tracks: [...entry.tracks] };
          await commit(async s => {
            if (stopped()) return null;
            const seen = new Set(s.daily.shown.map(v=>v.bvid));
            const fresh = saved.tracks.filter(t=>!seen.has(t.bvid));
            const daily = { ...s.daily, profileId,
              shown: [...s.daily.shown,...fresh.map(t=>({bvid:t.bvid,at:saved.updatedAt}))],
              shownSongs: [...s.daily.shownSongs,...fresh.flatMap(t=>D.songKeys(t).map(key=>({key,at:saved.updatedAt})))],
              candidates: [...s.daily.candidates, ...saved.tracks],
              days: [...s.daily.days.filter(v=>v.date!==saved.date||v.profileId!==profileId),saved] };
            // Progress changes only daily data; learned weights change on the timer.
            return { ...syncValue, daily: final ? daily : compute ? await compute('dailyNormalize', daily) : D.normalize(daily) };
          }, false, !final);
        };
        try {
          entry.error = '';
          await save();
          let attempts = 0, consumed = 0, failures = 0;
          // A single artist profile intentionally allows multiple different songs.
          const artistLimit = source.queries.length === 1 && !source.queries[0].category ? 24 : 2;
          for (let round = 0; round < DAILY_MAX_ROUNDS && entry.tracks.length < 24 && !stopped() && Date.now() < deadline; round++) {
            await source.next();
            const pending = [];
            // Reserve only a few candidates per artist per recall round; rejected
            // versions do not permanently exclude that artist from later rounds.
            const counts = new Map();
            for (; consumed < source.pool.length && pending.length < 24; consumed++) {
              const song = source.pool[consumed], artist = D.songText(song.artists[0]);
              const existing = entry.tracks.filter(t => D.songText(t.song?.artists?.[0]) === artist).length;
              if (existing >= artistLimit || (counts.get(artist)||0) >= Math.max(3,artistLimit)) continue;
              counts.set(artist,(counts.get(artist)||0)+1); pending.push(song);
            }
            for (let i=0;i<pending.length && entry.tracks.length<24 && attempts<150 && !stopped() && Date.now()<deadline;i+=3) {
              const batch = await Promise.all(pending.slice(i,i+3).map(async song => {
                attempts++;
                try { const value=await source.resolve(song); return {value}; } catch(error) { return {error}; }
              }));
              failures = batch.every(v=>v.error) ? failures+1 : 0;
              if (stopped()) break;
              const items = batch.map(v=>v.value).filter(Boolean);
              entry.tracks = await selectSongs(items,snapshot.daily,entry.tracks,24,artistLimit);
              await save();
              if(failures>=2) throw batch.find(v=>v.error).error;
            }
            entry.rounds++;
            if(attempts>=150) break;
          }
          entry.complete = entry.tracks.length >= DAILY_MIN_TRACKS;
          entry.error = entry.complete ? '' : (source.error?.message || `只找到 ${entry.tracks.length} 首未重复的匹配歌曲，请稍后继续获取`);
        } catch(error) {
          entry.complete = entry.tracks.length >= DAILY_MIN_TRACKS;
          entry.error = entry.complete ? '' : error.message || '暂时无法获取推荐，请稍后重试';
        }
        await save(true);
        return entry;
      })().catch((e) => { emit({ dailyError: e.message }); }).finally(() => { dailyBuilding = null; emit({ dailyBusy: false }); finishDaily(); });
      return dailyBuilding;
    }
    return { ready, refresh, analysis,
      async recordPreference(track,source='playlists',profileId=snapshot.activeId) {
        await ready(); if(disposed || !multimodal)return;
        return commit(s=>compute?compute('profileEvidence',s,track,source,profileId):recordEvidence(s,track,source,profileId),false);
      }, edit: (action) => enqueue(() => edit(action)),
      generateDaily,
      async dailyAction(action) {
        await ready();
        dailyEpoch++; // Profile/menu actions never wait for catalog or video requests.
        await commit((s) => {
          let daily = s.daily;
          if (action.type === 'profile') daily = { ...daily, profileId: s.profiles.some((p) => p.id === action.id) ? action.id : 'auto', profileAt: Date.now() };
          else daily = D.rule(daily, action.type, action.name, action.active !== false);
          if (action.type === 'blocked' && action.active !== false) daily = { ...daily, days: daily.days.map((d) => ({ ...d, updatedAt: Date.now(), tracks: d.tracks.filter((t) => t.bvid !== action.name) })) };
          return { ...s, daily };
        }, false);
      },
      async recordListening(event) {
        const profileId=event.profileId || snapshot.activeId;
        await ready();
        event={...event,profileId};
        if (disposed || !D.compact(event.track)) return;
        await commit(() => compute ? compute('profileListening', syncValue, event)
          : { ...syncValue, daily: D.feedback(syncValue.daily, event) }, false, true);
      },
      observeFeed(items) {
        observed.push(...(items || []));
        if (observing) return;
        const flush = () => {
          observing = true;
          ready().then(async () => {
            while (!disposed && observed.length) {
              const batch = observed; observed = [];
              await commit(() => compute ? compute('profileObserve', syncValue, batch)
                : { ...syncValue, daily: D.observe(syncValue.daily, batch) }, false, true);
            }
          }).catch(() => {}).finally(() => {
            observing = false;
            if (observed.length && !disposed) flush(); else observed = [];
          });
        };
        flush();
      },
      dispose() { disposed = true; clearTimeout(refreshTimer); refreshTimer = null; listeners.clear(); },
      setActive(active) {
        disposed = !active; clearTimeout(refreshTimer); refreshTimer = null;
        if (active) ready().then(scheduleLearning).catch(() => {});
      },
      async exportSync() {
        await ready(); await edits.catch(() => {}); await writes.catch(() => {});
        // Treat exports as immutable snapshots. Idle LAN probes reuse the same
        // value; every committed edit replaces snapshot and invalidates it.
        return syncValue;
      },
      applySync(incoming, base) {
        if (incoming === undefined) return Promise.resolve();
        return enqueue(async () => {
          await ready();
          if (building) await building;
          // Reconcile inside the serialized write, against the latest partial
          // queue; a slow worker result must not overwrite songs saved meanwhile.
          await commit(async (current) => {
            if (compute) return compute('profileReconcile', base, incoming, current);
            const previous = normalize(current, false);
            const next = reconcile(base, incoming, previous);
            return JSON.stringify(next) === JSON.stringify(previous) ? null : next;
          }, feedChanged, true);

        });
      },
      getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      async recommend(options) {
        await ready();
        if (!snapshot.enabled) return [];
        const profile = activeProfile(snapshot), strict = isStrict(snapshot);
        const exclude = [...(options?.exclude || []), ...(getLikes() || []).filter((t) => t?.bvid).map((t) => t.bvid)];
        let page = options?.page || 0, feed;
        if (strict) {
          const key = JSON.stringify([profile.id, profile.tags, multimodal ? I.selection(profile.interests) : null, options?.mode || 'music']);
          if (!strictFeeds.has(key)) {
            if (strictFeeds.size >= 40) strictFeeds.delete(strictFeeds.keys().next().value);
            strictFeeds.set(key, { page: 0, seen: new Set() });
          }
          feed = strictFeeds.get(key);
          page = feed.page;
          if (page >= 1000) return [];
          // Reserve before I/O so a second refresh cannot repeat an in-flight batch.
          feed.page += 1;
          exclude.push(...feed.seen);
        }
        const delivered = [];
        const onBatch = (batch) => {
          const fresh = batch.filter((track) => !feed.seen.has(track.bvid));
          fresh.forEach((track) => feed.seen.add(track.bvid));
          delivered.push(...fresh);
          if (fresh.length) options?.onBatch?.(fresh);
        };
        let result;
        try { result = await recommend(profile, { ...options, analyze:analysis, page, strict, get, exclude, onBatch: strict ? onBatch : undefined }); }
        catch (error) {
          if (feed && feed.page === page + 1) feed.page = page;
          throw error;
        }
        if (!feed) return result;
        while (feed.seen.size > 1000) feed.seen.delete(feed.seen.values().next().value);
        return delivered;
      } };
  }
  function parseTagsText(text) {
    const lines = String(text || '').split(/\n|,|，/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 30) throw new Error('每份画像最多 30 个标签');
    return tags(lines.map((line) => {
      const match = line.match(/^(.*?)(?:[:：=]\s*(\d+(?:\.\d+)?))?$/);
      const name = clean(match[1]), weight = match[2] == null ? 50 : Number(match[2]);
      if (!name || name.length > 40 || weight < 1 || weight > 100 || /[:：=]/.test(name)) throw new Error('标签格式应为「标签:权重」，权重为 1–100');
      return { name, weight };
    }));
  }
  const tagsText = (labels) => tags(labels).map((tag) => `${tag.name}:${tag.weight}`).join('\n');
  return { recordEvidence, prepareBuild, finishBuild, parseTagsText, tagsText, tags, normalize, syncState, reconcile, infer, recentLikes, recentSamples, activeProfile, isStrict, queries, rank, blend, createManager };
});
