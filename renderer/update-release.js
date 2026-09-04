/* Shared release selection. Mobile versions are independent of desktop release tags. */
(function (root) {
  const REPOSITORY = 'https://github.com/Lyle-xub/biu-player';
  function compareVersions(a, b) {
    const parts = value => /^\d+\.\d+\.\d+$/.test(String(value)) ? String(value).split('.').map(Number) : null;
    const left = parts(a), right = parts(b);
    if (!left || !right) return 0;
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    return 0;
  }
  function androidRelease(releases, currentVersion) {
    const candidates = [];
    for (const release of Array.isArray(releases) ? releases : []) {
      if (release.draft || release.prerelease) continue;
      for (const asset of release.assets || []) {
        const match = /^Biu-Player-(\d+\.\d+\.\d+)-android-arm64\.apk$/.exec(asset.name || '');
        if (!match || compareVersions(match[1], currentVersion) <= 0) continue;
        const expected = `${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/${asset.name}`;
        if (asset.browser_download_url !== expected || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')
          || !(asset.size > 0 && asset.size <= 512 * 1024 * 1024)) continue;
        candidates.push({ version: match[1], url: expected, hash: asset.digest.slice(7), size: asset.size });
      }
    }
    return candidates.sort((a, b) => compareVersions(b.version, a.version))[0] || null;
  }
  const api = { REPOSITORY, compareVersions, androidRelease };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiuUpdateRelease = api;
})(typeof window !== 'undefined' ? window : globalThis);
