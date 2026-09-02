import React from 'react';

// React 只负责渲染与 renderer/index.html 完全一致的 DOM 骨架；
// 所有交互行为由挂载后动态加载的旧版 controller 模块接管。

function BackdropLayers() {
  return (
    <>
      {/* ============ 背景层 ============ */}
      <div className="backdrop"><div className="blob b1"></div><div className="blob b2"></div><div className="blob b3"></div><div className="blob b4"></div></div>
      <div className="art-backdrop-drift" aria-hidden="true"><div className="art-backdrop" id="artBackdrop"></div></div>
      <div className="grain"></div>
      <div className="topbar-bg"></div>
      <div className="window-drag-region" aria-hidden="true"></div>
    </>
  );
}

function WinControls() {
  return (
    <>
      {/* 窗口控制（Electron 内生效，浏览器预览时隐藏） */}
      <div className="win-controls" id="winControls" style={{display:'none'}}>
        {/* 图标路径选自阿里巴巴 Ant Design Icons（MIT），内联后离线可用。 */}
        <span id="winMin"><svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M160 480h704c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H160c-8.8 0-16-7.2-16-16v-32c0-8.8 7.2-16 16-16z"/></svg></span>
        <span id="winMax"><svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zm-40 728H184V184h656v656z"/></svg></span>
        <span id="winClose"><svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M563.8 512l262.5-312.9c4.4-5.2.7-13.1-6.1-13.1h-79.8c-4.7 0-9.2 2.1-12.3 5.7L511.6 449.8 295.1 191.7c-3-3.6-7.5-5.7-12.3-5.7H203c-6.8 0-10.5 7.9-6.1 13.1L459.4 512 196.9 824.9c-4.4 5.2-.7 13.1 6.1 13.1h79.8c4.7 0 9.2-2.1 12.3-5.7l216.5-258.1 216.5 258.1c3 3.6 7.5 5.7 12.3 5.7h79.8c6.8 0 10.5-7.9 6.1-13.1L563.8 512z"/></svg></span>
      </div>
    </>
  );
}

