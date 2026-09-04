/* Biu Player RN · 我的：资料卡 + 圆形图标菜单 + 最近播放横滑卡 + 歌单/收藏夹卡片网格
 * 布局参考 QQ 音乐我的页（深色主题化）：
 * - 顶部资料卡（头像 + 昵称；登录流程不变：手机号 + 短信验证码 + 极验滑块）
 * - 圆形图标菜单行：我喜欢 / 歌单 / 收藏夹 / 历史 / 设置（图标 + 名称 + 数量，5 项均分）
 * - 最近播放：横向滑动卡片行，首张「已播歌曲」汇总卡 → HistoryScreen，后面是具体曲目卡
 * - 歌单卡片区：「自建歌单 N / 收藏夹 N」双标题分段 + 右侧「+」新建本地歌单（弹输入框），
 *   双列卡片网格：自建歌单 = 本地数据层（src/store/playlists.js，封面按歌单固定），
 *   收藏夹 = B 站 favFolders（需登录，未登录引导登录）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import {
  authStatus, imageHeaders, logout, smsCaptcha, smsLogin, smsSend,
} from '../api/client';
import * as bili from '../api/bili';
import { usePlayer } from '../player/PlayerContext';
import { trackKeyOf } from '../player/track';
import { createPlaylist, deletePlaylist, usePlaylists } from '../store/playlists';
import { stabilizeFavoriteCovers } from '../store/favoriteCovers';
import GeetestModal from '../components/GeetestModal';
import ConfirmDialog, { Dialog } from '../components/Dialog';
import DefaultCover, { defaultCoverSeed } from '../components/DefaultCover';
import RemoteImage from '../components/RemoteImage';
import {
  IconClock, IconHeart, IconNote, IconPlaylist, IconPlus, IconSettings, IconStar, IconUser,
} from '../components/icons';

export default function MineScreen({ navigation }) {
  const { likes, playQueue, history, account: auth, switchAccount } = usePlayer();
  const playlists = usePlaylists();
  const [gridTab, setGridTab] = useState('local'); // local 自建歌单 | fav 收藏夹
  const [confirm, setConfirm] = useState(null);
  const [libraryError, setLibraryError] = useState('');
  const [favs, setFavs] = useState([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favError, setFavError] = useState(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [newPlName, setNewPlName] = useState('');
  const [loginVisible, setLoginVisible] = useState(false);
  const [tel, setTel] = useState('');
  const [code, setCode] = useState('');
  const [captchaKey, setCaptchaKey] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', ok: false });
  const [gtParams, setGtParams] = useState(null); // { gt, challenge, token }
  const timerRef = useRef(null);

  /* ---------- 收藏夹（B 站同步，需登录） ---------- */
  const loadFavs = useCallback(async (a) => {
    if (!a || !a.isLogin) { setFavs([]); return; }
    setFavLoading(true);
    setFavError(null);
    try {
      const folders = await bili.favFolders(a.mid);
      setFavs(await stabilizeFavoriteCovers(a.mid, folders));
    } catch (e) {
      console.warn('[MineScreen] 收藏夹加载失败：', String(e.message || e));
      setFavError(String(e.message || e));
    } finally {
      setFavLoading(false);
    }
  }, []);

  useEffect(() => { if (auth) loadFavs(auth); }, [auth, loadFavs]);
  useEffect(() => navigation.addListener?.('focus', () => loadFavs(auth)), [navigation, auth, loadFavs]);
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
      const a = r.auth && r.auth.isLogin ? r.auth : await authStatus();
      await switchAccount(a);
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
    await switchAccount({ isLogin: false });
    setFavs([]);
  };

  /* ---------- 菜单与卡片行为 ---------- */
  const needLoginAlert = () => {
    setConfirm({ title: '未登录', message: '收藏夹是你的 B 站数据，登录后可查看',
      confirmText: '去登录', onConfirm: () => setLoginVisible(true) });
  };

  const menuItems = [
    {
      key: 'likes', label: '我喜欢', count: likes.length, Icon: IconHeart,
      onPress: () => navigation.navigate('Likes'),
    },
    {
      key: 'local', label: '歌单', count: playlists.length, Icon: IconPlaylist,
      onPress: () => setGridTab('local'),
    },
    {
      key: 'fav', label: '收藏夹', count: favs.length || '', Icon: IconStar,
      onPress: () => (auth && auth.isLogin ? setGridTab('fav') : needLoginAlert()),
    },
    {
      key: 'history', label: '历史', count: history.length, Icon: IconClock,
      onPress: () => navigation.navigate('History'),
    },
    {
      key: 'settings', label: '设置', count: '', Icon: IconSettings,
      onPress: () => navigation.navigate('Settings'),
    },
  ];

  const submitCreate = async () => {
    try {
      const pl = await createPlaylist(newPlName);
      if (!pl) return;
      setNewPlName(''); setCreateVisible(false);
    } catch (e) { setLibraryError(e.message || '新建歌单失败'); }
  };

  const confirmDeletePl = (pl) => {
    setConfirm({ title: '删除歌单', message: `确定删除歌单「${pl.title}」吗？此操作不可恢复。`,
      confirmText: '删除', destructive: true, onConfirm: async () => {
        try { await deletePlaylist(pl.id); }
        catch (e) { setLibraryError(e.message || '删除歌单失败'); }
      } });
  };

  const renderGridCard = ({ key, pic, seed, title, meta, onPress, onLongPress }) => (
    <TouchableOpacity
      key={key}
      style={styles.gridCard}
      activeOpacity={0.8}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={420}
    >
      <RemoteImage uri={pic} width={640} height={640} style={styles.gridCover}
        fallback={<DefaultCover seed={seed} style={StyleSheet.absoluteFill} />} />
      <Text style={styles.gridTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.gridMeta} numberOfLines={1}>{meta}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 资料卡 */}
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
                <Text style={styles.uid}>登录后可获取高码率音频与收藏夹</Text>
              </View>
              <TouchableOpacity style={styles.loginBtn} onPress={() => setLoginVisible(true)}>
                <Text style={styles.loginBtnText}>登录</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* 圆形图标菜单 */}
        <View style={styles.menuRow}>
          {menuItems.map(({ key, label, count, Icon, onPress }) => (
            <TouchableOpacity key={key} style={styles.menuItem} activeOpacity={0.7} onPress={onPress}>
              <View style={styles.menuCircle}>
                <Icon size={20} color={colors.text} />
              </View>
              <Text style={styles.menuLabel}>{label}</Text>
              <Text style={styles.menuCount}>{count === '' ? ' ' : count}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 最近播放：横滑卡片行 */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>最近播放</Text>
          <TouchableOpacity onPress={() => navigation.navigate('History')} hitSlop={8}>
            <Text style={styles.sectionMore}>全部 ›</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hRow}
        >
          <TouchableOpacity
            style={styles.hSummaryCard}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('History')}
          >
            <IconClock size={24} color={colors.accent} />
            <Text style={styles.hSummaryText}>已播歌曲</Text>
            <Text style={styles.hSummaryCount}>{history.length} 首</Text>
          </TouchableOpacity>
          {history.slice(0, 15).map((t, i) => (
            <TouchableOpacity
              key={trackKeyOf(t) || i}
              style={styles.hCard}
              activeOpacity={0.8}
              onPress={() => playQueue(history, i)}
            >
              <RemoteImage uri={t.pic} width={240} height={240} style={styles.hCover}
                fallback={<View style={[StyleSheet.absoluteFill, styles.hCoverFallback]}>
                  <IconNote size={22} color={colors.accent} />
                </View>} />
              <Text style={styles.hTitle} numberOfLines={2}>{t.title}</Text>
              <Text style={styles.hUp} numberOfLines={1}>{t.up}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* 歌单卡片区：分段标题 + 新建 */}
        <View style={[styles.sectionHead, styles.gridHead]}>
          <TouchableOpacity onPress={() => setGridTab('local')} hitSlop={6}
            accessibilityRole="tab" accessibilityLabel="自建歌单" accessibilityState={{ selected: gridTab === 'local' }}>
            <Text style={[styles.segTitle, gridTab === 'local' && styles.segTitleOn]}>
              自建歌单 {playlists.length}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => (auth && auth.isLogin ? setGridTab('fav') : needLoginAlert())}
            hitSlop={6}
            accessibilityRole="tab" accessibilityLabel="收藏夹" accessibilityState={{ selected: gridTab === 'fav' }}
          >
            <Text style={[styles.segTitle, gridTab === 'fav' && styles.segTitleOn]}>
              收藏夹 {auth && auth.isLogin ? favs.length : ''}
            </Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {gridTab === 'local' ? (
            <TouchableOpacity style={styles.plusBtn} onPress={() => setCreateVisible(true)} hitSlop={8}>
              <IconPlus size={16} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
        </View>

        {gridTab === 'local' ? (
          playlists.length ? (
            <View style={styles.grid}>
              {playlists.map((pl) => renderGridCard({
                key: pl.id,
                pic: pl.cover,
                seed: defaultCoverSeed(pl.id),
                title: pl.title,
                meta: `${pl.tracks.length} 首`,
                onPress: () => navigation.navigate('LocalPlaylist', { id: pl.id }),
                onLongPress: () => confirmDeletePl(pl),
              }))}
            </View>
          ) : (
            <Text style={styles.gridHint}>还没有自建歌单，点右上角 + 新建一个</Text>
          )
        ) : favLoading ? (
          <Text style={styles.gridHint}>收藏夹加载中…</Text>
        ) : favError ? (
          <View style={styles.gridMsgBox}>
            <Text style={styles.gridHint}>{favError}</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => loadFavs(auth)}>
              <Text style={styles.actionText}>重试</Text>
            </TouchableOpacity>
          </View>
        ) : favs.length ? (
          <View style={styles.grid}>
            {favs.map((f) => renderGridCard({
              key: f.id,
              pic: f.pic,
              seed: f.seed,
              title: f.title,
              meta: `${f.count} 首`,
              onPress: () => navigation.navigate('PlaylistDetail', { mediaId: f.id, title: f.title, intro: f.intro }),
            }))}
          </View>
        ) : (
          <Text style={styles.gridHint}>还没有收藏夹，去 B 站创建一个吧</Text>
        )}
      </ScrollView>

      {/* 新建歌单弹窗 */}
      <Dialog visible={createVisible} onClose={() => setCreateVisible(false)}>
            <Text style={styles.modalTitle}>新建歌单</Text>
            <View style={styles.field}>
              <TextInput
                style={styles.fieldInput}
                placeholder="歌单名"
                placeholderTextColor={colors.text3}
                maxLength={24}
                value={newPlName}
                onChangeText={setNewPlName}
                autoFocus
              />
            </View>
            <TouchableOpacity style={styles.submitBtn} onPress={submitCreate}>
              <Text style={styles.submitText}>创建</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCreateVisible(false)} hitSlop={8}>
              <Text style={styles.closeText}>取消</Text>
            </TouchableOpacity>
      </Dialog>

      {/* 验证码登录弹窗 */}
      <Dialog visible={loginVisible} onClose={closeLogin}>
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
      </Dialog>
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
      <Dialog visible={!!libraryError} onClose={() => setLibraryError('')}>
        <Text style={styles.modalTitle}>保存失败</Text>
        <Text style={styles.status}>{libraryError}</Text>
        <TouchableOpacity style={styles.submitBtn} onPress={() => setLibraryError('')}>
          <Text style={styles.submitText}>知道了</Text>
        </TouchableOpacity>
      </Dialog>

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
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 140 },
  accountCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 14, marginBottom: 6, padding: 16,
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

  /* 圆形图标菜单 */
  menuRow: {
    flexDirection: 'row', paddingHorizontal: 10, marginTop: 8, marginBottom: 4,
  },
  menuItem: { flex: 1, alignItems: 'center', gap: 5 },
  menuCircle: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { color: colors.text2, fontSize: 11 },
  menuCount: { color: colors.text3, fontSize: 10, marginTop: -3 },

  /* 区块标题 */
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: 16, marginTop: 18, marginBottom: 10,
  },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  gridHead: { minHeight: 28 }, // 与新建按钮等高，切换收藏夹时不收缩。
  sectionMore: { color: colors.text3, fontSize: 12 },
  segTitle: { color: colors.text3, fontSize: 14, fontWeight: '500' },
  segTitleOn: { color: colors.text, fontWeight: '700' },
  plusBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: 'rgba(251,114,153,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },

  /* 最近播放横滑 */
  hRow: { paddingHorizontal: 14, gap: 10 },
  hSummaryCard: {
    width: 104, height: 150, borderRadius: 16, padding: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    justifyContent: 'center', gap: 6,
  },
  hSummaryText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  hSummaryCount: { color: colors.text3, fontSize: 11 },
  hCard: { width: 104 },
  hCover: {
    width: 104, height: 104, borderRadius: 14, backgroundColor: '#1a1e14',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  hCoverFallback: { alignItems: 'center', justifyContent: 'center' },
  hTitle: { color: colors.text, fontSize: 11, lineHeight: 15, marginTop: 6 },
  hUp: { color: colors.text3, fontSize: 10, marginTop: 2 },

  /* 双列卡片网格 */
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 14,
  },
  gridCard: { width: '47.6%' },
  gridCover: {
    width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: '#1a1e14',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  gridCoverFallback: { alignItems: 'center', justifyContent: 'center' },
  gridTitle: { color: colors.text, fontSize: 13, fontWeight: '500', marginTop: 7 },
  gridMeta: { color: colors.text3, fontSize: 11, marginTop: 2 },
  gridHint: { color: colors.text3, fontSize: 12, textAlign: 'center', marginTop: 26 },
  gridMsgBox: { alignItems: 'center', gap: 12 },
  actionBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  actionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  /* 弹窗 */
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
