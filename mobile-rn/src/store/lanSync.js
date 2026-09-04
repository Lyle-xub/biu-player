import md5 from 'js-md5';
import { endpoint, normalize, privateIPv4 } from '../../../renderer/library-sync';

export const libraryRevision = (library) => md5(JSON.stringify(normalize(library)));
export function discoveredPeer(service, scope) {
  const txt = service?.txt;
  if (!/^\d{1,20}$/.test(scope) || txt?.version !== '2' || txt.account !== md5('biu-lan:' + scope)
    || !/^[\w-]{8,80}$/.test(txt.device || '') || !/^[a-f0-9]{64}$/.test(txt.token || '')) return null;
  // Android NSD may return only one address (e.g. a VPN interface). Also try
  // the desktop's advertised private IPv4 interfaces without subnet scanning.
  const addresses = [...new Set([...String(txt.addresses || '').split(','), ...(service.addresses || [])])].filter(privateIPv4)
    .map((ip) => ip + ':' + service.port).filter((address) => { try { endpoint(address); return true; } catch { return false; } });
  return addresses.length ? { name: service.name, id: txt.device, token: txt.token, addresses } : null;
}

export async function lanRequest(peer, scope, path, payload, signal) {
  let failure;
  for (const address of peer.addresses) {
    if (signal?.aborted) throw new Error('同步已取消');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    // Discovery probes should fail fast; library transfer and key authentication need more time.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, path === 'status' ? 3000 : 20000);
    let receivedResponse = false;
    try {
      const response = await fetch(endpoint(address) + '/v2/' + path, {
        method: payload ? 'POST' : 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: { Authorization: 'Bearer ' + peer.token, 'X-Biu-Account': scope,
          ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const result = await response.json();
      receivedResponse = true;
      if (signal?.aborted) throw new Error('同步已取消');
      if (!response.ok) throw new Error(result.error || '电脑同步失败');
      if (result.version !== 2 || result.account !== scope || result.deviceId !== peer.id) throw new Error('同步账号或设备不匹配');
      // Keep the verified working route first for status/sync/ack and subsequent polls.
      peer.addresses = [address, ...peer.addresses.filter((item) => item !== address)];
      return result;
    } catch (e) {
      if (signal?.aborted) throw new Error('同步已取消');
      // A server error is not a failed route: don't repeat a write elsewhere.
      if (receivedResponse) throw e;
      failure = new Error(timedOut ? `连接电脑超时（${address}）` : `无法连接电脑（${address}），请确认电脑端仍在运行`);
      failure.cause = e;
    }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  throw failure || new Error('无法连接电脑，等待自动重连');
}

// One runner per foreground account, independent of the current screen.
// Only exchange full libraries when either side changed; idle polls are tiny.
export function startAutoSync({ scope, clientId, discovery, storage, getLibrary, applyLibrary, syncCloudKey, onStatus, interval = 4000 }) {
  const peers = new Map(), baselines = new Map();
  const controller = new AbortController();
  const { signal } = controller;
  let busy = false, timer, restartTimer, lastScan = Date.now();
  const report = (value) => { if (!signal.aborted) onStatus(value); };
  const scan = () => {
    if (signal.aborted) return;
    // The NSD backend in 0.14 uses an unsupported "UTF_8" charset for TXT
    // records. DNSSD decodes them correctly and returns all host addresses.
    try { discovery.scan('biu-sync', 'tcp', 'local.', 'DNSSD'); }
    catch (e) { report({ message: '局域网发现暂不可用，将自动重试' }); }
  };
  async function poll() {
    if (signal.aborted || busy) return;
    busy = true;
    try {
      let connected = false, failureMessage = '';
      for (const peer of peers.values()) {
        if (signal.aborted) return;
        const key = 'biu.lan-baseline@' + scope + ':' + peer.id;
        try {
          if (!baselines.has(peer.id)) {
            const raw = await storage.getItem(key);
            let value = null;
            try { value = raw ? normalize(JSON.parse(raw)) : null; } catch { /* First exchange after a damaged snapshot. */ }
            baselines.set(peer.id, value);
          }
          const base = baselines.get(peer.id);
          const remote = await lanRequest(peer, scope, 'status', null, signal);
          if (peers.get(peer.id) !== peer) continue;
          // Key changes are independent of library revisions, including an idle library.
          if(syncCloudKey && remote.cloudKey) {
            try {
              const keyResult=await syncCloudKey(peer,scope,remote.cloudKey,clientId,signal,lanRequest);
              report({cloudKeyMessage:keyResult==='conflict'?'两端已有不同云同步密钥，已保留各自配置；可手动导入统一。'
                :keyResult==='synced'?'云同步密钥已自动同步':''});
            } catch {report({cloudKeyMessage:'云同步密钥暂未同步，将自动重试'});}
          }
          const local = normalize(await getLibrary(scope));
          if (signal.aborted) return;
          const sharedRevision = base && libraryRevision(base);
          if (!peer.synced || sharedRevision !== remote.revision || sharedRevision !== libraryRevision(local)) {
            const result = await lanRequest(peer, scope, 'sync', { clientId, base, library: local }, signal);
            if (signal.aborted) return;
            const incoming = normalize(result.library);
            if (typeof result.receipt !== 'string') throw new Error('同步确认信息缺失');
            await applyLibrary(incoming, local, scope);
            if (signal.aborted) return;
            await storage.setItem(key, JSON.stringify(incoming));
            baselines.set(peer.id, incoming);
            await lanRequest(peer, scope, 'ack', { clientId, receipt: result.receipt }, signal);
            peer.synced = true;
            report({ message: '已同步 · ' + incoming.likes.length + ' 首喜欢 · ' + incoming.playlists.length + ' 个歌单 · ' + (incoming.recommendation ? incoming.recommendation.profiles.length + 1 : 0) + ' 份画像',
              connected: true, lastSync: Date.now() });
          } else report({ connected: true, message: '已同步 · ' + base.likes.length + ' 首喜欢 · ' + base.playlists.length + ' 个歌单 · ' + (base.recommendation ? base.recommendation.profiles.length + 1 : 0) + ' 份画像' });
          connected = true;
        } catch (e) {
          if (peers.get(peer.id) !== peer) continue;
          peer.synced = false;
          failureMessage = (e.message || '连接已断开') + '，正在重新连接';
        }
      }
      if (!connected && failureMessage) report({ connected: false, message: failureMessage });
      if (!peers.size) report({ connected: false, message: '正在寻找同一 Wi-Fi 内的同账号电脑…' });
      if (!connected && Date.now() - lastScan >= 10000) {
        lastScan = Date.now();
        try { discovery.stop('DNSSD'); } catch {}
        restartTimer = setTimeout(scan, 800);
      }
    } finally { busy = false; }
  }
  discovery.on('resolved', (service) => {
    const peer = discoveredPeer(service, scope);
    if (peer) {
      const existing = peers.get(peer.id);
      if (existing && existing.token === peer.token) {
        // Repeated multicast announcements must not reset sync state or address preference.
        const known = existing.addresses.filter((address) => peer.addresses.includes(address));
        existing.addresses = [...known, ...peer.addresses.filter((address) => !known.includes(address))];
        existing.name = peer.name;
      } else peers.set(peer.id, peer);
      poll();
    }
  });
  discovery.on('remove', (name) => {
    for (const [id, peer] of peers) if (peer.name === name) peers.delete(id);
    if (!peers.size) report({ connected: false, message: '电脑已断开，等待自动重连…' });
  });
  discovery.on('error', () => report({ connected: false, message: '局域网发现暂不可用，请检查网络权限，将自动重试' }));
  scan();
  timer = setInterval(poll, interval);
  poll();
  return () => {
    if (signal.aborted) return;
    controller.abort(); clearInterval(timer); clearTimeout(restartTimer);
    try { discovery.stop('DNSSD'); } catch {}
    discovery.removeDeviceListeners();
    discovery.removeAllListeners();
  };
}