function Topbar() {
  return (
    <>
      {/* ============ 顶栏 ============ */}
      <header className="topbar">
        <div className="brand" onClick={() => window.biuUi?.go('library')}>
          <span className="dot"></span>Biu
          <span className="gear" onClick={(e) => { e.stopPropagation(); window.biuUi?.openPanel('settings'); }}><svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor"><path d="M924.8 625.7l-65.5-56c3.1-19 4.7-38.4 4.7-57.8s-1.6-38.8-4.7-57.8l65.5-56c10.1-8.6 13.8-22.6 9.3-35.2l-2.6-7.3a281.6 281.6 0 00-76-131.6l-4.9-5.2c-11.3-12-27.1-16.4-42.3-11.9l-76 22.4c-28.9-24.1-61.8-42.6-97.6-54.6l-21-73.9c-3.6-12.7-14.3-22.5-27.2-25.1l-7.5-1.4a281 281 0 00-154.5 0l-7.5 1.4c-12.9 2.6-23.6 12.4-27.2 25.1l-21 73.9c-35.8 12-68.7 30.5-97.6 54.6l-76-22.4c-15.2-4.5-31-.1-42.3 11.9l-4.9 5.2a281.6 281.6 0 00-76 131.6l-2.6 7.3c-4.5 12.6-.8 26.6 9.3 35.2l65.5 56c-3.1 19-4.7 38.4-4.7 57.8s1.6 38.8 4.7 57.8l-65.5 56c-10.1 8.6-13.8 22.6-9.3 35.2l2.6 7.3a281.6 281.6 0 0076 131.6l4.9 5.2c11.3 12 27.1 16.4 42.3 11.9l76-22.4c28.9 24.1 61.8 42.6 97.6 54.6l21 73.9c3.6 12.7 14.3 22.5 27.2 25.1l7.5 1.4a281 281 0 00154.5 0l7.5-1.4c12.9-2.6 23.6-12.4 27.2-25.1l21-73.9c35.8-12 68.7-30.5 97.6-54.6l76 22.4c15.2 4.5 31 .1 42.3-11.9l4.9-5.2a281.6 281.6 0 0076-131.6l2.6-7.3c4.5-12.6.8-26.6-9.3-35.2zM512 704c-106 0-192-86-192-192s86-192 192-192 192 86 192 192-86 192-192 192z"/></svg></span>
        </div>
        <nav className="seg pill" id="mainNav">
          <button data-v="library" className="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18.5V6.8L20 4.5v11.7"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="16.2" r="2.5"/></svg><span>歌单</span></button>
          <button data-v="fav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6L3.8 9.5l5.7-.7z"/></svg><span>收藏夹</span></button>
          <button data-v="radio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/></svg><span>电台</span></button>
          <button data-v="search" className="nav-search-tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span>搜索</span></button>
        </nav>
        <div className="top-right">
          <button className="nav-back pill" id="navBack" type="button" aria-label="返回上一页" title="返回上一页">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
          </button>
          <div className="search pill" onClick={() => window.biuUi?.go('search')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            搜索 B 站音乐、UP 主…
          </div>
        </div>
      </header>
    </>
  );
}

function ViewLibrary() {
  return (
    <>
      {/* ================= 歌单库 ================= */}
      <section className="view view-library">
        <div className="shelf">
          <div className="card main" id="cardLike">
            <div className="cover">
              <svg viewBox="0 0 400 400">
                <defs><linearGradient id="lk" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffa9c0"/><stop offset="1" stopColor="#fb7299"/>
                </linearGradient></defs>
                <rect width="400" height="400" fill="url(#lk)"/>
                <path d="M200 300 C 120 240 90 195 90 155 C 90 118 118 95 152 95 C 176 95 193 108 200 126 C 207 108 224 95 248 95 C 282 95 310 118 310 155 C 310 195 280 240 200 300Z" fill="#fff"/>
              </svg>
              <span className="count shelf-count"><span className="count-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span className="count-label" id="shelfLikeCount">0 首歌曲</span></span>
            </div>
            <h3>我喜欢</h3>
            <p>本地收藏</p>
          </div>
          <div className="card side side-r" id="cardRank">
            <div className="cover" data-cover="5"><span className="count shelf-count"><span className="count-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span className="count-label">B 站音乐区</span></span></div>
            <h3>音乐区热榜</h3>
            <p>歌单</p>
          </div>
          <div className="card far" id="cardHistory">
            <div className="cover" data-cover="9"><span className="count shelf-count"><span className="count-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span className="count-label">最近播放</span></span></div>
            <h3>我的历史</h3>
            <p>最近播放</p>
          </div>
        </div>

        <div className="shelf-meta">
          <h2 id="shelfTitle">我喜欢</h2>
          <p id="shelfMeta">0 首歌曲<i>·</i>本地收藏</p>
        </div>

        <section className="sec">
          <h2>我的歌单<small id="gridMyCount"></small></h2>
          <div className="grid" id="grid-my"></div>
        </section>
        <section className="sec">
          <h2>为你推荐<small id="recSource">B 站个性化音乐信息流</small></h2>
          <div className="grid" id="grid-rec"></div>
          <div className="recommendation-loader" id="recLoader">向下滚动加载更多</div>
        </section>
      </section>
    </>
  );
}

function ViewFav() {
  return (
    <>
      {/* ================= 收藏夹 ================= */}
      <section className="view view-fav">
        <section className="sec" style={{marginTop:0}}>
          <h2>我的收藏夹<small>与 B 站同步</small></h2>
          <div className="grid" id="grid-fav"></div>
        </section>
      </section>
    </>
  );
}

function ViewRadio() {
  return (
    <>
      {/* ================= 电台 ================= */}
      <section className="view view-radio">
        <section className="sec" style={{marginTop:0}} id="liveFollowsSec" hidden={true}>
          <h2>关注的主播<small>正在直播</small></h2>
          <div className="live-follows" id="liveFollows"></div>
        </section>
        <section className="sec" style={{marginTop:0}}>
          <h2>音乐电台<small>24 小时不间断 · 下滑加载更多</small></h2>
          <div className="grid" id="grid-radio"></div>
        </section>
      </section>
    </>
  );
}

function ViewPlaylist() {
  return (
    <>
      {/* ================= 歌单详情 ================= */}
      <section className="view view-playlist">
        <div className="pl-head">
          <div className="pl-cover" id="plCover">
            <svg viewBox="0 0 400 400">
              <defs><linearGradient id="lk2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffa9c0"/><stop offset="1" stopColor="#fb7299"/>
              </linearGradient></defs>
              <rect width="400" height="400" fill="url(#lk2)"/>
              <path d="M200 300 C 120 240 90 195 90 155 C 90 118 118 95 152 95 C 176 95 193 108 200 126 C 207 108 224 95 248 95 C 282 95 310 118 310 155 C 310 195 280 240 200 300Z" fill="#fff"/>
            </svg>
          </div>
          <div className="pl-info">
            <div className="label-caps" id="plLabel">收藏夹 · Bilibili</div>
            <div className="pl-title-row">
              <h1 id="plTitle">我喜欢</h1>
            </div>
            <input id="plTitleEdit" className="pl-edit-input pl-edit-title" maxLength="40" autocomplete="off" hidden={true} />
            <p className="pl-desc" id="plDesc">所有在 B 站点过「收藏」的音乐视频与音频，自动转存为可连续播放的歌单。</p>
            <input id="plDescEdit" className="pl-edit-input pl-edit-desc" maxLength="60" autocomplete="off" placeholder="歌单简介（可选）" hidden={true} />
            <div className="pl-meta" id="plMeta"></div>
            <div className="pl-actions">
              <button className="btn-primary" id="btnPlayAll">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                播放全部
              </button>
              <button className="btn-ghost" id="btnPlShuffle">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
                随机播放
              </button>
            </div>
          </div>
        </div>
        <div className="tlist">
          <div className="thead"><span>#</span><span>标题</span><span>UP 主</span><span>时长</span><span></span></div>
          <div id="list-playlist"></div>
        </div>
      </section>
    </>
  );
}

function ViewSearch() {
  return (
    <>
      {/* ================= 搜索 ================= */}
      <section className="view view-search">
        <div className="search-hero">
          <div className="box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input id="searchInput" placeholder="搜索 B 站音乐、UP 主…" autocomplete="off" />
            <span className="caret"></span>
          </div>
        </div>

        {/* 结果筛选：排序 + 更多筛选（时长） */}
        <div className="search-filters">
          <div className="sf-orders" id="sfOrders">
            <button type="button" className="on" data-order="">综合排序</button>
            <button type="button" data-order="click">最多播放</button>
            <button type="button" data-order="pubdate">最新发布</button>
            <button type="button" data-order="dm">最多弹幕</button>
            <button type="button" data-order="stow">最多收藏</button>
          </div>
          <div className="sf-more" id="sfMore">
            <button type="button" className="sf-more-btn" id="sfMoreBtn" aria-haspopup="true" aria-expanded="false">
              更多筛选
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div className="sf-drop" id="sfDrop" hidden={true}>
              <div className="sf-drop-title">时长</div>
              <div className="sf-durs" id="sfDurs">
                <button type="button" className="on" data-dur="0">全部</button>
                <button type="button" data-dur="1">10 分钟以下</button>
                <button type="button" data-dur="2">10-30 分钟</button>
                <button type="button" data-dur="3">30-60 分钟</button>
                <button type="button" data-dur="4">60 分钟以上</button>
              </div>
            </div>
          </div>
        </div>

        <section className="sec" style={{marginTop:0}} data-sec="up">
          <h2>UP 主</h2>
          <div className="ups" id="ups"></div>
        </section>
        <section className="sec" data-sec="video">
          <h2>相关视频</h2>
          <div className="vgrid" id="vgrid"><div className="list-hint">输入关键词，回车搜索</div></div>
          <div className="sp-pager" id="spPager" hidden={true}>
            <button type="button" className="sp-btn" id="spPrev">上一页</button>
            <span className="sp-page num" id="spPageLabel">1 / 1</span>
            <button type="button" className="sp-btn" id="spNext">下一页</button>
          </div>
        </section>
      </section>
    </>
  );
}

function ViewUp() {
  return (
    <>
      {/* ================= UP 主主页 ================= */}
      <section className="view view-up">
        <div className="up-head">
          <span className="up-face" id="upFace"></span>
          <div className="up-head-meta">
            <h2 id="upName">加载中…</h2>
            <p id="upSign"></p>
            <span className="up-stat" id="upStat"></span>
          </div>
          <button type="button" className="fol up-fol" id="upFol">+ 关注</button>
        </div>
        <div className="up-tabs" id="upTabs">
          <button type="button" className="on" data-utab="video">视频</button>
          <button type="button" data-utab="dyn">动态</button>
        </div>
        <div className="vgrid" id="upVideos"></div>
        <div className="up-dyns" id="upDyns" hidden={true}></div>
        <div className="sp-pager" id="upMoreWrap" hidden={true}>
          <button type="button" className="sp-btn" id="upMore">加载更多</button>
        </div>
      </section>
    </>
  );
}

function ViewPlaying() {
  return (
    <>
      {/* ================= 播放页 ================= */}
      <section className="view view-playing">
        <div className="np-left">
          <div className="np-heading" id="npHeading">
            <div className="np-artist" id="npArtist">—</div>
            <div className="np-rule"></div>
            <h1 className="np-title" id="npTitle">未在播放</h1>
            <div className="np-album" id="npAlbum"></div>
            <div className="np-src">
              <div className="np-src-meta">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3H6.2A3.2 3.2 0 0 0 3 6.2v11.6A3.2 3.2 0 0 0 6.2 21h11.6a3.2 3.2 0 0 0 3.2-3.2V6.2A3.2 3.2 0 0 0 17.8 3zm-9 13.5v-9l7 4.5z"/></svg>
              <span id="npSrc">来源 · —</span>
              </div>
              <div className="np-src-tools" role="group" aria-label="原视频操作">
              <button type="button" className="np-src-split" id="btnSplit" title="MixSplitR 分切：把长视频按歌曲分割成歌单">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6 20 19M8.2 16.4 20 5"/></svg>
                <span>分切</span>
              </button>
              <button type="button" className="np-src-split" id="btnDownload" title="下载原视频" aria-haspopup="true" aria-expanded="false">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16"/></svg>
                <span>下载</span>
              </button>
              <button type="button" className="np-src-split" id="btnLyricMatch" title="手动匹配歌词 / 调整歌词时间">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/></svg>
                <span>歌词</span>
              </button>
              </div>
            </div>
            <div className="np-actions" id="npActions">
              <button type="button" className="np-fav-btn" id="btnLike" aria-pressed="false" title="我喜欢">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C7 16.5 4 13.3 4 9.8 4 7.2 6 5 8.7 5c1.6 0 2.8.7 3.3 1.7C12.5 5.7 13.7 5 15.3 5 18 5 20 7.2 20 9.8c0 3.5-3 6.7-8 11.2z"/></svg>
                <span>我喜欢</span>
              </button>
              <button type="button" className="np-fav-btn" id="btnFav" aria-pressed="false" title="添加到收藏夹" aria-haspopup="true" aria-expanded="false">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                <span>收藏</span>
              </button>
              <button type="button" className="np-fav-btn" id="btnAddPl" title="加入本地歌单" aria-haspopup="true" aria-expanded="false">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M4 12h10M4 18h6M18 9v8M14 13h8"/></svg>
                <span>歌单</span>
              </button>
            </div>
          </div>
          {/* 收藏夹弹层放在 np-heading 外：heading 的 contain:layout 会把 fixed 后代关进自身并裁掉 */}
          <div className="fav-pop" id="favPop" hidden={true}>
            <div className="fav-pop-title">添加到收藏夹</div>
            <div className="fav-pop-list" id="favPopList"><div className="fav-pop-hint">加载中…</div></div>
          </div>
          <div className="fav-pop" id="plPop" hidden={true}>
            <div className="fav-pop-title">加入本地歌单</div>
            <div className="fav-pop-list" id="plPopList"></div>
          </div>
          {/* 下载清晰度菜单：同样放 np-heading 外防裁剪 */}
          <div className="dl-menu" id="dlMenu" hidden={true}></div>

          {/* 歌词：播放时由 JS 注入 AI 字幕时间轴歌词 */}
          <div className="lyrics" id="lyrics">
            <div className="hint">选择一首歌曲开始播放</div>
          </div>

          {/* 视频模式：左栏换为热门评论 */}
          <div className="np-comments">
            <h4>热门评论</h4>
            <div id="cmt-list"></div>
          </div>
        </div>

        <div className="hot-comment">
          <span className="hot-comment-avatar" id="hotCommentAvatar" aria-hidden="true"><span className="cdot"></span></span>
          <span className="hot-comment-viewport" id="hotCommentViewport"><span id="hotCommentText">暂无热评</span></span>
        </div>

        {/* 歌词模式：右侧大封面（JS 注入真实封面 img） */}
        <div className="np-cover" id="npCover">
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
        </div>

        {/* 视频模式：右侧播放 B 站原视频，高清档位使用 DASH 音视频双轨 */}
        <div className="np-video">
          <div className="vframe" id="vframe">
            <video id="originalVideo" playsInline preload="metadata" crossOrigin="anonymous"></video>
            <div className="danmaku-layer" id="danmakuLayer" aria-hidden="true"></div>
            <div className="video-status" id="videoStatus">
              <span className="video-spinner"></span><b>原视频加载中…</b>
            </div>
            <div className="vbar" id="vbar">
              <div className="vtrack" id="vTrack" role="slider" tabIndex="0" aria-label="视频播放进度" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><i id="vFill"></i></div>
              <div className="vrow">
                <button className="vic" id="vPlay" type="button" aria-label="播放或暂停">
                  <svg id="vVideoIcPlay" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <svg id="vVideoIcPause" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{display:'none'}}><path d="M8 5v14M16 5v14"/></svg>
                </button>
                <span className="vtime" id="vTime">00:00 / 00:00</span>
                <span className="vsp"></span>
                <button className="vic" id="vMute" type="button" aria-label="静音" aria-pressed="false">
                  <svg id="vIcSound" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/></svg>
                  <svg id="vIcMuted" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{display:'none'}}><path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/></svg>
                </button>
                <button className="vqual" id="vQuality" type="button" aria-haspopup="true"><b>原画</b></button>
                <button className="vic dm-toggle" id="vDmToggle" type="button" aria-label="关闭弹幕" aria-pressed="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h5M7 14h8M16 10h1"/></svg>
                </button>
                <button className="vic" id="vFullscreen" type="button" aria-label="应用内铺满" aria-pressed="false">
                  <svg id="vIcExpand" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>
                  <svg id="vIcCompress" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{display:'none'}}><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/></svg>
                </button>
              </div>
            </div>
            <div className="vqual-menu" id="vQualityMenu" hidden={true}></div>
          </div>

          <div className="vinfo">
            <h3 id="vTitle">—</h3>
            <div className="vup">
              <span className="ava" id="vUpAva" role="button" title="进入 UP 主主页"></span>
              <span><b id="vUpName">—</b><small id="vUpFans"></small></span>
              <button type="button" className="fol" id="vUpFol" data-fol="">+ 关注</button>
            </div>
            <div className="vstats">
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5v14l11-7z"/></svg><i id="vsPlay" style={{fontStyle:'normal'}}>—</i></span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h10M4 18h13"/></svg><i id="vsDm" style={{fontStyle:'normal'}}>—</i> 弹幕</span>
              <button type="button" className="vstat" id="vsLikeBtn"><svg width="15" height="14" viewBox="0 0 1143 1000" fill="currentColor" fillRule="evenodd"><g transform="translate(0,1000) scale(1,-1)"><path d="M613 1000H619Q726 981 726 893Q720 740 720 720H1006Q1121 720 1143 619V595Q997 30 929 30Q880 0 792 0H339Q327 0 327 12V714Q496 934 566 988Q587 1000 613 1000ZM179 720H238Q250 718 250 708V12Q250 0 238 0H155Q0 19 0 137V565Q16 714 137 714Q137 720 179 720Z"/></g></svg><i id="vsLike" style={{fontStyle:'normal'}}>—</i></button>
              <button type="button" className="vstat" id="vsCoinBtn"><svg width="14" height="14" viewBox="0 0 1000 1000" fill="currentColor" fillRule="evenodd"><g transform="translate(0,1000) scale(1,-1)"><path d="M505 1000Q812 1000 969 677Q1000 580 1000 495Q1000 188 677 31Q580 0 495 0Q188 0 31 323Q0 420 0 505Q0 812 323 969Q420 1000 505 1000ZM281 771V750Q281 743 307 724H453Q464 722 464 714V661Q456 653 370 630Q240 564 240 385V375Q240 333 281 333Q303 340 313 359V385Q313 522 411 568Q421 573 458 578L464 568V224Q474 198 500 198Q526 198 536 224V568Q538 578 547 578Q655 578 688 417V359Q701 333 729 333Q757 333 760 385Q760 585 599 641Q536 652 536 661V714Q538 724 547 724H677Q703 724 714 750V755Q714 797 646 797H333Q293 797 281 771Z"/></g></svg>投币 <i id="vsCoin" style={{fontStyle:'normal'}}>—</i></button>
              <button type="button" className="vstat" id="vsFavBtn" aria-haspopup="true" aria-expanded="false"><svg width="15" height="14" viewBox="0 0 1043 1000" fill="currentColor" fillRule="evenodd"><g transform="translate(0,1000) scale(1,-1)"><path d="M532 1000Q554 1000 695 696Q1038 651 1038 630Q1043 621 1043 609Q1043 589 804 359Q858 49 858 27Q826 0 820 0Q731 42 522 152H516Q248 5 228 5H212Q185 21 185 38Q185 61 239 364Q3 581 0 603V614Q0 660 228 674Q353 691 353 707Q491 998 505 1000Z"/></g></svg>收藏 <i id="vsFav" style={{fontStyle:'normal'}}>—</i></button>
            </div>
          </div>
        </div>

        {/* 电台使用独立直播画面，不复用歌曲播放页。 */}
        <div className="live-stage" id="liveStage">
          <video id="liveVideo" playsInline preload="auto" crossOrigin="anonymous"></video>
          <div className="danmaku-layer live-dm" id="liveDmLayer" aria-hidden="true"></div>
          <div className="live-loading" id="liveStatus"><span className="video-spinner"></span><b>正在连接直播…</b></div>
          <div className="live-chrome">
            <span className="live-mark"><i></i> LIVE</span>
            <span className="live-copy"><b id="liveTitle">直播电台</b><small id="liveUp">正在连接</small></span>
            <span className="lc-actions">
              <button className="lc-btn on" id="liveDmToggle" type="button" aria-label="弹幕" aria-pressed="true" title="弹幕">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h5M7 14h8M16 10h1"/></svg>
              </button>
              <button className="lc-btn" id="liveTheater" type="button" aria-label="应用内铺满" aria-pressed="false" title="应用内铺满">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M8.5 15.5l6-6M14.5 15.5v-6h-6"/></svg>
              </button>
              <button className="lc-btn" id="liveFs" type="button" aria-label="全屏" aria-pressed="false" title="全屏">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>
              </button>
              <button id="liveToggle" type="button" aria-label="播放或暂停直播">
                <svg id="liveIcPlay" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <svg id="liveIcPause" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{display:'none'}}><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>
              </button>
            </span>
          </div>
        </div>

        {/* 直播模式：返回上一页 */}
        <button className="live-back pill" id="liveBack" type="button" aria-label="返回上一页" title="返回上一页">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          返回
        </button>

        <div className="mode-btn pill" onClick={() => window.biuUi?.openPanel('queue')} title="播放队列">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2.2"/><circle cx="8" cy="16" r="2.2"/></svg>
        </div>

        <div className="viz" id="viz"></div>
      </section>
    </>
  );
}

