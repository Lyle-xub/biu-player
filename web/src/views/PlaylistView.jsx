import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSlice } from '../store.js';
import { TrackList } from './TrackList.jsx';

/* 默认封面：原 shell 骨架里 plCover 的 lk2 渐变爱心（旧版 DEFAULT_PL_COVER 的来源） */
const defaultCover = (
  <svg viewBox="0 0 400 400">
    <defs><linearGradient id="lk2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ffa9c0"/><stop offset="1" stopColor="#fb7299"/>
    </linearGradient></defs>
    <rect width="400" height="400" fill="url(#lk2)"/>
    <path d="M200 300 C 120 240 90 195 90 155 C 90 118 118 95 152 95 C 176 95 193 108 200 126 C 207 108 224 95 248 95 C 282 95 310 118 310 155 C 310 195 280 240 200 300Z" fill="#fff"/>
  </svg>
);

const collectionSorts = [
  { key: 'added-desc', label: '加入时间', direction: '新到旧' },
  { key: 'added-asc', label: '加入时间', direction: '旧到新' },
  { key: 'title-asc', label: '歌曲标题', direction: '正序' },
  { key: 'title-desc', label: '歌曲标题', direction: '逆序' },
  { key: 'artist-asc', label: 'UP 主', direction: '正序' },
  { key: 'artist-desc', label: 'UP 主', direction: '逆序' },
];

/* 歌单详情视图：DOM 与事件由组件拥有，controller 只 publish('playlist', ...) 数据。
 * plTitleEdit/plDescEdit 的 value 回填 / focus / keydown 仍由 controller 经 $() 管理，
 * 显隐（hidden）与 editing class 由组件按 slice.editing 渲染。 */
