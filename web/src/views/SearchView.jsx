import React from 'react';
import { useSlice } from '../store.js';
import { fmtFans } from '../legacy/html.js';
import { VCard } from './VCard.jsx';

/* 搜索结果区（UP 主横向列表 + 相关视频 + 翻页器）：DOM 与卡片事件由组件拥有，
 * controller 只 publish('search', ...) / publish('follows', ...)。
 * 筛选条 / 搜索框 / 翻页按钮的点击绑定仍在 controller init（id 不变）。 */
export function SearchResults() {
  const data = useSlice('search');
  const follows = useSlice('follows') || {};
  const A = window.biuActions;
  const kw = data ? data.kw : '';
  const videos = data ? data.videos : null;
  const videosHint = data ? data.videosHint : null;
  const ups = data ? data.ups : null;
  const upsHint = data ? data.upsHint : null;
  const page = data ? data.page : 1;
  const numPages = data ? data.numPages : 1;
  return (
    <>
      <section className="sec" style={{ marginTop: 0 }} data-sec="up">
        <h2>UP 主</h2>
        <div className="ups" id="ups">
          {upsHint
            ? <div className="list-hint">{upsHint}</div>
            : ups && ups.map((u, i) => (
              <div className="up-card" key={`up-${u.mid}`} data-mid={u.mid} onClick={() => A.openUpPage(u.mid)}>
                <span className="ava">{u.pic
                  ? <img src={u.pic} loading="lazy" alt="" />
                  : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(70 + i * 3) }} />}</span>
                <span className="up-meta"><b>{u.name}</b><small>{fmtFans(u.fans)} 粉丝 · {u.videos} 视频</small></span>
                <button type="button" className={`fol${follows[u.mid] ? ' on' : ''}`} data-fol={u.mid}
                  onClick={(e) => { e.stopPropagation(); A.toggleFollow(u.mid); }}>{follows[u.mid] ? '已关注' : '+ 关注'}</button>
              </div>
            ))}
        </div>
      </section>
      <section className="sec" data-sec="video">
        <h2>相关视频</h2>
        <div className="vgrid" id="vgrid">
          {videos && videos.length
            ? videos.map((t, i) => (
              <VCard key={`${t.bvid || t.title || 'v'}-${i}`} t={t} index={i}
                onClick={() => A.setQueue(videos, '搜索 · ' + kw, i)} />
            ))
            : <div className="list-hint">{videosHint || '输入关键词，回车搜索'}</div>}
        </div>
        <div className="sp-pager" id="spPager" hidden={!kw}>
          <button type="button" className="sp-btn" id="spPrev" disabled={page <= 1}>上一页</button>
          <span className="sp-page num" id="spPageLabel">{page} / {numPages}</span>
          <button type="button" className="sp-btn" id="spNext" disabled={page >= numPages}>下一页</button>
        </div>
      </section>
    </>
  );
}