function SharedOverlays() {
  return (
    <>
      {/* ============ 底部共享浮层 ============ */}
      <div className="mode-seg pill">
        <button type="button" className="on" id="btnLyric" aria-pressed="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h10M4 18h13"/></svg>
          歌词
        </button>
        <button type="button" id="btnVideo" aria-pressed="false">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none"/></svg>
          原视频
        </button>
      </div>
      <button className="home-btn pill" id="homeBtn" type="button" aria-label="返回首页" title="返回首页">
        <svg viewBox="0 0 1024 1024" fill="currentColor"><path d="M946.5 505 560.1 118.8l-25.9-25.9a31.5 31.5 0 0 0-44.4 0L77.5 505a63.9 63.9 0 0 0 44.4 109.2h43.3V940c0 17.7 14.3 32 32 32h245V744h112v228h272.7c17.7 0 32-14.3 32-32V614.2h44.7c56.9 0 85.5-68.8 42.9-109.2zM512 168.7l367.7 367.5h-92.8V900H618V680H406v220H237.1V536.2h-92.8L512 168.7z"/></svg>
      </button>
      {/* 歌词页 / 原视频页共用的「返回上一页」下降钮：与主页按钮同排对齐 */}
      <button className="page-down pill" id="npDownBtn" type="button" aria-label="返回上一页" title="返回上一页">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>

      <div className="progress-pill pill">
        <img className="pp-cover" id="ppCover" alt="" hidden={true} />
        <div className="progress-main">
          <span className="num" id="ppCur">00:00</span>
          <div className="track" id="ppTrack"><i id="ppFill" style={{width:'0%'}}></i></div>
          <span className="num" id="ppDur">00:00</span>
        </div>
        <div className="progress-controls" aria-label="播放控制">
          <button type="button" className="pp-play" id="ppToggle" aria-label="播放或暂停">
            <svg id="ppIcPlay" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg id="ppIcPause" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{display:'none'}}><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>
          </button>
          <button type="button" className="pp-step" id="ppPrev" aria-label="上一首" title="上一首">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h2.5v16H6zM20 5v14L9.5 12z"/></svg>
          </button>
          <span className="pp-title" id="ppTitle">未在播放</span>
          <button type="button" className="pp-like" id="ppLike" aria-label="喜欢" title="喜欢">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20.4C7.1 16.5 3.7 13.2 3.7 9.6 3.7 7.1 5.7 5.1 8.1 5.1c1.5 0 3 .8 3.9 2 .9-1.2 2.4-2 3.9-2 2.4 0 4.4 2 4.4 4.5 0 3.6-3.4 6.9-8.3 10.8z"/></svg>
          </button>
          <button type="button" className="pp-step" id="ppNext" aria-label="下一首" title="下一首">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 4H18v16h-2.5zM4 5v14l10.5-7z"/></svg>
          </button>
          <button type="button" id="ppMode" aria-label="切换播放模式" title="列表循环">
            <svg id="ppModeIcon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>
          </button>
          <button type="button" id="ppQueue" aria-label="打开播放队列" title="播放队列">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 6h12M8 12h12M8 18h8"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></svg>
          </button>
        </div>
        <div className="live-progress-info" aria-live="polite">
          <span className="live-progress-dot"></span>
          <span className="live-progress-copy">
            <b id="liveDockTitle">直播电台</b>
            <small id="liveDockMeta">正在连接</small>
          </span>
        </div>
      </div>

      <div className="queue-btn pill" onClick={() => window.biuUi?.openPanel('queue')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
        队列 · <span id="queueCount">0</span>
      </div>

      <div className="mini-player pill">
        <span className="mcover" id="mcArtHolder" title="打开播放页">
          <svg className="art" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2e5c3f"/><circle cx="50" cy="60" r="26" fill="#cfe8b0"/><rect x="0" y="70" width="100" height="30" fill="#1c3a28"/></svg>
          <svg className="ring" viewBox="0 0 48 48"><circle className="tr" cx="24" cy="24" r="21"/><circle className="pg" id="ringPg" cx="24" cy="24" r="21"/></svg>
        </span>
        <span className="sep"></span>
        <span className="pbtn" id="btnPrev" title="上一首"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h2.5v16H6zM20 5v14L9.5 12z"/></svg></span>
        <span className="pbtn play" id="btnToggle" title="播放 / 暂停">
          <svg id="icPlay" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg id="icPause" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" style={{display:'none'}}><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>
        </span>
        <span className="pbtn" id="btnNext" title="下一首"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 4H18v16h-2.5zM4 5v14l10.5-7z"/></svg></span>
        <span className="sep"></span>
        <span className="pbtn vol" id="btnVol" title="音量">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6.5 9H3v6h3.5L11 19V5z" fill="currentColor" stroke="none"/><path id="volWave" d="M15 9.5a4 4 0 0 1 0 5M17.5 7a8 8 0 0 1 0 10"/></svg>
          <span className="vol-pop pill"><span className="vol-track" id="volTrack"><i id="volFill"></i></span></span>
        </span>
      </div>
    </>
  );
}

