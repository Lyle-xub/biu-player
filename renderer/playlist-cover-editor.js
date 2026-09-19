/* Shared by the legacy renderer and React desktop UI. Coordinates use a 512px square. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BiuCoverEditor = api;
})(typeof window === 'object' ? window : null, function () {
  const SIZE = 512;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  function layout(width, height, zoom = 1, x = 0, y = 0) {
    const scale = SIZE / Math.min(width, height) * clamp(zoom, 1, 4);
    const w = width * scale, h = height * scale;
    return { scale, w, h, x: clamp(x, -(w - SIZE) / 2, (w - SIZE) / 2),
      y: clamp(y, -(h - SIZE) / 2, (h - SIZE) / 2) };
  }
  let dismiss;
  function close() { dismiss?.(); }
  function open(file) {
    close();
    if (!file) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const previousFocus = document.activeElement;
      const mask = document.createElement('div');
      mask.className = 'pl-dialog-mask cover-crop-mask';
      mask.innerHTML = `<section class="pl-dialog cover-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="coverCropTitle" aria-describedby="coverCropHint">
        <h3 id="coverCropTitle">裁切歌单封面</h3>
        <p id="coverCropHint">拖动图片调整位置，滚轮或滑杆缩放</p>
        <div class="cover-crop-stage" tabindex="0" role="img" aria-label="封面裁切预览，可用方向键移动图片">
          <canvas width="512" height="512"></canvas><span class="cover-crop-grid"></span>
          <span class="cover-crop-loading" role="status">正在读取图片…</span>
        </div>
        <label class="cover-crop-zoom">缩放<input type="range" min="1" max="4" step="0.01" value="1" aria-label="封面缩放" disabled><output>100%</output></label>
        <div class="cover-crop-actions"><button type="button" class="btn-ghost" data-action="reset" disabled>重置位置</button>
          <span></span><button type="button" class="btn-ghost" data-action="cancel">取消</button>
          <button type="button" class="btn-primary" data-action="save" disabled>使用封面</button></div>
      </section>`;
      const stage = mask.querySelector('.cover-crop-stage');
      const canvas = mask.querySelector('canvas'), ctx = canvas.getContext('2d');
      const slider = mask.querySelector('input'), output = mask.querySelector('output');
      const save = mask.querySelector('[data-action="save"]'), reset = mask.querySelector('[data-action="reset"]');
      const img = new Image();
      let url, ready = false, finished = false, zoom = 1, x = 0, y = 0, drag;
      const finish = (value, error) => {
        if (finished) return;
        finished = true;
        img.onload = img.onerror = null;
        if (url) URL.revokeObjectURL(url);
        document.removeEventListener('keydown', keydown, true);
        mask.remove();
        if (dismiss === cancel) dismiss = null;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(null);
      const draw = () => {
        if (!ready) return;
        const p = layout(img.naturalWidth, img.naturalHeight, zoom, x, y);
        x = p.x; y = p.y;
        ctx.fillStyle = '#151713'; ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, (SIZE - p.w) / 2 + x, (SIZE - p.h) / 2 + y, p.w, p.h);
        slider.value = zoom; output.value = `${Math.round(zoom * 100)}%`;
      };
      const keydown = (e) => {
        // Keep player hotkeys and the underlying playlist dialog out of this modal.
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        else if (e.key === 'Tab') {
          const items = [...mask.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
          const at = items.indexOf(document.activeElement);
          if (e.shiftKey && at <= 0) { e.preventDefault(); items.at(-1).focus(); }
          else if (!e.shiftKey && (at < 0 || at === items.length - 1)) { e.preventDefault(); items[0].focus(); }
        } else if (document.activeElement === stage && e.key.startsWith('Arrow')) {
          e.preventDefault(); const step = e.shiftKey ? 40 : 10;
          x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          draw();
        }
      };
      dismiss = cancel;
      document.body.appendChild(mask);
      document.addEventListener('keydown', keydown, true);
      mask.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      mask.querySelector('[data-action="cancel"]').focus();
      mask.addEventListener('click', (e) => { if (e.target === mask) cancel(); });
      mask.querySelector('[data-action="cancel"]').onclick = cancel;
      reset.onclick = () => { zoom = 1; x = y = 0; draw(); };
      save.onclick = () => {
        if (!ready) return;
        try { finish(canvas.toDataURL('image/jpeg', .82)); }
        catch (_) { finish(null, new Error('封面处理失败，请换一张图片重试')); }
      };
      slider.oninput = () => { zoom = Number(slider.value); draw(); };
      stage.addEventListener('wheel', (e) => {
        e.preventDefault(); if (!ready) return;
        zoom = clamp(zoom * Math.exp(-clamp(e.deltaY, -100, 100) * .002), 1, 4); draw();
      }, { passive: false });
      stage.onpointerdown = (e) => {
        if (!ready || e.button !== 0 || drag) return;
        stage.focus(); stage.setPointerCapture(e.pointerId);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: x, top: y };
        stage.classList.add('dragging');
      };
      stage.onpointermove = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const ratio = SIZE / stage.getBoundingClientRect().width;
        x = drag.left + (e.clientX - drag.x) * ratio; y = drag.top + (e.clientY - drag.y) * ratio; draw();
      };
      const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
      stage.onpointerup = stage.onpointercancel = stage.onlostpointercapture = endDrag;
      img.onload = () => {
        if (finished) return;
        if (!img.naturalWidth || !img.naturalHeight) { finish(null, new Error('无法读取这张图片')); return; }
        ready = true; slider.disabled = save.disabled = reset.disabled = false;
        mask.querySelector('.cover-crop-loading').hidden = true; draw(); stage.focus();
      };
      img.onerror = () => finish(null, new Error('图片读取失败，请选择 JPG、PNG 或 WebP 图片'));
      try { url = URL.createObjectURL(file); img.src = url; }
      catch (_) { finish(null, new Error('无法读取这张图片')); }
    });
  }
  return { open, close, layout };
});
