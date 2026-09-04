/* Biu Player · 渲染逻辑：视图切换 / 数据渲染 / 播放器状态 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 秒 → mm:ss
const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
};
const fmtNum = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n ?? 0));

/* ---------- 本地持久化 ---------- */
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const VIDEO_QUALITY_LABELS = {
  6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60',
  80: '1080P', 100: '智能修复', 112: '1080P+', 116: '1080P60',
  120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K',
};
const savedVideoQuality = Number(store.get('biu-vquality', 80));
const normalizedVideoQuality = [0, 1, 2].includes(savedVideoQuality)
  ? [64, 80, 120][savedVideoQuality] : savedVideoQuality || 80;
const videoQualityLabel = (quality) => VIDEO_QUALITY_LABELS[Number(quality)] || `${quality}P`;

/* ---------- 设置（全部真实生效） ---------- */
const settings = {
  recommendMode: store.get('biu-recommend-mode', 'music') === 'all' ? 'all' : 'music',
  quality: store.get('biu-quality', 1),      // 在线音质：0 标准 / 1 高品 / 2 无损
  vq: normalizedVideoQuality,                // B 站视频清晰度 qn，默认 1080P
  danmaku: store.get('biu-danmaku', 1),      // 视频模式弹幕
  blur: store.get('biu-blur', 0),            // 背景模糊 0-40px
  syncHistory: store.get('biu-sync-history', 0), // 播放时把观看记录上报到 B 站历史
};
let deskLyricOn = !!store.get('biu-desklyric', 0) && (typeof window.bili !== 'undefined');

/* ---------- 启动遮罩：至少停留一段节奏再淡出，避免一闪而过 ---------- */
(() => {
  const mask = $('bootMask');
  if (!mask) return;
  const startedAt = Date.now();
  const MIN_SHOW = 1600; // 最短停留时长，让入场动画完整呈现
  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    mask.classList.add('done');
    mask.addEventListener('transitionend', () => mask.remove(), { once: true });
    setTimeout(() => mask.remove(), 2200); // transitionend 不触发时兜底移除
  };
  const scheduleHide = () => {
    const wait = Math.max(0, MIN_SHOW - (Date.now() - startedAt));
    setTimeout(hide, wait);
  };
  if (document.readyState === 'complete') scheduleHide();
  else window.addEventListener('load', scheduleHide);
  setTimeout(hide, 4200); // load 被异常阻塞时也不挡界面
})();

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- 视图 / 面板控制 ---------- */
const VIEW_ORDER = ['library', 'fav', 'radio', 'daily', 'playlist', 'search', 'up', 'playing'];
// 栈顶是本次导航的目标页；返回只出栈，不把离开的页面重新压回历史。
const viewHistory = [document.body.dataset.view || 'library'];
let libraryScrollTop = 0;
let viewNavigationToken = 0;

function syncBackButtons() {
  const unavailable = viewHistory.length < 2;
  for (const id of ['navBack', 'npDownBtn', 'liveBack']) {
    const button = $(id);
    if (!button) continue;
    button.disabled = unavailable;
    button.setAttribute('aria-disabled', String(unavailable));
  }
}

function goBack() {
  if (viewHistory.length < 2) return;
  viewHistory.pop();
  go(viewHistory[viewHistory.length - 1], { back: true });
}

function resetPlayingViewMode() {
  setVideoTheater(false);
  setLiveTheater(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setVideoMode(false, false, true);
}

function updateView(v, { preservePlayingMode = false } = {}) {
  const curView = document.body.dataset.view;
  const libraryView = document.querySelector('.view-library');
  if (curView === 'library' && libraryView) libraryScrollTop = libraryView.scrollTop;
  document.body.dataset.view = v;
  if (libraryView) libraryView.inert = v !== 'library';
  if (v !== 'playing' && !preservePlayingMode) resetPlayingViewMode();
  // live-on 不随视图丢失：回到首页后播放控件仍按直播形态显示（不显示进度条）
  document.body.classList.toggle('live-on', !!(state.current && state.current.isLive));
  // 控件显隐交给 CSS，与背景和页面一起过渡，不在动画收尾时修改 display。
  document.querySelectorAll('#mainNav button').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === v));
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', v);
    url.searchParams.delete('mode');
    history.replaceState(null, '', url);
  } catch (e) { /* file:// 下某些环境不允许，忽略 */ }
  window.scrollTo(0, 0);
  // display:none 时 scrollTop 不可靠，离开前记录，重新显示后恢复。
  document.querySelectorAll('.view').forEach((s) => {
    if (s !== libraryView) s.scrollTop = 0;
  });
  if (v === 'library' && libraryView) libraryView.scrollTop = libraryScrollTop;
}

function go(v, { back = false } = {}) {
  if (!VIEW_ORDER.includes(v)) return;
  // 快速连续导航先落定上次升降，避免旧回调把用户带回上一页。
  window.BiuPlayerSheetMotion.cancel();

  const from = document.body.dataset.view || 'library';
  const navigationToken = ++viewNavigationToken;

  // 在动画开始前更新逻辑历史，连续点击返回也能逐级出栈，不受延迟换页影响。
  if (!back && viewHistory[viewHistory.length - 1] !== v) viewHistory.push(v);
  syncBackButtons();
  if (from === v) {
    updateView(v);
    return;
  }
  document.body.dataset.navDir = !back && VIEW_ORDER.indexOf(v) >= VIEW_ORDER.indexOf(from) ? 'forward' : 'back';
  closePanel(); // 切换视图时收掉抽屉（队列/设置），避免抽屉悬停在新页面上
  if (from === 'playing' || v === 'playing') {
    window.BiuPlayerSheetMotion.start(from, v,
      () => updateView(v, { preservePlayingMode: from === 'playing' }),
      () => { if (v !== 'playing') resetPlayingViewMode(); });
  } else {
    window.BiuPlayerSheetMotion.enterPage(from, v, () => updateView(v));
  }
  // 进入搜索页：形变过渡落定后把焦点放进大搜索框，可直接输入
  if (v === 'search') {
    setTimeout(() => {
      if (navigationToken !== viewNavigationToken || document.body.dataset.view !== 'search') return;
      const i = $('searchInput');
      if (i) i.focus({ preventScroll: true });
    }, from === 'playing' ? 580 : 240);
  }
}

function setModeSelection(on) {
  $('btnLyric').classList.toggle('on', !on);
  $('btnVideo').classList.toggle('on', on);
  $('btnLyric').setAttribute('aria-pressed', String(!on));
  $('btnVideo').setAttribute('aria-pressed', String(on));
}

function setModeUI(on) {
  document.body.classList.toggle('video-on', on);
  document.body.classList.remove('video-pending');
  setModeSelection(on);
}

let modeMorphAnimation = null;
function transitionMode(on) {
  if (videoModeOn() === on) {
    setModeUI(on);
    return;
  }
  // 宽度与字号直接落到终态，只用合成层属性掩护重排，避免逐帧触发布局。
  setModeUI(on);
  syncPlayingHeaderLayout();
  modeMorphAnimation?.cancel();
  modeMorphAnimation = $('npTitle').animate([
    { opacity: .68, transform: `translate3d(0,${on ? -3 : 3}px,0) scale(.985)` },
    { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
  ], { duration: 430, easing: 'cubic-bezier(.2,.78,.24,1)', fill: 'none' });
  modeMorphAnimation.addEventListener('finish', () => { modeMorphAnimation = null; }, { once: true });
}

function activateShelfCard(card) {
  if (!card) return;
  if (card.id === 'cardLike') openPlaylist(likesPlaylist());
  else if (card.id === 'dailyHome') recommendationProfiles.openDaily();
  else if (card.id === 'cardRank') openPlaylist(rankingPlaylist());
  else if (card.id === 'cardHistory') openPlaylist(historyPlaylist());
}

function initShelfCarousel() {
  const shelf = document.querySelector('.shelf');
  if (!shelf || shelf.dataset.carouselReady === 'true') return;
  const cards = [...shelf.querySelectorAll('.card')];
  if (!cards.length) return;
  shelf.dataset.carouselReady = 'true';
  let active = 0;
  let pointerId = null;
  let startX = 0;
  let startTime = 0;
  let dragX = 0;
  let didDrag = false;
  let suppressClick = false;
  let pressedCard = null;
  let wheelLocked = false;
  const info = [
    ['我喜欢', () => `${likes.length} 首歌曲<i>·</i>本地收藏`],
    ['每日推荐', () => `${window.BiuDaily.current(recommendationProfiles.manager().getSnapshot().daily)?.tracks.length || 0} 首歌曲<i>·</i>为今天挑选`],
    ['音乐区热榜', () => `${state.ranking.length || 20} 首歌曲<i>·</i>B 站音乐区`],
    ['我的历史', () => `${playHistory.length} 首<i>·</i>最近播放`],
  ];
  const step = () => Math.min(450, Math.max(300, shelf.clientWidth * .37));
  const render = (offset = 0, animate = true) => {
    if (!shelf.clientWidth) return;
    const spacing = step();
    // 位移对齐到物理像素，避免半像素抗锯齿导致的整体发虚
    const dpr = window.devicePixelRatio || 1;
    const snap = (v) => Math.round(v * dpr) / dpr;
    shelf.classList.toggle('positioning', !animate);
    cards.forEach((card, index) => {
      const x = snap((index - active) * spacing + offset);
      const distance = Math.min(2, Math.abs(x) / spacing);
      // 居中卡必须锐利：缩放恒为 1、不套 filter（filter 会强制离屏渲染，和 scale 叠加后文字/边框被重采样发虚）
      const isCenter = distance < .02;
      const scale = isCenter ? 1 : Math.max(.68, 1.03 - distance * .19);
      const opacity = Math.max(.18, 1 - distance * .42);
      card.style.transform = `translate3d(calc(-50% + ${x}px), -50%, 0) scale(${scale})`;
      card.style.opacity = opacity.toFixed(3);
      card.style.filter = isCenter ? '' : `saturate(${Math.max(.55, 1 - distance * .2)}) brightness(${Math.max(.58, 1 - distance * .19)}) blur(${Math.max(0, distance - .7) * .8}px)`;
      card.style.zIndex = String(20 - Math.round(distance * 5));
      card.classList.toggle('is-active', index === active && Math.abs(offset) < spacing / 2);
      card.setAttribute('aria-current', index === active ? 'true' : 'false');
    });
  };
  const select = (next, updateMeta = true) => {
    active = Math.max(0, Math.min(cards.length - 1, next));
    dragX = 0;
    render(0, true);
    if (updateMeta && info[active]) {
      $('shelfTitle').textContent = info[active][0];
      $('shelfMeta').innerHTML = info[active][1]();
    }
  };

  shelf.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startTime = performance.now();
    dragX = 0;
    didDrag = false;
    pressedCard = event.target.closest('.card');
    shelf.classList.add('dragging');
    shelf.setPointerCapture(pointerId);
  });
  shelf.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    dragX = Math.max(-step() * 1.05, Math.min(step() * 1.05, event.clientX - startX));
    if (Math.abs(dragX) > 5) didDrag = true;
    render(dragX, false);
  });
  const finishDrag = (event) => {
    if (event.pointerId !== pointerId) return;
    if (shelf.hasPointerCapture(pointerId)) shelf.releasePointerCapture(pointerId);
    pointerId = null;
    shelf.classList.remove('dragging');
    const velocity = dragX / Math.max(80, performance.now() - startTime);
    const threshold = Math.min(84, step() * .22);
    if (didDrag) {
      suppressClick = true;
      if (dragX < -threshold || velocity < -.55) active += 1;
      else if (dragX > threshold || velocity > .55) active -= 1;
      setTimeout(() => { suppressClick = false; }, 90);
    } else if (pressedCard) {
      const tappedIndex = cards.indexOf(pressedCard);
      suppressClick = true;
      if (tappedIndex !== active) select(tappedIndex);
      else activateShelfCard(pressedCard);
      setTimeout(() => { suppressClick = false; }, 90);
    }
    pressedCard = null;
    select(active);
  };
  shelf.addEventListener('pointerup', finishDrag);
  shelf.addEventListener('pointercancel', finishDrag);
  shelf.addEventListener('click', (event) => {
    const card = event.target.closest('.card');
    if (!card) return;
    const index = cards.indexOf(card);
    if (suppressClick || index !== active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!suppressClick) select(index);
    } else {
      event.preventDefault();
      event.stopImmediatePropagation();
      activateShelfCard(card);
    }
  }, true);
  shelf.addEventListener('wheel', (event) => {
    // 触控板纵向手势通常带少量 deltaX，只有横向占主导才接管滚动。
    if (event.ctrlKey) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = horizontal && Math.abs(event.deltaX) > 3
      ? event.deltaX : (event.shiftKey ? event.deltaY : 0);
    if (!delta) return;
    event.preventDefault();
    if (wheelLocked) return;
    wheelLocked = true;
    select(active + (delta > 0 ? 1 : -1));
    setTimeout(() => { wheelLocked = false; }, 360);
  }, { passive: false });
  window.addEventListener('resize', () => render(0, false));
  cards.forEach((card) => {
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const index = cards.indexOf(card);
      if (index !== active) select(index); else activateShelfCard(card);
    });
  });
  // 初始定位不做动画：否则卡片会从「无 transform 的中心堆叠态」带过渡飞出，启动时卡一下
  active = 0;
  render(0, false);
}

// 封面 URL 不变时复用原节点；更换封面先解码，完成前保留旧图与右下角胶囊。
const shelfCoverRequests = new WeakMap();
function setShelfCover(cardId, pic) {
  const cover = $(cardId)?.querySelector('.cover');
  if (!cover || !pic) return;
  const artSelector = ':scope > img, :scope > svg';
  const art = cover.querySelector(artSelector);
  if (art?.getAttribute('src') === pic) {
    shelfCoverRequests.delete(cover);
    return;
  }
  if (shelfCoverRequests.get(cover)?.pic === pic) return;
  const request = { pic };
  shelfCoverRequests.set(cover, request);
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  const fail = () => {
    if (shelfCoverRequests.get(cover) === request) shelfCoverRequests.delete(cover);
  };
  const reveal = () => {
    if (shelfCoverRequests.get(cover) !== request) return;
    const previous = cover.querySelector(artSelector);
    if (previous) previous.replaceWith(img);
    else cover.prepend(img);
    shelfCoverRequests.delete(cover);
  };
  img.onload = () => {
    if (img.decode) img.decode().then(reveal, fail);
    else reveal();
  };
  img.onerror = fail;
  img.src = pic;
}

function openPanel(p) { closePanel(); document.body.classList.add('panel-' + p);
  if (p === 'settings') recommendationProfiles.mount($('recommendationProfiles'));
}
function closePanel() { document.body.classList.remove('panel-queue', 'panel-settings'); }

/* ---------- 全局状态 ---------- */
const audio = $('audio');
const video = $('originalVideo');
const liveVideo = $('liveVideo');
let videoLoadToken = 0;
const videoStreamCache = new Map();
let videoQualityOptions = [];
let videoQualityOptionsKey = '';
let videoPreparePromise = null;
let videoPrepareKey = '';
let modeRequestToken = 0;
let danmakuItems = [];
let danmakuCursor = 0;
const videoModeOn = () => document.body.classList.contains('video-on');
const videoUsesSeparateAudio = () => video.dataset.separateAudio === 'true';
const videoSoundMedia = () => videoUsesSeparateAudio() ? audio : video;
const activeMedia = () => (state.current && state.current.isLive
  ? liveVideo : (videoModeOn() && video.dataset.ready === 'true' ? video : audio));
const state = {
  queue: [],      // 当前播放队列（track 数组）
  qi: -1,         // 当前下标
  current: null,  // 当前曲目
  queueName: '',  // 队列来源名
  playlist: null, // 歌单详情页当前展示的 { title, desc, meta, cover, tracks }
  ranking: [],    // 音乐区排行缓存
  recommendations: [], // B 站个性化推荐流中的音乐视频
  recommendFreshIdx: 0,
};

/* ---------- 重启续播 ---------- */
const PLAYBACK_SESSION_KEY = 'biu-playback-session';
let playbackSessionReady = false;
let playbackClosing = false;
let pendingPlaybackStart = null;
let playbackSavedAt = 0;

function savePlaybackSession(flush = false) {
  if (!playbackSessionReady || playbackClosing) return;
  const media = activeMedia();
  const sound = state.current?.isLive ? liveVideo : videoModeOn() ? videoSoundMedia() : audio;
  const pending = pendingPlaybackStart?.track === state.current ? pendingPlaybackStart : null;
  const snapshot = BiuPlaybackSession.normalize({
    version: 1, queue: state.queue, current: state.current, qi: state.qi, queueName: state.queueName,
    position: pending ? pending.position : media.currentTime,
    playing: pending ? pending.playing : !media.paused && !media.ended,
    volume: audio.volume, muted: sound.muted, playMode,
    videoMode: pending ? pending.videoMode : videoModeOn(), view: document.body.dataset.view,
  });
  store.set(PLAYBACK_SESSION_KEY, snapshot);
  if (api.hasBridge) {
    if (flush && window.bili.playbackSave) window.bili.playbackSave(snapshot);
    else window.bili.storeSet?.(PLAYBACK_SESSION_KEY, snapshot);
  }
  playbackSavedAt = Date.now();
}

function initPlaybackSession() {
  for (const media of [audio, video, liveVideo]) {
    media.addEventListener('timeupdate', () => {
      if (media === activeMedia() && Date.now() - playbackSavedAt >= 5000) savePlaybackSession();
    });
    for (const name of ['play', 'pause', 'seeked', 'volumechange']) {
      media.addEventListener(name, () => savePlaybackSession());
    }
  }
  window.addEventListener('beforeunload', () => {
    savePlaybackSession(true);
    playbackClosing = true;
  });
}

async function restorePlaybackSession(value) {
  const saved = BiuPlaybackSession.normalize(value);
  if (state.current) { playbackSessionReady = true; return; }
  if (!saved) { playbackSessionReady = true; return; }
  state.queue = saved.queue;
  state.qi = saved.qi;
  state.queueName = saved.queueName;
  playMode = saved.playMode;
  renderMode();
  setVolume(saved.volume);
  audio.muted = saved.muted;
  liveVideo.muted = saved.muted;
  playbackSessionReady = true;
  if (saved.current) {
    const track = saved.qi >= 0 ? state.queue[saved.qi] : saved.current;
    // 启动只恢复曲目、队列和时间位置，保持暂停并停在主页；
    // 避免应用打开时跳进播放页或突然出声。
    await playTrack(track, { autoplay: false, startTime: saved.position, videoMode: saved.videoMode, keepView: true });
    if (state.current !== track) return; // 用户已选了另一首，不覆盖新的状态。
  }
  renderQueue();
  syncToggleIcon();
}

function waitForPlaybackMetadata(media) {
  if (media.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      media.removeEventListener('loadedmetadata', loaded);
      media.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('无法载入上次播放的媒体'));
    const timer = setTimeout(() => finish(new Error('恢复播放进度超时，请点击播放重试')), 12000);
    media.addEventListener('loadedmetadata', loaded, { once: true });
    media.addEventListener('error', failed, { once: true });
  });
}

/* ---------- B 站登录：扫码 + 官方验证码页 ---------- */
let authState = { isLogin: false };
let authRequest = null;
let qrKey = '';
let qrPollTimer = null;

/* ---------- 本地数据按账号隔离：喜欢 / 自建歌单 / 历史随登录账号切换 ----------
   游客数据在无后缀键，登录后用 base@mid；首次登录把游客数据拷进空账号桶，老用户不丢数据 */
let dataNs = '';
const dataKey = (base) => (dataNs ? `${base}@${dataNs}` : base);
const recommendationProfiles = window.BiuRecommendationDesktop({
  getMode: () => settings.recommendMode,
  navigateDaily: () => go('daily'),
  backDaily: () => goBack(),
  playDaily: (tracks, index) => setQueue(tracks, '每日推荐', index),
  saveDaily: async (entry) => {
    const id = Math.max(Date.now(), ...customPlaylists.map((p) => Number(p.id) + 1 || 0));
    const title = `每日推荐 · ${entry.date}`;
    const next = [...customPlaylists, { id, title, desc: entry.themes.join(' · '), createdAt: Date.now(), tracks: entry.tracks }];
    if (api.hasBridge) await window.bili.storeSet(dataKey('biu-playlists'), next);
    store.set(dataKey('biu-playlists'), next);
    customPlaylists = next;
    renderMyPlaylists();
  },
  getScope: () => dataNs, getLikes: () => likes, getPlaylists: () => customPlaylists, onRefresh: () => loadLibrary({ force: true }).catch(() => {}),
});
window.biuProfiles = recommendationProfiles;

async function loadBuckets() {
  const adopt = {
    'biu-likes': (v) => { likes = v; },
    'biu-playlists': (v) => { customPlaylists = v; },
    'biu-history': (v) => { playHistory = v; },
  };
  for (const base of Object.keys(adopt)) {
    const k = dataKey(base);
    try {
      let v = api.hasBridge && window.bili.storeGet ? await window.bili.storeGet(k) : null;
      if (v == null) {
        const legacy = localStorage.getItem(k);
        if (legacy != null) {
          v = JSON.parse(legacy);
          if (api.hasBridge && window.bili.storeSet) window.bili.storeSet(k, v);
        }
      }
      adopt[base](Array.isArray(v) ? v : []);
    } catch (e) {}
  }
}

async function switchDataNs(ns) {
  if (ns === dataNs) return;
  await window.bili?.lanSyncStop?.();
  const prev = dataNs;
  dataNs = ns;
  recommendationProfiles.manager();
  if (ns && !prev) {
    // 游客 → 登录：账号桶为空时把游客数据拷过去（不搬动，游客数据保留）
    for (const base of ['biu-likes', 'biu-playlists', 'biu-history']) {
      try {
        const to = `${base}@${ns}`;
        let existing = api.hasBridge && window.bili.storeGet ? await window.bili.storeGet(to) : null;
        if (existing == null) {
          const raw = localStorage.getItem(to);
          existing = raw != null ? JSON.parse(raw) : null;
        }
        if (existing != null) continue;
        let val = api.hasBridge && window.bili.storeGet ? await window.bili.storeGet(base) : null;
        if (val == null) {
          const raw = localStorage.getItem(base);
          val = raw != null ? JSON.parse(raw) : null;
        }
        if (val == null) continue;
        try { localStorage.setItem(to, JSON.stringify(val)); } catch (e) {}
        if (api.hasBridge && window.bili.storeSet) window.bili.storeSet(to, val);
      } catch (e) {}
    }
  }
  await loadBuckets();
  try { await loadLibrary({ force: true }); } catch (e) {}
  renderFavButtons();
  if (dataNs === ns) await window.bili?.lanSyncConfigure?.(ns);
}

function renderAuth(auth = authState) {
  authState = auth || { isLogin: false };
  if (!$('authLoggedOut')) return;
  $('authLoggedOut').hidden = !!authState.isLogin;
  $('authLoggedIn').hidden = !authState.isLogin;
  $('authSubtitle').textContent = authState.isLogin ? `UID ${authState.mid} · 已同步收藏夹` : '扫码或手机验证码安全登录';
  if (authState.isLogin) {
    $('authName').textContent = authState.uname || '已登录';
    $('authFace').src = authState.face || '';
  }
  // 喜欢 / 自建歌单 / 历史随账号切换（游客 ↔ mid 命名空间）
  const ns = authState.isLogin && authState.mid ? String(authState.mid) : '';
  if (ns !== dataNs) switchDataNs(ns).catch(() => {});
}

async function ensureAuth(force = false) {
  if (!api.hasBridge) return authState;
  if (!authRequest || force) {
    authRequest = window.bili.authStatus().then((auth) => {
      renderAuth(auth);
      return authState;
    }).finally(() => { authRequest = null; });
  }
  return authRequest;
}

function hideQrLogin() {
  $('qrLoginMask').classList.remove('show');
  clearTimeout(qrPollTimer);
  qrPollTimer = null;
  qrKey = '';
  resetSmsLogin();
}

// 登录弹窗 Tab：扫码 / 验证码。切到扫码时重新生成二维码，离开时停轮询
function switchLoginTab(tab) {
  $('tabQrLogin').classList.toggle('on', tab === 'qr');
  $('tabSmsLogin').classList.toggle('on', tab === 'sms');
  $('tabQrLogin').setAttribute('aria-selected', String(tab === 'qr'));
  $('tabSmsLogin').setAttribute('aria-selected', String(tab === 'sms'));
  $('paneQr').hidden = tab !== 'qr';
  $('paneSms').hidden = tab !== 'sms';
  if (tab === 'qr') refreshQrLogin();
  else { clearTimeout(qrPollTimer); qrPollTimer = null; qrKey = ''; }
}

async function refreshQrLogin() {
  if (!api.hasBridge) { toast('扫码登录仅在客户端中可用'); return; }
  clearTimeout(qrPollTimer);
  qrKey = '';
  $('qrImage').removeAttribute('src');
  $('qrState').classList.remove('hidden');
  $('qrState').textContent = '正在生成二维码…';
  $('qrStatus').className = 'login-status';
  $('qrStatus').textContent = '请使用哔哩哔哩客户端扫码';
  const result = await window.bili.authQrStart();
  if (!$('qrLoginMask').classList.contains('show')) return;
  if (!result.ok) {
    $('qrState').textContent = result.message || '二维码生成失败';
    return;
  }
  qrKey = result.key;
  $('qrImage').src = result.image;
  $('qrState').classList.add('hidden');
  qrPollTimer = setTimeout(pollQrLogin, 1000);
}

async function pollQrLogin() {
  if (!qrKey || !$('qrLoginMask').classList.contains('show')) return;
  const key = qrKey;
  const result = await window.bili.authQrPoll(key);
  if (key !== qrKey || !$('qrLoginMask').classList.contains('show')) return;
  if (!result.ok) {
    $('qrStatus').textContent = result.message || '登录状态查询失败';
    qrPollTimer = setTimeout(pollQrLogin, 2500);
    return;
  }
  if (result.code === 0) {
    $('qrStatus').className = 'login-status success';
    $('qrStatus').textContent = '登录成功，正在同步账号…';
    renderAuth(result.auth && result.auth.isLogin ? result.auth : await ensureAuth(true));
    setTimeout(() => {
      hideQrLogin();
      toast(`欢迎回来，${authState.uname || 'B 站用户'}`);
      loadFav();
    }, 650);
    return;
  }
  if (result.code === 86038) {
    $('qrStatus').className = 'login-status';
    $('qrStatus').textContent = '二维码已过期，请刷新';
    $('qrState').classList.remove('hidden');
    $('qrState').textContent = '二维码已过期';
    return;
  }
  const confirmed = result.code === 86090;
  $('qrStatus').className = 'login-status' + (confirmed ? ' pending' : '');
  $('qrStatus').textContent = confirmed ? '已扫码，请在手机上确认' : '等待扫码…';
  qrPollTimer = setTimeout(pollQrLogin, 1800);
}

function showLogin(tab = 'qr') {
  closePanel();
  $('qrLoginMask').classList.add('show');
  switchLoginTab(tab);
}

/* ---- 短信验证码登录（参考 wood3n/biu：极验滑块 → 发短信 → 登录） ---- */
let gtScriptLoading = null;
let smsCaptchaKey = '';
let smsCountdown = 0;
let smsCountdownTimer = null;
let smsBusy = false;

function loadGeetest() {
  if (typeof window.initGeetest === 'function') return Promise.resolve();
  if (gtScriptLoading) return gtScriptLoading;
  gtScriptLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://static.geetest.com/static/tools/gt.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('极验组件加载失败，请检查网络'));
    document.body.appendChild(s);
  });
  return gtScriptLoading;
}

// 弹出极验滑块，成功返回 { token, challenge, validate, seccode }，取消/失败返回 null
async function runGeetest() {
  await loadGeetest();
  const cap = await window.bili.authSmsCaptcha();
  if (!cap.ok) throw new Error(cap.message || '获取验证参数失败');
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    window.initGeetest({
      gt: cap.gt, challenge: cap.challenge, offline: false,
      new_captcha: true, product: 'bind', https: true, width: '100%',
    }, (obj) => {
      obj.onReady(() => obj.verify());
      obj.onSuccess(() => {
        const r = obj.getValidate();
        done(r && typeof r !== 'boolean' ? {
          token: cap.token,
          challenge: r.geetest_challenge || cap.challenge,
          validate: r.geetest_validate,
          seccode: r.geetest_seccode,
        } : null);
      });
      obj.onError(() => done(null));
      if (obj.onClose) obj.onClose(() => done(null));
      const slot = $('geetestSlot');
      if (slot) { slot.innerHTML = ''; obj.appendTo(slot); }
    });
  });
}

