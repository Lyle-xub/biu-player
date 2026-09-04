/* Shared video actions. A keyed child isolates requests, sheets and downloads per track. */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import BottomSheet from './BottomSheet';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { colors, fmtCount, fmtDur } from '../theme';
import * as bili from '../api/bili';
import { authStatus, imageHeaders, streamHeaders } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import { trackKeyOf } from '../player/track';
import SplitPanel from './SplitPanel';
import { IconCoin, IconComment, IconDownload, IconLyric, IconSplit, IconStar, IconThumbUp } from './icons';

function Sheet({ visible, title, onClose, children }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭面板" onPress={onClose} hitSlop={12}>
          <Text style={styles.moreText}>完成</Text>
        </TouchableOpacity>
      </View>
      {children}
    </BottomSheet>
  );
}

export default function VideoActionBar({ track, ...props }) {
  const [splitSource, setSplitSource] = useState(null);
  const focused = useIsFocused();
  useEffect(() => { if (!focused || props.active === false) setSplitSource(null); }, [focused, props.active]);
  if (!track?.bvid || track.isLive) return null;
  return <>
    <TrackActions key={`${trackKeyOf(track)}:${track.cid || 0}`} track={track} {...props} onSplit={setSplitSource} />
    <SplitPanel source={splitSource} onClose={() => setSplitSource(null)} />
  </>;
}

