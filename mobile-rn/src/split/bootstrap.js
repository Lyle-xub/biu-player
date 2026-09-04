/* Browser-only runtime bundled by scripts/build-split.cjs. */
const pending = new Map();
let requestId = 0;
const post = (value) => window.ReactNativeWebView.postMessage(JSON.stringify(value));
window.onerror = (message) => post({ method: 'error', args: { message: String(message) } });
function rpc(method, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('请求超时，请重试')); }, method === 'download' ? 180000 : 30000);
    pending.set(id, { resolve, reject, timer });
    post({ id, method, args });
  });
}
window.splitReply = ({ id, value, error }) => {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id); clearTimeout(request.timer);
  if (error) request.reject(new Error(error)); else request.resolve(value);
};
const fromBase64 = (value) => Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
window.bili = { get: (url, options) => rpc('get', { url, options }) };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const state = { current: null };
let clock = { position: 0, playing: false, timestamp: performance.now() };
const audio = {
  get currentTime() { return clock.position + (clock.playing ? Math.min(0.5, (performance.now() - clock.timestamp) / 1000) : 0); },
  set currentTime(position) { clock = { ...clock, position, timestamp: performance.now() }; rpc('preview', { position }).catch(toast); },
};
const videoModeOn = () => false;
const toast = (message) => { $('splitHint').textContent = String(message?.message || message); };
