import React, { useEffect, useRef, useState } from 'react';
import { useSlice } from '../store.js';
import { fmt } from '../legacy/html.js';

const likeIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C7 16.5 4 13.3 4 9.8 4 7.2 6 5 8.7 5c1.6 0 2.8.7 3.3 1.7C12.5 5.7 13.7 5 15.3 5 18 5 20 7.2 20 9.8c0 3.5-3 6.7-8 11.2z"/></svg>
);

/* 通用曲目行列表：行结构复刻 controller 旧版 trowHTML。
 * 拖拽排序与旧版一致走直接 DOM 操作（拖动中不 setState），dragend 才由 plReorder 发布新顺序；
 * 删除动画（t-removing → rAF t-gone → 280ms 后真正删除）由组件 state 驱动。 */
export function TrackList({ tracks, current, editable, listHint, containerId, onPlay, onDelete }) {
  useSlice('likes'); // 订阅收藏变化，驱动心形 liked 重渲染（等价旧版的立即 classList.toggle）
  const containerRef = useRef(null);
  const rowRefs = useRef(new Map());
  const heightsRef = useRef(new Map());
  const [removing, setRemoving] = useState(() => new Set());
  const [gone, setGone] = useState(() => new Set());

  // tracks 变化（删除/排序落盘重绘）后清掉动画态，避免残留陈旧下标；
  // 删除走 splice 原地改数组（引用不变），所以同时监听长度
  useEffect(() => {
    setRemoving(new Set());
    setGone(new Set());
    heightsRef.current.clear();
  }, [tracks, tracks.length]);

  const handleDelete = (e, i) => {
    e.stopPropagation();
    if (removing.has(i)) return;
    const row = rowRefs.current.get(i);
    if (row) heightsRef.current.set(i, row.offsetHeight);
    setRemoving((s) => { const n = new Set(s); n.add(i); return n; });
    requestAnimationFrame(() => setGone((s) => { const n = new Set(s); n.add(i); return n; }));
    setTimeout(() => onDelete(i), 280);
  };

  const rows = () => (containerRef.current ? [...containerRef.current.querySelectorAll('.trow')] : []);

  const handleDragStart = (e) => {
    const row = e.currentTarget;
    if (!row.draggable) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.qi);
    row.classList.add('dragging');
  };

  const handleDragEnd = (e) => {
    const row = e.currentTarget;
    row.draggable = false;
    row.classList.remove('dragging');
    // 拖动中 DOM 已实时重排，松手时按 DOM 顺序（data-qi 为原下标）写回数据
    const order = rows().map((x) => +x.dataset.qi);
    window.biuActions.plReorder(order);
  };

  // 实时重排：找到第一个中点在指针下方的行，把被拖行插到它前面；否则排到末尾。
  // 直接移动 DOM 节点（不用 transform 位移做命中），天然没有振荡，也支持拖到最底部；
  // 移动时对其余行做 FLIP 动画：先按旧视觉位置反向位移一帧，再平滑滑向新槽位。
  // 一段滑动未落定（.fly）时跳过本次移动，等下一拍 dragover——避免在途位移污染命中测试
  const handleDragOver = (e) => {
    const container = containerRef.current;
    const dragging = container && container.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (container.querySelector('.fly')) return;
    const ref = rows().find((x) => {
      if (x === dragging) return false;
      const rect = x.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (ref ? dragging.nextElementSibling === ref : container.lastElementChild === dragging) return;
    const before = new Map(rows().map((x) => [x, x.getBoundingClientRect().top]));
    if (ref) container.insertBefore(dragging, ref);
    else container.appendChild(dragging);
    const movers = rows().filter((x) => x !== dragging)
      .map((x) => [x, before.get(x) - x.getBoundingClientRect().top])
      .filter(([, d]) => d);
    movers.forEach(([x, d]) => {
      x.classList.add('fly');
      x.style.transition = 'none';
      x.style.transform = `translateY(${d}px)`;
    });
    requestAnimationFrame(() => movers.forEach(([x]) => {
      x.style.transition = 'transform .22s var(--ease)';
      x.style.transform = '';
      setTimeout(() => { x.classList.remove('fly'); x.style.transition = ''; }, 230);
    }));
  };

  return (
    <div id={containerId} ref={containerRef} onDragOver={editable ? handleDragOver : undefined}>
      {tracks.length === 0
        ? (listHint != null ? <div className="list-hint">{listHint}</div> : null)
        : tracks.map((t, i) => {
          const on = current === t;
          const liked = !!(window.biuActions && window.biuActions.isLiked(t));
          const sourceTitle = t.isSegment && t.parentTitle && t.parentTitle !== t.title ? t.parentTitle : '';
          const sourceUp = t.isSegment && t.parentUp && t.parentUp !== t.up ? t.parentUp : '';
          return (
            <div key={`${t.bvid || t.title || 'track'}-${i}`}
              className={`trow${on ? ' on' : ''}${editable ? ' editable' : ''}${removing.has(i) ? ' t-removing' : ''}${gone.has(i) ? ' t-gone' : ''}`}
              data-qi={i}
              style={removing.has(i) ? { height: `${heightsRef.current.get(i)}px` } : undefined}
              ref={(el) => { if (el) rowRefs.current.set(i, el); else rowRefs.current.delete(i); }}
              onClick={() => onPlay(i)}
              onDragStart={editable ? handleDragStart : undefined}
              onDragEnd={editable ? handleDragEnd : undefined}>
              <span className="idx num"><i>{String(i + 1).padStart(2, '0')}</i><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
              <span className="tt"><span className="tcov">{t.pic
                  ? <img src={t.pic} loading="lazy" decoding="async" alt="" />
                  : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG((t && t.seed) || 1, 100) }} />}</span>
                <span style={{ minWidth: 0 }}><b>{t.title}{sourceTitle ? <span className="track-source"> · {sourceTitle}</span> : null}{t.isLive ? <span className="tag-live">直播</span> : null}</b>
                  <small>{t.up}{sourceUp ? <span className="track-source"> · {sourceUp}</span> : null}</small></span></span>
              <span className="up">{t.up}{sourceUp ? <span className="track-source"> · {sourceUp}</span> : null}</span>
              <span className="dur num">{t.isLive ? 'LIVE' : fmt(t.duration)}</span>
              <span className="t-acts"><span className={`like${liked ? ' liked' : ''}`} data-like={i}
                onClick={(e) => { e.stopPropagation(); window.biuActions.toggleLike(t); }}>{likeIcon}</span>{editable && (
                <>
                  <span className="t-grip" role="button" aria-label="拖动排序" title="按住拖动排序"
                    onPointerDown={(e) => { const row = e.currentTarget.closest('.trow'); if (row) row.draggable = true; }}
                    onClick={(e) => e.stopPropagation()}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span>
                  <span className="t-del" data-del={i} role="button" aria-label="从歌单删除" title="从歌单删除"
                    onClick={(e) => handleDelete(e, i)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
                </>
              )}</span>
            </div>
          );
        })}
    </div>
  );
}
