import { useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from './largeStorage';
import * as client from '../api/client';
import { usePlaylists } from './playlists';
import { accountKey } from './accountStorage';
import { createManager } from '../../../renderer/recommendation-profile';
import { backgroundCompute } from '../performance/backgroundCompute';
import { analysis, modelManager } from '../recommendation/localAnalysis';
import { beginRecommendation } from '../updates/networkGate';

export default function useRecommendationProfile(
  account, likes, libraryReady, storageName = 'biu.recommendation-profiles',
) {
  const playlists = usePlaylists();
  const scope = account?.isLogin && account.mid ? String(account.mid) : '';
  const source = useMemo(() => ({ current: likes, playlists }), [scope]);
  source.current = likes;
  source.playlists = playlists;
  const manager = useMemo(() => {
    const key = accountKey(storageName, scope);
    return createManager({
      get: client.get, analysis, getLikes: () => source.current.filter(t=>!t.recommendationScope || t.recommendationScope===(storageName.includes('discovery')?'discovery':'home')),
      getPlaylists: () => source.playlists.map(p=>({...p,tracks:(p.tracks||[]).filter(t=>!t.recommendationScope || t.recommendationScope===(storageName.includes('discovery')?'discovery':'home'))})),
      compute: backgroundCompute,
      beginDaily: beginRecommendation,
      read: async () => { const raw = await AsyncStorage.getItem(key); return raw ? backgroundCompute('parse', raw) : null; },
      write: async (value) => AsyncStorage.setItem(key, await backgroundCompute('stringify', value)),
    });
  }, [scope, source, storageName]);
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  useEffect(() => {
    if (libraryReady) { manager.setActive(true); modelManager.ready().catch(()=>{}); }
    return () => manager.setActive(false);
  }, [manager, libraryReady]);
  return { recommendationManager: manager, recommendationProfile: state };
}
