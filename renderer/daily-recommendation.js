/* Pure, shared daily selection and metadata rules. No model or platform runtime. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./music-dictionary'));
  else root.BiuDaily = factory(root.BiuMusicDictionary);
})(typeof window === 'object' ? window : this, function (dictionaryData) {
  const DAY = 86400000;
  const SOURCE = 'ritui-search-v1';
  const clean = (v, max = 500) => String(v || '').normalize('NFKC').replace(/<[^>]*>/g, '').trim().slice(0, max);
  const key = (v) => clean(v, 80).toLowerCase();
  const MUSIC = new Set([3, 28, 29, 30, 31, 59, 130, 193, 194, 243, 244, 265, 267]);
  const PROMO = /商务|合作联系|加群|公众号|关注.*点赞|一键三连|征集令|音乐分享官|活动投稿|创作激励/;
  const dictionary = dictionaryData.entries;
  const aliases = new Map(dictionary.flatMap(([type, name, ...words]) => [name, ...words].map((v) => [dictionaryData.normalized(v), { type, name }])));
  const canonical = (name) => aliases.get(dictionaryData.normalized(name))?.name || clean(name, 40);
  const category = (name) => dictionaryData.isNoise(name) ? 'noise' : aliases.get(dictionaryData.normalized(name))?.type || (dictionaryData.isFormat(name) ? 'format' : 'tag');
  const escaped = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function contains(text, term) {
    const pattern = /[a-z]/i.test(term) ? `(^|[^a-z0-9])(${escaped(term)})(?=$|[^a-z0-9])` : escaped(term);
    const match = new RegExp(pattern, 'i').exec(text);
    return !!match && !/(不是|并非|非|不要|告别|not\s+)\s*$/i.test(text.slice(Math.max(0, match.index - 8), match.index));
  }
  function labels(track) {
    return (typeof track.tag === 'string' ? track.tag.split(',') : Array.isArray(track.tags) ? track.tags : [])
      .map((v) => clean(typeof v === 'string' ? v : v?.name || v?.tag_name, 40)).filter(Boolean).slice(0, 30);
  }
  const words = [...new Set(dictionary.flatMap((row) => row.slice(1)))].sort((a, b) => b.length - a.length);
  // Two compiled scans rather than hundreds of regex passes per title on low-end phones.
  const matchers = [
    new RegExp(`(^|[^a-z0-9])(${words.filter((v) => /[a-z]/i.test(v)).map(escaped).join('|')})(?=$|[^a-z0-9])`, 'gi'),
    new RegExp(`(${words.filter((v) => !/[a-z]/i.test(v)).map(escaped).join('|')})`, 'gi'),
  ];
  function scan(text) {
    const occupied = [], result = [], matches = [];
    for (const regex of matchers) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text))) {
        const word = match.at(-1), item = aliases.get(dictionaryData.normalized(word));
        const start = match.index + (match.length === 3 ? match[1].length : 0), end = start + word.length;
        matches.push({ ...item, start, end });
      }
    }
    for (const { start, end, ...item } of matches.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
        if (/(不是|并非|不要|告别|非|not\s+)\s*$/i.test(text.slice(Math.max(0, start - 8), start))
          || occupied.some(([a, b]) => start < b && end > a)) continue;
        occupied.push([start, end]); result.push(item);
    }
    return result;
  }
  const extractionCache = new Map();
  function extract(track, ignored = []) {
    const cacheKey = JSON.stringify([track.title, track.desc || track.description, labels(track), ignored]);
    if (extractionCache.has(cacheKey)) return extractionCache.get(cacheKey);
    const exclude = new Set(ignored.map((v) => key(canonical(v))));
    const found = new Map();
    function add(name, source, confidence, type = category(name)) {
      name = canonical(name);
      if (!name || type === 'noise' || dictionaryData.isNoise(name) || exclude.has(key(name))) return;
      const prev = found.get(key(name));
      if (!prev || prev.confidence < confidence) found.set(key(name), { name, type, source, confidence });
    }
    labels(track).forEach((value) => {
      const parts = value.split(/[,，、;；|/·]/).map((v) => v.trim()).filter(Boolean);
      for (const name of parts) {
        const type = category(name), hits = scan(name);
        if (type !== 'tag' || !hits.length) add(name, '标签', type === 'tag' ? 0.35 : 1, type);
        hits.forEach((v) => add(v.name, '标签', 1, v.type));
      }
    });
    const title = clean(track.title);
    const desc = clean(track.desc || track.description, 3000).split(/\n|[。；]/)
      .filter((line) => !PROMO.test(line)).join('\n').replace(/https?:\/\/\S+/g, '');
    scan(title).forEach((v) => add(v.name, '标题', 0.85, v.type));
    scan(desc).forEach((v) => add(v.name, '简介', v.type === 'artist' ? 0.25 : 0.4, v.type));
    const result = [...found.values()];
    if (extractionCache.size >= 2000) extractionCache.delete(extractionCache.keys().next().value);
    extractionCache.set(cacheKey, result);
    return result;
  }
  const semantic = (track, ignored) => extract(track, ignored).filter((v) => v.type !== 'format');
  function isCompilation(track) {
    if (!track || typeof track !== 'object') return false;
    // Look at the video's own title/tags, not an introduction mentioning an album.
    const values = [clean(track.title), ...labels(track)];
    return values.some((text) => /歌单|合集|精选集|串烧|连播|全专|整专|整张专辑|专辑完整版|完整专辑|专辑全曲|全碟/i.test(text)
      || /\b(playlist|compilation|medley|non[ -]?stop|full album|complete album|entire album|greatest hits|best of|dj[ -]?set|dj[ -]?mix)\b/i.test(text)
      || /\bmix(?:es)?\b/i.test(text) && !/\b(little mix|original mix|radio mix|extended mix|club mix|vocal mix|instrumental mix|dub mix|single mix|album mix)\b/i.test(text));
  }
  const durationOf = (track) => track?.isSegment && Number.isFinite(track.from) && Number.isFinite(track.to)
    ? Math.max(0, track.to - track.from) : Math.max(0, Number(track?.duration) || 0);
  const withinDuration = (track, range) => Number.isFinite(durationOf(track)) && durationOf(track) > 0
    && durationOf(track) >= range.min && durationOf(track) <= range.max;
  const dayKey = (at = Date.now()) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hash = (text) => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  function compact(t) {
    if (!t || !/^BV\w{1,38}$/.test(t.bvid || '') || t.isLive) return null;
    const out = { bvid: t.bvid, title: clean(t.title), up: clean(t.up || t.owner?.name, 100),
      mid: clean(t.mid || t.owner?.mid, 40), pic: /^https?:\/\//.test(t.pic || '') ? clean(t.pic, 2048) : '',
      duration: Math.max(0, Number(t.duration) || 0), tid: Number(t.tid || t.typeid) || 0, tags: labels(t),
      desc: clean(t.desc || t.description, 1500), at: Number(t.at) || Date.now() };
    for (const k of ['cid', 'aid']) if (Number.isFinite(Number(t[k]))) out[k] = Number(t[k]);
    if (t.isSegment && Number.isFinite(t.from) && Number.isFinite(t.to) && t.from >= 0 && t.to > t.from) {
      Object.assign(out, { isSegment: true, from: t.from, to: t.to });
    }
    if (t.recommendationReason) out.recommendationReason = clean(t.recommendationReason, 240);
    if (Array.isArray(t.matchedTags)) out.matchedTags = t.matchedTags.map((v) => clean(v, 40)).slice(0, 5);
    return out;
  }
  const unique = (items, getKey) => [...new Map(items.map((v) => [getKey(v), v])).values()];
  function normalize(value = {}) {
    // Fixed single-track eligibility; old editable ranges no longer affect selection.
    const duration = { min: 60, max: 600, at: 0 };
    const rejected = (t) => isCompilation(t) || !withinDuration(t, duration);
    const rules = (list) => unique((Array.isArray(list) ? list : []).filter((v) => v && typeof v.name === 'string')
      .map((v) => ({ name: clean(v.name, 40), active: v.active !== false, at: Math.max(0, Number(v.at) || 0) })), (v) => key(v.name)).slice(-200);
    const events = unique((Array.isArray(value.events) ? value.events : []).filter((v) => v && typeof v.id === 'string' && compact(v.track))
      .map((v) => ({ id: clean(v.id, 100), track: compact(v.track), at: Math.max(0, Number(v.at) || 0),
        seconds: Math.max(0, Math.min(14400, Number(v.seconds) || 0)), manual: !!v.manual, search: !!v.search })), (v) => v.id)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-4000);
    const days = unique((Array.isArray(value.days) ? value.days : []).filter((v) => v && /^\d{4}-\d{2}-\d{2}$/.test(v.date) && typeof v.profileId === 'string')
      .map((v) => ({ date: v.date, profileId: clean(v.profileId, 40), profileName: clean(v.profileName, 40),
        source: v.source === SOURCE ? SOURCE : '',
        generatedAt: Math.max(0, Number(v.generatedAt) || 0), updatedAt: Math.max(0, Number(v.updatedAt) || 0),
        tracks: unique((Array.isArray(v.tracks) ? v.tracks : []).map(compact).filter((t) => t && !rejected(t)), (t) => t.bvid).slice(0, 24),
        complete: !!v.complete && !(Array.isArray(v.tracks) ? v.tracks : []).some(rejected),
        rounds: (Array.isArray(v.tracks) ? v.tracks : []).some(rejected) ? 0 : Math.max(0, Math.min(3, Number(v.rounds) || 0)), error: clean(v.error, 180),
        themes: (Array.isArray(v.themes) ? v.themes : []).map((v) => clean(v, 40)).slice(0, 3) })), (v) => `${v.date}:${v.profileId}`)
      .sort((a, b) => a.date.localeCompare(b.date) || a.profileId.localeCompare(b.profileId)).slice(-28);
    return { version: 1, duration, profileId: clean(value.profileId || 'auto', 40), profileAt: Math.max(0, Number(value.profileAt) || 0),
      ignored: rules(value.ignored), muted: rules(value.muted), blocked: rules(value.blocked), events, days,
      candidates: unique((Array.isArray(value.candidates) ? value.candidates : []).map(compact).filter(Boolean), (t) => t.bvid)
        .sort((a, b) => a.at - b.at || a.bvid.localeCompare(b.bvid)).slice(-600) };
  }
  function validate(value) {
    if (value === undefined) return normalize();
    if (!value || value.version !== 1 || typeof value.profileId !== 'string'
      || value.duration !== undefined && (!value.duration || !Number.isFinite(value.duration.min) || !Number.isFinite(value.duration.max)
        || value.duration.min < 0 || value.duration.max <= value.duration.min || value.duration.max > 7200 || !Number.isFinite(value.duration.at))
      || ['ignored', 'muted', 'blocked', 'events', 'days', 'candidates'].some((k) => !Array.isArray(value[k]))
      || value.events.length > 4000 || value.candidates.length > 600 || value.days.length > 28
      || ['ignored', 'muted', 'blocked'].some((k) => value[k].length > 200 || value[k].some((v) => !v || typeof v.name !== 'string' || v.name.length > 40 || !Number.isFinite(v.at)))
      || [...value.candidates, ...value.events.map((v) => v?.track), ...value.days.flatMap((v) => Array.isArray(v?.tracks) ? v.tracks : [null])].some((v) => !compact(v))
      || value.events.some((v) => !v || typeof v.id !== 'string' || !Number.isFinite(v.at) || !Number.isFinite(v.seconds))
      || value.days.some((v) => v.tracks.length > 24 || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || typeof v.profileId !== 'string' || !Number.isFinite(v.generatedAt))) throw new Error('每日推荐同步数据无效');
    return normalize(value);
  }
  const activeRules = (rules) => rules.filter((v) => v.active).map((v) => v.name);
  function merge(left, right) {
    const a = normalize(left), b = normalize(right);
    const later = (x, y, field = 'at') => x[field] !== y[field] ? (x[field] > y[field] ? x : y) : JSON.stringify(x) > JSON.stringify(y) ? x : y;
    const join = (x, y, id, combine) => { const m = new Map(x.map((v) => [id(v), v])); y.forEach((v) => m.set(id(v), m.has(id(v)) ? combine(m.get(id(v)), v) : v)); return [...m.values()]; };
    return normalize({ ...later(a, b, 'profileAt'),
      duration: later(a.duration, b.duration),
      ...Object.fromEntries(['ignored', 'muted', 'blocked'].map((k) => [k, join(a[k], b[k], (v) => key(v.name), later)])),
      events: join(a.events, b.events, (v) => v.id, (x, y) => ({ ...later(x, y), seconds: Math.max(x.seconds, y.seconds) })),
      candidates: join(a.candidates, b.candidates, (v) => v.bvid, later),
      days: join(a.days, b.days, (v) => `${v.date}:${v.profileId}`, (x, y) => {
        if (x.generatedAt !== y.generatedAt) return later(x, y, 'generatedAt');
        return later(x, y, 'updatedAt');
      }),
    });
  }
  function observe(state, items) { return normalize({ ...state, candidates: [...state.candidates, ...items.map(compact).filter(Boolean)] }); }
  function rule(state, field, name, active = true) {
    if (!['ignored', 'muted', 'blocked'].includes(field) || !clean(name, 40)) throw new Error('请选择有效标签或视频');
    name = field === 'blocked' ? clean(name, 40) : canonical(name);
    return normalize({ ...state, [field]: [...state[field].filter((v) => key(v.name) !== key(name)), { name, active, at: Date.now() }] });
  }
  function feedback(state, event) {
    const old = state.events.find((v) => v.id === event.id);
    return normalize({ ...state, candidates: [...state.candidates, event.track],
      events: [...state.events.filter((v) => v.id !== event.id), { ...event, seconds: Math.max(old?.seconds || 0, event.seconds) }] });
  }
  function qualified(event) {
    const duration = event.track.isSegment ? event.track.to - event.track.from : event.track.duration;
    return event.seconds >= (duration > 0 ? Math.min(240, duration * 0.9, Math.max(8, duration * 0.6)) : 60);
  }
  function taste(evidence, daily, now = Date.now()) {
    const ignored = activeRules(daily.ignored), muted = new Set(activeRules(daily.muted).map(key));
    const records = new Map(evidence.map((v) => [v.bvid, { track: { bvid: v.bvid, mid: v.owner, title: v.title, desc: v.desc, tags: v.tags },
      weight: v.source === 'likes' ? 5 : v.source === 'playlists' ? 3 : v.source === 'listens' ? 1 : 0, at: v.at }]));
    const dailyPlays = new Map();
    for (const event of daily.events.filter(qualified)) {
      const id = `${dayKey(event.at)}:${event.track.bvid}`, count = dailyPlays.get(id) || 0;
      dailyPlays.set(id, count + 1);
      const record = records.get(event.track.bvid) || { track: event.track, weight: 0, at: event.at };
      if (count < 2) record.weight += 1 + (event.search ? 2 : event.manual && count ? 2 : 0);
      record.at = Math.max(record.at, event.at);
      record.track = { ...record.track, ...event.track, tags: record.track.tags?.length ? record.track.tags : event.track.tags };
      records.set(event.track.bvid, record);
    }
    const valid = [...records.values()].filter((v) => v.weight > 0);
    const owners = new Map(), df = new Map(), long = new Map(), recent = new Map();
    const corpus = daily.candidates.length >= 30 ? daily.candidates : valid.map((v) => v.track);
    corpus.forEach((t) => semantic(t, ignored).forEach((v) => df.set(key(v.name), (df.get(key(v.name)) || 0) + 1)));
    valid.forEach((v) => { const owner = v.track.mid || v.track.bvid; owners.set(owner, (owners.get(owner) || 0) + 1); });
    valid.forEach((v) => {
      const terms = semantic(v.track, ignored), age = Math.max(0, (now - v.at) / DAY);
      terms.forEach((t) => {
        const idf = Math.min(2, Math.max(0.5, Math.log(1 + corpus.length / (1 + (df.get(key(t.name)) || 0)))));
        const score = Math.min(v.weight, 12) * t.confidence * idf / Math.sqrt(Math.max(1, terms.length))
          / Math.sqrt(owners.get(v.track.mid || v.track.bvid)) * (muted.has(key(t.name)) ? 0.15 : 1);
        long.set(t.name, (long.get(t.name) || 0) + score * Math.max(0.25, 0.5 ** (age / 90)));
        if (age <= 14) recent.set(t.name, (recent.get(t.name) || 0) + score * 0.5 ** (age / 7));
      });
    });
    const scaled = (map) => { const max = Math.max(1, ...map.values()); return [...map].map(([name, weight]) => ({ name, weight: weight / max * 100 })).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, 30); };
    const l = scaled(long), r = scaled(recent), merged = new Map(l.map((v) => [v.name, v.weight * 0.6]));
    r.forEach((v) => merged.set(v.name, (merged.get(v.name) || 0) + v.weight * 0.4));
    return { long: l, recent: r, tags: scaled(merged).slice(0, 20).map((v) => ({ ...v, weight: Math.max(1, Math.round(v.weight)) })) };
  }
  function select(candidates, state, interest, selected = [], limit = 24, strict = null) {
    const ignored = activeRules(state.ignored), blocked = new Set(activeRules(state.blocked));
    const recentDays = state.days.filter((v) => Date.now() - new Date(v.date + 'T12:00:00').getTime() < 7 * DAY);
    const previous = new Set(recentDays.flatMap((v) => v.tracks.map((t) => t.bvid)));
    const played = new Set(state.events.filter((v) => qualified(v) && Date.now() - v.at < 7 * DAY).map((v) => v.track.bvid));
    const today = dayKey();
    const termsOf = (t) => semantic(t, ignored);
    const match = (t, terms, list) => list.filter((v) => terms.some((x) => key(x.name) === key(canonical(v.name)))
      || strict && labels(t).some((name) => key(canonical(name)) === key(canonical(v.name))) || contains(clean(t.title), v.name));
    const relevance = (list) => list.reduce((sum, v) => sum + v.weight, 0) / Math.max(100, interest.tags.slice(0, 3).reduce((sum, v) => sum + v.weight, 0));
    const interests = strict?.tags || interest.tags;
    const primary = (t) => match(t, termsOf(t), interests)[0]?.name;
    const used = new Set(selected.map((v) => v.bvid)), out = [...selected];
    let pool = unique(candidates.map(compact).filter(Boolean), (v) => v.bvid).filter((t) => MUSIC.has(t.tid) && !isCompilation(t)
      && withinDuration(t, state.duration) && !blocked.has(t.bvid) && !used.has(t.bvid))
      .map((t) => {
        const terms = termsOf(t), hits = match(t, terms, strict?.tags || interest.tags);
        if ((strict || interest.tags.length) && !hits.length) return null;
        const base = strict ? relevance(hits) : 0.6 * relevance(match(t, terms, interest.long)) + 0.3 * relevance(match(t, terms, interest.recent));
        return { t, terms, hits, base: base + (played.has(t.bvid) ? 0 : 0.1) - (previous.has(t.bvid) ? 0.12 : 0) - (played.has(t.bvid) ? 0.2 : 0) };
      }).filter(Boolean);
    while (pool.length && out.length < limit) {
      const counts = new Map(); out.forEach((t) => { if (t.mid) counts.set(t.mid, (counts.get(t.mid) || 0) + 1); });
      const selectedTerms = out.map(termsOf);
      const primaryCounts = new Map(), unknownCounts = new Map();
      out.forEach((t) => {
        const name = primary(t);
        if (name) primaryCounts.set(key(name), (primaryCounts.get(key(name)) || 0) + 1);
        if (!strict) match(t, termsOf(t), interests).filter((v) => category(v.name) === 'tag').forEach((v) => {
          unknownCounts.set(key(v.name), (unknownCounts.get(key(v.name)) || 0) + 1);
        });
      });
      pool = pool.filter(({ t, hits }) => (!t.mid || (counts.get(t.mid) || 0) < 2)
        && (interests.length < 2 || !hits.length || (primaryCounts.get(key(hits[0].name)) || 0) < Math.ceil(limit / Math.min(3, interests.length)))
        && (strict || hits.every((v) => category(v.name) !== 'tag' || (unknownCounts.get(key(v.name)) || 0) < Math.ceil(limit / 6))));
      if (!pool.length) break;
      const score = ({ t, terms, hits, base }) => {
        const overlap = selectedTerms.reduce((max, previous) => Math.max(max, terms.filter((x) => previous.some((p) => p.name === x.name)).length / Math.max(1, new Set([...terms, ...previous].map((x) => x.name)).size)), 0);
        const repetition = hits.length ? primaryCounts.get(key(hits[0].name)) || 0 : 0;
        return base / (1 + repetition * 0.4) - 0.25 * overlap - (t.mid && out.at(-1)?.mid === t.mid ? 0.2 : 0) + (hash(today + t.bvid) % 1000) / 100000;
      };
      pool.sort((a, b) => score(b) - score(a));
      const { t, hits } = pool.shift();
      // Exact normalized titles catch duplicate uploads; do not guess unknown song identities.
      if (out.some((v) => key(v.title) === key(t.title) && t.title)) continue;
      out.push({ ...t, matchedTags: hits.slice(0, 3).map((v) => v.name),
        recommendationReason: hits.length ? `与你的兴趣匹配 · ${hits.slice(0, 2).map((v) => v.name).join(' / ')}` : '音乐发现 · 建立你的收听画像' });
    }
    return out;
  }
  function current(state, at = Date.now()) { return state.days.find((v) => v.date === dayKey(at) && v.profileId === state.profileId); }
  function tracker(record) {
    let session = null, last = null, saved = 0;
    const flush = () => { if (session && session.seconds > saved) { saved = session.seconds; Promise.resolve(record({ ...session })).catch(() => {}); } };
    return {
      start(track, { manual = false, search = false } = {}) { flush(); const t = compact(track); session = t ? { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, track: t, at: Date.now(), seconds: 0, manual, search } : null; last = null; saved = 0; },
      tick(position, playing) {
        const now = Date.now();
        if (session && playing && last?.playing) {
          const wall = (now - last.at) / 1000, delta = position - last.position;
          if (wall > 0 && wall < 10 && delta > 0 && delta <= wall * 1.5 + 0.5) session.seconds += Math.min(wall, delta);
          if (session.seconds - saved >= 30 || qualified(session) && saved === 0) flush();
        }
        last = { position, playing, at: now };
      }, flush,
    };
  }
  return { extract, semantic, canonical, category, compact, normalize, validate, merge, observe, rule, feedback, qualified,
    taste, select, current, dayKey, hash, activeRules, tracker, isCompilation, durationOf, withinDuration, SOURCE };
});
