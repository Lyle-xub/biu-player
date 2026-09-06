import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import { IconChevronDown, IconReorder, IconSearch } from './icons';

const SORTS = [
  { key: 'added-desc', label: '加入时间', direction: '新到旧' },
  { key: 'added-asc', label: '加入时间', direction: '旧到新' },
  { key: 'title-asc', label: '歌曲标题', direction: '正序' },
  { key: 'title-desc', label: '歌曲标题', direction: '逆序' },
  { key: 'artist-asc', label: 'UP 主', direction: '正序' },
  { key: 'artist-desc', label: 'UP 主', direction: '逆序' },
];

export function useCollectionView(tracks) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('added-desc');
  const visibleTracks = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    let next = (tracks || []).map((track, index) => ({ track, index })).filter(({ track }) => !keyword
      || `${track.title || ''} ${track.up || ''}`.toLocaleLowerCase().includes(keyword));
    const [field, direction] = sort.split('-');
    const sign = direction === 'desc' ? -1 : 1;
    if (field === 'added') next.sort((a, b) => {
      const at = Number(a.track.addedAt) || 0, bt = Number(b.track.addedAt) || 0;
      if (at && bt) return sign * (at - bt);
      if (at || bt) return sign * (at ? 1 : -1);
      return sign * (b.index - a.index);
    });
    next = next.map(({ track }) => track);
    if (field === 'title') next = [...next].sort((a, b) => sign * String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'));
    else if (field === 'artist') next = [...next].sort((a, b) => sign * String(a.up || '').localeCompare(String(b.up || ''), 'zh-CN'));
    return next;
  }, [query, sort, tracks]);
  return { query, setQuery, sort, setSort, visibleTracks };
}

export default function CollectionToolbar({ query, onQuery, sort, onSort, resultCount }) {
  const [sortOpen, setSortOpen] = useState(false);
  const selected = SORTS.find((item) => item.key === sort) || SORTS[0];
  return (
    <View style={styles.wrap}>
      <View style={styles.search}>
        <IconSearch size={17} color={colors.text3} />
        <TextInput value={query} onChangeText={onQuery} placeholder="搜索歌曲或歌手"
          placeholderTextColor={colors.text3} selectionColor={colors.accent}
          returnKeyType="search" clearButtonMode="while-editing" style={styles.input} />
      </View>
      <TouchableOpacity style={[styles.sort, sortOpen && styles.sortOpen]} onPress={() => setSortOpen((open) => !open)}
        accessibilityRole="button" accessibilityState={{ expanded: sortOpen }}
        accessibilityLabel={`排序方式：${selected.label}${selected.direction}`}>
        <IconReorder size={16} color={colors.accent} />
        <IconChevronDown size={11} color={colors.accent} />
      </TouchableOpacity>
      {sortOpen ? <View style={styles.menu}>
        {SORTS.map((item) => {
          const active = item.key === sort;
          return <TouchableOpacity key={item.key} style={[styles.option, active && styles.optionOn]}
            onPress={() => { onSort(item.key); setSortOpen(false); }} accessibilityRole="menuitem"
            accessibilityState={{ selected: active }}>
            <Text style={[styles.optionLabel, active && styles.optionTextOn]}>{item.label}</Text>
            <Text style={[styles.optionDirection, active && styles.optionTextOn]}>{item.direction}</Text>
          </TouchableOpacity>;
        })}
      </View> : null}
      {query ? <Text style={styles.result}>{resultCount} 个结果</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, flexWrap: 'wrap' },
  search: { flex: 1, minWidth: 0, height: 40, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,.075)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,.16)' },
  input: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0 },
  sort: { width: 46, height: 40, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2,
    borderRadius: 20, backgroundColor: colors.accentSoft, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(251,114,153,.36)' },
  sortOpen: { backgroundColor: 'rgba(251,114,153,.18)' },
  menu: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8,
    borderRadius: 18, backgroundColor: 'rgba(27,30,22,.96)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder },
  option: { width: '48%', flexGrow: 1, minWidth: 145, minHeight: 42, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,.055)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,.08)' },
  optionOn: { backgroundColor: colors.accentSoft, borderColor: 'rgba(251,114,153,.38)' },
  optionLabel: { color: colors.text2, fontSize: 13, fontWeight: '600' },
  optionDirection: { color: colors.text3, fontSize: 11 },
  optionTextOn: { color: colors.accent },
  result: { width: '100%', color: colors.text3, fontSize: 11, paddingLeft: 4 },
});
