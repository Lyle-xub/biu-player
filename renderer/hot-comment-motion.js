/* 两套桌面视图共用：只过渡胶囊内容，毛玻璃外框始终保持静止。 */
(function (root) {
  function create(pill) {
    const content = pill.querySelector('.hot-comment-content');
    let revision = 0;
    let key = null;
    let frame = null;
    let outgoing = null;
    let animations = [];
    let lastOverflow = null;
    let dwell = 9000;
    const reduced = () => root.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function cleanup() {
      if (frame !== null) root.cancelAnimationFrame(frame);
      frame = null;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      outgoing?.remove();
      outgoing = null;
      content.style.removeProperty('opacity');
    }

    function syncMarquee() {
      const text = content.querySelector('.hot-comment-text');
      const viewport = content.querySelector('.hot-comment-viewport');
      if (!text || !viewport || !viewport.clientWidth) return;
      const overflow = reduced() ? 0 : Math.max(0, Math.ceil(text.scrollWidth - viewport.clientWidth));
      if (overflow === lastOverflow) return;
      lastOverflow = overflow;
      text.classList.remove('scrolling');
      text.style.removeProperty('--marquee-distance');
      text.style.removeProperty('--marquee-duration');
      dwell = 9000;
      if (overflow > 6) {
        const duration = Math.max(8, Math.min(22, 6 + overflow / 24));
        text.style.setProperty('--marquee-distance', `${-overflow}px`);
        text.style.setProperty('--marquee-duration', `${duration}s`);
        text.classList.add('scrolling');
        dwell = Math.max(9000, (duration + 2) * 1000);
      }
    }

    function prepareAvatar(src) {
      if (!src) return Promise.resolve();
      return new Promise((resolve) => {
        const img = new root.Image();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          root.clearTimeout(timer);
          img.onload = img.onerror = null;
          resolve();
        };
        // 慢头像不阻塞评论轮播；准备期间仍显示完整的旧评论。
        const timer = root.setTimeout(finish, 700);
        img.onload = () => img.decode ? img.decode().then(finish, finish) : finish();
        img.onerror = finish;
        img.src = src;
      });
    }

    function update(data, commit, { animate = true } = {}) {
      const nextKey = JSON.stringify([data.text, data.avatar, data.seed, data.uname]);
      if (nextKey === key) return;
      const token = ++revision;
      key = nextKey;
      const visible = pill.getClientRects().length > 0 && root.getComputedStyle(pill).visibility !== 'hidden';
      const shouldAnimate = animate && visible && !reduced() && !!content.animate;
      const apply = () => {
        if (token !== revision) return;
        cleanup();
        if (shouldAnimate) {
          outgoing = content.cloneNode(true);
          outgoing.classList.add('hot-comment-outgoing');
          outgoing.setAttribute('aria-hidden', 'true');
          // 冻结旧评论当前滚动位置，避免复制层的跑马灯从头重播。
          const oldText = outgoing.querySelector('.hot-comment-text');
          oldText.style.animation = 'none';
          oldText.style.transform = root.getComputedStyle(content.querySelector('.hot-comment-text')).transform;
          outgoing.removeAttribute('id');
          outgoing.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
          pill.appendChild(outgoing);
          content.style.opacity = '0';
        }
        // 在提交新文案前停掉旧跑马灯，下一帧再启动；即使两条文字等宽也从头阅读。
        content.querySelector('.hot-comment-text').classList.remove('scrolling');
        commit(data); // 头像、昵称、文字一次提交，不能出现新头像配旧评论。
        lastOverflow = null;
        // 等 React 提交及浏览器排版完成，再测量新文字并启动交叉过渡。
        frame = root.requestAnimationFrame(() => {
          frame = root.requestAnimationFrame(() => {
            frame = null;
            if (token !== revision) return;
            syncMarquee();
            if (!shouldAnimate) return;
            animations = [
              outgoing.animate([
                { opacity: 1, transform: 'translate3d(0,0,0)' },
                { opacity: 0, transform: 'translate3d(0,-5px,0)' },
              ], { duration: 340, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }),
              content.animate([
                { opacity: 0, transform: 'translate3d(0,5px,0)' },
                { opacity: 1, transform: 'translate3d(0,0,0)' },
              ], { duration: 460, easing: 'cubic-bezier(.22,.68,.25,1)', fill: 'forwards' }),
            ];
            animations[1].finished.then(() => {
              if (token === revision) cleanup();
            }).catch(() => {});
          });
        });
      };
      if (shouldAnimate && data.avatar) prepareAvatar(data.avatar).then(apply);
      else apply();
    }

    const observer = root.ResizeObserver ? new root.ResizeObserver(() => {
      if (!outgoing) syncMarquee();
    }) : null;
    observer?.observe(content.querySelector('.hot-comment-viewport'));
    return {
      update,
      get dwellTime() { return dwell; },
      clear() { revision++; key = null; cleanup(); lastOverflow = null; dwell = 9000; },
      destroy() { this.clear(); observer?.disconnect(); },
    };
  }
  root.BiuHotCommentMotion = { create };
})(window);
