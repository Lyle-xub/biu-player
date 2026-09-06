import { Buffer } from 'buffer';
import { getRandomBytes } from 'expo-crypto';
import { normalize, reconcile, privateIPv4, profileCount } from '../../../renderer/library-sync';
import { libraryRevision } from './lanSync';

const randomToken = () => Array.from(getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
const MAX_BODY = 8 * 1024 * 1024;
const sameToken = (a, b) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};

// Same HTTP protocol as desktop, over a native TCP listener on both mobile platforms.
export function startLanReceiver({ tcp, scope, deviceId, getLibrary, applyLibrary, onStatus = () => {} }) {
  if (!/^\d{1,20}$/.test(scope) || !/^[\w-]{8,80}$/.test(deviceId)) throw new Error('同步账号或设备无效');
  const token = randomToken(), sockets = new Set(), receipts = new Map();
  let stopped = false, writes = Promise.resolve(), lastSeen = 0, lastSync = 0, message = '';
  const status = () => ({ connected: !!lastSync && Date.now() - lastSeen < 20000, lastSync, message });
  const check = () => { if (stopped) throw new Error('同步已停止'); };
  const server = tcp.createServer((socket) => {
    socket.on('error', () => socket.destroy());
    if (stopped || sockets.size >= 4 || !privateIPv4(String(socket.remoteAddress || '').replace(/^::ffff:/, ''))) { socket.destroy(); return; }
    sockets.add(socket);
    let head = Buffer.alloc(0), request, chunks = [], received = 0, dispatched = false;
    const timeout = setTimeout(() => socket.destroy(), 20000);
    socket.on('close', () => { clearTimeout(timeout); sockets.delete(socket); chunks = []; });
    const reply = (code, data) => {
      if (stopped || socket.destroyed) return;
      dispatched = true;
      const body = JSON.stringify({ version: 2, account: scope, deviceId, ...data });
      socket.end(`HTTP/1.1 ${code} ${code === 200 ? 'OK' : 'Error'}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n${body}`);
    };
    const handle = async () => {
      try {
        check();
        if (request.path === '/v2/status') {
          const library = normalize(await getLibrary(scope)); check(); lastSeen = Date.now();
          if (lastSync) onStatus(status());
          reply(200, { revision: libraryRevision(library), discoveryProfiles: true }); return;
        }
        const body = JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
        chunks = [];
        if (!/^[\w-]{8,80}$/.test(body.clientId || '') || body.clientId === deviceId) throw new Error('设备标识无效');
        if (request.path === '/v2/ack') {
          const receipt = receipts.get(body.clientId);
          if (!receipt || receipt.id !== body.receipt) { reply(409, { error: '同步结果已更新，请重试' }); return; }
          lastSeen = lastSync = Date.now(); message = receipt.message;
          onStatus(status()); reply(200, { revision: receipt.revision }); return;
        }
        // Serialize incoming writes; account-scoped stores also serialize local edits.
        const operation = writes.catch(() => {}).then(async () => {
          check(); if (socket.destroyed) return;
          const before = normalize(await getLibrary(scope)); check(); if (socket.destroyed) return;
          const merged = reconcile(body.base || null, before, body.library);
          if (libraryRevision(before) !== libraryRevision(merged)) await applyLibrary(merged, before, scope);
          check();
          const result = normalize(await getLibrary(scope)); check();
          const receipt = { id: randomToken(), revision: libraryRevision(result), message:
            `已同步 · ${result.likes.length} 首喜欢 · ${result.library.length} 首音乐库 · ${result.playlists.length} 个歌单 · ${profileCount(result)} 份画像` };
          if (receipts.size >= 64) receipts.delete(receipts.keys().next().value);
          receipts.set(body.clientId, receipt);
          reply(200, { library: result, revision: receipt.revision, receipt: receipt.id });
        });
        writes = operation.catch(() => {});
        await operation;
      } catch (error) { reply(400, { error: error.message || '同步保存失败' }); }
    };
    socket.on('data', (value) => {
      if (dispatched || stopped) return;
      let data = Buffer.from(value);
      try {
        if (!request) {
          head = Buffer.concat([head, data]);
          const end = head.indexOf('\r\n\r\n');
          if (end < 0) { if (head.length > 16384) reply(431, { error: '请求头过大' }); return; }
          if (end > 16384) throw new Error('请求头过大');
          // Hermes may return a plain Uint8Array from subarray(); decode on Buffer itself.
          const [first, ...lines] = head.toString('utf8', 0, end).split('\r\n');
          const match = /^(GET|POST) (\/v2\/(?:status|sync|ack)) HTTP\/1\.[01]$/.exec(first);
          if (!match || (match[2] === '/v2/status') !== (match[1] === 'GET')) { reply(404, { error: '同步接口不存在' }); return; }
          const headers = Object.create(null);
          for (const line of lines) {
            const colon = line.indexOf(':'), key = line.slice(0, colon).toLowerCase();
            if (colon < 1 || !/^[a-z0-9-]+$/.test(key) || headers[key] !== undefined) throw new Error('请求头无效');
            headers[key] = line.slice(colon + 1).trim();
          }
          if (headers.origin !== undefined || !sameToken(headers.authorization || '', `Bearer ${token}`) || headers['x-biu-account'] !== scope) {
            reply(403, { error: '同步账号或授权不匹配' }); return;
          }
          const length = headers['content-length'] || '0';
          if (headers['transfer-encoding'] || !/^\d+$/.test(length) || Number(length) > MAX_BODY) { reply(413, { error: '同步数据超过限制' }); return; }
          request = { path: match[2], length: Number(length) };
          if (request.path === '/v2/status' && request.length) throw new Error('状态请求无效');
          data = head.subarray(end + 4); head = Buffer.alloc(0);
        }
        received += data.length;
        if (received > request.length) throw new Error('请求长度不匹配');
        chunks.push(data);
        if (received === request.length) { dispatched = true; handle(); }
      } catch (error) { reply(400, { error: error.message || '同步请求无效' }); }
    });
  });
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    server.on('error', (error) => { reject(error); if (!stopped) onStatus({ receiverError: '手机直连暂不可用，请重新开启局域网同步' }); });
    server.listen({ host: '0.0.0.0', port: 0 }, () => {
      if (stopped) { server.close(); return; }
      resolve({ port: server.address().port, token });
    });
  });
  return { ready, status, stop() {
    if (stopped) return;
    stopped = true; rejectReady(new Error('同步已停止'));
    for (const socket of sockets) socket.destroy();
    sockets.clear(); receipts.clear();
    try { server.close(); } catch {}
  } };
}
