import React from 'react';
import { useSlice } from '../store.js';
import { fmt } from '../legacy/html.js';

/* 队列抽屉列表：DOM 与点击事件由组件拥有，controller 的 renderQueue 只 publish('queue', ...)。
 * renderQueue 每次切歌都会重发（qi 变化），组件订阅后自动刷新 on 高亮。 */
export function QueueList() {
  const data = useSlice('queue');
  const tracks = data ? data.tracks : [];
  const qi = data ? data.qi : -1;
  return (
    <div className="qlist" id="qlist">
      {tracks.length === 0
        ? <div className="list-hint">队列为空，去歌单里挑几首吧</div>
        : tracks.map((t, i) => (
          <div key={`q-${t.bvid || t.title || 't'}-${i}`} className={`qrow${i === qi ? ' on' : ''}`} data-qi={i}
            onClick={() => window.biuActions.playIndex(i)}>
            <span className="qcov">{t.pic
              ? <img src={t.pic} loading="lazy" decoding="async" alt="" />
              : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG((t && t.seed) || 1, 100) }} />}</span>
            <span className="qt"><b>{t.title}</b><small>{t.up}</small></span>
            <span className="qd num">{t.isLive ? 'LIVE' : fmt(t.duration)}</span>
          </div>
        ))}
    </div>
  );
}
