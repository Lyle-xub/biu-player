import React from 'react';
import { useSlice } from '../store.js';
import { fmtNum } from '../legacy/html.js';
import { GCard } from './LibraryGrids.jsx';

/* 电台网格：DOM 与事件由组件拥有，controller 只 publish('radio', ...) 数据。 */
export function GridRadio() {
  const data = useSlice('radio');
  return (
    <div className="grid" id="grid-radio">
      {data && (data.hint
        ? <div className="list-hint">{data.hint}</div>
        : data.rooms.map((room, i) => (
          <GCard key={`radio-${room.roomid}`} title={room.title}
            meta={`${fmtNum(room.online)} 人在听`}
            extraAttrs={{ 'data-station': i }}
            badge={<span className="badge"><span className="live-dot" />LIVE</span>}
            cover={room.pic
              ? { type: 'img', src: room.pic, lazy: true }
              : { type: 'svg', html: window.coverSVG(room.seed || 1, 400) }}
            onClick={() => window.biuActions.setQueue(data.rooms, 'B 站直播电台', i)} />
        )))}
    </div>
  );
}

/* 关注的主播 · 正在直播：整个 section（含 hidden 开关）由组件管理。 */
export function LiveFollows() {
  const data = useSlice('radio.follows');
  const hidden = data ? data.hidden : true;
  return (
    <section className="sec" style={{ marginTop: 0 }} id="liveFollowsSec" hidden={hidden}>
      <h2>关注的主播<small>正在直播</small></h2>
      <div className="live-follows" id="liveFollows">
        {data && !data.hidden && data.rooms.map((room, i) => (
          <div className="lf-item" key={`lf-${room.roomid ?? i}`} data-lfi={i} title={room.title}
            onClick={() => window.biuActions.setQueue(data.rooms, '关注的主播 · 直播中', i)}>
            <span className="lf-ava">
              {room.face
                ? <img src={room.face} alt="" loading="lazy" />
                : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(30 + i * 2) }} />}
              <i></i>
            </span>
            <span className="lf-name">{room.up}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
