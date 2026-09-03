import React from 'react';
import { useSlice } from '../store.js';

/* 下载清晰度菜单（#dlMenu）：位置与选项来自 store 'dlmenu' slice，
 * 点击选项回调 biuActions.dlPick。放在 np-heading 外防裁剪。 */
export function DlMenu() {
  const d = useSlice('dlmenu') || {};
  return (
    <div className="dl-menu" id="dlMenu" hidden={!d.open}
      style={d.open ? { left: d.left + 'px', top: d.top + 'px' } : undefined}>
      {d.hint
        ? <div className="vqual-hint">{d.hint}</div>
        : (d.options || []).map((item) => (
          <button type="button" key={item.quality} className="vqual-item" data-vq={item.quality}
            onClick={() => window.biuActions.dlPick(item.quality)}>
            <b>{item.main}</b>{item.sub ? <small>{item.sub}</small> : null}
          </button>
        ))}
    </div>
  );
}
