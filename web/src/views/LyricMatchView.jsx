import React from 'react';
import { useSlice } from '../store.js';

const DEFAULT_LM = { open: false, offVal: '0.0s', cands: null, candsHint: null };

/* 手动匹配歌词 / 歌词偏移面板（#lyricMask）：状态来自 store 'lyricMatch' slice。
 * 搜索输入框是非受控的（打开时由 controller 预填），候选列表与偏移值走 slice。 */
export function LyricMask() {
  const m = { ...DEFAULT_LM, ...(useSlice('lyricMatch') || {}) };
  const A = () => window.biuActions;
  return (
    <div className="pl-dialog-mask" id="lyricMask" hidden={!m.open}
      onClick={(e) => { if (e.target === e.currentTarget) A().closeLyricMatch(); }}>
      <div className="split-panel lyric-panel" role="dialog" aria-modal="true">
        <h3>匹配歌词</h3>
        <p id="lyricMatchHint">输入歌名（可带歌手）搜索 QQ 音乐 / 网易云，点选正确的歌曲替换当前歌词。</p>
        <div className="lyric-match-row">
          <input id="lyricMatchInput" className="pl-edit-input" placeholder="歌名 + 歌手" autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') A().runLyricMatchSearch(); }} />
          <button className="btn-ghost" id="lyricMatchGo" type="button" onClick={() => A().runLyricMatchSearch()}>搜索</button>
        </div>
        <div className="lyric-cands" id="lyricCands">
          {m.candsHint
            ? <div className="list-hint">{m.candsHint}</div>
            : (m.cands || []).map((c, i) => (
              <div className="lyric-cand" key={`${c.source}-${c.id || c.songmid || i}`} onClick={() => A().pickLyricCandidateByIndex(i)}>
                <span className={`lc-src ${c.source}`}>{c.source === 'qq' ? 'QQ 音乐' : '网易云'}</span>
                <span className="lc-meta"><b>{c.title}</b><small>{c.artist || '未知歌手'}</small></span>
                <span className="lc-dur num">{c.dur}</span>
              </div>
            ))}
        </div>
        <div className="lyric-off-row">
          <span className="lyric-off-label">歌词偏移</span>
          <button className="btn-ghost" id="lyricOffDown" type="button" onClick={() => A().lyricOffAdjust(-0.5)}>− 0.5s</button>
          <b className="num" id="lyricOffVal">{m.offVal}</b>
          <button className="btn-ghost" id="lyricOffUp" type="button" onClick={() => A().lyricOffAdjust(0.5)}>+ 0.5s</button>
          <button className="btn-ghost" id="lyricOffReset" type="button" onClick={() => A().lyricOffReset()}>重置</button>
        </div>
        <div className="pl-dialog-actions">
          <button className="btn-ghost" id="lyricAuto" type="button" onClick={() => A().lyricAutoRestore()}>恢复自动歌词</button>
          <button className="btn-primary" id="lyricClose" type="button" onClick={() => A().closeLyricMatch()}>完成</button>
        </div>
      </div>
    </div>
  );
}
