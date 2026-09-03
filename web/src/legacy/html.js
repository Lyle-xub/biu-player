/* 从 controller.js 原样移出的 HTML 字符串辅助：转义与封面占位。
 * coverSVG 由 vendor.js 先加载并挂到 window，运行时再取用，不做模块级 import。
 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtNum = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n ?? 0));

export const fmtFans = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n));

// 秒 → mm:ss
export const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
};

/* ---------- 封面 HTML：有真实封面用 img，否则占位渐变 SVG ---------- */
export function covHTML(t, size = 100) {
  if (t && t.pic) {
    // 保留稳定的资源地址，让浏览器复用缓存；显示后换成 blob 会再次加载/解码。
    return `<img src="${esc(t.pic)}" loading="lazy" decoding="async" alt="">`;
  }
  return window.coverSVG((t && t.seed) || 1, size);
}
