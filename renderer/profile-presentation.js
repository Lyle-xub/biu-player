/* Deterministic portrait artwork and public quotes, shared by desktop and React Native. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuProfilePresentation = factory();
})(typeof window === 'object' ? window : this, function () {
  const themes = [
    { id: 'music', label: '旋律之间', word: 'RESONANCE', category: 'j', color: '#bb6653', match: /音乐|歌|钢琴|摇滚|爵士|电音|古典|民谣|rap|r&b|jazz|lofi|live|演奏/i },
    { id: 'anime', label: '想象之外', word: 'DAYDREAM', category: 'a', color: '#7879ae', match: /动漫|动画|二次元|cos|初音|术力口|番剧|日漫|vocaloid/i },
    { id: 'game', label: '下一场冒险', word: 'EXPLORE', category: 'c', color: '#54887d', match: /游戏|原神|星铁|明日方舟|王者|塞尔达|电竞/i },
    { id: 'poetry', label: '山海来信', word: 'LANDSCAPE', category: 'i', color: '#618477', match: /国风|古风|诗|山水|旅行|自然|风景|摄影/i },
    { id: 'film', label: '光影片刻', word: 'AFTERIMAGE', category: 'h', color: '#977443', match: /电影|影视|剧集|纪录片|配音/i },
    { id: 'thought', label: '留一点空白', word: 'STILLNESS', category: 'k', color: '#6a8290', match: /哲学|思考|学习|科学|知识|历史|阅读/i },
    { id: 'romance', label: '心动手记', word: 'TENDERNESS', category: 'd', color: '#b16e84', match: /爱|心动|温柔|治愈|浪漫|情感|恋|美女|穿搭|时尚|丝袜/i },
  ];
  const fallback = { id: 'literature', label: '偶然与共鸣', word: 'SERENDIPITY', category: 'd', color: '#8a7c62', match: /生活|日常|故事/ };
  const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function themeFor(profile) {
    return themes.map((theme) => ({ theme, score: (profile?.tags || []).reduce((sum, tag) =>
      sum + (theme.match.test(tag.name) ? Number(tag.weight) || 0 : 0), 0) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score)[0]?.theme || fallback;
  }
  function artwork(profile) {
    const theme = themeFor(profile);
    const tags = [...(profile?.tags || [])].sort((a, b) => a.name.localeCompare(b.name));
    let seed = 2166136261;
    for (const ch of JSON.stringify([profile?.name, tags])) seed = Math.imul(seed ^ ch.codePointAt(0), 16777619) >>> 0;
    const serial = String(seed % 1000).padStart(3, '0');
    const x = 110 + seed % 80, y = 95 + (seed >>> 8) % 65;
    const dots = Array.from({ length: 48 }, (_, i) => `<circle cx="${24 + i % 8 * 9}" cy="${185 + Math.floor(i / 8) * 9}" r="${i % 5 === seed % 5 ? 2 : 1}" fill="#edf2ff" opacity="${i % 3 === 0 ? '.6' : '.22'}"/>`).join('');
    const bars = Array.from({ length: 8 }, (_, i) => `<path d="M${166 + i * 8} 230v-${12 + ((seed >>> (i * 3)) % 42)}" stroke="#edf2ff" stroke-width="2"/>`).join('');
    const shape = seed % 3 === 0
      ? `<circle cx="${x}" cy="${y}" r="65" fill="${theme.color}"/><circle cx="${x + 29}" cy="${y - 19}" r="65" fill="#18212e"/>`
      : seed % 3 === 1
        ? `<rect x="${x - 60}" y="${y - 55}" width="110" height="110" rx="3" fill="${theme.color}" transform="rotate(-18 ${x} ${y})"/><circle cx="${x + 20}" cy="${y - 12}" r="41" fill="#18212e"/>`
        : `<path d="M40 158 Q${x} 20 241 146 L241 179 Q${x} 60 40 188Z" fill="${theme.color}"/><circle cx="${x}" cy="${y - 37}" r="28" fill="#edf2ff"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 280">
      <defs>
        <linearGradient id="film-${serial}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101623"/><stop offset="1" stop-color="${theme.color}"/></linearGradient>
        <radialGradient id="glow-${serial}"><stop stop-color="${theme.color}" stop-opacity=".75"/><stop offset="1" stop-color="${theme.color}" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="280" height="280" fill="url(#film-${serial})"/>
      <circle cx="${x + 24}" cy="${y}" r="140" fill="url(#glow-${serial})"/>
      <path d="M20 49H260M20 250H260" stroke="#edf2ff" opacity=".25" stroke-width=".7"/>
      <text x="22" y="32" fill="#edf2ff" font-family="sans-serif" font-size="8" letter-spacing="2">BIU / PERSONAL ARCHIVE</text>
      ${shape}<ellipse cx="${x}" cy="${y}" rx="92" ry="30" fill="none" stroke="#edf2ff" stroke-width="1" transform="rotate(-35 ${x} ${y})"/>
      <path d="M23 66v14m-7-7h14M244 222v14m-7-7h14" stroke="#edf2ff" opacity=".6"/>
      ${dots}${bars}<text x="22" y="268" fill="#edf2ff" font-family="sans-serif" font-size="9" letter-spacing="1.4">${theme.word}</text>
      <text x="255" y="268" text-anchor="end" fill="#edf2ff" font-family="sans-serif" font-size="9">${serial}</text>
      <text x="258" y="65" text-anchor="end" fill="#edf2ff" opacity=".6" font-family="sans-serif" font-size="7">${escape((profile?.tags || [])[0]?.name || '自由聆听')}</text>
    </svg>`;
    return { svg, serial, theme };
  }
  const cache = new Map();
  async function quoteFor(profile, fetcher = fetch) {
    const theme = themeFor(profile);
    let entry = cache.get(theme.id);
    if (!entry || Date.now() - entry.time > 6 * 60 * 60 * 1000) {
      const promise = Promise.allSettled(Array.from({ length: 3 }, async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetcher(`https://v1.hitokoto.cn/?c=${theme.category}&min_length=12&max_length=48`,
            { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) throw new Error('语录暂时无法连接');
          const data = await response.json();
          if (typeof data.hitokoto !== 'string' || !data.hitokoto.trim() || data.hitokoto.length > 120) throw new Error('语录格式有误');
          return { text: data.hitokoto.trim(), from: String(data.from || '一言').slice(0, 80), author: String(data.from_who || '').slice(0, 40) };
        } finally { clearTimeout(timer); }
      })).then((results) => {
        const quotes = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        if (!quotes.length) throw new Error('语录暂时无法连接，点击重试');
        return quotes;
      });
      entry = { time: Date.now(), promise };
      cache.set(theme.id, entry);
      promise.catch(() => { if (cache.get(theme.id) === entry) cache.delete(theme.id); });
    }
    const quotes = await entry.promise;
    const score = (quote) => (profile?.tags || []).reduce((sum, tag) => sum +
      (`${quote.text} ${quote.from}`.toLowerCase().includes(tag.name.toLowerCase()) ? Number(tag.weight) || 0 : 0), 0);
    return [...quotes].sort((a, b) => score(b) - score(a))[0];
  }
  return { artwork, themeFor, quoteFor };
});