function setSmsStatus(text, cls = '') {
  const el = $('smsStatus');
  el.className = 'login-status' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

function startSmsCountdown() {
  smsCountdown = 60;
  const btn = $('btnSmsSend');
  btn.disabled = true;
  clearInterval(smsCountdownTimer);
  smsCountdownTimer = setInterval(() => {
    smsCountdown -= 1;
    if (smsCountdown <= 0) {
      clearInterval(smsCountdownTimer);
      btn.disabled = false;
      btn.textContent = '获取验证码';
    } else btn.textContent = `${smsCountdown}s 后重发`;
  }, 1000);
}

function resetSmsLogin() {
  clearInterval(smsCountdownTimer);
  smsCountdown = 0;
  smsCaptchaKey = '';
  smsBusy = false;
  const btn = $('btnSmsSend');
  if (btn) { btn.disabled = false; btn.textContent = '获取验证码'; }
  const slot = $('geetestSlot');
  if (slot) slot.innerHTML = '';
  if ($('smsStatus')) setSmsStatus('');
}

async function sendSmsCode() {
  if (smsBusy) return;
  const tel = $('smsPhone').value.replace(/\D/g, '');
  if (!/^1\d{10}$/.test(tel)) { setSmsStatus('请输入正确的 11 位手机号'); $('smsPhone').focus(); return; }
  smsBusy = true;
  const btn = $('btnSmsSend');
  btn.disabled = true;
  setSmsStatus('请完成滑块验证…');
  try {
    const gt = await runGeetest();
    if (!gt) { setSmsStatus('验证未完成，请重试'); btn.disabled = false; return; }
    setSmsStatus('正在发送验证码…');
    const r = await window.bili.authSmsSend({ tel, ...gt });
    if (!r.ok) { setSmsStatus(r.message || '验证码发送失败'); btn.disabled = false; return; }
    smsCaptchaKey = r.captchaKey || '';
    setSmsStatus('验证码已发送，请查收短信', 'success');
    startSmsCountdown();
    $('smsCode').focus();
  } catch (e) {
    setSmsStatus(e.message || '发送失败，稍后重试');
    btn.disabled = false;
  } finally { smsBusy = false; }
}

async function submitSmsLogin() {
  if (smsBusy) return;
  const tel = $('smsPhone').value.replace(/\D/g, '');
  const code = $('smsCode').value.replace(/\D/g, '');
  if (!/^1\d{10}$/.test(tel)) { setSmsStatus('请输入正确的 11 位手机号'); return; }
  if (!smsCaptchaKey) { setSmsStatus('请先获取验证码'); return; }
  if (!/^\d{6}$/.test(code)) { setSmsStatus('请输入 6 位数字验证码'); $('smsCode').focus(); return; }
  smsBusy = true;
  $('btnSmsLogin').disabled = true;
  setSmsStatus('正在登录…');
  try {
    const r = await window.bili.authSmsLogin({ tel, code, captchaKey: smsCaptchaKey });
    if (!r.ok) { setSmsStatus(r.message || '登录失败'); return; }
    setSmsStatus('登录成功', 'success');
    renderAuth(r.auth && r.auth.isLogin ? r.auth : await ensureAuth(true));
    setTimeout(() => {
      hideQrLogin();
      toast(`欢迎回来，${authState.uname || 'B 站用户'}`);
      loadFav();
    }, 500);
  } catch (e) { setSmsStatus(e.message || '登录失败，稍后重试'); }
  finally { smsBusy = false; $('btnSmsLogin').disabled = false; }
}

function initAuth() {
  $('btnQrLogin').addEventListener('click', () => showLogin('qr'));
  $('btnCodeLogin').addEventListener('click', () => showLogin('sms'));
  $('tabQrLogin').addEventListener('click', () => switchLoginTab('qr'));
  $('tabSmsLogin').addEventListener('click', () => switchLoginTab('sms'));
  $('btnSmsSend').addEventListener('click', sendSmsCode);
  $('btnSmsLogin').addEventListener('click', submitSmsLogin);
  $('smsCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitSmsLogin(); });
  $('btnCloseQr').addEventListener('click', hideQrLogin);
  $('btnRefreshQr').addEventListener('click', refreshQrLogin);
  $('qrLoginMask').addEventListener('click', (e) => { if (e.target === $('qrLoginMask')) hideQrLogin(); });
  $('btnLogout').addEventListener('click', async () => {
    renderAuth(await window.bili.authLogout());
    toast('已退出 B 站账号');
    loadFav();
  });
  if (api.hasBridge) {
    window.bili.onAuthChanged((auth) => {
      renderAuth(auth);
      if (auth.isLogin) toast(`欢迎回来，${auth.uname || 'B 站用户'}`);
      loadFav();
    });
    ensureAuth(true);
  } else renderAuth({ isLogin: false });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function ensureVideoIdentity(t) {
  if (t.cid) return;
  const detail = await api.view(t.bvid);
  if (!detail || !detail.cid) throw new Error('无法获取原视频分 P 信息');
  t.cid = detail.cid;
  t.aid = t.aid || detail.aid;
  if (state.current === t) fillPlayingDetail(detail);
}

// 清晰度标签拆成「分辨率 + 描述」两行，如「1080P 高清」→ 1080P / 高清
function splitQualityLabel(label) {
  const parts = String(label || '').split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { main: parts[0] || '', sub: '' };
  const isRes = (text) => /^\d+P\d*$|^\d+K$/i.test(text);
  if (isRes(parts[0])) return { main: parts[0], sub: parts.slice(1).join(' ') };
  const last = parts[parts.length - 1];
  if (isRes(last)) return { main: last, sub: parts.slice(0, -1).join(' ') };
  return { main: parts[0], sub: parts.slice(1).join(' ') };
}

function syncVideoQualityUI(activeQuality = Number(video.dataset.actualQuality) || settings.vq) {
  const active = videoQualityOptions.find((item) => item.quality === Number(activeQuality));
  const { main, sub } = splitQualityLabel(active ? active.label : videoQualityLabel(activeQuality));
  $('vQuality').innerHTML = `<b>${esc(main)}</b>` + (sub ? `<small>${esc(sub)}</small>` : '');
  $('vQuality').title = videoQualityOptions.length
    ? `可选：${videoQualityOptions.map((item) => item.label).join('、')}` : '正在获取可选清晰度';
  // 设置页是全局默认档位，不随当前视频可用档位禁用
  [...$('segVQuality').children].forEach((button) => {
    button.classList.toggle('on', +button.dataset.vq === Number(settings.vq));
  });
}

async function getVideoQualityOptions(t, force = false) {
  if (!t || !t.bvid || t.isLive || !api.hasBridge) return [];
  await ensureVideoIdentity(t);
  const key = `${t.bvid}:${t.cid}`;
  if (!force && videoQualityOptionsKey === key && videoQualityOptions.length) return videoQualityOptions;
  const options = await api.videoQualities(t.bvid, t.cid, force);
  if (state.current !== t) return [];
  videoQualityOptionsKey = key;
  videoQualityOptions = (options || []).map((item) => ({
    quality: Number(item.quality), label: item.label || videoQualityLabel(item.quality),
  }));
  syncVideoQualityUI();
  return videoQualityOptions;
}

async function getVideoStream(t, quality = settings.vq, force = false) {
  if (!t || !t.bvid || t.isLive || !api.hasBridge) return null;
  const key = `${t.bvid}:${quality}`;
  // force：B 站签名流地址会过期，长播/重试时必须重新拉取，不能复用缓存
  if (force) videoStreamCache.delete(key);
  const cached = videoStreamCache.get(key);
  if (cached && Date.now() - cached.time < 4 * 60 * 1000) return cached.promise;
  const promise = (async () => {
    await ensureVideoIdentity(t);
    return api.videoUrl(t.bvid, t.cid, quality, force);
  })();
  videoStreamCache.set(key, { time: Date.now(), promise });
  promise.catch(() => videoStreamCache.delete(key));
  return promise;
}

function primeVideoStream() {
  const t = state.current;
  if (t && !t.isLive && t.bvid) {
    prepareOriginalVideo(t, videoLoadToken).catch(() => {});
  }
}

async function waitForVideoReady(token, timeout = 3000) {
  if (video.readyState >= 3) return;
  await new Promise((resolve, reject) => {
    let timer;
    const done = () => { clean(); resolve(); };
    const fail = () => { clean(); reject(new Error('原视频加载失败')); };
    const clean = () => {
      clearTimeout(timer);
      video.removeEventListener('canplay', done);
      video.removeEventListener('error', fail);
    };
    video.addEventListener('canplay', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    timer = setTimeout(() => {
      if (token !== videoLoadToken) { clean(); resolve(); return; }
      if (video.readyState < 3) fail(); else done();
    }, timeout);
  });
}

async function attachVideoStream(stream, token, t, deadline = Date.now() + 12000) {
  const rawCandidates = [stream.url, ...(stream.backups || [])].filter(Boolean).slice(0, 2);
  // 先尝试应用代理，再尝试直连；每个源都必须实际解码出首帧才算可用。
  const candidates = rawCandidates.flatMap((url) => [api.media(url), url]).slice(0, 4);
  let lastError = new Error('没有可用的视频地址');
  for (const url of candidates) {
    const remaining = deadline - Date.now();
    if (remaining < 400) break;
    // 过期任务（上一首的预热）不得再写共享的 video 元素
    if (token !== videoLoadToken || state.current !== t) throw new Error('视频加载已取消');
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.src = url;
      video.dataset.separateAudio = String(!!stream.separateAudio);
      video.volume = audio.volume;
      video.muted = true;
      video.load();
      await waitForVideoReady(token, Math.min(3200, remaining));
      if (token !== videoLoadToken || state.current !== t) throw new Error('视频加载已取消');
      await withTimeout(video.play(), Math.min(1800, Math.max(500, deadline - Date.now())), '视频解码启动超时');
      const decoded = await waitForDecodedVideoFrame(Math.min(720, Math.max(240, deadline - Date.now())));
      if (!decoded) throw new Error('视频首帧解码超时');
      video.pause();
      return;
    } catch (error) {
      if (token !== videoLoadToken || state.current !== t) throw error;
      lastError = error;
    }
  }
  video.pause();
  video.removeAttribute('src');
  video.load();
  throw lastError;
}

async function prepareOriginalVideo(t, token, force = false) {
  const key = `${t.bvid}:${settings.vq}`;
  if (!force && video.dataset.bvid === t.bvid && video.dataset.ready === 'true' && video.currentSrc) {
    return Number(video.dataset.actualQuality) || settings.vq;
  }
  if (!force && videoPreparePromise && videoPrepareKey === key) return videoPreparePromise;

  const task = (async () => {
    const deadline = Date.now() + 15000;
    video.dataset.bvid = t.bvid;
    video.dataset.ready = 'false';
    const qualities = await withTimeout(getVideoQualityOptions(t, force), 5000, '获取可选清晰度超时');
    if (token !== videoLoadToken || state.current !== t) throw new Error('视频加载已取消');
    if (!qualities.length) throw new Error('当前视频没有可播放的清晰度');
    const requestedOption = qualities.find((item) => item.quality === settings.vq)
      || qualities.find((item) => item.quality <= settings.vq)
      || qualities[qualities.length - 1];
    // 最多尝试当前档位和两个较低档位，避免所有档位逐个等待造成“无限加载”错觉。
    const attempts = qualities.filter((item) => item.quality <= requestedOption.quality).slice(0, 3);
    let loadedQuality = requestedOption.quality;
    let lastError = null;
    for (const option of attempts) {
      const remaining = deadline - Date.now();
      if (remaining < 500) {
        lastError = new Error('原视频准备超时，请重试');
        break;
      }
      try {
        const stream = await withTimeout(getVideoStream(t, option.quality, force), Math.min(5000, remaining), '获取原视频超时');
        if (token !== videoLoadToken || state.current !== t) throw new Error('视频加载已取消');
        await attachVideoStream(stream, token, t, deadline);
        loadedQuality = stream.quality;
        lastError = null;
        break;
      } catch (error) {
        if (token !== videoLoadToken || state.current !== t) throw error;
        lastError = error;
        videoStreamCache.delete(`${t.bvid}:${option.quality}`);
      }
    }
    if (lastError) throw lastError;
    video.dataset.actualQuality = String(loadedQuality);
    video.dataset.ready = 'true';
    syncVideoQualityUI(loadedQuality);
    // 预热场景顺手把画面预定位到音频当前进度（分切段起点很深时尤其重要），
    // 避免点开原视频瞬间做远距离 seek，卡在缓冲上被判超时。
    if (token === videoLoadToken && state.current === t
        && isFinite(audio.currentTime) && audio.currentTime > 2) {
      positionPreparedVideo(audio.currentTime, token, 1200).catch(() => {});
    }
    loadDanmaku(t, token);
    return loadedQuality;
  })();

  videoPrepareKey = key;
  videoPreparePromise = task;
  try {
    return await task;
  } finally {
    if (videoPreparePromise === task) videoPreparePromise = null;
  }
}

function scheduleVideoWarmup(t) {
  const token = videoLoadToken;
  const warm = () => {
    if (token !== videoLoadToken || state.current !== t || videoModeOn() || t.isLive) return;
    prepareOriginalVideo(t, token).catch(() => {});
  };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 1200 });
  else setTimeout(warm, 480);
}

async function positionPreparedVideo(time, token, timeout = 800) {
  if (!isFinite(time) || !isFinite(video.duration)) return;
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - .04)));
  if (Math.abs(video.currentTime - target) < .12) return;
  await new Promise((resolve) => {
    let timer;
    const done = () => { clean(); resolve(); };
    const clean = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', done);
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', done, { once: true });
    video.currentTime = target;
    timer = setTimeout(done, timeout);
  });
  if (token !== videoLoadToken) throw new Error('视频加载已取消');
}

// 切回歌词页前等音频在目标位置缓冲出可播数据（MP4 合体流接管用），避免断音
function waitForAudioHandoff(timeout = 900) {
  if (audio.readyState >= 3) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => { clean(); resolve(); };
    const clean = () => {
      clearTimeout(timer);
      audio.removeEventListener('canplay', done);
      audio.removeEventListener('error', done);
    };
    audio.addEventListener('canplay', done, { once: true });
    audio.addEventListener('error', done, { once: true });
    timer = setTimeout(done, timeout);
  });
}

async function waitForDecodedVideoFrame(timeout = 420) {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return video.readyState >= 2;
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (decoded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(decoded);
    };
    const timer = setTimeout(() => done(false), timeout);
    video.requestVideoFrameCallback(() => done(true));
  });
}

function resetDanmaku(time = 0) {
  $('danmakuLayer').innerHTML = '';
  danmakuCursor = danmakuItems.findIndex((item) => item.time >= time - .08);
  if (danmakuCursor < 0) danmakuCursor = danmakuItems.length;
}

async function loadDanmaku(t, token) {
  danmakuItems = settings.danmaku ? await api.danmaku(t.cid).catch(() => []) : [];
  if (token !== videoLoadToken || state.current !== t) return;
  resetDanmaku(video.currentTime || 0);
}

function syncDanmaku() {
  if (!settings.danmaku || !videoModeOn() || video.paused || !danmakuItems.length) return;
  const now = video.currentTime;
  while (danmakuCursor < danmakuItems.length && danmakuItems[danmakuCursor].time <= now + .08) {
    const item = danmakuItems[danmakuCursor++];
    if (item.time < now - .35) continue;
    const el = document.createElement('span');
    el.textContent = item.text;
    el.style.setProperty('--lane', String(danmakuCursor % 9));
    el.style.setProperty('--dm-size', item.size + 'px');
    el.style.setProperty('--dm-color', item.color);
    el.style.setProperty('--dm-duration', (7 + (danmakuCursor % 5) * .65) + 's');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    $('danmakuLayer').appendChild(el);
  }
}

/* 原视频与音频共用同一条时间轴，切换时无缝接续。 */
async function setVideoMode(on, force = false, immediate = false) {
  const t = state.current;
  if (on && (!t || !t.bvid || t.isLive || !api.hasBridge)) {
    toast(t && t.isLive ? '直播电台没有原视频模式' : '当前曲目暂无原视频');
    return;
  }
  if (on && videoModeOn() && !force && video.dataset.bvid === t.bvid && video.dataset.ready === 'true') return;
  if (on && document.body.classList.contains('video-pending') && !force) return;
  const requestToken = ++modeRequestToken;
  if (!on) {
    document.body.classList.remove('video-pending');
    $('btnVideo').classList.remove('loading');
    setModeSelection(false);
    setVideoTheater(false);
    const wasVideoMode = videoModeOn();
    const videoWasActive = wasVideoMode && video.dataset.ready === 'true' && !video.paused;
    const wasPlaying = videoWasActive || !audio.paused;
    if (videoUsesSeparateAudio()) {
      // DASH 双轨：音频元素本来就是出声且在播的主时间轴（画面轨追随它），
      // 切回歌词页完全不动音频，只停掉静音的画面轨——
      // 旧逻辑用滞后最多 0.28s 的视频进度回设音频，每次切换都造成回跳卡顿。
      video.muted = true;
      video.pause();
    } else if (audio.src && state.current && videoWasActive) {
      // MP4 合体流且视频正在出声：切回时需要音频接管。
      // 先静音定位并等目标位置缓冲就绪，再停视频、立即放音，把断点压到最小。
      const pos = isFinite(video.currentTime) ? video.currentTime : audio.currentTime;
      const muted = video.muted;
      if (isFinite(pos)) {
        audio.muted = true; // 定位期间不出声，避免与视频双重发声
        try { audio.currentTime = Math.min(pos, audio.duration || pos); } catch (e) {}
        if (wasPlaying) await waitForAudioHandoff(900);
      }
      video.muted = true;
      video.pause();
      audio.muted = muted;
      if (wasPlaying && audio.paused) audio.play().catch(() => {});
    } else {
      // 视频没在出声（含未进入视频模式的路过调用）：音频本就是声音来源，完全不动
      video.muted = true;
      video.pause();
    }
    // 先让音频轨接管声音，再停掉视频并开始视觉转场，避免返回歌词时出现音频断点。
    if (immediate) setModeUI(false); else transitionMode(false);
    syncToggleIcon();
    return;
  }
  const token = force ? ++videoLoadToken : videoLoadToken;
  const source = activeMedia();
  // 段尾连播时 handleSegmentEnd 刚把旧流停掉（boundaryAdvanceAt），视为正在播放
  const wasPlaying = !source.paused || Date.now() - boundaryAdvanceAt < 2000;
  // 进入视频前声音由 audio 承担；不要读取预热阶段被强制静音的 video。
  const desiredMuted = !!audio.muted;
  document.body.classList.add('video-pending');
  setModeSelection(true);
  $('btnVideo').classList.add('loading');
  $('videoStatus').className = 'video-status';
  $('videoStatus').querySelector('b').textContent = '正在准备原视频…';
  try {
    const loadedQuality = await prepareOriginalVideo(t, token, force);
    if (requestToken !== modeRequestToken || token !== videoLoadToken || state.current !== t) return;
    if (!document.body.classList.contains('video-pending') && !videoModeOn()) return;
    if (loadedQuality !== settings.vq) {
      toast(`${videoQualityLabel(settings.vq)} 当前不可用，已切换至 ${videoQualityLabel(loadedQuality)}`);
    }
    // 在歌词仍可见时完成定位和首帧解码，随后才启动视觉转场。
    const handoffSource = activeMedia();
    const handoffTime = isFinite(handoffSource.currentTime) ? handoffSource.currentTime : 0;
    await positionPreparedVideo(handoffTime, token);
    if (requestToken !== modeRequestToken) return;
    if (wasPlaying) {
      video.muted = true;
      await withTimeout(video.play(), 5000, '视频播放启动超时');
      const latestTime = isFinite(activeMedia().currentTime) ? activeMedia().currentTime : handoffTime;
      if (Math.abs(video.currentTime - latestTime) > .12) {
        await positionPreparedVideo(latestTime, token, 560);
      }
      if (!await waitForDecodedVideoFrame(1500)) throw new Error('视频首帧解码超时');
    }
    if (requestToken !== modeRequestToken || token !== videoLoadToken || state.current !== t) return;
    if (!document.body.classList.contains('video-pending') && !videoModeOn()) {
      video.pause();
      return;
    }
    $('videoStatus').classList.add('ready');
    if (immediate) setModeUI(true); else transitionMode(true);
    if (videoUsesSeparateAudio()) {
      audio.muted = desiredMuted;
      video.muted = true;
      if (wasPlaying && audio.paused) audio.play().catch(() => {});
    } else {
      if (wasPlaying) audio.pause();
      video.muted = desiredMuted;
    }
    syncVideoOptionButtons();
  } catch (e) {
    if (requestToken !== modeRequestToken || token !== videoLoadToken) return;
    if (!force) { // 预热/缓存的签名流地址可能已过期：强制刷新后重试一次（force 分支不再重试，防死循环）
      console.warn('原视频加载失败，强制刷新重试:', e.message || e);
      setVideoMode(true, true, immediate);
      return;
    }
    console.error(e);
    video.dataset.ready = 'false';
    video.muted = desiredMuted;
    syncVideoOptionButtons();
    $('videoStatus').className = 'video-status error';
    $('videoStatus').querySelector('b').textContent = e.message || '原视频加载失败';
    document.body.classList.remove('video-pending');
    if (videoModeOn()) transitionMode(false); else setModeSelection(false);
    if (audio.src && wasPlaying && audio.paused) audio.play().catch(() => {});
    toast(`原视频播放失败：${e.message || '请稍后重试'}`);
  } finally {
    if (requestToken === modeRequestToken && token === videoLoadToken) $('btnVideo').classList.remove('loading');
  }
  syncToggleIcon();
}

/* ---------- 播放模式：列表循环 / 单曲循环 / 随机 ---------- */
const MODES = { loop: '列表循环', one: '单曲循环', shuffle: '随机播放' };
/* 循环箭头拆成箭头/横线独立 path，描边接头干净；单曲循环的 "1" 带底横、居中于箭头空档 */
const MODE_ICON_LOOP = '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>';
const MODE_ICONS = {
  loop: MODE_ICON_LOOP,
  one: MODE_ICON_LOOP + '<path d="M10.9 10.1 12.7 8.9v6.3M10.5 15.2h4.4"/>',
  shuffle: '<path d="m18 4 3 3-3 3M3 7h3c5 0 5 10 10 10h5M18 14l3 3-3 3M3 17h3c1.7 0 2.9-1.2 4-3"/>',
};
let playMode = store.get('biu-playmode', 'loop');
if (!MODES[playMode]) playMode = 'loop';
const renderMode = () => {
  $('qMode').textContent = MODES[playMode];
  const button = $('ppMode');
  if (button) {
    button.dataset.mode = playMode;
    button.title = MODES[playMode];
    button.setAttribute('aria-label', `播放模式：${MODES[playMode]}`);
    button.setAttribute('aria-pressed', String(playMode === 'one'));
    const icon = $('ppModeIcon');
    if (icon) icon.innerHTML = MODE_ICONS[playMode];
  }
};
function cyclePlayMode() {
  const order = ['loop', 'one', 'shuffle'];
  playMode = order[(order.indexOf(playMode) + 1) % order.length];
  store.set('biu-playmode', playMode);
  savePlaybackSession();
  renderMode();
  toast(MODES[playMode]);
}

/* ---------- 收藏：我喜欢（复用本地 biu-likes）/ B 站收藏夹弹层 ---------- */
let favFoldersCache = null;  // [{ id, title, count, favored }]，null = 未加载
let favBusy = false;
let favPopOpen = false;

function favEligibleTrack() {
  const t = state.current;
  return !!(t && !t.isLive && t.bvid && t.aid && api.hasBridge);
}

function renderFavButtons() {
  const like = $('btnLike');
  const fav = $('btnFav');
  if (!like || !fav) return;
  const liked = isLiked(state.current); // 本地「我喜欢」，与列表页心形同源
  const favored = !!(favFoldersCache && favFoldersCache.some((f) => f.favored));
  like.classList.toggle('on', liked);
  like.setAttribute('aria-pressed', String(liked));
  fav.classList.toggle('on', favored);
  fav.setAttribute('aria-pressed', String(favored));
  // 原视频页统计行的收藏状态同步
  const vsFav = $('vsFavBtn');
  if (vsFav) vsFav.classList.toggle('on', favored);
  // 移动端迷你播放条的喜欢钮同步
  const ppLike = $('ppLike');
  if (ppLike) ppLike.classList.toggle('on', liked);
}

function closeFavPop() {
  favPopOpen = false;
  const pop = $('favPop');
  if (pop) pop.hidden = true;
  const fav = $('btnFav');
  if (fav) fav.setAttribute('aria-expanded', 'false');
}

function resetFavState() {
  favFoldersCache = null;
  favBusy = false;
  closeFavPop();
  closePlPop();
  renderFavButtons();
}

async function syncFavState(t) {
  if (!favEligibleTrack() || !authState.isLogin) return;
  try {
    const folders = await api.favFoldersWithState(t.aid);
    if (state.current !== t) return; // 已切歌，丢弃过期结果
    favFoldersCache = folders;
    renderFavButtons();
    if (favPopOpen) renderFavPopList();
  } catch (e) { /* 状态加载失败保持默认样式 */ }
}

function renderFavPopList() {
  const list = $('favPopList');
  if (!list) return;
  // 异步加载完成后会重绘列表，保留滚动位置避免跳回顶部
  const keepScroll = list.scrollTop;
  if (!authState.isLogin) {
    list.innerHTML = '<div class="fav-pop-hint">登录 B 站后可收藏</div>';
    positionFavPop();
    return;
  }
  if (!favFoldersCache) {
    list.innerHTML = '<div class="fav-pop-hint">加载中…</div>';
    positionFavPop();
    return;
  }
  if (!favFoldersCache.length) {
    list.innerHTML = '<div class="fav-pop-hint">暂无收藏夹，请先在 B 站创建</div>';
    positionFavPop();
    return;
  }
  list.innerHTML = favFoldersCache.map((f, i) => `
    <button type="button" class="fav-pop-item${f.favored ? ' on' : ''}" data-fi="${i}">
      <span class="box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#141610" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></span>
      <span class="name">${esc(f.title)}</span>
      <span class="count">${f.count}</span>
    </button>`).join('');
  list.scrollTop = keepScroll;
  list.querySelectorAll('.fav-pop-item').forEach((el) =>
    el.addEventListener('click', () => toggleFavFolder(+el.dataset.fi)));
  positionFavPop(); // 列表高度变化后重新判断上/下展开
}

let favPopAnchor = null; // 弹层锚点按钮（btnFav / vsFavBtn），重绘后需要重新定位

// fixed 定位：默认在按钮下方；下方空间不足时翻到上方展开，避免被窗口底边截断
function positionFavPop() {
  const pop = $('favPop');
  const btn = favPopAnchor;
  if (!pop || pop.hidden || !btn) return;
  const rect = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 268))}px`;
  const h = pop.offsetHeight;
  const up = rect.bottom + 10 + h > window.innerHeight - 12 && rect.top - h - 10 >= 8;
  pop.classList.toggle('up', up);
  pop.style.top = up ? `${rect.top - h - 10}px` : `${rect.bottom + 10}px`;
}

async function openFavPop(anchor) {
  const pop = $('favPop');
  if (!pop) return;
  const btn = anchor || $('btnFav');
  closePlPop();
  favPopOpen = true;
  favPopAnchor = btn;
  pop.hidden = false; // 先显示再量高度，定位才准
  positionFavPop();
  if (btn === $('btnFav')) btn.setAttribute('aria-expanded', 'true');
  renderFavPopList();
  const t = state.current;
  if (authState.isLogin && !favFoldersCache && t) {
    if (!t.aid && t.bvid && api.hasBridge) {
      try {
        const d = await api.view(t.bvid);
        if (state.current === t) t.aid = d.aid;
      } catch (e) { /* 忽略，syncFavState 会失败并保持提示 */ }
    }
    if (state.current === t) await syncFavState(t);
    if (favPopOpen) renderFavPopList();
  }
}

async function toggleFavFolder(index) {
  const t = state.current;
  const folder = favFoldersCache && favFoldersCache[index];
  if (!folder || favBusy || !t || !t.aid) return;
  favBusy = true;
  try {
    await api.favDeal(t.aid, folder.favored ? [] : [folder.id], folder.favored ? [folder.id] : []);
    folder.favored = !folder.favored;
    folder.count = Math.max(0, folder.count + (folder.favored ? 1 : -1));
    renderFavButtons();
    renderFavPopList();
    toast(folder.favored ? `已收藏到「${folder.title}」` : `已从「${folder.title}」移除`);
  } catch (e) {
    toast('收藏失败：' + (e.message || e));
  }
  favBusy = false;
}

/* ---------- 加入本地歌单弹层（复用收藏弹层样式） ---------- */
// 曲目身份键：分切段按 bvid + 区间独立成对象（同视频各段互不冲突），整曲/直播不变
const trackKey = (t) => {
  if (!t) return '';
  if (t.isSegment && t.bvid) return `${t.bvid}#${Math.round((t.from || 0) * 10)}-${Math.round((t.to || 0) * 10)}`;
  return t.bvid || (t.roomid ? 'live:' + t.roomid : '');
};
// 拷贝曲目进本地集合：分切段必须带上区间与歌词引用，否则退化成整曲甚至撞 bvid 被覆盖
const trackCopy = (t) => ({
  bvid: t.bvid, aid: t.aid, cid: t.cid, title: t.title,
  up: t.up, duration: t.duration, pic: t.pic,
  ...(t.isSegment ? { isSegment: true, from: t.from, to: t.to, lyricRef: t.lyricRef } : {}),
});

/* ---------- 歌词偏移：按曲目持久化，同步时钟 = 播放时间 + 偏移 ---------- */
let lyricOffsets = store.get('biu-lyric-offsets', {});
if (!lyricOffsets || typeof lyricOffsets !== 'object' || Array.isArray(lyricOffsets)) lyricOffsets = {};
const lyricOffsetOf = (t) => {
  const k = trackKey(t);
  return k && Number.isFinite(lyricOffsets[k]) ? lyricOffsets[k] : 0;
};
const fmtLyricOffset = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + 's';
function setLyricOffset(t, v) {
  const k = trackKey(t);
  if (!k) return;
  v = Math.round(v * 10) / 10;
  if (Math.abs(v) < 0.05) delete lyricOffsets[k];
  else lyricOffsets[k] = v;
  store.set('biu-lyric-offsets', lyricOffsets);
  if (api.hasBridge && window.bili.storeSet) window.bili.storeSet('biu-lyric-offsets', lyricOffsets);
  const el = $('lyricOffVal');
  if (el) el.textContent = fmtLyricOffset(lyricOffsetOf(t));
  syncLyric(true);
}
let plPopOpen = false;

