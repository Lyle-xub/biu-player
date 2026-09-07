/* 与桌面端一致：游客使用原键，登录账号使用 base@mid。 */
import AsyncStorage from './largeStorage';
import { backgroundCompute } from '../performance/backgroundCompute';

export const ACCOUNT_LIBRARY_KEYS = ['biu.likes', 'biu.history', 'biu.playlists', 'biu.library'];

export const accountKey = (base, scope = '') => (scope ? `${base}@${scope}` : base);

export async function readAccountValue(base, scope, fallback) {
  try {
    const raw = await AsyncStorage.getItem(accountKey(base, scope));
    return raw == null ? fallback : await backgroundCompute('parse', raw);
  } catch (e) {
    return fallback;
  }
}

// 游客首次登录且账号桶为空时复制一份，游客数据仍保留。
export async function adoptGuestLibrary(scope, previousScope = '') {
  if (!scope || previousScope) return;
  await Promise.all(ACCOUNT_LIBRARY_KEYS.map(async (base) => {
    try {
      const target = accountKey(base, scope);
      if (await AsyncStorage.hasItem(target)) return;
      const guest = await AsyncStorage.getItem(base);
      if (guest != null) await AsyncStorage.setItem(target, guest);
    } catch (e) { /* 单个桶迁移失败时仍可加载其他数据 */ }
  }));
}
