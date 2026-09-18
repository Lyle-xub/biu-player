/* Biu Player RN · 本地歌单数据层（移植自桌面端 renderer/app.js customPlaylists：
 * 桌面存 localStorage「biu-playlists」，RN 用文件存储「biu.playlists」并迁移旧 AsyncStorage）。
 * 结构：[{ id, title, tracks: [track...], createdAt, cover? }]。没有自定义封面时，
 * UI 按歌单 ID 生成稳定的桌面端同款默认封面，不再随第一首歌变化。
 * 内存缓存 + 订阅：usePlaylists() 钩子在任何页面都能拿到实时列表；
 * 每次变更立即持久化并通知所有订阅者。
 */
import { useEffect, useState } from 'react';
import AsyncStorage from './largeStorage';
import { backgroundCompute } from '../performance/backgroundCompute';

const KEY = 'biu.playlists';

let cache = null; // null = 尚未从磁盘加载
let loading = null;
let scope = '';
let generation = 0;
let writes = Promise.resolve();
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
        const parsed = raw ? await backgroundCompute('parse', raw) : [];
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

// Serialize edits and LAN merges; publish only after storage succeeds.
function changePlaylists(update) {
  const requestedGeneration = generation;
  const operation = writes.then(async () => {
    await ensureLoaded();
    if (generation !== requestedGeneration) throw new Error('账号已切换，请重新打开歌单');
    const next = await update(cache);
    if (next === cache) return cache;
    if (generation !== requestedGeneration) throw new Error('账号已切换，请重新打开歌单');
    const key = storageKey();
    const raw = await backgroundCompute('stringify', next);
    if (generation !== requestedGeneration) throw new Error('账号已切换，请重新打开歌单');
    await AsyncStorage.setItem(key, raw);
    if (generation !== requestedGeneration) throw new Error('账号已切换，请重新打开歌单');
    cache = next;
    listeners.forEach((fn) => fn(cache));
    return cache;
  });
  writes = operation.catch(() => {});
  return operation;
}

export function mergeSyncedPlaylists(incoming, base) {
  return changePlaylists(async (list) => (await backgroundCompute('libraryChanges', base ? { version: 1, likes: [], playlists: base } : null,
    { version: 1, likes: [], playlists: incoming }, { version: 1, likes: [], playlists: list })).playlists?.value || list);
}

import { trackKeyOf } from '../player/track';
export { trackKeyOf } from '../player/track';

/** 订阅式钩子：返回本地歌单数组（加载完成前为 []） */
const EMPTY_PLAYLISTS = [];
export function usePlaylists({ withStatus = false } = {}) {
  const [list, setList] = useState(cache);
  useEffect(() => {
    let mounted = true;
    ensureLoaded().then((v) => { if (mounted) setList(v); });
    const onChange = (v) => setList(v);
    listeners.add(onChange);
    return () => { mounted = false; listeners.delete(onChange); };
  }, []);
  return withStatus ? { playlists: list || EMPTY_PLAYLISTS, ready: list !== null } : list || EMPTY_PLAYLISTS;
}

export async function createPlaylist(title, tracks = [], metadata = {}) {
  const name = String(title || '').trim();
  if (!name) return null;
  const pl = { id: Date.now(), title: name, tracks, createdAt: Date.now(),
    ...(metadata.cover ? { cover: metadata.cover } : {}), ...(metadata.desc ? { desc: metadata.desc } : {}) };
  await changePlaylists((list) => {
    while (list.some((p) => p.id === pl.id)) pl.id += 1;
    return [...list, pl];
  });
  return pl;
}

export function deletePlaylist(id) {
  return changePlaylists((list) => list.filter((p) => p.id !== id));
}

/** 把曲目加入歌单（按 bvid/aid 去重；已在歌单里则不动）。返回 'added' | 'dup' | null */
export async function addToPlaylist(id, track) {
  let result = null;
  await changePlaylists((list) => {
    const pl = list.find((p) => p.id === id);
    if (!pl || !track || !trackKeyOf(track)) return list;
    if (pl.tracks.some((t) => trackKeyOf(t) === trackKeyOf(track))) { result = 'dup'; return list; }
    result = 'added';
    return list.map((p) => p.id === id ? { ...p, tracks: [...p.tracks, track] } : p);
  });
  return result;
}

/** 从歌单移除一首（key = bvid/aid） */
export function removeFromPlaylist(id, key) {
  return removePlaylistTracks(id, [key]);
}

export function transferPlaylistTrack(fromId, toId, key) {
  return changePlaylists((list) => {
    const from = list.find((p) => p.id === fromId), to = list.find((p) => p.id === toId);
    if (!from || !to) throw new Error('歌单已被删除，请重新选择');
    const track = from.tracks.find((item) => trackKeyOf(item) === key);
    if (!track) throw new Error('歌曲已从原歌单移除');
    if (fromId === toId) return list;
    // Both lists share one persisted value: a failed write never loses the source.
    return list.map((p) => p.id === fromId ? { ...p, tracks: p.tracks.filter((item) => trackKeyOf(item) !== key) }
      : p.id === toId && !to.tracks.some((item) => trackKeyOf(item) === key) ? { ...p, tracks: [...p.tracks, track] } : p);
  });
}

export function removePlaylistTracks(id, keys) {
  const removed = new Set(keys);
  return changePlaylists((list) => list.map((p) => p.id === id
    ? { ...p, tracks: p.tracks.filter((t) => !removed.has(trackKeyOf(t))) } : p));
}

export function updatePlaylist(id, { title, desc, cover }) {
  const name = String(title || '').trim();
  if (!name) return Promise.reject(new Error('歌单名称不能为空'));
  return changePlaylists((list) => {
    if (!list.some((p) => p.id === id)) throw new Error('歌单已被删除');
    return list.map((p) => p.id === id ? { ...p, title: name, desc: String(desc || '').trim(),
      ...(cover !== undefined ? { cover } : {}) } : p);
  });
}

/** toIndex is the final zero-based position; keys distinguish segments of one video. */
export function movePlaylistTrack(id, key, toIndex) {
  return changePlaylists((list) => {
    const pl = list.find((p) => p.id === id);
    if (!pl) throw new Error('歌单已被删除');
    const from = pl.tracks.findIndex((t) => trackKeyOf(t) === key);
    if (from < 0) throw new Error('歌曲已被移除');
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= pl.tracks.length) throw new Error('目标位置超出歌单范围');
    if (from === toIndex) return list;
    const tracks = [...pl.tracks];
    tracks.splice(toIndex, 0, tracks.splice(from, 1)[0]);
    return list.map((p) => p.id === id ? { ...p, tracks } : p);
  });
}