function closePlPop() {
  plPopOpen = false;
  const pop = $('plPop');
  if (pop) pop.hidden = true;
  const btn = $('btnAddPl');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function renderPlPopList() {
  const list = $('plPopList');
  if (!list) return;
  const t = state.current;
  if (!t || t.isLive || !t.bvid) {
    list.innerHTML = '<div class="fav-pop-hint">当前曲目不支持加入歌单</div>';
    return;
  }
  if (!customPlaylists.length) {
    list.innerHTML = '<div class="fav-pop-hint">还没有本地歌单，去「歌单」页新建一个吧</div>';
    return;
  }
  list.innerHTML = customPlaylists.map((p, i) => {
    const has = p.tracks.some((x) => trackKey(x) === trackKey(t));
    return `<button type="button" class="fav-pop-item${has ? ' on' : ''}" data-pi="${i}">
      <span class="box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#141610" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></span>
      <span class="name">${esc(p.title)}</span>
      <span class="count">${p.tracks.length}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.fav-pop-item').forEach((el) =>
    el.addEventListener('click', () => toggleTrackInPlaylist(+el.dataset.pi)));
}

function toggleTrackInPlaylist(index) {
  const t = state.current;
  const pl = customPlaylists[index];
  if (!pl || !t || !t.bvid) return;
  const at = pl.tracks.findIndex((x) => trackKey(x) === trackKey(t));
  if (at >= 0) {
    pl.tracks.splice(at, 1);
    toast(`已从「${pl.title}」移除`);
  } else {
    pl.tracks.unshift(trackCopy(t));
    toast(`已加入「${pl.title}」`);
  }
  saveCustomPlaylists();
  renderPlPopList();
  renderMyPlaylists();
  // 正在看这张歌单的详情页时同步刷新（不在详情页绝不能把页面拉回 playlist）
  if (state.playlist && state.playlist.customId === pl.id
      && document.body.dataset.view === 'playlist') openPlaylist(customPlaylistDetail(pl));
}

function openPlPop() {
  const pop = $('plPop');
  if (!pop) return;
  closeFavPop();
  plPopOpen = true;
  const rect = $('btnAddPl').getBoundingClientRect();
  pop.style.left = `${Math.max(8, rect.left)}px`;
  pop.style.top = `${rect.bottom + 10}px`;
  pop.hidden = false;
  $('btnAddPl').setAttribute('aria-expanded', 'true');
  renderPlPopList();
}

/* ---------- MixSplitR 长视频分切面板 ---------- */
let splitSource = null;   // 来源视频 track
let splitSegments = [];   // [{ from, to, name, match, matching }]
let splitAnalyzing = false; // 本地智能分析进行中
let splitWave = null;       // { pcm, rate, peaks, duration, srcPcm, srcRate } 波形剪辑轨道数据
let splitWaveRaf = 0;       // 波形播放游标 rAF
let splitIdentifying = false; // 识曲（网易云 → Shazam）进行中
const splitMatchTimers = {};

// 分切面板日志：时间戳 + 消息追加到面板内日志区，自动滚到底
function splitLog(msg) {
  const box = $('splitLog');
  if (!box) return;
  box.hidden = false;
  const now = new Date();
  const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((v) => String(v).padStart(2, '0')).join(':');
  const line = document.createElement('div');
  line.textContent = `[${ts}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

// 秒 → mm:ss / h:mm:ss（波形轨道 tooltip 用）
const fmtWave = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 3600) return fmt(sec);
  return Math.floor(sec / 3600) + ':'
    + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ':'
    + String(sec % 60).padStart(2, '0');
};

// "分:秒" / "时:分:秒" / 纯秒 → 秒；非法返回 null
function parseTimeInput(str) {
  const parts = String(str || '').trim().split(/[:：]/).map((x) => parseInt(x, 10));
  if (!parts.length || parts.length > 3 || parts.some((x) => !isFinite(x) || x < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function splitMatchCellHTML(s) {
  // 有歌名就提供「换匹配」下拉（多候选选择 + 搜索）
  const pickBtn = s.name && s.name.trim()
    ? '<b class="split-pick" title="选择其他匹配结果 / 搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></b>'
    : '';
  if (s.matching) return (s.identifying ? '<i>识别中…</i>' : '<i>匹配中…</i>') + pickBtn;
  if (s.match) {
    const srcName = { netease: '网易云', qq: 'QQ音乐', shazam: 'Shazam' }[s.match.source];
    return (s.match.pic ? `<img src="${esc(s.match.pic)}" alt="">` : '')
      + `<em>${esc(s.match.artist || s.match.title || '已匹配')}</em>`
      + (srcName ? `<i>${srcName}</i>` : '') + pickBtn;
  }
  return '<i>未匹配</i>' + pickBtn;
}

/* ---------- 分切面板 · 匹配候选下拉（多结果选择 + 搜索） ---------- */
let splitPopFor = -1; // 当前打开下拉的分段下标
const splitPopTimers = {};

// 候选挑歌：QQ 源优先，源内按时长就近（容差 12s），无时长取第一个
function pickSongCandidate(candidates, durationSec) {
  const pickFrom = (list) => {
    if (!list.length) return null;
    if (!(durationSec > 0)) return list[0];
    const near = list
      .filter((c) => c.duration > 0 && Math.abs(c.duration - durationSec) <= 12)
      .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec));
    return near[0] || list[0];
  };
  return pickFrom((candidates || []).filter((c) => c.source === 'qq'))
    || pickFrom((candidates || []).filter((c) => c.source === 'netease'));
}

function closeSplitPop() {
  splitPopFor = -1;
  const pop = document.querySelector('.split-pop');
  if (pop) pop.remove();
}

// 下拉列表行 HTML：封面 / 标题 / 歌手 / 时长 / 来源
function splitPopRowHTML(cand, ci) {
  const srcName = { qq: 'QQ音乐', netease: '网易云' }[cand.source] || '';
  return `<div class="split-pop-row" data-ci="${ci}">
    ${cand.pic ? `<img src="${esc(cand.pic)}" alt="">` : '<span class="split-pop-nopic"></span>'}
    <div class="split-pop-meta"><b>${esc(cand.title)}</b><i>${esc(cand.artist || '未知歌手')}</i></div>
    <span class="split-pop-dur num">${cand.duration > 0 ? fmt(Math.round(cand.duration)) : ''}</span>
    <em>${srcName}</em>
  </div>`;
}

function renderSplitPopList(pop, candidates) {
  const list = pop.querySelector('.split-pop-list');
  list.innerHTML = candidates && candidates.length
    ? candidates.map((c, ci) => splitPopRowHTML(c, ci)).join('')
    : '<div class="split-pop-empty">没有匹配结果，换个关键词试试</div>';
  list.querySelectorAll('.split-pop-row').forEach((row) => {
    row.addEventListener('click', () => chooseSplitCandidate(splitPopFor, candidates[+row.dataset.ci]));
  });
}

// 按关键词拉候选并刷新下拉（写回 s.candidates 供复用）
async function loadSplitPopCandidates(i, query) {
  const s = splitSegments[i];
  const pop = document.querySelector('.split-pop');
  if (!s || !pop) return;
  const list = pop.querySelector('.split-pop-list');
  list.innerHTML = '<div class="split-pop-empty">搜索中…</div>';
  const candidates = await api.searchSongCandidates(query);
  if (splitPopFor !== i) return; // 已切换/关闭，丢弃过期结果
  s.candidates = candidates;
  renderSplitPopList(pop, candidates);
}

async function openSplitPop(i) {
  const s = splitSegments[i];
  if (!s || !api.hasBridge) return;
  if (splitPopFor === i) { closeSplitPop(); return; }
  closeSplitPop();
  splitPopFor = i;
  const row = $('splitList').querySelector(`[data-si="${i}"]`);
  if (!row) return;
  const pop = document.createElement('div');
  pop.className = 'split-pop';
  pop.innerHTML = `<input class="split-pop-search" value="${esc(s.name.trim())}" placeholder="输入歌名搜索…" spellcheck="false">
    <div class="split-pop-list"></div>`;
  // fixed 定位挂到 body，避开 .split-list 的 overflow 裁剪
  const anchor = row.querySelector('.split-match') || row;
  const rect = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, rect.left + rect.width - 300) + 'px';
  const popH = 296; // 搜索框 + 列表 + padding 的近似高度
  pop.style.top = (rect.bottom + 6 + popH > window.innerHeight ? Math.max(8, rect.top - popH - 6) : rect.bottom + 6) + 'px';
  document.body.appendChild(pop);
  // 列表滚动/窗口变化时关闭（fixed 不随行滚动）
  if (!openSplitPop._scrollBound) {
    openSplitPop._scrollBound = true;
    $('splitList').addEventListener('scroll', () => { if (splitPopFor >= 0) closeSplitPop(); }, { passive: true });
    window.addEventListener('resize', () => { if (splitPopFor >= 0) closeSplitPop(); });
  }
  const search = pop.querySelector('.split-pop-search');
  search.focus();
  search.setSelectionRange(search.value.length, search.value.length);
  pop.addEventListener('click', (e) => e.stopPropagation());
  search.addEventListener('input', () => {
    clearTimeout(splitPopTimers[i]);
    const q = search.value.trim();
    splitPopTimers[i] = setTimeout(() => {
      if (q && splitPopFor === i) loadSplitPopCandidates(i, q);
    }, 500);
  });
  // 已有候选直接用，否则按当前歌名搜索
  if (s.candidates && s.candidates.length) renderSplitPopList(pop, s.candidates);
  else if (s.name.trim()) loadSplitPopCandidates(i, s.name.trim());
}

// 选中候选：写 name/match，补封面，关下拉
async function chooseSplitCandidate(i, cand) {
  const s = splitSegments[i];
  if (!s || !cand) return;
  closeSplitPop();
  s.name = cand.title;
  s.matching = true;
  s.match = { title: cand.title, artist: cand.artist, pic: cand.pic || null, source: cand.source, id: cand.id, songmid: cand.songmid };
  const row = $('splitList').querySelector(`[data-si="${i}"]`);
  if (row) row.querySelector('.split-name').value = s.name;
  updateSplitMatchCell(i);
  if (!s.match.pic) {
    const pic = await api.resolveSongCover(cand);
    if (splitSegments[i] === s && pic) {
      s.match.pic = pic;
      updateSplitMatchCell(i);
    }
  }
  s.matching = false;
  updateSplitMatchCell(i);
  splitLog(`第 ${i + 1} 段手动匹配：${cand.title}${cand.artist ? ' - ' + cand.artist : ''}（${{ qq: 'QQ音乐', netease: '网易云' }[cand.source] || cand.source}）`);
}

function renderSplitList() {
  const list = $('splitList');
  list.innerHTML = splitSegments.length ? splitSegments.map((s, i) => `
    <div class="split-row" data-si="${i}">
      <span class="split-idx num">${String(i + 1).padStart(2, '0')}</span>
      <input class="split-time num" data-k="from" value="${fmt(Math.max(0, s.from))}" title="开始（分:秒）">
      <span class="split-sep">–</span>
      <input class="split-time num" data-k="to" value="${fmt(Math.max(0, s.to))}" title="结束（分:秒）">
      <input class="split-name" data-k="name" value="${esc(s.name)}" placeholder="填写歌名后自动匹配">
      <span class="split-match">${splitMatchCellHTML(s)}</span>
      <span class="split-id${s.matching ? ' off' : ''}" data-id="${i}" title="识别此片段"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg></span>
      <span class="split-del" data-del="${i}" title="删除分段"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
    </div>`).join('')
    : '<div class="fav-pop-hint">还没有分段，可点「添加分段」或「导入时间表」</div>';
  $('splitCount').textContent = splitSegments.length ? `${splitSegments.length} 段` : '';
  list.querySelectorAll('.split-row').forEach((row) => {
    const i = +row.dataset.si;
    row.querySelectorAll('input').forEach((input) => {
      if (input.dataset.k === 'name') {
        input.addEventListener('input', () => {
          const s = splitSegments[i];
          if (!s) return;
          s.name = input.value;
          clearTimeout(splitMatchTimers[i]);
          splitMatchTimers[i] = setTimeout(() => autoMatchSegment(i), 700);
        });
      } else {
        input.addEventListener('change', () => {
          const s = splitSegments[i];
          if (!s) return;
          const v = parseTimeInput(input.value);
          if (v === null) { input.value = fmt(Math.max(0, s[input.dataset.k])); return; }
          s[input.dataset.k] = v;
          if (s.to <= s.from) s.to = s.from + 30;
          row.querySelector('[data-k="from"]').value = fmt(Math.max(0, s.from));
          row.querySelector('[data-k="to"]').value = fmt(Math.max(0, s.to));
        });
      }
    });
    row.querySelector('.split-id').addEventListener('click', () => {
      if (!splitWave) { toast('请先运行「智能分析」生成波形'); return; }
      identifyOneSegment(i);
    });
    const pickBtn = row.querySelector('.split-pick');
    if (pickBtn) {
      pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openSplitPop(i); });
    }
    row.querySelector('.split-del').addEventListener('click', () => {
      splitSegments.splice(i, 1);
      renderSplitList();
    });
  });
  // 波形轨道上的分段 region 随列表同步
  if (splitWave && !$('splitWave').hidden) renderSplitWaveRegions();
}

/* ---------- 分切面板 · 波形剪辑轨道 ---------- */
// 波形横坐标 clientX → 音频时间（秒）
function splitWaveTimeAt(clientX) {
  const rect = $('splitWave').getBoundingClientRect();
  const ratio = rect.width ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  return ratio * (splitWave ? splitWave.duration : 0);
}

// 逐像素画波形竖条（每像素取对应 peaks 区间 max），devicePixelRatio 适配
function renderSplitWave() {
  const wrap = $('splitWave');
  if (!splitWave || wrap.hidden) return;
  const canvas = $('splitWaveCanvas');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight || 96;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const peaks = splitWave.peaks;
  const n = peaks.length;
  const mid = h / 2;
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  for (let x = 0; x < w; x++) {
    const a = Math.floor(x / w * n);
    const b = Math.min(n, Math.max(a + 1, Math.floor((x + 1) / w * n)));
    let m = 0;
    for (let i = a; i < b; i++) if (peaks[i] > m) m = peaks[i];
    const bh = Math.max(1, m * (h - 8));
    ctx.fillRect(x, mid - bh / 2, 1, bh);
  }
  // 时间徽标初始值（游标循环接管实时更新）
  const timeEl = $('splitWaveTime');
  if (timeEl) timeEl.textContent = `${fmtWave(0)} / ${fmtWave(splitWave.duration)}`;
  renderSplitWaveRegions();
}

// overlay 上为每个分段画 region：left/width 按 (from,to)/duration 百分比 + 边缘拖拽手柄
function renderSplitWaveRegions() {
  const overlay = $('splitWaveOverlay');
  if (!splitWave) { overlay.innerHTML = ''; return; }
  const dur = splitWave.duration || 1;
  overlay.innerHTML = splitSegments.map((s, i) => {
    const l = Math.max(0, Math.min(100, s.from / dur * 100));
    const r = Math.max(0, Math.min(100, s.to / dur * 100));
    return `<div class="split-region" data-ri="${i}" style="left:${l}%;width:${Math.max(0.5, r - l)}%">`
      + `<b>${i + 1}</b><i class="rh-l" data-edge="from"></i><i class="rh-r" data-edge="to"></i></div>`;
  }).join('');
}

// 播放游标（绿色细线）：面板打开期间 rAF 跟随 audio.currentTime
function splitWaveCursorLoop() {
  cancelAnimationFrame(splitWaveRaf);
  const tick = () => {
    splitWaveRaf = requestAnimationFrame(tick);
    let cursor = $('splitWaveCursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'split-wave-cursor';
      cursor.id = 'splitWaveCursor';
      $('splitWave').appendChild(cursor);
    }
    const ok = splitWave && !$('splitMask').hidden
      && state.current === splitSource && !state.current.isLive
      && splitWave.duration > 0;
    cursor.style.display = ok ? '' : 'none';
    if (ok) cursor.style.left = (audio.currentTime / splitWave.duration * 100) + '%';
    // 波形上方时间徽标：当前时间 / 总时长
    const timeEl = $('splitWaveTime');
    if (timeEl && splitWave) {
      timeEl.textContent = `${fmtWave(ok ? audio.currentTime : 0)} / ${fmtWave(splitWave.duration)}`;
    }
  };
  tick();
}

function stopSplitWaveCursor() {
  cancelAnimationFrame(splitWaveRaf);
  splitWaveRaf = 0;
  const cursor = $('splitWaveCursor');
  if (cursor) cursor.style.display = 'none';
}

// 只更新匹配状态单元格，避免打断正在输入的焦点
function updateSplitMatchCell(i) {
  const row = $('splitList').querySelector(`[data-si="${i}"]`);
  const s = splitSegments[i];
  if (row && s) {
    row.querySelector('.split-match').innerHTML = splitMatchCellHTML(s);
    const pickBtn = row.querySelector('.split-pick');
    if (pickBtn) {
      pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openSplitPop(i); });
    }
  }
}

// 手动填名 → 自动匹配：拉 QQ + 网易云候选缓存到 s.candidates（下拉复用），默认挑 QQ 源
async function autoMatchSegment(i) {
  const s = splitSegments[i];
  if (!s) return;
  const name = s.name.trim();
  if (!name || !api.hasBridge) {
    s.match = null; s.matching = false; s.candidates = null;
    updateSplitMatchCell(i);
    return;
  }
  s.matching = true;
  updateSplitMatchCell(i);
  const candidates = await api.searchSongCandidates(name);
  if (splitSegments[i] !== s || s.name.trim() !== name) return; // 编辑过/已删，丢弃过期结果
  s.candidates = candidates;
  const pick = pickSongCandidate(candidates, s.to - s.from);
  let m = null;
  if (pick) {
    m = { title: pick.title, artist: pick.artist, pic: pick.pic || null, source: pick.source, id: pick.id, songmid: pick.songmid };
    if (!m.pic) {
      m.pic = await api.resolveSongCover(pick);
      if (splitSegments[i] !== s || s.name.trim() !== name) return;
    }
  }
  s.matching = false;
  s.match = m;
  updateSplitMatchCell(i);
}

// 识别单个分段（先网易云后 Shazam，编排在 api.identifySegmentAudio）；命中写 name/match，返回是否命中
async function identifyOneSegment(i) {
  const t = splitSource;
  const s = splitSegments[i];
  if (!t || !s || !splitWave || s.matching || !api.hasBridge) return false;
  s.matching = true;
  s.identifying = true;
  updateSplitMatchCell(i);
  splitLog(`第 ${i + 1} 段（${fmtWave(s.from)} – ${fmtWave(s.to)}）开始识别`);
  try {
    const r = await api.identifySegmentAudio(
      splitWave.pcm, s.from, s.to,
      splitWave.srcPcm ? { pcm: splitWave.srcPcm, rate: splitWave.srcRate } : null,
      splitLog);
    if (splitSource !== t || $('splitMask').hidden || splitSegments[i] !== s) return false;
    if (r && r.title) {
      s.name = r.title;
      s.match = { title: r.title, artist: r.artist, pic: r.pic, source: r.source, id: r.id, songmid: r.songmid };
      // 识别链缺封面或缺歌曲 id（Shazam 无 id）时，走匹配接口一次补齐，供歌词拉取用
      if (!r.pic || !(r.id || r.songmid)) {
        const m = await api.matchSong(r.title, s.to - s.from);
        if (splitSource !== t || $('splitMask').hidden || splitSegments[i] !== s) return false;
        if (m) {
          if (!s.match.pic && m.pic) s.match.pic = m.pic;
          if (!(s.match.id || s.match.songmid) && (m.id || m.songmid)) {
            s.match.id = m.id; s.match.songmid = m.songmid;
            s.match.lrcSource = m.source; // 歌词按可拉取的源走，展示来源仍保留 Shazam
          }
        }
      }
      const row = $('splitList').querySelector(`[data-si="${i}"]`);
      if (row) row.querySelector('.split-name').value = s.name;
      return true;
    }
    return false;
  } finally {
    s.matching = false;
    s.identifying = false;
    updateSplitMatchCell(i);
  }
}

async function openSplitPanel() {
  const t = state.current;
  if (!t || t.isLive || !t.bvid || !api.hasBridge) { toast('当前曲目不支持分切'); return; }
  if (!(t.duration > 240)) { toast('视频较短，无需分切'); return; }
  splitSource = t;
  splitSegments = [];
  splitWave = null;
  $('splitWave').hidden = true;
  $('splitWaveTime').hidden = true;
  $('splitLog').innerHTML = '';
  $('splitLog').hidden = true;
  $('splitMask').hidden = false;
  splitWaveCursorLoop(); // 波形游标跟随播放进度（有波形时才显示）
  $('splitHint').textContent = '正在识别分段（视频章节 / 简介时间轴）…';
  renderSplitList();
  const segs = await api.mixSplitDetect(t.bvid, t.cid, t.duration);
  if (splitSource !== t || $('splitMask').hidden) return;
  splitSegments = segs.map((s) => ({ ...s, match: null, matching: false }));
  $('splitHint').textContent = splitSegments.length
    ? '已识别分段，可微调时间与歌名；也可点「智能分析」用 Transition 模式重新检测曲目切换点，再点「识别曲目」按音频指纹自动填歌名。'
    : '未检测到章节/简介时间轴：点「智能分析」在本地检测曲目切换点（Transition 模式），或「导入时间表」/ 手动「添加分段」；之后可点「识别曲目」按音频指纹自动填歌名。';
  renderSplitList();
  splitSegments.forEach((s, i) => { if (s.name.trim()) autoMatchSegment(i); });
}

function closeSplitPanel() {
  closeSplitPop();
  $('splitMask').hidden = true;
  splitSource = null;
  splitWave = null;
  $('splitWave').hidden = true;
  $('splitWaveTime').hidden = true;
  stopSplitWaveCursor();
  Object.keys(splitMatchTimers).forEach((k) => clearTimeout(splitMatchTimers[k]));
}

function splitCreatePlaylist() {
  const t = splitSource;
  if (!t) { closeSplitPanel(); return; }
  const tracks = splitSegments
    .filter((s) => s.name.trim() && s.to > s.from)
    .map((s) => ({
      bvid: t.bvid, cid: t.cid, aid: t.aid,
      title: (s.match && s.match.title) || s.name.trim(),
      up: (s.match && s.match.artist) || t.up,
      duration: Math.round(s.to - s.from),
      pic: (s.match && s.match.pic) || t.pic,
      from: Math.max(0, s.from), to: s.to, isSegment: true,
      // 歌词引用：匹配到的歌用源站 LRC（段内相对时钟，播放时平移），没有则回退 AI 字幕
      lyricRef: s.match && (s.match.id || s.match.songmid)
        ? { source: s.match.lrcSource || s.match.source, id: s.match.id, songmid: s.match.songmid }
        : undefined,
    }));
  if (!tracks.length) { toast('没有可用的分段，先填写歌名'); return; }
  const pl = {
    id: Date.now(),
    title: `${(t.title || '长视频').slice(0, 24)} · 分切`,
    desc: '由 MixSplitR 分切长视频创建，按段时间连播。',
    cover: t.pic || undefined,
    tracks,
  };
  customPlaylists.push(pl);
  saveCustomPlaylists();
  renderMyPlaylists();
  closeSplitPanel();
  openPlaylist(customPlaylistDetail(pl));
  toast(`已创建歌单，共 ${tracks.length} 首`);
}

/* ---------- HLS 直播 ---------- */
let hls = null;
function destroyHls() {
  if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
}

/* ---------- 「我喜欢」本地收藏 ---------- */
let likes = [];
try { likes = JSON.parse(localStorage.getItem('biu-likes') || '[]'); } catch (e) { likes = []; }
// 双写：主进程 JSON（主存储，抗崩溃）+ localStorage（冗余镜像）
const saveLikes = () => {
  try { localStorage.setItem(dataKey('biu-likes'), JSON.stringify(likes)); } catch (e) {}
  if (api.hasBridge && window.bili.storeSet) window.bili.storeSet(dataKey('biu-likes'), likes);
  recommendationProfiles.manager().refresh().catch(() => {});
};
const isLiked = (t) => !!(t && trackKey(t) && likes.some((l) => trackKey(l) === trackKey(t)));
function toggleLike(t) {
  if (!t || t.isLive) { toast('直播不支持收藏'); return; }
  if (!t.bvid) { toast('预览模式不支持收藏'); return; }
  if (isLiked(t)) {
    likes = likes.filter((l) => trackKey(l) !== trackKey(t));
    toast('已取消喜欢');
  } else {
    likes.unshift(trackCopy(t));
    toast('已加入我喜欢');
  }
  saveLikes();
  refreshLikeUI();
  renderMyPlaylists();
}
// 收藏数变化后刷新相关 UI
function refreshLikeUI() {
  $('shelfMeta').innerHTML = `${likes.length} 首歌曲<i>·</i>本地收藏`;
  const count = $('shelfLikeCount');
  if (count) count.textContent = `${likes.length} 首歌曲`;
  if (state.playlist && state.playlist.isLikes
      && document.body.dataset.view === 'playlist') openPlaylist(likesPlaylist());
}

const likeSVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C7 16.5 4 13.3 4 9.8 4 7.2 6 5 8.7 5c1.6 0 2.8.7 3.3 1.7C12.5 5.7 13.7 5 15.3 5 18 5 20 7.2 20 9.8c0 3.5-3 6.7-8 11.2z"/></svg>';

/* ---------- 封面 HTML：有真实封面用 img，否则占位渐变 SVG ---------- */
function covHTML(t, size = 100) {
  if (t && t.pic) {
    // 保留稳定的资源地址，让浏览器复用缓存；显示后换成 blob 会再次加载/解码。
    return `<img src="${esc(t.pic)}" loading="lazy" decoding="async" alt="">`;
  }
  return coverSVG((t && t.seed) || 1, size);
}

/* ---------- 列表行 / 卡片渲染（沿用设计稿类名） ---------- */
function trowHTML(t, i, on, editable = false) {
  const tag = t.isLive ? '<span class="tag-live">直播</span>' : '';
  const editBtns = editable
    ? `<span class="t-grip" role="button" aria-label="拖动排序" title="按住拖动排序">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span>
       <span class="t-del" data-del="${i}" role="button" aria-label="从歌单删除" title="从歌单删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>`
    : '';
  return `<div class="trow${on ? ' on' : ''}${editable ? ' editable' : ''}" data-qi="${i}">
    <span class="idx num"><i>${String(i + 1).padStart(2, '0')}</i><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
    <span class="tt"><span class="tcov">${covHTML(t)}</span>
      <span style="min-width:0"><b>${esc(t.title)}${tag}</b><small>${esc(t.up)}</small></span></span>
    <span class="up">${esc(t.up)}</span>
    <span class="dur num">${t.isLive ? 'LIVE' : fmt(t.duration)}</span>
    <span class="t-acts"><span class="like${isLiked(t) ? ' liked' : ''}" data-like="${i}">${likeSVG}</span>${editBtns}</span></div>`;
}

// 通用歌单卡片
function gcardHTML(title, meta, cover, badge = '', extra = '') {
  return `<div class="gcard" ${extra}>
    <div class="cover">${cover}${badge}
      <span class="count"><span class="count-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span class="count-label">${esc(meta)}</span></span>
      <span class="cover-loading" aria-hidden="true"></span>
    </div><h4>${esc(title)}</h4><p>${esc(meta)}</p></div>`;
}

// 追加推荐时只绑定新卡片。完成后真正移除占位层，而不是留下透明的无限动画。
const boundCoverCards = new WeakSet();
function bindCoverLoading(scope) {
  scope.querySelectorAll('.gcard:not(.cover-ready)').forEach((card) => {
    if (boundCoverCards.has(card)) return;
    boundCoverCards.add(card);
    const img = card.querySelector('.cover img');
    const reveal = () => {
      card.classList.add('cover-ready');
      card.querySelector('.cover-loading')?.remove();
    };
    if (!img) { reveal(); return; }
    const decodeThenReveal = () => {
      if (!img.decode) { reveal(); return; }
      img.decode().then(reveal).catch(reveal);
    };
    if (img.complete) {
      if (img.naturalWidth) decodeThenReveal();
      else reveal(); // 缓存的失败图片可能已经触发过 error，不能永远保留加载层。
      return;
    }
    img.addEventListener('load', decodeThenReveal, { once: true });
    img.addEventListener('error', reveal, { once: true });
  });
}

/* ---------- 播放队列 ---------- */
function setQueue(tracks, name, startIdx = 0) {
  state.queue = tracks;
  state.queueName = name || '';
  renderQueue();
  if (tracks.length) playIndex(startIdx);
}
function renderQueue() {
  $('queueCount').textContent = state.queue.length;
  $('qMeta').textContent = `${state.queue.length} 首${state.queueName ? ' · ' + state.queueName : ''}`;
  $('qlist').innerHTML = state.queue.map((t, i) =>
    `<div class="qrow${i === state.qi ? ' on' : ''}" data-qi="${i}">
      <span class="qcov">${covHTML(t)}</span>
      <span class="qt"><b>${esc(t.title)}</b><small>${esc(t.up)}</small></span>
      <span class="qd num">${t.isLive ? 'LIVE' : fmt(t.duration)}</span></div>`).join('') ||
    '<div class="list-hint">队列为空，去歌单里挑几首吧</div>';
  $('qlist').querySelectorAll('.qrow').forEach((el) =>
    el.addEventListener('click', () => playIndex(+el.dataset.qi)));
  savePlaybackSession();
}

/* ---------- 播放 ---------- */
async function playIndex(i, automatic = false) {
  if (i < 0 || i >= state.queue.length) return;
  state.qi = i;
  await playTrack(state.queue[i], { automatic });
  renderQueue();
}

async function playTrack(t, options = {}) {
  recommendationProfiles.startListening(t, { manual: options.autoplay !== false && !options.automatic,
    search: state.queueName?.startsWith('搜索') });
  recordHistory(t);
  const keepVideoMode = options.videoMode ?? videoModeOn();
  const autoplay = options.autoplay !== false;
  const startTime = Number.isFinite(options.startTime) ? options.startTime : null;
  pendingPlaybackStart = { track: t, position: startTime ?? (t.from || 0), playing: autoplay, videoMode: keepVideoMode };
  ++videoLoadToken;
  videoPreparePromise = null;
  videoPrepareKey = '';
  videoQualityOptions = [];
  videoQualityOptionsKey = '';
  video.pause();
  video.removeAttribute('src');
  video.removeAttribute('data-bvid');
  video.removeAttribute('data-separate-audio');
  video.removeAttribute('data-actual-quality');
  video.dataset.ready = 'false';
  video.load();
  liveVideo.pause();
  liveVideo.removeAttribute('src');
  liveVideo.load();
  stopLiveDanmaku();
  setLiveTheater(false);
  state.current = t;
  lastLi = -1;
  destroyHls();
  fillPlayingBase(t);
  // 立即用曲目自带时长刷新进度显示，避免新音频元数据就绪前残留上一首的时长
  const initRange = segmentRange(t);
  const initDur = initRange ? initRange.to - initRange.from : t.duration;
  $('ppDur').textContent = t.isLive ? 'LIVE' : (initDur > 0 ? fmt(initDur) : '00:00');
  $('ppCur').textContent = '00:00';
  $('ppFill').style.width = '0%';
  pushDeskLyric(null); // 清空桌面歌词，等待新曲歌词就绪
  if (!options.keepView) go('playing');
  resetFavState();

  savePlaybackSession();
  if (t.isLive) return playLive(t, { autoplay });

  if (!api.hasBridge || !t.bvid) {
    setLyricHint('预览模式暂无歌词');
    toast('预览模式：浏览器中无法播放，请在 Electron 中运行');
    return;
  }
  try {
    // 1. 拿详情（cid / aid / stat / 封面）
    if (!t.cid || !t.aid) {
      const d = await api.view(t.bvid);
      if (state.current !== t) return; // 已切歌，丢弃过期结果
      t.cid = d.cid; t.aid = d.aid;
      fillPlayingDetail(d);
    } else {
      api.view(t.bvid).then((d) => { if (state.current === t) fillPlayingDetail(d); }).catch(() => {});
    }
    syncFavState(t);
    // 2. 拿音频地址并播放（音质跟随设置）
    // 分切歌单连播：同一稿件同一音质时复用已加载的音频管线，只做段内定位。
    // 否则每次切歌都重新请求签名地址并重建整个媒体管线，冷缓冲深度 seek 必造成开头卡顿。
    const reuseAudio = !!(t.isSegment && audio.src && !audio.error
      && audio.dataset.bvid === t.bvid
      && audio.dataset.quality === String(settings.quality));
    if (!reuseAudio) {
      const url = await api.playUrl(t.bvid, t.cid, settings.quality);
      if (state.current !== t) return;
      audio.src = api.media(url);
      audio.dataset.bvid = t.bvid;
      audio.dataset.quality = String(settings.quality);
    }
    // 分切歌单的曲目：先定位到本段起点再播放（metadata 未就绪时浏览器会挂起此次 seek，
    // 即使 play() 因网络 stalled 也不会从整曲开头播起）
    if (startTime !== null) {
      await waitForPlaybackMetadata(audio);
      if (state.current !== t) return;
      audio.currentTime = BiuPlaybackSession.resumePosition(t, startTime, audio.duration);
    } else if (t.isSegment && isFinite(t.from)) {
      try { audio.currentTime = Math.max(0, t.from); } catch (e) {}
    }
    if (state.current !== t) return;
    pendingPlaybackStart = null;
    if (autoplay) await audio.play();
    else audio.pause();
    if (state.current !== t) return;
    syncProgress();
    // 3. 封面取色 + 热评 + 歌词（不阻塞播放）
    applyArtColors(t.pic);
    loadComments(t);
    loadLyrics(t);
    if (keepVideoMode) await setVideoMode(true, true);
    else scheduleVideoWarmup(t);
    savePlaybackSession();
  } catch (e) {
    if (state.current !== t) return;
    if (pendingPlaybackStart?.track === t) pendingPlaybackStart.playing = false;
    savePlaybackSession();
    console.error(e);
    toast('播放失败：' + (e.message || e));
  }
}

