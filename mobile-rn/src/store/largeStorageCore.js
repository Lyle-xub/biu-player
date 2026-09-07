// Large account values live outside Android's SQLite CursorWindow. Keep one writer per key.
export const isLargeKey = key => /^biu\.(likes|history|library|playlists|recommendation-profiles|discovery-recommendation-profiles|lan-baseline)(@|$)/.test(key)
  || /^biu\.(favorite-covers\.|playback-session$)/.test(key);
export function createLargeStorage({ legacy, files, readLegacyLarge }) {
  const pending = new Map();
  const run = (key, work) => {
    const task = (pending.get(key) || Promise.resolve()).catch(() => {}).then(work);
    pending.set(key, task);
    task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    return task;
  };
  return {
    // Existence checks must not read multi-megabyte account buckets just to
    // decide whether guest migration is needed on every signed-in cold start.
    hasItem: key => run(key, async () => {
      if (files && isLargeKey(key) && await files.exists(key)) return true;
      return (await legacy.getAllKeys()).includes(key);
    }),
    getItem: key => !files || !isLargeKey(key) ? legacy.getItem(key) : run(key, async () => {
      const saved = await files.read(key);
      if (saved !== null) return saved;
      // Android reads legacy values in small windows from the outset; iOS uses
      // AsyncStorage's existing file reader. Never issue an oversized row query.
      const value = await (readLegacyLarge ? readLegacyLarge(key) : legacy.getItem(key));
      if (value !== null) {
        await files.write(key, value);
        await legacy.removeItem(key).catch(() => {});
      }
      return value;
    }),
    setItem: (key, value) => !files || !isLargeKey(key) ? legacy.setItem(key, value) : run(key, async () => {
      await files.write(key, value);
      await legacy.removeItem(key).catch(() => {});
    }),
    removeItem: key => !files || !isLargeKey(key) ? legacy.removeItem(key) : run(key, async () => {
      // Remove legacy first, so a failed deletion cannot resurrect it on the next read.
      await legacy.removeItem(key);
      await files.remove(key);
    }),
  };
}
