import React from 'react';
import { useSlice } from '../store.js';

/* 播放页 / 原视频页数据区组件集合：DOM 由组件拥有，controller 只 publish 数据。
 * 所有 id 保留（init 里的 $() 绑定与命令式逻辑继续工作）；
 * marquee/硬币飞起等动画 class 仍由 controller 直接操作（组件不渲染这些 class，React 不会回写）。 */

/* 默认大封面：原 shell npCover 骨架（旧版 DEFAULT_NP_COVER 的来源） */
const defaultNpCover = (
  <svg viewBox="0 0 460 460">
    <defs>
      <linearGradient id="pc" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8a7a3e"/><stop offset=".5" stopColor="#4a5228"/><stop offset="1" stopColor="#20260f"/>
      </linearGradient>
      <radialGradient id="sun" cx=".72" cy=".3" r=".5">
        <stop offset="0" stopColor="#ffe9a8" stopOpacity=".9"/><stop offset="1" stopColor="#ffe9a8" stopOpacity="0"/>
      </radialGradient>
    </defs>
    <rect width="460" height="460" fill="url(#pc)"/>
    <rect width="460" height="460" fill="url(#sun)"/>
    <g fill="#161b0a" opacity=".85">
      <rect x="60" y="0" width="16" height="460"/><rect x="150" y="-20" width="10" height="480"/>
      <rect x="250" y="0" width="20" height="460"/><rect x="360" y="-10" width="12" height="470"/>
    </g>
    <g fill="#2c3a14" opacity=".8">
      <ellipse cx="110" cy="120" rx="90" ry="46"/><ellipse cx="330" cy="90" rx="110" ry="50"/>
      <ellipse cx="230" cy="200" rx="120" ry="44"/>
    </g>
    <path d="M0 400 Q 230 350 460 400 L 460 460 L 0 460Z" fill="#12180a"/>
  </svg>
);

/* np-heading 内容：曲目信息 + 喜欢/收藏/歌单按钮（按钮点击绑定在 controller init，状态 class 来自 slice） */
export function NpInfo() {
  const np = useSlice('np');
  const acts = useSlice('npActions');
  const title = np ? np.title : '未在播放';
  const titleLen = Array.from(title).length;
  const src = np ? np.src : '来源 · —';
  const liked = !!(acts && acts.liked);
  const favored = !!(acts && acts.favored);
  return (
    <>
      <div className="np-artist" id="npArtist">{np ? np.artist : '—'}{np?.sourceArtist ? <span className="np-source-inline"> · {np.sourceArtist}</span> : null}</div>
      <div className="np-rule"></div>
      <h1 className={`np-title${titleLen > 28 ? ' title-long' : ''}${titleLen > 52 ? ' title-xlong' : ''}`} id="npTitle">{title}{np?.sourceTitle ? <span className="np-source-inline"> · {np.sourceTitle}</span> : null}</h1>
      <div className="np-album" id="npAlbum">{np ? np.album : ''}</div>
      <div className="np-src">
        <div className="np-src-meta">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3H6.2A3.2 3.2 0 0 0 3 6.2v11.6A3.2 3.2 0 0 0 6.2 21h11.6a3.2 3.2 0 0 0 3.2-3.2V6.2A3.2 3.2 0 0 0 17.8 3zm-9 13.5v-9l7 4.5z"/></svg>
        <span id="npSrc" title={src}>{src}</span>
        </div>
        <div className="np-src-tools" role="group" aria-label="原视频操作">
        <button type="button" className="np-src-split" id="btnSplit" title="MixSplitR 分切：把长视频按歌曲分割成歌单">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6 20 19M8.2 16.4 20 5"/></svg>
          <span>分切</span>
        </button>
        <button type="button" className="np-src-split" id="btnDownload" title="下载原视频" aria-haspopup="true" aria-expanded="false">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3V15M7 10L12 15L17 10M4 21H20"/></svg>
          <span>下载</span>
        </button>
        <button type="button" className="np-src-split" id="btnLyricMatch" title="手动匹配歌词 / 调整歌词时间">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/></svg>
          <span>歌词</span>
        </button>
        <button type="button" className="np-src-split" id="btnShare" title="分享音乐">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg>
          <span>分享</span>
        </button>
        </div>
      </div>
      <div className="np-actions" id="npActions">
        <button type="button" className={`np-fav-btn${liked ? ' on' : ''}`} id="btnLike" aria-pressed={String(liked)} title="我喜欢">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C7 16.5 4 13.3 4 9.8 4 7.2 6 5 8.7 5c1.6 0 2.8.7 3.3 1.7C12.5 5.7 13.7 5 15.3 5 18 5 20 7.2 20 9.8c0 3.5-3 6.7-8 11.2z"/></svg>
          <span>我喜欢</span>
        </button>
        <button type="button" className={`np-fav-btn${favored ? ' on' : ''}`} id="btnFav" aria-pressed={String(favored)} title="添加到收藏夹" aria-haspopup="true" aria-expanded="false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          <span>收藏</span>
        </button>
        <button type="button" className="np-fav-btn" id="btnAddPl" title="加入本地歌单" aria-haspopup="true" aria-expanded="false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M4 12h10M4 18h6M18 9v8M14 13h8"/></svg>
          <span>歌单</span>
        </button>
        <button type="button" className={`np-fav-btn${acts && acts.inLibrary ? ' on' : ''}`} id="btnLibrary" aria-pressed={String(!!(acts && acts.inLibrary))} title={acts && acts.inLibrary ? '已在音乐库' : '加入音乐库'}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h12M4 10h12M4 15h8"/><circle cx="17" cy="17" r="4"/><path d="M17 15v4M15 17h4"/></svg>
          <span>音乐库</span>
        </button>
      </div>
    </>
  );
}

