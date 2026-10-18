const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlaybackDiagnostics } = require('../playback-diagnostics');

test('playback logs accept structured state, omit credentials and URLs, and rotate to one backup', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'biu-playback-log-'));
  const file = path.join(directory, 'playback.log');
  t.after(() => {
    for (const entry of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, entry));
    fs.rmdirSync(directory);
  });
  const log = createPlaybackDiagnostics(directory, 100);
  log({ event: 'unknown', Cookie: 'secret' });
  assert.equal(fs.existsSync(file), false);
  log({ event: 'refresh', bvid: 'BV1test', cid: 12, position: 83.5, readyState: 2,
    url: 'https://cdn.test/?signature=secret', Cookie: 'secret', message: 'secret' });
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(entry.bvid, 'BV1test'); assert.equal(entry.position, 83.5);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('secret'));
  log({ event: 'proxy-failure', errorName: 'AbortError', host: 'cdn.test' });
  log({ event: 'stall', mediaError: 0, soundError: 0 });
  assert.ok(fs.existsSync(file + '.1'));
  assert.equal(fs.readdirSync(directory).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).event, 'stall');
});

test('a broken log path cannot interrupt playback', () => {
  assert.doesNotThrow(() => createPlaybackDiagnostics(__filename)({ event: 'resume' }));
});
