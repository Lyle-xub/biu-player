import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { artwork, quoteFor } from '../../../renderer/profile-presentation';
import { colors } from '../theme';

export default function ProfilePortrait({ profile, ready, flipped, onFlip }) {
  const art = useMemo(() => artwork(profile), [profile]);
  const turn = useRef(new Animated.Value(0)).current;
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const animation = Animated.timing(turn, { toValue: flipped ? 1 : 0, duration: 650,
      easing: Easing.bezier(0.22, 0.7, 0.2, 1), useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [flipped, turn]);
  useEffect(() => {
    let cancelled = false;
    setQuote(null); setError('');
    if (!ready) return;
    quoteFor(profile).then((value) => { if (!cancelled) setQuote(value); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [profile.id, art.theme.id, retry, ready]);
  return <View style={styles.spread}>
    <View style={styles.card}>
      <Animated.View pointerEvents={flipped ? 'none' : 'auto'} accessibilityElementsHidden={flipped}
        importantForAccessibility={flipped ? 'no-hide-descendants' : 'auto'}
        style={[styles.face, { transform: [{ perspective: 900 }, { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-180deg'] }) }, { rotateZ: '-3deg' }] }]}>
        <TouchableOpacity style={styles.front} onPress={onFlip} activeOpacity={0.9}
          accessibilityRole="button" accessibilityLabel="翻转卡片，查看用户画像">
          <View style={styles.art}><SvgXml xml={art.svg} width="100%" height="100%" /></View>
          <View style={styles.caption}>
            <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
            <Text style={styles.serial}>No. {art.serial} / 点击翻面 ↗</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
      <Animated.View pointerEvents={flipped ? 'auto' : 'none'} accessibilityElementsHidden={!flipped}
        importantForAccessibility={flipped ? 'auto' : 'no-hide-descendants'}
        style={[styles.face, styles.back, { transform: [{ perspective: 900 }, { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] }) }] }]}>
        <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
        <Text style={styles.serial}>你的兴趣 · {profile.tags.length} 个标签</Text>
        <ScrollView style={styles.weights} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {profile.tags.map((tag) => <View key={tag.name} style={styles.weightRow}>
            <Text style={styles.tagName}>{tag.name}</Text><Text style={styles.weight}>{tag.weight}</Text>
          </View>)}
          {!profile.tags.length && <Text style={styles.serial}>还没有标签，试着创建一份画像。</Text>}
        </ScrollView>
        <TouchableOpacity onPress={onFlip} accessibilityRole="button" accessibilityLabel="返回画像卡片正面" hitSlop={8} style={styles.returnButton}>
          <Text style={styles.serial}>↶ 返回卡面</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
    <View style={styles.quote}>
      <Text style={styles.theme}>{art.theme.label}</Text>
      <Text style={styles.mark} accessible={false}>“</Text>
      {quote ? <>
        <Text style={styles.quoteText}>{quote.text}</Text>
        <Text style={styles.source}>— {[quote.author, quote.from].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.credit}>一言 · 按兴趣主题选句</Text>
      </> : <>
        <Text style={styles.pending}>{error || '正在寻找与你共鸣的一句话…'}</Text>
        {!!error && <TouchableOpacity onPress={() => setRetry((n) => n + 1)} accessibilityRole="button" accessibilityLabel="重试语录">
          <Text style={styles.retry}>重试</Text>
        </TouchableOpacity>}
      </>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  spread: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 16 },
  card: { width: '46%', aspectRatio: 0.82 },
  face: { ...StyleSheet.absoluteFill, padding: 8, backgroundColor: '#ffffff', borderWidth: 1,
    borderColor: '#e9eaec', borderRadius: 1, backfaceVisibility: 'hidden', boxShadow: '0 2px 3px rgba(0,0,0,0.15), 0 14px 28px rgba(0,0,0,0.32)' },
  front: { flex: 1 }, art: { width: '100%', aspectRatio: 1, backgroundColor: '#141820', borderWidth: 1, borderColor: '#141820' },
  caption: { flex: 1, justifyContent: 'center', gap: 4, paddingTop: 4 },
  name: { fontSize: 11, fontWeight: '600', color: '#25282d' },
  serial: { fontSize: 8, color: '#767b84' },
  back: { gap: 6 }, weights: { flex: 1 },
  weightRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6,
    paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
  tagName: { flex: 1, fontSize: 10, color: '#25282d' }, weight: { fontSize: 10, color: '#9b5e59' },
  returnButton: { paddingTop: 4, paddingBottom: 2 },
  quote: { flex: 1, minWidth: 0 }, theme: { fontSize: 10, letterSpacing: 1, color: '#bfab8e' },
  mark: { height: 34, marginTop: 8, fontSize: 44, lineHeight: 48, color: '#bba58c', opacity: 0.6 },
  quoteText: { fontSize: 14, lineHeight: 25, color: '#eee7d9' },
  source: { fontSize: 10, lineHeight: 16, color: '#aaa496', marginTop: 12 },
  credit: { fontSize: 8, color: colors.text3, marginTop: 6 },
  pending: { color: colors.text3, fontSize: 12, lineHeight: 20 }, retry: { color: colors.accent, fontSize: 12, paddingVertical: 8 },
});
