import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { smsLogin, smsSend } from '../api/client';
import { colors } from '../theme';
import { Dialog } from './Dialog';
import GeetestModal from './GeetestModal';
import AppRecommendationAuth from './AppRecommendationAuth';

export default function BiliLogin({ onClose, onAuthorized }) {
  const [mode, setMode] = useState('sms');
  return mode === 'app'
    ? <AppRecommendationAuth login onClose={onClose} onAuthorized={onAuthorized} onUseSms={() => setMode('sms')} />
    : <SmsLogin onClose={onClose} onAuthorized={onAuthorized} onUseApp={() => setMode('app')} />;
}
function SmsLogin({ onClose, onAuthorized, onUseApp }) {
  const [tel, setTel] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState(null);
  const [captcha, setCaptcha] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const controller = useRef(null);
  if (!controller.current) controller.current = new AbortController();
  useEffect(() => () => controller.current.abort(), []);
  useEffect(() => {
    if (!resendAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const run = async (action) => {
    if (busyRef.current || controller.current.signal.aborted) return;
    busyRef.current = true; setBusy(true); setStatus('');
    try { await action(controller.current.signal); }
    catch (error) { if (!controller.current.signal.aborted) setStatus(error.message || '登录失败，请重试'); }
    finally { busyRef.current = false; if (!controller.current.signal.aborted) setBusy(false); }
  };
  const send = (proof) => run(async (signal) => {
    if (Date.now() < resendAt) return;
    if (!/^1\d{10}$/.test(tel)) throw new Error('请输入正确的 11 位手机号');
    const result = await smsSend({ tel, captcha: proof, signal });
    if (signal.aborted) return;
    if (result.captcha) { setCaptcha({ ...result.captcha, tel }); setStatus('请完成安全验证'); return; }
    setTicket({ key: result.captchaKey, tel, expiresAt: Date.now() + 300000 });
    setResendAt(Date.now() + 60000); setStatus('验证码已发送，请查收短信');
  });
  const close = () => { controller.current.abort(); onClose(); };
  return <>
    <Dialog visible onClose={close}>
      <Text style={s.title}>验证码登录</Text>
      <Text style={s.hint}>登录后即可使用 B 站推荐、收藏夹和播放功能。</Text>
      <View style={s.field}><Text style={s.hint}>+86</Text><TextInput style={s.input} accessibilityLabel="手机号"
        placeholder="手机号" placeholderTextColor={colors.text3} keyboardType="phone-pad" maxLength={11}
        editable={!busy && !captcha} value={tel} onChangeText={(value) => { setTel(value.replace(/\D/g, '')); setTicket(null); setCode(''); }} /></View>
      <View style={s.row}>
        <TextInput style={[s.field, s.input]} accessibilityLabel="短信验证码" placeholder="短信验证码"
          placeholderTextColor={colors.text3} keyboardType="number-pad" maxLength={8} editable={!busy}
          value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="获取验证码" disabled={busy || remaining > 0}
          style={s.secondary} onPress={() => send()}><Text style={s.hint}>{remaining ? `${remaining}s 后重发` : '获取验证码'}</Text></TouchableOpacity>
      </View>
      {!!status && <Text accessibilityLiveRegion="polite" style={s.hint}>{status}</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="验证码登录" disabled={busy} style={s.primary}
        onPress={() => run(async (signal) => {
          if (!ticket || ticket.tel !== tel) throw new Error('请先获取当前手机号的验证码');
          if (Date.now() >= ticket.expiresAt) throw new Error('验证码已过期，请重新获取');
          const result = await smsLogin({ tel, code, captchaKey: ticket.key, signal });
          if (!signal.aborted) await onAuthorized(result.auth);
        })}><Text style={s.primaryText}>{busy ? '请稍候…' : '登录 / 注册'}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="使用 B 站 App 登录" style={s.secondary}
        onPress={() => { controller.current.abort(); onUseApp(); }}><Text style={s.hint}>使用 B 站 App 登录</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="取消登录" style={s.secondary} onPress={close}><Text style={s.hint}>取消</Text></TouchableOpacity>
    </Dialog>
    {captcha ? <GeetestModal visible gt={captcha.gt} challenge={captcha.challenge}
      onCancel={() => { setCaptcha(null); setStatus('验证已取消，可重新获取验证码'); }}
      onResult={(proof) => {
        const challenge = captcha; setCaptcha(null);
        if (challenge.tel !== tel) return;
        send({ challenge: proof.geetest_challenge || challenge.challenge,
          validate: proof.geetest_validate, seccode: proof.geetest_seccode, token: challenge.token });
      }} /> : null}
  </>;
}
const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  hint: { color: colors.text2, fontSize: 13, lineHeight: 21 },
  row: { flexDirection: 'row', gap: 10 },
  field: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1,
    borderColor: colors.cardBorder, borderRadius: 14, backgroundColor: colors.card, paddingHorizontal: 14 },
  input: { flex: 1, color: colors.text, fontSize: 15, minHeight: 48 },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondary: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
