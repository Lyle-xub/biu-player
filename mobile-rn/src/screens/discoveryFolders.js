import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (scope) => `biu.discovery-folders@${scope}`;
const signature = (folder) => JSON.stringify([folder.count, folder.pic || '']);
export const folderCoverEntry = (folder, uris) => ({
  signature: signature(folder), at: Date.now(), uris: [...new Set(uris.filter(Boolean))].slice(0, 4),
});
export const folderCoverFresh = (entry, folder) => entry?.signature === signature(folder)
  && Number.isFinite(entry.at) && Date.now() >= entry.at && Date.now() - entry.at < 86400000;

export async function readDiscoveryFolders(scope) {
  const empty = { scope, folders: [], covers: {} };
  if (!scope) return empty;
  try {
    const data = JSON.parse(await AsyncStorage.getItem(key(scope)));
    if (data?.version !== 1 || !Array.isArray(data.folders)) return empty;
    const folders = data.folders.filter((folder) => folder?.id && typeof folder.title === 'string');
    const covers = {};
    for (const folder of folders) {
      const entry = data.covers?.[folder.id];
      if (entry && Array.isArray(entry.uris)) covers[folder.id] = {
        ...entry, uris: entry.uris.filter((uri) => typeof uri === 'string' && uri).slice(0, 4),
      };
    }
    // Stale covers are still displayed while their replacement loads.
    return { scope, folders, covers };
  } catch { return empty; }
}

export async function writeDiscoveryFolders(cache) {
  if (!cache.scope) return;
  const covers = Object.fromEntries(cache.folders.filter((folder) => cache.covers[folder.id])
    .map((folder) => [folder.id, cache.covers[folder.id]]));
  await AsyncStorage.setItem(key(cache.scope), JSON.stringify({ version: 1, folders: cache.folders, covers }));
}