function QueueDrawer() {
  return (
    <>
      {/* ============ 播放队列抽屉 ============ */}
      <div className="drawer-mask" onClick={() => window.biuUi?.closePanel()}></div>
      <aside className="drawer">
        <header>
          <h3>播放队列</h3><small id="qMeta">0 首</small>
          <span className="close" onClick={() => window.biuUi?.closePanel()}><svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
        </header>
        <div className="qlist" id="qlist"></div>
        <footer><span id="qMode">列表循环</span><span id="qClear">清空队列</span><span id="qLocate">定位当前</span></footer>
      </aside>
    </>
  );
}

function SettingsModal() {
  return (
    <>
      {/* ============ 设置弹窗 ============ */}
      <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) window.biuUi?.closePanel(); }}>
        <div className="modal">
          <h3>设置</h3>
          <div className="mrow">
            <div className="ml"><b>B 站账号</b><small id="authSubtitle">扫码或手机验证码安全登录</small></div>
            <div className="mr auth-actions" id="authLoggedOut">
              <button className="btn-ghost" id="btnQrLogin">扫码登录</button>
              <button className="btn-ghost" id="btnCodeLogin">验证码</button>
            </div>
            <div className="mr auth-user" id="authLoggedIn" hidden={true}>
              <img id="authFace" alt="" />
              <b id="authName">已登录</b>
              <button className="auth-logout" id="btnLogout">退出</button>
            </div>
          </div>
          <div className="mrow">
            <div className="ml"><b>在线音质</b><small>B 站音频流码率，无损需登录/大会员</small></div>
            <div className="mr"><span className="mseg" id="segQuality"><button data-q="0">标准</button><button data-q="1" className="on">高品</button><button data-q="2">无损</button></span></div>
          </div>
          <div className="mrow">
            <div className="ml"><b>视频清晰度</b><small>原视频模式默认清晰度</small></div>
            <div className="mr"><span className="mseg" id="segVQuality"><button data-vq="64">720P</button><button data-vq="80" className="on">1080P</button><button data-vq="120">4K</button></span></div>
          </div>
          <div className="mrow">
            <div className="ml"><b>弹幕</b><small>视频模式下默认开启弹幕</small></div>
            <div className="mr"><span className="switch" id="swDanmaku"></span></div>
          </div>
          <div className="mrow">
            <div className="ml"><b>同步观看记录</b><small>播放时把记录上报到 B 站历史，需登录</small></div>
            <div className="mr"><span className="switch off" id="swSyncHistory"></span></div>
          </div>
          <div className="mrow">
            <div className="ml"><b>背景模糊度</b><small>沉浸式封面背景的模糊强度</small></div>
            <div className="mr"><span className="slider" id="slBlur"><i></i></span></div>
          </div>
          <div className="mrow">
            <div className="ml"><b>桌面歌词</b><small>在屏幕上悬浮显示歌词</small></div>
            <div className="mr"><span className="switch off" id="swLyric"></span></div>
          </div>
          <div className="mfoot">BIU PLAYER · v0.5.0 · 基于 BILIBILI 公开接口</div>
        </div>
      </div>
    </>
  );
}

