/* Bounded connection attempts; caller cancellation must never start a retry. */
function create({ primary, direct, primaryTimeout = 2500, directTimeout = 5000 }) {
  async function attempt(fetcher, url, options, timeout) {
    const controller = new AbortController();
    let timer;
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    signal.throwIfAborted();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('网络连接超时'));
      }, timeout);
    });
    try { return await Promise.race([fetcher(url, { ...options, signal }), deadline]); }
    finally { clearTimeout(timer); }
  }
  return async (url, options = {}) => {
    try {
      const response = await attempt(primary, url, options, primaryTimeout);
      if (![502, 503, 504].includes(response.status) || !['GET', 'HEAD'].includes(options.method || 'GET')) return response;
      response.body?.cancel().catch(() => {});
    } catch (error) { if (options.signal?.aborted) throw error; }
    const opts = { ...options };
    delete opts.credentials;
    return attempt(direct, url, opts, directTimeout);
  };
}
module.exports = { create };
