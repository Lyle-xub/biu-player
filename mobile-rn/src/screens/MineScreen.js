/* Biu Player RN · 我的：资料卡 + 圆形图标菜单 + 最近播放横滑卡 + 歌单/收藏夹卡片网格
 * 布局参考 QQ 音乐我的页（深色主题化）：
 * - 顶部资料卡（验证码 / B 站 App 登录，同时取得 App 与 Web 凭据）
 * - 圆形图标菜单行：我喜欢 / 音乐库 / 历史 / 设置
 * - 最近播放：横向滑动卡片行，首张「已播歌曲」汇总卡 → HistoryScreen，后面是具体曲目卡
 * - 歌单卡片区：「自建歌单 N / 收藏夹 N」双标题分段 + 右侧「+」新建本地歌单（弹输入框），
 *   双列卡片网格：自建歌单 = 本地数据层（src/store/playlists.js，封面按歌单固定），
 *   收藏夹 = B 站 favFolders（需登录，未登录引导登录）
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { logout } from '../api/client';
import * as bili from '../api/bili';
import { usePlayer } from '../player/PlayerContext';
import { trackKeyOf } from '../player/track';
import { createPlaylist, deletePlaylist, usePlaylists } from '../store/playlists';
import { stabilizeFavoriteCovers } from '../store/favoriteCovers';
import BiliLogin from '../components/BiliLogin';
import ConfirmDialog, { Dialog } from '../components/Dialog';
import DefaultCover, { defaultCoverSeed } from '../components/DefaultCover';
import RemoteImage from '../components/RemoteImage';
import {
  IconClock, IconHeart, IconNote, IconPlaylist, IconPlus, IconSettings, IconUser,
} from '../components/icons';

export default function MineScreen({ navigation }) {
  const { likes, libraryTracks = [], playQueue, history, account: auth, switchAccount } = usePlayer();
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
      key: 'library', label: '音乐库', count: libraryTracks.length, Icon: IconPlaylist,
      onPress: () => navigation.navigate('MusicLibrary'),
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
              <RemoteImage uri={auth.face} width={156} height={156} style={styles.avatar}
                fallback={<View style={[styles.avatar, styles.avatarFallback]}>
                  <IconUser size={22} color={colors.accent} />
                </View>} />
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
                <Text style={styles.uid}>登录后可使用 App 推荐、高码率音频与收藏夹</Text>
              </View>
              <TouchableOpacity style={styles.loginBtn} accessibilityRole="button" accessibilityLabel="登录" onPress={() => setLoginVisible(true)}>
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
            <TouchableOpacity style={styles.plusBtn} onPress={() => setCreateVisible(true)} hitSlop={10}>
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

      {loginVisible ? <BiliLogin onClose={() => setLoginVisible(false)}
        onAuthorized={async (account) => { await switchAccount(account); setLoginVisible(false); }} /> : null}
      <ConfirmDialog config={confirm} onClose={() => setConfirm(null)} />
      <Dialog visible={!!libraryError} onClose={() => setLibraryError('')}>
        <Text style={styles.modalTitle}>保存失败</Text>
        <Text style={styles.status}>{libraryError}</Text>
        <TouchableOpacity style={styles.submitBtn} onPress={() => setLibraryError('')}>
          <Text style={styles.submitText}>知道了</Text>
        </TouchableOpacity>
      </Dialog>

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
    paddingHorizontal: 18, height: 48, justifyContent: 'center',
  },
  loginBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  ghostBtn: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder,
    paddingHorizontal: 16, height: 48, justifyContent: 'center',
  },
  ghostBtnText: { color: colors.text2, fontSize: 12 },

  /* 圆形图标菜单 */
  menuRow: {
    flexDirection: 'row', paddingHorizontal: 10, marginTop: 8, marginBottom: 4,
  },
  menuItem: { flex: 1, alignItems: 'center', gap: 5 },
  menuCircle: {
    width: 48, height: 48, borderRadius: 24,
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
    paddingHorizontal: 22, height: 48, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  actionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  /* 弹窗 */
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  field: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 14, paddingHorizontal: 14, height: 48,
  },
  fieldInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 },
  status: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  submitBtn: {
    height: 48, borderRadius: 999, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  closeText: { color: colors.text3, fontSize: 12, textAlign: 'center' },
});
