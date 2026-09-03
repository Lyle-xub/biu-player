/* Biu Player RN · 本地歌单数据层（移植自桌面端 renderer/app.js customPlaylists：
 * 桌面存 localStorage「biu-playlists」，RN 存 AsyncStorage「biu.playlists」）。
 * 结构：[{ id, title, tracks: [track...], createdAt, cover? }]。没有自定义封面时，
 * UI 按歌单 ID 生成稳定的桌面端同款默认封面，不再随第一首歌变化。
 * 内存缓存 + 订阅：usePlaylists() 钩子在任何页面都能拿到实时列表；
 * 每次变更立即持久化并通知所有订阅者。
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { merge } from '../../../renderer/library-sync';

const KEY = 'biu.playlists';

let cache = null; // null = 尚未从磁盘加载
let loading = null;
let scope = '';
let generation = 0;
const listeners = new Set();
const storageKey = () => (scope ? `${KEY}@${scope}` : KEY);

async function ensureLoaded() {
  if (cache) return cache;
  if (!loading) {
    const requestedGeneration = generation;
    const requestedKey = storageKey();
    const pending = (async () => {
      let value;
      try {
        const raw = await AsyncStorage.getItem(requestedKey);
        const parsed = raw ? JSON.parse(raw) : [];
        value = Array.isArray(parsed) ? parsed : [];
      } catch (e) { value = []; }
      if (generation === requestedGeneration) cache = value;
      return value;
    })();
    loading = pending;
    try {
      return await pending;
    } finally {
      if (loading === pending) loading = null;
    }
  }
  return loading;
}
export const getPlaylists = ensureLoaded;

export async function setPlaylistScope(nextScope = '') {
  const next = String(nextScope || '');
  if (next === scope && cache) return cache;
  scope = next;
  generation += 1;
  cache = null;
  loading = null;
  const value = await ensureLoaded();
  listeners.forEach((fn) => fn(value));
  return value;
}

export async function mergeSyncedPlaylists(incoming) {
  await ensureLoaded();
  for (;;) {
    const before = cache;
    const next = merge({ version: 1, likes: [], playlists: before }, { version: 1, likes: [], playlists: incoming }).playlists;
    await AsyncStorage.setItem(storageKey(), JSON.stringify(next));
    // Preserve edits made while the native storage write was in flight.
    if (cache !== before) continue;
    cache = next;
    listeners.forEach((fn) => fn(cache));
    return cache;
  }
}

function persist() {
  AsyncStorage.setItem(storageKey(), JSON.stringify(cache || [])).catch(() => {});
  listeners.forEach((fn) => fn(cache));
}

import { trackKeyOf } from '../player/track';
export { trackKeyOf } from '../player/track';

/** 订阅式钩子：返回本地歌单数组（加载完成前为 []） */
export function usePlaylists() {
  const [list, setList] = useState(cache || []);
  useEffect(() => {
    let mounted = true;
    ensureLoaded().then((v) => { if (mounted) setList([...v]); });
    const onChange = (v) => setList([...v]);
    listeners.add(onChange);
    return () => { mounted = false; listeners.delete(onChange); };
  }, []);
  return list;
}

export async function createPlaylist(title, tracks = []) {
  const name = String(title || '').trim();
  if (!name) return null;
  await ensureLoaded();
  const pl = { id: Date.now(), title: name, tracks, createdAt: Date.now() };
  cache = [...cache, pl];
  persist();
  return pl;
}

export async function deletePlaylist(id) {
  await ensureLoaded();
  cache = cache.filter((p) => p.id !== id);
  persist();
}

/** 把曲目加入歌单（按 bvid/aid 去重；已在歌单里则不动）。返回 'added' | 'dup' | null */
export async function addToPlaylist(id, track) {
  await ensureLoaded();
  const pl = cache.find((p) => p.id === id);
  if (!pl || !track || !trackKeyOf(track)) return null;
  if (pl.tracks.some((t) => trackKeyOf(t) === trackKeyOf(track))) return 'dup';
  cache = cache.map((p) => (p.id === id ? { ...p, tracks: [...p.tracks, track] } : p));
  persist();
  return 'added';
}

/** 从歌单移除一首（key = bvid/aid） */
export async function removeFromPlaylist(id, key) {
  await ensureLoaded();
  cache = cache.map((p) => (p.id === id
    ? { ...p, tracks: p.tracks.filter((t) => trackKeyOf(t) !== key) }
    : p));
  persist();
}
