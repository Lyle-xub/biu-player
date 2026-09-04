import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import BottomSheet from './BottomSheet';
import { colors } from '../theme';
import * as bili from '../api/bili';
import { get, streamHeaders } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import { segmentRange, segmentTracks } from '../player/track';
import { createPlaylist } from '../store/playlists';
import html from '../split/editor.generated.json';

const PAGE = { html, baseUrl: 'https://biu-player.invalid/' };
const GET_HOSTS = new Set(['api.bilibili.com', 'music.163.com', 'c.y.qq.com', 'u.y.qq.com']);

export default function SplitPanel({ source, onClose }) {
  return <BottomSheet visible={!!source} onClose={onClose} style={styles.sheet}>
    {source ? <Editor key={`${source.bvid}:${source.cid}`} source={source} onClose={onClose} /> : null}
  </BottomSheet>;
}

function Editor({ source, onClose }) {
  const navigation = useNavigation();
  const playback = usePlayer();
  const playerRef = useRef(playback);
  playerRef.current = playback;
  const web = useRef(null);
  const alive = useRef(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(generation);
  generationRef.current = generation;
  const download = useRef(null);
  const downloading = useRef(null);
  const file = useRef(`${FileSystem.cacheDirectory}biu-split-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`);
  const fileSize = useRef(0);
  const controllers = useRef(new Set());
  const saving = useRef(null);
  const account = useRef(playback.account?.mid || '');
  const inject = (fn, data) => { if (alive.current) web.current?.injectJavaScript(`window.${fn}?.(${JSON.stringify(data)});true;`); };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controllers.current.forEach((controller) => controller.abort());
      const task = download.current;
      Promise.resolve(task?.cancelAsync()).catch(() => {}).finally(() => {
        FileSystem.deleteAsync(file.current, { idempotent: true }).catch(() => {});
      });
    };
  }, []);
  useEffect(() => {
    if (ready) return undefined;
    const timer = setTimeout(() => setError('分切编辑器加载超时，请重试'), 15000);
    return () => clearTimeout(timer);
  }, [ready, generation]);
  useEffect(() => {
    if (!ready) return;
    const same = playback.current?.bvid === source.bvid && Number(playback.current?.cid) === Number(source.cid);
    const position = same ? playback.position + (segmentRange(playback.current)?.from || 0) : 0;
    web.current?.injectJavaScript(`window.splitClock?.(${position},${same && playback.playing && !playback.buffering});true;`);
  }, [ready, playback.position, playback.playing, playback.buffering, playback.current, source]);

  const fetchJson = async (url, body, headers) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`识曲服务暂不可用（${response.status}）`);
      return await response.json();
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  };
  const downloadAudio = () => {
    if (fileSize.current) return Promise.resolve({ size: fileSize.current });
    if (downloading.current) return downloading.current;
    downloading.current = (async () => {
      const url = await bili.playUrl(source.bvid, source.cid, 1);
      if (!alive.current) throw new Error('已关闭分切');
      const task = FileSystem.createDownloadResumable(url, file.current, { headers: streamHeaders() }, (progress) => {
        if (progress.totalBytesWritten > 256 * 1024 * 1024) { task.cancelAsync().catch(() => {}); return; }
        inject('splitDownloadProgress', progress.totalBytesExpectedToWrite > 0
          ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite : 0);
      });
      download.current = task;
      try {
        const result = await task.downloadAsync();
        if (!alive.current || !result || result.status !== 200) throw new Error('音频下载未完成，请重试');
        const info = await FileSystem.getInfoAsync(file.current);
        if (!info.size || info.size > 256 * 1024 * 1024) throw new Error('音频文件过大，超过手机分析的 256 MB 缓存限制');
        fileSize.current = info.size;
        return { size: info.size };
      } finally { download.current = null; }
    })().finally(() => { downloading.current = null; });
    return downloading.current;
  };
  const handle = async ({ method, args = {} }) => {
    if (method === 'ready') { setError(''); setReady(true); inject('splitInit', source); return; }
    if (method === 'error') { setError(String(args.message || '分切编辑器出错')); return; }
    if (method === 'close') { onClose(); return; }
    if (method === 'saved') {
      if (!saving.current) return;
      const playlist = await saving.current;
      onClose(); navigation.navigate('LocalPlaylist', { id: playlist.id }); return;
    }
    if (method === 'get') {
      const url = new URL(args.url);
      if (url.protocol !== 'https:' || !GET_HOSTS.has(url.hostname) || url.username || url.password) throw new Error('不支持的请求地址');
      return get(url.toString(), { wbi: !!args.options?.wbi, referer: url.hostname.endsWith('qq.com') ? 'https://y.qq.com/' : undefined });
    }
    if (method === 'detect') return bili.mixSplitDetect(source.bvid, source.cid, source.duration);
    if (method === 'parse') return bili.parseTimestampLines(String(args.text || '').slice(0, 1024 * 1024), source.duration);
    if (method === 'download') return downloadAudio();
    if (method === 'read') {
      if (!Number.isInteger(args.offset) || args.offset < 0 || args.offset >= fileSize.current) throw new Error('无效音频区间');
      return FileSystem.readAsStringAsync(file.current, { encoding: 'base64', position: args.offset,
        length: Math.min(384 * 1024, fileSize.current - args.offset) });
    }
    if (method === 'preview') {
      if (!Number.isFinite(args.position)) throw new Error('无效试听位置');
      const position = Math.max(0, Math.min(source.duration, args.position));
      const player = playerRef.current;
      if (player.current?.bvid === source.bvid && Number(player.current?.cid) === Number(source.cid) && !player.current?.isSegment) {
        player.seekTo(position); player.resume();
      } else await player.playQueue([source], 0, position);
      return;
    }
    if (method === 'save') {
      if ((playerRef.current.account?.mid || '') !== account.current) throw new Error('账号已切换，请重新打开分切面板');
      if (saving.current) { const pl = await saving.current; return { id: pl.id, count: pl.tracks.length }; }
      const segments = Array.isArray(args.segments) ? args.segments.slice(0, 500) : [];
      const tracks = segmentTracks(source, segments.filter((s) => String(s.name || '').trim()
        && s.from >= 0 && s.to <= source.duration && s.to > s.from));
      if (!tracks.length) throw new Error('没有可用的分段，请先填写歌名并检查时间');
      saving.current = createPlaylist(`${(source.title || '长视频').slice(0, 24)} · 分切`, tracks,
        { cover: source.pic, desc: '由 MixSplitR 分切长视频创建，按段时间连播。' });
      try {
        const pl = await saving.current;
        return { id: pl.id, count: tracks.length };
      } catch (failure) { saving.current = null; throw failure; }
    }
    if (method === 'netease') {
      if (typeof args.encoded !== 'string' || args.encoded.length > 128000 || !(args.duration > 0 && args.duration <= 6)) throw new Error('无效指纹');
      const data = await fetchJson('https://interface.music.163.com/api/music/audio/match', new URLSearchParams({
        sessionId: '441df692-afea-4a54-8aff-f5f20fd34f12', algorithmCode: 'shazam_v2', duration: String(args.duration),
        rawdata: args.encoded, times: '2', decrypt: '1',
      }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: 'chrome-extension://pgphbbekcgpfaekhcbjamjjkegcclhhd', 'User-Agent': streamHeaders()['User-Agent'] });
      const entry = data?.data?.result?.[0], song = entry?.song || entry;
      return song?.id && song.name ? { source: 'netease', id: song.id, title: song.name,
        artist: (song.artists || []).map((artist) => artist.name).join('/'), pic: song.album?.picUrl || null } : null;
    }
    if (method === 'shazam') {
      if (typeof args.uri !== 'string' || !args.uri.startsWith('data:audio/vnd.shazam.sig;') || args.uri.length > 128000
        || !(args.samplems > 0 && args.samplems <= 30000)) throw new Error('无效 Shazam 指纹');
      const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const n = Math.floor(Math.random() * 16); return (ch === 'x' ? n : (n & 3) | 8).toString(16);
      }).toUpperCase();
      const data = await fetchJson(`https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/${uuid()}/${uuid()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`,
        JSON.stringify({ timezone: 'Asia/Shanghai', signature: { uri: args.uri, samplems: args.samplems }, timestamp: Date.now(), context: {}, geolocation: {} }),
        { 'Content-Type': 'application/json', 'Accept-Language': 'en-US', 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)' });
      return data?.track?.title ? { source: 'shazam', title: data.track.title, artist: data.track.subtitle || '', pic: data.track.images?.coverart || null } : null;
    }
    throw new Error('未知分切操作');
  };
  return <View style={styles.editor}>
    <View style={styles.header}><Text style={styles.title}>MixSplitR 分切</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭分切面板" onPress={onClose}><Text style={styles.action}>完成</Text></TouchableOpacity>
    </View>
    <WebView ref={web} key={generation} source={PAGE} style={styles.web}
      originWhitelist={['*']} javaScriptEnabled
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false} mixedContentMode="never" textZoom={100}
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url === PAGE.baseUrl}
      onMessage={async (event) => {
        let request;
        const requestGeneration = generation;
        try {
          request = JSON.parse(event.nativeEvent.data);
          const value = await handle(request);
          if (request.id && requestGeneration === generationRef.current) inject('splitReply', { id: request.id, value });
        } catch (failure) {
          if (requestGeneration !== generationRef.current) return;
          if (request?.id) inject('splitReply', { id: request.id, error: String(failure.message || failure) });
          else if (alive.current) setError(String(failure.message || failure));
        }
      }}
      onError={({ nativeEvent }) => setError(nativeEvent.description || '编辑器加载失败')}
      onContentProcessDidTerminate={() => { setReady(false); setError('音频分析进程已退出，请重试'); }}
      onRenderProcessGone={() => { setReady(false); setError('音频分析进程已退出，请重试'); }} />
    {!ready && !error ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
    {error ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <TouchableOpacity onPress={() => { setError(''); setReady(false); setGeneration((n) => n + 1); }}><Text style={styles.action}>重试</Text></TouchableOpacity>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  sheet: { height: '92%', maxHeight: '92%', paddingHorizontal: 14 },
  editor: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  action: { color: colors.accent, fontSize: 14, padding: 6 },
  web: { flex: 1, backgroundColor: colors.bgSoft },
  loading: { position: 'absolute', top: '50%', alignSelf: 'center' },
  error: { color: colors.danger, fontSize: 12, paddingVertical: 6 },
});
