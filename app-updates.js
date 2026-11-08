const INTERVAL = 6 * 60 * 60 * 1000;
const fs = require('node:fs');
const path = require('node:path');
const recoveredConfig = new WeakMap();
const OFFICIAL_CONFIG = 'provider: github\nowner: Lyle-xub\nrepo: biu-player\nupdaterCacheDirName: biu-player-updater\n';

function ensureUpdateConfiguration({ app, updater, resourcesPath = process.resourcesPath }) {
  if (!app.isPackaged) return;
  const bundled = path.join(resourcesPath, 'app-update.yml');
  if (fs.existsSync(bundled)) return;
  // Old locally packaged builds omitted this file. Recover outside the signed
  // app bundle so both discovery and the download cache have a valid config.
  const directory = path.join(app.getPath('userData'), 'updates');
  const file = path.join(directory, 'app-update.yml');
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== OFFICIAL_CONFIG) {
    fs.writeFileSync(file, OFFICIAL_CONFIG, { mode: 0o600 });
  }
  if (recoveredConfig.get(updater) !== file) {
    updater.updateConfigPath = file;
    recoveredConfig.set(updater, file);
  }
}

function createAppUpdates({ app, updater, read, write, notify, beforeInstall, prepare = () => {}, platform = process.platform }) {
  const saved = read() || {};
  let state = { currentVersion: app.getVersion(), enabled: saved.enabled !== false,
    autoDownload: saved.autoDownload !== false, phase: 'idle', version: '', progress: 0,
    checkedAt: 0, message: '', supported: app.isPackaged && ['darwin', 'win32'].includes(platform) };
  let checking, downloading, attemptedAt = 0, recommendationRequests = 0;
  let pendingCheck = false, pendingDownload = false;
  const emit = patch => { state = { ...state, ...patch }; notify({ ...state }); return { ...state }; };
  const fail = error => emit({ phase: 'error', errorCode: error?.code || '', message:
    error?.code === 'ENOENT' ? '更新配置缺失，请安装完整的官方安装包'
    : error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' ? '最新发布暂未提供当前平台的更新文件，请稍后重试'
    : error?.code === 'ERR_UPDATER_ZIP_FILE_NOT_FOUND' ? '最新发布没有适合此 Mac 架构的更新包'
    : '更新暂时不可用，请检查网络后重试' });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = state.autoDownload;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.logger = null;
  updater.on('error', fail);
  updater.on('update-available', info => {
    emit({ phase: 'available', version: info.version, progress: 0, message: `发现新版本 ${info.version}` });
    if (state.autoDownload) {
      if (recommendationRequests) pendingDownload = true;
      else void download();
    }
  });
  updater.on('update-not-available', () => emit({ phase: 'current', version: '', message: '已是最新版本' }));
  updater.on('download-progress', p => emit({ phase: 'downloading', progress: Math.max(0, Math.min(100, p.percent)), message: '正在下载更新' }));
  updater.on('update-downloaded', info => emit({ phase: 'ready', version: info.version, progress: 100, message: '更新已准备好，可重启安装' }));
  async function check(manual = false) {
    if (!state.supported) return emit({ message: '开发预览不安装更新，请使用正式安装包' });
    if (checking || ['downloading', 'ready'].includes(state.phase)) return state;
    if (!manual && recommendationRequests) { pendingCheck = true; return state; }
    if (!manual && (!state.enabled || Date.now() - attemptedAt < INTERVAL)) return state;
    pendingCheck = false;
    attemptedAt = Date.now();
    emit({ phase: 'checking', errorCode: '', message: '正在检查更新' });
    checking = Promise.resolve().then(() => { prepare(); return updater.checkForUpdates(); })
      .then(() => emit({ checkedAt: Date.now() })).catch(fail).finally(() => { checking = null; });
    await checking;
    return state;
  }
  async function download() {
    if (downloading || !state.supported || !state.version || !['available', 'error'].includes(state.phase)) return state;
    emit({ phase: 'downloading', progress: 0, message: '正在下载更新' });
    downloading = updater.downloadUpdate().catch(fail).finally(() => { downloading = null; });
    await downloading;
    return state;
  }
  function configure(patch) {
    const prefs = { enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : state.enabled,
      autoDownload: typeof patch?.autoDownload === 'boolean' ? patch.autoDownload : state.autoDownload };
    write(prefs);
    updater.autoInstallOnAppQuit = prefs.autoDownload;
    emit(prefs);
    if (prefs.enabled) void check();
    if (prefs.autoDownload && state.phase === 'available') {
      if (recommendationRequests) pendingDownload = true;
      else void download();
    }
    return state;
  }
  function activity(delta) {
    recommendationRequests = Math.max(0, recommendationRequests + (Number(delta) || 0));
    if (recommendationRequests) return state;
    if (pendingDownload && state.autoDownload && state.phase === 'available') {
      pendingDownload = false;
      void download();
    } else if (pendingCheck) {
      pendingCheck = false;
      void check();
    }
    return state;
  }
  const startup = setTimeout(() => void check(), 10000); startup.unref?.();
  const timer = setInterval(() => void check(), INTERVAL); timer.unref?.();
  const resume = () => void check();
  app.on('browser-window-focus', resume);
  app.once('will-quit', () => { clearTimeout(startup); clearInterval(timer); app.removeListener('browser-window-focus', resume); });
  return { status: () => ({ ...state }), check, download, configure, activity,
    install() {
      if (state.phase !== 'ready') return state;
      beforeInstall();
      updater.quitAndInstall(false, true);
      return state;
    },
  };
}
module.exports = { createAppUpdates, ensureUpdateConfiguration };
