import AsyncStorage from '@react-native-async-storage/async-storage';
import { interests, selection as interestSelection } from '../../../renderer/profile-interest';
import { rank } from '../../../renderer/recommendation-profile';

export const DISCOVERY_TARGET = 24;
export const DISCOVERY_LOW_WATER = 12;
const MAX_AGE = 600000;
const profileKey = (snapshot) => {
  if (!snapshot || snapshot.ready === false) return '';
  const profile = snapshot.activeId === 'auto' ? snapshot.auto : snapshot.profiles?.find((item) => item.id === snapshot.activeId);
  return snapshot.enabled === false ? 'native' : interests(profile).length
    ? JSON.stringify([snapshot.activeId, profile.tags,interestSelection(profile.interests)]) : '';
};
// Keep the old App feed's pending cards out of the Web recommendation session.
const key = (scope) => `biu.discovery-queue.web@${scope}`;

export async function readDiscoveryQueue(scope, snapshot, mode = 'all') {
  const selection = profileKey(snapshot);
  if (!scope || !selection) return [];
  try {
    const cached = JSON.parse(await AsyncStorage.getItem(key(scope)));
    if (cached?.version !== 1 || (cached.mode || 'all') !== mode || cached.selection !== selection || !Number.isFinite(cached.at)
        || Date.now() - cached.at < 0 || Date.now() - cached.at > MAX_AGE || !Array.isArray(cached.tracks)) return [];
    const seen = new Set();
    const tracks = cached.tracks.slice(0, 32).filter((track) => {
      if (typeof track?.bvid !== 'string' || !track.bvid || seen.has(track.bvid)) return false;
      if (snapshot.enabled !== false && (!Number.isFinite(track.discoveryVerifiedAt)
          || Date.now() - track.discoveryVerifiedAt < 0 || Date.now() - track.discoveryVerifiedAt > MAX_AGE)) return false;
      seen.add(track.bvid); return true;
    });
    const profile = snapshot.activeId === 'auto' ? snapshot.auto : snapshot.profiles?.find((item) => item.id === snapshot.activeId);
    if (snapshot.enabled === false) return tracks;
    const allowed = new Set(rank(tracks, profile, [], tracks.length).map((track) => track.bvid));
    return tracks.filter((track) => allowed.has(track.bvid)); // Preserve explicitly arranged related runs.
  } catch { return []; }
}

// Only the already-filtered, unplayed queue is saved; no media URLs or tokens.
export async function writeDiscoveryQueue(scope, snapshot, tracks, mode = 'all') {
  const selection = profileKey(snapshot);
  if (!scope || !selection) return;
  const pending = tracks.slice(0, 32).map((track) => Object.fromEntries([
    'bvid', 'aid', 'cid', 'title', 'pic', 'up', 'mid', 'duration', 'tid', 'tname', 'tags', 'desc',
    'recommendationReason', 'discoveryOrigin', 'relatedTo', 'relatedFocus', 'discoveryVerifiedAt',
  ].filter((field) => track[field] !== undefined).map((field) => [field, track[field]])));
  await AsyncStorage.setItem(key(scope), JSON.stringify({ version: 1, mode, selection, at: Date.now(), tracks: pending }));
}
