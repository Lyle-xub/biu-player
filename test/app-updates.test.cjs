const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppUpdates } = require('../app-updates');
const { compareVersions, androidRelease } = require('../renderer/update-release');

test('update preferences, throttling, and explicit install never interrupt playback', async () => {
  const app = Object.assign(new EventEmitter(), { isPackaged: true, getVersion: () => '0.6.2' });
  let checks = 0, downloads = 0, installs = 0, prepared = false, saved;
  const updater = Object.assign(new EventEmitter(), {
    async checkForUpdates() { checks++; updater.emit('update-available', { version: '0.6.3' }); },
    async downloadUpdate() { downloads++; updater.emit('update-downloaded', { version: '0.6.3' }); },
    quitAndInstall() { assert(prepared); installs++; },
  });
  const manager = createAppUpdates({ app, updater, platform: 'win32', read: () => ({ enabled: false, autoDownload: false }),
    write: value => { saved = value; }, notify() {}, beforeInstall() { prepared = true; } });
  try {
    await manager.check(); assert.equal(checks, 0);
    await manager.check(true); assert.equal(checks, 1); assert.equal(downloads, 0);
    assert.equal(manager.status().phase, 'available');
    manager.configure({ enabled: true, autoDownload: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads, 1); assert.equal(manager.status().phase, 'ready'); assert.equal(installs, 0);
    assert.equal(saved.autoDownload, true); assert.equal(updater.autoInstallOnAppQuit, true);
    await manager.check(true); assert.equal(downloads, 1);
    manager.install(); assert.equal(installs, 1);
  } finally { app.emit('will-quit'); }
});

test('APK versions come from assets, skip desktop-only releases and reject foreign/unverified packages', () => {
  const asset = version => ({ name: `Biu-Player-${version}-android-arm64.apk`, size: 100,
    digest: 'sha256:' + 'ab'.repeat(32), browser_download_url: `https://github.com/Lyle-xub/biu-player/releases/download/v0.6.2/Biu-Player-${version}-android-arm64.apk` });
  const releases = [{ tag_name: 'v9.0.0', assets: [] }, { tag_name: 'v0.6.2', assets: [asset('1.0.2'), asset('1.0.10')] }];
  assert.equal(androidRelease(releases, '1.0.1').version, '1.0.10');
  assert.equal(androidRelease(releases, '1.0.10'), null);
  assert(compareVersions('1.0.10', '1.0.2') > 0);
  assert.equal(androidRelease([{ ...releases[1], prerelease: true }], '1.0.1'), null);
  assert.equal(androidRelease([{ ...releases[1], assets: [{ ...asset('1.0.2'), browser_download_url: 'https://example.com/a.apk' }] }], '1.0.1'), null);
  assert.equal(androidRelease([{ ...releases[1], assets: [{ ...asset('1.0.2'), digest: null }] }], '1.0.1'), null);
});
