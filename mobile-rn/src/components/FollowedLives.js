import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { usePlayer } from '../player/PlayerContext';
import { initClient } from '../api/client';
import * as bili from '../api/bili';
import { colors } from '../theme';
import RemoteImage from './RemoteImage';
import { IconRadio } from './icons';

export default function FollowedLives({ onSelect, refreshKey = 0 }) {
  const { account, current } = usePlayer();
  const focused = useIsFocused();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRooms([]); setError(false); setLoading(false);
    if (!focused || !account?.isLogin) return;
    setLoading(true);
    initClient().then(() => bili.followedLives())
      .then((list) => { if (!cancelled) setRooms(list); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [focused, account?.isLogin, account?.mid, refreshKey, retry]);

  return <View style={styles.section}>
    <Text style={styles.heading}>关注的主播 <Text style={styles.hint}>正在直播</Text></Text>
    {!account?.isLogin ? <Text style={styles.hint}>登录后可查看已关注主播的直播</Text>
      : loading ? <ActivityIndicator color={colors.accent} />
        : error ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="重试关注直播"
          onPress={() => setRetry((n) => n + 1)}><Text style={styles.hint}>关注直播加载失败，点击重试</Text></TouchableOpacity>
          : !rooms.length ? <Text style={styles.hint}>关注的主播暂时没有开播</Text>
            : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {rooms.map((room, index) => <TouchableOpacity key={room.roomid} style={styles.room}
                accessibilityRole="button" accessibilityLabel={`观看 ${room.up} 的直播`}
                onPress={() => onSelect(rooms, index)}>
                <View style={[styles.avatar, String(current?.roomid) === String(room.roomid) && styles.active]}>
                  <RemoteImage uri={room.face || room.pic} width={120} height={120} style={styles.image}
                    fallback={<IconRadio size={24} color={colors.accent} />} />
                  <View style={styles.dot} />
                </View>
                <Text numberOfLines={1} style={styles.name}>{room.up}</Text>
              </TouchableOpacity>)}
            </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  section: { paddingVertical: 14, gap: 12 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.text3, fontSize: 12, fontWeight: '400' },
  row: { gap: 14 }, room: { width: 70, alignItems: 'center', gap: 7 },
  avatar: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: colors.cardBorder, padding: 3 },
  active: { borderColor: colors.accent }, image: { width: 48, height: 48, borderRadius: 24 },
  dot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  name: { color: colors.text2, fontSize: 12, maxWidth: 70 },
});