/* 右侧大封面：有封面用 img，否则默认占位 SVG */
export function NpCover() {
  const np = useSlice('np');
  return (
    <div className="np-cover" id="npCover">
      {np && np.cover && np.cover.pic ? <img src={np.cover.pic} alt="" /> : defaultNpCover}
    </div>
  );
}

/* 热评胶囊：头像与文本一次发布；内容过渡由共享动画控制器负责。 */
export function HotComment() {
  const hc = useSlice('hotComment');
  return (
    <div className="hot-comment">
      <div className="hot-comment-content">
      <span className="hot-comment-avatar" id="hotCommentAvatar" aria-hidden="true">{hc && (hc.avatar || hc.seed != null)
        ? (hc.avatar
          ? <img src={hc.avatar} alt={hc.uname || '评论用户'} />
          : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(hc.seed) }} />)
        : <span className="cdot"></span>}</span>
      <span className="hot-comment-viewport" id="hotCommentViewport"><span className="hot-comment-text" id="hotCommentText">{hc ? hc.text : '暂无热评'}</span></span>
      </div>
    </div>
  );
}

/* 热门评论列表（视频模式左栏） */
export function CmtList() {
  const data = useSlice('comments');
  const list = data ? data.list : [];
  return (
    <div id="cmt-list">
      {list.map((r, i) => (
        <div className="cmt" key={`cmt-${i}`}>
          <span className="ava">{r.avatar
            ? <img src={r.avatar} alt="" />
            : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(r.seed || 94) }} />}</span>
          <span className="cb"><b>{r.uname}</b><p>{r.message}</p>
          <small><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm3.2 11V8.6l3.3-5.2c.7 1.9.4 3.7-.5 5.6h5.5a2 2 0 0 1 2 2.4l-1.6 8a2 2 0 0 1-2 1.6H10.2z"/></svg>{String(r.like)}</small></span>
        </div>
      ))}
    </div>
  );
}

/* 清晰度菜单：菜单项由 slice 渲染；open/close(hidden) 与点击切换仍由 controller 管
 *（vQuality 点击拉取并 publish，菜单容器的 delegation 监听在 init） */
export function VQualMenu() {
  const data = useSlice('vqual');
  return (
    <div className="vqual-menu" id="vQualityMenu" hidden={true}>
      {!data
        ? null
        : data.hint
          ? <div className="vqual-hint">{data.hint}</div>
          : data.options.map((item) => (
            <button type="button" key={item.quality}
              className={`vqual-item${item.quality === data.current ? ' on' : ''}`} data-vq={item.quality}>
              <b>{item.main}</b>{item.sub ? <small>{item.sub}</small> : null}
            </button>
          ))}
    </div>
  );
}

