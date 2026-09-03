import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePlayer } from '../player/PlayerContext';
import { lanRequest, lanAcknowledge } from '../store/lanSync';
import { colors } from '../theme';

export default function LanSyncCard() {
  const { libraryReady, getSyncLibrary, applySyncLibrary } = usePlayer();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [paired, setPaired] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('电脑与手机连接同一 Wi-Fi，在电脑设置中点击手动同步，获取地址和配对码。');
  const operation = useRef(null);
  const edited = useRef(false);
  const mounted = useRef(true);
  const actions = useRef({ getSyncLibrary, applySyncLibrary });
  actions.current = { getSyncLibrary, applySyncLibrary };

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem('biu.lan-sync-address').then((value) => {
      if (mounted.current && !edited.current && value) setAddress(value);
    }).catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { mounted.current = false; operation.current?.abort(); subscription.remove(); };
  }, []);

  const synchronize = async (target = { address, code }) => {
    if (operation.current || libraryReady === false) return;
    const controller = new AbortController();
    operation.current = controller; setBusy(true); setMessage('正在同步…');
    try {
      const library = await actions.current.getSyncLibrary();
      const result = await lanRequest(target.address, target.code, library, controller.signal);
      if (controller.signal.aborted) return;
      await actions.current.applySyncLibrary(result.library);
      if (!mounted.current || controller.signal.aborted) return;
      await lanAcknowledge(target.address, target.code, result.receipt, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setPaired({ ...target, requestId: result.requestId });
      setMessage(`同步完成 · ${result.library.likes.length} 首喜欢 · ${result.library.playlists.length} 个歌单。保持此页打开，电脑也可发起同步。`);
      AsyncStorage.setItem('biu.lan-sync-address', target.address).catch(() => {});
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) { setPaired(null); setMessage(e.message || '同步失败，请重试'); }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const syncRef = useRef(synchronize);
  syncRef.current = synchronize;

  useEffect(() => {
    if (!paired || !focused || !foreground) return undefined;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      try {
        if (!operation.current) {
          const result = await lanRequest(paired.address, paired.code, null, controller.signal);
          if (!controller.signal.aborted && result.requestId > paired.requestId) await syncRef.current(paired);
        }
      } catch (e) {
        if (!controller.signal.aborted && mounted.current) { setPaired(null); setMessage(e.message || '连接已断开，请重新配对'); }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [paired, focused, foreground]);

  const disconnect = () => {
    operation.current?.abort(); setPaired(null); setMessage('已断开连接');
  };
  return <View style={styles.card}>
    <Text style={styles.title}>局域网同步</Text>
    <Text style={styles.desc}>合并两端的我喜欢和自建歌单，自动去重，保留两端内容。</Text>
    <TextInput accessibilityLabel="电脑地址" placeholder="电脑地址，例如 192.168.1.10:43821"
      placeholderTextColor={colors.text3} value={address} autoCapitalize="none" autoCorrect={false}
      editable={!busy && !paired} onChangeText={(value) => { edited.current = true; setAddress(value); }} style={styles.input} />
    <TextInput accessibilityLabel="配对码" placeholder="电脑显示的 8 位配对码" placeholderTextColor={colors.text3}
      value={code} keyboardType="number-pad" maxLength={8} editable={!busy && !paired} onChangeText={setCode} style={styles.input} />
    <View style={styles.buttons}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="手动同步" disabled={busy || libraryReady === false}
        onPress={() => synchronize()} style={[styles.button, (busy || libraryReady === false) && { opacity: 0.5 }]}>
        <Text style={styles.buttonText}>{busy ? '同步中…' : '手动同步'}</Text>
      </TouchableOpacity>
      {(paired || busy) && <TouchableOpacity accessibilityRole="button" accessibilityLabel="断开同步" onPress={disconnect} style={styles.button}>
        <Text style={styles.buttonText}>断开</Text>
      </TouchableOpacity>}
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.desc}>{message}</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { marginHorizontal: 14, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 16 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  desc: { color: colors.text3, fontSize: 12, lineHeight: 19, marginTop: 8 },
  input: { color: colors.text, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12, fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.accentSoft },
  buttonText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
