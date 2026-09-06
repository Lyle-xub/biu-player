import { rank, tags as normalizeTags } from '../../../renderer/recommendation-profile';
import { videoTags } from '../api/bili';

// Public video metadata only; neither profile decisions nor account data are cached.
const metadata = new Map();

// Direct API neighbours first, then neighbours of matching direct results.
// Bound the expansion instead of filling a short run with unrelated Web cards.
export async function buildRelatedRun(seed, snapshot, relatedFor, excluded, isCurrent) {
  const selected = [], sources = [seed], seen = new Set([seed.bvid]);
  for (let i = 0; i < sources.length && i < 6 && selected.length < 20 && isCurrent(); i++) {
    const source = sources[i];
    const items = await relatedFor(source.bvid);
    if (!isCurrent()) return [];
    const candidates = items.filter((item) => {
      if (!item?.bvid || seen.has(item.bvid) || excluded(item)) return false;
      seen.add(item.bvid); return true;
    }).map((item) => ({ ...item, discoveryOrigin: 'focused', relatedTo: source.bvid, relatedFocus: seed.bvid }));
    await filterDiscoveryCandidates(candidates, snapshot, (matches) => {
      const next = matches.filter((item) => !excluded(item)).slice(0, 20 - selected.length);
      selected.push(...next);
      if (i === 0) sources.push(...next.slice(0, Math.max(0, 6 - sources.length)));
    }, () => isCurrent() && selected.length < 20);
  }
  return selected;
}

export async function filterDiscoveryCandidates(candidates, snapshot, onBatch, isCurrent) {
  const selected = [], seen = new Set();
  const publish = (items) => {
    if (!isCurrent()) return;
    const unique = items.filter((item) => {
      if (!item?.bvid || seen.has(item.bvid)) return false;
      seen.add(item.bvid); return true;
    });
    selected.push(...unique);
    if (unique.length) onBatch(unique);
  };
  // Only an explicit selection of native recommendations disables filtering.
  if (!snapshot || snapshot.ready === false) return selected;
  if (snapshot.enabled === false) { publish(candidates); return selected; }
  const profile = snapshot.activeId === 'auto' ? snapshot.auto
    : snapshot.profiles?.find((item) => item.id === snapshot.activeId);
  const interests = normalizeTags(profile?.tags);
  if (!interests.length) return selected;
  const unique = [...new Map(candidates.filter((item) => item?.bvid).map((item) => [item.bvid, item])).values()];
  for (let offset = 0; offset < unique.length && isCurrent(); offset += 4) {
    const failures = [];
    const batch = await Promise.all(unique.slice(offset, offset + 4).map(async (item) => {
      try {
        let verified = metadata.get(item.bvid);
        if (!verified || Date.now() - verified.at > 600000) {
          verified = { tags: await videoTags(item.bvid), at: Date.now() };
          if (!isCurrent()) return null;
          metadata.set(item.bvid, verified);
          while (metadata.size > 512) metadata.delete(metadata.keys().next().value);
        }
        // Recommendation-card labels are not verified video tags.
        return { ...item, tags: verified.tags, discoveryVerifiedAt: verified.at };
      } catch (error) { failures.push({ item, error }); return null; }
    }));
    publish(rank(batch.filter(Boolean), profile, [...seen], batch.length, { tagsOnly: true }));
    // An unavailable metadata service is not an empty recommendation stream.
    // Keep failed/unprocessed candidates so retry checks the same videos.
    if (failures.length && isCurrent()) {
      const error = new Error(`视频信息核验失败：${failures[0].error.message || '网络请求失败'}，点击重试`);
      error.retryCandidates = [...failures.map(({ item }) => item), ...unique.slice(offset + 4)];
      throw error;
    }
  }
  return selected;
}
