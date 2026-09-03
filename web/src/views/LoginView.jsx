import React from 'react';
import { useSlice } from '../store.js';

const DEFAULT_LOGIN = {
  show: false, tab: 'qr',
  qrImage: null, qrStateText: '正在生成二维码…', qrStateHidden: false,
  qrStatusText: '请使用哔哩哔哩客户端扫码', qrStatusCls: '',
  smsStatusText: '', smsStatusCls: '',
  smsSendLabel: '获取验证码', smsSendDisabled: false, smsLoginDisabled: false,
};

/* 登录弹窗（扫码 / 手机验证码）：状态来自 store 'login' slice，
 * 二维码轮询、极验、倒计时等副作用留在 controller，这里只渲染 + 回调。
 * 两个 pane 保持常驻（hidden 切换），避免切 tab 丢失已填手机号。 */
export function LoginModal() {
  const L = { ...DEFAULT_LOGIN, ...(useSlice('login') || {}) };
  const A = () => window.biuActions;
  return (
    <div className={`login-mask${L.show ? ' show' : ''}`} id="qrLoginMask"
      onClick={(e) => { if (e.target === e.currentTarget) A().hideQrLogin(); }}>
      <div className="login-card">
        <button className="login-close" id="btnCloseQr" aria-label="关闭" onClick={() => A().hideQrLogin()}>×</button>
        <span className="login-kicker">BILIBILI CONNECT</span>
        <div className="login-tabs" role="tablist">
          <button className={L.tab === 'qr' ? 'on' : ''} id="tabQrLogin" role="tab" aria-selected={L.tab === 'qr'} onClick={() => A().switchLoginTab('qr')}>扫码登录</button>
          <button className={L.tab === 'sms' ? 'on' : ''} id="tabSmsLogin" role="tab" aria-selected={L.tab === 'sms'} onClick={() => A().switchLoginTab('sms')}>验证码登录</button>
        </div>
        <div className="login-pane" id="paneQr" hidden={L.tab !== 'qr'}>
          <p>使用哔哩哔哩客户端扫码，并在手机上确认</p>
          <div className="qr-shell" id="qrShell">
            <img id="qrImage" alt="B 站登录二维码" src={L.qrImage || undefined} />
            <div className={`qr-state${L.qrStateHidden ? ' hidden' : ''}`} id="qrState">{L.qrStateText}</div>
          </div>
          <div className={`login-status${L.qrStatusCls ? ' ' + L.qrStatusCls : ''}`} id="qrStatus">{L.qrStatusText}</div>
          <div className="login-buttons">
            <button className="btn-primary" id="btnRefreshQr" onClick={() => A().refreshQrLogin()}>刷新二维码</button>
          </div>
        </div>
        <div className="login-pane" id="paneSms" hidden={L.tab !== 'sms'}>
          <p>使用手机号 + 短信验证码登录，全程在应用内完成</p>
          <div className="sms-form">
            <label className="sms-field">
              <span className="sms-prefix">+86</span>
              <input id="smsPhone" type="tel" maxLength="11" placeholder="手机号" autoComplete="tel" />
            </label>
            <div className="sms-code-row">
              <label className="sms-field">
                <input id="smsCode" type="text" inputMode="numeric" maxLength="6" placeholder="6 位验证码" autoComplete="one-time-code"
                  onKeyDown={(e) => { if (e.key === 'Enter') A().submitSmsLogin(); }} />
              </label>
              <button className="btn-ghost" id="btnSmsSend" type="button" disabled={L.smsSendDisabled} onClick={() => A().sendSmsCode()}>{L.smsSendLabel}</button>
            </div>
            <div className="geetest-slot" id="geetestSlot"></div>
            <div className={`login-status${L.smsStatusCls ? ' ' + L.smsStatusCls : ''}`} id="smsStatus">{L.smsStatusText}</div>
            <button className="btn-primary" id="btnSmsLogin" type="button" disabled={L.smsLoginDisabled} onClick={() => A().submitSmsLogin()}>登录</button>
          </div>
        </div>
        <small>登录凭证由 Electron 会话安全保存，不写入页面存储。</small>
      </div>
    </div>
  );
}
