import React, { useEffect, useRef } from 'react';
import { useSlice } from '../store.js';

const DEFAULT_PLDIALOG = { open: false, mode: 'create', targetTitle: '', inputValue: '', cover: null };

/* 歌单新建 / 删除对话框：状态来自 store 'plDialog' slice。
 * 输入值也放在 slice 里，封面卡片的名字预览随之实时联动；
 * 文件选择框常驻 DOM（歌单详情页内联换封面也复用它）。 */
export function PlDialog() {
  const d = { ...DEFAULT_PLDIALOG, ...(useSlice('plDialog') || {}) };
  const isCreate = d.mode === 'create';
  const inputRef = useRef(null);
  useEffect(() => {
    if (d.open && isCreate) setTimeout(() => inputRef.current?.focus(), 60);
  }, [d.open, isCreate]);
  const A = () => window.biuActions;
  return (
    <div className="pl-dialog-mask" id="plDialogMask" hidden={!d.open}
      onClick={(e) => { if (e.target === e.currentTarget) A().plDialogClose(); }}>
      <div className="pl-dialog" role="dialog" aria-modal="true">
        <h3 id="plDialogTitle">{isCreate ? '新建歌单' : '删除歌单'}</h3>
        <p id="plDialogMsg" style={{ display: isCreate ? 'none' : '' }}>
          {isCreate ? '' : `确定删除歌单「${d.targetTitle}」吗？此操作不可恢复。`}
        </p>
        <div className="pl-cpicker" id="plDialogCoverCard" role="button" aria-label="选择歌单封面" hidden={!isCreate}
          onClick={() => A().plDialogPickCover()}>
          <span className="pl-cpicker-cover" id="plDialogCoverImg">
            {d.cover
              ? <img src={d.cover} alt="" />
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15l-4.5-4.5L6 21"/></svg>}
          </span>
          <b className="pl-cpicker-name" id="plDialogCoverName">{d.inputValue.trim() || '歌单'}</b>
          <small className="pl-cpicker-hint">点击卡片，选择封面图片</small>
        </div>
        <input id="plDialogInput" ref={inputRef} maxLength="40" placeholder="歌单名称" autoComplete="off"
          style={{ display: isCreate ? '' : 'none' }}
          value={d.inputValue}
          onChange={(e) => A().plDialogInput(e.target.value)}
          onKeyDown={(e) => {
            // 中文输入法组词期间的回车只是选词，不能当成确认创建
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) A().plDialogSubmit();
            else if (e.key === 'Escape') A().plDialogClose();
            e.stopPropagation();
          }} />
        <input type="file" id="plCoverFile" accept="image/*" hidden={true}
          onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; A().plCoverFilePicked(f); }} />
        <div className="pl-dialog-actions">
          <button className="btn-ghost" id="plDialogCancel" type="button" onClick={() => A().plDialogClose()}>取消</button>
          <button className={`btn-primary${isCreate ? '' : ' danger'}`} id="plDialogOk" type="button" onClick={() => A().plDialogSubmit()}>{isCreate ? '创建' : '删除'}</button>
        </div>
      </div>
    </div>
  );
}
