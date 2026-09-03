import React from 'react';
import { useSlice } from '../store.js';
import { GCard } from './LibraryGrids.jsx';

/* 收藏夹网格：DOM 与事件由组件拥有，controller 只 publish('fav', ...) 数据。 */
export function GridFav() {
  const data = useSlice('fav');
  const A = window.biuActions;
  return (
    <div className="grid" id="grid-fav">
      {data && (() => {
        if (data.state === 'loading') return <div className="list-hint">收藏夹加载中…</div>;
        if (data.state === 'signed-out') {
          return (
            <div className="empty-guide">
              <h3>同步你的 B 站收藏夹</h3>
              <p>使用哔哩哔哩客户端扫码，或通过 B 站官方手机验证码登录，<br />
              无需复制 Cookie，登录后会自动同步收藏夹。</p>
              <button className="btn-primary" onClick={() => A.showLogin('qr')}>扫码登录</button>
            </div>
          );
        }
        if (data.state === 'error') {
          return (
            <div className="empty-guide">
              <h3>收藏夹加载失败</h3><p>{data.error}<br />请重新扫码或使用验证码登录。</p>
              <button className="btn-primary" onClick={() => A.showLogin('qr')}>重新登录</button>
            </div>
          );
        }
        return data.folders.map((f, i) => (
          <GCard key={`fav-${f.id}`} title={f.title} meta={`${f.count} 个视频`}
            extraAttrs={{ 'data-fi': i }}
            cover={f.pic
              ? { type: 'img', src: f.pic, lazy: true }
              : { type: 'svg', html: window.coverSVG(f.seed || 1, 400) }}
            onClick={() => A.openFavFolder(f)} />
        ));
      })()}
    </div>
  );
}
