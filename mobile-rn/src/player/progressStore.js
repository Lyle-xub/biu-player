// Only progress views subscribe to the native clock. The playback owner does
// not need to rerun its account/library/profile hooks for every time sample.
export function createProgressStore() {
  let live = { position: 0, duration: 0 };
  let visible = live;
  const listeners = new Set();
  const same = (a, b) => a.position === b.position && a.duration === b.duration;
  return {
    getSnapshot: () => live,
    getVisibleSnapshot: () => visible,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    publish(next, foreground) {
      const beforeLive = live, beforeVisible = visible;
      if (!same(live, next)) live = next;
      if (foreground) visible = live;
      if (live !== beforeLive || visible !== beforeVisible) listeners.forEach(listener => listener());
    },
  };
}
