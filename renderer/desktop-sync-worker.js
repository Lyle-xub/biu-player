const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { normalize, reconcile, libraryCount, profileCount } = require('./library-sync');

function compute(operation, args) {
  switch (operation) {
    case 'parse': return JSON.parse(args[0]);
    case 'stringify': return JSON.stringify(args[0]);
    case 'libraryNormalize': return normalize(...args);
    case 'libraryReconcile': return reconcile(...args);
    case 'libraryFingerprint': return createHash('sha256').update(JSON.stringify(normalize(args[0]))).digest('hex');
    case 'libraryPreview': return JSON.stringify(normalize(...args), null, 2).slice(0, 32000);
    case 'lanRevision': return createHash('md5').update(JSON.stringify(normalize(...args))).digest('hex');
    case 'lanMerge': {
      const [bytes, local, options, envelope] = args;
      const body = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'));
      if (!/^[\w-]{8,80}$/.test(body.clientId || '')) throw new Error('设备标识无效');
      const before = normalize(local, options);
      const library = reconcile(body.base ? normalize(body.base, options) : null, before, normalize(body.library, options));
      const raw = JSON.stringify(library);
      const revision = createHash('md5').update(raw).digest('hex');
      const counts = { likes: library.likes.length, library: libraryCount(library), playlists: library.playlists.length, profiles: profileCount(library) };
      const header = JSON.stringify({ ...envelope, revision });
      const changed = raw !== JSON.stringify(before);
      return { clientId: body.clientId, ...(changed ? { before, library } : {}), revision, counts, changed,
        reply: header.slice(0, -1) + ',"library":' + raw + '}' };
    }
    default: throw new Error(`未知同步计算：${operation}`);
  }
}

if (!isMainThread) {
  parentPort.on('message', ({ id, operation, args }) => {
    try { parentPort.postMessage({ id, value: compute(operation, args) }); }
    catch (error) { parentPort.postMessage({ id, error: { name: error.name, message: error.message } }); }
  });
}

function createDesktopSyncCompute() {
  let worker, sequence = 0;
  const pending = new Map();
  function start() {
    const thread = new Worker(__filename);
    const failed = error => {
      if (worker !== thread) return;
      worker = null;
      for (const task of pending.values()) task.reject(error);
      pending.clear();
    };
    thread.on('error', failed);
    thread.on('exit', () => failed(new Error('同步计算已停止，请重试')));
    thread.on('message', ({ id, value, error }) => {
      const task = pending.get(id);
      if (!task) return;
      pending.delete(id);
      if (!pending.size) thread.unref();
      if (error) task.reject(error.name === 'SyntaxError' ? new SyntaxError(error.message) : new Error(error.message));
      else task.resolve(value);
    });
    worker = thread;
    return thread;
  }
  return (operation, ...args) => new Promise((resolve, reject) => {
    const thread = worker || start(), id = ++sequence;
    thread.ref();
    pending.set(id, { resolve, reject });
    try { thread.postMessage({ id, operation, args }); }
    catch (error) {
      pending.delete(id);
      if (!pending.size) thread.unref();
      reject(error);
    }
  });
}

module.exports = { createDesktopSyncCompute, computeDesktopSync: (operation, ...args) => compute(operation, args) };
