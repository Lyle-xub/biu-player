// 1 is the existing automatic setting; other values are Bilibili video qn values.
export const PLAYBACK_QUALITIES = [
  { q: 1, label: '自动', desc: '由视频接口选择可用清晰度。听歌与原视频共用视频流。' },
  { q: 16, label: '360P', desc: '优先播放 360P，适合节省流量。' },
  { q: 32, label: '480P', desc: '优先播放 480P，兼顾画面与流量。' },
  { q: 64, label: '720P', desc: '优先播放 720P 高清画面。' },
  { q: 80, label: '1080P', desc: '优先播放 1080P 全高清画面，可能需要登录。' },
];
export function normalizePlaybackQuality(value) {
  if (value == null || value === '') return 1;
  const q = Number(value);
  if (q === 0) return 32; // Migrate the old data-saving option.
  return PLAYBACK_QUALITIES.some((item) => item.q === q) ? q : 1;
}
