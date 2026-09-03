import React, { memo, useCallback, useRef, useState } from 'react';
import { peek, useSlice } from '../store.js';

/* 通用歌单卡片：DOM 结构与 controller 的 gcardHTML 完全一致
 * （cover 内依次为 封面 / badge / count 胶囊 / cover-loading 占位）。 */
export function GCard({ title, meta, cover, badge, id, extraAttrs, onClick }) {
  // React 元素也有 type: 'svg' / 'img'，必须先与封面数据描述对象区分。
  const isElement = React.isValidElement(cover);
  const isImg = !isElement && cover && cover.type === 'img';
  const src = isImg ? cover.src : null;
  const [readySrc, setReadySrc] = useState(null);
  const ready = !isImg || readySrc === src;
  const pendingDecode = useRef(null);
  const imageNode = useRef(null);
  const reveal = useCallback(() => setReadySrc(src), [src]);
  const decodeThenReveal = useCallback((img) => {
    // ref 和 load 都可能命中缓存，只解码一次；追加卡片不能重新解码旧封面。
    if (pendingDecode.current?.img === img && pendingDecode.current.src === src) return;
    const request = { img, src };
    pendingDecode.current = request;
    const done = () => {
      if (pendingDecode.current === request && imageNode.current === img) setReadySrc(src);
    };
    if (!img.decode) { done(); return; }
    img.decode().then(done, done);
  }, [src]);
  // 缓存命中的图片不会触发 load 事件，mount 时按 complete 状态直接处理。
  const imgRef = useCallback((img) => {
    imageNode.current = img;
    if (!img) { pendingDecode.current = null; return; }
    if (!img.complete) return;
    if (img.naturalWidth) decodeThenReveal(img);
    else reveal(); // 缓存的失败图片可能已经触发过 error，不能永远保留加载层。
  }, [decodeThenReveal, reveal]);
  return (
    <div className={`gcard${ready ? ' cover-ready' : ''}`} id={id} {...extraAttrs} onClick={onClick}>
      <div className="cover">
        {isElement ? cover : isImg
          ? <img src={cover.src} loading={cover.lazy ? 'lazy' : undefined}
              decoding={cover.lazy ? 'async' : undefined} alt=""
              ref={imgRef} onLoad={(e) => decodeThenReveal(e.currentTarget)} onError={reveal} />
          : (cover && cover.type === 'svg'
            ? <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: cover.html }} />
            : cover)}
        {badge}
        <span className="count"><span className="count-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span className="count-label">{meta}</span></span>
        {!ready && <span className="cover-loading" aria-hidden="true" />}
      </div>
      <h4>{title}</h4><p>{meta}</p>
    </div>
  );
}

const likesCover = (
  <svg viewBox="0 0 400 400">
    <defs><linearGradient id="lk3" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ffa9c0"/><stop offset="1" stopColor="#fb7299"/>
    </linearGradient></defs>
    <rect width="400" height="400" fill="url(#lk3)"/>
    <path d="M200 300 C 120 240 90 195 90 155 C 90 118 118 95 152 95 C 176 95 193 108 200 126 C 207 108 224 95 248 95 C 282 95 310 118 310 155 C 310 195 280 240 200 300Z" fill="#fff"/>
  </svg>
);

export function GridMy() {
  const data = useSlice('lib.my');
  const A = window.biuActions;
  return (
    <div className="grid" id="grid-my">
      {data && (
        <>
          <GCard title="我喜欢" meta={`${data.likesCount} 首歌曲`} id="gcardLike"
            cover={likesCover}
            onClick={() => A.openPlaylist(A.likesPlaylist())} />
          <GCard title="音乐区热榜" meta="B 站音乐区" id="gcardRank"
            cover={{ type: 'svg', html: window.coverSVG(5) }}
            onClick={() => A.openPlaylist(A.rankingPlaylist())} />
          {data.playlists.map((p) => (
            <GCard key={`pl-${p.id}`} title={p.title} meta={`${p.count} 首歌曲`}
              extraAttrs={{ 'data-cpi': p.i }}
              cover={p.cover
                ? { type: 'img', src: p.cover }
                : (p.first
                  ? (p.first.pic
                    ? { type: 'img', src: p.first.pic, lazy: true }
                    : { type: 'svg', html: window.coverSVG(p.first.seed || 1, 400) })
                  : { type: 'svg', html: window.coverSVG(20 + (Number(p.id) % 12)) })}
              badge={(
                <span className="pl-del" role="button" aria-label="删除歌单" title="删除歌单"
                  onClick={(e) => { e.stopPropagation(); A.openPlDialog('delete', p.i); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </span>
              )}
              onClick={() => A.openPlaylist(A.customPlaylistDetail(p.raw))} />
          ))}
          <div className="gcard gcard-new" id="gcardNewPl" onClick={() => A.openPlDialog('create')}>
            <div className="cover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg></div>
            <h4>新建歌单</h4><p>创建本地歌单</p>
          </div>
        </>
      )}
    </div>
  );
}

// 父列表追加时只挂载新卡片。回调读取最新队列，避免 memo 后仍播放旧的分页数据。
const RecommendationCard = memo(function RecommendationCard({ track: t, index }) {
  return (
    <GCard title={t.title}
      meta={t.recommendationReason || t.up || t.tname || '音乐'}
      extraAttrs={{ 'data-ri': index }}
      cover={t.pic
        ? { type: 'img', src: t.pic, lazy: true }
        : { type: 'svg', html: window.coverSVG(t.seed || 1, 400) }}
      onClick={() => {
        const tracks = peek('lib.rec')?.tracks;
        if (tracks?.[index]) window.biuActions.setQueue(tracks, '为你推荐 · Bilibili', index);
      }} />
  );
});

export function GridRec() {
  const data = useSlice('lib.rec');
  return (
    <div className="grid" id="grid-rec">
      {data && (data.hint
        ? <div className="list-hint">{data.hint}</div>
        : data.tracks.map((t, i) => (
          <RecommendationCard key={`rec-${t.bvid || t.title}`} track={t} index={i} />
        )))}
    </div>
  );
}
