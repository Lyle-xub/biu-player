import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { pollAppAuthorization, startAppAuthorization } from '../api/client';
import { colors } from '../theme';
import { Dialog } from './Dialog';
import QrCode from './QrCode';

export default function AppRecommendationAuth({ onClose, onAuthorized, onUseSms, login = false }) {
  const callbacks = useRef({ onClose, onAuthorized });
  callbacks.current = { onClose, onAuthorized };
  const [revision, setRevision] = useState(0);
  const [grant, setGrant] = useState(null);
  const [status, setStatus] = useState('正在生成授权二维码…');
  const [stopped, setStopped] = useState(false);
  const [linkError, setLinkError] = useState('');
  const request = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    let timer, currentGrant, polling = false, done = false;
    setGrant(null); setStopped(false); setLinkError(''); setStatus('正在生成授权二维码…');
    const poll = async () => {
      clearTimeout(timer);
      if (controller.signal.aborted || done || polling || !currentGrant) return;
      polling = true;
      try {
        if (AppState.currentState !== 'active') return;
        const result = await pollAppAuthorization(currentGrant, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.status === 'authorized') {
          done = true; await callbacks.current.onAuthorized(result.auth); return;
        }
        if (result.status === 'expired') {
          done = true; setStopped(true); setStatus('授权二维码已过期，请刷新'); return;
        }
        setStatus(result.status === 'scanned' ? '请在 B 站 App 中确认授权' : '等待 B 站 App 确认授权…');
      } catch (error) {
        if (!controller.signal.aborted) { done = true; setStopped(true); setStatus(error.message || '授权失败，请刷新重试'); }
      } finally {
        polling = false;
        if (!done && !controller.signal.aborted) timer = setTimeout(poll, 1200);
      }
    };
    startAppAuthorization({ signal: controller.signal, login }).then((value) => {
      if (controller.signal.aborted) return;
      currentGrant = value; setGrant(value); poll();
    }).catch((error) => {
      if (!controller.signal.aborted) { setStopped(true); setStatus(error.message || '无法创建授权，请重试'); }
    });
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') poll(); });
    return () => { controller.abort(); clearTimeout(timer); subscription.remove(); };
  }, [revision, login]);
  const close = () => { request.current?.abort(); callbacks.current.onClose(); };
  return <Dialog visible onClose={close}>
    <Text style={s.title}>{login ? '使用 B 站 App 登录' : '授权 B 站 App 推荐'}</Text>
    <Text style={s.hint}>{login ? '打开 B 站 App 确认登录，再返回这里。一次登录即可使用推荐、收藏夹和播放功能。也可用 B 站扫一扫扫描下方二维码。' : '打开 B 站，使用与「我的」相同的账号确认授权，再返回这里。也可用 B 站扫一扫扫描下方二维码。'}</Text>
    <View style={s.code}>{grant && !stopped ? <QrCode text={grant.url} size={210} /> : !stopped ? <ActivityIndicator color={colors.accent} /> : null}</View>
    <Text accessibilityLiveRegion="polite" style={s.hint}>{status}</Text>
    {!!linkError && <Text style={s.hint}>{linkError}</Text>}
    {grant && !stopped ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="打开 B 站授权" style={s.primary}
      onPress={async () => {
        const controller = request.current;
        try { await Linking.openURL(`bilibili://browser?url=${encodeURIComponent(grant.url)}`); }
        catch { if (!controller?.signal.aborted) setLinkError('无法打开 B 站 App，请确认已安装；也可截图后用 B 站扫一扫识别。'); }
      }}><Text style={s.primaryText}>打开 B 站授权</Text></TouchableOpacity> : null}
    <View style={s.actions}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="刷新授权二维码" style={s.button}
        onPress={() => { request.current?.abort(); setRevision((n) => n + 1); }}><Text style={s.hint}>刷新二维码</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="取消 App 授权" style={s.button} onPress={close}><Text style={s.hint}>暂不授权</Text></TouchableOpacity>
    </View>
    {onUseSms ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="使用验证码登录" style={s.button}
      onPress={() => { request.current?.abort(); onUseSms(); }}><Text style={s.hint}>使用验证码登录</Text></TouchableOpacity> : null}
  </Dialog>;
}
const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  hint: { color: colors.text2, fontSize: 13, lineHeight: 21 },
  code: { minHeight: 40, alignItems: 'center' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