// 电台直播：HLS 流（hls.js），房间队列可连续切台
async function playLive(t, { autoplay = true } = {}) {
  if (!api.hasBridge || !t.roomid) {
    setLyricHint('电台直播');
    toast('预览模式：浏览器中无法播放直播');
    return;
  }
  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.removeAttribute('data-bvid');
    audio.removeAttribute('data-quality');
    audio.load();
    liveVideo.poster = t.pic || '';
    $('liveTitle').textContent = t.title || '直播电台';
    $('liveUp').textContent = `${t.up || '直播间'} · ${fmtNum(t.online || 0)} 人在看`;
    $('liveDockTitle').textContent = t.title || '直播电台';
    $('liveDockMeta').dataset.detail = `${t.up || '直播间'} · ${fmtNum(t.online || 0)} 人在线`;
    $('liveDockMeta').textContent = `正在连接 · ${$('liveDockMeta').dataset.detail}`;
    $('liveStatus').className = 'live-loading';
    $('liveStatus').innerHTML = '<span class="video-spinner"></span><b>正在连接直播…</b>';
    const url = await api.livePlayUrl(t.roomid);
    if (state.current !== t) return;
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, liveSyncDurationCount: 3 });
      hls.loadSource(url);
      hls.attachMedia(liveVideo);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (state.current !== t) return;
        pendingPlaybackStart = null;
        $('liveStatus').classList.add('ready');
        if (autoplay) liveVideo.play().catch(() => {});
        savePlaybackSession();
      });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d && d.fatal && state.current === t) {
          $('liveStatus').className = 'live-loading error';
          $('liveStatus').innerHTML = '<b>直播流已中断，请重新选择该电台</b>';
          $('liveDockMeta').textContent = `直播中断 · ${$('liveDockMeta').dataset.detail || t.up || '直播间'}`;
          toast('直播流中断，可重新点击卡片重试');
        }
      });
    } else if (liveVideo.canPlayType('application/vnd.apple.mpegurl')) {
      liveVideo.src = url;
      pendingPlaybackStart = null;
      if (autoplay) await liveVideo.play();
      $('liveStatus').classList.add('ready');
    } else {
      throw new Error('当前环境不支持 HLS 直播');
    }
    applyArtColors(t.pic);
    setLyricHint('电台直播进行中 · ' + (t.area || '音乐电台'));
    $('hotCommentText').textContent = `${fmtNum(t.online || 0)} 人在听`;
    if (liveDmOn) startLiveDanmaku(t.roomid);
  } catch (e) {
    if (state.current !== t) return;
    if (pendingPlaybackStart?.track === t) pendingPlaybackStart.playing = false;
    savePlaybackSession();
    console.error(e);
    $('liveDockMeta').textContent = `连接失败 · ${$('liveDockMeta').dataset.detail || t.up || '直播间'}`;
    toast('直播播放失败：' + (e.message || e));
  }
}

/* ---------- 直播弹幕：轮询最近弹幕接口模拟实时（WebSocket 长连成本过高） ---------- */
let liveDmOn = !!store.get('biu-livedm', 1);
let liveDmTimer = null;
let liveDmSeen = new Set();
let liveDmLane = 0;

function stopLiveDanmaku() {
  clearInterval(liveDmTimer);
  liveDmTimer = null;
  $('liveDmLayer').innerHTML = '';
}

function spawnLiveDm(text) {
  const layer = $('liveDmLayer');
  if (layer.childElementCount > 60) layer.firstElementChild.remove();
  const el = document.createElement('span');
  el.textContent = text;
  el.style.setProperty('--lane', String(liveDmLane++ % 9));
  el.style.setProperty('--dm-duration', (7 + Math.random() * 3).toFixed(2) + 's');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  layer.appendChild(el);
}

async function pollLiveDanmaku(roomid) {
  if (!state.current || state.current.roomid !== roomid || !state.current.isLive) {
    stopLiveDanmaku();
    return;
  }
  try {
    const list = await api.liveDanmaku(roomid);
    list.forEach((item) => {
      const key = `${item.uid}:${item.timeline}:${item.text}`;
      if (!item.text || liveDmSeen.has(key)) return;
      liveDmSeen.add(key);
      if (liveDmSeen.size > 400) liveDmSeen = new Set([...liveDmSeen].slice(-200));
      spawnLiveDm(item.text);
    });
  } catch (e) { /* 弹幕拉取失败静默，下一轮重试 */ }
}

function startLiveDanmaku(roomid) {
  stopLiveDanmaku();
  if (!liveDmOn || !roomid) return;
  liveDmSeen = new Set();
  liveDmLane = 0;
  pollLiveDanmaku(roomid);
  liveDmTimer = setInterval(() => pollLiveDanmaku(roomid), 4000);
}

/* 直播画面：应用内铺满 / 系统全屏 */
function setLiveTheater(on) {
  document.body.classList.toggle('live-theater', !!on);
  syncLiveButtons();
}

function syncLiveButtons() {
  const theater = document.body.classList.contains('live-theater');
  $('liveTheater').classList.toggle('on', theater);
  $('liveTheater').setAttribute('aria-pressed', String(theater));
  const fs = !!document.fullscreenElement;
  $('liveFs').classList.toggle('on', fs);
  $('liveFs').setAttribute('aria-pressed', String(fs));
  $('liveDmToggle').classList.toggle('on', liveDmOn);
  $('liveDmToggle').setAttribute('aria-pressed', String(liveDmOn));
  $('liveDmLayer').classList.toggle('off', !liveDmOn);
}

function randIdx() {
  let i = state.qi;
  while (state.queue.length > 1 && i === state.qi) i = Math.floor(Math.random() * state.queue.length);
  return i;
}
function next(automatic = false) {
  if (!state.queue.length) return;
  playIndex(playMode === 'shuffle' ? randIdx() : (state.qi + 1) % state.queue.length, automatic === true);
}
function prev() {
  if (!state.queue.length) return;
  playIndex(playMode === 'shuffle' ? randIdx() : (state.qi - 1 + state.queue.length) % state.queue.length);
}
function togglePlay() {
  const media = activeMedia();
  if (!media.src && !hls) {
    if (state.queue.length) playIndex(Math.max(0, state.qi));
    else toast('队列是空的，先去挑几首吧');
    return;
  }
  if (media === video && videoUsesSeparateAudio()) {
    if (video.paused) {
      audio.currentTime = video.currentTime;
      Promise.all([video.play(), audio.play()]).catch(() => {});
    } else {
      video.pause();
      audio.pause();
    }
  } else if (media.paused) media.play().catch(() => {});
  else media.pause();
}
// 播放 / 暂停图标同步
function syncToggleIcon() {
  const media = activeMedia();
  const playing = !media.paused && !media.ended && (!!media.src || !!hls);
  document.body.classList.toggle('is-playing', playing);
  $('icPlay').style.display = playing ? 'none' : '';
  $('icPause').style.display = playing ? '' : 'none';
  $('ppIcPlay').style.display = playing ? 'none' : '';
  $('ppIcPause').style.display = playing ? '' : 'none';
  $('liveIcPlay').style.display = playing ? 'none' : '';
  $('liveIcPause').style.display = playing ? '' : 'none';
  if (state.current && state.current.isLive) {
    const detail = $('liveDockMeta').dataset.detail || state.current.up || '直播间';
    $('liveDockMeta').textContent = `${playing ? '正在播放' : '已暂停'} · ${detail}`;
  }
}

/* 播放页基础信息（track 字段） */
const DEFAULT_NP_COVER = $('npCover').innerHTML;
const DEFAULT_PL_COVER = $('plCover').innerHTML;
const DEFAULT_MC_ART = $('mcArtHolder').innerHTML;
// 歌单详情封面右上角的内联编辑角标（常驻元素，openPlaylist 每次渲染后重新挂载）
const plCoverEditBtn = document.createElement('span');
plCoverEditBtn.className = 'pl-cover-edit';
plCoverEditBtn.id = 'plCoverEdit';
plCoverEditBtn.hidden = true;
plCoverEditBtn.title = '更换封面';
plCoverEditBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
function syncPlayingHeaderLayout() {
  const left = document.querySelector('.np-left');
  const heading = $('npHeading');
  const lyrics = $('lyrics');
  if (!left || !heading || !lyrics) return;
  const gap = Math.max(22, Math.min(38, window.innerHeight * .038));
  const top = Math.ceil(heading.offsetHeight + gap);
  lyrics.style.setProperty('--lyrics-top', `${top}px`);
}

const playingHeaderObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(syncPlayingHeaderLayout)
  : null;
playingHeaderObserver?.observe($('npHeading'));
window.addEventListener('resize', syncPlayingHeaderLayout, { passive: true });
document.fonts?.ready.then(syncPlayingHeaderLayout).catch(() => {});

function fillPlayingBase(t) {
  $('npArtist').textContent = t.up || '—';
  const title = t.title || '—';
  const titleLength = Array.from(title).length;
  $('npTitle').textContent = title;
  $('npTitle').classList.toggle('title-long', titleLength > 28);
  $('npTitle').classList.toggle('title-xlong', titleLength > 52);
  $('npSrc').textContent = t.isLive
    ? '直播 · ' + (t.area || '音乐电台')
    : '来源 · ' + (t.bvid || '本地预览');
  $('npSrc').title = $('npSrc').textContent;
  if (t.pic) {
    $('npCover').innerHTML = `<img src="${esc(t.pic)}" alt="">`;
    $('mcArtHolder').innerHTML = `<img class="art" src="${esc(t.pic)}" alt="">
      <svg class="ring" viewBox="0 0 48 48"><circle class="tr" cx="24" cy="24" r="21"/><circle class="pg" id="ringPg" cx="24" cy="24" r="21"/></svg>`;
  } else {
    $('npCover').innerHTML = DEFAULT_NP_COVER;
    $('mcArtHolder').innerHTML = DEFAULT_MC_ART;
  }
  window.BiuPlayerSheetMotion.setArtwork(t.pic);
  $('npAlbum').textContent = t.isLive ? 'LIVE' : (t.up || 'Bilibili 音乐');
  requestAnimationFrame(syncPlayingHeaderLayout);
  $('ppTitle').textContent = t.title || '未在播放';
  // 移动端迷你播放条封面（桌面端隐藏）
  const ppCover = $('ppCover');
  if (ppCover) {
    if (t.pic) { ppCover.src = t.pic; ppCover.hidden = false; }
    else { ppCover.removeAttribute('src'); ppCover.hidden = true; }
  }
  $('vTitle').textContent = t.title || '—';
  $('vUpName').textContent = t.up || '—';
  $('vUpFans').textContent = '';
  clearHotCommentRotation();
  $('hotCommentAvatar').innerHTML = '<span class="cdot"></span>';
  setHotCommentText('热评加载中…');
}

/* 播放页详情信息（view 接口数据） */
function fillPlayingDetail(d) {
  $('npSrc').textContent = `来源 · ${d.tname || (state.current && state.current.bvid) || 'Bilibili'}`;
  $('npSrc').title = $('npSrc').textContent;
  if (d.pic && state.current && !state.current.pic) {
    state.current.pic = d.pic.replace(/^http:/, 'https:');
    $('npCover').innerHTML = `<img src="${esc(state.current.pic)}" alt="">`;
    window.BiuPlayerSheetMotion.setArtwork(state.current.pic);
    const ppCover = $('ppCover');
    if (ppCover && ppCover.hidden) { ppCover.src = state.current.pic; ppCover.hidden = false; }
  }
  if (d.owner) {
    $('vUpName').textContent = d.owner.name || '—';
    if (d.owner.face) $('vUpAva').innerHTML = `<img src="${esc(d.owner.face)}" alt="">`;
    // 关注按钮挂上 mid 并回填关注状态
    const mid = d.owner.mid || 0;
    const fol = $('vUpFol');
    fol.dataset.fol = mid || '';
    setFollowBtn(fol, false);
    if (mid) {
      api.upRelation(mid).then((attr) => {
        if (fol.dataset.fol === String(mid) && (attr === 2 || attr === 6)) setFollowBtn(fol, true);
      }).catch(() => {});
    }
  }
  if (d.stat) {
    $('vsPlay').textContent = fmtNum(d.stat.view);
    $('vsDm').textContent = fmtNum(d.stat.danmaku);
    $('vsLike').textContent = fmtNum(d.stat.like);
    $('vsCoin').textContent = fmtNum(d.stat.coin);
    $('vsFav').textContent = fmtNum(d.stat.favorite);
  }
  // 点赞 / 投币 / 收藏的状态回填（未登录接口失败则保持默认）
  if (d.bvid) {
    ['vsLikeBtn', 'vsCoinBtn'].forEach((id) => $(id).classList.remove('on'));
    api.arcRelation(d.bvid).then((rel) => {
      if (!rel || !state.current || state.current.bvid !== d.bvid) return;
      $('vsLikeBtn').classList.toggle('on', !!rel.like);
      $('vsCoinBtn').classList.toggle('on', !!rel.coin);
      $('vsFavBtn').classList.toggle('on', !!rel.favorite);
    });
  }
}

/* 热评：胶囊轮播头像与评论；长文本自动横向浏览，并定期刷新接口数据。 */
let hotComments = [];
let hotCommentIndex = 0;
let hotCommentRotateTimer = null;
let hotCommentFetchTimer = null;

function clearHotCommentRotation() {
  clearTimeout(hotCommentRotateTimer);
  hotCommentMotion?.clear();
  clearInterval(hotCommentFetchTimer);
  hotCommentRotateTimer = null;
  hotCommentFetchTimer = null;
  hotComments = [];
  hotCommentIndex = 0;
}

let hotCommentMotion = null;
let hotCommentShownAt = 0;

function updateHotComment(data, { animate = true } = {}) {
  const pill = document.querySelector('.hot-comment');
  if (!pill) return;
  if (!hotCommentMotion) hotCommentMotion = window.BiuHotCommentMotion.create(pill);
  hotCommentMotion.update(data, (next) => {
    hotCommentShownAt = Date.now();
    $('hotCommentAvatar').innerHTML = next.avatar
      ? `<img src="${esc(next.avatar)}" alt="${esc(next.uname || '评论用户')}">`
      : next.seed != null ? coverSVG(next.seed) : '<span class="cdot"></span>';
    $('hotCommentText').textContent = next.text;
  }, { animate });
}

function setHotCommentText(message) {
  updateHotComment({ text: message || '暂无热评', avatar: null, seed: null, uname: null }, { animate: false });
}

function renderHotComment(index = 0) {
  if (!hotComments.length) {
    setHotCommentText('暂无热评');
    return;
  }
  hotCommentIndex = ((index % hotComments.length) + hotComments.length) % hotComments.length;
  const item = hotComments[hotCommentIndex];
  updateHotComment({
    text: item.message || '暂无热评',
    avatar: item.avatar || null,
    seed: item.avatar ? null : (item.seed || 94 + hotCommentIndex * 3),
    uname: item.uname || '评论用户',
  });
}

function scheduleHotCommentRotation(t) {
  clearTimeout(hotCommentRotateTimer);
  clearInterval(hotCommentFetchTimer);
  const rotate = () => {
    if (state.current !== t) return;
    const remaining = (hotCommentMotion?.dwellTime || 9000) - (Date.now() - hotCommentShownAt);
    if (remaining <= 0 && hotComments.length > 1 && !document.hidden
        && document.body.dataset.view === 'playing' && !videoModeOn()) {
      renderHotComment(hotCommentIndex + 1);
    }
    hotCommentRotateTimer = setTimeout(rotate, Math.max(1000, remaining > 0 ? remaining : 9000));
  };
  hotCommentRotateTimer = setTimeout(rotate, 9000);
  hotCommentFetchTimer = setInterval(() => {
    if (state.current === t) loadComments(t, { schedule: false, silent: true });
  }, 60000);
}

async function loadComments(t, { schedule = true, silent = false } = {}) {
  if (!t.aid) return;
  try {
    const replies = await api.replies(t.aid);
    if (state.current !== t) return;
    const previous = hotComments[hotCommentIndex];
    hotComments = replies.map((reply, index) => ({ ...reply, seed: reply.seed || 94 + index * 3 }));
    // 静默刷新保留正在阅读的评论，相同内容不打断滚动，也不重播过渡。
    const retained = silent && previous
      ? hotComments.findIndex((reply) => reply.uname === previous.uname && reply.message === previous.message)
      : -1;
    renderHotComment(retained >= 0 ? retained : 0);
    if (schedule) scheduleHotCommentRotation(t);
    $('cmt-list').innerHTML = replies.map((r) =>
      `<div class="cmt"><span class="ava">${r.avatar ? `<img src="${esc(r.avatar)}" alt="">` : coverSVG(r.seed || 94)}</span>
       <span class="cb"><b>${esc(r.uname)}</b><p>${esc(r.message)}</p>
       <small><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm3.2 11V8.6l3.3-5.2c.7 1.9.4 3.7-.5 5.6h5.5a2 2 0 0 1 2 2.4l-1.6 8a2 2 0 0 1-2 1.6H10.2z"/></svg>${esc(String(r.like))}</small></span></div>`).join('');
  } catch (e) {
    if (state.current === t && !silent) setHotCommentText('热评加载失败');
  }
}

/* ---------- 歌词：B 站 AI 字幕时间轴 + Folia Monet 逐词扫光复刻 ---------- */
let lyrics = [];   // [{ from, to, text, interlude?, tokens?: [{text, t0, t1, timed}] }]
let lastLi = -1;
let lyricVisualsDirty = true;

function lyricVisualsVisible() {
  return !document.hidden
    && (document.body.dataset.view === 'playing' || !!document.body.dataset.playerSheet)
    && !videoModeOn() && !state.current?.isLive;
}
let lyricManualAnchor = null;
let lyricWheelAccumulator = 0;
let lyricWheelDirection = 0;
let lyricManualResetTimer = null;
const LYRIC_WHEEL_STEP = 72;
const LYRIC_MANUAL_RESET_MS = 1800;
const LYRIC_VISIBLE_BEFORE = 4;
const LYRIC_VISIBLE_AFTER = 4;

/* Folia Monet 常量（src/components/visualizer/monet/MonetLyricsRail.tsx） */
const MONET_GLOW_RISE_SCALE = 1.18;   // 发光爬升时长 = 词时长 × 1.18
const MONET_GLOW_TAIL_SECONDS = 1.05; // 词结束后发光驻留尾部
const MONET_GLOW_MAX_ALPHA = .88;
const MONET_GLOW_RADIUS_ONE = .28;    // × fontPx
const MONET_GLOW_RADIUS_TWO = .65;    // × fontPx
const INTERLUDE_TEXT = '......';
const INTERLUDE_MIN_GAP = 3;

function cleanLyricText(text) {
  // B 站字幕常用 ♪ / ♫ 包裹歌词；界面只保留正文，不破坏句内标点。
  return String(text || '')
    .replace(/^[\s♪♫♬♩♭♮♯]+|[\s♪♫♬♩♭♮♯]+$/gu, '')
    .trim();
}

/* folia：inactiveScale = clamp(inactiveFontPx / lyricFontPx, .72, .92)，两组字号均为窗口宽度的 clamp */
function monetInactiveScale() {
  const w = window.innerWidth || 1280;
  const lyricFont = Math.min(3 * 16, Math.max(1.8 * 16, w * .034));
  const inactiveFont = Math.min(2.1 * 16, Math.max(1.4 * 16, w * .025));
  return Math.min(.92, Math.max(.72, inactiveFont / Math.max(lyricFont, 1)));
}

function lyricLineTone(index, anchorIndex) {
  if (index === lastLi) return { scale: 1, opacity: 1, blur: 0, z: 4 };
  const distance = Math.max(1, Math.abs(index - anchorIndex));
  const waiting = lastLi < 0 || index > lastLi;
  return {
    scale: Math.min(.92, Math.max(.68, monetInactiveScale() * Math.pow(.9, distance - 1))),
    opacity: waiting
      ? Math.max(.36, .72 - (distance - 1) * .18)
      : Math.max(.28, .52 - (distance - 1) * .12),
    blur: waiting
      ? (distance === 1 ? .7 : 1.8 + (distance - 2) * .8)
      : 1.1 + (distance - 1) * .7,
    z: waiting ? 3 - distance : 2 - distance,
  };
}

/* ----- 逐词切分与合成词级时间轴（B 站字幕只有行级时间，按字素均摊，对齐 Folia 的偶分配回退） ----- */
const lyricGraphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
const lyricWordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

function splitLyricGraphemes(text) {
  if (!text) return [];
  if (lyricGraphemeSegmenter) return Array.from(lyricGraphemeSegmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

function buildLineTokens(text, from, to) {
  const segments = lyricWordSegmenter
    ? Array.from(lyricWordSegmenter.segment(text))
    : splitLyricGraphemes(text).map((ch) => ({
        segment: ch,
        isWordLike: !/^\s$/.test(ch) && !/^\p{P}$/u.test(ch),
      }));
  const timedGraphemes = segments.reduce(
    (sum, seg) => sum + (seg.isWordLike ? splitLyricGraphemes(seg.segment).length : 0), 0);
  const unit = timedGraphemes > 0 ? Math.max(0, to - from) / timedGraphemes : 0;
  let cursor = from;
  return segments.map((seg, index) => {
    const tokenText = seg.segment;
    if (!seg.isWordLike || unit <= 0) {
      return { text: tokenText, t0: null, t1: null, timed: false, key: `s${index}` };
    }
    const count = splitLyricGraphemes(tokenText).length;
    const t0 = cursor;
    const t1 = index === segments.length - 1 ? to : cursor + unit * count;
    cursor = t1;
    return { text: tokenText, t0, t1, timed: true, key: `t${index}` };
  }).filter((token) => token.text);
}

/* 间奏圆点：间隔 > 3s 插入 '......'，6 个圆点均分时长（folia attachInterludes） */
function attachLyricInterludes(lines) {
  const result = [];
  const createInterlude = (start, end) => {
    const duration = Math.max(0, end - start);
    const wordDuration = duration / 6;
    return {
      from: start, to: end, text: INTERLUDE_TEXT, interlude: true,
      tokens: Array.from({ length: 6 }, (_, index) => ({
        text: '.', timed: true, key: `d${index}`,
        t0: start + index * wordDuration,
        t1: start + (index + 1) * wordDuration,
      })),
    };
  };
  if (lines.length && lines[0].from > INTERLUDE_MIN_GAP) {
    result.push(createInterlude(0.5, lines[0].from - 0.5));
  }
  lines.forEach((line, index) => {
    result.push(line);
    const next = lines[index + 1];
    if (next && next.from - line.to > INTERLUDE_MIN_GAP) {
      result.push(createInterlude(line.to + 0.05, next.from - 0.05));
    }
  });
  return result;
}

/* ----- 逐词扫光 / 发光的状态与逐帧计算 ----- */
const monetLineStates = new Map(); // lineIndex -> { el, tokens[], fontPx, edge, accentRgb }
let monetMeasureCtx = null;
let monetAccentProbe = null;

function getMonetMeasureCtx() {
  if (!monetMeasureCtx) monetMeasureCtx = document.createElement('canvas').getContext('2d');
  return monetMeasureCtx;
}

/* 解析 --lyric-accent（color-mix 由浏览器求值，探针读回；Chrome 可能返回 rgb() 或 color(srgb)） */
function resolveMonetAccentRgb() {
  if (!monetAccentProbe) {
    monetAccentProbe = document.createElement('span');
    monetAccentProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;color:var(--lyric-accent)';
    ($('lyrics') || document.body).appendChild(monetAccentProbe);
  }
  const computed = getComputedStyle(monetAccentProbe).color.trim();
  const rgbMatch = computed.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const channels = rgbMatch[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part));
    if (channels.every(Number.isFinite)) return channels;
  }
  const srgbMatch = computed.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgbMatch) return [+srgbMatch[1] * 255, +srgbMatch[2] * 255, +srgbMatch[3] * 255];
  return [255, 255, 255];
}

