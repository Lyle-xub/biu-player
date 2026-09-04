import { AppState, Linking, Platform } from 'react-native';
import { isRunningInExpoGo, requireOptionalNativeModule } from 'expo';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import appConfig from '../../app.json';
const { androidRelease, compareVersions } = require('../../../renderer/update-release');

const Native = Platform.OS === 'android' ? requireOptionalNativeModule('BiuUpdates') : null;
const KEY = 'biu.app-updates';
const INTERVAL = 6 * 60 * 60 * 1000;
let state = { currentVersion: (isRunningInExpoGo() ? appConfig.expo.version : Application.nativeApplicationVersion) || appConfig.expo.version, enabled: true, autoDownload: true,
  phase: 'idle', version: '', progress: 0, message: '', checkedAt: 0, loaded: false,
  supported: !isRunningInExpoGo() && !__DEV__ && (Platform.OS === 'ios' || !!Native) };
const listeners = new Set();
let started = false, checking, downloading = false, release, attemptedAt = 0, pollTimer;
const emit = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); return state; };
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const fail = error => emit({ phase: 'error', message: error?.message || '更新暂时不可用，请稍后重试' });
async function json(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? '更新服务繁忙，请稍后重试' : '无法获取更新，请检查网络');
    return await response.json();
  } finally { clearTimeout(timeout); }
}
async function poll() {
  clearTimeout(pollTimer);
  if (!Native || !state.supported) return;
  try {
    const next = await Native.status();
    if (next.phase !== 'idle') emit({ ...next, message: next.phase === 'ready' ? '更新已下载，点击安装' : next.message });
    if (next.phase === 'downloading' && AppState.currentState === 'active') pollTimer = setTimeout(poll, 1000);
  } catch (error) { fail(error); }
}
async function check(manual = false) {
  if (!state.supported) return emit({ message: '请在正式安装包中使用应用更新' });
  if (checking || ['downloading', 'ready'].includes(state.phase)) return state;
  if (!manual && (!state.enabled || Date.now() - attemptedAt < INTERVAL)) return state;
  attemptedAt = Date.now();
  emit({ phase: 'checking', message: '正在检查更新' });
  checking = (async () => {
    if (Platform.OS === 'android') {
      release = androidRelease(await json('https://api.github.com/repos/Lyle-xub/biu-player/releases?per_page=30'), state.currentVersion);
    } else {
      const data = await json(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(Application.applicationId)}&country=cn`);
      const app = data.results?.find(item => item.bundleId === Application.applicationId);
      if (!app) return emit({ phase: 'current', message: 'iOS 暂无公开商店版本，请通过当前分发渠道更新', checkedAt: Date.now() });
      release = compareVersions(app.version, state.currentVersion) > 0 && /^https:\/\/apps\.apple\.com\//.test(app.trackViewUrl)
        ? { version: app.version, url: app.trackViewUrl } : null;
    }
    emit({ phase: release ? 'available' : 'current', version: release?.version || '', checkedAt: Date.now(),
      message: release ? `发现新版本 ${release.version}` : '已是最新版本' });
    if (release && Native && state.autoDownload && Native.unmetered()) void download(true);
    else if (release && Native && state.autoDownload) emit({ message: '发现新版本，连接 Wi-Fi 后自动下载' });
  })().catch(error => fail(new Error(error.name === 'AbortError' ? '检查更新超时，请稍后重试' : error.message))).finally(() => { checking = null; });
  await checking;
  return state;
}
async function download(automatic = false) {
  if (downloading || !release || !state.supported || ['downloading', 'ready'].includes(state.phase)) return;
  if (Platform.OS === 'ios') return Linking.openURL(release.url).catch(fail);
  downloading = true;
  try {
    emit({ phase: 'downloading', progress: 0, message: '正在下载更新' });
    await Native.download(release.url, release.version, release.hash, release.size, automatic);
    await poll();
  } catch (error) { fail(error); }
  finally { downloading = false; }
}
async function install() {
  if (state.phase !== 'ready' || !Native) return;
  try {
    const result = await Native.install();
    if (result === 'permission') emit({ message: '允许安装此来源的应用后，返回这里再次点击安装' });
  } catch (error) { fail(error); }
}
async function configure(patch) {
  const next = { enabled: typeof patch.enabled === 'boolean' ? patch.enabled : state.enabled,
    autoDownload: typeof patch.autoDownload === 'boolean' ? patch.autoDownload : state.autoDownload };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next)); emit(next);
    if (next.enabled) void check();
    if (next.autoDownload && Native?.unmetered() && state.phase === 'available') void download(true);
  } catch { emit({ message: '更新设置保存失败，请重试' }); }
}
async function start() {
  if (started) return;
  started = true;
  try { const saved = JSON.parse(await AsyncStorage.getItem(KEY)); emit({ enabled: saved?.enabled !== false, autoDownload: saved?.autoDownload !== false }); } catch {}
  emit({ loaded: true });
  await poll();
  setTimeout(() => void check(), 10000);
  AppState.addEventListener('change', async value => {
    if (value !== 'active') { clearTimeout(pollTimer); return; }
    await poll();
    if (state.enabled && state.autoDownload && state.phase === 'available' && Native?.unmetered()) void download(true);
    void check();
  });
  setInterval(() => { if (AppState.currentState === 'active') void check(); }, INTERVAL);
}
export const appUpdates = { start, check: () => check(true), download: () => download(false), install, configure };
export function useAppUpdates() { return useSyncExternalStore(subscribe, () => state, () => state); }
