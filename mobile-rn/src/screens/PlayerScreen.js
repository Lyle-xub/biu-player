/* Biu Player RN · 播放页（Apple Music Now Playing 风格）
 * 背景：封面高斯模糊（expo-image blurRadius）+ 暗化遮罩；
 * 顶部「歌词 | 原视频」胶囊分段开关（照抄桌面 renderer/styles.css .mode-seg：
 *   半透明玻璃底 rgba(20,22,16,.42) + 白色滑块浮起，仅当前曲目有 bvid 且非直播时显示），
 *   两侧同时挂载，原生驱动横向平移切换，视频纹理不做透明度动画；
 * 单 player 架构：PlayerContext 的唯一 expo-video player 始终播放 progressive mp4
 *   （声音从视频流出），歌词模式只是把视频画面移到可视区域外；切换 mediaMode 纯显隐，
 *   永不 replace/pause/resume——没有重载、没有串台；两侧进度/控制共用同一 position/playing。
 * 歌词侧两种子模式——封面模式：大封面 / 标题行（我喜欢 + …）/ 进度条 / 传输控制 / 底部歌词·队列图标；
 *   歌词模式：顶行小封面 + 标题 / AMLL 风格歌词区 / 传输控制（歌词图标切换，不动）。
 * 歌词：默认简单效果（行放大、文字渐白），设置可切莫奈字形扫光；
 *   两种效果共用原生时钟与切行滚动，>3s 空档插间奏圆点，支持点行 seek。
 * 直播（isLive）：无分段开关 / 无进度条 / 无歌词 / 无视频入口（HLS 也走同一 player）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing,
  ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import useMediaTransition from '../player/useMediaTransition';
import { trackKeyOf, segmentRange } from '../player/track';
import VideoActionBar from '../components/VideoActionBar';
import { colors, fmtDur } from '../theme';
import * as bili from '../api/bili';
import { usePlayer } from '../player/PlayerContext';
import LyricsRail, { attachLyricInterludes } from '../components/LyricsRail';
import VideoPane from '../components/VideoPane';
import PlaylistPicker from '../components/PlaylistPicker';
import BottomSheet from '../components/BottomSheet';
import PlaybackQueue from '../components/PlaybackQueue';
import RemoteImage from '../components/RemoteImage';
import {
  IconChevronDown, IconLyric, IconMore, IconNext, IconNote, IconPause, IconPlay,
  IconPlaylist, IconPrev, IconQueue, IconRadio, IconShare, IconHeart, IconVideo,
} from '../components/icons';

// 桌面 cleanLyricText：B 站字幕常用 ♪ 包裹歌词，只保留正文
const cleanLyricText = (text) => String(text || '')
  .replace(/^[\s♪♫♬♩♭♮♯]+|[\s♪♫♬♩♭♮♯]+$/gu, '')
  .trim();

function ProgressScrubber({ position, duration, isLive, onSeek }) {
  const width = useRef(1);
  const dragging = useRef(false);
  const target = useRef(0);
  const animated = useRef(new Animated.Value(0)).current;
  const [preview, setPreview] = useState(null);
  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  useEffect(() => {
    if (!dragging.current) animated.setValue(progress);
  }, [animated, progress]);

  if (isLive) return <Text style={styles.liveHint}>直播中 · 无法拖动进度</Text>;

  const update = (evt) => {
    if (!duration) return 0;
    const ratio = Math.max(0, Math.min(1, evt.nativeEvent.locationX / width.current));
    target.current = ratio * duration;
    animated.setValue(ratio); // 先移动 UI，不触发播放器解码 seek。
    setPreview(target.current);
    return target.current;
  };
  const begin = (evt) => {
    dragging.current = true;
    update(evt);
  };
  const commit = (evt) => {
    if (!dragging.current) return;
    const value = Number.isFinite(evt?.nativeEvent?.locationX) ? update(evt) : target.current;
    dragging.current = false;
    setPreview(null);
    if (duration) onSeek(value); // 松手后只调整播放器一次。
  };
  const adjust = (name) => {
    if (name !== 'increment' && name !== 'decrement') return;
    const delta = name === 'increment' ? 10 : -10;
    onSeek(Math.max(0, Math.min(duration, position + delta)));
  };
  const shown = preview ?? position;
  const bubbleLeft = duration > 0 ? `${Math.max(0.08, Math.min(0.92, shown / duration)) * 100}%` : '8%';

  return (
    <View>
      <View
        style={styles.progressZone}
        accessibilityRole="adjustable"
        accessibilityLabel="播放进度"
        accessibilityValue={{ min: 0, max: Math.round(duration || 0), now: Math.round(shown || 0), text: fmtDur(shown) }}
        accessibilityActions={[{ name: 'increment', label: '快进 10 秒' }, { name: 'decrement', label: '后退 10 秒' }]}
        onAccessibilityAction={(e) => adjust(e.nativeEvent.actionName)}
        onLayout={(e) => { width.current = Math.max(1, e.nativeEvent.layout.width); }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={begin}
        onResponderMove={update}
        onResponderRelease={commit}
        onResponderTerminate={commit}
      >
        {preview !== null ? (
          <View pointerEvents="none" style={[styles.scrubBubble, { left: bubbleLeft }]}>
            <Text style={styles.scrubBubbleText}>{fmtDur(preview)}</Text>
          </View>
        ) : null}
        <View style={[styles.progressTrack, preview !== null && styles.progressTrackActive]}>
          <Animated.View style={[styles.progressFill, {
            width: animated.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }, preview !== null && styles.progressFillActive]} />
        </View>
        <Animated.View style={[styles.progressThumb, {
          left: animated.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          transform: [{ scale: preview !== null ? 1.42 : 1 }],
        }, preview !== null && styles.progressThumbActive]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={[styles.time, preview !== null && styles.timeActive]}>{fmtDur(shown)}</Text>
        <Text style={styles.time}>{fmtDur(duration)}</Text>
      </View>
    </View>
  );
}

export default function PlayerScreen({ navigation, route }) {
  const {
    current, isLive, playing, buffering, position, duration, playError,
    togglePlay, next, prev, seekTo, isLiked, toggleLike,
    player: mediaPlayer, lyricSettings, lyricEffect, seekRevision,
  } = usePlayer();
  const { width: winW, height: winH } = useWindowDimensions();
  const transition = useMediaTransition(navigation);
  const focused = useIsFocused();

  const [mode, setMode] = useState('cover'); // cover | lyrics（歌词侧子页）
  const [mediaMode, setMediaMode] = useState('lyrics'); // lyrics | video（顶部分段开关，纯显隐）
  const [sheet, setSheet] = useState(null); // menu | queue | playlist

  const [lyrics, setLyrics] = useState(null); // null=加载中 []=无词
  const [activeLine, setActiveLine] = useState(-1);
  const [railSize, setRailSize] = useState({ width: 0, height: 0 });

  const liked = isLiked(current);
  const hasVideo = !!(current && current.bvid && !isLive);

  const coverSize = Math.min(winW * 0.86, winH * 0.44);
  const curKey = trackKeyOf(current);
  const lyricSetting = lyricSettings[curKey];
  const lyricOffset = lyricSetting?.offset || 0;
  const lyricPosition = position + lyricOffset;
  const showLyrics = () => { setMediaMode('lyrics'); setMode('lyrics'); };
  useEffect(() => {
    if (route.params?.showLyrics) {
      showLyrics();
      navigation.setParams({ showLyrics: false });
    }
  }, [route.params?.showLyrics, navigation]);

  /* Keep the video texture opaque and attached throughout the horizontal transition. */
  const modeAnim = useRef(new Animated.Value(0)).current; // 0=歌词 1=视频
  const [segW, setSegW] = useState(108);
  useEffect(() => {
    const animation = Animated.timing(modeAnim, {
      toValue: mediaMode === 'video' ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [mediaMode, modeAnim]);
  const lyricSlide = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -winW] });
  const videoSlide = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [winW, 0] });
  const segSlide = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, segW] });

  // 分段开关：纯 UI 显隐（player 始终活跃，声音画面同一条流）
  const switchMedia = (m) => { if (m !== mediaMode) setMediaMode(m); };

  // 换视频才重置模式；在同一原视频里切换分切段时保留视频画面。
  useEffect(() => { setMediaMode('lyrics'); }, [current?.bvid, current?.roomid]);

  // 切歌拉歌词：清洗 ♪ 包裹 → 间隔 >3s 插间奏行（照抄桌面 attachLyricInterludes）
  useEffect(() => {
    setLyrics(null);
    setActiveLine(-1);
    if (!current || current.isLive) { setLyrics([]); return; }
    let cancelled = false;
    (async () => {
      let lines = lyricSetting?.lines || await bili.searchLyric(current.title, current.up, current.duration || 0);
      if (!lines && current.bvid && current.cid) {
        lines = await bili.subtitles(current.bvid, current.cid).catch(() => null);
        const range = segmentRange(current);
        if (range && lines) lines = lines.filter((l) => l.to > range.from && l.from < range.to)
          .map((l) => ({ ...l, from: Math.max(0, l.from - range.from), to: Math.min(range.to, l.to) - range.from }));
      }
      if (cancelled) return;
      const cleaned = (lines || [])
        .map((l) => ({ ...l, text: cleanLyricText(l.text) }))
        .filter((l) => l.interlude || l.text);
      setLyrics(cleaned.length ? attachLyricInterludes(cleaned) : []);
    })();
    return () => { cancelled = true; };
  }, [curKey, current?.cid, lyricSetting?.lines]); // eslint-disable-line react-hooks/exhaustive-deps

  // 直播没有歌词模式
  useEffect(() => { if (isLive) setMode('cover'); }, [isLive]);

  // 当前行匹配（Monet 轨道自动跟随，无手动滚动）
  useEffect(() => {
    if (!lyrics || !lyrics.length || isLive) return;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i += 1) {
      if (lyricPosition >= lyrics[i].from) idx = i;
      else break;
    }
    if (idx !== activeLine) setActiveLine(idx);
  }, [lyricPosition, lyrics, isLive, activeLine]);

  const openVideo = () => {
    setSheet(null);
    switchMedia('video');
  };

  const bottomRow = (
    <View style={styles.bottomRow}>
      {!isLive ? (
        <TouchableOpacity
          style={[styles.roundBtn, mode === 'lyrics' && styles.roundBtnOn]}
          onPress={() => setMode(mode === 'lyrics' ? 'cover' : 'lyrics')}
          hitSlop={8}
        >
          <IconLyric size={19} color={mode === 'lyrics' ? colors.accent : 'rgba(255,255,255,0.8)'} />
        </TouchableOpacity>
      ) : <View style={styles.roundBtn} />}
      <TouchableOpacity style={styles.roundBtn} onPress={() => setSheet('queue')} hitSlop={8}>
        <IconQueue size={19} color="rgba(255,255,255,0.8)" />
      </TouchableOpacity>
    </View>
  );

  const videoBottomRow = (
    <View style={styles.bottomRow}>
      <View style={styles.roundBtn} />
      <TouchableOpacity style={styles.roundBtn} onPress={() => setSheet('queue')} hitSlop={8}>
        <IconQueue size={19} color="rgba(255,255,255,0.8)" />
      </TouchableOpacity>
    </View>
  );

  // 传输控制：两侧共用（同一 player；取流失败时播放键即重试，见 PlayerContext.togglePlay）
  const controls = (
    <View style={styles.controls}>
      <TouchableOpacity onPress={prev} hitSlop={12}>
        <IconPrev size={34} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.playBtn} onPress={togglePlay} activeOpacity={0.85}>
        {buffering ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : playing ? (
          <IconPause size={38} color="#fff" />
        ) : (
          <IconPlay size={38} color="#fff" />
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={next} hitSlop={12}>
        <IconNext size={34} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  const progressBar = <ProgressScrubber key={curKey} position={position} duration={duration}
    isLive={isLive} onSeek={seekTo} />;

  return (
    <Animated.View style={[styles.viewport, transition.viewportStyle]} onLayout={transition.onLayout}>
      <Animated.View style={[styles.root, transition.style]}>
        {/* 模糊封面背景 + 暗化遮罩 */}
        <RemoteImage uri={current && current.pic} width={720} height={1280}
          style={StyleSheet.absoluteFill} blurRadius={50} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,7,5,0.62)' }]} />

        <View style={[styles.safe, transition.safeStyle]}>
          {/* 收起按钮与分段导航共用顶栏；两侧等宽让导航保持屏幕居中。 */}
          <View style={styles.header} {...transition.panHandlers}>
            <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}
              accessibilityRole="button" accessibilityLabel="收起播放页">
              <IconChevronDown size={24} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              {hasVideo ? (
                <View style={styles.seg} onLayout={(e) => setSegW((e.nativeEvent.layout.width - 6) / 2)}>
                  <Animated.View style={[styles.segPill, { width: segW, transform: [{ translateX: segSlide }] }]} />
                  <TouchableOpacity style={styles.segBtn} onPress={() => switchMedia('lyrics')} activeOpacity={0.8}
                    accessibilityRole="tab" accessibilityState={{ selected: mediaMode === 'lyrics' }}>
                    <IconLyric size={13} color={mediaMode === 'lyrics' ? '#171810' : 'rgba(255,255,255,0.56)'} />
                    <Text style={[styles.segText, mediaMode === 'lyrics' && styles.segTextOn]}>歌词</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.segBtn} onPress={() => switchMedia('video')} activeOpacity={0.8}
                    accessibilityRole="tab" accessibilityState={{ selected: mediaMode === 'video' }}>
                    <IconVideo size={13} color={mediaMode === 'video' ? '#171810' : 'rgba(255,255,255,0.56)'} />
                    <Text style={[styles.segText, mediaMode === 'video' && styles.segTextOn]}>原视频</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
            <View style={styles.headerButton} pointerEvents="none" />
          </View>

          {/* 内容区：两侧保持挂载，平移时保留视频画面 */}
          <View style={styles.bodyStack}>
            <Animated.View
              pointerEvents={mediaMode === 'lyrics' ? 'auto' : 'none'}
              accessibilityElementsHidden={mediaMode !== 'lyrics'}
              importantForAccessibility={mediaMode === 'lyrics' ? 'auto' : 'no-hide-descendants'}
              style={[StyleSheet.absoluteFill, {
                transform: [{ translateX: lyricSlide }],
              }]}
            >
              {!current ? (
                <View style={styles.center}>
                  <Text style={styles.hint}>还没有在播的歌，去首页挑一首吧</Text>
                </View>
              ) : mode === 'cover' ? (
                /* ---------- 封面模式 ---------- */
                <View style={styles.coverBody}>
                  <View>
                    <TouchableOpacity activeOpacity={0.92} onPress={() => !isLive && setMode('lyrics')}>
                      <RemoteImage uri={current.pic} width={1024} height={1024}
                        style={[styles.bigCover, { width: coverSize, height: coverSize }]}
                        fallback={<View style={[StyleSheet.absoluteFill, styles.bigCoverFallback]}>
                          {isLive ? <IconRadio size={64} color={colors.accent} /> : <IconNote size={64} color={colors.accent} />}
                        </View>} />
                    </TouchableOpacity>
                  </View>

                  {/* 标题行：左标题/UP，右我喜欢 + … */}
                  <View style={styles.titleRow}>
                    <View style={styles.titleBox}>
                      <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
                      <Text style={styles.up} numberOfLines={1}>{current.up}</Text>
                    </View>
                    <TouchableOpacity style={styles.smallRoundBtn} onPress={() => toggleLike(current)} hitSlop={6}
                      accessibilityRole="button" accessibilityLabel={liked ? '取消我喜欢' : '加入我喜欢'}
                      accessibilityState={{ selected: liked }}>
                      <IconHeart size={18} color={liked ? colors.accent : 'rgba(255,255,255,0.85)'} filled={liked} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.smallRoundBtn} onPress={() => setSheet('menu')} hitSlop={6}>
                      <IconMore size={17} color="rgba(255,255,255,0.85)" />
                    </TouchableOpacity>
                  </View>

                  {playError ? <Text style={styles.error} numberOfLines={2}>{playError}</Text> : null}
                  {progressBar}
                  {controls}
                  {bottomRow}
                </View>
              ) : (
                /* ---------- 歌词模式 ---------- */
                <View style={styles.lyricBody}>
                  {/* 顶行：小封面 + 标题/UP + 我喜欢 + … */}
                  <View style={styles.lyricHead}>
                    <RemoteImage uri={current.pic} width={180} height={180} style={styles.miniCover}
                      fallback={<View style={[StyleSheet.absoluteFill, styles.bigCoverFallback]}>
                        <IconNote size={16} color={colors.accent} />
                      </View>} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.miniTitle} numberOfLines={1}>{current.title}</Text>
                      <Text style={styles.miniUp} numberOfLines={1}>{current.up}</Text>
                    </View>
                    <TouchableOpacity style={styles.smallRoundBtn} onPress={() => toggleLike(current)} hitSlop={6}
                      accessibilityRole="button" accessibilityLabel={liked ? '取消我喜欢' : '加入我喜欢'}
                      accessibilityState={{ selected: liked }}>
                      <IconHeart size={18} color={liked ? colors.accent : 'rgba(255,255,255,0.85)'} filled={liked} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.smallRoundBtn} onPress={() => setSheet('menu')} hitSlop={6}>
                      <IconMore size={17} color="rgba(255,255,255,0.85)" />
                    </TouchableOpacity>
                  </View>

                  {/* 两种效果共用原生时钟；简单效果逐排填白，莫奈效果逐词扫光。 */}
                  <View
                    style={styles.lyricZone}
                    onLayout={(e) => setRailSize({
                      width: e.nativeEvent.layout.width,
                      height: e.nativeEvent.layout.height,
                    })}
                  >
                    {lyrics && lyrics.length ? (
                      <LyricsRail
                        key={curKey}
                        effect={lyricEffect}
                        clockRevision={`${curKey}:${seekRevision}:${lyricOffset}`}
                        lines={lyrics}
                        activeIndex={activeLine}
                        height={railSize.height}
                        width={railSize.width}
                        position={lyricPosition}
                        playing={playing && !buffering && focused && mediaMode === 'lyrics'}
                        onSeek={(line) => seekTo(line.from - lyricOffset)}
                      />
                    ) : (
                      <View style={styles.center}>
                        <Text style={styles.noLyric}>
                          {lyrics === null ? '歌词加载中…' : '纯音乐 / 暂无歌词'}
                        </Text>
                      </View>
                    )}
                  </View>

                  {controls}
                  {bottomRow}
                </View>
              )}
            </Animated.View>

            {/* ---------- 视频侧（同一 player 的画面层，常挂载常播，仅显隐） ---------- */}
            <Animated.View
              pointerEvents={mediaMode === 'video' ? 'auto' : 'none'}
              accessibilityElementsHidden={mediaMode !== 'video'}
              importantForAccessibility={mediaMode === 'video' ? 'auto' : 'no-hide-descendants'}
              style={[StyleSheet.absoluteFill, styles.videoBody, {
                transform: [{ translateX: videoSlide }],
              }]}
            >
              {current ? (
                <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingTop: 12 }} showsVerticalScrollIndicator={false} removeClippedSubviews={false}>
                  <VideoPane player={mediaPlayer} buffering={buffering} error={playError}
                    cover={current.pic} visible={focused} />
                  <View style={styles.videoMeta}>
                    <Text style={styles.videoTitle} numberOfLines={2}>{current.title}</Text>
                    <Text style={styles.videoUp} numberOfLines={1}>{current.up}</Text>
                  </View>
                  <VideoActionBar track={current} active={mediaMode === 'video'} onShowLyrics={showLyrics} />
                  <View style={{ flex: 1, minHeight: 12 }} />
                  {progressBar}
                  {controls}
                  {videoBottomRow}
                </ScrollView>
              ) : null}
            </Animated.View>
          </View>
        </View>

        {/* 菜单、队列、歌单共用同一个窗口，面板间切换不重建原生 Modal。 */}
        <BottomSheet visible={!!sheet} onClose={() => setSheet(null)}
          style={sheet === 'menu' ? styles.sheet : styles.queueSheet}>
          {sheet === 'menu' && current ? (
            <>
              <TouchableOpacity style={styles.sheetItem} onPress={() => { toggleLike(current); setSheet(null); }}>
                <IconHeart size={18} color={liked ? colors.accent : colors.text} filled={liked} />
                <Text style={styles.sheetText}>{liked ? '取消我喜欢' : '加入我喜欢'}</Text>
              </TouchableOpacity>
              {!isLive ? (
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => setSheet('playlist')}
                >
                  <IconPlaylist size={18} color={colors.text} />
                  <Text style={styles.sheetText}>加入歌单</Text>
                </TouchableOpacity>
              ) : null}
              {hasVideo ? (
                <TouchableOpacity style={styles.sheetItem} onPress={openVideo}>
                  <IconVideo size={18} color={colors.text} />
                  <Text style={styles.sheetText}>播放视频</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.sheetItem} onPress={() => setSheet(null)}>
                <IconShare size={18} color={colors.text2} />
                <Text style={[styles.sheetText, { color: colors.text2 }]}>分享（后续版本）</Text>
              </TouchableOpacity>
            </>
          ) : null}
          {sheet === 'queue' ? <PlaybackQueue onClose={() => setSheet(null)} /> : null}
          {sheet === 'playlist' ? <PlaylistPicker track={current} onClose={() => setSheet(null)} /> : null}
        </BottomSheet>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', minWidth: 0 },
  /* 分段开关（照抄桌面 .mode-seg + .pill） */
  seg: {
    flexDirection: 'row', padding: 3, width: '100%', maxWidth: 224,
    backgroundColor: 'rgba(20,22,16,0.42)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
  },
  segPill: {
    position: 'absolute', left: 3, top: 3, bottom: 3,
    borderRadius: 999, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 9,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  segBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 999,
  },
  segText: { color: 'rgba(255,255,255,0.56)', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  segTextOn: { color: '#171810' },
  /* 内容区（歌词侧 / 视频侧叠放） */
  bodyStack: { flex: 1, overflow: 'hidden' },
  /* 封面模式 */
  coverBody: { flex: 1, paddingHorizontal: 26, justifyContent: 'space-between', paddingBottom: 6 },
  bigCover: {
    borderRadius: 12, backgroundColor: '#1a1e14', alignSelf: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  bigCoverFallback: { alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  titleBox: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  up: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 3 },
  smallRoundBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center' },
  progressZone: { paddingTop: 22, paddingBottom: 12, justifyContent: 'center' },
  progressTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressTrackActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  progressFillActive: { backgroundColor: colors.accent },
  progressThumb: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    bottom: 9, backgroundColor: '#fff', marginLeft: -5,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  progressThumbActive: {
    backgroundColor: '#fff', borderWidth: 2, borderColor: colors.accent,
    shadowColor: colors.accent, shadowOpacity: 0.65, shadowRadius: 8, elevation: 6,
  },
  scrubBubble: {
    position: 'absolute', top: -10, width: 58, height: 26, marginLeft: -29,
    alignItems: 'center', justifyContent: 'center', borderRadius: 9,
    backgroundColor: 'rgba(20,22,16,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  scrubBubbleText: { color: '#fff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontVariant: ['tabular-nums'] },
  timeActive: { color: colors.accent },
  liveHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 58 },
  playBtn: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  bottomRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 6, paddingTop: 2,
  },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  roundBtnOn: { backgroundColor: 'rgba(251,114,153,0.18)' },
  /* 歌词模式 */
  lyricBody: { flex: 1, paddingHorizontal: 22, paddingBottom: 6 },
  lyricHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  miniCover: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#1a1e14' },
  miniTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  miniUp: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  lyricZone: {
    flex: 1, marginTop: 4, marginBottom: 6,
    backgroundColor: 'transparent', overflow: 'hidden',
  },
  noLyric: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center' },
  /* 视频侧 */
  videoBody: { paddingTop: 6, paddingBottom: 6 },
  videoMeta: { marginTop: 14 },
  videoTitle: { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 24 },
  videoUp: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 5 },
  /* 菜单 / 队列弹层 */
  sheet: {
    backgroundColor: 'rgba(24,27,19,0.97)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingVertical: 10, paddingHorizontal: 8,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 15,
  },
  sheetText: { color: colors.text, fontSize: 15 },
  queueSheet: { maxHeight: '62%' },
});