function monetMixRgb(from, to, amount, alpha) {
  const t = Math.min(1, Math.max(0, amount));
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${Math.round(from[0] + (to[0] - from[0]) * t)}, ${Math.round(from[1] + (to[1] - from[1]) * t)}, ${Math.round(from[2] + (to[2] - from[2]) * t)}, ${a})`;
}

function measureMonetTokenOffsets(token, fontSpec) {
  if (token.offsets && token.fontSpec === fontSpec) return;
  const ctx = getMonetMeasureCtx();
  ctx.font = fontSpec;
  const graphemes = splitLyricGraphemes(token.text);
  const offsets = new Array(graphemes.length + 1).fill(0);
  for (let i = 1; i <= graphemes.length; i += 1) {
    offsets[i] = ctx.measureText(graphemes.slice(0, i).join('')).width;
  }
  token.offsets = offsets;
  token.fontSpec = fontSpec;
  token.graphemeCount = graphemes.length;
}

/* 字素级填充前沿：词内按均摊字素时间在累计宽度间插值（folia fillWidth） */
function resolveMonetTokenFillWidth(token, currentTime) {
  const offsets = token.offsets;
  const fullWidth = offsets[offsets.length - 1] || 0;
  if (currentTime <= token.t0) return 0;
  if (currentTime >= token.t1) return fullWidth;
  const progress = (currentTime - token.t0) / Math.max(.001, token.t1 - token.t0);
  const floatIndex = progress * token.graphemeCount;
  const wholeIndex = Math.floor(floatIndex);
  const fractional = floatIndex - wholeIndex;
  const startWidth = offsets[Math.min(wholeIndex, offsets.length - 1)] || 0;
  const endWidth = offsets[Math.min(wholeIndex + 1, offsets.length - 1)] || startWidth;
  return startWidth + (endWidth - startWidth) * fractional;
}

function monetSmoothstep(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/* 词发光强度：唱词期间 smoothstep 爬升，过峰后 smoothstep 驻留衰减（folia glowShadow） */
function resolveMonetTokenGlow(token, lineRenderEnd, currentTime) {
  if (currentTime <= token.t0) return 0;
  const wordDuration = Math.max(.001, token.t1 - token.t0);
  const peakTime = token.t0 + wordDuration * MONET_GLOW_RISE_SCALE;
  if (currentTime <= peakTime) {
    return monetSmoothstep((currentTime - token.t0) / (wordDuration * MONET_GLOW_RISE_SCALE));
  }
  const tailEnd = Math.max(lineRenderEnd, token.t1 + MONET_GLOW_TAIL_SECONDS);
  const decayDuration = Math.max(.18, tailEnd - peakTime);
  return monetSmoothstep(1 - (currentTime - peakTime) / decayDuration);
}

function clearMonetTokenFx(token) {
  token.el.classList.remove('w-passed');
  token.base.style.textShadow = 'none';
  token.el.style.setProperty('--w-solid', '0px');
  token.el.style.setProperty('--w-feather', '0px');
  token.el.style.setProperty('--w-sweep', '0px');
}

function updateMonetLineWords(index, currentTime, isActiveLine) {
  const st = monetLineStates.get(index);
  if (!st) return;
  const line = lyrics[index];
  if (!line) return;
  if (!st.measured) {
    const cs = getComputedStyle(st.el);
    st.fontPx = parseFloat(cs.fontSize) || 36;
    st.edge = Math.max(6, Math.min(16, st.fontPx * .45));
    const fontSpec = `${cs.fontWeight} ${st.fontPx}px ${cs.fontFamily}`;
    st.tokens.forEach((token) => measureMonetTokenOffsets(token, fontSpec));
    st.measured = true;
  }
  const lineRenderEnd = line.to;
  const baseChannels = [255, 255, 255];
  const baseAlpha = isActiveLine ? .34 : .46;
  st.tokens.forEach((token) => {
    if (!token.timed) return;
    const wordPassed = currentTime > token.t1;
    const wordActive = currentTime >= token.t0 && !wordPassed;
    token.el.classList.toggle('w-passed', isActiveLine ? wordPassed : true);

    /* 发光附着在基底字形上，active / passed 行都保留尾部衰减 */
    const intensity = (isActiveLine || wordPassed)
      ? resolveMonetTokenGlow(token, lineRenderEnd, currentTime) : 0;
    if (intensity > 0) {
      const r1 = Math.round(st.fontPx * MONET_GLOW_RADIUS_ONE);
      const r2 = Math.round(st.fontPx * MONET_GLOW_RADIUS_TWO);
      const glowColor = monetMixRgb(baseChannels, st.accentRgb, intensity, intensity * MONET_GLOW_MAX_ALPHA);
      token.base.style.textShadow = `0 0 ${r1}px ${glowColor}, 0 0 ${r2}px ${glowColor}`;
    } else {
      token.base.style.textShadow = 'none';
    }

    if (!isActiveLine) {
      token.el.style.setProperty('--w-solid', '0px');
      token.el.style.setProperty('--w-feather', '0px');
      token.el.style.setProperty('--w-sweep', '0px');
      return;
    }

    /* 扫光 mask：实芯 → 0.92 羽化 → 透明，前沿越过词尾后完全探出（folia maskImage） */
    const progress = wordPassed ? 1 : wordActive
      ? (currentTime - token.t0) / Math.max(.001, token.t1 - token.t0) : 0;
    const filledWidth = resolveMonetTokenFillWidth(token, currentTime);
    const fullWidth = token.offsets[token.offsets.length - 1] || 0;
    const sweepEnd = fullWidth > 0 ? filledWidth + st.edge * Math.min(1, Math.max(0, filledWidth / fullWidth)) : 0;
    const solidEnd = Math.max(sweepEnd - st.edge, 0);
    const featherStart = Math.max(sweepEnd - st.edge * .55, 0);
    token.el.style.setProperty('--w-solid', `${solidEnd.toFixed(2)}px`);
    token.el.style.setProperty('--w-feather', `${featherStart.toFixed(2)}px`);
    token.el.style.setProperty('--w-sweep', `${sweepEnd.toFixed(2)}px`);

    /* 填充渐变随进度从基色混入高亮色，尾端 alpha 92% → 72%（folia fillGradient） */
    const fill = monetMixRgb(baseChannels, st.accentRgb, progress, Math.min(1, baseAlpha + (0.98 - baseAlpha) * progress));
    token.fill.style.backgroundImage = `linear-gradient(90deg, ${fill} 0%, ${monetMixRgb(baseChannels, st.accentRgb, progress, .92 * (baseAlpha + (0.98 - baseAlpha) * progress))} 68%, ${monetMixRgb(baseChannels, st.accentRgb, progress, .72 * (baseAlpha + (0.98 - baseAlpha) * progress))} 100%)`;
  });
}

function resetMonetLineWords(index, passed) {
  const st = monetLineStates.get(index);
  if (!st) return;
  st.tokens.forEach((token) => {
    if (!token.timed) return;
    clearMonetTokenFx(token);
    if (passed) token.el.classList.add('w-passed');
  });
}

function layoutLyricRail(anchorIndex, immediate = false) {
  const box = $('lyrics');
  const elements = [...box.querySelectorAll('.line')];
  if (!elements.length) return;
  const anchor = Math.max(0, Math.min(elements.length - 1, Math.round(anchorIndex)));
  if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) box.classList.add('no-motion');
  box.scrollTop = 0;

  const tones = elements.map((el, index) => {
    const tone = lyricLineTone(index, anchor);
    el.style.setProperty('--line-scale', tone.scale.toFixed(4));
    el.style.setProperty('--line-opacity', tone.opacity.toFixed(3));
    el.style.setProperty('--line-blur', `${tone.blur.toFixed(2)}px`);
    el.style.setProperty('--line-z', String(tone.z));
    const distance = index - anchor;
    const visible = distance >= -LYRIC_VISIBLE_BEFORE && distance <= LYRIC_VISIBLE_AFTER;
    el.classList.toggle('rail-visible', visible);
    if (!visible) el.style.setProperty('--line-opacity', '0');
    // 非活跃行最多两行，超出时底部渐隐（folia getClippedTextMask）
    const clipped = !el.classList.contains('on') && el.scrollHeight > el.offsetHeight + 1;
    el.classList.toggle('clipped', clipped);
    return { ...tone, height: el.offsetHeight };
  });

  const y = new Array(elements.length).fill(0);
  const focusCenter = box.clientHeight * .46;
  y[anchor] = focusCenter - tones[anchor].height * tones[anchor].scale / 2;
  const gapFor = (a, b) => (a === lastLi || b === lastLi ? 18 : 14);
  for (let index = anchor + 1; index < elements.length; index += 1) {
    y[index] = y[index - 1] + tones[index - 1].height * tones[index - 1].scale + gapFor(index - 1, index);
  }
  for (let index = anchor - 1; index >= 0; index -= 1) {
    y[index] = y[index + 1] - tones[index].height * tones[index].scale - gapFor(index, index + 1);
  }
  elements.forEach((el, index) => el.style.setProperty('--line-y', `${y[index].toFixed(2)}px`));
  if (box.classList.contains('no-motion')) requestAnimationFrame(() => box.classList.remove('no-motion'));
}

function scrollLyricTo(index, immediate = false) {
  layoutLyricRail(index, immediate);
}

function scheduleLyricAutoFollow() {
  clearTimeout(lyricManualResetTimer);
  lyricManualResetTimer = setTimeout(() => {
    lyricManualAnchor = null;
    lyricWheelAccumulator = 0;
    lyricWheelDirection = 0;
    if (lastLi >= 0) scrollLyricTo(lastLi);
  }, LYRIC_MANUAL_RESET_MS);
}

function bindLyricScrolling() {
  const box = $('lyrics');
  box.addEventListener('wheel', (event) => {
    if (!lyrics.length || videoModeOn()) return;
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? box.clientHeight : 1;
    const delta = event.deltaY * unit;
    const direction = Math.sign(delta);
    if (direction && lyricWheelDirection && direction !== lyricWheelDirection) lyricWheelAccumulator = 0;
    lyricWheelDirection = direction || lyricWheelDirection;
    lyricWheelAccumulator += delta;
    const steps = Math.max(-1, Math.min(1, Math.trunc(lyricWheelAccumulator / LYRIC_WHEEL_STEP)));
    if (steps !== 0) {
      lyricWheelAccumulator = 0;
      const base = lyricManualAnchor ?? Math.max(0, lastLi);
      lyricManualAnchor = Math.max(0, Math.min(lyrics.length - 1, base + steps));
      scrollLyricTo(lyricManualAnchor);
    }
    scheduleLyricAutoFollow();
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (lyrics.length) layoutLyricRail(lyricManualAnchor ?? Math.max(0, lastLi), true);
    }).observe(box);
  }
}

function setLyricHint(text) {
  lyrics = [];
  lyricManualAnchor = null;
  monetLineStates.clear();
  clearTimeout(lyricManualResetTimer);
  $('lyrics').classList.remove('no-motion');
  $('lyrics').innerHTML = `<div class="hint">${esc(text)}</div>`;
  pushDeskLyric('', '');
}

// 单曲判定：直播/无 bvid 除外；超长或标题含合集特征的直接走 AI 字幕，不浪费搜索
// 分切段落不按单曲搜词（段内时钟是绝对时间，AI 字幕时间轴才能对上）
function isSingleTrack(t) {
  if (!t || t.isLive || !t.bvid || t.isSegment) return false;
  if ((t.duration || 0) > 600) return false;
  return !/合集|串烧|联唱|连播|歌单|全收录|一小时|循环播放|medley|playlist|mixtape/i.test(t.title || '');
}

async function loadLyrics(t) {
  setLyricHint('歌词加载中…');
  try {
    // 单曲：先按歌名 + UP 主搜索匹配歌词；搜不到（或不是单曲）再回退 B 站 AI 字幕
    let lines = null;
    // 手动匹配（分切段自动匹配同路径）：lyricRef 指向 QQ/网易云 LRC，优先于一切自动来源
    if (t.lyricRef) {
      const rel = await api.lyricForMatch(t.lyricRef);
      if (state.current !== t) return;
      if (rel && rel.length) {
        const off = t.isSegment ? (t.from || 0) : 0;
        lines = rel.map((l) => ({ ...l, from: l.from + off, to: l.to + off }));
      }
    }
    if ((!lines || !lines.length) && t.isSegment) {
      // 分切曲目：优先匹配到的 QQ/网易云 LRC（相对歌曲起点 → 平移到视频绝对时钟）；
      // 没有匹配歌词则回退 AI 字幕，并裁到段内（防点击跳出分段）
      if (t.lyricRef) {
        const rel = await api.lyricForMatch(t.lyricRef);
        if (state.current !== t) return;
        if (rel && rel.length) {
          const off = t.from || 0;
          lines = rel.map((l) => ({ ...l, from: l.from + off, to: l.to + off }));
        }
      }
      if (!lines || !lines.length) {
        const all = await api.subtitles(t.bvid, t.cid);
        if (state.current !== t) return;
        lines = all ? all.filter((l) => l.to > (t.from || 0) && l.from < (Number.isFinite(t.to) ? t.to : Infinity)) : null;
      }
    } else if (!lines || !lines.length) {
      if (isSingleTrack(t)) {
        lines = await api.searchLyric(t.title, t.up, t.duration || 0);
        if (state.current !== t) return;
      }
      if (!lines || !lines.length) lines = await api.subtitles(t.bvid, t.cid);
      if (state.current !== t) return;
    }
    if (!lines) {
      setLyricHint('纯音乐 / 该视频暂无歌词');
      return;
    }
    lyrics = attachLyricInterludes(lines
      .map((line) => ({ ...line, text: cleanLyricText(line.text) }))
      .filter((line) => line.text)
      .map((line) => ({ ...line, tokens: buildLineTokens(line.text, line.from, line.to) })));
    if (!lyrics.length) {
      setLyricHint('纯音乐 / 该视频暂无有效歌词');
      return;
    }
    lastLi = -1;
    monetLineStates.clear();
    $('lyrics').innerHTML = lyrics.map((l, i) => {
      const tokensHtml = l.tokens.map((token) => token.timed
        ? `<span class="lw${l.interlude ? ' lw-dot' : ''}" style="--w-solid:0px;--w-feather:0px;--w-sweep:0px"><span class="lw-base">${esc(token.text)}</span><span class="lw-sweep" aria-hidden="true"><span class="lw-fill">${esc(token.text)}</span></span></span>`
        : `<span class="lws">${esc(token.text)}</span>`).join('');
      return `<div class="line${l.interlude ? ' interlude' : ''}" data-li="${i}"><span class="lyric-body">${tokensHtml}</span></div>`;
    }).join('');
    // 逐词渲染状态：词元素引用 + 字素宽度测量（字号依赖 .on 放大后的 computed style，延迟到激活时测量）
    const accentRgb = resolveMonetAccentRgb();
    $('lyrics').querySelectorAll('.line').forEach((el) => {
      const index = +el.dataset.li;
      const line = lyrics[index];
      const wordEls = [...el.querySelectorAll('.lw')];
      monetLineStates.set(index, {
        el,
        fontPx: 0,
        edge: 0,
        accentRgb,
        tokens: line.tokens.filter((token) => token.timed).map((token, wi) => ({
          ...token,
          el: wordEls[wi],
          base: wordEls[wi].querySelector('.lw-base'),
          fill: wordEls[wi].querySelector('.lw-fill'),
          offsets: null,
          fontSpec: '',
        })),
      });
    });
    // 点击歌词跳转：分切曲目钳制在段内；视频模式 DASH 双轨必须音视频一起 seek，
    // 否则只动 video 会被 syncVideoControls 的音视频对齐拉回，画面卡死
    $('lyrics').querySelectorAll('.line').forEach((el) =>
      el.addEventListener('click', () => {
        const l = lyrics[+el.dataset.li];
        const media = activeMedia();
        if (!l || !isFinite(media.duration)) return;
        lyricManualAnchor = null;
        // 有手动偏移时反推媒体时间，让点击落点与显示的歌词进度一致
        let target = l.from - lyricOffsetOf(state.current) + 0.01;
        const seg = state.current;
        if (seg && seg.isSegment && Number.isFinite(seg.to)) {
          target = Math.max(seg.from || 0, Math.min(seg.to - 0.05, target));
        }
        if (media === video && videoUsesSeparateAudio()) seekVideoTimeline(target);
        else { try { media.currentTime = target; } catch (err) {} }
      }));
    syncLyric(true);
  } catch (e) {
    if (state.current === t) setLyricHint('歌词加载失败');
  }
}

function syncLyric(force) {
  if (!lyrics.length) return;
  const visible = lyricVisualsVisible();
  // 首页不绘制歌词扫光。桌面歌词独立保留时钟/换行，不查询或修改隐藏页面的 DOM。
  if (!visible && !deskLyricOn) { lyricVisualsDirty = true; return; }
  // 同步时钟 = 播放时间 + 该曲目的手动歌词偏移
  const cur = activeMedia().currentTime + lyricOffsetOf(state.current);
  let idx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].from <= cur + 0.05) idx = i;
    else break;
  }
  const changed = idx !== lastLi;
  lastLi = idx;
  if (changed || force) pushDeskLyric(idx >= 0 ? lyrics[idx] : null);
  if (!visible) { lyricVisualsDirty = true; return; }
  if (idx >= 0) {
    // 活跃行逐词扫光；上一行保留发光尾部衰减
    updateMonetLineWords(idx, cur, true);
    if (idx > 0) updateMonetLineWords(idx - 1, cur, false);
  }
  if (!changed && !force && !lyricVisualsDirty) return;
  const resume = lyricVisualsDirty;
  lyricVisualsDirty = false;
  const lineEls = $('lyrics').querySelectorAll('.line');
  // 封面取色异步落地后 --art-1 会变，行切换时刷新一次高亮色
  const accentRgb = resolveMonetAccentRgb();
  monetLineStates.forEach((st) => { st.accentRgb = accentRgb; });
  lineEls.forEach((el, i) => {
    el.classList.toggle('on', i === idx);
    el.classList.toggle('next', i === idx + 1);
    el.classList.toggle('passed', idx >= 0 && i < idx);
    if (i !== idx && i !== idx - 1) resetMonetLineWords(i, idx >= 0 && i < idx);
  });
  if (idx >= 0 && lineEls[idx]) {
    scrollLyricTo(lyricManualAnchor ?? idx, !!force || resume);
  }
}

/* ---------- 桌面歌词：整行词级时间轴 + 播放时钟发给悬浮窗，扫光动画在歌词窗本地渲染 ---------- */
function pushDeskLyric(line) {
  if (!deskLyricOn || !api.hasBridge || !window.bili.lyricLine) return;
  if (!line) { window.bili.lyricLine({ text: '' }); return; }
  const media = activeMedia();
  window.bili.lyricLine({
    text: line.text,
    interlude: !!line.interlude,
    from: line.from,
    to: line.to,
    tokens: (line.tokens || []).map((tk) => ({ text: tk.text, t0: tk.t0, t1: tk.t1, timed: !!tk.timed })),
    time: isFinite(media.currentTime) ? media.currentTime + lyricOffsetOf(state.current) : 0,
    playing: !media.paused,
    accent: resolveMonetAccentRgb(),
  });
}

/* ---------- 手动匹配歌词：搜索 QQ/网易云候选 → 选曲换词；偏移见 lyricOffsets ---------- */
let lyricMatchTrack = null; // 面板操作的曲目（通常即当前播放）

function closeLyricMatch() {
  $('lyricMask').hidden = true;
  lyricMatchTrack = null;
}

function openLyricMatch() {
  const t = state.current;
  if (!t || t.isLive || !t.bvid) { toast('当前曲目不支持匹配歌词'); return; }
  lyricMatchTrack = t;
  $('lyricMask').hidden = false;
  $('lyricMatchInput').value = `${t.title || ''} ${t.up || ''}`.trim();
  $('lyricOffVal').textContent = fmtLyricOffset(lyricOffsetOf(t));
  $('lyricMatchHint').textContent = '搜索 QQ 音乐 / 网易云，点选正确的歌曲替换当前歌词。';
  $('lyricCands').innerHTML = '';
  runLyricMatchSearch();
}

async function runLyricMatchSearch() {
  const t = lyricMatchTrack;
  const kw = $('lyricMatchInput').value.trim();
  if (!t) return;
  if (!kw) { $('lyricCands').innerHTML = '<div class="list-hint">输入关键词后搜索</div>'; return; }
  $('lyricCands').innerHTML = '<div class="list-hint">搜索中…</div>';
  let list;
  try {
    list = await api.searchSongCandidates(kw);
  } catch (e) {
    list = [];
  }
  if (lyricMatchTrack !== t || $('lyricMask').hidden) return;
  if (!list.length) {
    $('lyricCands').innerHTML = '<div class="list-hint">没有找到候选歌曲，换个关键词试试</div>';
    return;
  }
  $('lyricCands').innerHTML = list.map((c, i) =>
    `<div class="lyric-cand" data-ci="${i}">
      <span class="lc-src ${c.source}">${c.source === 'qq' ? 'QQ 音乐' : '网易云'}</span>
      <span class="lc-meta"><b>${esc(c.title)}</b><small>${esc(c.artist || '未知歌手')}</small></span>
      <span class="lc-dur num">${c.duration > 0 ? fmt(c.duration) : ''}</span>
    </div>`).join('');
  $('lyricCands').querySelectorAll('.lyric-cand').forEach((el) =>
    el.addEventListener('click', () => pickLyricCandidate(list[+el.dataset.ci])));
}

async function pickLyricCandidate(c) {
  const t = lyricMatchTrack;
  if (!t || !c) return;
  // lyricRef 进入 loadLyrics 最高优先级：QQ 用 songmid、网易云用 id 拉 LRC
  t.lyricRef = { source: c.source, id: c.id, songmid: c.songmid };
  toast(`歌词已匹配：${c.title}${c.artist ? ' - ' + c.artist : ''}`);
  closeLyricMatch();
  if (state.current === t) loadLyrics(t);
}

/* 封面取色：dataURL → canvas 平均色，提亮/压暗生成三色驱动背景 */
async function applyArtColors(pic) {
  if (!pic) return;
  try {
    const dataURL = await api.image(pic);
    if (!dataURL) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      r /= n; g /= n; b /= n;
      const shade = (f) => `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`;
      const root = document.documentElement.style;
      root.setProperty('--art-1', shade(1.35)); // 提亮
      root.setProperty('--art-2', shade(0.7));
      root.setProperty('--art-3', shade(0.18)); // 压暗作底色
    };
    img.src = dataURL;
  } catch (e) { /* 取色失败保持默认配色 */ }
}

/* ---------- 音频 / 原视频共享进度、控件和歌词时钟 ---------- */
// 分切段的有效区间：旧版本收藏的数据可能缺 to，用 from + duration 兜底
function segmentRange(t) {
  if (!t || !t.isSegment) return null;
  const from = Number.isFinite(t.from) && t.from > 0 ? t.from : 0;
  let to = Number.isFinite(t.to) ? t.to : NaN;
  if (!Number.isFinite(to) && Number.isFinite(t.duration) && t.duration > 0) to = from + t.duration;
  if (!Number.isFinite(to) || to <= from) return null;
  return { from, to };
}

// 拖动进度条期间：timeupdate 不刷新进度 UI，避免与指针位置打架
let progressDragging = false;

function syncProgress(media = activeMedia()) {
  if (media !== activeMedia()) return;
  let dur = media.duration || 0;
  let cur = media.currentTime || 0;
  if (!isFinite(dur)) {
    // 直播：进度条常亮，时长显示 LIVE
    $('ppCur').textContent = fmt(cur);
    $('ppDur').textContent = 'LIVE';
    $('ppFill').style.width = '100%';
    return;
  }
  // 分切曲目：进度映射到段内（0 → 段长）；段尾兜底检测（主检测在 lyricFrame rAF）
  const seg = segmentRange(state.current);
  if (seg) {
    if (cur >= seg.to && segHandledToken !== videoLoadToken) {
      handleSegmentEnd(media, seg);
      return;
    }
    dur = seg.to - seg.from;
    cur = Math.max(0, cur - seg.from);
  }
  if (!progressDragging) {
    $('ppCur').textContent = fmt(cur);
    if (dur) {
      $('ppDur').textContent = fmt(dur);
      $('ppFill').style.width = (cur / dur * 100).toFixed(2) + '%';
      const ring = $('ringPg');
      if (ring) ring.style.strokeDasharray = `${(cur / dur * 132).toFixed(1)} 132`;
    }
  }
  syncLyric();
}

// 拖动中直接按指针位置画进度 UI（不 seek），松手才提交 seek
function paintProgressAt(frac) {
  const media = activeMedia();
  const seg = segmentRange(state.current);
  const dur = seg ? seg.to - seg.from : media.duration;
  if (!dur || !isFinite(dur)) return;
  $('ppFill').style.width = (frac * 100).toFixed(2) + '%';
  $('ppCur').textContent = fmt(frac * dur);
  const ring = $('ringPg');
  if (ring) ring.style.strokeDasharray = `${(frac * 132).toFixed(1)} 132`;
}

function bindMediaEvents(media) {
  media.addEventListener('timeupdate', () => {
    syncProgress(media);
    if (media === activeMedia()) recommendationProfiles.listeningTick(media.currentTime, !media.paused && !media.seeking && media.readyState >= 3);
  });
  media.addEventListener('pause', () => { if (media === activeMedia()) recommendationProfiles.listeningTick(media.currentTime, false); });
  media.addEventListener('loadedmetadata', () => {
    if (media !== activeMedia()) return;
    const seg = segmentRange(state.current);
    const d = seg ? seg.to - seg.from : media.duration;
    $('ppDur').textContent = isFinite(d) ? fmt(d) : 'LIVE';
  });
  media.addEventListener('play', syncToggleIcon);
  media.addEventListener('pause', syncToggleIcon);
  media.addEventListener('ended', () => {
    if (media !== activeMedia()) return;
    // 分切曲目由段尾检测（handleSegmentEnd）接管；此处的 ended 多为段尾切换等待期
    // 旧流自然播完，若放行会连跳两首
    if (segmentRange(state.current)) return;
    if (playMode === 'one') { media.currentTime = 0; media.play().catch(() => {}); }
    else next(true);
  });
}

function videoTimelineDuration() {
  const values = videoUsesSeparateAudio()
    ? [audio.duration, video.duration, state.current && state.current.duration]
    : [video.duration, state.current && state.current.duration];
  return Number(values.find((value) => Number.isFinite(value) && value > 0)) || 0;
}

function videoTimelineCurrent() {
  const source = videoUsesSeparateAudio() ? audio : video;
  return Number.isFinite(source.currentTime) ? source.currentTime : 0;
}

function seekVideoTimeline(time) {
  const duration = videoTimelineDuration();
  if (!duration) return false;
  const target = Math.max(0, Math.min(duration, Number(time) || 0));
  if (videoUsesSeparateAudio()) {
    try { audio.currentTime = target; } catch (error) {}
    try { video.currentTime = target; } catch (error) {}
  } else {
    try { video.currentTime = target; } catch (error) {}
  }
  resetDanmaku(target);
  syncVideoControls();
  return true;
}

function syncVideoControls() {
  const duration = videoTimelineDuration();
  const current = videoTimelineCurrent();
  $('vFill').style.width = duration ? `${Math.min(100, current / duration * 100)}%` : '0%';
  $('vTime').textContent = `${fmt(current)} / ${duration ? fmt(duration) : 'LIVE'}`;
  $('vTrack').setAttribute('aria-valuemax', String(Math.round(duration)));
  $('vTrack').setAttribute('aria-valuenow', String(Math.round(current)));
  $('vTrack').setAttribute('aria-valuetext', `${fmt(current)} / ${duration ? fmt(duration) : '00:00'}`);
  $('vVideoIcPlay').style.display = video.paused ? '' : 'none';
  $('vVideoIcPause').style.display = video.paused ? 'none' : '';
  $('vPlay').classList.toggle('on', !video.paused);
  $('vPlay').setAttribute('aria-pressed', String(!video.paused));
  $('vPlay').title = video.paused ? '播放' : '暂停';
  // DASH 双轨播放时音频是稳定时间轴，视频画面追随音频，避免拖动后被旧视频时间反向覆盖。
  if (videoUsesSeparateAudio() && !video.paused && !audio.paused
      && Math.abs(video.currentTime - current) > .28) {
    try { video.currentTime = current; } catch (error) {}
  }
}

function syncVideoOptionButtons() {
  const muted = !!videoSoundMedia().muted;
  $('vMute').classList.toggle('on', muted);
  $('vMute').setAttribute('aria-pressed', String(muted));
  $('vMute').title = muted ? '取消静音' : '静音';
  $('vIcSound').style.display = muted ? 'none' : '';
  $('vIcMuted').style.display = muted ? '' : 'none';

  const dmOn = !!settings.danmaku;
  $('vDmToggle').classList.toggle('on', dmOn);
  $('vDmToggle').setAttribute('aria-pressed', String(dmOn));
  $('vDmToggle').title = dmOn ? '关闭弹幕' : '开启弹幕';
}

function setVideoTheater(on) {
  const active = !!on && videoModeOn();
  document.body.classList.toggle('video-theater', active);
  const button = $('vFullscreen');
  if (!button) return;
  button.classList.toggle('on', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? '退出应用内铺满' : '应用内铺满');
  button.title = active ? '退出应用内铺满' : '应用内铺满';
  $('vIcExpand').style.display = active ? 'none' : '';
  $('vIcCompress').style.display = active ? '' : 'none';
}

function bindVideoControls() {
  $('vPlay').addEventListener('click', () => { togglePlay(); syncVideoControls(); });
  const videoTrack = $('vTrack');
  let draggingProgress = false;
  const seekFromPointer = (event) => {
    const duration = videoTimelineDuration();
    if (!duration) return;
    const rect = videoTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    seekVideoTimeline(ratio * duration);
  };
  videoTrack.addEventListener('pointerdown', (event) => {
    if (!videoTimelineDuration()) return;
    event.preventDefault();
    draggingProgress = true;
    videoTrack.classList.add('dragging');
    videoTrack.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });
  videoTrack.addEventListener('pointermove', (event) => {
    if (draggingProgress) seekFromPointer(event);
  });
  const stopProgressDrag = (event) => {
    if (!draggingProgress) return;
    draggingProgress = false;
    videoTrack.classList.remove('dragging');
    if (videoTrack.hasPointerCapture(event.pointerId)) videoTrack.releasePointerCapture(event.pointerId);
  };
  videoTrack.addEventListener('pointerup', stopProgressDrag);
  videoTrack.addEventListener('pointercancel', stopProgressDrag);
  videoTrack.addEventListener('keydown', (event) => {
    const duration = videoTimelineDuration();
    if (!duration) return;
    const step = event.shiftKey ? 15 : 5;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekVideoTimeline(videoTimelineCurrent() + (event.key === 'ArrowRight' ? step : -step));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      seekVideoTimeline(event.key === 'End' ? duration : 0);
    }
  });
  $('vMute').addEventListener('click', () => {
    const sound = videoSoundMedia();
    sound.muted = !sound.muted;
    if (videoUsesSeparateAudio()) video.muted = true;
    syncVideoOptionButtons();
  });
  // 清晰度：点击弹出档位菜单，不再是逐档轮播
  const qualityMenu = $('vQualityMenu');
  const closeQualityMenu = () => { qualityMenu.hidden = true; };
  $('vQuality').addEventListener('click', async (event) => {
    event.stopPropagation();
    const t = state.current;
    if (!t || !videoModeOn()) return;
    if (!qualityMenu.hidden) { closeQualityMenu(); return; }
    qualityMenu.innerHTML = '<div class="vqual-hint">正在获取可选清晰度…</div>';
    qualityMenu.hidden = false;
    try {
      const options = await getVideoQualityOptions(t);
      if (state.current !== t) { closeQualityMenu(); return; }
      if (!options.length) {
        qualityMenu.innerHTML = '<div class="vqual-hint">暂无可选清晰度</div>';
        return;
      }
      const current = Number(video.dataset.actualQuality) || settings.vq;
      qualityMenu.innerHTML = options.map((item) => {
        const { main, sub } = splitQualityLabel(item.label);
        return `<button type="button" class="vqual-item${item.quality === current ? ' on' : ''}" data-vq="${item.quality}">`
          + `<b>${esc(main)}</b>` + (sub ? `<small>${esc(sub)}</small>` : '') + '</button>';
      }).join('');
    } catch (error) {
      closeQualityMenu();
      toast('获取清晰度失败：' + (error.message || error));
    }
  });
  qualityMenu.addEventListener('click', async (event) => {
    const item = event.target.closest('.vqual-item');
    if (!item) return;
    closeQualityMenu();
    const quality = +item.dataset.vq;
    if (quality === (Number(video.dataset.actualQuality) || settings.vq)) return;
    settings.vq = quality;
    store.set('biu-vquality', settings.vq);
    syncVideoQualityUI(settings.vq);
    await setVideoMode(true, true);
  });
  document.addEventListener('click', (event) => {
    if (!qualityMenu.hidden && !event.target.closest('#vQualityMenu')) closeQualityMenu();
  });
  $('vFullscreen').addEventListener('click', () => {
    setVideoTheater(!document.body.classList.contains('video-theater'));
  });
  $('vDmToggle').addEventListener('click', () => {
    settings.danmaku = !settings.danmaku;
    store.set('biu-danmaku', settings.danmaku ? 1 : 0);
    $('vDmToggle').classList.toggle('on', settings.danmaku);
    $('danmakuLayer').classList.toggle('off', !settings.danmaku);
    if (!settings.danmaku) {
      $('danmakuLayer').innerHTML = '';
    } else if (state.current) {
      loadDanmaku(state.current, videoLoadToken);
    }
    syncVideoOptionButtons();
  });
  ['timeupdate', 'loadedmetadata', 'play', 'pause', 'durationchange'].forEach((event) => video.addEventListener(event, syncVideoControls));
  ['timeupdate', 'loadedmetadata', 'durationchange'].forEach((event) => audio.addEventListener(event, () => {
    if (videoModeOn() && videoUsesSeparateAudio()) syncVideoControls();
  }));
  syncVideoOptionButtons();
  syncVideoQualityUI(settings.vq);
}
bindMediaEvents(audio);
bindMediaEvents(video);
bindMediaEvents(liveVideo);
bindVideoControls();
video.addEventListener('seeking', () => resetDanmaku(video.currentTime));
video.addEventListener('play', () => $('danmakuLayer').classList.remove('paused'));
video.addEventListener('pause', () => $('danmakuLayer').classList.add('paused'));

audio.addEventListener('error', () => {
  if (state.current && !state.current.isLive) toast('播放出错，可尝试切换音质');
});
video.addEventListener('error', () => {
  if (!videoModeOn() || !video.getAttribute('src')) return;
  // 观看中途流报错（多为签名 URL 过期）：强制刷新重连，进度由 positionPreparedVideo 从音频侧同步
  if (document.body.classList.contains('video-pending') || video.dataset.ready !== 'true') return;
  toast('原视频流中断，正在重连…');
  setVideoMode(true, true);
});

/* 分切段尾自动连播：timeupdate 粒度只有 ~250ms，发现段尾时旧流已经越界，
   会继续播出一小段「下一段的内容」（听起来像别的歌闪了一下）。
   这里用 rAF 提前 60ms 检测并立即停住旧流，把越界压到听不见的量级。 */
let segHandledToken = -1;   // 当前曲目是否已触发过段尾切换（playTrack 里 ++videoLoadToken 天然重置）
let boundaryAdvanceAt = 0;  // 段尾触发的连播时刻，setVideoMode 据此视为「正在播放」
function handleSegmentEnd(media, seg) {
  if (playMode === 'one') {
    try { media.currentTime = seg.from; } catch (e) {}
    return;
  }
  segHandledToken = videoLoadToken;
  boundaryAdvanceAt = Date.now();
  // 立即停掉发声的元素：音频模式停 audio；视频模式 DASH 双轨停 audio、合体流停 video
  try { audio.pause(); } catch (e) {}
  if (videoModeOn() && !videoUsesSeparateAudio()) { try { video.pause(); } catch (e) {} }
  next(true);
}

// timeupdate 频率较低，歌词扫光用 rAF 补齐到屏幕刷新率。
let deskTickAt = 0;
function lyricFrame() {
  const media = activeMedia();
  // 段尾提前检测（见 handleSegmentEnd 注释）
  const segNow = state.current && segmentRange(state.current);
  if (segNow && segHandledToken !== videoLoadToken && !media.paused && !media.ended
      && isFinite(media.currentTime) && media.currentTime >= segNow.to - 0.06) {
    handleSegmentEnd(media, segNow);
  }
  const visualsVisible = lyricVisualsVisible();
  if (!visualsVisible) lyricVisualsDirty = true;
  if (lyrics.length && (!media.paused || (visualsVisible && lyricVisualsDirty))) syncLyric();
  syncDanmaku();
  // 桌面歌词时钟：150ms 一次对齐播放位置，扫光由歌词窗本地插值渲染
  const now = performance.now();
  if (deskLyricOn && api.hasBridge && now - deskTickAt > 150) {
    deskTickAt = now;
    window.bili.lyricLine({
      tick: true,
      time: isFinite(media.currentTime) ? media.currentTime : 0,
      playing: !media.paused,
    });
  }
  requestAnimationFrame(lyricFrame);
}
requestAnimationFrame(lyricFrame);

/* ---------- 底部频谱：Web Audio 实时频域数据，受限时自动回退到时间轴呼吸 ---------- */
const SPECTRUM_BARS = 112;
let spectrumEls = [];
let spectrumContext = null;
let spectrumAnalyser = null;
let spectrumData = null;
let spectrumReady = false;
let spectrumLevels = new Float32Array(SPECTRUM_BARS);
// 空闲（未播放且各柱已回落到基线）时跳过一帧 112 次 DOM 写入，避免空转烧 CPU
let spectrumSettled = false;

function initSpectrum() {
  const box = $('viz');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < SPECTRUM_BARS; i++) {
    const bar = document.createElement('i');
    bar.style.setProperty('--bar-index', String(i));
    frag.appendChild(bar);
  }
  box.replaceChildren(frag);
  spectrumEls = [...box.children];
  requestAnimationFrame(renderSpectrum);
}

function activateSpectrum() {
  try {
    if (!spectrumContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      spectrumContext = new AudioCtx();
      spectrumAnalyser = spectrumContext.createAnalyser();
      spectrumAnalyser.fftSize = 512;
      spectrumAnalyser.smoothingTimeConstant = .82;
      spectrumAnalyser.minDecibels = -92;
      spectrumAnalyser.maxDecibels = -18;
      const audioNode = spectrumContext.createMediaElementSource(audio);
      const videoNode = spectrumContext.createMediaElementSource(video);
      audioNode.connect(spectrumAnalyser);
      videoNode.connect(spectrumAnalyser);
      spectrumAnalyser.connect(spectrumContext.destination);
      spectrumData = new Uint8Array(spectrumAnalyser.frequencyBinCount);
      spectrumReady = true;
    }
    if (spectrumContext.state === 'suspended') spectrumContext.resume().catch(() => {});
  } catch (error) {
    console.warn('实时频谱初始化失败，使用动态回退效果：', error);
    spectrumReady = false;
  }
}

function renderSpectrum(now) {
  // 112 根柱子每帧两次样式写入只在歌词页可见时执行，音频链路不受影响。
  if (!lyricVisualsVisible()) { requestAnimationFrame(renderSpectrum); return; }
  const media = activeMedia();
  const playing = !!media && !media.paused && !media.ended;
  if (playing) spectrumSettled = false;
  if (spectrumSettled) { requestAnimationFrame(renderSpectrum); return; }
  if (spectrumReady && spectrumAnalyser && spectrumData) spectrumAnalyser.getByteFrequencyData(spectrumData);
  let measuredEnergy = 0;
  if (spectrumData) {
    for (let i = 2; i < Math.min(96, spectrumData.length); i++) measuredEnergy += spectrumData[i];
    measuredEnergy /= Math.min(94, Math.max(1, spectrumData.length - 2));
  }
  const useFallback = playing && measuredEnergy < 1.5;
  const t = (media && isFinite(media.currentTime) ? media.currentTime * 1000 : now) / 1000;
  let maxLevel = 0;
  spectrumEls.forEach((bar, i) => {
    const x = i / Math.max(1, SPECTRUM_BARS - 1);
    const band = spectrumData
      ? spectrumData[Math.min(spectrumData.length - 1, Math.floor(2 + Math.pow(x, 1.72) * spectrumData.length * .72))] / 255
      : 0;
    const breathing = (.34 + .34 * Math.sin(t * 2.15 + i * .31) + .18 * Math.sin(t * 4.6 - i * .17));
    const envelope = .34 + .66 * Math.pow(Math.sin(Math.PI * x), .55);
    const signal = !playing ? 0 : (useFallback ? Math.max(.05, breathing) * .48 : Math.pow(band, .72));
    const target = .025 + signal * envelope * .96;
    spectrumLevels[i] += (target - spectrumLevels[i]) * (target > spectrumLevels[i] ? .38 : .12);
    if (spectrumLevels[i] > maxLevel) maxLevel = spectrumLevels[i];
    bar.style.transform = `scaleY(${Math.max(.018, spectrumLevels[i]).toFixed(3)})`;
    bar.style.opacity = (.34 + Math.min(1, signal) * .66).toFixed(2);
  });
  // 未播放且所有柱都回落到基线附近后进入空闲态，停止每帧 DOM 写入
  if (!playing && maxLevel < 0.028) spectrumSettled = true;
  requestAnimationFrame(renderSpectrum);
}

// 进度定位：按比例跳转（分切曲目映射到段内；DASH 双轨模式音视频一起定位）
function seekToFraction(f) {
  const media = activeMedia();
  if (!media.duration || !isFinite(media.duration)) return;
  const frac = Math.min(1, Math.max(0, f));
  const seg = segmentRange(state.current);
  const target = seg ? seg.from + frac * (seg.to - seg.from) : frac * media.duration;
  if (videoModeOn() && videoUsesSeparateAudio()) seekVideoTimeline(target);
  else media.currentTime = target;
}

// 播放页进度条（底部浮层 hover 后展开的同一条）：按住拖动 + 点击跳转
$('ppTrack').addEventListener('pointerdown', (e) => {
  const media = activeMedia();
  if (!media.duration || !isFinite(media.duration)) return;
  e.preventDefault();
  const track = e.currentTarget;
  track.setPointerCapture(e.pointerId);
  progressDragging = true;
  let frac = 0;
  const fracOf = (ev) => {
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  };
  frac = fracOf(e);
  paintProgressAt(frac);
  const move = (ev) => { frac = fracOf(ev); paintProgressAt(frac); };
  const up = () => {
    progressDragging = false;
    seekToFraction(frac);
    track.removeEventListener('pointermove', move);
    track.removeEventListener('pointerup', up);
    track.removeEventListener('pointercancel', up);
  };
  track.addEventListener('pointermove', move);
  track.addEventListener('pointerup', up);
  track.addEventListener('pointercancel', up);
});

/* ---------- 音量 ---------- */
function setVolume(v) {
  v = Math.min(1, Math.max(0, v));
  audio.volume = v;
  video.volume = v;
  liveVideo.volume = v;
  store.set('biu-volume', +v.toFixed(2));
  $('volFill').style.width = (v * 100).toFixed(0) + '%';
  $('volWave').style.opacity = v === 0 ? '0' : '1';
}

/* 通用滑条拖动（音量 / 背景模糊） */
function bindSlider(el, onVal) {
  const set = (e) => {
    const r = el.getBoundingClientRect();
    onVal(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    set(e);
    const mv = (ev) => set(ev);
    const up = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
}

/* ---------- 歌单详情页 ---------- */
function likesPlaylist() {
  return {
    isLikes: true,
    label: '收藏夹 · 本地',
    title: '我喜欢',
    desc: '点过心形的曲目会保存在这里，本地存储，可随时连续播放。',
    meta: `${likes.length} 首`,
    cover: null, // 保留设计稿的粉色爱心封面
    tracks: likes,
  };
}
/* ---------- 播放历史（本地，最多 60 条，新播放的排在最前） ---------- */
let playHistory = store.get('biu-history', []);
if (!Array.isArray(playHistory)) playHistory = [];
const historyKey = (t) => trackKey(t) || null; // 分切段各自独立成一条历史

function recordHistory(t) {
  const key = historyKey(t);
  if (!key) return;
  playHistory = playHistory.filter((x) => historyKey(x) !== key);
  playHistory.unshift({ ...t, playedAt: Date.now() });
  if (playHistory.length > 60) playHistory.length = 60;
  store.set(dataKey('biu-history'), playHistory);
  if (api.hasBridge && window.bili.storeSet) window.bili.storeSet(dataKey('biu-history'), playHistory);
  // 可选：同步到 B 站观看历史（需登录），失败静默
  if (settings.syncHistory && authState.isLogin && !t.isLive && t.bvid) {
    api.historyReport(t, Math.max(0, Math.round(t.from || 0))).catch(() => {});
  }
  // 首页轮播的历史卡片封面同步成最近播放封面
  setShelfCover('cardHistory', t.pic);
}

function historyPlaylist() {
  return {
    label: '我的历史 · 本地',
    title: '我的历史',
    desc: '最近播放过的歌曲与电台，只保存在这台设备上。',
    meta: `${playHistory.length} 首`,
    cover: playHistory[0] || { seed: 9 },
    emptyHint: '还没有播放记录，去播放一首吧',
    tracks: playHistory,
  };
}

function rankingPlaylist() {
  return {
    label: '歌单 · Bilibili 音乐区',
    title: '音乐区热榜',
    desc: 'B 站音乐区实时排行榜，数据来自公开接口 ranking/v2（rid=3）。',
    meta: `${state.ranking.length} 首`,
    cover: state.ranking[0] || null,
    tracks: state.ranking,
  };
}
function openPlaylist(pl) {
  state.playlist = pl;
  resetPlEditingUI();
  $('plLabel').textContent = pl.label || '歌单';
  $('plTitle').textContent = pl.title;
  $('plDesc').textContent = pl.desc || '';
  $('plMeta').textContent = pl.meta || '';
  // 无封面时重置为默认占位，避免残留上一张歌单（如音乐区热榜）的封面
  $('plCover').innerHTML = pl.cover ? covHTML(pl.cover, 400) : DEFAULT_PL_COVER;
  // 首屏封面立即加载，避免入场途中才被懒加载器唤醒。
  const coverImage = $('plCover').querySelector('img');
  if (coverImage) coverImage.loading = 'eager';
  // 封面编辑角标常驻（innerHTML 会清掉它，每次重新挂回）
  $('plCover').appendChild(plCoverEditBtn);
  // 自建歌单 / B 站收藏夹：详情页提供内联编辑入口
  const actions = document.querySelector('.pl-actions');
  actions.querySelectorAll('[data-custom-act]').forEach((el) => el.remove());
  if (pl.customId || pl.favId) {
    actions.insertAdjacentHTML('beforeend',
      '<button class="btn-ghost" data-custom-act="edit">编辑</button>');
    actions.querySelector('[data-custom-act="edit"]')
      .addEventListener('click', togglePlEditing);
  }
  // 自建歌单（含 MixSplitR 分切歌单）：行内排序 / 删除。
  // 分切曲目的 from/to/isSegment 都在 track 对象上，移动/删除只是数组操作，互不影响。
  const plEntry = pl.customId ? customPlaylists.find((p) => p.id === pl.customId) : null;
  $('list-playlist').innerHTML = pl.tracks.length
    ? pl.tracks.map((t, i) => trowHTML(t, i, state.current === t, !!plEntry)).join('')
    : `<div class="list-hint">${esc(pl.emptyHint || '这里还空空如也，去点几个心形吧')}</div>`;
  bindTrackList($('list-playlist'), pl.tracks);
  if (plEntry) bindPlTrackEdit($('list-playlist'), plEntry);
  go('playlist');
}
// 绑定列表点击：行 → 播放；心形 → 收藏
function bindTrackList(container, tracks) {
  container.querySelectorAll('.trow').forEach((el) => {
    el.addEventListener('click', () => setQueue(tracks, state.playlist ? state.playlist.title : '', +el.dataset.qi));
  });
  container.querySelectorAll('.like').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLike(tracks[+el.dataset.like]);
      el.classList.toggle('liked', isLiked(tracks[+el.dataset.like]));
    });
  });
}

// 自建歌单（含分切歌单）行内编辑：手柄拖拽排序 + 删除；改动直接落在 customPlaylists 并持久化
function bindPlTrackEdit(container, plEntry) {
  container.querySelectorAll('.t-del').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +el.dataset.del;
      const t = plEntry.tracks[i];
      if (!t) return;
      // 删除动画：淡出 + 高度收拢，动画结束后再真正移除并重绘
      const row = el.closest('.trow');
      if (row && !row.classList.contains('t-removing')) {
        row.classList.add('t-removing');
        row.style.height = row.offsetHeight + 'px';
        requestAnimationFrame(() => row.classList.add('t-gone'));
        setTimeout(() => {
          plEntry.tracks.splice(i, 1);
          saveCustomPlaylists();
          toast(`已从「${plEntry.title}」删除《${t.title}》`);
          refreshCustomPlaylist(plEntry);
        }, 280);
        return;
      }
      plEntry.tracks.splice(i, 1);
      saveCustomPlaylists();
      refreshCustomPlaylist(plEntry);
    });
  });
  // 只有按住手柄才允许拖起整行，避免点行播放时误触发拖拽
  const rows = () => [...container.querySelectorAll('.trow')];
  rows().forEach((row) => {
    const grip = row.querySelector('.t-grip');
    if (!grip) return;
    grip.addEventListener('pointerdown', () => { row.draggable = true; });
    grip.addEventListener('click', (e) => e.stopPropagation());
    row.addEventListener('dragstart', (e) => {
      if (!row.draggable) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.qi);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      // 拖动中 DOM 已实时重排，松手时按 DOM 顺序（data-qi 为原下标）写回数据
      const order = rows().map((x) => +x.dataset.qi);
      if (order.some((v, i) => v !== i)) {
        const old = plEntry.tracks;
        plEntry.tracks = order.map((i) => old[i]);
        saveCustomPlaylists();
      }
      refreshCustomPlaylist(plEntry);
    });
  });
  // 实时重排：找到第一个中点在指针下方的行，把被拖行插到它前面；否则排到末尾。
  // 直接移动 DOM 节点（不用 transform 位移做命中），天然没有振荡，也支持拖到最底部；
  // 移动时对其余行做 FLIP 动画：先按旧视觉位置反向位移一帧，再平滑滑向新槽位。
  // 一段滑动未落定（.fly）时跳过本次移动，等下一拍 dragover——避免在途位移污染命中测试
  container.addEventListener('dragover', (e) => {
    const dragging = container.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (container.querySelector('.fly')) return;
    const ref = rows().find((x) => {
      if (x === dragging) return false;
      const rect = x.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (ref ? dragging.nextElementSibling === ref : container.lastElementChild === dragging) return;
    const before = new Map(rows().map((x) => [x, x.getBoundingClientRect().top]));
    if (ref) container.insertBefore(dragging, ref);
    else container.appendChild(dragging);
    const movers = rows().filter((x) => x !== dragging)
      .map((x) => [x, before.get(x) - x.getBoundingClientRect().top])
      .filter(([, d]) => d);
    movers.forEach(([x, d]) => {
      x.classList.add('fly');
      x.style.transition = 'none';
      x.style.transform = `translateY(${d}px)`;
    });
    requestAnimationFrame(() => movers.forEach(([x]) => {
      x.style.transition = 'transform .22s var(--ease)';
      x.style.transform = '';
      setTimeout(() => { x.classList.remove('fly'); x.style.transition = ''; }, 230);
    }));
  });
}

/* ---------- 本地自定义歌单：新建 / 删除 / 详情页内联编辑 ---------- */
let customPlaylists = store.get('biu-playlists', []);
if (!Array.isArray(customPlaylists)) customPlaylists = [];
const saveCustomPlaylists = () => {
  store.set(dataKey('biu-playlists'), customPlaylists);
  if (api.hasBridge && window.bili.storeSet) window.bili.storeSet(dataKey('biu-playlists'), customPlaylists);
  recommendationProfiles.manager().refresh().catch(() => {});
};

let plDialogMode = 'create'; // 'create' | 'delete'
let plDialogTarget = -1;
let plDialogCover; // create 模式：undefined=未选封面，string=封面 dataURL
let coverPickTarget = 'dialog'; // 文件选择去向：'dialog' 新建弹窗 / 'inline' 详情页内联

function openPlDialog(mode, index = -1) {
  plDialogMode = mode;
  plDialogTarget = index;
  plDialogCover = undefined;
  const input = $('plDialogInput');
  const msg = $('plDialogMsg');
  const ok = $('plDialogOk');
  const pl = customPlaylists[index];
  const isCreate = mode === 'create';

  $('plDialogTitle').textContent = isCreate ? '新建歌单' : '删除歌单';
  input.style.display = isCreate ? '' : 'none';
  input.value = '';
  msg.style.display = isCreate ? 'none' : '';
  msg.textContent = isCreate ? '' : `确定删除歌单「${(pl || {}).title || ''}」吗？此操作不可恢复。`;
  $('plDialogCoverCard').hidden = !isCreate;
  renderPlDialogPreview();
  ok.textContent = isCreate ? '创建' : '删除';
  ok.classList.toggle('danger', !isCreate);
  $('plDialogMask').hidden = false;
  if (isCreate) setTimeout(() => input.focus(), 60);
}
function closePlDialog() { $('plDialogMask').hidden = true; }

// 新建弹窗的封面卡片预览：封面图 + 实时联动的歌单名
function renderPlDialogPreview() {
  $('plDialogCoverImg').innerHTML = plDialogCover
    ? `<img src="${esc(plDialogCover)}" alt="">`
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15l-4.5-4.5L6 21"/></svg>';
  $('plDialogCoverName').textContent = $('plDialogInput').value.trim() || '歌单';
}

// 图片文件 → 压缩到 320px JPEG dataURL，避免撑爆 localStorage
function compressCoverFile(file, cb) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 320 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    cb(canvas.toDataURL('image/jpeg', .85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('图片读取失败'); };
  img.src = url;
}

function refreshCustomPlaylist(pl) {
  renderMyPlaylists();
  if (state.playlist && state.playlist.customId === pl.id
      && document.body.dataset.view === 'playlist') {
    // 排序/删除触发的重绘保持编辑模式（不重新聚焦标题输入框）
    const wasEditing = plEditing;
    openPlaylist(customPlaylistDetail(pl));
    if (wasEditing) setPlEditing(true, false);
  }
}

function submitPlDialog() {
  const pl = customPlaylists[plDialogTarget];
  if (plDialogMode === 'create') {
    const title = $('plDialogInput').value.trim();
    if (!title) { $('plDialogInput').focus(); return; }
    const next = { id: Date.now(), title, tracks: [] };
    if (plDialogCover) next.cover = plDialogCover;
    customPlaylists.push(next);
    saveCustomPlaylists();
    closePlDialog();
    renderMyPlaylists();
    toast('已创建歌单 · ' + title);
    return;
  }
  if (!pl) { closePlDialog(); return; }
  closePlDialog();
  customPlaylists.splice(plDialogTarget, 1);
  saveCustomPlaylists();
  // 正在详情页看这张歌单时删除，直接退回歌单库
  if (state.playlist && state.playlist.customId === pl.id) go('library');
  renderMyPlaylists();
  toast('已删除歌单 · ' + pl.title);
}

/* ---------- 歌单详情页内联编辑：封面角标 / 标题 / 简介 ---------- */
let plEditing = false;

function currentCustomPlaylist() {
  return state.playlist && state.playlist.customId != null
    ? customPlaylists.find((p) => p.id === state.playlist.customId) : null;
}

function currentFavFolder() {
  if (!state.playlist || state.playlist.favId == null || !favCache.folders) return null;
  return favCache.folders.find((f) => f.id === state.playlist.favId) || null;
}

function resetPlEditingUI() {
  plEditing = false;
  document.querySelector('.pl-head').classList.remove('editing');
  const tl = document.querySelector('.view-playlist .tlist');
  if (tl) tl.classList.remove('editing');
  plCoverEditBtn.hidden = true;
  $('plTitle').style.display = '';
  $('plDesc').style.display = '';
  $('plTitleEdit').hidden = true;
  $('plDescEdit').hidden = true;
}

function setPlEditing(on, focus = true) {
  plEditing = on;
  document.querySelector('.pl-head').classList.toggle('editing', on);
  // 行内排序 / 删除控件仅本地歌单（含分切歌单）在编辑模式下出现
  const tl = document.querySelector('.view-playlist .tlist');
  if (tl) tl.classList.toggle('editing', on && !!(state.playlist && state.playlist.customId));
  const btn = document.querySelector('[data-custom-act="edit"]');
  if (btn) btn.textContent = on ? '完成' : '编辑';
  // 封面角标仅本地歌单可用（B 站收藏夹封面不支持本地修改）
  plCoverEditBtn.hidden = !on || !state.playlist.customId;
  $('plTitle').style.display = on ? 'none' : '';
  $('plDesc').style.display = on ? 'none' : '';
  $('plTitleEdit').hidden = !on;
  $('plDescEdit').hidden = !on;
  if (on) {
    const cp = currentCustomPlaylist();
    if (cp) {
      $('plTitleEdit').value = cp.title || '';
      $('plDescEdit').value = cp.desc || '';
    } else {
      const folder = currentFavFolder();
      $('plTitleEdit').value = folder ? folder.title : (state.playlist.title || '');
      $('plDescEdit').value = (folder && folder.intro) || '';
      // 列表接口可能不带简介：进入编辑时补拉一次详情回填
      if (folder && !folder.intro) {
        api.favFolderInfo(folder.id).then((info) => {
          if (info && plEditing && state.playlist
              && state.playlist.favId === folder.id && !$('plDescEdit').value) {
            folder.intro = info.intro || '';
            $('plDescEdit').value = folder.intro;
          }
        }).catch(() => {});
      }
    }
    if (focus) $('plTitleEdit').focus();
  }
}

function commitPlEditing() {
  const pl = currentCustomPlaylist();
  if (!pl) return;
  const title = $('plTitleEdit').value.trim();
  if (title) pl.title = title;
  else toast('歌单名不能为空，已保留原名');
  pl.desc = $('plDescEdit').value.trim();
  saveCustomPlaylists();
  refreshCustomPlaylist(pl);
  toast('歌单已更新');
}

// B 站收藏夹：内联编辑提交，同步到 B 站；失败时保留编辑态
async function commitFavEditing() {
  const folder = currentFavFolder();
  if (!folder) { setPlEditing(false); return; }
  const title = $('plTitleEdit').value.trim();
  const intro = $('plDescEdit').value.trim();
  if (!title) { toast('收藏夹名称不能为空'); return; }
  try {
    await api.favFolderEdit(folder.id, title, intro);
  } catch (e) {
    toast('同步到 B 站失败：' + (e.message || e));
    return;
  }
  folder.title = title;
  folder.intro = intro;
  setPlEditing(false);
  // 原地更新详情页与外部网格卡片
  if (state.playlist) {
    state.playlist.title = title;
    state.playlist.desc = intro || '来自 B 站收藏夹，与网页端实时同步。';
    $('plTitle').textContent = title;
    $('plDesc').textContent = state.playlist.desc;
  }
  const grid = $('grid-fav');
  grid.dataset.signature = '';
  renderFavFolders(grid, favCache.mid, favCache.folders);
  toast('已同步到 B 站');
}

async function togglePlEditing() {
  if (!plEditing) { setPlEditing(true); return; }
  if (state.playlist && state.playlist.favId != null && state.playlist.customId == null) {
    await commitFavEditing();
    return;
  }
  setPlEditing(false);
  commitPlEditing();
}

function initPlaylistInlineEdit() {
  plCoverEditBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    coverPickTarget = 'inline';
    $('plCoverFile').click();
  });
  const keyGuard = (e) => {
    // 中文输入法组词期间的回车只是选词，不触发提交
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); togglePlEditing(); }
    else if (e.key === 'Escape') setPlEditing(false);
    e.stopPropagation();
  };
  $('plTitleEdit').addEventListener('keydown', keyGuard);
  $('plDescEdit').addEventListener('keydown', keyGuard);
}

function initPlaylistDialog() {
  $('plDialogOk').addEventListener('click', submitPlDialog);
  $('plDialogCancel').addEventListener('click', closePlDialog);
  $('plDialogMask').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePlDialog(); });
  $('plDialogInput').addEventListener('keydown', (e) => {
    // 中文输入法组词期间的回车只是选词，不能当成确认创建
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) submitPlDialog();
    else if (e.key === 'Escape') closePlDialog();
    e.stopPropagation();
  });
  $('plDialogInput').addEventListener('input', renderPlDialogPreview);
  $('plDialogCoverCard').addEventListener('click', () => {
    coverPickTarget = 'dialog';
    $('plCoverFile').click();
  });
  $('plCoverFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    compressCoverFile(file, (dataUrl) => {
      if (coverPickTarget === 'inline') {
        const pl = currentCustomPlaylist();
        if (!pl) return;
        pl.cover = dataUrl;
        saveCustomPlaylists();
        // 原地更新封面，保留编辑态；网格卡片同步刷新
        $('plCover').innerHTML = `<img src="${esc(dataUrl)}" alt="">`;
        $('plCover').appendChild(plCoverEditBtn);
        if (state.playlist) state.playlist.cover = { pic: dataUrl };
        renderMyPlaylists();
        toast('封面已更新');
      } else {
        plDialogCover = dataUrl;
        renderPlDialogPreview();
      }
    });
  });
  initPlaylistInlineEdit();
}

function customPlaylistDetail(p) {
  return {
    customId: p.id,
    label: '歌单 · 本地',
    title: p.title,
    desc: p.desc || '本地创建的歌单，保存在这台设备上。',
    meta: `${p.tracks.length} 首`,
    // 无封面时用与网格卡片一致的渐变占位（按 id 取色），不要回退到「我喜欢」的心形图
    cover: p.cover ? { pic: p.cover } : (p.tracks[0] || { seed: 20 + (Number(p.id) % 12) }),
    emptyHint: '歌单里还没有歌曲',
    tracks: p.tracks,
  };
}

function renderMyPlaylists() {
  const grid = $('grid-my');
  grid.innerHTML =
    gcardHTML('我喜欢', `${likes.length} 首歌曲`,
      `<svg viewBox="0 0 400 400"><defs><linearGradient id="lk3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa9c0"/><stop offset="1" stop-color="#fb7299"/></linearGradient></defs><rect width="400" height="400" fill="url(#lk3)"/><path d="M200 300 C 120 240 90 195 90 155 C 90 118 118 95 152 95 C 176 95 193 108 200 126 C 207 108 224 95 248 95 C 282 95 310 118 310 155 C 310 195 280 240 200 300Z" fill="#fff"/></svg>`,
      '', 'id="gcardLike"') +
    gcardHTML('音乐区热榜', 'B 站音乐区', coverSVG(5), '', 'id="gcardRank"') +
    customPlaylists.map((p, i) => gcardHTML(
      p.title, `${p.tracks.length} 首歌曲`,
      p.cover ? `<img src="${esc(p.cover)}" alt="">`
        : (p.tracks[0] ? covHTML(p.tracks[0], 400) : coverSVG(20 + (Number(p.id) % 12))),
      `<span class="pl-del" data-cpd="${i}" role="button" aria-label="删除歌单" title="删除歌单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>`,
      `data-cpi="${i}"`)).join('') +
    `<div class="gcard gcard-new" id="gcardNewPl">
      <div class="cover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div>
      <h4>新建歌单</h4><p>创建本地歌单</p></div>`;
  bindCoverLoading(grid);
  $('gridMyCount').textContent = `${2 + customPlaylists.length} 个`;
  $('gcardLike').addEventListener('click', () => openPlaylist(likesPlaylist()));
  $('gcardRank').addEventListener('click', () => openPlaylist(rankingPlaylist()));
  grid.querySelectorAll('[data-cpi]').forEach((el) =>
    el.addEventListener('click', () => {
      const p = customPlaylists[+el.dataset.cpi];
      if (p) openPlaylist(customPlaylistDetail(p));
    }));
  grid.querySelectorAll('[data-cpd]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlDialog('delete', +el.dataset.cpd);
    }));
  $('gcardNewPl').addEventListener('click', () => openPlDialog('create'));
}

