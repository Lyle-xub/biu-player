/* Shared by the React desktop controller and the classic desktop UI. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BiuPlaybackRecovery = factory();
})(typeof window === 'object' ? window : this, function () {
  function expired(src, now) {
    try {
      let url = new URL(src);
      if (url.searchParams.has('url')) url = new URL(url.searchParams.get('url'));
      const deadline = Number(url.searchParams.get('deadline'))
        || parseInt(url.searchParams.get('wsTime') || '', 16);
      return Number.isFinite(deadline) && deadline > 0 && deadline * 1000 <= now + 30000;
    } catch { return false; }
  }

  function create({ read, refresh, report, changed = () => {}, cancelled = () => {}, now = Date.now }) {
    const samples = new WeakMap();
    let generation = 0, pending = null, attempted = false, refreshFailed = false, failedPosition = null;
    function bind(media) {
      const sample = { position: 0, pausedAt: now(), wanted: false };
      samples.set(media, sample);
      media.addEventListener('timeupdate', () => {
        if (!media.error && Number.isFinite(media.currentTime)) sample.position = media.currentTime;
      });
      media.addEventListener('play', () => { sample.wanted = true; });
      media.addEventListener('pause', () => {
        if (!media.error) { sample.wanted = false; sample.pausedAt = now(); }
      });
      media.addEventListener('emptied', () => { sample.position = 0; sample.wanted = false; });
    }
    function cancel() {
      generation++;
      if (pending) {
        failedPosition = pending.position;
        refreshFailed = true;
        cancelled();
      }
      pending = null;
      changed(false);
    }
    function reset() { cancel(); attempted = false; refreshFailed = false; failedPosition = null; }
    function stale(media) {
      return !!media.error || expired(media.currentSrc || media.src, now())
        || now() - (samples.get(media)?.pausedAt ?? now()) >= 5 * 60 * 1000;
    }
    function resume(force = false) {
      if (pending) return pending.promise;
      const state = read();
      if (!state?.track || state.track.isLive) return Promise.resolve();
      const token = ++generation;
      const valid = () => token === generation && read()?.track === state.track;
      const position = state.sound.error ? samples.get(state.sound)?.position : state.sound.currentTime;
      state.position = refreshFailed && failedPosition !== null ? failedPosition
        : Number.isFinite(position) ? position : state.track.from || 0;
      const job = { position: state.position };
      pending = job;
      changed(true);
      // Defer until pending is installed: an error event and play() rejection
      // must share one refresh, including when both DASH tracks fail together.
      job.promise = Promise.resolve().then(async () => {
        const reload = async () => {
          if (!valid()) return;
          attempted = true;
          state.media.pause();
          if (state.sound !== state.media) state.sound.pause();
          await refresh(state, valid);
          if (valid()) { refreshFailed = false; failedPosition = null; }
        };
        if (!valid()) return;
        if (force || refreshFailed || stale(state.media) || stale(state.sound)) return reload();
        try {
          if (state.sound !== state.media) state.media.currentTime = state.sound.currentTime;
          let timer;
          try {
            await Promise.race([
              Promise.all([...new Set([state.media, state.sound])].map(media => media.play())),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('播放连接超时')), 12000); }),
            ]);
          } finally { clearTimeout(timer); }
        } catch (error) {
          if (!valid() || error?.name === 'AbortError') return;
          await reload();
        }
      }).catch(error => {
        if (valid()) { refreshFailed = true; failedPosition = state.position; report(error); }
      }).finally(() => {
        if (pending === job) { pending = null; changed(false); }
      });
      return job.promise;
    }
    function handleError(media) {
      const state = read();
      if (!state?.track || state.track.isLive || (media !== state.media && media !== state.sound)) return;
      if (pending || !samples.get(state.media)?.wanted) return;
      if (attempted) { report(new Error('媒体连接失败，请检查网络后点击播放重试')); return; }
      void resume(true);
    }
    return { bind, reset, cancel, resume, handleError, get pending() { return !!pending; } };
  }
  return { create, expired };
});
