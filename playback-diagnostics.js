const fs = require('node:fs');
const path = require('node:path');

// Only structured playback state is written: never cookies, signed URLs or library contents.
function createPlaybackDiagnostics(directory, maxBytes = 512 * 1024) {
  const file = path.join(directory, 'playback.log');
  const events = new Set(['resume', 'refresh', 'failure', 'stall', 'media-error', 'cancel', 'proxy-http', 'proxy-failure',
    'playurl-failure', 'playurl-fallback']);
  return payload => {
    if (!payload || !events.has(payload.event)) return;
    const entry = { time: new Date().toISOString(), event: payload.event };
    if (/^BV\w+$/.test(payload.bvid || '')) entry.bvid = payload.bvid.slice(0, 32);
    for (const key of ['cid', 'position', 'mediaError', 'soundError', 'readyState', 'networkState', 'status', 'apiCode', 'audioTracks', 'durlParts']) {
      if (Number.isFinite(payload[key])) entry[key] = payload[key];
    }
    if (['wbi-dash', 'dash', 'html5'].includes(payload.endpoint)) entry.endpoint = payload.endpoint;
    if (['request-error', 'empty-manifest'].includes(payload.reason)) entry.reason = payload.reason;
    if (/^(?:Error|[A-Za-z][A-Za-z0-9]*Error)$/.test(payload.errorName || '')) entry.errorName = payload.errorName.slice(0, 64);
    if (/^[a-z0-9.-]+$/i.test(payload.host || '')) entry.host = payload.host.slice(0, 253);
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
        fs.rmSync(file + '.1', { force: true });
        fs.renameSync(file, file + '.1');
      }
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch { /* Diagnostics must never interrupt playback. */ }
  };
}

module.exports = { createPlaybackDiagnostics };
