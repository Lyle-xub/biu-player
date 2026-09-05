// Bilibili can return HTTP or protocol-relative CDN addresses. Preserve the
// signed path/query while using HTTPS for iOS App Transport Security.
export function mediaUrl(value) {
  if (!value) return null;
  const url = String(value).trim();
  if (url.startsWith('//')) return 'https:' + url;
  return url.replace(/^http:/i, 'https:');
}
