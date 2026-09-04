import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Zeroconf from 'react-native-zeroconf';
import { usePlayer } from '../player/PlayerContext';
import { startAutoSync } from './lanSync';
import { useCloudSync } from './CloudSyncProvider';

const KEY = 'biu.lan-auto';
const LanSyncContext = createContext(null);
export const useLanSync = () => useContext(LanSyncContext);

export function LanSyncProvider({ children }) {
  const { account, libraryReady, getSyncLibrary, applySyncLibrary } = usePlayer();
  const syncLanKey = useCloudSync()?.syncLanKey;
  const [enabled, setEnabledState] = useState(true);
  const [ready, setReady] = useState(false);
  const [clientId, setClientId] = useState('');
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [status, setStatus] = useState({ message: '正在检查同步状态…' });
  const [saving, setSaving] = useState(false);
  const runner = useRef(null);
  const scope = account?.isLogin && account.mid ? String(account.mid) : '';
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        let id = await AsyncStorage.getItem('biu.lan-device');
        if (!id) {
          id = 'phone-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
          await AsyncStorage.setItem('biu.lan-device', id);
        }
        if (!cancelled) { setEnabledState(saved !== 'false'); setClientId(id); setReady(true); }
      } catch { if (!cancelled) setStatus({ message: '同步设置读取失败，请重启后重试' }); }
    })();
    const subscription = AppState.addEventListener('change', (value) => {
      if (value !== 'active') { runner.current?.(); runner.current = null; }
      setForeground(value === 'active');
    });
    return () => { cancelled = true; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!ready) return undefined;
    if (!enabled || !scope || !foreground || !libraryReady) {
      setStatus({ connected: false, message: !enabled ? '自动同步已关闭'
        : !scope ? '登录后自动连接同一 Wi-Fi 内的同账号电脑'
        : !foreground ? '回到 App 后自动继续同步' : '正在读取当前账号的音乐库…' });
      return undefined;
    }
    if (!NativeModules.RNZeroconf) {
      setStatus({ connected: false, message: '自动发现需要新版安装包或开发构建，Expo Go 暂不支持' });
      return undefined;
    }
    setStatus({ connected: false, message: '正在寻找同一 Wi-Fi 内的同账号电脑…' });
    const stop = startAutoSync({ scope, clientId, discovery: new Zeroconf(), storage: AsyncStorage,
      getLibrary: getSyncLibrary, applyLibrary: applySyncLibrary, syncCloudKey: syncLanKey,
      onStatus: (patch) => setStatus((before) => ({ ...before, ...patch })) });
    runner.current = stop;
    return () => { stop(); if (runner.current === stop) runner.current = null; };
  }, [ready, enabled, foreground, libraryReady, scope, clientId, getSyncLibrary, applySyncLibrary, syncLanKey]);
  const setEnabled = async (value) => {
    if (saving || !ready) return;
    setSaving(true);
    try {
      await AsyncStorage.setItem(KEY, String(value));
      if (!value) { runner.current?.(); runner.current = null; }
      setEnabledState(value);
    } catch { setStatus((before) => ({ ...before, message: '同步设置保存失败，请重试' })); }
    finally { setSaving(false); }
  };
  return <LanSyncContext.Provider value={{ enabled, setEnabled, ready, saving, ...status }}>{children}</LanSyncContext.Provider>;
}