/* 原视频页信息区：标题 / UP 主条（关注态读 'follows' slice）/ 统计行（点赞、投币按钮 on 态读 'npActions'） */
export function VDetail() {
  const d = useSlice('vdetail');
  const acts = useSlice('npActions');
  const follows = useSlice('follows') || {};
  const followed = !!(d && d.mid && follows[d.mid]);
  return (
    <div className="vinfo">
      <h3 id="vTitle">{d ? d.title : '—'}</h3>
      <div className="vup">
        <span className="ava" id="vUpAva" role="button" title="进入 UP 主主页">{d && d.upFace ? <img src={d.upFace} alt="" /> : null}</span>
        <span><b id="vUpName">{d ? d.upName : '—'}</b><small id="vUpFans">{d ? d.upFans : ''}</small></span>
        <button type="button" className={`fol${followed ? ' on' : ''}`} id="vUpFol" data-fol={d && d.mid ? d.mid : ''}>{followed ? '已关注' : '+ 关注'}</button>
      </div>
      <div className="vstats">
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5v14l11-7z"/></svg><i id="vsPlay" style={{fontStyle:'normal'}}>{d ? d.vsPlay : '—'}</i></span>
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h10M4 18h13"/></svg><i id="vsDm" style={{fontStyle:'normal'}}>{d ? d.vsDm : '—'}</i> 弹幕</span>
        <button type="button" className={`vstat${acts && acts.vsLikeOn ? ' on' : ''}`} id="vsLikeBtn"><svg width="15" height="14" viewBox="0 0 1143 1000" fill="currentColor" fillRule="evenodd"><g transform="translate(0,1000) scale(1,-1)"><path d="M613 1000H619Q726 981 726 893Q720 740 720 720H1006Q1121 720 1143 619V595Q997 30 929 30Q880 0 792 0H339Q327 0 327 12V714Q496 934 566 988Q587 1000 613 1000ZM179 720H238Q250 718 250 708V12Q250 0 238 0H155Q0 19 0 137V565Q16 714 137 714Q137 720 179 720Z"/></g></svg><i id="vsLike" style={{fontStyle:'normal'}}>{d ? d.vsLike : '—'}</i></button>
        <button type="button" className={`vstat${acts && acts.vsCoinOn ? ' on' : ''}`} id="vsCoinBtn"><svg width="14" height="14" viewBox="0 0 1000 1000" fill="currentColor" fillRule="evenodd"><g transform="translate(0,1000) scale(1,-1)"><path d="M505 1000Q812 1000 969 677Q1000 580 1000 495Q1000 188 677 31Q580 0 495 0Q188 0 31 323Q0 420 0 505Q0 812 323 969Q420 1000 505 1000ZM281 771V750Q281 743 307 724H453Q464 722 464 714V661Q456 653 370 630Q240 564 240 385V375Q240 333 281 333Q303 340 313 359V385Q313 522 411 568Q421 573 458 578L464 568V224Q474 198 500 198Q526 198 536 224V568Q538 578 547 578Q655 578 688 417V359Q701 333 729 333Q757 333 760 385Q760 585 599 641Q536 652 536 661V714Q538 724 547 724H677Q703 724 714 750V755Q714 797 646 797H333Q293 797 281 771Z"/></g></svg>投币 <i id="vsCoin" style={{fontStyle:'normal'}}>{d ? d.vsCoin : '—'}</i></button>
        <button type="button" className={`vstat${acts && acts.vsFavOn ? ' on' : ''}`} id="vsFavBtn" aria-haspopup="true" aria-expanded="false"><svg width="15" height="14" viewBox="0 0 1043 1000" fill="currentColor" fillRule="evenodd"><g transform="translate(0,1000) scale(1,-1)"><path d="M532 1000Q554 1000 695 696Q1038 651 1038 630Q1043 621 1043 609Q1043 589 804 359Q858 49 858 27Q826 0 820 0Q731 42 522 152H516Q248 5 228 5H212Q185 21 185 38Q185 61 239 364Q3 581 0 603V614Q0 660 228 674Q353 691 353 707Q491 998 505 1000Z"/></g></svg>收藏 <i id="vsFav" style={{fontStyle:'normal'}}>{d ? d.vsFav : '—'}</i></button>
      </div>
    </div>
  );
}

/* 迷你播放条喜欢钮：状态 class 来自 'npActions' slice（点击绑定在 controller init） */
export function PpLike() {
  const acts = useSlice('npActions');
  const liked = !!(acts && acts.liked);
  return (
    <button type="button" className={`pp-like${liked ? ' on' : ''}`} id="ppLike" aria-label="喜欢" title="喜欢">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20.4C7.1 16.5 3.7 13.2 3.7 9.6 3.7 7.1 5.7 5.1 8.1 5.1c1.5 0 3 .8 3.9 2 .9-1.2 2.4-2 3.9-2 2.4 0 4.4 2 4.4 4.5 0 3.6-3.4 6.9-8.3 10.8z"/></svg>
    </button>
  );
}
