import { extractCoverColor } from 'biu-lyrics-pip';

// Share in-flight requests and extracted colors across split tracks and queues.
const colors = new Map();
export function loadCoverColor(value) {
  const raw = String(value || '').trim();
  const url = raw.startsWith('//') ? `https:${raw}` : raw.replace(/^http:/, 'https:');
  if (!url || !extractCoverColor) return Promise.resolve(null);
  if (colors.has(url)) {
    const cached = colors.get(url);
    colors.delete(url);
    colors.set(url, cached);
    return cached;
  }
  const request = Promise.resolve().then(() => extractCoverColor(url)).then(value => {
    const valid = Array.isArray(value) && value.length === 3
      && value.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1);
    return valid ? value : null;
  }).catch(() => null).then(value => {
    if (!value && colors.get(url) === request) colors.delete(url);
    return value;
  });
  colors.set(url, request);
  if (colors.size > 64) colors.delete(colors.keys().next().value);
  return request;
}
