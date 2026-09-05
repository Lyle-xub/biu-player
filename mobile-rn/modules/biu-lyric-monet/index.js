import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { Platform, View } from 'react-native';

const nativeModule = Platform.OS === 'ios' ? requireNativeModule('BiuLyricMonet') : null;

export function segmentLyricWords(text) {
  const flat = nativeModule?.segmentWords?.(text);
  if (!Array.isArray(flat) || flat.length < 2) return null;
  const segments = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    segments.push({ segment: flat[i], isWordLike: flat[i + 1] === '1' });
  }
  return segments;
}

export default Platform.OS === 'ios' ? requireNativeViewManager('BiuLyricMonet') : View;
