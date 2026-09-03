import React from 'react';
import { useSlice } from '../store.js';

/* 加入歌单弹窗列表（#plPopList）：DOM 与点击事件由组件拥有，
 * controller 的 renderPlPopList 只 publish('plpop', ...)。 */
export function PlPopList() {
  const data = useSlice('plpop');
  return (
    <div className="fav-pop-list" id="plPopList">
      {!data
        ? null
        : data.hint
          ? <div className="fav-pop-hint">{data.hint}</div>
          : data.playlists.map((p) => (
            <button type="button" key={`plpop-${p.id}`} className={`fav-pop-item${p.has ? ' on' : ''}`} data-pi={p.i}
              onClick={() => window.biuActions.toggleTrackInPlaylist(p.i)}>
              <span className="box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#141610" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></span>
              <span className="name">{p.title}</span>
              <span className="count">{p.count}</span>
            </button>
          ))}
    </div>
  );
}