function TrackActions({ track, onShowLyrics, onSplit, active = true }) {
  const { lyricSettings, updateLyricSettings } = usePlayer();
  const focused = useIsFocused();
  const [detail, setDetail] = useState(null);
  const [relation, setRelation] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const [readyError, setReadyError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  const download = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const pending = download.current;
      if (pending) pending.task.cancelAsync().catch(() => {}).finally(() => {
        FileSystem.deleteAsync(pending.temp, { idempotent: true }).catch(() => {});
      });
    };
  }, []);

  useEffect(() => {
    if (!active || !focused) { setSheet(null); return undefined; }
    let cancelled = false;
    setReadyError('');
    (async () => {
      try {
        const [d, auth] = await Promise.all([bili.view(track.bvid), authStatus()]);
        if (cancelled) return;
        setDetail(d);
        setLoggedIn(!!auth?.isLogin);
        const rel = auth?.isLogin ? await bili.arcRelation(track.bvid) : {};
        if (cancelled) return;
        setRelation(rel);
        if (!rel) setReadyError('互动状态加载失败，点此重试');
      } catch (e) {
        if (!cancelled) setReadyError(String(e.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [active, focused, reload, track.bvid]);

  const aid = detail?.aid || track.aid;
  const cid = track.cid || detail?.cid;
  const totalDuration = detail?.pages?.find((p) => Number(p.cid) === Number(cid))?.duration
    || detail?.duration || track.duration || 0;
  const stat = detail?.stat || {};
  const liked = !!relation?.like;
  const favored = !!relation?.favorite;
  const coinCount = Number(relation?.coin) || 0;
  const coinLimit = detail?.copyright === 2 ? 1 : 2;
  const lyric = lyricSettings[trackKeyOf(track)] || {};

  const run = async (name, action) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError('');
    try { await action(); }
    catch (e) { if (alive.current) setError(String(e.message || e)); }
    finally {
      lock.current = false;
      if (alive.current) setBusy('');
    }
  };
  const requireLogin = () => {
    if (loggedIn) return true;
    setError('请先在「我的」页登录 B 站账号');
    return false;
  };
  const open = (name) => { setError(''); setSheet(name); };
  const addStat = (key, amount) => setDetail((d) => d ? {
    ...d, stat: { ...d.stat, [key]: Math.max(0, Number(d.stat?.[key] || 0) + amount) },
  } : d);

  const toggleLike = () => {
    if (!requireLogin()) return;
    run('like', async () => {
      await bili.likeVideo(aid, !liked);
      setRelation((r) => ({ ...r, like: !liked }));
      addStat('like', liked ? -1 : 1);
    });
  };
  const doCoin = (n) => run('coin', async () => {
    if (!requireLogin()) return;
    await bili.coinVideo(aid, n);
    setRelation((r) => ({ ...r, coin: coinCount + n }));
    addStat('coin', n);
    setSheet(null);
  });

  const [folders, setFolders] = useState(null);
  const loadFolders = () => run('folders', async () => {
    const list = await bili.favFoldersWithState(aid);
    if (!list) throw new Error('请先在「我的」页登录 B 站账号');
    setFolders(list);
  });
  const toggleFolder = (folder) => run('favorite', async () => {
    const next = !folder.favored;
    await bili.favDeal(aid, next ? [folder.id] : [], next ? [] : [folder.id]);
    const updated = folders.map((f) => f.id === folder.id ? { ...f, favored: next } : f);
    const was = folders.some((f) => f.favored);
    const now = updated.some((f) => f.favored);
    setFolders(updated);
    setRelation((r) => ({ ...r, favorite: now }));
    if (was !== now) addStat('favorite', now ? 1 : -1);
  });

  const [comments, setComments] = useState(null);
  const [commentPage, setCommentPage] = useState(0);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentMore, setCommentMore] = useState(true);
  const loadComments = (page = 1) => run('comments', async () => {
    const result = await bili.replies(aid, page);
    setComments((list) => {
      const all = page === 1 ? result.list : [...(list || []), ...result.list];
      return [...new Map(all.map((c) => [c.rpid, c])).values()];
    });
    setCommentPage(page);
    setCommentTotal(result.total);
    setCommentMore(result.hasMore && result.list.length > 0);
  });

  const [dlInfo, setDlInfo] = useState(null);
  const [dlProgress, setDlProgress] = useState(null);
  const [savedFile, setSavedFile] = useState(null);
  const loadDownload = () => run('download-info', async () => {
    const dir = FileSystem.documentDirectory + 'downloads/';
    const files = await FileSystem.readDirectoryAsync(dir).catch(() => []);
    const latest = files.filter((name) => name.includes(`_${track.bvid}_${cid}_`) && /\.(mp4|flv)$/.test(name))
      .sort((a, b) => Number(b.match(/_(\d+)\.[^.]+$/)?.[1] || 0) - Number(a.match(/_(\d+)\.[^.]+$/)?.[1] || 0))[0];
    if (latest) setSavedFile({ uri: dir + latest, label: latest });
    setDlInfo(await bili.videoDownloadInfo(track.bvid, cid));
  });
  const startDownload = (quality) => run('download', async () => {
    setSavedFile(null);
    setDlProgress(0);
    let temp;
    try {
      // Fetch a fresh signed CDN URL; don't reuse an expired sheet response.
      const info = await bili.videoDownloadInfo(track.bvid, cid, quality);
      if (!alive.current) return;
      const dir = FileSystem.documentDirectory + 'downloads/';
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const name = String(track.parentTitle || track.title || track.bvid)
        .replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
      const uri = `${dir}${name}_${track.bvid}_${cid}_${info.quality}_${Date.now()}.${info.format}`;
      temp = uri + '.part';
      if (!alive.current) return;
      const task = FileSystem.createDownloadResumable(info.url, temp, { headers: streamHeaders() }, (p) => {
        if (alive.current && p.totalBytesExpectedToWrite > 0) {
          setDlProgress(Math.min(1, p.totalBytesWritten / p.totalBytesExpectedToWrite));
        }
      });
      download.current = { task, temp };
      const result = await task.downloadAsync();
      if (!alive.current) return;
      if (!result || result.status < 200 || result.status >= 300) throw new Error(`下载失败：HTTP ${result?.status || '中断'}`);
      await FileSystem.moveAsync({ from: temp, to: uri });
      setSavedFile({ uri, label: `${name} · ${info.label}` });
      setDlProgress(1);
    } finally {
      download.current = null;
      if (temp) await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
      if (alive.current) setDlProgress(null);
    }
  });
  const exportFile = () => run('export', async () => {
    if (!await Sharing.isAvailableAsync()) throw new Error('当前设备不支持系统文件分享');
    await Sharing.shareAsync(savedFile.uri, { dialogTitle: '保存或分享视频' });
  });

  const [query, setQuery] = useState(track.title || '');
  const [candidates, setCandidates] = useState(null);
  const searchLyrics = () => run('lyric-search', async () => {
    if (!query.trim()) throw new Error('请输入歌曲名或歌手');
    setCandidates(await bili.searchSongCandidates(query.trim()));
  });
  const pickLyric = (match) => run('lyric-match', async () => {
    const lines = await bili.lyricForMatch(match);
    if (!lines?.length) throw new Error('这首歌暂时没有可用歌词，请选择其他候选');
    if (!alive.current) return;
    updateLyricSettings(track, { match, lines });
  });

  const actions = [
    { key: 'like', Icon: IconThumbUp, label: liked ? '已赞' : '点赞', count: stat.like, on: liked, onPress: toggleLike },
    { key: 'coin', Icon: IconCoin, label: coinCount ? '已投币' : '投币', count: stat.coin, on: coinCount > 0,
      onPress: () => { if (requireLogin()) open('coin'); } },
    { key: 'favorite', Icon: IconStar, label: favored ? '已收藏' : '收藏', count: stat.favorite, on: favored,
      onPress: () => { if (requireLogin()) { open('favorite'); loadFolders(); } } },
    { key: 'comments', Icon: IconComment, label: '评论', count: stat.reply,
      onPress: () => { open('comments'); if (!comments) loadComments(); } },
    { key: 'lyrics', Icon: IconLyric, label: '歌词', onPress: () => open('lyrics') },
    { key: 'split', Icon: IconSplit, label: '分切', onPress: () => onSplit({
      bvid: track.bvid, aid, cid, duration: totalDuration,
      title: track.parentTitle || detail?.title || track.title,
      up: detail?.owner?.name || track.up, pic: detail?.pic || track.pic,
    }) },
    { key: 'download', Icon: IconDownload, label: '下载', onPress: () => { open('download'); if (!dlInfo) loadDownload(); } },
  ];
  const retry = { favorite: loadFolders, comments: () => loadComments(commentPage + 1),
    download: loadDownload }[sheet];
  const button = (label, onPress, disabled = !!busy) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={onPress} style={[styles.moreBtn, disabled && { opacity: 0.45 }]}>
      <Text style={styles.moreText}>{label}</Text>
    </TouchableOpacity>
  );

  return <View style={styles.wrap}>
    {[actions.slice(0, 4), actions.slice(4)].map((group, row) => <View key={row} style={styles.row}>
      {group.map(({ key, Icon, label, count, on, onPress }) => (
        <TouchableOpacity key={key} accessibilityRole="button" accessibilityLabel={label}
          accessibilityState={{ selected: !!on }} onPress={onPress}
          disabled={!!busy || (key !== 'lyrics' && (!aid || !cid)) || (['like', 'coin'].includes(key) && relation === null)}
          style={[styles.action, busy && { opacity: 0.5 }]}>
          <Icon size={20} color={on ? colors.accent : colors.text2} filled={!!on} />
          <Text style={[styles.actionText, on && { color: colors.accent }]}>{label}</Text>
          {count != null ? <Text style={styles.actionCount}>{fmtCount(count)}</Text> : null}
        </TouchableOpacity>
      ))}
    </View>)}
    {readyError ? button(readyError + ' · 重试', () => setReload((n) => n + 1)) : null}
    {error && !sheet ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {busy === 'download' && !sheet ? button('正在下载 · 查看进度', () => setSheet('download'), false) : null}
    <Sheet visible={!!sheet} title={{ coin: '投币', favorite: '收藏到', comments: `评论 ${fmtCount(commentTotal)}`,
      lyrics: '歌词', download: '下载原视频' }[sheet]} onClose={() => setSheet(null)}>
      {sheet === 'coin' ? <>
        <Text style={styles.sheetHint}>已投 {coinCount} 枚 · 还可投 {Math.max(0, coinLimit - coinCount)} 枚</Text>
        <View style={styles.coinRow}>
          {Array.from({ length: Math.max(0, coinLimit - coinCount) }, (_, i) => i + 1).map((n) => (
            <TouchableOpacity key={n} disabled={!!busy} onPress={() => doCoin(n)} style={styles.coinBtn} accessibilityLabel={`投 ${n} 枚硬币`}>
              <IconCoin size={24} color={colors.accent} /><Text style={styles.coinBtnText}>{n} 枚硬币</Text>
            </TouchableOpacity>
          ))}
        </View>
      </> : null}
      {sheet === 'favorite' ? <FlatList data={folders || []} keyExtractor={(f) => String(f.id)} style={styles.sheetList}
        renderItem={({ item }) => <TouchableOpacity disabled={!!busy} onPress={() => toggleFolder(item)}
          accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked: item.favored }} style={styles.favRow}>
          <View style={[styles.favCheck, item.favored && styles.favCheckOn]}><Text style={styles.favCheckMark}>{item.favored ? '✓' : ''}</Text></View>
          <Text style={styles.favName}>{item.title}</Text><Text style={styles.favCount}>{item.count} 首</Text>
        </TouchableOpacity>}
        ListEmptyComponent={!busy && !error ? <Text style={styles.sheetHint}>还没有收藏夹，请先在 B 站创建</Text> : null} /> : null}
      {sheet === 'comments' ? <FlatList data={comments || []} keyExtractor={(c) => String(c.rpid)} style={styles.sheetList}
        renderItem={({ item }) => <View style={styles.commentRow}>
          {item.avatar ? <Image source={{ uri: item.avatar, headers: imageHeaders() }} style={styles.commentAvatar} /> : null}
          <View style={styles.commentBody}><Text style={styles.commentName}>{item.name}</Text>
            <Text selectable style={styles.commentText}>{item.message}</Text><Text style={styles.commentLike}>赞 {fmtCount(item.like)}</Text></View>
        </View>}
        ListEmptyComponent={!busy && !error ? <Text style={styles.sheetHint}>暂无评论</Text> : null}
        ListFooterComponent={comments?.length && !error ? button(commentMore ? '加载更多' : '没有更多了', () => loadComments(commentPage + 1), !!busy || !commentMore) : null} /> : null}
      {sheet === 'download' ? <ScrollView style={styles.sheetList}>
        {track.isSegment ? <Text style={styles.sheetHint}>下载包含全部分切的原视频</Text> : null}
        {(dlInfo?.qualities || []).map((q) => <TouchableOpacity key={q.quality} disabled={!!busy} style={styles.dlRow}
          accessibilityLabel={`下载 ${q.label}`} onPress={() => startDownload(q.quality)}>
          <Text style={styles.dlLabel}>{q.label}</Text><IconDownload size={18} color={colors.text2} />
        </TouchableOpacity>)}
        {dlProgress !== null ? <View style={styles.dlProgressBox}>
          <View style={styles.dlProgressTrack}><View style={[styles.dlProgressFill, { width: `${dlProgress * 100}%` }]} /></View>
          <Text style={styles.dlProgressText}>下载中 {Math.round(dlProgress * 100)}% · 退出此页面会取消下载</Text>
        </View> : null}
        {savedFile ? <><Text style={styles.sheetHint}>已下载：{savedFile.label}</Text>{button('保存到文件 / 分享', exportFile)}</> : null}
      </ScrollView> : null}
      {sheet === 'lyrics' ? <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {button('显示动态歌词', () => { setSheet(null); onShowLyrics?.(); })}
        <Text style={styles.sheetHint}>{lyric.match ? `当前匹配：${lyric.match.title} · ${lyric.match.artist}` : '自动匹配歌词，可搜索歌曲手动替换'}</Text>
        <View style={styles.searchRow}><TextInput accessibilityLabel="歌词搜索" style={styles.input} value={query} onChangeText={setQuery}
          placeholder="歌曲名 / 歌手" placeholderTextColor={colors.text3} onSubmitEditing={searchLyrics} returnKeyType="search" />
          {button('搜索', searchLyrics)}</View>
        {(candidates || []).map((c) => <TouchableOpacity key={`${c.source}:${c.id || c.songmid}`} disabled={!!busy}
          onPress={() => pickLyric(c)} accessibilityLabel={`匹配 ${c.title} ${c.artist}`} style={styles.dlRow}>
          <View style={{ flex: 1 }}><Text style={styles.dlLabel}>{c.title}</Text><Text style={styles.commentName}>{c.artist} · {c.source === 'qq' ? 'QQ 音乐' : '网易云'}</Text></View>
          <Text style={styles.segDur}>{fmtDur(c.duration)}</Text>
        </TouchableOpacity>)}
        {candidates?.length === 0 ? <Text style={styles.sheetHint}>没有找到候选，换个关键词试试</Text> : null}
        <View style={styles.searchRow}>
          {button('延后 0.5 秒', () => updateLyricSettings(track, { offset: (lyric.offset || 0) - 0.5 }))}
          <Text style={styles.dlLabel}>{(lyric.offset || 0).toFixed(1)}s</Text>
          {button('提前 0.5 秒', () => updateLyricSettings(track, { offset: (lyric.offset || 0) + 0.5 }))}
        </View>
        {button('恢复自动匹配与时间', () => updateLyricSettings(track, { match: null, lines: null, offset: 0 }))}
      </ScrollView> : null}
      {busy ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 10 }} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {error && retry ? button('重试', retry) : null}
    </Sheet>
  </View>;
}
const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, paddingVertical: 8, textAlign: 'center' },
  actionCount: { color: colors.text3, fontSize: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  input: { flex: 1, color: colors.text, backgroundColor: colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: colors.cardBorder, padding: 12, fontSize: 14 },
  timeline: { minHeight: 88, textAlignVertical: 'top', marginTop: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 3 },
  action: {
    alignItems: 'center', gap: 4, minWidth: 54, flexGrow: 1,
    paddingVertical: 8, paddingHorizontal: 6,
  },
  actionText: { color: colors.text2, fontSize: 11 },
  sheetTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  sheetList: { flexGrow: 0 },
  sheetHint: {
    color: colors.text3, fontSize: 12, textAlign: 'center',
    paddingVertical: 22, lineHeight: 19,
  },
  coinRow: { flexDirection: 'row', gap: 12, justifyContent: 'center', paddingVertical: 10 },
  coinBtn: {
    flex: 1, maxWidth: 150, alignItems: 'center', gap: 8, paddingVertical: 18,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 16,
  },
  coinBtnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  favRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  favCheck: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.text3,
    alignItems: 'center', justifyContent: 'center',
  },
  favCheckOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  favCheckMark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  favName: { color: colors.text, fontSize: 14, flex: 1, minWidth: 0 },
  favCount: { color: colors.text3, fontSize: 11 },
  commentRow: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  commentAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1a1e14' },
  commentAvatarFallback: { borderWidth: 1, borderColor: colors.cardBorder },
  commentBody: { flex: 1, minWidth: 0 },
  commentName: { color: colors.text3, fontSize: 11 },
  commentText: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 3 },
  commentLike: { color: colors.text3, fontSize: 10, marginTop: 4 },
  moreBtn: { alignItems: 'center', paddingVertical: 12 },
  moreText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  dlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 6,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dlLabel: { color: colors.text, fontSize: 14 },
  dlProgressBox: { marginTop: 14, gap: 8 },
  dlProgressTrack: {
    height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden',
  },
  dlProgressFill: { height: 4, backgroundColor: colors.accent },
  dlProgressText: { color: colors.text2, fontSize: 12, textAlign: 'center' },
  segRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  segTime: {
    color: colors.accent, fontSize: 12, fontVariant: ['tabular-nums'], width: 52,
  },
  segName: { color: colors.text, fontSize: 13, flex: 1, minWidth: 0 },
  segDur: { color: colors.text3, fontSize: 11, fontVariant: ['tabular-nums'] },
});
