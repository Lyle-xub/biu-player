/* 页面过渡：使用真实 DOM 和纯位移，保持毛玻璃的背景采样边界稳定。 */
(function (root) {
  let active = null;

  function cancel() {
    active?.finish();
  }

  function start(from, to, update, complete = () => {}) {
    cancel();
    const entering = to === 'playing';
    const sheet = document.querySelector('.view-playing');
    const underlay = document.querySelector('.view-' + (entering ? from : to));
    if (!sheet || !underlay || !sheet.animate
        || root.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update();
      complete();
      return;
    }

    sheet.classList.remove('view-entering');
    underlay.classList.remove('view-entering');
    // 导航、背景和底部按钮在动画开始时就进入目标状态，不能等收尾才突然出现。
    // 视频模式的清理由 complete 延后执行，保留退场面板原有内容。
    document.body.dataset.playerSheet = entering ? 'enter' : 'exit';
    update();
    const previousInert = underlay.inert;
    const previousSheetInert = sheet.inert;
    underlay.inert = true;
    sheet.inert = true;
    underlay.classList.add('player-sheet-underlay');

    const animations = [];
    let settled = false;
    const transition = {
      finish() {
        if (settled) return;
        settled = true;
        // 先隐藏离场页，再移除动画；终态位移与 CSS 常驻位移一致。
        underlay.classList.remove('player-sheet-underlay');
        underlay.inert = previousInert;
        sheet.inert = previousSheetInert;
        delete document.body.dataset.playerSheet;
        animations.forEach((animation) => animation.cancel());
        complete();
        if (active === transition) active = null;
      },
    };
    active = transition;
    const options = {
      duration: entering ? 620 : 520,
      easing: 'cubic-bezier(.22,.8,.24,1)',
      fill: 'both',
    };
    const positions = entering ? ['0 100vh', '0 0'] : ['0 0', '0 100vh'];
    // translate 独立于 transform，保留模式切换条原有的水平居中。
    animations.push(sheet.animate(positions.map((translate) => ({ translate })), options));
    for (const control of document.querySelectorAll('.mode-seg, .home-btn, .page-down')) {
      if (control.getClientRects().length) {
        animations.push(control.animate(positions.map((translate) => ({ translate })), options));
      }
    }
    // 两页首尾相接推移，不做 clip-path/opacity 动画：避免玻璃在收尾时换采样根。
    const underlayPositions = entering ? ['0 0', '0 -100vh'] : ['0 -100vh', '0 0'];
    animations.push(underlay.animate(underlayPositions.map((translate) => ({ translate })), options));
    animations[0].finished.then(() => transition.finish()).catch(() => {});
  }

  function enterPage(from, to, update) {
    cancel();
    const view = document.querySelector('.view-' + to);
    document.querySelectorAll('.view-entering').forEach((node) => node.classList.remove('view-entering'));
    update();
    if (!view?.animate || root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const distance = document.body.dataset.navDir === 'back' ? -16 : 16;
    // 不让整页从透明开始，也不在首帧暂停，防止先露出背景再闪出内容。
    const animation = view.animate([
      { translate: `${distance}px 0` }, { translate: '0 0' },
    ], { duration: 340, easing: 'cubic-bezier(.22,.72,.25,1)', fill: 'both' });
    const transition = { finish() {
      animation.cancel();
      if (active === transition) active = null;
    } };
    active = transition;
    animation.finished.then(() => transition.finish()).catch(() => {});
  }

  let artworkRequest = 0;
  let artworkUrl;
  let artworkLayer = 0;
  let artworkFades = [];
  function setArtwork(url) {
    const host = document.getElementById('artBackdrop');
    if (!host || artworkUrl === (url || '')) return;
    artworkUrl = url || '';
    const request = ++artworkRequest;
    const show = () => {
      if (request !== artworkRequest) return;
      if (!host.children.length) {
        for (let i = 0; i < 2; i++) {
          const layer = document.createElement('div');
          layer.className = 'art-backdrop-image';
          host.appendChild(layer);
        }
      }
      const next = host.children[artworkLayer = 1 - artworkLayer];
      const previous = host.children[1 - artworkLayer];
      const previousOpacity = root.getComputedStyle(previous).opacity;
      artworkFades.forEach((animation) => animation.cancel());
      artworkFades = [];
      next.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : '';
      next.style.opacity = url ? '1' : '0';
      previous.style.opacity = '0';
      if (next.animate && !root.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // 显式从零开始，首次图片即使命中缓存也不会在同一帧直接闪现。
        artworkFades = [
          next.animate([{ opacity: 0 }, { opacity: url ? 1 : 0 }], { duration: 600, easing: 'ease' }),
          previous.animate([{ opacity: previousOpacity }, { opacity: 0 }], { duration: 600, easing: 'ease' }),
        ];
      }
    };
    if (!url) { show(); return; }
    // 新封面解码完成前保留旧背景，不把未加载的图片直接交给全屏模糊层。
    const image = new Image();
    image.onload = () => {
      if (image.decode) image.decode().then(show, show);
      else show();
    };
    image.onerror = () => { if (request === artworkRequest) artworkUrl = undefined; };
    image.src = url;
  }

  root.BiuPlayerSheetMotion = { start, cancel, enterPage, setArtwork };
})(window);
