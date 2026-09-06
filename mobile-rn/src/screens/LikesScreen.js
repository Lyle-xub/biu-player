/* Biu Player RN · 我的喜欢：本地歌单列表页（数据源 = PlayerContext likes / AsyncStorage，
 * 与桌面端 biu-likes 本地收藏同源；播放页小心心即收进这里）
 */
import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import { trackKeyOf } from '../player/track';
import CollectionTrackRow from '../components/CollectionTrackRow';
import { useTrackActions } from '../components/TrackActions';
import CollectionToolbar, { useCollectionView } from '../components/CollectionToolbar';
import { IconBack, IconHeart } from '../components/icons';

export default function LikesScreen({ navigation }) {
  const { likes, playQueue, current, resolveTrackUp } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
  const collection = useCollectionView(likes);
  const actions = useTrackActions('likes');
  const tracks = collection.visibleTracks;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>我的喜欢</Text>
        <Text style={styles.count}>{likes.length} 首</Text>
      </View>
      <CollectionToolbar query={collection.query} onQuery={collection.setQuery} sort={collection.sort}
        onSort={collection.setSort} resultCount={tracks.length} />
      {actions.feedback}
      <FlatList data={tracks} keyExtractor={trackKeyOf} contentContainerStyle={styles.content}
        renderItem={({ item: t, index: i }) => (
            <CollectionTrackRow
              key={trackKeyOf(t) || i}
              track={t}
              active={trackKeyOf(current) === trackKeyOf(t)}
              onPress={() => playQueue(tracks, i)}
              onMenu={() => actions.open(t)} onRemove={() => actions.remove(t)}
              onPressUp={canOpenTrackUp(t) ? () => openUp(t) : undefined}
            />
          )}
        ListEmptyComponent={!likes.length ? (
          <View style={styles.emptyBox}>
            <IconHeart size={30} color={colors.text3} />
            <Text style={styles.empty}>还没有喜欢的歌曲{'\n'}播放页点小心心，歌就会收进来</Text>
          </View>
        ) : <Text style={styles.noResult}>没有找到匹配的歌曲</Text>} />
      {actions.sheet}
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
  emptyBox: { alignItems: 'center', marginTop: 96, gap: 14 },
  empty: { color: colors.text3, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  noResult: { color: colors.text3, fontSize: 13, textAlign: 'center', marginTop: 72 },
});
