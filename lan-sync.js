const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { normalize, reconcile, privateIPv4 } = require('./renderer/library-sync');

const digest = (value) => crypto.createHash('md5').update(value).digest('hex');
const revision = (library) => digest(JSON.stringify(normalize(library)));
function lanInterfaces(networks = os.networkInterfaces()) {
  return Object.entries(networks).flatMap(([name, entries]) => {
    // TUN/TAP may have RFC1918 addresses too; they must not become LAN endpoints.
    if (/^(utun|tun|tap|wg|ppp|ipsec|tailscale|zt|docker|veth|vmnet|vboxnet|awdl|llw)/i.test(name)
      || /vpn|wireguard|tailscale|zerotier|clash|sing-box/i.test(name)) return [];
    return (entries || []).filter((entry) => !entry.internal
      && (entry.family === 'IPv4' || entry.family === 4) && privateIPv4(entry.address)
      && !entry.address.startsWith('127.'))
      .map((entry) => ({ name, address: entry.address, netmask: entry.netmask }));
  }).sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

function advertiseNative(options, onError, launch = spawn) {
  // mDNSResponder owns multicast routing and re-announces on Wi-Fi/VPN changes.
  // Do not resolve our custom host through a VPN DNS server: register the system host.
  const child = launch('/usr/bin/dns-sd', ['-R', options.name, '_biu-sync._tcp', 'local.',
    String(options.port), ...Object.entries(options.txt).map(([key, value]) => `${key}=${value}`)],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stopped = false;
  // dns-sd writes TXT values to stdout; never forward them (they include the session token).
  child.stderr?.resume();
  child.once('error', () => { if (!stopped) onError(new Error('系统 Bonjour 启动失败，将自动重试')); });
  child.once('exit', () => { if (!stopped) onError(new Error('系统 Bonjour 已退出，将自动重试')); });
  return () => { if (!stopped) { stopped = true; child.kill(); } };
}

function advertise(options, onError) {
  if (process.platform === 'darwin') return advertiseNative(options, onError);
  const { Bonjour } = require('bonjour-service');
  const addresses = options.txt.addresses.split(',').filter(Boolean);
  // Bind the receive socket to ANY, but explicitly select a LAN multicast interface.
  const bonjour = new Bonjour({ interface: addresses[0], bind: '0.0.0.0' }, onError);
  const service = bonjour.publish({ ...options, type: 'biu-sync', protocol: 'tcp', disableIPv6: true });
  const records = service.records.bind(service);
  service.records = () => records().filter((record) => record.type !== 'A' || addresses.includes(record.data));
  service.on('error', onError);
  return () => service.stop(() => bonjour.destroy());
}

// The account tag matches local app accounts; it is not proof of Bilibili
// identity. No Bilibili credentials leave a device. Use on a trusted LAN.
function createLanSync({ readLibrary, writeLibrary, cloudKeyStatus, exchangeCloudKey, onStatus = () => {},
  deviceId = crypto.randomUUID(), host = '0.0.0.0', publish = advertise, interfaces = lanInterfaces }) {
  let session = null, server = null, unpublish = null, generation = 0;
  let enabled = true, scope = '', error = '';
  const status = () => ({ enabled, active: !!session, error, signedIn: !!scope,
    connected: !!session?.lastSync && Date.now() - session.lastSeen < 20000,
    lastSync: session?.lastSync || null, counts: session?.counts || null });
  const announce = () => onStatus(status());
  function close() {
    generation += 1;
    unpublish?.(); unpublish = null;
    const old = server;
    server = null; session = null;
    if (old) { old.close(); old.closeAllConnections(); }
  }
  function stop() { close(); scope = ''; announce(); }
  async function configure(nextScope = '', nextEnabled = enabled) {
    if (!/^\d{0,20}$/.test(String(nextScope))) throw new Error('同步账号无效');
    const networks = interfaces();
    const network = JSON.stringify(networks);
    if (session && scope === String(nextScope) && nextEnabled && session.network === network) { announce(); return status(); }
    close(); enabled = nextEnabled !== false; scope = String(nextScope); error = '';
    if (!enabled || !scope) { announce(); return status(); }
    if (!networks.length && host === '0.0.0.0') {
      error = '未找到可用的局域网网卡，连接 Wi-Fi 或有线网络后将自动重试';
      announce(); return status();
    }
    const run = generation;
    const current = { scope, network, token: crypto.randomBytes(32).toString('hex'), receipts: new Map(), lastSeen: 0 };
    const keyPair = exchangeCloudKey && crypto.generateKeyPairSync('x25519');
    const publicKey = keyPair && Buffer.from(keyPair.publicKey.export({format:'jwk'}).x,'base64url').toString('hex');
    const send = (res, code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ version: 2, account: current.scope, deviceId, ...data }));
    };
    const nextServer = http.createServer(async (req, res) => {
      try {
        if (session !== current) return send(res, 410, { error: '同步连接已关闭' });
        const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (!privateIPv4(ip) || req.headers.origin) return send(res, 403, { error: '仅允许局域网内的播放器连接' });
        const provided = Buffer.from(String(req.headers.authorization || ''));
        const expected = Buffer.from(`Bearer ${current.token}`);
        if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return send(res, 401, { error: '设备连接已失效，请等待自动重连' });
        if (req.headers['x-biu-account'] !== current.scope) return send(res, 403, { error: '两端登录账号不同，未同步' });
        current.lastSeen = Date.now();
        if (req.method === 'GET' && req.url === '/v2/status') {
          const cloud = cloudKeyStatus?.(current.scope);
          return send(res, 200, { revision: revision(readLibrary(current.scope)),
            ...(cloud && keyPair ? {cloudKey:{version:1,publicKey,channel:cloud.channel}} : {}) });
        }
        if (req.method !== 'POST' || !['/v2/sync', '/v2/ack', '/v2/cloud-key'].includes(req.url)) return send(res, 404, { error: '同步接口不存在' });
        let length = 0; const chunks = [];
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          length += chunk.length;
          if (req.url === '/v2/cloud-key' && length > 16384) { req.resume(); return send(res, 413, {error:'密钥同步请求过大'}); }
          if (length > 8 * 1024 * 1024) { req.resume(); send(res, 413, { error: '同步数据超过 8 MB，请减少自定义封面大小' }); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (session !== current) return send(res, 410, { error: '同步连接已关闭' });
        if (!/^[\w-]{8,80}$/.test(body.clientId || '')) return send(res, 400, { error: '设备标识无效' });
        if (req.url === '/v2/cloud-key') {
          if(!keyPair || !cloudKeyStatus?.(current.scope))return send(res,409,{error:'云同步尚未就绪'});
          if(!/^[a-f0-9]{64}$/.test(body.publicKey || '') || !/^[a-f0-9]{24}$/.test(body.nonce || '')
            || !/^(?:[a-f0-9]{2}){16,8192}$/.test(body.ciphertext || ''))return send(res,400,{error:'密钥同步数据无效'});
          const peerKey=crypto.createPublicKey({format:'jwk',key:{kty:'OKP',crv:'X25519',x:Buffer.from(body.publicKey,'hex').toString('base64url')}});
          const context=`biu-lan-cloud-v1:${current.scope}:${deviceId}:${body.clientId}:${publicKey}:${body.publicKey}`;
          const secret=crypto.diffieHellman({privateKey:keyPair.privateKey,publicKey:peerKey});
          const key=crypto.createHash('sha256').update(secret).update(context).digest();
          const encrypted=Buffer.from(body.ciphertext,'hex');
          const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(body.nonce,'hex'));
          decipher.setAAD(Buffer.from(context+':request'));decipher.setAuthTag(encrypted.subarray(-16));
          let recovery;
          try{recovery=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]).toString('utf8'));}
          catch{return send(res,400,{error:'密钥同步校验失败'});}
          const result=await exchangeCloudKey(recovery,current.scope,()=>session===current && !res.destroyed);
          if(session!==current)return send(res,410,{error:'同步连接已关闭'});
          const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
          cipher.setAAD(Buffer.from(context+':response'));
          const ciphertext=Buffer.concat([cipher.update(JSON.stringify(result)),cipher.final(),cipher.getAuthTag()]);
          return send(res,200,{nonce:nonce.toString('hex'),ciphertext:ciphertext.toString('hex')});
        }
        if (req.url === '/v2/ack') {
          const receipt = current.receipts.get(body.clientId);
          if (!receipt || body.receipt !== receipt.id) return send(res, 409, { error: '同步结果已更新，请重试' });
          current.lastSync = Date.now(); current.counts = receipt.counts;
          announce(); return send(res, 200, { revision: receipt.revision });
        }
        const before = normalize(readLibrary(current.scope));
        const result = reconcile(body.base || null, before, body.library);
        if (JSON.stringify(before) !== JSON.stringify(result)) writeLibrary(current.scope, result, before);
        const receipt = { id: crypto.randomUUID(), revision: revision(result),
          counts: { likes: result.likes.length, playlists: result.playlists.length, profiles: result.recommendation ? result.recommendation.profiles.length + 1 : 0 } };
        if (current.receipts.size >= 64) current.receipts.delete(current.receipts.keys().next().value);
        current.receipts.set(body.clientId, receipt);
        send(res, 200, { revision: receipt.revision, receipt: receipt.id, library: result });
      } catch (e) {
        if (!res.headersSent && !res.destroyed) send(res, 400, { error: e.message || '同步失败' });
      }
    });
    nextServer.requestTimeout = 15000;
    nextServer.headersTimeout = 10000;
    server = nextServer;
    try {
      await new Promise((resolve, reject) => {
        nextServer.once('error', reject);
        // Closing before the listening event cancels its callback in Node.
        nextServer.once('close', resolve);
        nextServer.listen(0, host, resolve);
      });
      if (run !== generation) { nextServer.close(); return status(); }
      session = current;
      unpublish = publish({ name: `Biu-${deviceId}`, host: `biu-${deviceId}.local`, port: nextServer.address().port,
        txt: { version: '2', account: digest(`biu-lan:${scope}`), device: deviceId, token: current.token,
          addresses: [...new Set(networks.map((entry) => entry.address))].slice(0, 8).join(',') } }, (e) => {
        if (run === generation) { error = e.message || '局域网发现不可用，将自动重试'; close(); announce(); }
      });
      announce(); return status();
    } catch (e) {
      if (run === generation) { error = e.message || '同步启动失败'; close(); announce(); }
      return status();
    }
  }
  return { configure, stop, status };
}
module.exports = { createLanSync, revision, lanInterfaces, advertiseNative };
