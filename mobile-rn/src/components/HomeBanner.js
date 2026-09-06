/* Biu Player RN · 首页轮播 banner：取当前列表前 5 条，全宽 16:9 大图 + 标题叠层，
 * 3.5s 自动轮播 + 手动滑动（ScrollView pagingEnabled，无第三方轮播依赖）+ 圆点指示器，
 * 点击直接播放对应曲目。圆角与 TrackCard 一致（16）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme';
import { IconNote } from './icons';
import RemoteImage from './RemoteImage';

const PAGE_W = Dimensions.get('window').width - 28; // 对齐 scrollContent 的 14px 双侧边距
const AUTO_MS = 3500;

export default function HomeBanner({ tracks, onPress }) {
  const items = (tracks || []).slice(0, 5);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef(null);
  const timerRef = useRef(null);
  const indexRef = useRef(0);

  const stopTimer = () => { clearInterval(timerRef.current); timerRef.current = null; };
  const startTimer = () => {
    stopTimer();
    if (items.length < 2) return;
    timerRef.current = setInterval(() => {
      const nextIdx = (indexRef.current + 1) % items.length;
      indexRef.current = nextIdx;
      setIndex(nextIdx);
      scrollRef.current && scrollRef.current.scrollTo({ x: nextIdx * PAGE_W, animated: true });
    }, AUTO_MS);
  };

  useEffect(() => {
    indexRef.current = 0;
    setIndex(0);
    scrollRef.current && scrollRef.current.scrollTo({ x: 0, animated: false });
    startTimer();
    return stopTimer;
  }, [items.length, items[0] && items[0].bvid]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMomentumEnd = ({ nativeEvent }) => {
    const i = Math.round(nativeEvent.contentOffset.x / PAGE_W);
    indexRef.current = i;
    setIndex(i);
    startTimer(); // 手动滑完重置自动轮播节奏
  };

  if (!items.length) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={stopTimer}
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.scroll}
      >
        {items.map((t, i) => (
          <TouchableOpacity
            key={t.bvid || t.aid || i}
            activeOpacity={0.88}
            style={styles.page}
            onPress={() => onPress && onPress(t, i)}
          >
            <View style={styles.mediaClip}>
              <RemoteImage uri={t.pic} width={1280} height={720} style={styles.image}
                fallback={<View style={[StyleSheet.absoluteFill, styles.imageFallback]}>
                  <IconNote size={34} color={colors.accent} />
                </View>} />
              <LinearGradient
                colors={['transparent', 'rgba(9,11,7,0.82)']}
                style={styles.shade}
                pointerEvents="none"
              />
              <View style={styles.meta} pointerEvents="none">
                <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
                {t.up ? <Text style={styles.up} numberOfLines={1}>{t.up}</Text> : null}
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.dots} pointerEvents="none">
        {items.map((t, i) => (
          <View key={t.bvid || t.aid || i} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  scroll: { borderRadius: 16 },
  page: {
    width: PAGE_W, aspectRatio: 16 / 9,
    borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#1a1e14',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  mediaClip: { ...StyleSheet.absoluteFill, borderRadius: 15, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' },
  meta: { position: 'absolute', left: 12, right: 12, bottom: 10 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  up: { color: colors.text2, fontSize: 11, marginTop: 3 },
  dots: {
    flexDirection: 'row', gap: 5, justifyContent: 'center', marginTop: 8,
  },
  dot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  dotOn: { backgroundColor: colors.accent, width: 12, borderRadius: 2.5 },
});
