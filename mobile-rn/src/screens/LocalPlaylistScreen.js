/* Biu Player RN · 本地歌单详情：歌单内曲目列表（TrackRow 复用，点行整列表入队播放），
 * 长按某行可将其从歌单移除（Alert 确认）。数据层 = src/store/playlists.js（本地 AsyncStorage）。
 */
import React from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { removeFromPlaylist, trackKeyOf, usePlaylists } from '../store/playlists';
import TrackRow from '../components/TrackRow';
import { IconBack, IconPlaylist } from '../components/icons';

export default function LocalPlaylistScreen({ navigation, route }) {
  const { id } = route.params || {};
  const playlists = usePlaylists();
  const { playQueue, current } = usePlayer();
  const pl = playlists.find((p) => p.id === id);
  const tracks = pl ? pl.tracks : [];

  const confirmRemove = (t) => {
    Alert.alert('从歌单移除', `把「${t.title}」从「${pl.title}」移除？`, [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: () => removeFromPlaylist(id, trackKeyOf(t)) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{pl ? pl.title : '歌单'}</Text>
        <Text style={styles.count}>{tracks.length ? `${tracks.length} 首` : ''}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {!pl ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>歌单不存在（可能已被删除）</Text>
          </View>
        ) : tracks.length ? (
          <>
            {tracks.map((t, i) => (
              <TrackRow
                key={trackKeyOf(t) || i}
                track={t}
                active={trackKeyOf(current) === trackKeyOf(t)}
                onPress={() => playQueue(tracks, i)}
                onLongPress={() => confirmRemove(t)}
                onPressUp={t.mid ? () => navigation.navigate('Up', { mid: t.mid }) : undefined}
              />
            ))}
            <Text style={styles.tip}>长按某首可将其从歌单移除</Text>
          </>
        ) : (
          <View style={styles.emptyBox}>
            <IconPlaylist size={30} color={colors.text3} />
            <Text style={styles.empty}>歌单里还没有歌曲{'\n'}播放页「…」菜单 → 加入歌单</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  backBtn: { padding: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  count: { color: colors.text3, fontSize: 12, paddingRight: 8 },
  content: { paddingBottom: 130 },
  tip: { color: colors.text3, fontSize: 11, textAlign: 'center', marginTop: 16 },
  emptyBox: { alignItems: 'center', marginTop: 96, gap: 14 },
  empty: { color: colors.text3, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
