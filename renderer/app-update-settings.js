(function () {
  const bridge = window.bili;
  let state = {}, started = false, banner;
  const hosts = new Set(), dismissed = new Set();
  const markup = `<div class="mrow"><div class="ml"><b>当前版本</b></div><div class="mr" data-update="version"></div></div>
    <div class="mrow"><div class="ml"><b>自动检测更新</b><small>启动后及使用期间自动检查新版本</small></div><div class="mr"><button class="switch" role="switch" aria-label="自动检测更新" data-update="enabled"></button></div></div>
    <div class="mrow"><div class="ml"><b>自动下载更新</b><small>后台下载，正常退出后安装，也可手动重启安装</small></div><div class="mr"><button class="switch" role="switch" aria-label="自动下载更新" data-update="autoDownload"></button></div></div>
    <p class="app-update-message" data-update="message" role="status"></p><progress data-update="progress" max="100" hidden></progress>
    <div class="app-update-actions"><button class="btn-ghost" data-update="action">检查更新</button></div>`;
  const action = () => state.phase === 'ready' ? bridge.updateInstall() : state.phase === 'available' ? bridge.updateDownload() : bridge.updateCheck();
  const safely = async callback => { try { await callback(); } catch { render({ ...state, message: '更新操作失败，请稍后重试' }); } };
  function fill(host) {
    const node = name => host.querySelector(`[data-update="${name}"]`);
    if (node('version')) node('version').textContent = state.currentVersion ? `v${state.currentVersion}` : '开发预览';
    for (const key of ['enabled', 'autoDownload']) if (node(key)) {
      node(key).classList.toggle('off', state[key] === false);
      node(key).setAttribute('aria-checked', state[key] !== false);
      node(key).disabled = !state.supported;
    }
    if (node('message')) node('message').textContent = state.supported === false ? '请使用正式安装包更新应用' : state.message || '自动检查更新，不打断播放';
    if (node('progress')) { node('progress').hidden = state.phase !== 'downloading'; node('progress').value = state.progress || 0; }
    const button = node('action');
    button.textContent = state.phase === 'ready' ? '重启并安装' : state.phase === 'available' ? '下载更新' : state.phase === 'checking' ? '检查中…' : state.phase === 'downloading' ? `下载中 ${Math.round(state.progress || 0)}%` : '检查更新';
    button.disabled = !state.supported || ['checking', 'downloading'].includes(state.phase);
  }
  function render(next) {
    state = next;
    hosts.forEach(fill);
    document.querySelectorAll('[data-app-version]').forEach(node => { node.textContent = state.currentVersion ? `BIU PLAYER · v${state.currentVersion}` : 'BIU PLAYER'; });
    if (!banner) return;
    const key = `${state.version}:${state.phase === 'ready' ? 'ready' : 'available'}`;
    banner.hidden = !state.supported || !['available', 'ready'].includes(state.phase) || dismissed.has(key);
    banner.querySelector('b').textContent = `Biu Player ${state.version || ''}`;
    fill(banner);
  }
  function start() {
    if (started || !bridge?.updateStatus) return;
    started = true;
    banner = document.createElement('aside'); banner.className = 'app-update-notice'; banner.hidden = true;
    banner.setAttribute('aria-label', '应用更新');
    banner.innerHTML = '<div class="app-update-heading"><b></b><button class="btn-ghost" data-later>稍后</button></div><p data-update="message" role="status"></p><div class="app-update-actions"><button class="btn-ghost" data-update="action"></button></div>';
    banner.querySelector('[data-later]').onclick = () => { dismissed.add(`${state.version}:${state.phase === 'ready' ? 'ready' : 'available'}`); render(state); };
    banner.querySelector('[data-update="action"]').onclick = () => safely(action);
    document.body.appendChild(banner);
    bridge.onUpdateStatus(render);
    bridge.updateStatus().then(render).catch(() => {});
  }
  window.BiuAppUpdates = {
    beginRecommendation() {
      bridge.updateActivity?.(1).catch(() => {});
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        bridge.updateActivity?.(-1).catch(() => {});
      };
    },
    mount(host) {
    if (!host) return;
    start(); host.innerHTML = markup; hosts.add(host); render(state);
    host.querySelector('[data-update="action"]').onclick = () => safely(action);
    for (const key of ['enabled', 'autoDownload']) host.querySelector(`[data-update="${key}"]`).onclick = () => safely(() => bridge.updateConfigure({ [key]: !state[key] }));
    return () => hosts.delete(host);
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
