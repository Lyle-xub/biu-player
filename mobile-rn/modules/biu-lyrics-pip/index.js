import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

const native = Platform.OS === 'ios' ? requireNativeModule('BiuLyricsPiP') : null;

export const setLyricsPiPEnabled = (enabled) => native?.setEnabled?.(!!enabled);
export const updateLyricsPiP = (payload) => native?.update?.(JSON.stringify(payload));
export async function extractCoverColor(url) {
  if (!native?.coverColor || !url) return null;
  const values = await native.coverColor(url);
  return Array.isArray(values) && values.length >= 3 ? values.slice(0, 3) : null;
}
