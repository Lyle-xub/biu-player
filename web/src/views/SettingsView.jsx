import React, { useRef } from 'react';
import { useSlice } from '../store.js';

const DEFAULT_SETTINGS = { quality: 1, vq: 80, danmaku: 1, syncHistory: 0, blur: 0, deskLyric: false };
const DEFAULT_AUTH = { isLogin: false };

const QUALITY_OPTIONS = [[0, '标准'], [1, '高品'], [2, '无损']];
const VQUALITY_OPTIONS = [[64, '720P'], [80, '1080P'], [120, '4K']];

/* 设置弹窗：状态来自 store 'settings' / 'auth' slice（controller 发布），
 * 交互全部回调 window.biuActions；模糊度滑条拖动在组件内转为 setBlurPx。 */
export function SettingsModal() {
  const s = { ...DEFAULT_SETTINGS, ...(useSlice('settings') || {}) };
  const auth = { ...DEFAULT_AUTH, ...(useSlice('auth') || {}) };
  const lan = useSlice('lanSync') || {};
  const A = () => window.biuActions;
  const dragging = useRef(false);
  const setFromEvent = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    A().setBlurPx(Math.round(v * 40));
  };
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) window.biuUi?.closePanel(); }}>
      <div className="modal">
        <h3>设置</h3>
        <div className="mrow">
          <div className="ml"><b>B 站账号</b><small id="authSubtitle">{auth.isLogin ? `UID ${auth.mid} · 已同步收藏夹` : '扫码或手机验证码安全登录'}</small></div>
          {!auth.isLogin && (
            <div className="mr auth-actions" id="authLoggedOut">
              <button className="btn-ghost" id="btnQrLogin" onClick={() => A().showLogin('qr')}>扫码登录</button>
              <button className="btn-ghost" id="btnCodeLogin" onClick={() => A().showLogin('sms')}>验证码</button>
            </div>
          )}
          {auth.isLogin && (
            <div className="mr auth-user" id="authLoggedIn">
              <img id="authFace" alt="" src={auth.face || ''} />
              <b id="authName">{auth.uname || '已登录'}</b>
              <button className="auth-logout" id="btnLogout" onClick={() => A().logout()}>退出</button>
            </div>
          )}
        </div>
        <div className="mrow">
          <div className="ml"><b>在线音质</b><small>B 站音频流码率，无损需登录/大会员</small></div>
          <div className="mr"><span className="mseg" id="segQuality">
            {QUALITY_OPTIONS.map(([q, label]) => (
              <button key={q} data-q={q} className={s.quality === q ? 'on' : ''} onClick={() => A().setQuality(q)}>{label}</button>
            ))}
          </span></div>
        </div>
        <div className="mrow">
          <div className="ml"><b>视频清晰度</b><small>原视频模式默认清晰度</small></div>
          <div className="mr"><span className="mseg" id="segVQuality">
            {VQUALITY_OPTIONS.map(([vq, label]) => (
              <button key={vq} data-vq={vq} className={s.vq === vq ? 'on' : ''} onClick={() => A().setVQuality(vq)}>{label}</button>
            ))}
          </span></div>
        </div>
        <div className="mrow">
          <div className="ml"><b>弹幕</b><small>视频模式下默认开启弹幕</small></div>
          <div className="mr"><span className={`switch${s.danmaku ? '' : ' off'}`} id="swDanmaku" onClick={() => A().toggleDanmaku()}></span></div>
        </div>
        <div className="mrow">
          <div className="ml"><b>同步观看记录</b><small>播放时把记录上报到 B 站历史，需登录</small></div>
          <div className="mr"><span className={`switch${s.syncHistory ? '' : ' off'}`} id="swSyncHistory" onClick={() => A().toggleSyncHistory()}></span></div>
        </div>
        <div className="mrow">
          <div className="ml"><b>背景模糊度</b><small>沉浸式封面背景的模糊强度</small></div>
          <div className="mr">
            <span className="slider" id="slBlur"
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; setFromEvent(e); }}
              onPointerMove={(e) => { if (dragging.current) setFromEvent(e); }}
              onPointerUp={() => { dragging.current = false; }}
            ><i style={{ width: (s.blur / 40 * 100) + '%' }}></i></span>
          </div>
        </div>
        <div className="mrow">
          <div className="ml"><b>桌面歌词</b><small>在屏幕上悬浮显示歌词</small></div>
          <div className="mr"><span className={`switch${s.deskLyric ? '' : ' off'}`} id="swLyric" onClick={() => A().toggleDeskLyric()}></span></div>
        </div>
        <div className="mrow lan-sync-row">
          <div className="ml"><b>局域网同步</b><small>合并两端的我喜欢和自建歌单，自动去重，保留两端内容。</small>
            <small role="status">{lan.error || (lan.active
              ? lan.pending ? '已发起同步，等待手机响应。请保持手机同步设置页打开。'
                : lan.lastSync ? `已同步 · ${lan.counts.likes} 首喜欢 · ${lan.counts.playlists} 个歌单。手机保持同步设置页打开，可再次发起。`
                : '在手机设置中输入地址和配对码，然后点击手动同步。'
              : '手机与电脑连接同一 Wi-Fi，点击手动同步开始配对。')}</small>
            {lan.active && <small className="lan-sync-pair">{(lan.addresses || []).join(' / ') || '未检测到局域网，请连接 Wi-Fi 后重试'}
              {'\n'}配对码：{lan.code}（10 分钟内有效）</small>}
          </div>
          <div className="mr"><button className="btn-ghost" disabled={lan.busy} onClick={() => A().manualLanSync()}>手动同步</button>
            {lan.active && <button className="btn-ghost" onClick={() => A().stopLanSync()}>关闭同步</button>}</div>
        </div>
        <div className="mfoot">BIU PLAYER · v0.5.0 · 基于 BILIBILI 公开接口</div>
      </div>
    </div>
  );
}
