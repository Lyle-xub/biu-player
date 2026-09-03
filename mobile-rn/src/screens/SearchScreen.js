/* Biu Player RN · 搜索：关键词输入 + 视频/UP 主分段，视频点击即播，UP 主进空间页 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fmtCount } from '../theme';
import * as bili from '../api/bili';
import { imageHeaders } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import TrackRow from '../components/TrackRow';
import { IconSearch, IconUser } from '../components/icons';

const ORDERS = [
  { key: '', label: '综合' },
  { key: 'click', label: '最多播放' },
  { key: 'pubdate', label: '最新发布' },
  { key: 'stow', label: '最多收藏' },
];

function UpRow({ up, onPress }) {
  return (
    <TouchableOpacity style={styles.upRow} activeOpacity={0.75} onPress={onPress}>
      {up.pic ? (
        <Image source={{ uri: up.pic, headers: imageHeaders() }} style={styles.upFace} />
      ) : (
        <View style={[styles.upFace, styles.upFaceFallback]}>
          <IconUser size={20} color={colors.text3} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.upName} numberOfLines={1}>{up.name}</Text>
        <Text style={styles.upMeta} numberOfLines={1}>
          粉丝 {fmtCount(up.fans)} · 视频 {up.videos}
        </Text>
        {up.sign ? <Text style={styles.upSign} numberOfLines={1}>{up.sign}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export default function SearchScreen({ navigation }) {
  const { playQueue, current } = usePlayer();
  const [keyword, setKeyword] = useState('');
  const [seg, setSeg] = useState('video'); // video | up
  const [order, setOrder] = useState('');
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const kwRef = useRef('');

  const run = useCallback(async (kw, p = 1, s = seg, ord = order) => {
    if (!kw.trim()) return;
    Keyboard.dismiss();
    if (p === 1) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const r = s === 'up'
        ? await bili.searchUps(kw.trim(), p)
        : await bili.search(kw.trim(), ord, 0, p);
      setList((prev) => (p === 1 ? r.list : [...prev, ...r.list]));
      setPage(r.page || p);
      setNumPages(r.numPages || 1);
      setSearched(true);
    } catch (e) {
      setError(String(e.message || e));
      if (p === 1) setList([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [seg, order]);

  const submit = () => { kwRef.current = keyword; run(keyword, 1); };
  const switchSeg = (s) => {
    setSeg(s);
    setList([]);
    setSearched(false);
    if (kwRef.current) run(kwRef.current, 1, s);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.inputPill}>
          <IconSearch size={15} color={colors.text2} />
          <TextInput
            style={styles.input}
            placeholder={seg === 'up' ? '搜索 UP 主…' : '搜索歌曲、视频…'}
            placeholderTextColor={colors.text3}
            value={keyword}
            onChangeText={setKeyword}
            returnKeyType="search"
            onSubmitEditing={submit}
            autoCapitalize="none"
          />
          {keyword ? (
            <TouchableOpacity onPress={() => setKeyword('')} hitSlop={8}>
              <Text style={styles.clear}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* 分段：视频 / UP 主 */}
      <View style={styles.segRow}>
        {[['video', '视频'], ['up', 'UP 主']].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.segBtn, seg === key && styles.segBtnOn]}
            onPress={() => switchSeg(key)}
          >
            <Text style={[styles.segText, seg === key && styles.segTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {seg === 'video' ? (
        <View style={styles.orderRow}>
          {ORDERS.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={[styles.orderChip, order === o.key && styles.orderChipOn]}
              onPress={() => {
                setOrder(o.key);
                if (kwRef.current) run(kwRef.current, 1, seg, o.key);
              }}
            >
              <Text style={[styles.orderText, order === o.key && styles.orderTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.hint}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => run(kwRef.current || keyword, 1)}>
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item, i) => String(seg === 'up' ? item.mid : (item.bvid || item.aid)) + '-' + i}
          renderItem={({ item, index }) => (seg === 'up' ? (
            <UpRow up={item} onPress={() => navigation.navigate('Up', { mid: item.mid })} />
          ) : (
            <TrackRow
              track={item}
              active={!!current && current.bvid === item.bvid}
              onPress={() => playQueue(list, index)}
              onPressUp={item.mid ? () => navigation.navigate('Up', { mid: item.mid }) : undefined}
            />
          ))}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.3}
          onEndReached={() => {
            if (searched && !loadingMore && page < numPages) run(kwRef.current, page + 1);
          }}
          ListEmptyComponent={(
            <View style={styles.center}>
              <Text style={styles.hint}>
                {searched
                  ? (seg === 'up' ? '没有找到相关 UP 主' : '没有找到相关视频，换个关键词试试')
                  : '输入关键词，搜索 B 站音乐视频或 UP 主'}
              </Text>
            </View>
          )}
          ListFooterComponent={loadingMore
            ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 14 }} />
            : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  inputPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 999, paddingHorizontal: 14, height: 42,
  },
  input: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  clear: { color: colors.text3, fontSize: 20, lineHeight: 20 },
  segRow: {
    flexDirection: 'row', marginHorizontal: 14, marginBottom: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: 999, padding: 3,
  },
  segBtn: {
    flex: 1, height: 32, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  segBtnOn: { backgroundColor: colors.accentSoft },
  segText: { color: colors.text2, fontSize: 13 },
  segTextOn: { color: colors.accent, fontWeight: '600' },
  orderRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  orderChip: {
    paddingHorizontal: 13, height: 30, borderRadius: 999, justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
  },
  orderChipOn: { backgroundColor: colors.accentSoft, borderColor: 'rgba(251,114,153,0.45)' },
  orderText: { color: colors.text2, fontSize: 12 },
  orderTextOn: { color: colors.accent, fontWeight: '600' },
  upRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  upFace: { width: 48, height: 48, borderRadius: 24 },
  upFaceFallback: {
    backgroundColor: '#1a1e14', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  upName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  upMeta: { color: colors.text3, fontSize: 11, marginTop: 3 },
  upSign: { color: colors.text2, fontSize: 11, marginTop: 2 },
  listContent: { paddingBottom: 140 },
  center: { alignItems: 'center', marginTop: 64, gap: 14, paddingHorizontal: 32 },
  hint: { color: colors.text2, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 22, height: 36, borderRadius: 999,
    backgroundColor: colors.accentSoft, justifyContent: 'center',
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
});
