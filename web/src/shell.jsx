import React from 'react';
import { GridMy, GridRec } from './views/LibraryGrids.jsx';
import { GridFav } from './views/FavGrid.jsx';
import { GridRadio, LiveFollows } from './views/RadioView.jsx';
import PlaylistView from './views/PlaylistView.jsx';
import { SearchResults } from './views/SearchView.jsx';
import UpView from './views/UpView.jsx';
import { QueueList } from './views/QueueList.jsx';
import { FavPopList } from './views/FavPopList.jsx';
import { PlPopList } from './views/PlPopList.jsx';
import { NpInfo, NpCover, HotComment, CmtList, VQualMenu, VDetail, PpLike } from './views/PlayingView.jsx';
import { SettingsModal } from './views/SettingsView.jsx';
import { LoginModal } from './views/LoginView.jsx';
import { PlDialog } from './views/PlDialogView.jsx';
import { DlMenu } from './views/DlMenu.jsx';
import { LyricMask } from './views/LyricMatchView.jsx';

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
          <div className="card side" id="dailyHome"><div className="cover" data-cover="8" /><h3>每日推荐</h3><p>为今天挑选</p></div>
          <div className="card side" id="cardLibrary">
            <div className="cover" data-cover="12"><span className="count shelf-count"><span className="count-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><span className="count-label" id="shelfLibraryCount">0 首歌曲</span></span></div>
            <h3>我的音乐库</h3><p>喜欢与主动收藏</p>
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
          <GridMy />
        </section>
        <section className="sec">
          <h2>为你推荐<small id="recSource">B 站个性化音乐信息流</small></h2>
          <GridRec />
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
          <GridFav />
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
        <LiveFollows />
        <section className="sec" style={{marginTop:0}}>
          <h2>音乐电台<small>24 小时不间断 · 下滑加载更多</small></h2>
          <GridRadio />
        </section>
      </section>
    </>
  );
}

function ViewPlaylist() {
  return (
    <>
      {/* ================= 歌单详情（组件化，数据来自 store 'playlist' slice） ================= */}
      <PlaylistView />
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

        <SearchResults />
      </section>
    </>
  );
}

function ViewUp() {
  return (
    <>
      {/* ================= UP 主主页（组件化，数据来自 store 'up' / 'follows' slice） ================= */}
      <UpView />
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
            <NpInfo />
          </div>
          {/* 收藏夹弹层放在 np-heading 外：heading 的 contain:layout 会把 fixed 后代关进自身并裁掉 */}
          <div className="fav-pop" id="favPop" hidden={true}>
            <div className="fav-pop-title">添加到收藏夹</div>
            <FavPopList />
          </div>
          <div className="fav-pop" id="plPop" hidden={true}>
            <div className="fav-pop-title">加入本地歌单</div>
            <PlPopList />
          </div>
          {/* 下载清晰度菜单：同样放 np-heading 外防裁剪（数据来自 store 'dlmenu' slice） */}
          <DlMenu />

          {/* 歌词：播放时由 JS 注入 AI 字幕时间轴歌词 */}
          <div className="lyrics" id="lyrics">
            <div className="hint">选择一首歌曲开始播放</div>
          </div>

          {/* 视频模式：左栏换为热门评论 */}
          <div className="np-comments">
            <h4>热门评论</h4>
            <CmtList />
          </div>
        </div>

        <HotComment />

        {/* 歌词模式：右侧大封面（数据来自 store 'np' slice） */}
        <NpCover />

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
            <VQualMenu />
          </div>

          <VDetail />
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
          <PpLike />
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
        <QueueList />
        <footer><span id="qMode">列表循环</span><span id="qClear">清空队列</span><span id="qLocate">定位当前</span></footer>
      </aside>
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

function ShareCardMask() {
  return (
    <div className="pl-dialog-mask share-card-mask" id="shareCardMask" hidden={true}>
      <div className="share-card-dialog" role="dialog" aria-modal="true" aria-label="分享音乐">
        <canvas id="shareCardCanvas" width="720" height="960"></canvas>
        <div className="pl-dialog-actions">
          <button className="btn-ghost" id="shareCardClose" type="button">关闭</button>
          <button className="btn-ghost" id="shareCardLink" type="button">分享链接</button>
          <button className="btn-ghost" id="shareCardCopy" type="button">复制卡片</button>
          <button className="btn-primary" id="shareCardSave" type="button">保存卡片</button>
        </div>
      </div>
    </div>
  );
}

export default function Shell() {
  return (
    <>
      <BackdropLayers />
      <WinControls />
      <Topbar />
      <ViewLibrary />
      <section className="view view-daily" id="dailyPage" aria-label="每日推荐" />
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
      <ShareCardMask />
      <div className="toast" id="toast"></div>
      <audio id="audio" preload="auto" crossOrigin="anonymous"></audio>
    </>
  );
}