function LoginModal() {
  return (
    <>
      {/* ============ 登录弹窗：扫码 / 手机验证码 ============ */}
      <div className="login-mask" id="qrLoginMask">
        <div className="login-card">
          <button className="login-close" id="btnCloseQr" aria-label="关闭">×</button>
          <span className="login-kicker">BILIBILI CONNECT</span>
          <div className="login-tabs" role="tablist">
            <button className="on" id="tabQrLogin" role="tab" aria-selected="true">扫码登录</button>
            <button id="tabSmsLogin" role="tab" aria-selected="false">验证码登录</button>
          </div>
          <div className="login-pane" id="paneQr">
            <p>使用哔哩哔哩客户端扫码，并在手机上确认</p>
            <div className="qr-shell" id="qrShell">
              <img id="qrImage" alt="B 站登录二维码" />
              <div className="qr-state" id="qrState">正在生成二维码…</div>
            </div>
            <div className="login-status" id="qrStatus">请使用哔哩哔哩客户端扫码</div>
            <div className="login-buttons">
              <button className="btn-primary" id="btnRefreshQr">刷新二维码</button>
            </div>
          </div>
          <div className="login-pane" id="paneSms" hidden={true}>
            <p>使用手机号 + 短信验证码登录，全程在应用内完成</p>
            <div className="sms-form">
              <label className="sms-field">
                <span className="sms-prefix">+86</span>
                <input id="smsPhone" type="tel" maxLength="11" placeholder="手机号" autocomplete="tel" />
              </label>
              <div className="sms-code-row">
                <label className="sms-field">
                  <input id="smsCode" type="text" inputMode="numeric" maxLength="6" placeholder="6 位验证码" autocomplete="one-time-code" />
                </label>
                <button className="btn-ghost" id="btnSmsSend" type="button">获取验证码</button>
              </div>
              <div className="geetest-slot" id="geetestSlot"></div>
              <div className="login-status" id="smsStatus"></div>
              <button className="btn-primary" id="btnSmsLogin" type="button">登录</button>
            </div>
          </div>
          <small>登录凭证由 Electron 会话安全保存，不写入页面存储。</small>
        </div>
      </div>
    </>
  );
}

