import React from 'react';
import { useSlice } from '../store.js';

/* 收藏弹窗列表（#favPopList）：DOM 与点击事件由组件拥有，
 * controller 的 renderFavPopList 只 publish('favpop', ...)，弹层定位仍由 positionFavPop 负责。 */
export function FavPopList() {
  const data = useSlice('favpop');
  const state = data ? data.state : 'loading';
  return (
    <div className="fav-pop-list" id="favPopList">
      {state !== 'ready'
        ? (
          <div className="fav-pop-hint">{state === 'signed-out'
            ? '登录 B 站后可收藏'
            : state === 'empty' ? '暂无收藏夹，请先在 B 站创建' : '加载中…'}</div>
        )
        : data.folders.map((f, i) => (
          <button type="button" key={`favpop-${f.id}`} className={`fav-pop-item${f.favored ? ' on' : ''}`} data-fi={i}
            onClick={() => window.biuActions.toggleFavFolder(i)}>
            <span className="box"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#141610" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></span>
            <span className="name">{f.title}</span>
            <span className="count">{f.count}</span>
          </button>
        ))}
    </div>
  );
}
