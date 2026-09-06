import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import TrackRow from './TrackRow';
import { colors } from '../theme';

export default function CollectionTrackRow({ onRemove, onMenu, disabled = false, ...props }) {
  const swipe = useRef(null), locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (locked.current || disabled) return;
    locked.current = true; setBusy(true);
    try { await onRemove(); }
    finally { swipe.current?.close(); locked.current = false; setBusy(false); }
  };
  const menu = () => { if (!busy && !disabled) { swipe.current?.close(); onMenu(); } };
  return <Swipeable ref={swipe} enabled={!disabled && !busy} friction={1} rightThreshold={40}
    overshootRight={false} overshootLeft={false} enableTrackpadTwoFingerGesture
    renderRightActions={() => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`删除 ${props.track.title}`}
      disabled={busy || disabled} onPress={remove} style={styles.remove}><Text style={styles.label}>{busy ? '处理中' : '删除'}</Text></TouchableOpacity>}>
    <View style={styles.row}><TrackRow {...props} onLongPress={disabled ? props.onLongPress : menu} /></View>
  </Swipeable>;
}
const styles = StyleSheet.create({
  row: { backgroundColor: colors.bgSoft },
  remove: { width: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger },
  label: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
