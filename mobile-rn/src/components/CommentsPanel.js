import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as bili from '../api/bili';
import { imageHeaders } from '../api/client';
import { colors, fmtCount } from '../theme';
import SheetContent from './SheetContent';

function useComments(aid, sort, root) {
  const [state, setState] = useState({ items: null, total: 0, more: false, loading: true, error: '' });
  const request = useRef(null), epoch = useRef(0), page = useRef(0), pending = useRef(false);
  const load = useCallback(async (next = 1) => {
    if (pending.current) return;
    pending.current = true;
    const token = ++epoch.current, controller = new AbortController();
    request.current = controller;
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const result = root
        ? await bili.commentReplies(aid, root, next, 20, { signal: controller.signal })
        : await bili.replies(aid, next, 12, { sort, signal: controller.signal });
      if (token !== epoch.current || controller.signal.aborted) return;
      page.current = next;
      setState(s => ({ items: [...new Map([...(next === 1 ? [] : s.items || []), ...result.list].map(c => [String(c.rpid), c])).values()],
        total: result.total, more: !!result.hasMore && result.list.length > 0, loading: false, error: '' }));
    } catch (e) {
      if (token === epoch.current && !controller.signal.aborted) setState(s => ({ ...s, loading: false, error: e.message || '评论加载失败' }));
    } finally { if (token === epoch.current) { pending.current = false; request.current = null; } }
  }, [aid, sort, root]);
  useEffect(() => {
    load();
    return () => { epoch.current++; request.current?.abort(); pending.current = false; };
  }, [load]);
  return { ...state, next: () => load(page.current + 1) };
}
function Action({ label, onPress, disabled = false }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={onPress} style={s.action}><Text style={[s.link, disabled && { opacity: .5 }]}>{label}</Text></TouchableOpacity>;
}
function Comment({ item, onReplies }) {
  const count = Math.max(item.replyCount || 0, item.replies?.length || 0);
  return <View style={s.comment}>
    {item.avatar ? <Image source={{ uri: item.avatar, headers: imageHeaders() }} style={s.avatar} /> : <View style={s.avatar} />}
    <View style={s.body}><Text style={s.name}>{item.name}</Text><Text selectable style={s.message}>{item.message}</Text>
      <Text style={s.meta}>{item.ctime ? new Date(item.ctime * 1000).toLocaleDateString('zh-CN') + ' · ' : ''}赞 {fmtCount(item.like || 0)}</Text>
      {onReplies && count > 0 ? <View style={s.preview}>
        {(item.replies || []).slice(0, 2).map(reply => <Text key={reply.rpid} numberOfLines={2} style={s.previewText}>
          <Text style={s.link}>{reply.name}：</Text>{reply.message}</Text>)}
        <Action label={`查看 ${count} 条回复`} onPress={() => onReplies(item)} />
      </View> : null}
    </View>
  </View>;
}
function CommentList({ data, header, onReplies }) {
  return <SheetContent loading={data.items === null && data.loading} minHeight={260}>
    <FlatList testID="comments-list" data={data.items || []} keyExtractor={c => String(c.rpid)} style={s.list}
      keyboardShouldPersistTaps="handled" renderItem={({ item }) => <Comment item={item} onReplies={onReplies} />}
      ListHeaderComponent={header}
      ListEmptyComponent={!data.loading && !data.error ? <Text style={s.empty}>暂无{onReplies ? '评论' : '回复'}</Text> : null}
      ListFooterComponent={<>
        {data.error ? <><Text accessibilityRole="alert" style={s.error}>{data.error}</Text><Action label="重试" onPress={data.next} /></> : null}
        {data.loading && data.items !== null ? <ActivityIndicator color={colors.accent} style={s.spinner} /> : null}
        {!data.error && !!data.items?.length ? <Action label={data.more ? '加载更多' : '没有更多了'} onPress={data.next} disabled={data.loading || !data.more} /> : null}
      </>} />
  </SheetContent>;
}
function Thread({ aid, root }) {
  const data = useComments(aid, 'default', String(root.rpid));
  return <CommentList data={data} header={<View style={s.root}><Comment item={root} /><Text style={s.meta}>全部回复</Text></View>} />;
}
function Feed({ aid, sort }) {
  const data = useComments(aid, sort);
  const [root, setRoot] = useState(null);
  return <>
    {root ? <View style={s.toolbar}><Action label="返回评论" onPress={() => setRoot(null)} /><Text style={s.meta}>{root.replyCount || root.replies?.length || 0} 条回复</Text></View> : <Text style={s.meta}>共 {fmtCount(data.total)} 条评论</Text>}
    <View style={[s.body, root && { display: 'none' }]} accessibilityElementsHidden={!!root} importantForAccessibility={root ? 'no-hide-descendants' : 'auto'}>
      <CommentList data={data} onReplies={setRoot} />
    </View>
    {root ? <Thread key={root.rpid} aid={aid} root={root} /> : null}
  </>;
}
export default function CommentsPanel({ aid }) {
  const [sort, setSort] = useState('default');
  return <View style={s.panel}>
    <View style={s.tabs}>{[['default', '默认'], ['latest', '最新']].map(([id, label]) =>
      <TouchableOpacity key={id} accessibilityRole="tab" accessibilityLabel={`${label}评论`} accessibilityState={{ selected: sort === id }}
        onPress={() => setSort(id)} style={[s.tab, sort === id && s.selected]}><Text style={[s.tabText, sort === id && s.link]}>{label}</Text></TouchableOpacity>)}</View>
    <Feed key={`${aid}:${sort}`} aid={aid} sort={sort} />
  </View>;
}
const s = StyleSheet.create({ panel: { flexShrink: 1, gap: 10 }, body: { flexShrink: 1, flexGrow: 1, minWidth: 0 },
  list: { flexGrow: 0, flexShrink: 1, maxHeight: 360 }, tabs: { flexDirection: 'row', gap: 6, alignSelf: 'flex-start', padding: 3, borderRadius: 14, backgroundColor: colors.card },
  tab: { paddingHorizontal: 18, minHeight: 40, justifyContent: 'center', borderRadius: 11 }, selected: { backgroundColor: colors.accentSoft },
  tabText: { color: colors.text2, fontSize: 13 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  comment: { flexDirection: 'row', gap: 10, paddingVertical: 13 }, avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardBorder },
  name: { color: colors.text2, fontSize: 12 }, message: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 5 }, meta: { color: colors.text3, fontSize: 11, marginTop: 6 },
  preview: { backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, marginTop: 10, gap: 6 }, previewText: { color: colors.text2, fontSize: 12, lineHeight: 18 },
  link: { color: colors.accent, fontSize: 12 }, action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  root: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }, spinner: { marginVertical: 14 },
  empty: { color: colors.text3, paddingVertical: 40, textAlign: 'center' }, error: { color: colors.danger, paddingVertical: 12, textAlign: 'center' },
});
