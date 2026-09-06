import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Zeroconf from 'react-native-zeroconf';
import md5 from 'js-md5';
import { usePlayer } from '../player/PlayerContext';
import { startAutoSync } from './lanSync';
import { startLanReceiver } from './lanSyncServer';
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
  const discovery = useRef(null);
  const syncHandlers = useRef({ getSyncLibrary, applySyncLibrary, syncLanKey });
  syncHandlers.current = { getSyncLibrary, applySyncLibrary, syncLanKey };
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
        : !scope ? '登录后自动连接同一 Wi-Fi 内的同账号设备'
        : !foreground ? '回到 App 后自动继续同步' : '正在读取当前账号的音乐库…' });
      return undefined;
    }
    if (!NativeModules.RNZeroconf) {
      setStatus({ connected: false, message: '自动发现需要新版安装包或开发构建，Expo Go 暂不支持' });
      return undefined;
    }
    setStatus({ connected: false, message: '正在寻找同一 Wi-Fi 内的同账号设备…' });
    const serviceDiscovery = new Zeroconf();
    discovery.current = serviceDiscovery;
    const implementation = Platform.OS === 'android' ? 'NSD' : 'DNSSD';
    const name = `Biu-${clientId}`;
    const getLibrary = (...args) => syncHandlers.current.getSyncLibrary(...args);
    const applyLibrary = (...args) => syncHandlers.current.applySyncLibrary(...args);
    let stopped = false, receiver;
    const report = (patch) => { if (!stopped) setStatus((before) => ({ ...before, ...patch })); };
    if (NativeModules.TcpSockets) {
      try {
        const tcp = require('react-native-tcp-socket');
        receiver = startLanReceiver({ tcp: tcp.default || tcp, scope, deviceId: clientId, getLibrary, applyLibrary, onStatus: report });
        receiver.ready.then(({ port, token }) => {
          if (!stopped) serviceDiscovery.publishService('biu-sync', 'tcp', 'local.', name, port,
            { version: '2', account: md5('biu-lan:' + scope), device: clientId, token, kind: 'mobile' }, implementation);
        }).catch(() => { if (!stopped) { receiver.stop(); report({ receiverError: '手机直连暂不可用，请重新开启局域网同步' }); } });
      } catch { report({ receiverError: '手机直连启动失败，请重新开启局域网同步' }); }
    } else report({ receiverError: '手机直连需要新版安装包' });
    const stopScan = startAutoSync({ scope, clientId, discovery: serviceDiscovery,
      implementation, storage: AsyncStorage, getLibrary, applyLibrary,
      syncCloudKey: (...args) => syncHandlers.current.syncLanKey?.(...args),
      getInboundStatus: () => receiver?.status(), onStatus: report });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      receiver?.stop();
      try { serviceDiscovery.unpublishService(name, implementation); } catch {}
      stopScan();
    };
    runner.current = stop;
    return () => {
      stop();
      if (runner.current === stop) runner.current = null;
      if (discovery.current === serviceDiscovery) discovery.current = null;
    };
  }, [ready, enabled, foreground, libraryReady, scope, clientId]);
  const setEnabled = useCallback(async (value) => {
    if (saving || !ready) return;
    setSaving(true);
    try {
      await AsyncStorage.setItem(KEY, String(value));
      if (!value) { runner.current?.(); runner.current = null; }
      setEnabledState(value);
    } catch { setStatus((before) => ({ ...before, message: '同步设置保存失败，请重试' })); }
    finally { setSaving(false); }
  }, [saving, ready]);
  const value = useMemo(() => ({ enabled, setEnabled, ready, saving, ...status,
    message: [status.message, status.receiverError].filter(Boolean).join(' · ') }),
    [enabled, setEnabled, ready, saving, status]);
  return <LanSyncContext.Provider value={value}>{children}</LanSyncContext.Provider>;
}
