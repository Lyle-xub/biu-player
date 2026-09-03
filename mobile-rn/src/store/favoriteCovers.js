/* 收藏夹封面以账号和收藏夹 ID 固定；null 也会保存，表示首次读取时没有封面。 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultCoverSeed } from '../components/DefaultCover';

const PREFIX = 'biu.favorite-covers.';
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export async function stabilizeFavoriteCovers(mid, folders) {
  const key = PREFIX + String(mid || 'guest');
  let saved = {};
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
  } catch (e) { /* 损坏的旧缓存直接重建 */ }

  let changed = Object.keys(saved).length !== folders.length;
  const nextSaved = {};
  const result = folders.map((folder) => {
    const id = String(folder.id);
    if (!owns(saved, id)) changed = true;
    const pic = owns(saved, id)
      ? (typeof saved[id] === 'string' && saved[id] ? saved[id] : null)
      : (typeof folder.pic === 'string' && folder.pic ? folder.pic : null);
    nextSaved[id] = pic;
    return { ...folder, pic, seed: defaultCoverSeed(folder.id, 44, 48) };
  });

  if (changed) {
    try { await AsyncStorage.setItem(key, JSON.stringify(nextSaved)); } catch (e) { /* 封面缓存失败不阻塞页面 */ }
  }
  return result;
}
