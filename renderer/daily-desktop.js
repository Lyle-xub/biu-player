(function (root) {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function clampPan(pan, geometry, viewportWidth, viewportHeight) {
    // Allow one full viewport beyond the center when positioning edge photos.
    return {
      x: clamp(pan.x, -viewportWidth * 1.5, geometry.width + viewportWidth * .5),
      y: clamp(pan.y, -viewportHeight * 1.5, geometry.height + viewportHeight * .5),
    };
  }
  // Staggered columns and seeded offsets preserve the arrangement as photos arrive.
  function layout(width, count, hash) {
    const cardWidth = Math.min(180, Math.max(140, width - 52));
    const cardHeight = cardWidth + 92, columns = Math.max(1, Math.floor((width - 32) / (cardWidth + 108)));
    const step = (width - 48) / columns;
    const positions = Array.from({ length: count }, (_, i) => ({
      x: clamp(24 + i % columns * step + (step - cardWidth) / 2 + hash(`x${i}`) % 43 - 21
        + (Math.floor(i / columns) % 2 ? 12 : -8), 20, width - cardWidth - 20),
      y: 284 + Math.floor(i / columns) * (cardHeight + 120)
        + [0, 150, 45, 190, 85, 135][i % columns % 6] + hash(`y${i}`) % 49,
      angle: (i % 2 ? -1 : 1) * (2 + hash(`a${i}`) % 65 / 10), z: i + 1,
    }));
    const height = Math.max(440, ...positions.map((p) => p.y + cardHeight + 40));
    return { cardWidth, cardHeight, height, positions };
  }
  root.BiuDailyDesktop = function (host, manager, { play, save, navigate, back }) {
    const D = root.BiuDaily, reduced = root.matchMedia('(prefers-reduced-motion: reduce)');
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const icon = (name) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
      play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>', save: '<path d="M12 5v14M5 12h14"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>', prev: '<path d="m14 6-6 6 6 6"/>', next: '<path d="m10 6 6 6-6 6"/>',
    }[name]}</svg>`;
    const button = (label, action, id = '', disabled = false) => `<button class="daily-secondary" type="button" data-daily="${action}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
    const photo = (t, seed) => `<span class="daily-photo-fallback">${root.coverSVG(20 + D.hash(seed) % 12, 320)}</span>${t?.pic ? `<img src="${esc(t.pic)}" alt="" loading="lazy" draggable="false">` : ''}`;
    let overlay, panel, board, stage, closing = false, disposed = false, expanded = '', message = '';
    let homeKey = '', headerKey = '', contextKey = '', geometry, drag, dragFrame, pendingRender = false;
    let positions = new Map(), cards = new Map(), resizeObserver, viewObserver, pan = { x: 0, y: 0 };
    const snapshot = () => manager.getSnapshot();
    const entryNow = () => D.current(snapshot().daily);
    function home() {
      const state = snapshot(), entry = entryNow(), tracks = entry?.tracks || [], date = D.dayKey();
      const key = JSON.stringify([date, state.dailyBusy, tracks.length]);
      if (homeKey === key) return; homeKey = key;
      host.innerHTML = `<div class="cover daily-shelf-cover">${root.coverSVG(28, 400)}<span class="daily-shelf-date"><small>DAILY MIX</small><b>${date.slice(-2)}</b><span>${date.slice(0, 7).replace('-', ' / ')}</span></span><span class="count shelf-count"><span class="count-play">${icon('play')}</span><span class="count-label">${state.dailyBusy ? '正在挑选…' : `${tracks.length} 首歌曲`}</span></span></div><h3>每日推荐</h3><p>为今天挑选</p>`;
      if (host.getAttribute('aria-current') === 'true') {
        const meta = document.getElementById('shelfMeta');
        if (meta) meta.innerHTML = `${tracks.length} 首歌曲<i>·</i>为今天挑选`;
      }
    }
    function findAction(node, data) { return [...node.querySelectorAll('[data-daily]')].find((v) => v.dataset.daily === data.daily && v.dataset.id === data.id); }
    function paintCard(node, position) {
      node.style.transform = `translate3d(${position.x}px,${position.y}px,0) rotate(${position.angle}deg)`;
      node.style.zIndex = position.z;
    }
    function arrange() {
      if (!stage || closing || drag || document.body.dataset.view !== 'daily' || !board.clientWidth) return;
      const tracks = entryNow()?.tracks || [], width = Math.max(board.clientWidth + 320, 1500);
      const old = geometry;
      geometry = { ...layout(width, tracks.length, (key) => D.hash(contextKey + key)), width };
      stage.style.width = `${width}px`; stage.style.height = `${geometry.height}px`; stage.style.setProperty('--photo-width', `${geometry.cardWidth}px`);
      if (!old) pan = { x: (width - board.clientWidth) / 2, y: 0 };
      tracks.forEach((t, i) => {
        let p = positions.get(t.bvid);
        if (!p) { p = { ...geometry.positions[i] }; positions.set(t.bvid, p); }
        else if (old && old.width !== width) p.x = clamp(p.x * width / old.width, 20, width - geometry.cardWidth - 20);
        p.y = clamp(p.y, 20, geometry.height - geometry.cardHeight - 20);
        const node = cards.get(t.bvid); if (node) paintCard(node, p);
      });
      paintPan();
    }
    function render() {
      if (disposed) return;
      home();
      if (!overlay || closing || document.body.dataset.view !== 'daily') return;
      if (drag) { pendingRender = true; return; }
      const state = snapshot(), entry = entryNow(), tracks = entry?.tracks || [], date = D.dayKey();
      const heading = panel.querySelector('.daily-desk-heading');
      const nextContext = `${date}:${state.daily.profileId}:${entry?.generatedAt || 0}`;
      if (contextKey !== nextContext) { contextKey = nextContext; positions.clear(); cards.clear(); stage.replaceChildren(heading); expanded = ''; geometry = null; pan = { x: 0, y: 0 }; }
      const key = JSON.stringify([state.dailyBusy, entry?.error, tracks.length, message, state.dailyError]);
      if (headerKey !== key) {
        headerKey = key; const focus = document.activeElement?.dataset;
        heading.innerHTML = `<div class="daily-desk-title"><div><small>DAILY MIX / ${date.replaceAll('-', ' . ')}</small><h1>今天的音乐桌面 <span>${tracks.length} 首</span></h1></div></div>
          <div class="daily-desk-toolbar"><div class="daily-actions"><button class="daily-primary" data-daily="play-all" ${!tracks.length ? 'disabled' : ''}>${icon('play')} 播放全部</button><button class="daily-secondary" data-daily="save" ${!tracks.length ? 'disabled' : ''}>${icon('save')} 存为歌单</button><button class="daily-icon" data-daily="generate" aria-label="${entry?.error ? '继续获取' : '重新生成'}" title="重新生成" ${state.dailyBusy ? 'disabled' : ''}>${icon('refresh')}</button></div>
          </div>
          <p class="daily-status" role="status">${esc(message || state.dailyError || entry?.error || (state.dailyBusy ? '正在挑选歌曲…' : ''))}</p>`;
        if (focus?.daily) findAction(heading, focus)?.focus({ preventScroll: true });
      }
      const ids = new Set(tracks.map((t) => t.bvid));
      for (const [id, node] of cards) if (!ids.has(id)) { node.remove(); cards.delete(id); positions.delete(id); }
      const added = [];
      tracks.forEach((t, i) => {
        let node = cards.get(t.bvid);
        if (!node) {
          node = document.createElement('article'); node.className = 'daily-polaroid'; node.dataset.card = t.bvid;
          node.tabIndex = 0; node.setAttribute('aria-label', `${t.title}，按 Enter 播放`); node.setAttribute('aria-describedby', 'daily-drag-help');
          const secs = Math.floor(D.durationOf(t));
          node.innerHTML = `<div class="daily-polaroid-surface"><div class="daily-polaroid-photo">${photo(t, t.bvid)}<span class="daily-photo-index">${String(i + 1).padStart(2, '0')}</span></div><div class="daily-polaroid-caption"><b title="${esc(t.title)}">${esc(t.title)}</b><small>${esc(t.up || '未知音乐人')}</small><div class="daily-polaroid-footer"><span>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span><button data-daily="play" data-id="${esc(t.bvid)}" aria-label="播放 ${esc(t.title)}">${icon('play')}</button><button data-daily="more" data-id="${esc(t.bvid)}" aria-label="${esc(t.title)}的推荐理由与反馈">···</button></div></div></div>`;
          cards.set(t.bvid, node); stage.append(node); added.push(node);
        }
      });
      arrange();
      panel.querySelector('.daily-empty').hidden = tracks.length > 0;
      panel.querySelector('.daily-empty').textContent = state.dailyBusy ? '正在为今天收集音乐…' : '还没有合适的歌曲，试试重新生成。';
      added.forEach((node, i) => {
        if (reduced.matches) return;
        node.animate([{ opacity: 0, transform: `translate3d(${geometry.width / 2 - geometry.cardWidth / 2}px,${pan.y + 70}px,0) rotate(-12deg) scale(.72)` },
          { opacity: 1, transform: node.style.transform }], { duration: 650, delay: Math.min(i * 24, 260), easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      });
      feedback();
    }
    function feedback() {
      const sheet = panel.querySelector('.daily-feedback'), track = entryNow()?.tracks.find((t) => t.bvid === expanded);
      const key = JSON.stringify([expanded, track?.recommendationReason, track?.matchedTags]);
      if (sheet.dataset.key === key) return; sheet.dataset.key = key;
      sheet.hidden = !track;
      sheet.innerHTML = track ? `<header><b>${esc(track.title)}</b><button class="daily-icon" data-daily="dismiss" aria-label="关闭推荐理由">${icon('close')}</button></header><p>${esc(track.recommendationReason)}</p><div class="daily-feedback-actions">${button('不感兴趣', 'block', track.bvid)}${(track.matchedTags || []).map((name) => button(`减少「${name}」`, 'mute', name) + button(`忽略「${name}」`, 'ignore', name)).join('')}</div>` : '';
    }
    function open() {
      if (disposed) return;
      navigate(); render();
      panel.focus({ preventScroll: true });
      manager.generateDaily().catch(() => {});
    }
    function mountPage() {
      overlay = document.getElementById('dailyPage');
      overlay.innerHTML = '<div class="daily-panel" tabindex="-1"><div class="daily-board"><div class="daily-stage"><div class="daily-desk-heading"></div></div><p class="daily-empty"></p></div><aside class="daily-feedback" hidden aria-label="推荐理由与反馈"></aside><span id="daily-drag-help" class="daily-sr">拖动或使用方向键平移整张音乐桌面，Enter 播放选中的歌曲。</span></div>';
      panel = overlay.querySelector('.daily-panel'); board = overlay.querySelector('.daily-board'); stage = overlay.querySelector('.daily-stage');
      overlay.addEventListener('click', act); overlay.addEventListener('pointerdown', pointerDown);
      overlay.addEventListener('pointermove', pointerMove); overlay.addEventListener('pointerup', pointerEnd);
      overlay.addEventListener('pointercancel', pointerEnd); overlay.addEventListener('lostpointercapture', pointerEnd);
      board.addEventListener('wheel', wheel, { passive: false }); board.addEventListener('focusin', revealCard);
      overlay.addEventListener('error', imageError, true);
      resizeObserver = new ResizeObserver(arrange); resizeObserver.observe(board);
      viewObserver = new MutationObserver(() => {
        if (document.body.dataset.view === 'daily') { render(); manager.generateDaily().catch(() => {}); }
        else { pointerEnd(); expanded = ''; cards.forEach((node) => node.getAnimations().forEach((a) => a.cancel())); }
      });
      viewObserver.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
    }
    function paintPan() {
      if (!geometry || !board) return;
      pan = clampPan(pan, geometry, board.clientWidth, board.clientHeight);
      stage.style.transform = `translate3d(${-pan.x}px,${-pan.y}px,0)`;
      // Blur only each photograph's surface, leaving the page background untouched.
      const halfWidth = Math.max(1, board.clientWidth / 2), halfHeight = Math.max(1, board.clientHeight / 2);
      cards.forEach((node, id) => {
        const p = positions.get(id); if (!p) return;
        const distance = Math.hypot((p.x + geometry.cardWidth / 2 - pan.x - halfWidth) / halfWidth,
          (p.y + geometry.cardHeight / 2 - pan.y - halfHeight) / halfHeight);
        node.style.setProperty('--depth-blur', `${(clamp((distance - .4) / .85, 0, 1) * 5).toFixed(2)}px`);
      });
    }
    function pointerDown(event) {
      if (closing || drag || event.button !== 0 || event.target.closest('button') || !board.contains(event.target)) return;
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y };
      board.setPointerCapture(event.pointerId); board.classList.add('panning'); event.preventDefault();
    }
    function pointerMove(event) {
      if (drag?.pointerId !== event.pointerId) return;
      drag.clientX = event.clientX; drag.clientY = event.clientY;
      if (!dragFrame) dragFrame = requestAnimationFrame(moveFrame);
    }
    function moveFrame() {
      dragFrame = null;
      if (!drag) return;
      pan.x = drag.x + drag.startX - drag.clientX; pan.y = drag.y + drag.startY - drag.clientY; paintPan();
    }
    function pointerEnd(event) {
      if (!drag || event && event.pointerId !== drag.pointerId) return;
      cancelAnimationFrame(dragFrame); moveFrame(); const old = drag; drag = null;
      board.classList.remove('panning'); if (board.hasPointerCapture(old.pointerId)) board.releasePointerCapture(old.pointerId);
      if (pendingRender && !closing) { pendingRender = false; render(); } else if (!closing) arrange();
    }
    function wheel(event) {
      if (!geometry || event.ctrlKey || closing) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientHeight : 1;
      pan.x += (event.shiftKey ? event.deltaY : event.deltaX) * unit;
      pan.y += (event.shiftKey ? 0 : event.deltaY) * unit;
      paintPan();
    }
    function revealCard(event) {
      const node = event.target.closest('[data-card]'); if (!node || !geometry) return;
      // Keep keyboard focus visible without letting overflow scrolling shift the canvas itself.
      board.scrollTop = board.scrollLeft = 0;
      const p = positions.get(node.dataset.card);
      pan.x = clamp(pan.x, p.x + geometry.cardWidth + 20 - board.clientWidth, p.x - 20);
      pan.y = clamp(pan.y, p.y + geometry.cardHeight + 20 - board.clientHeight, p.y - 20);
      paintPan();
    }
    function imageError(event) { if (event.target.tagName === 'IMG') event.target.hidden = true; }
    async function act(event) {
      const target = event.target.closest('[data-daily]'); if (!target || target.disabled || closing) return;
      const action = target.dataset.daily, id = target.dataset.id;
      message = ''; const entry = entryNow();
      try {
        if (action === 'play' || action === 'play-all') { const index = action === 'play' ? entry?.tracks.findIndex((t) => t.bvid === id) : 0; if (entry?.tracks.length && index >= 0) await play(entry.tracks, index); }
        else if (action === 'save') { await save(entry); message = '已保存为本地歌单'; }
        else if (action === 'more') expanded = expanded === id ? '' : id;
        else if (action === 'dismiss') expanded = '';
        else if (action === 'generate') await manager.generateDaily(!entry?.error);
        else if (['ignore', 'mute', 'block'].includes(action)) {
          await manager.dailyAction({ type: { ignore: 'ignored', mute: 'muted', block: 'blocked' }[action], name: id }); expanded = '';
          message = action === 'block' ? '已从每日推荐中排除，可在画像设置中恢复' : '偏好已保存，重新生成或明天生效';
        }
      } catch (e) { message = e.message || '操作失败，请重试'; }
      render();
      if (action === 'more' && expanded) panel.querySelector('.daily-feedback button')?.focus({ preventScroll: true });
      if (action === 'dismiss') panel?.focus({ preventScroll: true });
    }
    function keyboard(event) {
      if (!overlay || closing || document.body.dataset.view !== 'daily') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (expanded) { expanded = ''; feedback(); panel.focus({ preventScroll: true }); } else back(); return; }
      const card = event.target.closest('[data-card]');
      if (event.key.startsWith('Arrow') && !event.target.closest('button')) {
        event.preventDefault(); const delta = event.shiftKey ? 100 : 40;
        pan.x += event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0;
        pan.y += event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0;
        paintPan(); return;
      }
      if (card && !event.target.closest('button') && event.key === 'Enter') { event.preventDefault(); card.querySelector('[data-daily="play"]').click(); return; }
    }
    mountPage();
    host.addEventListener('error', imageError, true); document.addEventListener('keydown', keyboard, true);
    const unsubscribe = manager.subscribe(render); render();
    const refresh = () => manager.generateDaily().catch(() => {});
    root.addEventListener('focus', refresh);
    const timer = setTimeout(refresh, 3000);
    const dispose = () => {
      disposed = true; closing = true; pointerEnd(); resizeObserver?.disconnect(); clearTimeout(timer); viewObserver?.disconnect(); unsubscribe();
      for (const [name, handler] of [['click', act], ['pointerdown', pointerDown], ['pointermove', pointerMove], ['pointerup', pointerEnd], ['pointercancel', pointerEnd], ['lostpointercapture', pointerEnd]]) overlay.removeEventListener(name, handler);
      overlay.removeEventListener('error', imageError, true); overlay.replaceChildren(); host.replaceChildren(); host.removeEventListener('error', imageError, true); document.removeEventListener('keydown', keyboard, true); root.removeEventListener('focus', refresh);
    };
    dispose.open = open;
    return dispose;
  };
  root.BiuDailyDesktop.layout = layout;
  root.BiuDailyDesktop.clampPan = clampPan;
})(window);
