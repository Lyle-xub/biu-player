/* Small DOM editor shared by the classic desktop settings and the React settings host. */
(function (root) {
  root.BiuRecommendationEditor = function mount(host, manager) {
    const R = root.BiuRecommendation, P = root.BiuProfilePresentation;
    const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let flipAnimation = null;
    let flipped = false, quoteKey = null, quote = null, quoteError = '';
    let draft = null, error = '', saving = false, removing = false, disposed = false, ignoredText = '';
    function render() {
      if (disposed) return;
      flipAnimation?.cancel();
      const state = manager.getSnapshot(), profile = R.activeProfile(state);
      const art = P.artwork(profile);
      const disabled = !state.ready || state.busy || saving;
      const button = (label, action, id = '', selected = false) => `<button type="button" class="btn-ghost${selected ? ' on' : ''}" data-action="${action}" data-id="${esc(id)}" ${disabled && action !== 'retry' ? 'disabled' : ''}>${esc(label)}</button>`;
      host.innerHTML = `<section class="recommendation-profile">
        <div class="profile-heading"><h4>我的推荐画像</h4><span>PERSONAL ARCHIVE</span></div>
        <div class="profile-buttons">${button(state.enabled ? '画像推荐已开启' : '画像推荐已关闭', 'enable', '', state.enabled)}</div>
        ${error || state.error ? `<p role="status">${esc(error || state.error)}</p>` : ''}
        <div class="profile-spread">
          <div class="portrait-card${flipped ? ' is-flipped' : ''}">
            <button class="portrait-face portrait-front" type="button" data-action="flip" aria-label="翻转卡片，查看用户画像" ${flipped ? 'hidden inert' : ''}>
              ${art.svg}<span class="portrait-caption"><b>${esc(profile.name)}</b><small>No. ${art.serial} / 点击翻面 ↗</small></span>
            </button>
            <div class="portrait-face portrait-back" ${flipped ? '' : 'hidden inert'}>
              <b>${esc(profile.name)}</b><small>你的兴趣 · ${profile.tags.length} 个标签</small>
              <div class="portrait-weights">${profile.tags.map((tag) => `<div><span>${esc(tag.name)}</span><b>${tag.weight}</b></div>`).join('') || '<small>还没有标签，试着创建一份画像。</small>'}</div>
              <button type="button" data-action="flip" aria-label="返回画像卡片正面">↶ 返回卡面</button>
            </div>
          </div>
          <div class="profile-quote"><span class="quote-theme">${esc(art.theme.label)}</span><span class="quote-mark" aria-hidden="true">“</span><div class="quote-content" aria-live="polite"></div></div>
        </div>
        <div class="profile-details" ${flipped ? '' : 'hidden'}>
        <p>持续累积喜欢、自建歌单与有效收听。推荐信息流只进入候选库；长期兴趣与最近 14 天行为共同影响选曲。</p>
        <div class="profile-buttons">${[state.auto, ...state.profiles].map((p) => button(p.name + (state.activeId === p.id ? ' · 使用中' : ''), 'select', p.id, state.activeId === p.id)).join('')}</div>
        <p>${profile.id === 'auto' ? `累计分析 ${state.auto.samples} 个视频${state.auto.pending ? ` · ${state.auto.pending} 个待分析` : ''} · 喜欢 ${state.auto.sources?.likes || 0} / 歌单 ${state.auto.sources?.playlists || 0} / 信息流 ${state.auto.sources?.feed || 0}` : '自定义画像 · 仅推荐标题或标签匹配的视频，不混入其他推荐；多个标签匹配任意一个，权重影响排序'}${state.enabled ? '' : ' · 当前未用于首页推荐'}</p>

        ${state.busy ? '<p role="status">正在分析视频标签…</p>' : ''}
        <h4>画像忽略标签</h4><p>已自动过滤音乐推荐、音乐分享官、征集令等平台标签。歌单、合集、MV 等只识别为内容形式，不参与音乐兴趣。</p>
        <div class="profile-buttons">${profile.tags.map((v) => button(`忽略 ${v.name}`, 'ignore-tag', v.name)).join('')}</div>
        <div class="profile-form"><input aria-label="添加忽略标签" name="ignored-tag" maxlength="40" placeholder="输入不想参与画像的标签" value="${esc(ignoredText)}" />${button('添加忽略', 'ignore-input')}</div>
        <div class="profile-buttons">${['ignored', 'muted', 'blocked'].flatMap((type) => (state.daily?.[type] || []).filter((v) => v.active).map((v) => button(`恢复${type === 'blocked' ? '视频' : type === 'muted' ? '权重' : '标签'} ${v.name}`, `restore-${type}`, v.name))).join('')}</div>
        <p>画像立即重算；当天每日推荐保持稳定，可在每日推荐中重新生成。</p>
        ${!state.ready && state.error ? button('重新读取画像', 'retry') : ''}
        <div class="profile-buttons">${button('更新近期画像', 'refresh')}${button('新建画像', 'new')}${button(profile.id === 'auto' ? '编辑并另存' : '编辑画像', 'edit')}${profile.id !== 'auto' ? button('删除画像', 'delete') : ''}</div>
        ${removing ? `<p>删除「${esc(profile.name)}」？</p><div class="profile-buttons">${button('确认删除', 'confirm-delete')}${button('保留画像', 'cancel-delete')}</div>` : ''}
        ${draft ? `<div class="profile-form"><input aria-label="画像名称" name="profile-name" maxlength="40" placeholder="画像名称" value="${esc(draft.name)}">
          <p>每行一个标签，可写「古典:80」。权重为 1–100，不填默认 50，最多 30 个。</p>
          <textarea aria-label="画像标签与权重" name="profile-tags" rows="5" placeholder="古典:80&#10;钢琴:60">${esc(draft.text)}</textarea>
          <div class="profile-buttons">${button('保存并使用', 'save')}${draft.id ? button('另存为新画像', 'copy') : ''}${button('取消编辑', 'cancel')}</div></div>` : ''}
        </div>
      </section>`;
      if (state.ready) loadQuote(profile); else paintQuote();
    }
    function paintQuote() {
      const node = host.querySelector('.quote-content');
      if (!node) return;
      node.innerHTML = quote ? `<blockquote>${esc(quote.text)}</blockquote><p class="quote-source">— ${esc([quote.author, quote.from].filter(Boolean).join(' · '))}</p><small>一言 · 按兴趣主题选句</small>`
        : `<p>${esc(quoteError || '正在寻找与你共鸣的一句话…')}</p>${quoteError ? '<button class="btn-ghost" type="button" data-action="quote-retry">重试</button>' : ''}`;
    }
    function loadQuote(profile) {
      const key = `${profile.id}:${P.themeFor(profile).id}`;
      if (key === quoteKey) { paintQuote(); return; }
      quoteKey = key; quote = null; quoteError = ''; paintQuote();
      P.quoteFor(profile).then((value) => {
        if (disposed || key !== quoteKey) return;
        quote = value; paintQuote();
      }).catch((e) => {
        if (disposed || key !== quoteKey) return;
        quoteError = e.message; paintQuote();
      });
    }
    async function act(event) {
      const target = event.target.closest('button[data-action]');
      if (!target || target.disabled) return;
      const action = target.dataset.action, state = manager.getSnapshot(), profile = R.activeProfile(state);
      if (action === 'flip') {
        if (flipAnimation) return;
        const card = host.querySelector('.portrait-card');
        const reducedMotion = root.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const transform = (angle) => `perspective(900px) rotateY(${angle}deg) rotate(-3deg)`;
        try {
          // Only one face is painted. Switch at the edge instead of relying on GPU backface culling.
          flipAnimation = card.animate([{ transform: transform(0) }, { transform: transform(-90) }],
            { duration: reducedMotion ? 0 : 180, easing: 'ease-in', fill: 'forwards' });
          await flipAnimation.finished;
          if (disposed || !card.isConnected) return;
          flipped = !flipped;
          card.classList.toggle('is-flipped', flipped);
          card.querySelector('.portrait-front').hidden = flipped;
          card.querySelector('.portrait-front').inert = flipped;
          card.querySelector('.portrait-back').hidden = !flipped;
          card.querySelector('.portrait-back').inert = !flipped;
          host.querySelector('.profile-details').hidden = !flipped;
          flipAnimation.cancel();
          flipAnimation = card.animate([{ transform: transform(90) }, { transform: transform(0) }],
            { duration: reducedMotion ? 0 : 260, easing: 'ease-out' });
          await flipAnimation.finished;
          card.querySelector(flipped ? '.portrait-back button' : '.portrait-front').focus({ preventScroll: true });
        } catch (e) { if (e.name !== 'AbortError') console.error('画像翻面失败', e); }
        finally { flipAnimation = null; }
        return;
      }
      if (action === 'quote-retry') { quoteKey = null; loadQuote(profile); return; }
      error = '';
      if (action === 'new') draft = { name: '', text: '' };
      else if (action === 'edit') draft = { id: profile.id === 'auto' ? undefined : profile.id,
        name: profile.id === 'auto' ? '我的兴趣' : profile.name, text: R.tagsText(profile.tags) };
      else if (action === 'cancel') draft = null;
      else if (action === 'delete') removing = true;
      else if (action === 'cancel-delete') removing = false;
      else {
        saving = true; render();
        try {
          if (action === 'retry') await manager.ready();
          else if (action === 'ignore-tag' || action === 'ignore-input') { await manager.dailyAction({ type: 'ignored', name: action === 'ignore-input' ? ignoredText : target.dataset.id }); ignoredText = ''; }
          else if (action.startsWith('restore-')) await manager.dailyAction({ type: action.slice(8), name: target.dataset.id, active: false });
          else if (action === 'refresh') await manager.refresh(true);
          else if (action === 'enable') await manager.edit({ type: 'enable', enabled: !state.enabled });
          else if (action === 'select') await manager.edit({ type: 'select', id: target.dataset.id });
          else if (action === 'confirm-delete') await manager.edit({ type: 'delete', id: profile.id });
          else if (action === 'save' || action === 'copy') await manager.edit({ type: 'save', id: action === 'save' ? draft.id : undefined,
            name: draft.name + (action === 'copy' ? ' 副本' : ''), tags: R.parseTagsText(draft.text) });
          draft = null; removing = false;
        } catch (e) { error = e.message || '保存失败，请重试'; }
        finally { saving = false; }
      }
      render();
    }
    function input(event) {
      if (event.target.name === 'ignored-tag') ignoredText = event.target.value;
      if (!draft) return;
      if (event.target.name === 'profile-name') draft.name = event.target.value;
      if (event.target.name === 'profile-tags') draft.text = event.target.value;
    }
    host.addEventListener('click', act); host.addEventListener('input', input);
    const unsubscribe = manager.subscribe(render);
    render(); manager.ready().then(render).catch(() => {});
    return () => { disposed = true; flipAnimation?.cancel(); unsubscribe(); host.removeEventListener('click', act); host.removeEventListener('input', input); host.replaceChildren(); };
  };
})(typeof window === 'object' ? window : this);
