import { useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as client from '../api/client';
import { usePlaylists } from './playlists';
import { accountKey, readAccountValue } from './accountStorage';
import { createManager } from '../../../renderer/recommendation-profile';

export default function useRecommendationProfile(account, likes, libraryReady) {
  const playlists = usePlaylists();
  const scope = account?.isLogin && account.mid ? String(account.mid) : '';
  const source = useMemo(() => ({ current: likes }), [scope]);
  source.current = likes;
  const manager = useMemo(() => {
    const key = accountKey('biu.recommendation-profiles', scope);
    return createManager({
      get: client.get, getLikes: () => source.current,
      getPlaylists: () => readAccountValue('biu.playlists', scope, []),
      read: async () => { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : null; },
      write: (value) => AsyncStorage.setItem(key, JSON.stringify(value)),
    });
  }, [scope, source]);
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  useEffect(() => {
    if (libraryReady) manager.setActive(true);
    return () => manager.setActive(false);
  }, [manager, libraryReady, likes, playlists]);
  return { recommendationManager: manager, recommendationProfile: state };
}
