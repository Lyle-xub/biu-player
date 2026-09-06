import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { usePlayer } from '../player/PlayerContext';
import { initClient } from '../api/client';
import * as bili from '../api/bili';
import { colors } from '../theme';
import RemoteImage from './RemoteImage';
import { IconRadio } from './icons';

const followedCache = new Map();

export default function FollowedLives({ onSelect, refreshKey = 0 }) {
  const { account, current } = usePlayer();
  const accountKey = account?.isLogin ? String(account.mid || 'signed-in') : '';
  const [rooms, setRooms] = useState(() => followedCache.get(accountKey) || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!accountKey) { setRooms([]); setError(false); setLoading(false); return undefined; }
    const cached = followedCache.get(accountKey);
    if (cached) setRooms(cached);
    if (cached && refreshKey === 0 && retry === 0) { setError(false); setLoading(false); return undefined; }
    setError(false); setLoading(!cached?.length);
    initClient().then(() => bili.followedLives())
      .then((list) => {
        followedCache.set(accountKey, list);
        if (!cancelled) setRooms(list);
      })
      .catch(() => { if (!cancelled && !cached?.length) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountKey, refreshKey, retry]);

  return <View style={styles.section}>
    <Text style={styles.heading}>关注的主播 <Text style={styles.hint}>正在直播</Text></Text>
    <View style={styles.content}>
      {!account?.isLogin ? <Text style={styles.hint}>登录后可查看已关注主播的直播</Text>
        : loading && !rooms.length ? <ActivityIndicator color={colors.accent} />
          : error && !rooms.length ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="重试关注直播"
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
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { paddingVertical: 14, gap: 12 },
  content: { minHeight: 82, justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.text3, fontSize: 12, fontWeight: '400' },
  row: { gap: 14 }, room: { width: 70, alignItems: 'center', gap: 7 },
  avatar: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: colors.cardBorder, padding: 3 },
  active: { borderColor: colors.accent }, image: { width: 48, height: 48, borderRadius: 24 },
  dot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  name: { color: colors.text2, fontSize: 12, maxWidth: 70 },
});
