import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { usePlayer } from '../player/PlayerContext';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import { trackKeyOf } from '../player/track';
import TrackRow from '../components/TrackRow';
import CollectionToolbar, { useCollectionView } from '../components/CollectionToolbar';
import { IconBack, IconPlaylist } from '../components/icons';

export default function MusicLibraryScreen({ navigation }) {
  const { libraryTracks, playQueue, current, resolveTrackUp } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
  const collection = useCollectionView(libraryTracks);
  const tracks = collection.visibleTracks;
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>我的音乐库</Text>
        <Text style={styles.count}>{libraryTracks.length} 首</Text>
      </View>
      <CollectionToolbar query={collection.query} onQuery={collection.setQuery} sort={collection.sort}
        onSort={collection.setSort} resultCount={tracks.length} />
      <ScrollView contentContainerStyle={styles.content}>
        {tracks.length ? tracks.map((track, index) => (
          <TrackRow
            key={trackKeyOf(track) || index}
            track={track}
            active={trackKeyOf(current) === trackKeyOf(track)}
            onPress={() => playQueue(tracks, index)}
            onPressUp={canOpenTrackUp(track) ? () => openUp(track) : undefined}
          />
        )) : !libraryTracks.length ? (
          <View style={styles.emptyBox}>
            <IconPlaylist size={30} color={colors.text3} />
            <Text style={styles.empty}>音乐库还是空的{`\n`}喜欢歌曲，或从歌曲菜单加入音乐库</Text>
          </View>
        ) : <Text style={styles.noResult}>没有找到匹配的歌曲</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  backBtn: { padding: 6 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  count: { color: colors.text3, fontSize: 12, paddingRight: 8 },
  content: { paddingBottom: 130 },
  emptyBox: { alignItems: 'center', marginTop: 96, gap: 14 },
  empty: { color: colors.text3, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  noResult: { color: colors.text3, fontSize: 13, textAlign: 'center', marginTop: 72 },
});
