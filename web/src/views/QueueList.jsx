import React, { memo, useRef } from 'react';
import { peek, useSlice } from '../store.js';
import { useTrackSource } from '../trackSource.js';
import { ResolvedTrackAttribution } from './TrackAttribution.jsx';
import { fmt } from '../legacy/html.js';
import { QUEUE_ROW_HEIGHT, useRowWindow } from './windowedRows.js';

export function locateQueueRow(list) {
  const index = peek('queue')?.qi;
  if (!(index >= 0)) return;
  const row = list.querySelector('.qrow.on');
  if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Large queues only mount nearby rows. Jump the viewport directly to the
  // active track without forcing every skipped cover to mount during scrolling.
  else list.scrollTop = index * QUEUE_ROW_HEIGHT - (list.clientHeight - QUEUE_ROW_HEIGHT) / 2;
}

/* 队列抽屉列表：DOM 与点击事件由组件拥有，controller 的 renderQueue 只 publish('queue', ...)。
 * renderQueue 每次切歌都会重发（qi 变化），组件订阅后自动刷新 on 高亮。 */
export function QueueList() {
  const data = useSlice('queue');
  const tracks = data ? data.tracks : [];
  const qi = data ? data.qi : -1;
  const listRef = useRef(null);
  const { first, last } = useRowWindow(listRef, tracks.length, QUEUE_ROW_HEIGHT);
  return (
    <div className="qlist" id="qlist" ref={listRef}>
      {first > 0 && <div aria-hidden="true" style={{ height: first * QUEUE_ROW_HEIGHT }} />}
      {tracks.length === 0
        ? <div className="list-hint">队列为空，去歌单里挑几首吧</div>
        : tracks.slice(first, last).map((t, offset) => {
          const i = first + offset;
          return <QueueRow key={`q-${t.bvid || t.title || 't'}-${i}`} track={t} pic={t.pic} index={i} active={i === qi} />;
        })}
      {last < tracks.length && <div aria-hidden="true" style={{ height: (tracks.length - last) * QUEUE_ROW_HEIGHT }} />}
    </div>
  );
}

const QueueRow = memo(function QueueRow({ track, pic, index, active }) {
  const t = useTrackSource(track);
  return (
    <div className={`qrow${active ? ' on' : ''}`} data-qi={index} onClick={() => window.biuActions.playIndex(index)}>
      <span className="qcov">{pic
        ? <img src={pic} loading="lazy" decoding="async" alt="" />
        : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(t.seed || 1, 100) }} />}</span>
      <span className="qt"><b className="track-title-line"><ResolvedTrackAttribution track={t} /></b><small className="track-artist-line"><ResolvedTrackAttribution track={t} artist /></small></span>
      <span className="qd num">{t.isLive ? 'LIVE' : fmt(t.duration)}</span>
    </div>
  );
});