export default function PlaylistView() {
  const pl = useSlice('playlist');
  const editing = !!(pl && pl.editing);
  const A = window.biuActions;
  const collection = !!(pl && (pl.isLikes || pl.isMusicLibrary));
  const collectionKey = pl && (pl.isLikes ? 'likes' : pl.isMusicLibrary ? 'library' : 'other');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('added-desc');
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenu = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { setQuery(''); setSort('added-desc'); setSortOpen(false); setSearchOpen(false); }, [collectionKey]);
  useEffect(() => {
    if (!sortOpen) return undefined;
    const close = (event) => { if (!sortMenu.current?.contains(event.target)) setSortOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [sortOpen]);
  const selectedSort = collectionSorts.find((item) => item.key === sort) || collectionSorts[0];
  const visibleTracks = useMemo(() => {
    const source = pl?.tracks || [];
    if (!collection) return source;
    const keyword = query.trim().toLocaleLowerCase();
    let next = source.map((track, index) => ({ track, index })).filter(({ track }) => !keyword
      || `${track.title || ''} ${track.up || ''}`.toLocaleLowerCase().includes(keyword));
    const [field, direction] = sort.split('-');
    const sign = direction === 'desc' ? -1 : 1;
    if (field === 'added') next.sort((a, b) => {
      const at = Number(a.track.addedAt) || 0, bt = Number(b.track.addedAt) || 0;
      if (at && bt) return sign * (at - bt);
      if (at || bt) return sign * (at ? 1 : -1);
      return sign * (b.index - a.index);
    });
    next = next.map(({ track }) => track);
    if (field === 'title') next = [...next].sort((a, b) => sign * String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
    else if (field === 'artist') next = [...next].sort((a, b) => sign * String(a.up || '').localeCompare(String(b.up || ''), 'zh-CN'));
    return next;
  }, [collection, pl?.tracks, query, sort]);
  useEffect(() => {
    if (collection) window.biuActions?.setPlaylistViewTracks(visibleTracks);
  }, [collection, visibleTracks]);
  return (
    <section className="view view-playlist">
      <div className={`pl-head${editing ? ' editing' : ''}`}>
        <div className="pl-cover" id="plCover">
          {pl && pl.cover
            ? (pl.cover.pic
              ? <img src={pl.cover.pic} loading="eager" decoding="async" alt="" />
              : <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: window.coverSVG(pl.cover.seed || 1, 400) }} />)
            : defaultCover}
          <span className="pl-cover-edit" id="plCoverEdit" title="更换封面"
            hidden={!(editing && pl && pl.customId)}
            onClick={(e) => { e.stopPropagation(); A.pickInlineCover(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </span>
        </div>
        <div className="pl-info">
          <div className="label-caps" id="plLabel">{pl ? pl.label : '收藏夹 · Bilibili'}</div>
          <div className="pl-title-row">
            <h1 id="plTitle" style={editing ? { display: 'none' } : undefined}>{pl ? pl.title : '我喜欢'}</h1>
          </div>
          <input id="plTitleEdit" className="pl-edit-input pl-edit-title" maxLength={40} autoComplete="off" hidden={!editing} />
          <p className="pl-desc" id="plDesc" style={editing ? { display: 'none' } : undefined}>{pl ? pl.desc : '所有在 B 站点过「收藏」的音乐视频与音频，自动转存为可连续播放的歌单。'}</p>
          <input id="plDescEdit" className="pl-edit-input pl-edit-desc" maxLength={60} autoComplete="off" placeholder="歌单简介（可选）" hidden={!editing} />
          <div className="pl-meta" id="plMeta">{pl ? pl.meta : ''}</div>
          <div className="pl-actions">
            <button className="btn-primary" id="btnPlayAll">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              播放全部
            </button>
            <button className="btn-ghost" id="btnPlShuffle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
              随机播放
            </button>
            {collection ? <div className={`pl-search-inline${searchOpen ? ' open' : ''}`}>
              <button type="button" className="pl-search-toggle" title="搜索歌曲" aria-label="搜索歌曲"
                aria-expanded={String(searchOpen)} onClick={() => {
                  if (searchOpen) { setQuery(''); setSearchOpen(false); } else setSearchOpen(true);
                }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
              </button>
              {searchOpen ? <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索歌曲或歌手" aria-label="搜索歌曲或歌手" /> : null}
            </div> : null}
            {pl && (pl.customId || pl.favId) ? (
              <button className="btn-ghost" data-custom-act="edit" onClick={() => A.togglePlEditing()}>{editing ? '完成' : '编辑'}</button>
            ) : null}
          </div>
        </div>
      </div>
      <div className={`tlist${collection ? ' collection' : ''}${editing && pl && pl.customId ? ' editing' : ''}`}>
        <div className="thead"><span>#</span><span>标题</span><span>UP 主</span><span>时长</span><span>
          {collection ? <div className="pl-sort-menu" ref={sortMenu}>
            <button type="button" className={`pl-list-sort${sortOpen ? ' open' : ''}`}
              onClick={() => setSortOpen((open) => !open)} aria-expanded={sortOpen}
              title={`排序：${selectedSort.label} · ${selectedSort.direction}`}
              aria-label={`排序方式：${selectedSort.label}${selectedSort.direction}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h9M4 12h7M4 18h5m8-11v11m-3-3 3 3 3-3"/></svg>
              <b>{selectedSort.label} · {selectedSort.direction}</b>
              <svg className="pl-sort-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {sortOpen ? <div className="pl-sort-dropdown" role="menu">
              {collectionSorts.map((item) => <button type="button" role="menuitem" key={item.key}
                className={item.key === sort ? 'on' : ''} onClick={() => { setSort(item.key); setSortOpen(false); }}>
                <span>{item.label}</span><small>{item.direction}</small>
              </button>)}
            </div> : null}
          </div> : null}
        </span></div>
        <TrackList containerId="list-playlist"
          tracks={visibleTracks}
          current={pl ? pl.current : null}
          editable={!!(pl && pl.editable)}
          listHint={query && !visibleTracks.length ? '没有找到匹配的歌曲' : (pl ? pl.listHint : null)}
          onPlay={(i) => A.setQueue(visibleTracks, pl.title || '', i)}
          onDelete={(i) => A.plDeleteTrack(i)} />
      </div>
    </section>
  );
}
