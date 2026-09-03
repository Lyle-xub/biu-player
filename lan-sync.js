const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { merge, normalize, privateIPv4 } = require('./renderer/library-sync');

// Explicit, short-lived LAN session. No background discovery or cloud service.
function createLanSync({ readLibrary, writeLibrary, onStatus = () => {}, host = '0.0.0.0', ttl = 10 * 60 * 1000 }) {
  let server = null, session = null, timer = null, starting = null;
  const status = () => session ? { active: true, addresses: session.addresses, code: session.code,
    expiresAt: session.expiresAt, requestId: session.requestId, connected: session.connected,
    lastSync: session.lastSync, counts: session.counts,
    pending: session.connected && session.completedRequestId < session.requestId } : { active: false };
  const announce = () => onStatus(status());
  function stop() {
    clearTimeout(timer);
    const old = server;
    server = null; session = null;
    if (old) { old.close(); old.closeAllConnections(); }
    announce();
  }
  async function manual(scope = '') {
    if (!/^\d{0,20}$/.test(String(scope))) throw new Error('同步账号无效');
    if (starting) await starting;
    if (session && session.scope === scope) {
      session.requestId += 1;
      announce(); return status();
    }
    stop();
    const current = { scope, code: String(crypto.randomInt(10000000, 100000000)), addresses: [],
      expiresAt: Date.now() + ttl, requestId: 1, completedRequestId: 0, connected: false, lastSync: null, counts: null, attempts: 0 };
    const send = (res, code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    const nextServer = http.createServer(async (req, res) => {
      try {
        if (session !== current || Date.now() >= current.expiresAt) return send(res, 410, { error: '配对已过期，请在电脑重新开启同步' });
        const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (!privateIPv4(ip) || req.headers.origin) return send(res, 403, { error: '仅允许局域网内的播放器连接' });
        const provided = Buffer.from(String(req.headers.authorization || ''));
        const expected = Buffer.from(`Bearer ${current.code}`);
        if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
          current.attempts += 1;
          send(res, 401, { error: '配对码不正确' });
          if (current.attempts >= 10) setImmediate(stop);
          return;
        }
        if (req.method === 'GET' && req.url === '/v1/status') return send(res, 200, { version: 1, requestId: current.requestId });
        if (req.method !== 'POST' || !['/v1/sync', '/v1/ack'].includes(req.url)) return send(res, 404, { error: '同步接口不存在' });
        let length = 0; const chunks = [];
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          length += chunk.length;
          if (length > 4 * 1024 * 1024) { req.resume(); send(res, 413, { error: '同步数据超过 4 MB，请减少自定义封面大小' }); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (session !== current) return send(res, 410, { error: '同步会话已关闭' });
        if (req.url === '/v1/ack') {
          if (!current.receipt || body.receipt !== current.receipt.id) return send(res, 409, { error: '同步结果已更新，请重新同步' });
          current.completedRequestId = current.receipt.requestId;
          current.lastSync = Date.now();
          announce();
          return send(res, 200, { version: 1, requestId: current.completedRequestId });
        }
        const incoming = normalize(body);
        const result = merge(readLibrary(current.scope), incoming);
        // Both desktop buckets are flushed together before acknowledging the transfer.
        writeLibrary(current.scope, result);
        current.connected = true;
        current.receipt = { id: crypto.randomUUID(), requestId: current.requestId };
        current.counts = { likes: result.likes.length, playlists: result.playlists.length };
        announce();
        send(res, 200, { version: 1, requestId: current.requestId, receipt: current.receipt.id, library: result });
      } catch (e) {
        if (!res.headersSent && !res.destroyed) send(res, 400, { error: e.message || '同步失败' });
      }
    });
    nextServer.requestTimeout = 15000;
    nextServer.headersTimeout = 10000;
    server = nextServer;
    starting = new Promise((resolve, reject) => {
      nextServer.once('error', reject);
      nextServer.listen(0, host, resolve);
    });
    try {
      await starting;
      if (server !== nextServer) throw new Error('同步已取消');
      const port = nextServer.address().port;
      current.addresses = [...new Set(Object.values(os.networkInterfaces()).flat().filter((n) => n && !n.internal
        && n.family === 'IPv4' && privateIPv4(n.address)).map((n) => `${n.address}:${port}`))];
      session = current;
      timer = setTimeout(stop, ttl); timer.unref();
      announce(); return { ...status(), port };
    } catch (e) { stop(); throw e; }
    finally { starting = null; }
  }
  return { manual, stop, status };
}
module.exports = { createLanSync };
