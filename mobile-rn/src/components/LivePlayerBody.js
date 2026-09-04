import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as bili from '../api/bili';
import { colors, fmtCount } from '../theme';
import VideoPane from './VideoPane';
import { IconComment } from './icons';

const messageKey = (item) => `${item.uid}:${item.timeline}:${item.text}`;

function Bullet({ item, lane, width, onDone }) {
  const x = useRef(new Animated.Value(width)).current;
  const done = useRef(onDone); done.current = onDone;
  const textWidth = Math.min(1800, Math.max(100, Array.from(item.text).length * 15));
  useEffect(() => {
    x.setValue(width);
    const animation = Animated.timing(x, { toValue: -textWidth, duration: 8000,
      easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (finished) done.current(); });
    return () => animation.stop();
  }, [width, textWidth, x]);
  return <Animated.View style={{ position: 'absolute', left: 0, top: 8 + lane * 28, width: textWidth,
    transform: [{ translateX: x }] }}>
    <Text numberOfLines={1} style={styles.bullet}>{item.text}</Text>
  </Animated.View>;
}

function DanmakuOverlay({ items }) {
  const [width, setWidth] = useState(0);
  const [state, setState] = useState({ slots: [null, null, null, null], pending: [], seen: new Set() });
  useEffect(() => {
    setState((previous) => {
      let seen = new Set(previous.seen);
      let pending = [...previous.pending];
      for (const item of items) {
        const key = messageKey(item);
        if (seen.has(key)) continue;
        seen.add(key); pending.push({ ...item, key });
      }
      if (seen.size > 400) seen = new Set([...seen].slice(-200));
      // 每条轨道上一条离开后再进入下一条；拥挤时只保留最近的待播弹幕。
      pending = pending.slice(-20);
      const slots = previous.slots.map((item) => item || pending.shift() || null);
      return { slots, pending, seen };
    });
  }, [items]);
  const finish = (lane, key) => setState((previous) => {
    const pending = [...previous.pending];
    const slots = previous.slots.map((item, i) => i === lane && item?.key === key ? pending.shift() || null : item);
    return { ...previous, slots, pending };
  });
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}
    onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && state.slots.map((item, lane) => item && <Bullet key={item.key} item={item} lane={lane} width={width}
      onDone={() => finish(lane, item.key)} />)}
  </View>;
}

export default function LivePlayerBody({ current, player, playing, buffering, error, focused, controls, queueButton }) {
  const [enabled, setEnabled] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [messages, setMessages] = useState([]);
  const [dmError, setDmError] = useState(false);
  const seen = useRef(new Set());
  const active = focused && appActive && enabled && playing && !buffering && !error;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, timer;
    const poll = async () => {
      try {
        const items = await bili.liveDanmaku(current.roomid);
        if (cancelled) return;
        const fresh = items.filter((item) => {
          const key = messageKey(item);
          if (seen.current.has(key)) return false;
          seen.current.add(key); return true;
        });
        if (seen.current.size > 400) seen.current = new Set([...seen.current].slice(-200));
        if (fresh.length) setMessages((previous) => [...previous, ...fresh].slice(-40));
        setDmError(false);
      } catch { if (!cancelled) setDmError(true); }
      // 完成本次请求才安排下一轮，不叠加请求；退后台、关弹幕、离开页面即停止。
      if (!cancelled) timer = setTimeout(poll, 4000);
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [current.roomid, active]);

  return <View style={styles.body}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} removeClippedSubviews={false}>
      <VideoPane player={player} buffering={buffering} error={error} cover={current.pic} visible={focused} isLive>
        {active && <DanmakuOverlay items={messages} />}
      </VideoPane>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{current.title}</Text>
        <Text style={styles.hint} numberOfLines={1}>{current.up} · {current.online ? `${fmtCount(current.online)} 人在看 · ` : ''}{buffering ? '连接中' : playing ? '直播中' : '已暂停'}</Text>
      </View>
      <View style={styles.toolbar}>
        <Text style={styles.heading}>直播弹幕</Text>
        <TouchableOpacity style={[styles.toggle, enabled && styles.toggleOn]} onPress={() => setEnabled((on) => !on)}
          accessibilityRole="switch" accessibilityState={{ checked: enabled }} accessibilityLabel="直播弹幕">
          <IconComment size={16} color={enabled ? colors.accent : colors.text3} />
          <Text style={[styles.hint, enabled && { color: colors.accent }]}>{enabled ? '已开启' : '已关闭'}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.messages} contentContainerStyle={styles.messageContent} nestedScrollEnabled>
        {!enabled ? <Text style={styles.hint}>弹幕已关闭</Text>
          : <>
            {dmError && <Text style={styles.hint}>弹幕暂时无法连接，正在重试…</Text>}
            {!messages.length && !dmError && <Text style={styles.hint}>{playing ? '等待直播间弹幕…' : '播放直播后显示弹幕'}</Text>}
            {[...messages].reverse().map((item) => <Text key={messageKey(item)} style={styles.message}>
              <Text style={styles.nickname}>{item.nickname || '观众'}  </Text>{item.text}
            </Text>)}
          </>}
      </ScrollView>
    </ScrollView>
    <View style={styles.footer}>
      {controls}
      {queueButton}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 12 },
  footer: { paddingHorizontal: 20 },
  meta: { gap: 6, marginTop: 16, marginBottom: 12 },
  title: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  hint: { color: colors.text3, fontSize: 12 },
  heading: { color: colors.text2, fontSize: 13, fontWeight: '600' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  toggleOn: { backgroundColor: colors.accentSoft },
  messages: { height: 160, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  messageContent: { padding: 12, gap: 10 },
  message: { color: colors.text, fontSize: 13, lineHeight: 20 },
  nickname: { color: colors.accent },
  bullet: { color: '#fff', fontSize: 14, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 1, height: 1 } },
});
