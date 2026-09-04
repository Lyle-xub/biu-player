(function (root) {
  root.BiuRecommendationDesktop = function ({ getScope, getLikes, getPlaylists = () => [], getMode = () => 'music', onRefresh, playDaily, saveDaily, navigateDaily, backDaily }) {
    let scope, current, unsubscribe, host, unmount, unmountDaily, listening;
    function manager() {
      const nextScope = getScope();
      if (current && scope === nextScope) return current;
      unsubscribe?.(); unmountDaily?.(); listening?.flush(); current?.dispose(); scope = nextScope;
      const key = scope ? `biu-recommendation-profiles@${scope}` : 'biu-recommendation-profiles';
      const ownScope = scope;
      current = root.BiuRecommendation.createManager({
        get: (url) => { if (!root.bili?.get) throw new Error('请在桌面应用中使用画像推荐'); return root.bili.get(url); },
        getLikes: () => ownScope === getScope() ? getLikes() : [],
        getPlaylists: () => ownScope === getScope() ? getPlaylists() : [],
        read: async () => {
          const disk = await root.bili?.storeGet?.(key);
          if (disk != null) return disk;
          const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null;
        },
        write: async (value) => {
          if (root.bili?.storeSet) await root.bili.storeSet(key, value);
          else localStorage.setItem(key, JSON.stringify(value));
        },
      });
      let revision = 0;
      unsubscribe = current.subscribe(() => {
        const value = current.getSnapshot();
        if (value.revision !== revision && ownScope === getScope()) { revision = value.revision; onRefresh(); }
      });
      if (host) { unmount?.(); unmount = root.BiuRecommendationEditor(host, current); }
      const instance = current;
      listening = root.BiuDaily?.tracker((event) => instance.recordListening(event));
      const dailyHost = root.document?.getElementById('dailyHome');
      if (dailyHost && root.BiuDailyDesktop) unmountDaily = root.BiuDailyDesktop(dailyHost, current, { play: playDaily, save: saveDaily, navigate: navigateDaily, back: backDaily });
      return current;
    }
    root.bili?.onLanSyncLibrary?.(({ scope: incomingScope, library, base }) => {
      if (incomingScope !== getScope() || !library.recommendation) return;
      return manager().applySync(library.recommendation, base?.recommendation)
        .catch(() => console.warn('推荐画像同步保存失败，将自动重试'));
    });
    return {
      manager,
      openDaily() { manager(); unmountDaily?.open(); },
      startListening(track, options) { manager(); listening?.start(track, options); },
      listeningTick(position, playing) { listening?.tick(position, playing); },
      observeFeed(items) { manager().observeFeed(items); },
      async isStrict() {
        const instance = manager();
        await instance.ready();
        return root.BiuRecommendation.isStrict(instance.getSnapshot());
      },
      mount(element) {
        unmount?.(); host = element;
        const instance = manager();
        // manager may have mounted the editor while changing accounts.
        unmount?.(); unmount = root.BiuRecommendationEditor(element, instance);
        instance.refresh().catch(() => {});
        return () => { if (host === element) { unmount?.(); unmount = null; host = null; } };
      },
      async recommend(page, exclude = [], onBatch) {
        const instance = manager();
        try { return await instance.recommend({ page: Math.floor(page / 3), exclude, mode: getMode(), onBatch }); }
        catch (error) {
          if (root.BiuRecommendation.isStrict(instance.getSnapshot())) throw error;
          return [];
        }
      },
    };
  };
})(typeof window === 'object' ? window : this);
