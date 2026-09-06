const INTERVAL = 6 * 60 * 60 * 1000;

function createAppUpdates({ app, updater, read, write, notify, beforeInstall, platform = process.platform }) {
  const saved = read() || {};
  let state = { currentVersion: app.getVersion(), enabled: saved.enabled !== false,
    autoDownload: saved.autoDownload !== false, phase: 'idle', version: '', progress: 0,
    checkedAt: 0, message: '', supported: app.isPackaged && ['darwin', 'win32'].includes(platform) };
  let checking, downloading, attemptedAt = 0, recommendationRequests = 0;
  let pendingCheck = false, pendingDownload = false;
  const emit = patch => { state = { ...state, ...patch }; notify({ ...state }); return { ...state }; };
  const fail = () => emit({ phase: 'error', message: '更新暂时不可用，请检查网络后重试' });
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
    emit({ phase: 'checking', message: '正在检查更新' });
    checking = updater.checkForUpdates().then(() => emit({ checkedAt: Date.now() })).catch(fail).finally(() => { checking = null; });
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
module.exports = { createAppUpdates };
