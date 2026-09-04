(function (root) {
  root.BiuVideoCloud = {
    mount(host) {
      if (!host) return () => {};
      const bridge=root.bili;
      host.className='video-cloud-card';
      host.innerHTML=`<div class="mrow lan-sync-row"><div class="ml"><b>视频云同步</b><small>加密同步喜欢、歌单和推荐画像，同账号设备共享一份云端视频。</small>
        <small class="cloud-status" role="status" data-cloud="status">正在读取同步状态…</small></div>
        <div class="mr"><button class="switch off" type="button" role="switch" aria-label="视频云同步" aria-checked="false" data-cloud="toggle"></button></div></div>
        <div class="mrow cloud-interval-row"><div class="ml"><b>同步间隔</b></div><div class="mr"><span class="mseg" role="radiogroup" aria-label="云同步更新间隔" data-cloud="interval">
        ${[3,6,12,24].map(hours=>`<button type="button" role="radio" aria-checked="false" data-hours="${hours}">${hours===24?'每天':`${hours} 小时`}</button>`).join('')}</span></div></div>
        <div class="mrow"><div class="ml"><b>同步操作</b></div><div class="mr cloud-actions">
        <button class="btn-ghost" type="button" data-cloud="sync" title="先合并云端数据，再上传一个新快照">立即同步</button><button class="btn-ghost" type="button" data-cloud="read">读取云端</button></div></div>
        <p class="cloud-schedule" data-cloud="schedule"></p>
        <div class="cloud-media" data-cloud="media"><div class="cloud-video-empty" data-cloud="empty">开启后创建云端视频<br><small>同账号设备可通过局域网自动同步恢复密钥</small></div>
        <video autoplay loop muted playsinline disablepictureinpicture disableremoteplayback tabindex="-1" preload="metadata" aria-label="云同步视频预览" data-cloud="video" hidden></video></div>
        <details class="cloud-details"><summary>同步详情 <span data-cloud="metrics">等待任务</span></summary>
        <pre class="cloud-log" role="log" aria-label="实时解码输出流" aria-live="polite" aria-relevant="additions" data-cloud="log">尚未开始解码。</pre>
        <details class="cloud-result"><summary>查看解码结果</summary><pre data-cloud="decoded">完整性验证通过后显示音乐库 JSON。</pre></details></details>
        <div class="mrow"><div class="ml"><b>恢复密钥</b><small>同账号开启局域网同步后自动共享，也可手动导入</small></div><div class="mr cloud-actions"><button class="btn-ghost" type="button" data-cloud="export">导出</button><button class="btn-ghost" type="button" data-cloud="import">导入</button></div></div>
        <small class="cloud-note">开启后，关闭主窗口仍会在后台同步；可从托盘重新打开或完全退出。更新需等待 B 站转码与审核，请妥善保存恢复密钥。</small>`;
      const el=name=>host.querySelector(`[data-cloud="${name}"]`);
      let current={},disposed=false,lastLog='',lastPreview='',previewRequest='';
      function showPreview(url) {
        if(disposed || !url || url===lastPreview)return;
        lastPreview=url;
        const video=el('video');video.muted=true;video.src='biu-media://stream?url='+encodeURIComponent(url);
        video.hidden=false;el('empty').hidden=true;video.play().catch(()=>{});
      }
      function render(s={}) {
        if(disposed)return;
        if(current.scope!==s.scope || current.bvid!==s.bvid){
          el('video').pause();el('video').removeAttribute('src');el('video').load();el('video').hidden=true;el('empty').hidden=false;lastPreview='';previewRequest='';
        }
        current=s;
        el('toggle').classList.toggle('off',!s.enabled);el('toggle').setAttribute('aria-checked',String(!!s.enabled));
        el('interval').querySelectorAll('button').forEach(button=>{
          const selected=Number(button.dataset.hours)===(s.intervalHours || 3);
          button.classList.toggle('on',selected);button.setAttribute('aria-checked',String(selected));button.disabled=!s.signedIn;
        });
        el('toggle').disabled=!s.signedIn;
        el('sync').disabled=!s.enabled || s.busy;el('read').disabled=!s.hasKey || s.busy;
        el('import').disabled=!s.signedIn || s.busy;el('export').disabled=!s.hasKey;
        el('status').textContent=s.error || (!s.signedIn?'登录 B 站后可开启':s.busy?'正在同步…':s.pending?'等待云端视频转码与审核':s.enabled?'自动同步已开启':'视频云同步已关闭');
        const format=t=>new Date(t).toLocaleString('zh-CN');
        el('schedule').textContent=[s.bvid?`共享稿件 ${s.bvid}`:'',s.lastSync?`最近成功 ${format(s.lastSync)}`:'',s.enabled && s.nextRun?`下次检查 ${format(s.nextRun)}`:''].filter(Boolean).join(' · ');
        const p=s.progress || {};
        el('metrics').textContent=[p.bytes!=null?`${(p.bytes/1024).toFixed(0)} KB ${p.transfer==='upload'?'已上传':'已读取'}`:'',p.frame?`${p.frame} 帧`:'',p.symbols?`${p.symbols}/${p.needed || p.symbols} 个有效包`:''].filter(Boolean).join(' · ') || '等待任务';
        const log=(s.logs || []).map(l=>`${new Date(l.at).toLocaleTimeString('zh-CN')}  ${l.message}`).join('\n');
        if(log!==lastLog){lastLog=log;el('log').textContent=log || '尚未开始解码。';el('log').scrollTop=el('log').scrollHeight;}
        el('decoded').textContent=s.decoded || '完整性验证通过后显示音乐库 JSON。';
        if(s.preview)showPreview(s.preview);
        else if(s.bvid && previewRequest!==`${s.scope}:${s.bvid}` && bridge?.videoCloudPreview){
          const request=previewRequest=`${s.scope}:${s.bvid}`;
          bridge.videoCloudPreview().then(url=>{if(previewRequest===request)showPreview(url);}).catch(()=>{});
        } else if(!s.bvid){
          el('video').pause();el('video').removeAttribute('src');el('video').load();el('video').hidden=true;el('empty').hidden=false;lastPreview='';previewRequest='';
        }
      }
      async function act(action) {try{const next=await action();if(next?.scope!==undefined)render(next);}catch(e){if(!disposed)el('status').textContent=String(e.message || e).replace(/^Error invoking remote method '[^']+': Error: /,'');}}
      if(!bridge?.videoCloudStatus){el('status').textContent='请在更新后的桌面应用中使用视频云同步';host.querySelectorAll('button,select').forEach(n=>n.disabled=true);return()=>{};}
      el('toggle').onclick=()=>act(()=>bridge.videoCloudConfigure({enabled:!current.enabled}));
      el('interval').onclick=event=>{const button=event.target.closest('[data-hours]');if(button && !button.disabled)act(()=>bridge.videoCloudConfigure({intervalHours:Number(button.dataset.hours)}));};
      el('sync').onclick=()=>act(()=>bridge.videoCloudRun(false));el('read').onclick=()=>act(()=>bridge.videoCloudRun(true));
      el('export').onclick=()=>act(()=>bridge.videoCloudExport());el('import').onclick=()=>act(()=>bridge.videoCloudImport());
      const unsubscribe=bridge.onVideoCloudStatus(render);
      act(()=>bridge.videoCloudStatus());
      return()=>{disposed=true;unsubscribe?.();el('video').pause();el('video').removeAttribute('src');el('video').load();host.replaceChildren();};
    },
  };
})(typeof window==='object'?window:this);
