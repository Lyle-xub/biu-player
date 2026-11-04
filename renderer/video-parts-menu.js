/* One themed menu for the classic and React players. */
(function (root) {
  let menuId = 0;
  function placement(rect, width, height) {
    const margin = 10, gap = 8;
    const size = Math.min(340, width - margin * 2);
    const below = height - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const up = below < Math.min(300, above);
    return { width: size, left: Math.max(margin, Math.min(rect.left, width - size - margin)),
      maxHeight: Math.min(330, Math.max(0, up ? above : below)),
      top: up ? 'auto' : `${rect.bottom + gap}px`,
      bottom: up ? `${height - rect.top + gap}px` : 'auto', up };
  }

  function mount(trigger, choose) {
    const doc = trigger.ownerDocument, win = doc.defaultView;
    const make = (tag, className, text) => {
      const el = doc.createElement(tag);
      el.className = className;
      if (text != null) el.textContent = text;
      return el;
    };
    const id = `biu-parts-menu-${++menuId}`;
    let popup = null, handlers, data;
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id);

    function close(restoreFocus = false) {
      if (!popup) return;
      handlers.abort();
      popup.remove();
      popup = null;
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus({ preventScroll: true });
    }
    function update(next) {
      close();
      data = next;
      trigger.hidden = !data?.parts?.length;
      const title = data?.part;
      trigger.title = title ? `P${title.page} · ${title.title} · 点击切换` : '选择分 P';
      trigger.setAttribute('aria-label', title ? `选择分 P，当前 P${title.page}：${title.title}` : '选择分 P');
      trigger.replaceChildren(make('span', 'video-parts-label', title ? `P${title.page} · ${title.title}` : '选择分 P'),
        make('span', 'video-parts-chevron'));
    }
    function open() {
      if (popup || !data?.parts?.length) return;
      handlers = new win.AbortController();
      const options = { signal: handlers.signal };
      popup = make('div', 'fav-pop video-parts-menu');
      popup.id = id;
      popup.setAttribute('role', 'menu');
      popup.setAttribute('aria-label', '视频分 P');
      const heading = make('div', 'fav-pop-title video-parts-heading', '视频分 P');
      heading.append(make('span', 'video-parts-count', `共 ${data.parts.length} P`));
      const list = make('div', 'fav-pop-list');
      const rows = [];
      const row = (label, value, part) => {
        const selected = part && String(data.cid) === String(value);
        const button = make('button', `fav-pop-item video-parts-row${selected ? ' on' : ''}`);
        button.type = 'button';
        button.tabIndex = -1;
        button.setAttribute('role', part ? 'menuitemradio' : 'menuitem');
        if (part) {
          button.setAttribute('aria-checked', String(selected));
          button.append(make('span', 'video-parts-badge', `P${part.page}`));
        }
        button.append(make('span', 'name', label));
        button.title = label;
        if (selected) button.append(make('span', 'video-parts-check', '✓'));
        button.addEventListener('click', () => { close(true); choose(value); });
        rows.push(button);
        list.append(button);
        return selected ? button : null;
      };
      row('从 P1 播放全部', 'all');
      let active;
      for (const part of data.parts) active = row(part.title, part.cid, part) || active;
      popup.append(heading, list);
      const pos = placement(trigger.getBoundingClientRect(), win.innerWidth, win.innerHeight);
      Object.assign(popup.style, { width: `${pos.width}px`, left: `${pos.left}px`, maxHeight: `${pos.maxHeight}px`,
        top: pos.top, bottom: pos.bottom });
      popup.classList.toggle('up', pos.up);
      if (typeof popup.showPopover === 'function') popup.setAttribute('popover', 'manual');
      doc.body.append(popup);
      if (popup.hasAttribute('popover')) popup.showPopover();
      trigger.setAttribute('aria-expanded', 'true');
      (active || rows[0]).focus();
      doc.addEventListener('pointerdown', event => {
        if (popup && !popup.contains(event.target) && !trigger.contains(event.target)) close();
      }, options);
      win.addEventListener('resize', () => close(), options);
      popup.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Tab') { close(true); return; }
        const i = rows.indexOf(doc.activeElement);
        const next = { ArrowDown: (i + 1) % rows.length, ArrowUp: (i - 1 + rows.length) % rows.length,
          Home: 0, End: rows.length - 1 }[event.key];
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        else if (next != null) { event.preventDefault(); rows[next].focus(); }
      }, options);
    }
    const toggle = () => popup ? close(true) : open();
    const onKey = event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation(); open();
      }
    };
    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', onKey);
    return { update, destroy() { close(); trigger.removeEventListener('click', toggle); trigger.removeEventListener('keydown', onKey); } };
  }
  const api = { mount, placement };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiuVideoPartsMenu = api;
})(typeof window !== 'undefined' ? window : globalThis);
