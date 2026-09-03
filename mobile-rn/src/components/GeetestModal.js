/* Biu Player RN · 极验滑块弹窗：WebView 内嵌 gt.js
 * 与桌面端 controller.js runGeetest 同一模式：product:'bind' + appendTo 容器，
 * onReady 后 verify() 弹出滑块；onSuccess 时 postMessage getValidate() 回 RN。
 * 带 jserror/console 转发与加载看门狗——渲染失败时把具体原因显示出来。
 */
import React, { useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';

const READY_TIMEOUT = 9000;

function buildHtml(gt, challenge) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=340">
<style>
  html,body{margin:0;padding:0;background:#12150e}
  /* 极验面板固定 300px 宽：layout viewport 定 340px 让面板完整布局，
     再由 WebView scalesPageToFit 整体缩放到屏幕宽度，避免右缘/说明文字被裁 */
  #box{width:340px;box-sizing:border-box;padding:8px 20px;color:#9aa08f;
       font:13px/-apple-system sans-serif;text-align:center}
</style>
</head><body>
<div id="box">正在加载安全验证组件…</div>
<script>
  var post = function (obj) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
  };
  window.onerror = function (m, s, l) { post({ type: 'jserror', message: String(m) + (l ? ' @' + l : '') }); };
  function boot() {
    try {
      initGeetest({
        gt: ${JSON.stringify(gt)},
        challenge: ${JSON.stringify(challenge)},
        offline: false, new_captcha: true,
        product: 'bind', https: true, width: '100%'
      }, function (obj) {
        document.getElementById('box').innerHTML = '';
        obj.appendTo('#box');
        obj.onReady(function () { post({ type: 'ready' }); obj.verify(); });
        obj.onSuccess(function () {
          var r = obj.getValidate();
          post(r && typeof r !== 'boolean' ? { type: 'success', data: r } : { type: 'error' });
        });
        obj.onError(function () { post({ type: 'error' }); });
        if (obj.onClose) obj.onClose(function () { post({ type: 'close' }); });
      });
    } catch (e) { post({ type: 'error', message: String(e) }); }
  }
  var s = document.createElement('script');
  s.src = 'https://static.geetest.com/static/tools/gt.js';
  s.onload = boot;
  s.onerror = function () { post({ type: 'error', message: '极验组件加载失败，请检查网络' }); };
  document.head.appendChild(s);
</script>
</body></html>`;
}

export default function GeetestModal({ visible, gt, challenge, onResult, onCancel }) {
  const html = useMemo(() => buildHtml(gt, challenge), [gt, challenge]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errMsg, setErrMsg] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const timer = useRef(null);
  const statusRef = useRef('loading');
  const markStatus = (s) => { statusRef.current = s; setStatus(s); };

  const armWatchdog = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (statusRef.current === 'loading') {
        setErrMsg('验证组件加载超时');
        markStatus('error');
      }
    }, READY_TIMEOUT);
  };

  const handleMessage = (evt) => {
    let msg = null;
    try { msg = JSON.parse(evt.nativeEvent.data); } catch (e) { return; }
    if (msg.type === 'ready') {
      clearTimeout(timer.current);
      markStatus('ready');
    } else if (msg.type === 'success') {
      clearTimeout(timer.current);
      onResult(msg.data);
    } else if (msg.type === 'close') {
      clearTimeout(timer.current);
      onCancel();
    } else { // error / jserror：视为未完成，给出原因
      clearTimeout(timer.current);
      setErrMsg(msg.message || '验证未完成，请重试');
      markStatus('error');
    }
  };

  const retry = () => { markStatus('loading'); setErrMsg(''); setRetryKey((k) => k + 1); armWatchdog(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}
      onShow={armWatchdog}>
      <View style={styles.mask}>
        <View style={styles.card}>
          <Text style={styles.title}>安全验证</Text>
          <View style={styles.webWrap}>
            <WebView
              key={`${html}-${retryKey}`}
              source={{ html, baseUrl: 'https://www.geetest.com/' }}
              onMessage={handleMessage}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
              setSupportMultipleWindows={false}
              scalesPageToFit={true}
              style={styles.web}
            />
            {status !== 'ready' && (
              <View style={styles.overlay} pointerEvents="none">
                <Text style={styles.overlayText}>
                  {status === 'loading' ? '正在加载安全验证…' : `加载失败：${errMsg}`}
                </Text>
              </View>
            )}
          </View>
          {status === 'error' ? (
            <TouchableOpacity style={styles.retryBtn} onPress={retry} hitSlop={8}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    width: '88%', backgroundColor: colors.bgSoft, borderRadius: 20,
    borderWidth: 1, borderColor: colors.cardBorder, padding: 18, alignItems: 'center', gap: 12,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  webWrap: {
    alignSelf: 'stretch', height: 340, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#12150e',
  },
  web: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#12150e',
  },
  overlayText: { color: colors.text2, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: {
    borderRadius: 999, backgroundColor: colors.accent,
    paddingHorizontal: 26, height: 34, justifyContent: 'center',
  },
  retryText: { color: '#171810', fontSize: 12, fontWeight: '600' },
  cancelBtn: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder,
    paddingHorizontal: 22, height: 34, justifyContent: 'center',
  },
  cancelText: { color: colors.text2, fontSize: 12 },
});
