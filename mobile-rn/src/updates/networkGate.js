let recommendationRequests = 0;
const idleListeners = new Set();

export const isRecommendationBusy = () => recommendationRequests > 0;

export function beginRecommendation() {
  recommendationRequests += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    recommendationRequests = Math.max(0, recommendationRequests - 1);
    if (!recommendationRequests) idleListeners.forEach((listener) => listener());
  };
}

export function onRecommendationIdle(listener) {
  idleListeners.add(listener);
  return () => idleListeners.delete(listener);
}

// Foreground reads never wait for background sync. Background work waits only between operations.
export function waitForRecommendationIdle(signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('任务已取消'), { name: 'AbortError' }));
  if (!isRecommendationBusy()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { remove(); signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { remove(); signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('任务已取消'), { name: 'AbortError' })); };
    const remove = onRecommendationIdle(done);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Promise continuations (including cache hits) do not yield to native input.
// Give navigation a turn between small batches, and make the wait cancellable.
export function yieldToInput(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('检索已取消'), { name: 'AbortError' })); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 8);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
