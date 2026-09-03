/* Biu Player RN · 我的：账号（手机号 + 短信验证码登录）+ 本地喜欢歌单
 * 登录流程与桌面端一致（controller.js sendSmsCode/submitSmsLogin）：
 * 极验滑块（GeetestModal）→ sms/send 拿 captcha_key → login/sms 登录。
 * 扫码登录逻辑仍保留在 client.js（qrStart/qrPoll）备用。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import {
  authStatus, imageHeaders, logout, smsCaptcha, smsLogin, smsSend,
} from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import TrackRow from '../components/TrackRow';
import GeetestModal from '../components/GeetestModal';
import { IconHeart, IconUser } from '../components/icons';

export default function MineScreen({ navigation }) {
  const { likes, playQueue, current, history } = usePlayer();
  const [auth, setAuth] = useState(null);
  const [loginVisible, setLoginVisible] = useState(false);
  const [tel, setTel] = useState('');
  const [code, setCode] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', ok: false });
  const [gtParams, setGtParams] = useState(null); // { gt, challenge, token }
  const timerRef = useRef(null);

  const refreshAuth = useCallback(async () => {
    setAuth(await authStatus());
  }, []);

  useEffect(() => { refreshAuth(); }, [refreshAuth]);
  useEffect(() => () => clearInterval(timerRef.current), []);

  const setMsg = (text, ok = false) => setStatus({ text, ok });

  const startCountdown = () => {
    setCountdown(60);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timerRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const validTel = () => /^1\d{10}$/.test(tel.replace(/\D/g, ''));

  // 获取验证码：校验手机号 → 拉极验参数 → 弹滑块
  const onSendCode = async () => {
    if (busy || countdown > 0) return;
    if (!validTel()) { setMsg('请输入正确的 11 位手机号'); return; }
    setBusy(true);
    setMsg('请完成滑块验证…');
    try {
      const cap = await smsCaptcha();
      if (!cap.ok) { setMsg(cap.message || '获取验证参数失败'); return; }
      setGtParams(cap); // 打开 GeetestModal
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 滑块结果：成功 → 发短信；取消/失败 → 提示
  const onGeetestResult = async (validate) => {
    const cap = gtParams;
    setGtParams(null);
    if (!validate) { setMsg('验证未完成，请重试'); return; }
    setBusy(true);
    setMsg('正在发送验证码…');
    try {
      const r = await smsSend({
        tel: tel.replace(/\D/g, ''),
        token: cap.token,
        challenge: validate.geetest_challenge || cap.challenge,
        validate: validate.geetest_validate,
        seccode: validate.geetest_seccode,
      });
      if (!r.ok) { setMsg(r.message || '验证码发送失败'); return; }
      setCaptchaKey(r.captchaKey || '');
      setMsg('验证码已发送，请查收短信', true);
      startCountdown();
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitLogin = async () => {
    if (busy) return;
    const digits = code.replace(/\D/g, '');
    if (!validTel()) { setMsg('请输入正确的 11 位手机号'); return; }
    if (!captchaKey) { setMsg('请先获取验证码'); return; }
    if (!/^\d{6}$/.test(digits)) { setMsg('请输入 6 位数字验证码'); return; }
    setBusy(true);
    setMsg('正在登录…');
    try {
      const r = await smsLogin({ tel: tel.replace(/\D/g, ''), code: digits, captchaKey });
      if (!r.ok) { setMsg(r.message || '登录失败'); return; }
      setMsg('登录成功', true);
      setAuth(r.auth && r.auth.isLogin ? r.auth : await authStatus());
      setTimeout(() => closeLogin(), 700);
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const closeLogin = () => {
    setLoginVisible(false);
    setGtParams(null);
    setStatus({ text: '', ok: false });
    setCode('');
  };

  const doLogout = async () => {
    await logout();
    setAuth({ isLogin: false });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 账号卡 */}
        <View style={styles.accountCard}>
          {auth && auth.isLogin ? (
            <>
              {auth.face ? (
                <Image source={{ uri: auth.face, headers: imageHeaders() }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <IconUser size={22} color={colors.accent} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.uname} numberOfLines={1}>{auth.uname || 'B 站用户'}</Text>
                <Text style={styles.uid}>mid: {auth.mid}</Text>
              </View>
              <TouchableOpacity style={styles.ghostBtn} onPress={doLogout}>
                <Text style={styles.ghostBtnText}>退出登录</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={[styles.avatar, styles.avatarFallback]}>
                <IconUser size={22} color={colors.text3} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uname}>未登录</Text>
                <Text style={styles.uid}>登录后可获取高码率音频与个性化推荐</Text>
              </View>
              <TouchableOpacity style={styles.loginBtn} onPress={() => setLoginVisible(true)}>
                <Text style={styles.loginBtnText}>登录</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* 喜欢 */}
        <View style={styles.sectionHead}>
          <IconHeart size={15} color={colors.accent} filled />
          <Text style={styles.sectionTitle}>我的喜欢（{likes.length}）</Text>
        </View>
        {likes.length ? (
          likes.map((t, i) => (
            <TrackRow
              key={t.bvid || t.aid || i}
              track={t}
              active={!!current && current.bvid === t.bvid}
              onPress={() => playQueue(likes, i)}
              onPressUp={t.mid ? () => navigation.navigate('Up', { mid: t.mid }) : undefined}
            />
          ))
        ) : (
          <Text style={styles.empty}>播放页点小心心，歌就会收进来</Text>
        )}

        {/* 最近播放 */}
        <Text style={[styles.sectionTitle, styles.historyHead]}>最近播放（{history.length}）</Text>
        {history.slice(0, 20).map((t, i) => (
          <TrackRow
            key={`h-${t.bvid || t.aid || i}`}
            track={t}
            active={!!current && current.bvid === t.bvid}
            onPress={() => playQueue(history.slice(0, 20), i)}
            onPressUp={t.mid ? () => navigation.navigate('Up', { mid: t.mid }) : undefined}
          />
        ))}
      </ScrollView>

      {/* 验证码登录弹窗 */}
      <Modal visible={loginVisible} transparent animationType="fade" onRequestClose={closeLogin}>
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>手机号登录</Text>
            <View style={styles.field}>
              <Text style={styles.prefix}>+86</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="手机号"
                placeholderTextColor={colors.text3}
                keyboardType="phone-pad"
                maxLength={11}
                value={tel}
                onChangeText={setTel}
              />
            </View>
            <View style={styles.codeRow}>
              <View style={[styles.field, styles.codeField]}>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="6 位验证码"
                  placeholderTextColor={colors.text3}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={setCode}
                />
              </View>
              <TouchableOpacity
                style={[styles.sendBtn, (countdown > 0 || busy) && styles.sendBtnDisabled]}
                disabled={countdown > 0 || busy}
                onPress={onSendCode}
              >
                <Text style={styles.sendBtnText}>
                  {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                </Text>
              </TouchableOpacity>
            </View>
            {status.text ? (
              <Text style={[styles.status, status.ok && { color: colors.accent }]}>{status.text}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.submitBtn, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={onSubmitLogin}
            >
              <Text style={styles.submitText}>登录 / 注册</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={closeLogin} hitSlop={8}>
              <Text style={styles.closeText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 极验滑块 */}
      {gtParams ? (
        <GeetestModal
          visible
          gt={gtParams.gt}
          challenge={gtParams.challenge}
          onResult={onGeetestResult}
          onCancel={() => { setGtParams(null); setMsg('验证未完成，请重试'); }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 140 },
  accountCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 14, padding: 16,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 20,
  },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: {
    backgroundColor: '#1a1e14', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  uname: { color: colors.text, fontSize: 16, fontWeight: '600' },
  uid: { color: colors.text3, fontSize: 11, marginTop: 3 },
  loginBtn: {
    backgroundColor: colors.accent, borderRadius: 999,
    paddingHorizontal: 18, height: 36, justifyContent: 'center',
  },
  loginBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  ghostBtn: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder,
    paddingHorizontal: 16, height: 34, justifyContent: 'center',
  },
  ghostBtnText: { color: colors.text2, fontSize: 12 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, marginTop: 8, marginBottom: 6,
  },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  historyHead: { paddingHorizontal: 16, marginTop: 20, marginBottom: 6 },
  empty: { color: colors.text3, fontSize: 12, paddingHorizontal: 18, marginTop: 4 },
  modalMask: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCard: {
    alignItems: 'stretch', gap: 12,
    backgroundColor: colors.bgSoft, borderRadius: 24, padding: 22,
    borderWidth: 1, borderColor: colors.cardBorder,
    width: '84%',
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  field: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 14, paddingHorizontal: 14, height: 46,
  },
  prefix: { color: colors.text2, fontSize: 14, marginRight: 8 },
  fieldInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  codeRow: { flexDirection: 'row', gap: 10 },
  codeField: { flex: 1 },
  sendBtn: {
    borderRadius: 14, backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: 'rgba(251,114,153,0.45)',
    paddingHorizontal: 14, justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  status: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  submitBtn: {
    height: 46, borderRadius: 999, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  closeText: { color: colors.text3, fontSize: 12, textAlign: 'center' },
});