/* ---------- 歌单库 ---------- */
let libraryLoadToken = 0;
let libraryLoaded = false;
let libraryLocalReady = false;
let libraryLoadPromise = null;
let recommendationLoading = false;
let recommendationUsesFeed = false;

const recommendationKey = (track) => track.bvid || `${track.title}:${track.up}`;
const recommendationMeta = (track) => track.recommendationReason || track.up || track.tname || '音乐';

function bindRecommendationCards() {
  $('grid-rec').querySelectorAll('.gcard:not([data-bound])').forEach((el) => {
    el.dataset.bound = 'true';
    el.addEventListener('click', () =>
      setQueue(state.recommendations, '为你推荐 · Bilibili', +el.dataset.ri));
  });
}

function renderRecommendationCards(reset = false, startIndex = 0) {
  const tracks = state.recommendations.slice(startIndex);
  const html = tracks.map((track, offset) =>
    gcardHTML(track.title, recommendationMeta(track), covHTML(track, 400), '',
      `data-ri="${startIndex + offset}"`)).join('');
  if (reset) $('grid-rec').innerHTML = html;
  else $('grid-rec').insertAdjacentHTML('beforeend', html);
  bindCoverLoading($('grid-rec'));
  bindRecommendationCards();
}

// Append only: late search pages must not rebuild visible cards or reset scroll.
function appendRecommendationBatch(batch, generation) {
  if (generation !== libraryLoadToken) return;
  const seen = new Set(state.recommendations.map(recommendationKey));
  const additions = batch.filter((track) => {
    const key = recommendationKey(track);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (!additions.length) return;
  const startIndex = state.recommendations.length;
  state.recommendations.push(...additions);
  renderRecommendationCards(startIndex === 0, startIndex);
}

async function loadMoreRecommendations() {
  if (recommendationLoading || !recommendationUsesFeed || !api.hasBridge) return;
  const generation = libraryLoadToken;
  recommendationLoading = true;
  const loader = $('recLoader');
  loader.classList.add('loading');
  loader.textContent = '正在加载更多推荐…';
  const freshIdx = state.recommendFreshIdx;
  state.recommendFreshIdx += 3;
  try {
    const strict = await recommendationProfiles.isStrict();
    const base = strict ? [] : await api.recommendMusic(freshIdx, 12, settings.recommendMode).catch(() => []);
    if (generation !== libraryLoadToken) return;
    if (!strict) recommendationProfiles.observeFeed(base);
    const suggested = await recommendationProfiles.recommend(freshIdx, state.recommendations.map((t) => t.bvid),
      strict ? (batch) => appendRecommendationBatch(batch, generation) : undefined);
    const incoming = strict ? suggested : window.BiuRecommendation.blend(base, suggested);
    if (generation !== libraryLoadToken) return;
    appendRecommendationBatch(incoming, generation);
    loader.textContent = '继续向下滚动加载更多';
  } catch (error) {
    if (generation !== libraryLoadToken) return;
    console.error('追加音乐推荐失败', error);
    loader.textContent = error.message || '加载失败，继续滚动重试';
    toast(loader.textContent);
  } finally {
    if (generation === libraryLoadToken) {
      recommendationLoading = false;
      loader.classList.remove('loading');
    }
  }
}

function initRecommendationInfiniteScroll() {
  const view = document.querySelector('.view-library');
  let frame = 0, idleTimer = 0;
  const finishScroll = () => {
    clearTimeout(idleTimer);
    view.classList.remove('is-scrolling');
  };
  const maybeLoad = () => {
    frame = 0;
    if (document.body.dataset.view !== 'library') return;
    if (view.scrollHeight - view.scrollTop - view.clientHeight < 520) loadMoreRecommendations();
  };
  view.addEventListener('scroll', () => {
    if (document.body.dataset.view !== 'library') return;
    if (!view.classList.contains('is-scrolling')) view.classList.add('is-scrolling');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(finishScroll, 160);
    // 同一帧的多个滚动事件只读一次布局尺寸。
    if (!frame) frame = requestAnimationFrame(maybeLoad);
  }, { passive: true });
  view.addEventListener('scrollend', finishScroll, { passive: true });
  // Short/empty result pages may have no scroll range; wheel input still advances.
  view.addEventListener('wheel', (event) => {
    if (event.deltaY > 0 && !frame) frame = requestAnimationFrame(maybeLoad);
  }, { passive: true });
}

async function loadLibrary({ force = false } = {}) {
  // 返回主页复用已有内容；首屏请求进行中时也不能清空卡片或重复请求。
  if (!force) {
    if (libraryLoadPromise) return libraryLoadPromise;
    if (libraryLoaded) return;
  }
  const loadToken = ++libraryLoadToken;
  if (force) {
    libraryLoaded = false;
    libraryLocalReady = false;
    state.recommendations = [];
    state.ranking = [];
    state.recommendFreshIdx = 0;
    libraryScrollTop = 0;
    document.querySelector('.view-library').scrollTop = 0;
  }
  // 本地歌单不依赖推荐请求成功；失败重试也不能重建这块区域。
  // 后续收藏、新建、编辑与删除各自更新卡片，不在页面导航时重新发布数据。
  if (!libraryLocalReady) {
    refreshLikeUI();
    renderMyPlaylists();
    libraryLocalReady = true;
  }
  const request = fetchLibrary(loadToken);
  libraryLoadPromise = request;
  try {
    return await request;
  } finally {
    if (libraryLoadPromise === request) libraryLoadPromise = null;
  }
}

async function fetchLibrary(loadToken) {
  recommendationLoading = false;
  recommendationUsesFeed = false;
  $('recLoader').classList.remove('loading');

  $('recSource').textContent = settings.recommendMode === 'all' ? 'B 站个性化推荐 · 全部分区' : 'B 站个性化推荐 · 音乐分区';
  $('recLoader').textContent = '正在准备推荐流…';
  $('grid-rec').innerHTML = '<div class="list-hint">正在获取你的推荐…</div>';
  const freshIdx = state.recommendFreshIdx;
  state.recommendFreshIdx += 3;
  let strict;
  try { strict = await recommendationProfiles.isStrict(); }
  catch {
    if (loadToken !== libraryLoadToken) return;
    $('grid-rec').innerHTML = '<div class="list-hint">画像读取失败，请在设置中重试</div>';
    $('recSource').textContent = '画像读取失败';
    $('recLoader').textContent = '请在设置中重新读取画像';
    return;
  }
  if (loadToken !== libraryLoadToken) return;
  const [rankingResult, recommendationResult] = await Promise.allSettled([
    strict ? Promise.resolve([]) : api.ranking(),
    strict ? Promise.resolve([]) : api.recommendMusic(freshIdx, 12, settings.recommendMode),
  ]);
  if (loadToken !== libraryLoadToken) return;

  if (rankingResult.status === 'fulfilled') {
    state.ranking = rankingResult.value;
  } else {
    console.error('音乐区排行加载失败', rankingResult.reason);
  }
  // Show platform recommendations while tag analysis is still running.
  const initialRecommendations = recommendationResult.status === 'fulfilled' && recommendationResult.value.length
    ? recommendationResult.value : state.ranking;
  if (!strict && initialRecommendations.length) {
    state.recommendations = initialRecommendations;
    renderRecommendationCards(true);
  }
  if (!strict && recommendationResult.status === 'fulfilled') recommendationProfiles.observeFeed(recommendationResult.value);
  if (strict) {
    recommendationLoading = true;
    $('recLoader').classList.add('loading');
    $('recSource').textContent = '自定义画像 · 严格匹配';
  }
  let suggested;
  try {
    suggested = await recommendationProfiles.recommend(freshIdx, [],
      strict ? (batch) => appendRecommendationBatch(batch, loadToken) : undefined);
  } catch (error) {
    if (loadToken !== libraryLoadToken) return;
    recommendationLoading = false;
    recommendationUsesFeed = strict;
    $('recLoader').classList.remove('loading');
    $('recLoader').textContent = error.message || '推荐加载失败，请稍后重试';
    $('grid-rec').innerHTML = `<div class="list-hint">${esc($('recLoader').textContent)}</div>`;
    $('recSource').textContent = '推荐暂不可用';
    return;
  }
  if (loadToken !== libraryLoadToken) return;
  const personalized = strict ? suggested : window.BiuRecommendation.blend(
    recommendationResult.status === 'fulfilled' ? recommendationResult.value : [],
    suggested,
  );
  if (recommendationResult.status === 'rejected') {
    console.error('个性化音乐推荐加载失败', recommendationResult.reason);
  }
  if (strict) {
    appendRecommendationBatch(suggested, loadToken);
    recommendationLoading = false;
    $('recLoader').classList.remove('loading');
  } else state.recommendations = personalized.length ? personalized : state.ranking;
  recommendationUsesFeed = strict || personalized.length > 0;
  const R = state.recommendations;
  if (!R.length) {
    const hint = strict ? '当前推荐范围暂无匹配此画像的视频，可继续加载或调整标签' : '推荐加载失败，请检查网络后重试';
    $('grid-rec').innerHTML = `<div class="list-hint">${hint}</div>`;
    $('recSource').textContent = strict ? '自定义画像 · 严格匹配' : '暂时无法连接 B 站';
    $('recLoader').textContent = strict ? '继续查找匹配视频（向下滚动）' : '暂无更多内容';
    libraryLoaded = strict;
    return;
  }

  $('recSource').textContent = strict ? '自定义画像 · 严格匹配' : personalized.length
    ? `个性化推荐 · ${settings.recommendMode === 'all' ? '全部分区' : '音乐分区'} · 兴趣画像` : '音乐区热榜兜底';
  // Strict batches have already been appended without rebuilding visible cards.
  if (!strict) renderRecommendationCards(true);
  libraryLoaded = true;
  $('recLoader').textContent = recommendationUsesFeed ? '向下滚动加载更多' : '当前显示音乐区热榜';
  // 卡带侧卡换上热榜真实封面；历史卡用最近播放封面（无记录时保留渐变占位）
  setShelfCover('cardRank', state.ranking[0]?.pic);
  setShelfCover('cardHistory', playHistory[0]?.pic);
}

/* ---------- 收藏夹 ---------- */
let favCache = { mid: null, folders: null };
let favLoadPromise = null;
let favLoadingMid = null;
let favLoadToken = 0;

function renderFavSignedOut(grid) {
  if (grid.dataset.state === 'signed-out') return;
  grid.dataset.state = 'signed-out';
  grid.removeAttribute('data-owner');
  grid.innerHTML = `<div class="empty-guide">
    <h3>同步你的 B 站收藏夹</h3>
    <p>使用哔哩哔哩客户端扫码，或通过 B 站官方手机验证码登录，<br>
    无需复制 Cookie，登录后会自动同步收藏夹。</p>
    <button class="btn-primary" onclick="showLogin('qr')">扫码登录</button>
  </div>`;
}

function renderFavFolders(grid, mid, folders) {
  const signature = folders.map((folder) => `${folder.id}:${folder.count}:${folder.title}`).join('|');
  if (grid.dataset.state === 'ready' && grid.dataset.owner === String(mid)
      && grid.dataset.signature === signature) return;
  grid.dataset.state = 'ready';
  grid.dataset.owner = String(mid);
  grid.dataset.signature = signature;
  grid.innerHTML = folders.map((f, i) =>
    gcardHTML(f.title, `${f.count} 个视频`, covHTML(f, 400), '', `data-fi="${i}"`)).join('');
  bindCoverLoading(grid);
  grid.querySelectorAll('.gcard').forEach((el) =>
    el.addEventListener('click', () => openFavFolder(folders[+el.dataset.fi])));
}

async function loadFav() {
  const grid = $('grid-fav');
  const auth = await ensureAuth();
  if (!auth.isLogin || !api.hasBridge) {
    favLoadToken += 1;
    favCache = { mid: null, folders: null };
    renderFavSignedOut(grid);
    return;
  }
  const mid = Number(auth.mid);
  if (favCache.mid === mid && favCache.folders) {
    renderFavFolders(grid, mid, favCache.folders);
    return;
  }
  // 已有页面内容时保持原样后台加载，避免“加载中”替换造成第二次闪烁。
  if (!grid.childElementCount) grid.innerHTML = '<div class="list-hint">收藏夹加载中…</div>';
  if (favLoadPromise && favLoadingMid === mid) return favLoadPromise;
  const token = ++favLoadToken;
  favLoadingMid = mid;
  const request = (async () => {
    try {
      const nav = await api.nav();
      if (!nav.isLogin || !nav.mid) throw new Error('登录已过期');
      const folders = await api.favFolders(nav.mid);
      if (token !== favLoadToken) return;
      favCache = { mid: Number(nav.mid), folders };
      renderFavFolders(grid, nav.mid, folders);
    } catch (e) {
      if (token !== favLoadToken) return;
      console.error(e);
      grid.dataset.state = 'error';
      grid.innerHTML = `<div class="empty-guide">
        <h3>收藏夹加载失败</h3><p>${esc(e.message || e)}<br>请重新扫码或使用验证码登录。</p>
        <button class="btn-primary" onclick="showLogin('qr')">重新登录</button>
      </div>`;
    }
  })();
  favLoadPromise = request;
  try {
    return await request;
  } finally {
    if (favLoadPromise === request) {
      favLoadPromise = null;
      favLoadingMid = null;
    }
  }
}
async function openFavFolder(folder) {
  const pl = {
    label: '收藏夹 · Bilibili',
    favId: folder.id,
    title: folder.title,
    desc: folder.intro || '来自 B 站收藏夹，与网页端实时同步。',
    meta: `${folder.count} 个视频`,
    // 与外部网格卡片保持同一张图：有真实封面用封面，否则同一 seed 的渐变占位
    cover: folder.cover ? { pic: folder.cover } : { seed: folder.seed },
    tracks: [],
  };
  openPlaylist(pl);
  $('list-playlist').innerHTML = '<div class="list-hint">加载中…</div>';
  try {
    pl.tracks = await api.favItems(folder.id);
    if (state.playlist === pl && document.body.dataset.view === 'playlist') openPlaylist(pl);
  } catch (e) {
    $('list-playlist').innerHTML = '<div class="list-hint">加载失败：' + esc(e.message || e) + '</div>';
  }
}

/* ---------- 电台：点击卡片即播放直播流，整个电台列表进入队列可连续切台 ---------- */
/* ---------- 电台：直播列表分页加载 + 关注主播头像行 ---------- */
let radioPage = 1;
let radioRooms = [];
let radioLoadingMore = false;
let radioHasMore = true;
let radioLoadedAt = 0;

const radioTrack = (room) => ({
  ...room,
  pic: room.cover,
  up: room.uname || '直播电台',
  duration: 0,
  isLive: true,
});

function radioCardHTML(room, index) {
  return gcardHTML(room.title, `${fmtNum(room.online)} 人在听`, covHTML(room, 400),
    '<span class="badge"><span class="live-dot"></span>LIVE</span>', `data-station="${index}"`);
}

function bindRadioCards(grid) {
  grid.querySelectorAll('.gcard:not([data-bound])').forEach((el) => {
    el.dataset.bound = 'true';
    el.addEventListener('click', () => setQueue(radioRooms, 'B 站直播电台', +el.dataset.station));
  });
}

async function loadMoreRadio() {
  if (radioLoadingMore || !radioHasMore || !api.hasBridge || !radioRooms.length) return;
  radioLoadingMore = true;
  const page = radioPage + 1;
  try {
    const incoming = (await api.rooms(page)).map(radioTrack)
      .filter((room) => room.roomid && !radioRooms.some((r) => r.roomid === room.roomid));
    if (!incoming.length) {
      radioHasMore = false;
      return;
    }
    radioPage = page;
    const start = radioRooms.length;
    radioRooms.push(...incoming);
    const grid = $('grid-radio');
    grid.insertAdjacentHTML('beforeend',
      incoming.map((room, offset) => radioCardHTML(room, start + offset)).join(''));
    bindCoverLoading(grid);
    bindRadioCards(grid);
  } catch (e) {
    console.error('加载更多电台失败', e);
  } finally {
    radioLoadingMore = false;
  }
}

// 关注的主播 · 正在直播：头像行，点击进入直播间
async function loadFollowedLives() {
  const sec = $('liveFollowsSec');
  if (!authState.isLogin || !api.hasBridge) { sec.hidden = true; return; }
  try {
    const rooms = (await api.followedLives()).map(radioTrack);
    if (!rooms.length) { sec.hidden = true; return; }
    sec.hidden = false;
    $('liveFollows').innerHTML = rooms.map((room, i) => `
      <div class="lf-item" data-lfi="${i}" title="${esc(room.title)}">
        <span class="lf-ava">${room.face
          ? `<img src="${esc(room.face)}" alt="" loading="lazy">`
          : coverSVG(30 + i * 2)}<i></i></span>
        <span class="lf-name">${esc(room.up)}</span>
      </div>`).join('');
    $('liveFollows').querySelectorAll('.lf-item').forEach((el) =>
      el.addEventListener('click', () => setQueue(rooms, '关注的主播 · 直播中', +el.dataset.lfi)));
  } catch (e) {
    console.error('关注主播直播列表加载失败', e);
    sec.hidden = true;
  }
}

async function loadRadio() {
  const grid = $('grid-radio');
  // 60 秒内已加载过：保留现有列表与封面缓存，来回切换/滚动不再整表重拉
  if (radioRooms.length && Date.now() - radioLoadedAt < 60000) {
    loadFollowedLives();
    return;
  }
  grid.innerHTML = '<div class="list-hint">正在连接 B 站直播电台…</div>';
  radioPage = 1;
  radioRooms = [];
  radioHasMore = true;
  loadFollowedLives(); // 不阻塞电台列表
  try {
    const rooms = (await api.rooms(1)).map(radioTrack);
    if (!rooms.length) throw new Error('当前电台分区暂无开播房间');
    radioRooms = rooms;
    radioLoadedAt = Date.now();
    grid.innerHTML = rooms.map((room, i) => radioCardHTML(room, i)).join('');
    bindCoverLoading(grid);
    bindRadioCards(grid);
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div class="list-hint">电台加载失败：${esc(e.message || e)}</div>`;
  }
}

function initRadioInfiniteScroll() {
  const view = document.querySelector('.view-radio');
  view.addEventListener('scroll', () => {
    if (document.body.dataset.view !== 'radio') return;
    if (view.scrollHeight - view.scrollTop - view.clientHeight < 480) loadMoreRadio();
  }, { passive: true });
}

/* ---------- 搜索 ---------- */
/* ---------- 搜索：仅返回 UP 主 + 相关视频，支持排序 / 时长筛选 / 翻页 ---------- */
let searchKw = '';
let searchOrder = '';   // '' 综合 / click 播放 / pubdate 最新 / dm 弹幕 / stow 收藏
let searchDuration = 0; // 0 全部 / 1 <10min / 2 10-30 / 3 30-60 / 4 60+
let searchPage = 1;
let searchNumPages = 1;

function renderSearchPager() {
  const pager = $('spPager');
  const hasKw = Boolean(searchKw);
  pager.hidden = !hasKw;
  $('spPageLabel').textContent = `${searchPage} / ${searchNumPages}`;
  $('spPrev').disabled = searchPage <= 1;
  $('spNext').disabled = searchPage >= searchNumPages;
}

function scrollSearchTop() {
  const view = document.querySelector('.view-search');
  if (view) view.scrollTo({ top: 0, behavior: 'smooth' });
}

async function doSearch(kw, page = 1) {
  if (kw !== undefined) searchKw = (kw || '').trim();
  if (!searchKw) { $('spPager').hidden = true; return; }
  searchPage = page;
  $('vgrid').innerHTML = '<div class="list-hint">搜索中…</div>';
  $('ups').innerHTML = '';
  renderSearchPager();
  // UP 主按名字匹配（与视频搜索并行，不阻塞视频结果）
  if (page === 1) {
    api.searchUps(searchKw)
      .then((r) => renderUps(r.list))
      .catch(() => { $('ups').innerHTML = '<div class="list-hint">UP 主搜索失败</div>'; });
  }
  try {
    const res = await api.search(searchKw, searchOrder, searchDuration, searchPage);
    const results = res.list;
    searchNumPages = Math.max(1, res.numPages || 1);
    if (res.page) searchPage = res.page;
    // 相关视频卡片
    $('vgrid').innerHTML = results.length ? results.map((t, i) =>
      `<div class="vcard" data-vi="${i}"><div class="vth">${covHTML(t, 320)}<span class="dur-b num">${fmt(t.duration)}</span></div>
       <h4>${esc(t.title)}</h4><p>${esc(t.up)}</p></div>`).join('')
      : '<div class="list-hint">没有找到相关视频</div>';
    $('vgrid').querySelectorAll('.vcard').forEach((el) =>
      el.addEventListener('click', () => setQueue(results, '搜索 · ' + searchKw, +el.dataset.vi)));
    renderSearchPager();
  } catch (e) {
    console.error(e);
    $('vgrid').innerHTML = '<div class="list-hint">搜索失败：' + esc(e.message || e) + '</div>';
    renderSearchPager();
  }
}

/* ---------- UP 主：横向滚动列表 / 关注 / 主页 ---------- */
function fmtFans(n) {
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n);
}

function setFollowBtn(btn, on) {
  btn.classList.toggle('on', on);
  btn.textContent = on ? '已关注' : '+ 关注';
}

async function toggleFollow(mid, btn) {
  const next = !btn.classList.contains('on');
  btn.disabled = true;
  try {
    await api.followUp(mid, next);
    // 同步搜索页与 UP 主页上所有指向该 mid 的关注按钮
    document.querySelectorAll(`[data-fol="${mid}"]`).forEach((b) => setFollowBtn(b, next));
    toast(next ? '已关注' : '已取消关注');
  } catch (e) {
    toast(e.message || '关注操作失败');
  } finally {
    btn.disabled = false;
  }
}

// 搜索页 UP 主：按关键词直接匹配用户；横向滚动，点击进主页，按钮关注/取关
function renderUps(list) {
  const box = $('ups');
  if (!list.length) { box.innerHTML = '<div class="list-hint">没有匹配的 UP 主</div>'; return; }
  box.innerHTML = list.map((u, i) =>
    `<div class="up-card" data-mid="${u.mid}">
      <span class="ava">${u.pic ? `<img src="${esc(u.pic)}" loading="lazy" alt="">` : coverSVG(70 + i * 3)}</span>
      <span class="up-meta"><b>${esc(u.name)}</b><small>${fmtFans(u.fans)} 粉丝 · ${u.videos} 视频</small></span>
      <button type="button" class="fol" data-fol="${u.mid}">+ 关注</button>
    </div>`).join('');
  box.querySelectorAll('.up-card').forEach((el) =>
    el.addEventListener('click', () => openUpPage(+el.dataset.mid)));
  box.querySelectorAll('.fol').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFollow(+btn.dataset.fol, btn); }));
  // 已关注状态异步回填（未登录时全部为「+ 关注」）
  list.forEach((u) => {
    api.upRelation(u.mid).then((attr) => {
      const btn = box.querySelector(`[data-fol="${u.mid}"]`);
      if (btn && (attr === 2 || attr === 6)) setFollowBtn(btn, true);
    }).catch(() => {});
  });
}

/* ---------- UP 主主页 ---------- */
let upPageMid = 0;
let upPageName = '';
let upTab = 'video';
let upVideoPage = 1;
let upVideoTotal = 0;
let upVideoList = [];
let upDynOffset = '';
let upDynHasMore = false;
let upLoadingMore = false;

async function openUpPage(mid) {
  if (!mid) return;
  upPageMid = mid;
  upTab = 'video';
  upVideoPage = 1;
  upVideoTotal = 0;
  upVideoList = [];
  upDynOffset = '';
  upDynHasMore = false;
  go('up');
  $('upName').textContent = '加载中…';
  $('upSign').textContent = '';
  $('upStat').textContent = '';
  $('upFace').innerHTML = '';
  $('upVideos').innerHTML = '<div class="list-hint">加载中…</div>';
  $('upDyns').innerHTML = '';
  $('upDyns').hidden = true;
  $('upVideos').hidden = false;
  $('upMoreWrap').hidden = true;
  $('upTabs').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.dataset.utab === 'video'));
  const folBtn = $('upFol');
  folBtn.dataset.fol = mid;
  setFollowBtn(folBtn, false);
  try {
    const [info, stat, attr] = await Promise.all([
      api.upInfo(mid), api.upStat(mid), api.upRelation(mid),
    ]);
    if (upPageMid !== mid) return;
    upPageName = (info && info.name) || `UID ${mid}`;
    $('upName').textContent = upPageName;
    $('upSign').textContent = (info && info.sign) || '';
    $('upStat').textContent = `${fmtFans(stat.fans)} 粉丝 · ${stat.following} 关注`;
    $('upFace').innerHTML = info && info.face
      ? `<img src="${esc(info.face)}" alt="">` : coverSVG(70);
    setFollowBtn(folBtn, attr === 2 || attr === 6);
  } catch (e) {
    if (upPageMid === mid) $('upName').textContent = `UID ${mid}`;
  }
  loadUpVideos(mid, 1, false);
}

async function loadUpVideos(mid, page, append) {
  try {
    const r = await api.upVideos(mid, page);
    if (upPageMid !== mid) return;
    upVideoList = append ? upVideoList.concat(r.list) : r.list;
    upVideoTotal = r.total;
    upVideoPage = page;
    const box = $('upVideos');
    box.innerHTML = upVideoList.length ? upVideoList.map((t, i) =>
      `<div class="vcard" data-vi="${i}"><div class="vth">${covHTML(t, 320)}<span class="dur-b num">${fmt(t.duration)}</span></div>
       <h4>${esc(t.title)}</h4><p>${esc(t.up)}</p></div>`).join('')
      : '<div class="list-hint">TA 还没有投稿视频</div>';
    box.querySelectorAll('.vcard').forEach((el) =>
      el.addEventListener('click', () => setQueue(upVideoList, 'UP · ' + upPageName, +el.dataset.vi)));
    $('upMoreWrap').hidden = upTab !== 'video' || upVideoList.length >= upVideoTotal;
  } catch (e) {
    if (!append && upPageMid === mid)
      $('upVideos').innerHTML = '<div class="list-hint">视频加载失败：' + esc(e.message || e) + '</div>';
  }
}

function renderUpDyns(list, append) {
  const box = $('upDyns');
  const html = list.map((d) => {
    const picHtml = d.kind === 'video' && d.pic
      ? `<div class="dyn-th">${`<img src="${esc(d.pic)}" loading="lazy" alt="">`}<span class="dur-b num">视频</span></div>`
      : (d.pic ? `<div class="dyn-pic"><img src="${esc(d.pic)}" loading="lazy" alt=""></div>` : '');
    return `<div class="dyn-card${d.bvid ? ' dyn-video' : ''}"${d.bvid ? ` data-bvid="${esc(d.bvid)}"` : ''}>
      <div class="dyn-body">
        ${d.title ? `<b>${esc(d.title)}</b>` : ''}
        ${d.text ? `<p>${esc(d.text)}</p>` : ''}
        <small>${esc(d.time)}</small>
      </div>${picHtml}</div>`;
  }).join('');
  if (append) box.insertAdjacentHTML('beforeend', html);
  else box.innerHTML = html || '<div class="list-hint">暂无动态</div>';
  // 视频动态：点击直接播放
  box.querySelectorAll('.dyn-video:not([data-bound])').forEach((el) => {
    el.dataset.bound = '1';
    el.addEventListener('click', async () => {
      try {
        const v = await api.view(el.dataset.bvid);
        if (!v) return;
        setQueue([{
          bvid: v.bvid, aid: v.aid, cid: v.cid, title: v.title,
          up: (v.owner && v.owner.name) || '', duration: v.duration || 0,
          pic: v.pic ? v.pic.replace(/^http:/, 'https:') : null,
        }], 'UP 动态 · ' + upPageName, 0);
      } catch (e) { toast('视频加载失败'); }
    });
  });
}

async function loadUpDyns(mid, append) {
  try {
    const r = await api.upDynamics(mid, append ? upDynOffset : '');
    if (upPageMid !== mid) return;
    upDynOffset = r.offset;
    upDynHasMore = r.hasMore;
    renderUpDyns(r.list, append);
    $('upMoreWrap').hidden = upTab !== 'dyn' || !upDynHasMore;
  } catch (e) {
    if (!append && upPageMid === mid)
      $('upDyns').innerHTML = '<div class="list-hint">动态加载失败：' + esc(e.message || e) + '</div>';
  }
}

// 补齐 aid：点赞/投币/收藏都需要；分切曲目等可能只有 bvid
async function ensureAid(t) {
  if (!t || t.aid || !t.bvid || !api.hasBridge) return t && t.aid;
  try {
    const d = await api.view(t.bvid);
    if (state.current === t) t.aid = d.aid;
  } catch (e) { /* 保持无 aid，调用方报错 */ }
  return t.aid;
}

// 原视频页操作：关注 UP / 进 UP 主页 / 点赞 / 投币 / 收藏（复用收藏夹弹层）
function initVideoActions() {
  const fol = $('vUpFol');
  fol.addEventListener('click', (e) => {
    e.stopPropagation();
    if (fol.dataset.fol) toggleFollow(+fol.dataset.fol, fol);
  });
  const gotoUp = () => {
    const mid = +(fol.dataset.fol || 0);
    if (mid) openUpPage(mid);
  };
  $('vUpAva').addEventListener('click', gotoUp);
  $('vUpName').addEventListener('click', gotoUp);
  $('vsLikeBtn').addEventListener('click', async () => {
    const t = state.current;
    if (!t || t.isLive || !api.hasBridge) return;
    const btn = $('vsLikeBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const aid = await ensureAid(t);
      if (!aid) throw new Error('无法获取稿件信息');
      const on = !btn.classList.contains('on');
      await api.likeVideo(aid, on);
      btn.classList.toggle('on', on);
      const cur = $('vsLike').textContent;
      if (/^\d+$/.test(cur)) $('vsLike').textContent = String(Math.max(0, +cur + (on ? 1 : -1)));
      toast(on ? '已点赞' : '已取消点赞');
    } catch (e) { toast(e.message || '点赞失败'); }
    finally { btn.disabled = false; }
  });
  // 投币：点击投 1 枚，长按（约 0.5s）投 2 枚；成功后硬币飞起动画
  const coinBtn = $('vsCoinBtn');
  let coinHoldTimer = 0;
  let coinHeld = false; // 长按已触发，抑制随后的 click
  const coinFly = (n) => {
    const src = coinBtn.querySelector('svg');
    if (!src) return;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = 'coin-fly';
      c.style.animationDelay = `${i * 150}ms`;
      c.appendChild(src.cloneNode(true));
      coinBtn.appendChild(c);
      setTimeout(() => c.remove(), 1250 + i * 150);
    }
  };
  const doCoin = async (n) => {
    const t = state.current;
    if (!t || t.isLive || !api.hasBridge) return;
    if (coinBtn.disabled) return;
    if (coinBtn.classList.contains('on')) { toast('已投过币'); return; }
    coinBtn.disabled = true;
    try {
      const aid = await ensureAid(t);
      if (!aid) throw new Error('无法获取稿件信息');
      await api.coinVideo(aid, n);
      coinBtn.classList.add('on');
      const cur = $('vsCoin').textContent;
      if (/^\d+$/.test(cur)) $('vsCoin').textContent = String(+cur + n);
      coinFly(n);
      toast(n > 1 ? '投币成功 +2' : '投币成功 +1');
    } catch (e) { toast(e.message || '投币失败'); }
    finally { coinBtn.disabled = false; }
  };
  coinBtn.addEventListener('click', () => {
    if (coinHeld) { coinHeld = false; return; }
    doCoin(1);
  });
  coinBtn.addEventListener('pointerdown', () => {
    if (coinBtn.disabled || coinBtn.classList.contains('on')) return;
    coinBtn.classList.add('holding');
    coinHoldTimer = setTimeout(() => { coinHeld = true; doCoin(2); }, 520);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
    coinBtn.addEventListener(ev, () => {
      clearTimeout(coinHoldTimer);
      coinBtn.classList.remove('holding');
    }));
  $('vsFavBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (favPopOpen) closeFavPop();
    else openFavPop($('vsFavBtn'));
  });
}

function initUpPage() {
  $('upFol').addEventListener('click', (e) => {
    e.stopPropagation();
    if (upPageMid) toggleFollow(upPageMid, $('upFol'));
  });
  $('upTabs').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.utab === upTab) return;
      upTab = b.dataset.utab;
      $('upTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('upVideos').hidden = upTab !== 'video';
      $('upDyns').hidden = upTab !== 'dyn';
      if (upTab === 'video') {
        $('upMoreWrap').hidden = !upVideoList.length || upVideoList.length >= upVideoTotal;
      } else {
        if (!$('upDyns').children.length) loadUpDyns(upPageMid, false);
        else $('upMoreWrap').hidden = !upDynHasMore;
      }
    }));
  $('upMore').addEventListener('click', async () => {
    if (upLoadingMore) return;
    upLoadingMore = true;
    try {
      if (upTab === 'video') await loadUpVideos(upPageMid, upVideoPage + 1, true);
      else await loadUpDyns(upPageMid, true);
    } finally { upLoadingMore = false; }
  });
}

/* ---------- 设置项接线（全部真实生效） ---------- */
function renderLanSync(status = {}) {
  const toggle = $('swLanSync');
  toggle.classList.toggle('off', status.enabled === false);
  toggle.setAttribute('aria-checked', String(status.enabled !== false));
  $('lanSyncStatus').textContent = status.error || (status.enabled === false ? '自动同步已关闭'
    : !status.signedIn ? '登录后自动连接同一 Wi-Fi 内的同账号设备'
    : status.connected && status.lastSync ? `已同步 · ${status.counts.likes} 首喜欢 · ${status.counts.playlists} 个歌单 · ${status.counts.profiles || 0} 份画像`
    : '正在等待同一 Wi-Fi 内的同账号设备，打开手机 App 即可同步');
}
async function setLanSyncEnabled(enabled) {
  try { renderLanSync(await window.bili?.lanSyncConfigure?.(dataNs, enabled)); }
  catch (e) { $('lanSyncStatus').textContent = e.message || '同步设置保存失败'; }
}
function initLanSync() {
  $('swLanSync').addEventListener('click', async () => {
    const toggle = $('swLanSync'); toggle.disabled = true;
    try { await setLanSyncEnabled(toggle.getAttribute('aria-checked') !== 'true'); }
    finally { toggle.disabled = false; }
  });
  window.bili?.onLanSyncStatus?.(renderLanSync);
  window.bili?.onLanSyncLibrary?.(({ scope, library, base }) => {
    if (scope !== dataNs) return;
    const merged = BiuLibrarySync.reconcile(base, { version: 1, likes, playlists: customPlaylists }, library);
    likes = merged.likes; customPlaylists = merged.playlists;
    saveLikes(); saveCustomPlaylists(); refreshLikeUI(); renderMyPlaylists(); renderFavButtons();
    const current = customPlaylists.find((p) => p.id === state.playlist?.customId);
    if (current && document.body.dataset.view === 'playlist') openPlaylist(customPlaylistDetail(current));
  });
  window.bili?.lanSyncConfigure?.(dataNs).then(renderLanSync).catch(() => {});
}
function initSettings() {
  initLanSync();
  window.BiuVideoCloud?.mount($('videoCloudSettings'));
  window.BiuAppUpdates?.mount($('appUpdateSettings'));
  const segRecommend = $('segRecommendMode');
  const updateRecommendMode = () => [...segRecommend.children].forEach((button) => {
    const selected = button.dataset.mode === settings.recommendMode;
    button.classList.toggle('on', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  updateRecommendMode();
  [...segRecommend.children].forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    if (!['music', 'all'].includes(mode) || settings.recommendMode === mode) return;
    settings.recommendMode = mode;
    store.set('biu-recommend-mode', mode);
    updateRecommendMode();
    loadLibrary({ force: true }).catch((error) => toast(error.message || '推荐加载失败'));
  }));
  // 在线音质：立即作用于当前曲目（断点续播）
  const segQ = $('segQuality');
  [...segQ.children].forEach((b) => {
    b.classList.toggle('on', +b.dataset.q === settings.quality);
    b.addEventListener('click', async () => {
      settings.quality = +b.dataset.q;
      store.set('biu-quality', settings.quality);
      [...segQ.children].forEach((x) => x.classList.toggle('on', x === b));
      toast('在线音质 · ' + b.textContent);
      const t = state.current;
      if (t && !t.isLive && t.bvid && t.cid && api.hasBridge) {
        const pos = audio.currentTime;
        const wasPlaying = !audio.paused;
        try {
          const url = await api.playUrl(t.bvid, t.cid, settings.quality);
          if (state.current !== t) return;
          audio.src = url;
          audio.dataset.bvid = t.bvid;
          audio.dataset.quality = String(settings.quality);
          audio.currentTime = pos;
          if (wasPlaying) await audio.play();
        } catch (e) {
          toast('该音质不可用' + (settings.quality === 2 ? '（无损需登录/大会员）' : ''));
        }
      }
    });
  });

  // 视频清晰度：全局默认档位；立即作用于当前曲目（重新请求原视频流，保留进度与播放状态）
  const segV = $('segVQuality');
  [...segV.children].forEach((b) => {
    b.classList.toggle('on', +b.dataset.vq === settings.vq);
    b.addEventListener('click', () => {
      settings.vq = +b.dataset.vq;
      store.set('biu-vquality', settings.vq);
      [...segV.children].forEach((x) => x.classList.toggle('on', x === b));
      toast('视频清晰度 · ' + videoQualityLabel(settings.vq));
      if (document.body.classList.contains('video-on')) {
        setVideoMode(true, true);
        return;
      }
      // 非视频模式：作废按旧档位预热的视频，按新默认重新预热，否则进入视频模式仍沿用旧清晰度
      const t = state.current;
      if (t && !t.isLive && video.dataset.bvid === t.bvid
          && Number(video.dataset.actualQuality) !== settings.vq) {
        video.dataset.ready = 'false';
        video.removeAttribute('data-actual-quality');
        videoPreparePromise = null;
        videoPrepareKey = '';
        scheduleVideoWarmup(t);
      }
    });
  });

  // 弹幕开关
  const swDm = $('swDanmaku');
  swDm.classList.toggle('off', !settings.danmaku);
  $('danmakuLayer').classList.toggle('off', !settings.danmaku);
  swDm.addEventListener('click', () => {
    settings.danmaku = settings.danmaku ? 0 : 1;
    store.set('biu-danmaku', settings.danmaku);
    swDm.classList.toggle('off', !settings.danmaku);
    $('danmakuLayer').classList.toggle('off', !settings.danmaku);
    if (!settings.danmaku) { danmakuItems = []; resetDanmaku(); }
    else if (state.current && videoModeOn()) loadDanmaku(state.current, videoLoadToken);
  });

  // 同步观看记录到 B 站历史开关
  const swSyncHis = $('swSyncHistory');
  swSyncHis.classList.toggle('off', !settings.syncHistory);
  swSyncHis.addEventListener('click', () => {
    settings.syncHistory = settings.syncHistory ? 0 : 1;
    store.set('biu-sync-history', settings.syncHistory);
    swSyncHis.classList.toggle('off', !settings.syncHistory);
    if (settings.syncHistory && !authState.isLogin) toast('未登录：记录会在登录后才开始同步');
  });

  document.documentElement.style.setProperty('--bg-blur', settings.blur + 'px');

  // 桌面歌词（仅 Electron）
  const swLyr = $('swLyric');
  const syncLyrUI = () => swLyr.classList.toggle('off', !deskLyricOn);
  syncLyrUI();
  swLyr.addEventListener('click', () => {
    if (!api.hasBridge) { toast('桌面歌词仅在客户端中可用'); return; }
    deskLyricOn = !deskLyricOn;
    store.set('biu-desklyric', deskLyricOn ? 1 : 0);
    window.bili.lyricToggle(deskLyricOn);
    syncLyrUI();
    if (deskLyricOn) syncLyric(true);
  });
  if (api.hasBridge) {
    window.bili.onLyricClosed(() => {
      deskLyricOn = false;
      store.set('biu-desklyric', 0);
      syncLyrUI();
    });
    if (deskLyricOn) window.bili.lyricToggle(true); // 恢复上次开启状态
  }

}

/* ---------- 初始化 ---------- */
function init() {
  // 顶栏导航 / 快捷键（沿用设计稿）
  document.querySelectorAll('#mainNav button').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.v)));
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const map = { 1: 'library', 2: 'playing', 3: 'playlist', 4: 'search' };
    if (map[e.key]) go(map[e.key]);
    if (e.key === 'Escape') {
      if (document.body.classList.contains('video-theater')) setVideoTheater(false);
      else { closePanel(); hideQrLogin(); }
    }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    const media = activeMedia();
    if (e.key === 'ArrowRight' && isFinite(media.duration)) media.currentTime = Math.min(media.duration, media.currentTime + 5);
    if (e.key === 'ArrowLeft' && isFinite(media.duration)) media.currentTime = Math.max(0, media.currentTime - 5);
    if (e.key === 'ArrowUp') { e.preventDefault(); setVolume(audio.volume + 0.05); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setVolume(audio.volume - 0.05); }
  });

  // 卡带与歌单入口
  initShelfCarousel();
  initRecommendationInfiniteScroll();
  initRadioInfiniteScroll();
  bindLyricScrolling();
  $('btnPlayAll').addEventListener('click', () => {
    if (state.playlist && state.playlist.tracks.length) setQueue(state.playlist.tracks, state.playlist.title, 0);
  });
  $('btnPlShuffle').addEventListener('click', () => {
    if (!state.playlist || !state.playlist.tracks.length) return;
    const shuffled = [...state.playlist.tracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, state.playlist.title, 0);
  });

  // 迷你播放器：封面 → 播放页；三个运输控制
  $('mcArtHolder').addEventListener('click', () => go('playing'));
  $('btnPrev').addEventListener('click', prev);
  $('btnNext').addEventListener('click', next);
  $('btnToggle').addEventListener('click', togglePlay);
  $('ppToggle').addEventListener('click', togglePlay);
  $('ppPrev').addEventListener('click', prev);
  // 移动端迷你播放条：喜欢钮 / 封面点开播放页（桌面端这两个元素隐藏）
  $('ppLike').addEventListener('click', () => {
    if (!state.current) return;
    toggleLike(state.current);
    renderFavButtons();
  });
  $('ppCover').addEventListener('click', () => { if (state.current) go('playing'); });
  $('ppNext').addEventListener('click', next);
  $('liveToggle').addEventListener('click', togglePlay);
  $('liveDmToggle').addEventListener('click', () => {
    liveDmOn = !liveDmOn;
    store.set('biu-livedm', liveDmOn ? 1 : 0);
    syncLiveButtons();
    if (liveDmOn && state.current && state.current.isLive) startLiveDanmaku(state.current.roomid);
    else stopLiveDanmaku();
  });
  $('liveTheater').addEventListener('click', () =>
    setLiveTheater(!document.body.classList.contains('live-theater')));
  $('liveFs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if ($('liveStage').requestFullscreen) {
      $('liveStage').requestFullscreen().catch(() => toast('当前环境不支持全屏'));
    }
  });
  document.addEventListener('fullscreenchange', syncLiveButtons);
  syncLiveButtons();
  liveVideo.addEventListener('click', togglePlay);
  $('ppMode').addEventListener('click', cyclePlayMode);
  // 收藏：我喜欢（本地 biu-likes，与列表心形同源）/ B 站收藏夹弹层
  $('btnLike').addEventListener('click', () => {
    const t = state.current;
    if (!(t && t.bvid)) return toast('当前曲目不支持收藏');
    toggleLike(t);
    renderFavButtons();
  });
  $('btnFav').addEventListener('click', (event) => {
    event.stopPropagation();
    if (favPopOpen) closeFavPop();
    else openFavPop();
  });
  $('btnAddPl').addEventListener('click', (event) => {
    event.stopPropagation();
    if (plPopOpen) closePlPop();
    else openPlPop();
  });
  document.addEventListener('click', (event) => {
    if (favPopOpen && !event.target.closest('.np-actions') && !event.target.closest('.fav-pop')) closeFavPop();
    if (plPopOpen && !event.target.closest('.np-actions') && !event.target.closest('#plPop')) closePlPop();
    // 匹配候选下拉：点到下拉和触发按钮以外的地方就关
    if (splitPopFor >= 0 && !event.target.closest('.split-pop') && !event.target.closest('.split-pick')) closeSplitPop();
  });
  // 弹层内滚轮事件就地消化，不穿透到下层（歌词区等）的滚轮处理
  $('favPop').addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  $('plPop').addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && favPopOpen) closeFavPop();
    if (event.key === 'Escape' && plPopOpen) closePlPop();
    if (event.key === 'Escape' && splitPopFor >= 0) { closeSplitPop(); return; }
    if (event.key === 'Escape' && !$('splitMask').hidden) closeSplitPanel();
  });
  window.addEventListener('resize', () => { if (favPopOpen) closeFavPop(); if (plPopOpen) closePlPop(); });

  // MixSplitR 分切面板
  $('btnSplit').addEventListener('click', (event) => { event.stopPropagation(); openSplitPanel(); });
  // 下载原视频：点击弹出清晰度菜单（复用 vqual-item 样式），选择后主进程保存对话框 + 流式下载
  const dlMenu = $('dlMenu');
  const closeDlMenu = () => { dlMenu.hidden = true; $('btnDownload').setAttribute('aria-expanded', 'false'); };
  let dlBusy = false;
  $('btnDownload').addEventListener('click', async (event) => {
    event.stopPropagation();
    const t = state.current;
    if (!t || t.isLive || !t.bvid || !api.hasBridge) { toast('当前曲目不支持下载'); return; }
    if (!dlMenu.hidden) { closeDlMenu(); return; }
    dlMenu.innerHTML = '<div class="vqual-hint">正在获取可下载清晰度…</div>';
    const rect = $('btnDownload').getBoundingClientRect();
    dlMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 168))}px`;
    dlMenu.style.top = `${rect.bottom + 8}px`;
    dlMenu.hidden = false;
    $('btnDownload').setAttribute('aria-expanded', 'true');
    try {
      const info = await api.videoDownloadInfo(t.bvid, t.cid);
      if (state.current !== t) { closeDlMenu(); return; }
      const options = info.qualities && info.qualities.length
        ? info.qualities
        : [{ quality: info.quality, label: info.label }];
      dlMenu.innerHTML = options.map((item) => {
        const { main, sub } = splitQualityLabel(item.label);
        return `<button type="button" class="vqual-item" data-vq="${item.quality}">`
          + `<b>${esc(main)}</b>` + (sub ? `<small>${esc(sub)}</small>` : '') + '</button>';
      }).join('');
    } catch (error) {
      closeDlMenu();
      toast('获取下载清晰度失败：' + (error.message || error));
    }
  });
  dlMenu.addEventListener('click', async (event) => {
    const item = event.target.closest('.vqual-item');
    if (!item || dlBusy) return;
    closeDlMenu();
    const t = state.current;
    if (!t || !t.bvid) return;
    dlBusy = true;
    toast('正在准备下载…');
    try {
      const info = await api.videoDownloadInfo(t.bvid, t.cid, +item.dataset.vq);
      const safeTitle = String(t.title || t.bvid).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      const filename = `${safeTitle} - ${videoQualityLabel(info.quality)}.${info.format}`;
      const r = await window.bili.downloadStart({ url: info.url, filename });
      if (r && r.ok) toast('下载完成');
      else if (r && !r.canceled) toast('下载失败：' + (r.message || '未知错误'));
    } catch (error) {
      toast('下载失败：' + (error.message || error));
    } finally {
      dlBusy = false;
    }
  });
  document.addEventListener('click', (event) => {
    if (!dlMenu.hidden && !event.target.closest('#dlMenu') && event.target.closest('#btnDownload') === null) closeDlMenu();
  });

  // 手动匹配歌词 / 歌词偏移面板
  $('btnLyricMatch').addEventListener('click', (event) => { event.stopPropagation(); openLyricMatch(); });
  $('lyricMatchGo').addEventListener('click', runLyricMatchSearch);
  $('lyricMatchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runLyricMatchSearch();
  });
  $('lyricOffDown').addEventListener('click', () => setLyricOffset(lyricMatchTrack, lyricOffsetOf(lyricMatchTrack) - 0.5));
  $('lyricOffUp').addEventListener('click', () => setLyricOffset(lyricMatchTrack, lyricOffsetOf(lyricMatchTrack) + 0.5));
  $('lyricOffReset').addEventListener('click', () => setLyricOffset(lyricMatchTrack, 0));
  $('lyricClose').addEventListener('click', closeLyricMatch);
  $('lyricAuto').addEventListener('click', () => {
    const t = lyricMatchTrack;
    if (t) {
      delete t.lyricRef; // 清掉手动匹配，恢复自动链路（搜词 / AI 字幕）
      if (state.current === t) loadLyrics(t);
      toast('已恢复自动歌词');
    }
    closeLyricMatch();
  });
  $('lyricMask').addEventListener('click', (event) => {
    if (event.target === $('lyricMask')) closeLyricMatch();
  });
  // 下载进度：每 4MB 主进程推一次，百分比写进 toast
  let dlLastPct = -1;
  window.bili && window.bili.onDownloadProgress && window.bili.onDownloadProgress(({ got, total }) => {
    if (!total) return;
    const pct = Math.floor((got / total) * 100);
    if (pct !== dlLastPct) { dlLastPct = pct; toast(`下载中 ${pct}%`); }
  });
  $('splitCancel').addEventListener('click', closeSplitPanel);
  $('splitMask').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSplitPanel(); });
  $('splitAdd').addEventListener('click', () => {
    const last = splitSegments[splitSegments.length - 1];
    const from = last ? last.to : 0;
    splitSegments.push({ from, to: from + 180, name: '', match: null, matching: false });
    renderSplitList();
    const rows = $('splitList').querySelectorAll('.split-row');
    const nameInput = rows[rows.length - 1] && rows[rows.length - 1].querySelector('.split-name');
    if (nameInput) nameInput.focus();
  });
  $('splitImport').addEventListener('click', () => $('splitFile').click());
  // 分割方式分段控件：单选切换（Transition / 静音间隙 / 等间隔）
  $('splitModeSeg').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      $('splitModeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
  });

  // 本地智能分析：下载音频 → 按所选分割方式（Transition / 静音间隙 / 等间隔）检测，进度写进面板提示与日志
  $('splitAnalyze').addEventListener('click', async () => {
    const t = splitSource;
    if (!t || splitAnalyzing) return;
    splitAnalyzing = true;
    const btn = $('splitAnalyze');
    btn.disabled = true;
    const onModeBtn = $('splitModeSeg') && $('splitModeSeg').querySelector('button.on');
    const mode = (onModeBtn && onModeBtn.dataset.sm) || 'transition';
    const modeName = { transition: 'Transition（能量跃迁）', silence: '静音间隙', interval: '等间隔 180s' }[mode] || mode;
    $('splitHint').textContent = '正在获取音频流…';
    splitLog(`开始智能分析，分割方式：${modeName}`);
    try {
      const result = await api.splitAnalyzeAudio(t.bvid, t.cid, t.duration, (phase, p) => {
        if (splitSource !== t || $('splitMask').hidden) return;
        $('splitHint').textContent = phase === 'download'
          ? `正在下载音频用于本地分析… ${Math.round(p * 100)}%`
          : phase === 'decode' ? '正在解码音频…' : '正在检测曲目切换点…';
      }, mode);
      if (splitSource !== t || $('splitMask').hidden) return;
      const segs = result.segs;
      splitLog(`解码完成：${fmtWave(result.duration)}，${result.srcPcm ? '已保留原始采样率音源' : '超长视频，识曲走 24kHz 兜底源'}`);
      // 波形剪辑轨道：复用分析时的解码结果（srcPcm/srcRate 为原始采样率单声道源，识曲用）
      splitWave = {
        pcm: result.pcm, rate: result.rate, peaks: result.peaks,
        duration: result.duration, srcPcm: result.srcPcm, srcRate: result.srcRate,
      };
      $('splitWave').hidden = false;
      $('splitWaveTime').hidden = false;
      renderSplitWave();
      if (!segs.length) {
        splitLog('未检测到分段');
        $('splitHint').textContent = '未检测到明显的曲目切换点，可手动「添加分段」或「导入时间表」。';
        return;
      }
      splitSegments = segs.map((s) => ({ ...s, match: null, matching: false }));
      splitLog(`检测完成：${segs.length} 个分段`);
      $('splitHint').textContent = `本地分析完成，识别 ${segs.length} 个分段；可点「识别曲目」自动识别歌名，或手动填写后联网匹配。`;
      renderSplitList();
    } catch (e) {
      if (splitSource === t && !$('splitMask').hidden) {
        splitLog('分析失败：' + (e.message || e));
        $('splitHint').textContent = '分析失败：' + (e.message || e);
      }
    } finally {
      splitAnalyzing = false;
      btn.disabled = false;
    }
  });

  // 波形轨道交互：拖边缘调段界 / 双击切分或合并 / 单击试听跳转 / hover 时间提示
  const splitWaveEl = $('splitWave');
  let splitWaveDrag = null; // { i, edge, startX, moved }
  splitWaveEl.addEventListener('pointerdown', (e) => {
    if (!splitWave) return;
    const handle = e.target.closest('.rh-l, .rh-r');
    const region = e.target.closest('.split-region');
    splitWaveDrag = {
      i: region ? +region.dataset.ri : -1,
      edge: handle ? handle.dataset.edge : null,
      startX: e.clientX, moved: false,
    };
    splitWaveEl.setPointerCapture(e.pointerId);
  });
  splitWaveEl.addEventListener('pointermove', (e) => {
    if (!splitWave) return;
    // hover 竖线 + 时间 tooltip
    const rect = splitWaveEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const hover = $('splitWaveHover');
    const tip = $('splitWaveTip');
    hover.hidden = false;
    tip.hidden = false;
    hover.style.left = x + 'px';
    tip.style.left = Math.max(24, Math.min(rect.width - 24, x)) + 'px';
    tip.textContent = fmtWave(x / (rect.width || 1) * splitWave.duration);
    // 拖边缘手柄：实时改 from/to，但只动 overlay，松手才 renderSplitList（避免打断输入焦点）
    const drag = splitWaveDrag;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) >= 4) drag.moved = true;
    if (!drag.moved || !drag.edge || drag.i < 0) return;
    const s = splitSegments[drag.i];
    if (!s) return;
    const t = splitWaveTimeAt(e.clientX);
    const prevSeg = splitSegments[drag.i - 1];
    const nextSeg = splitSegments[drag.i + 1];
    if (drag.edge === 'from') {
      // 段长 ≥5s，不越过相邻段边界
      s.from = Math.max(prevSeg ? prevSeg.to : 0, Math.min(t, s.to - 5));
    } else {
      s.to = Math.min(nextSeg ? nextSeg.from : splitWave.duration, Math.max(t, s.from + 5));
    }
    const regionEl = $('splitWaveOverlay').querySelector(`[data-ri="${drag.i}"]`);
    if (regionEl) {
      const dur = splitWave.duration || 1;
      regionEl.style.left = (s.from / dur * 100) + '%';
      regionEl.style.width = Math.max(0.5, (s.to - s.from) / dur * 100) + '%';
    }
  });
  splitWaveEl.addEventListener('pointerup', (e) => {
    const drag = splitWaveDrag;
    splitWaveDrag = null;
    if (!splitWave || !drag) return;
    if (drag.moved) {
      if (drag.edge && drag.i >= 0 && splitSegments[drag.i]) {
        renderSplitList();
        renderSplitWave();
      }
      return;
    }
    // 单击（移动 <4px）：来源正在播放时跳转试听；
    // 与进度条同一条 seek 路径——视频模式（DASH 双轨）必须两条轨一起定位，
    // 只动 audio 会让音画时间轴互拽、反复回拉，整体播放卡死
    if (state.current === splitSource && splitSource && !splitSource.isLive) {
      const t = splitWaveTimeAt(e.clientX);
      if (videoModeOn()) seekVideoTimeline(t);
      else audio.currentTime = t;
    }
  });
  splitWaveEl.addEventListener('pointerleave', () => {
    $('splitWaveHover').hidden = true;
    $('splitWaveTip').hidden = true;
  });
  splitWaveEl.addEventListener('dblclick', (e) => {
    if (!splitWave) return;
    const t = splitWaveTimeAt(e.clientX);
    // 双击连续段的共用边界（|a.to - b.from| < 0.5s）：合并成一段，保留有名字的 name
    for (let i = 0; i + 1 < splitSegments.length; i++) {
      const a = splitSegments[i];
      const b = splitSegments[i + 1];
      if (Math.abs(a.to - b.from) < 0.5 && Math.abs(a.to - t) < 0.5) {
        a.to = b.to;
        if (!a.name.trim()) a.name = b.name;
        if (!a.match) a.match = b.match;
        splitSegments.splice(i + 1, 1);
        renderSplitList();
        renderSplitWave();
        return;
      }
    }
    // 与已有切点距离 <0.25s 的双击忽略
    const nearMarker = splitSegments.some((s) =>
      Math.abs(s.from - t) < 0.25 || Math.abs(s.to - t) < 0.25);
    if (nearMarker) return;
    // 双击 region 内部：在该时间点切成两个连续段，B 段 name 为空
    const i = splitSegments.findIndex((s) => t > s.from + 2 && t < s.to - 2);
    if (i < 0) return;
    const s = splitSegments[i];
    splitSegments.splice(i, 1,
      { from: s.from, to: t, name: s.name, match: s.match, matching: false },
      { from: t, to: s.to, name: '', match: null, matching: false });
    renderSplitList();
    renderSplitWave();
  });

  // 识别曲目：批量循环 identifyOneSegment（先网易云后 Shazam），段间 ≥400ms 限速，
  // 每段的起止与命中情况实时写入面板日志区
  $('splitIdentify').addEventListener('click', async () => {
    const t = splitSource;
    if (!t || splitIdentifying) return;
    if (!splitWave) { toast('请先运行「智能分析」生成波形'); return; }
    if (!splitSegments.length) { toast('没有可识别的分段'); return; }
    splitIdentifying = true;
    const btn = $('splitIdentify');
    btn.disabled = true;
    let hit = 0;
    let miss = 0;
    splitLog(`开始识别曲目，共 ${splitSegments.length} 段（先网易云，未命中回退 Shazam）`);
    try {
      for (let i = 0; i < splitSegments.length; i++) {
        if (splitSource !== t || $('splitMask').hidden) return; // 面板关闭/换源：静默丢弃
        const s = splitSegments[i];
        if (!s) continue;
        $('splitHint').textContent = `识别曲目中 (${i + 1}/${splitSegments.length})…`;
        try {
          const ok = await identifyOneSegment(i);
          if (splitSource !== t || $('splitMask').hidden) return;
          if (ok) hit++; else miss++;
        } catch (e2) {
          if (splitSource !== t || $('splitMask').hidden) return;
          splitLog(`第 ${i + 1} 段识别出错：${e2.message || e2}`);
          $('splitHint').textContent = '识别失败：' + (e2.message || e2);
          return; // 接口级错误逐段都会触发，直接终止
        }
        if (i + 1 < splitSegments.length) {
          await new Promise((r2) => setTimeout(r2, 400)); // 识曲接口限速，段间留 400ms
        }
      }
      if (splitSource !== t || $('splitMask').hidden) return;
      splitLog(`识别完成：${hit} 首命中，${miss} 首未识别`);
      $('splitHint').textContent = `识别完成：${hit} 首命中，${miss} 首未识别，可手动填写。`;
    } finally {
      splitIdentifying = false;
      btn.disabled = false;
    }
  });
  $('splitFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const total = (splitSource && splitSource.duration) || 0;
    const segs = api.parseTracklistText(text, total);
    if (!segs.length) { toast('未从文件中识别到时间轴'); return; }
    splitSegments = segs.map((s) => ({ ...s, match: null, matching: false }));
    $('splitHint').textContent = `已导入 ${segs.length} 个分段，可微调时间与歌名。`;
    renderSplitList();
    splitSegments.forEach((s, i) => { if (s.name.trim()) autoMatchSegment(i); });
    toast(`已导入 ${segs.length} 个分段`);
  });
  $('splitCreate').addEventListener('click', splitCreatePlaylist);
  $('ppQueue').addEventListener('click', () => openPanel('queue'));
  $('btnLyric').addEventListener('click', () => setVideoMode(false));
  $('btnVideo').addEventListener('click', () => setVideoMode(true));
  $('btnVideo').addEventListener('pointerenter', primeVideoStream);
  $('btnVideo').addEventListener('focus', primeVideoStream);
  $('homeBtn').addEventListener('click', () => go('library'));
  // 全局「返回上一页」：仅顶栏按钮（歌单/收藏页标题旁的返回按钮已去除）
  $('navBack').addEventListener('click', goBack);
  // 歌词页 / 原视频页共用的顶部下降返回钮（与主页按钮同排）
  $('npDownBtn').addEventListener('click', goBack);
  $('liveBack').addEventListener('click', goBack);
  syncBackButtons();
  document.addEventListener('pointerdown', activateSpectrum, { capture: true });
  audio.addEventListener('play', activateSpectrum);
  video.addEventListener('play', activateSpectrum);
  syncToggleIcon();

  // 音量：持久化 + 拖动
  bindSlider($('volTrack'), setVolume);
  setVolume(store.get('biu-volume', 0.8));

  // 队列抽屉底部
  renderMode();
  $('qMode').addEventListener('click', cyclePlayMode);
  $('qClear').addEventListener('click', () => {
    state.queue = []; state.qi = -1; state.current = null;
    clearHotCommentRotation();
    $('hotCommentAvatar').innerHTML = '<span class="cdot"></span>';
    setHotCommentText('暂无热评');
    document.body.classList.remove('live-on');
    destroyHls();
    audio.pause(); audio.removeAttribute('src');
    audio.removeAttribute('data-bvid'); audio.removeAttribute('data-quality');
    video.pause(); video.removeAttribute('src'); video.removeAttribute('data-bvid'); video.load();
    liveVideo.pause(); liveVideo.removeAttribute('src'); liveVideo.load();
    setModeUI(false);
    lyrics = []; lastLi = -1;
    $('ppTitle').textContent = '未在播放';
    const ppCover = $('ppCover');
    if (ppCover) { ppCover.removeAttribute('src'); ppCover.hidden = true; }
    setLyricHint('选择一首歌曲开始播放');
    renderQueue();
    syncToggleIcon();
  });
  $('qLocate').addEventListener('click', () => {
    const cur = $('qlist').querySelector('.qrow.on');
    if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // 搜索框：回车搜索
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch(e.target.value);
    e.stopPropagation();
  });
  // 搜索筛选：排序切换 + 更多筛选（时长）下拉
  $('sfOrders').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.order === searchOrder) return;
      searchOrder = b.dataset.order;
      $('sfOrders').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      doSearch();
    }));
  $('sfMoreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const drop = $('sfDrop');
    drop.hidden = !drop.hidden;
    $('sfMore').classList.toggle('open', !drop.hidden);
    $('sfMoreBtn').setAttribute('aria-expanded', String(!drop.hidden));
  });
  $('sfDurs').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      searchDuration = +b.dataset.dur;
      $('sfDurs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('sfDrop').hidden = true;
      $('sfMore').classList.remove('open');
      doSearch();
    }));
  document.addEventListener('click', (e) => {
    const drop = $('sfDrop');
    if (!drop.hidden && !e.target.closest('.sf-more')) {
      drop.hidden = true;
      $('sfMore').classList.remove('open');
    }
  });
  // 搜索结果翻页
  $('spPrev').addEventListener('click', () => {
    if (searchPage > 1) { doSearch(undefined, searchPage - 1); scrollSearchTop(); }
  });
  $('spNext').addEventListener('click', () => {
    if (searchPage < searchNumPages) { doSearch(undefined, searchPage + 1); scrollSearchTop(); }
  });

  // 设置项
  initSettings();
  initPlaylistDialog();
  initAuth();

  // 窗口控制（仅 Electron）
  if (api.hasBridge) {
    $('winControls').style.display = 'flex';
    const bindWindowControl = (id, action) => {
      const control = $(id);
      control.addEventListener('pointerdown', (event) => event.stopPropagation());
      control.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
    };
    bindWindowControl('winMin', () => window.bili.winMin());
    bindWindowControl('winMax', () => window.bili.winMax());
    bindWindowControl('winClose', () => window.bili.winClose());
  }

  initSpectrum();
  initUpPage();
  initVideoActions();
  // 卡带占位封面（mock 模式下的渐变封面）
  document.querySelectorAll('[data-cover]').forEach((el) => {
    if (!el.querySelector(':scope > img, :scope > svg')) {
      el.insertAdjacentHTML('afterbegin', coverSVG(+el.dataset.cover));
    }
  });

  // 视图懒加载：主页已有内容时直接复用，不因导航刷新推荐。
  const navLoad = { library: loadLibrary, fav: loadFav, radio: loadRadio };
  document.querySelectorAll('#mainNav button').forEach((b) =>
    b.addEventListener('click', () => navLoad[b.dataset.v] && navLoad[b.dataset.v]()));

  // URL 初始化（设计稿 ?view=xxx 预览入口）
  const q = new URLSearchParams(location.search);
  if (q.get('view')) go(q.get('view'));
  if (q.get('view') === 'playing' && q.get('mode') === 'video') setVideoMode(true);
  if (q.get('panel')) openPanel(q.get('panel'));

  renderQueue();
  loadLibrary();
  loadFav();
  loadRadio();
}

// 启动时先恢复 likes / 自建歌单 / 历史：主进程 JSON 仓优先，文件没有时回退 localStorage 并迁移过去
(async () => {
  let playbackSession = store.get(PLAYBACK_SESSION_KEY, null);
  if (api.hasBridge && window.bili.storeGet) {
    try { playbackSession = await window.bili.storeGet(PLAYBACK_SESSION_KEY) ?? playbackSession; } catch (e) {}
  }
  await loadBuckets(); // 游客命名空间（登录后 renderAuth 会切到账号桶）
  init();
  initPlaybackSession();
  await restorePlaybackSession(playbackSession);
})();