function PlDialog() {
  return (
    <>
      {/* ============ 歌单新建 / 删除对话框 ============ */}
      <div className="pl-dialog-mask" id="plDialogMask" hidden={true}>
        <div className="pl-dialog" role="dialog" aria-modal="true">
          <h3 id="plDialogTitle">新建歌单</h3>
          <p id="plDialogMsg"></p>
          <div className="pl-cpicker" id="plDialogCoverCard" role="button" aria-label="选择歌单封面" hidden={true}>
            <span className="pl-cpicker-cover" id="plDialogCoverImg"></span>
            <b className="pl-cpicker-name" id="plDialogCoverName">歌单</b>
            <small className="pl-cpicker-hint">点击卡片，选择封面图片</small>
          </div>
          <input id="plDialogInput" maxLength="40" placeholder="歌单名称" autocomplete="off" />
          <input type="file" id="plCoverFile" accept="image/*" hidden={true} />
          <div className="pl-dialog-actions">
            <button className="btn-ghost" id="plDialogCancel" type="button">取消</button>
            <button className="btn-primary" id="plDialogOk" type="button">创建</button>
          </div>
        </div>
      </div>
    </>
  );
}

function SplitMask() {
  return (
    <>
      {/* ============ MixSplitR 长视频分切面板 ============ */}
      <div className="pl-dialog-mask" id="splitMask" hidden={true}>
        <div className="split-panel" role="dialog" aria-modal="true">
          <h3>MixSplitR 分切</h3>
          <p id="splitHint">识别长视频中的每首歌曲；微调时间与歌名后自动联网匹配歌曲信息。</p>
          <div className="split-wave-time" id="splitWaveTime" hidden={true}></div>
          <div className="split-wave" id="splitWave" hidden={true}>
            <canvas id="splitWaveCanvas"></canvas>
            <div className="split-wave-overlay" id="splitWaveOverlay"></div>
            <div className="split-wave-line" id="splitWaveHover" hidden={true}><i></i></div>
            <div className="split-wave-tip" id="splitWaveTip" hidden={true}></div>
          </div>
          <div className="split-list" id="splitList"></div>
          <div className="split-log" id="splitLog" hidden={true}></div>
          <div className="split-foot">
            <span className="mseg" id="splitModeSeg" title="智能分析的分割方式">
              <button type="button" data-sm="transition" className="on">Transition</button>
              <button type="button" data-sm="silence">静音间隙</button>
              <button type="button" data-sm="interval">等间隔</button>
            </span>
            <button className="btn-ghost" id="splitAnalyze" type="button">智能分析</button>
            <button className="btn-ghost" id="splitIdentify" type="button">识别曲目</button>
            <button className="btn-ghost" id="splitImport" type="button">导入时间表</button>
            <button className="btn-ghost" id="splitAdd" type="button">添加分段</button>
            <span className="split-count" id="splitCount"></span>
            <button className="btn-ghost" id="splitCancel" type="button">取消</button>
            <button className="btn-primary" id="splitCreate" type="button">创建歌单</button>
          </div>
          <input type="file" id="splitFile" accept=".txt,.csv,.cue,.log,text/plain" hidden={true} />
        </div>
      </div>
    </>
  );
}

