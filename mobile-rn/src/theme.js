/* Biu Player RN · 主题（对齐 renderer/styles.css / mobile/mobile.css 的设计语言） */
export const colors = {
  bg: '#0b0d09',
  bgSoft: '#12150e',
  card: 'rgba(255,255,255,0.055)',
  cardBorder: 'rgba(255,255,255,0.09)',
  accent: '#fb7299',
  accentSoft: 'rgba(251,114,153,0.16)',
  text: '#f2f3ef',
  text2: 'rgba(242,243,239,0.62)',
  text3: 'rgba(242,243,239,0.38)',
  danger: '#ff6b81',
};

export const radius = {
  card: 16,
  pill: 999,
  bar: 18,
};

export const fmtCount = (n) => {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + ' 万';
  return String(n);
};

export const fmtDur = (sec) => {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ms = `${m}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : ms;
};
