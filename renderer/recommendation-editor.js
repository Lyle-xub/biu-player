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
      const button = (label, action, id = '', selected = false) => `<button type="button" class="btn-ghost${selected ? ' on' : ''}" data-action="${action}" data-id="${esc(id)}" ${disabled && !['retry','model-cancel'].includes(action) ? 'disabled' : ''}>${esc(label)}</button>`;
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
        <p>${profile.id === 'auto' ? `累计分析 ${state.auto.samples} 个视频${state.auto.pending ? ` · ${state.auto.pending} 个待分析` : ''} · 喜欢 ${state.auto.sources?.likes || 0} / 歌单 ${state.auto.sources?.playlists || 0} / 信息流 ${state.auto.sources?.feed || 0}` : '自定义画像 · 根据兴趣主题与描述匹配；排除主题优先，UP 主与本地分析辅助排序'}${state.enabled ? '' : ' · 当前未用于首页推荐'}</p>

        ${profile.interests?.description ? `<p>${esc(profile.interests.description)}</p>` : ''}
        ${profile.interests?.avoid?.length ? `<p>避开：${esc(profile.interests.avoid.join('、'))}</p>` : ''}
        <h4>UP 主偏好</h4><div class="profile-buttons">${(profile.learned?.authors || []).slice(0,8).map(a=>button(`忽略 ${a.name}`,'author-ignore',a.mid)+button(`不推荐 ${a.name}`,'author-block',a.mid)).join('')}
        ${(profile.interests?.authors || []).filter(a=>a.mode!=='normal').map(a=>button(`恢复 ${a.name}`,'author-normal',a.mid)).join('')}</div>
        <h4>封面偏好</h4><div class="profile-buttons">${button(profile.interests?.visualEnabled===false?'开启封面推荐':'关闭封面推荐','visual-toggle')}${button('清除封面学习记录','visual-clear')}</div>
        <div class="profile-buttons">${(profile.learned?.samples || []).filter(a=>a.at>(profile.interests?.visualResetAt||0)&&!(profile.interests?.removedSamples||[]).some(r=>r.bvid===a.bvid)).slice(0,6).map(a=>button(`移除样本 ${a.title || a.bvid}`,'sample-remove',a.bvid)).join('')}</div>
        <h4>本地 AI</h4><p>按需下载，设备内分析。当前模型仅辅助排序；通过质量验证后才允许独立命中。</p>
        <div class="profile-buttons">${Object.entries(root.BiuLocalAnalysis?.models.getSnapshot() || {}).map(([kind,m])=>m.progress!=null?`<span>${esc(m.label)} ${Math.round(m.progress*100)}%</span>`+button('取消下载','model-cancel',kind):button(`${m.label} · ${(m.files.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(1)} MB · ${m.installed?(m.enabled?'暂停':'开启'):'下载'}`,'model-'+(m.installed?'toggle':'download'),kind)+(m.installed?button('删除 '+m.label,'model-remove',kind):'')).join('')}${button('清除分析缓存','model-clear')}</div>
        ${state.busy ? '<p role="status">正在分析视频标签…</p>' : ''}
        <h4>画像忽略标签</h4><p>已自动过滤音乐推荐、音乐分享官、征集令等平台标签。歌单、合集、MV 等只识别为内容形式，不参与音乐兴趣。</p>
        <div class="profile-buttons">${profile.tags.map((v) => button(`忽略 ${v.name}`, 'ignore-tag', v.name)).join('')}</div>
        <div class="profile-form"><input aria-label="添加忽略标签" name="ignored-tag" maxlength="40" placeholder="输入不想参与画像的标签" value="${esc(ignoredText)}" />${button('添加忽略', 'ignore-input')}</div>
        <div class="profile-buttons">${['ignored', 'muted', 'blocked'].flatMap((type) => (state.daily?.[type] || []).filter((v) => v.active).map((v) => button(`恢复${type === 'blocked' ? '视频' : type === 'muted' ? '权重' : '标签'} ${v.name}`, `restore-${type}`, v.name))).join('')}</div>
        <p>学习画像每 15 分钟批量更新，也可手动更新；当天每日推荐保持稳定。</p>
        ${!state.ready && state.error ? button('重新读取画像', 'retry') : ''}
        <div class="profile-buttons">${button('更新近期画像', 'refresh')}${button('新建画像', 'new')}${button(profile.id === 'auto' ? '编辑并另存' : '编辑画像', 'edit')}${profile.id !== 'auto' ? button('删除画像', 'delete') : ''}</div>
        ${removing ? `<p>删除「${esc(profile.name)}」？</p><div class="profile-buttons">${button('确认删除', 'confirm-delete')}${button('保留画像', 'cancel-delete')}</div>` : ''}
        ${draft ? `<div class="profile-form"><input aria-label="画像名称" name="profile-name" maxlength="40" placeholder="画像名称" value="${esc(draft.name)}">
          <textarea aria-label="兴趣描述" name="profile-description" maxlength="500" rows="3" placeholder="喜欢摄影实拍教学、旅行记录">${esc(draft.description || '')}</textarea>
          <input aria-label="避开主题" name="profile-avoid" maxlength="1200" placeholder="避开主题，用顿号分隔" value="${esc(draft.avoid || '')}">
          <p>兴趣不限于音乐。每行一个主题，可写「摄影:80」。权重为 1–100，最多 30 个。</p>
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
      if(action==='model-cancel'){try{await root.BiuLocalAnalysis.models.cancel(target.dataset.id);}catch(e){error=e.message;render();}return;}
      if (action === 'quote-retry') { quoteKey = null; loadQuote(profile); return; }
      error = '';
      if (action === 'new') draft = { name: '', text: '' };
      else if (action === 'edit') draft = { id: profile.id === 'auto' ? undefined : profile.id,
        name: profile.id === 'auto' ? '我的兴趣' : profile.name, text: R.tagsText(profile.tags), description:profile.interests?.description || '', avoid:(profile.interests?.avoid || []).join('、') };
      else if (action === 'cancel') draft = null;
      else if (action === 'delete') removing = true;
      else if (action === 'cancel-delete') removing = false;
      else {
        saving = true; render();
        try {
          if (action.startsWith('model-')) {
            const models=root.BiuLocalAnalysis.models, kind=target.dataset.id;
            if(action==='model-download') await models.download(kind);
            else if(action==='model-clear') await models.clear();
            else await models.configure({kind,enabled:!models.getSnapshot()[kind]?.enabled,remove:action==='model-remove'});
          }
          else if(action.startsWith('author-')) {const mid=target.dataset.id,name=profile.learned?.authors?.find(a=>a.mid===mid)?.name || mid;
            await manager.edit({type:'interests',id:profile.id,patch:{authors:[...(profile.interests?.authors||[]).filter(a=>a.mid!==mid),{mid,name,mode:action.slice(7),at:Date.now()}]}});
          }
          else if(action==='visual-toggle'||action==='visual-clear'||action==='sample-remove') {
            const patch=action==='visual-toggle'?{visualEnabled:profile.interests?.visualEnabled===false}:action==='visual-clear'?{visualResetAt:Date.now()}:{removedSamples:[...(profile.interests?.removedSamples||[]),{bvid:target.dataset.id,at:Date.now()}]};
            await manager.edit({type:'interests',id:profile.id,patch});
          }
          else if (action === 'retry') await manager.ready();
          else if (action === 'ignore-tag' || action === 'ignore-input') { await manager.dailyAction({ type: 'ignored', name: action === 'ignore-input' ? ignoredText : target.dataset.id }); ignoredText = ''; }
          else if (action.startsWith('restore-')) await manager.dailyAction({ type: action.slice(8), name: target.dataset.id, active: false });
          else if (action === 'refresh') await manager.refresh(true);
          else if (action === 'enable') await manager.edit({ type: 'enable', enabled: !state.enabled });
          else if (action === 'select') await manager.edit({ type: 'select', id: target.dataset.id });
          else if (action === 'confirm-delete') await manager.edit({ type: 'delete', id: profile.id });
          else if (action === 'save' || action === 'copy') await manager.edit({ type: 'save', id: action === 'save' ? draft.id : undefined,
            name: draft.name + (action === 'copy' ? ' 副本' : ''), tags: R.parseTagsText(draft.text), interests:{description:draft.description || '',avoid:(draft.avoid || '').split(/[、,，\n]/).map(v=>v.trim()).filter(Boolean)} });
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
      if (event.target.name === 'profile-description') draft.description = event.target.value;
      if (event.target.name === 'profile-avoid') draft.avoid = event.target.value;
      if (event.target.name === 'profile-tags') draft.text = event.target.value;
    }
    host.addEventListener('click', act); host.addEventListener('input', input);
    const unsubscribe = manager.subscribe(render);
    const unsubscribeModels=root.BiuLocalAnalysis?.models.subscribe(render);
    render(); manager.ready().then(render).catch(() => {});
    return () => { disposed = true; flipAnimation?.cancel(); unsubscribe(); unsubscribeModels?.(); host.removeEventListener('click', act); host.removeEventListener('input', input); host.replaceChildren(); };
  };
})(typeof window === 'object' ? window : this);