function LyricMask() {
  return (
    <>
      {/* ============ 手动匹配歌词 / 歌词偏移面板 ============ */}
      <div className="pl-dialog-mask" id="lyricMask" hidden={true}>
        <div className="split-panel lyric-panel" role="dialog" aria-modal="true">
          <h3>匹配歌词</h3>
          <p id="lyricMatchHint">输入歌名（可带歌手）搜索 QQ 音乐 / 网易云，点选正确的歌曲替换当前歌词。</p>
          <div className="lyric-match-row">
            <input id="lyricMatchInput" className="pl-edit-input" placeholder="歌名 + 歌手" autocomplete="off" />
            <button className="btn-ghost" id="lyricMatchGo" type="button">搜索</button>
          </div>
          <div className="lyric-cands" id="lyricCands"></div>
          <div className="lyric-off-row">
            <span className="lyric-off-label">歌词偏移</span>
            <button className="btn-ghost" id="lyricOffDown" type="button">− 0.5s</button>
            <b className="num" id="lyricOffVal">0.0s</b>
            <button className="btn-ghost" id="lyricOffUp" type="button">+ 0.5s</button>
            <button className="btn-ghost" id="lyricOffReset" type="button">重置</button>
          </div>
          <div className="pl-dialog-actions">
            <button className="btn-ghost" id="lyricAuto" type="button">恢复自动歌词</button>
            <button className="btn-primary" id="lyricClose" type="button">完成</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Shell() {
  return (
    <>
      <BackdropLayers />
      <WinControls />
      <Topbar />
      <ViewLibrary />
      <ViewFav />
      <ViewRadio />
      <ViewPlaylist />
      <ViewSearch />
      <ViewUp />
      <ViewPlaying />
      <SharedOverlays />
      <QueueDrawer />
      <SettingsModal />
      <LoginModal />
      <PlDialog />
      <SplitMask />
      <LyricMask />
      <div className="toast" id="toast"></div>
      <audio id="audio" preload="auto" crossOrigin="anonymous"></audio>
    </>
  );
}
