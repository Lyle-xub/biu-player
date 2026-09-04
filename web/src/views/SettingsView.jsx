import React, { useEffect, useRef } from 'react';
import '../../../renderer/video-cloud-settings.js';
import { useSlice } from '../store.js';

const DEFAULT_SETTINGS = { recommendMode: 'music', quality: 1, vq: 80, danmaku: 1, syncHistory: 0, blur: 0, deskLyric: false };
const DEFAULT_AUTH = { isLogin: false };

const QUALITY_OPTIONS = [[0, '标准'], [1, '高品'], [2, '无损']];
const VQUALITY_OPTIONS = [[64, '720P'], [80, '1080P'], [120, '4K']];

/* 设置弹窗：状态来自 controller 发布的 store，交互回调 window.biuActions。 */
export function SettingsModal() {
  const s = { ...DEFAULT_SETTINGS, ...(useSlice('settings') || {}) };
  const auth = { ...DEFAULT_AUTH, ...(useSlice('auth') || {}) };
  const lan = useSlice('lanSync') || {};
  const A = () => window.biuActions;
  const profileHost = useRef(null);
  const cloudHost = useRef(null);
  useEffect(() => window.BiuVideoCloud?.mount(cloudHost.current), []);
  useEffect(() => window.biuProfiles?.mount(profileHost.current), [auth.mid, auth.isLogin]);
  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) window.biuUi?.closePanel(); }}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <header className="settings-heading"><h3 id="settingsTitle">设置</h3><button className="settings-close" type="button" aria-label="关闭设置" onClick={() => window.biuUi?.closePanel()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M6 18 18 6" /></svg></button></header>
        <div className="mrow settings-account">
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
        <div className="settings-cards">
        <section className="settings-card" aria-labelledby="settingsRecommendation"><h4 id="settingsRecommendation" className="settings-card-title">推荐与画像</h4>
        <div ref={profileHost} />
        <div className="mrow recommend-mode-row">
          <div className="ml"><b>首页推荐范围</b><small>适用于个性推荐和自定义画像；默认仅推荐音乐分区。</small></div>
          <div className="mr"><span className="mseg" role="radiogroup" aria-label="首页推荐范围">
            {[['music', '音乐分区推荐'], ['all', '全部推荐']].map(([mode, label]) => (
              <button key={mode} type="button" role="radio" aria-checked={s.recommendMode === mode}
                className={s.recommendMode === mode ? 'on' : ''} onClick={() => A().setRecommendMode(mode)}>{label}</button>
            ))}
          </span></div>
        </div>
        </section>
        <section className="settings-card" aria-labelledby="settingsPlayback"><h4 id="settingsPlayback" className="settings-card-title">播放与歌词</h4>
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
          <div className="ml"><b>桌面歌词</b><small>在屏幕上悬浮显示歌词</small></div>
          <div className="mr"><span className={`switch${s.deskLyric ? '' : ' off'}`} id="swLyric" onClick={() => A().toggleDeskLyric()}></span></div>
        </div>
        </section>
        <section className="settings-card" aria-labelledby="settingsSync"><h4 id="settingsSync" className="settings-card-title">数据与同步</h4>
        <div className="mrow lan-sync-row">
          <div className="ml"><b>局域网自动同步</b><small>默认开启。在同一 Wi-Fi 打开两端，登录相同账号后自动同步我喜欢、自建歌单、推荐画像及云同步密钥。</small>
            <small role="status">{lan.error || (lan.enabled === false ? '自动同步已关闭'
              : !lan.signedIn ? '登录后自动连接同一 Wi-Fi 内的同账号设备'
              : lan.connected && lan.lastSync ? `已同步 · ${lan.counts.likes} 首喜欢 · ${lan.counts.playlists} 个歌单 · ${lan.counts.profiles || 0} 份画像`
              : '正在等待同一 Wi-Fi 内的同账号设备，打开手机 App 即可同步')}</small>
          </div>
          <div className="mr"><button className={`switch${lan.enabled === false ? ' off' : ''}`} type="button" role="switch"
            aria-label="局域网自动同步" aria-checked={lan.enabled !== false} onClick={() => A().setLanSyncEnabled(lan.enabled === false)} /></div>
        </div>
        <div ref={cloudHost} />
        </section>
        </div>
        <div className="mfoot">BIU PLAYER · v0.5.0 · 基于 BILIBILI 公开接口</div>
      </div>
    </div>
  );
}
