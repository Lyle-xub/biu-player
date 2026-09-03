import React from 'react';
import { fmt } from '../legacy/html.js';

/* 共享视频卡（搜索页 / UP 主主页共用）：复刻旧版 vcard 结构。
 * 旧版 vcard 封面没有 cover-loading 那套（styles.css 无相关规则），普通 lazy img 即可。 */
export function VCard({ t, index, onClick }) {
  return (
    <div className="vcard" data-vi={index} onClick={onClick}>
      <div className="vth">{t.pic
          ? <img src={t.pic} loading="lazy" decoding="async" alt="" />
          : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG((t && t.seed) || 1, 320) }} />}
        <span className="dur-b num">{fmt(t.duration)}</span></div>
      <h4>{t.title}</h4><p>{t.up}</p>
    </div>
  );
}
