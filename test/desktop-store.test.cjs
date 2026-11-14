const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createStoreWriter, readJsonStore } = require('../desktop-store');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('desktop periodic playback writes migrate the old snapshot without touching the library file', t => {
  const dir = directory(t);
  const storeFile = path.join(dir, 'biu-store.json'), playbackFile = path.join(dir, 'biu-playback.json');
  const library = JSON.stringify({ 'biu-playlists': [{ title: 'keep' }], 'biu-playback-session': { position: 12 },
    'biu-lan-device': 'device' });
  fs.writeFileSync(storeFile, library);
  const app = Object.assign(new EventEmitter(), { getPath: () => dir });
  const ipcMain = new EventEmitter(), handlers = new Map();
  ipcMain.handle = (name, cb) => handlers.set(name, cb);
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf("  const { createStoreWriter"), source.indexOf('  const updates =')),
    { app, ipcMain, path, console, require: name => {
      assert.equal(name, './desktop-store'); return { createStoreWriter, readJsonStore };
    } });
  const read = () => handlers.get('store:get')({}, 'biu-playback-session').position;
  assert.equal(read(), 12);
  ipcMain.emit('store:set', {}, 'biu-playback-session', { position: 30 });
  assert.equal(read(), 30, 'queued progress is immediately readable');
  const event = {};
  ipcMain.emit('playback:save', event, { position: 31 });
  assert.equal(event.returnValue, true);
  app.emit('will-quit');
  assert.equal(readJsonStore(playbackFile).position, 31);
  assert.equal(fs.readFileSync(storeFile, 'utf8'), library, 'playing and closing did not rewrite the library');
  fs.writeFileSync(playbackFile, '{broken');
  assert.equal(readJsonStore(playbackFile).position, 31, 'the playback backup remains available');
});

test('in-flight background writes cannot overwrite an acknowledged flush', async t => {
  const file = path.join(directory(t), 'data.json');
  let value = { position: 12 }, started, resume;
  const writing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const writes = [];
  const fakeFs = { ...fs, promises: { async writeFile(...args) {
    started();
    const work = gate.then(() => fs.promises.writeFile(...args)); writes.push(work);
    await work;
  } } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../desktop-store'), 'utf8'),
    { module, require: () => fakeFs, setTimeout, clearTimeout });
  const writer = module.exports.createStoreWriter(file, () => value, { delay: 0 });
  writer.changed();
  // Keep the event loop alive: the production debounce timer deliberately unrefs itself.
  const hold = setInterval(() => {}, 1000);
  try {
    await writing;
    value = { position: 42 }; assert.equal(writer.flush(), true);
    resume(); await Promise.all(writes); await new Promise(resolve => setImmediate(resolve));
    assert.equal(readJsonStore(file).position, 42);
    assert.equal(JSON.parse(fs.readFileSync(file + '.bak')).position, 42);
  } finally { clearInterval(hold); }
});
