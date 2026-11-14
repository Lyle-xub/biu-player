const fs = require('node:fs');

function readJsonStore(file, fallback) {
  for (const candidate of [file, file + '.bak']) {
    try {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Fall back to the last valid copy. */ }
  }
  return fallback;
}

// One writer per file. Background writes stage asynchronously; publication and
// the revision check occur together so a queued write cannot replace a flush.
function createStoreWriter(file, read, { delay = 300, onError = () => {} } = {}) {
  let revision = 0, saved = 0, timer = null, writing = false;
  const names = base => [file + base, file + '.bak' + base];
  const destinations = [file, file + '.bak'];
  const publish = staged => {
    fs.renameSync(staged[0], destinations[0]);
    // The primary has already committed. A backup failure must not cause the
    // caller to roll back in-memory data past the on-disk state.
    try { fs.renameSync(staged[1], destinations[1]); } catch (error) { onError(error); }
  };
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void write(); }, delay);
    timer.unref?.();
  }
  async function write() {
    if (writing || saved === revision) return;
    writing = true;
    const writingRevision = revision;
    const staged = names('.background.tmp');
    try {
      const json = JSON.stringify(read());
      // Wait for both writes even if one fails, so there are no outstanding
      // users of the staging files when the next write starts.
      const results = await Promise.allSettled(staged.map(name => fs.promises.writeFile(name, json)));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      if (writingRevision === revision) { publish(staged); saved = writingRevision; }
    } catch (error) { onError(error); }
    finally {
      writing = false;
      if (saved !== revision && revision !== writingRevision && !timer) schedule();
    }
  }
  function flush() {
    clearTimeout(timer); timer = null;
    // Also covers explicit transactions whose caller has just set new data.
    revision++;
    const staged = names('.tmp');
    try {
      const json = JSON.stringify(read());
      for (const name of staged) fs.writeFileSync(name, json);
      publish(staged);
      saved = revision;
      return true;
    } catch (error) { onError(error); return false; }
  }
  return {
    changed() { revision++; schedule(); },
    flush,
    flushPending: () => saved === revision || flush(),
  };
}

module.exports = { createStoreWriter, readJsonStore };
