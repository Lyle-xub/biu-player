import { requireNativeViewManager } from 'expo-modules-core';
import { Platform, View } from 'react-native';

export default Platform.OS === 'ios' ? requireNativeViewManager('BiuLyricMonet') : View;
