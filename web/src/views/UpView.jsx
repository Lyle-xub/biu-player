import React from 'react';
import { useSlice } from '../store.js';
import { VCard } from './VCard.jsx';

/* UP 主主页：DOM 与卡片/动态事件由组件拥有，controller 只 publish('up', ...)。
 * upFol / upTabs / upMore 的点击绑定仍在 controller initUpPage（id 不变），
 * tab 的 on class 与 upVideos/upDyns/upMoreWrap 的 hidden 由组件按 slice.tab 渲染。 */
export default function UpView() {
  const up = useSlice('up');
  const follows = useSlice('follows') || {};
  const A = window.biuActions;
  const mid = up ? up.mid : 0;
  const followed = !!follows[mid];
  const tab = up ? up.tab : 'video';
  const videos = up ? up.videos : [];
  const dyns = up ? up.dyns : [];
  const moreHidden = tab === 'video'
    ? (!videos.length || videos.length >= (up ? up.videoTotal : 0))
    : !(up && up.dynHasMore);
  return (
    <section className="view view-up">
      <div className="up-head">
        <span className="up-face" id="upFace">{up && up.face !== undefined
          ? (up.face
            ? <img src={up.face} alt="" />
            : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(70) }} />)
          : null}</span>
        <div className="up-head-meta">
          <h2 id="upName">{up ? up.name : '加载中…'}</h2>
          <p id="upSign">{up ? up.sign : ''}</p>
          <span className="up-stat" id="upStat">{up ? up.stat : ''}</span>
        </div>
        <button type="button" className={`fol up-fol${followed ? ' on' : ''}`} id="upFol">{followed ? '已关注' : '+ 关注'}</button>
      </div>
      <div className="up-tabs" id="upTabs">
        <button type="button" className={tab === 'video' ? 'on' : ''} data-utab="video">视频</button>
        <button type="button" className={tab === 'dyn' ? 'on' : ''} data-utab="dyn">动态</button>
      </div>
      <div className="vgrid" id="upVideos" hidden={tab !== 'video'}>
        {videos.length
          ? videos.map((t, i) => (
            <VCard key={`${t.bvid || t.title || 'v'}-${i}`} t={t} index={i}
              onClick={() => A.setQueue(videos, 'UP · ' + (up ? up.name : ''), i)} />
          ))
          : (up && up.videosHint ? <div className="list-hint">{up.videosHint}</div> : null)}
      </div>
      <div className="up-dyns" id="upDyns" hidden={tab !== 'dyn'}>
        {dyns.length
          ? dyns.map((d, i) => (
            <div key={`dyn-${d.bvid || i}`} className={`dyn-card${d.bvid ? ' dyn-video' : ''}`}
              data-bvid={d.bvid || undefined}
              onClick={d.bvid ? () => A.playDynVideo(d.bvid) : undefined}>
              <div className="dyn-body">
                {d.title ? <b>{d.title}</b> : null}
                {d.text ? <p>{d.text}</p> : null}
                <small>{d.time}</small>
              </div>
              {d.kind === 'video' && d.pic
                ? <div className="dyn-th"><img src={d.pic} loading="lazy" alt="" /><span className="dur-b num">视频</span></div>
                : (d.pic ? <div className="dyn-pic"><img src={d.pic} loading="lazy" alt="" /></div> : null)}
            </div>
          ))
          : (up && up.dynsHint ? <div className="list-hint">{up.dynsHint}</div> : null)}
      </div>
      <div className="sp-pager" id="upMoreWrap" hidden={moreHidden}>
        <button type="button" className="sp-btn" id="upMore">加载更多</button>
      </div>
    </section>
  );
}
