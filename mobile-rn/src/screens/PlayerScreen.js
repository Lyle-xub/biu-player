/* Biu Player RN · 播放页（Apple Music Now Playing 风格）
 * 背景：封面高斯模糊（expo-image blurRadius）+ 暗化遮罩；
 * 顶部「歌词 | 原视频」胶囊分段开关（照抄桌面 renderer/styles.css .mode-seg：
 *   半透明玻璃底 rgba(20,22,16,.42) + 白色滑块浮起，仅当前曲目有 bvid 且非直播时显示），
 *   两侧同时挂载，原生驱动横向平移切换，视频纹理不做透明度动画；
 * 单 player 架构：PlayerContext 的唯一 expo-video player 始终播放 progressive mp4
 *   （声音从视频流出），歌词模式只是把视频画面移到可视区域外；切换 mediaMode 纯显隐，
 *   永不 replace/pause/resume——没有重载、没有串台；两侧进度/控制共用同一 position/playing。
 * 歌词侧两种子模式——封面模式：大封面 / 标题行（我喜欢 + …）/ 进度条 / 传输控制 / 底部歌词·队列图标；
 *   歌词模式：顶行小封面 + 标题 / AMLL 风格歌词区；两侧共用固定的进度与传输控制。
 * 歌词：默认简单效果（行放大、文字渐白），设置可切莫奈字形扫光；
 *   两种效果共用原生时钟与切行滚动，>3s 空档插间奏圆点，支持点行 seek。
 * 直播（isLive）：显示同一 player 的 HLS 画面和弹幕，无点播进度与歌词。
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing,
  ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import useMediaTransition from '../player/useMediaTransition';
import { trackKeyOf } from '../player/track';
import VideoActionBar from '../components/VideoActionBar';
import { colors } from '../theme';
import ProgressScrubber from '../components/ProgressScrubber';
import { usePlayer } from '../player/PlayerContext';
import { loadTrackLyrics } from '../player/loadLyrics';
import { canOpenTrackUp, openTrackUp } from '../player/openTrackUp';
import { useTrackSource } from '../player/trackSource';
import LyricsRail from '../components/LyricsRail';
import VideoPane from '../components/VideoPane';
import LivePlayerBody from '../components/LivePlayerBody';
import PlaylistPicker from '../components/PlaylistPicker';
import BottomSheet from '../components/BottomSheet';
import PlaybackQueue from '../components/PlaybackQueue';
import RemoteImage from '../components/RemoteImage';
import {
  IconChevronDown, IconLyric, IconMore, IconNext, IconNote, IconPause, IconPlay,
  IconPlaylist, IconPrev, IconQueue, IconRadio, IconShare, IconHeart, IconVideo,
} from '../components/icons';

export default function PlayerScreen({ navigation, route }) {
  const {
    current, isLive, playing, buffering, position, duration, playError,
    togglePlay, next, prev, seekTo, isLiked, toggleLike,
    isInLibrary = () => false, toggleLibrary = () => {},
    player: mediaPlayer, lyricSettings, lyricEffect, seekRevision, resolveTrackUp,
  } = usePlayer();
  const openUp = (track) => openTrackUp(navigation, track, resolveTrackUp);
  const { width: winW, height: winH } = useWindowDimensions();
  const transition = useMediaTransition(navigation);
  const focused = useIsFocused();

  const [mode, setMode] = useState(route.params?.showLyrics ? 'lyrics' : 'cover'); // cover | lyrics（歌词侧子页）
  const reveal = useRef(new Animated.Value(mode === 'lyrics' ? 1 : 0)).current;
  useLayoutEffect(() => {
    const animation = Animated.timing(reveal, {
      toValue: mode === 'lyrics' ? 1 : 0, duration: 320,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1), useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [mode, reveal]);
  const [mediaMode, setMediaMode] = useState('lyrics'); // lyrics | video（顶部分段开关，纯显隐）
  const [sheet, setSheet] = useState(null); // menu | queue | playlist

  const [lyrics, setLyrics] = useState(null); // null=加载中 []=无词
  const [railSize, setRailSize] = useState({ width: 0, height: 0 });

  const liked = isLiked(current);
  const inLibrary = isInLibrary(current);
  const hasVideo = !!(current && current.bvid && !isLive);
  const canOpenCurrentUp = canOpenTrackUp(current);
  const attributedCurrent = useTrackSource(current);
  const sourceTitle = attributedCurrent?.isSegment ? attributedCurrent.parentTitle || '' : '';
  const sourceUp = attributedCurrent?.isSegment ? attributedCurrent.parentUp || '' : '';

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
    if (!current || current.isLive) { setLyrics([]); return; }
    let cancelled = false;
    (async () => {
      const lines = await loadTrackLyrics(current, lyricSetting);
      if (cancelled) return;
      setLyrics(lines);
    })();
    return () => { cancelled = true; };
  }, [curKey, current?.cid, lyricSetting?.lines]); // eslint-disable-line react-hooks/exhaustive-deps

  // 直播没有歌词模式
  useEffect(() => { if (isLive) setMode('cover'); }, [isLive]);

  // Derive in the same render as position so seeks never display the previous row first.
  const activeLine = useMemo(() => {
    if (!lyrics?.length || isLive) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length && lyricPosition >= lyrics[i].from; i += 1) idx = i;
    return idx;
  }, [lyricPosition, lyrics, isLive]);

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
    isLive={isLive} playing={playing && !buffering} seekRevision={seekRevision} onSeek={seekTo} />;

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
              ) : isLive ? <Text style={styles.miniTitle}>电台直播</Text> : null}
            </View>
            <View style={styles.headerButton} pointerEvents="none" />
          </View>

          {/* 内容区：两侧保持挂载，平移时保留视频画面 */}
          <View style={styles.bodyStack}>
            {isLive && current ? <LivePlayerBody key={curKey} current={current} player={mediaPlayer}
              playing={playing} buffering={buffering} error={playError} focused={focused}
              controls={controls} queueButton={videoBottomRow} /> : <>
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
              ) : (
                <View style={styles.playerBody}>
                  <View style={styles.bodyStack}>
                    {/* Both layouts stay measured; toggling only animates opacity/transforms. */}
                    <Animated.View pointerEvents={mode === 'cover' ? 'auto' : 'none'}
                      accessibilityElementsHidden={mode !== 'cover'}
                      importantForAccessibility={mode === 'cover' ? 'auto' : 'no-hide-descendants'}
                      style={[StyleSheet.absoluteFill, styles.coverBody, {
                        opacity: reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                        transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) },
                          { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }],
                      }]}>

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
                          <Text style={styles.title} numberOfLines={1}>{current.title}{sourceTitle ? <Text style={styles.sourceTitle}>  · {sourceTitle}</Text> : null}</Text>
                          <View style={styles.identityUpRow}>
                            <Text style={styles.up} numberOfLines={1}>{current.up}</Text>
                            {sourceUp ? <TouchableOpacity disabled={!canOpenCurrentUp} onPress={() => openUp(current)} hitSlop={6} style={styles.upHit}>
                              <Text style={[styles.sourceUp, canOpenCurrentUp && styles.sourceUpLink]} numberOfLines={1}>· {sourceUp}</Text>
                            </TouchableOpacity> : null}
                          </View>
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
                    </Animated.View>
                    <Animated.View pointerEvents={mode === 'lyrics' ? 'auto' : 'none'}
                      accessibilityElementsHidden={mode !== 'lyrics'}
                      importantForAccessibility={mode === 'lyrics' ? 'auto' : 'no-hide-descendants'}
                      style={[StyleSheet.absoluteFill, styles.lyricBody, {
                        opacity: reveal,
                        transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
                      }]}>

                      {/* 顶行：小封面 + 标题/UP + 我喜欢 + … */}
                      <View style={styles.lyricHead}>
                        <RemoteImage uri={current.pic} width={180} height={180} style={styles.miniCover}
                          fallback={<View style={[StyleSheet.absoluteFill, styles.bigCoverFallback]}>
                            <IconNote size={16} color={colors.accent} />
                          </View>} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.miniTitle} numberOfLines={1}>{current.title}{sourceTitle ? <Text style={styles.sourceTitle}>  · {sourceTitle}</Text> : null}</Text>
                          <View style={styles.identityUpRow}>
                            <Text style={styles.miniUp} numberOfLines={1}>{current.up}</Text>
                            {sourceUp ? <TouchableOpacity disabled={!canOpenCurrentUp} onPress={() => openUp(current)} hitSlop={6} style={styles.upHit}>
                              <Text style={[styles.sourceUp, canOpenCurrentUp && styles.sourceUpLink]} numberOfLines={1}>· {sourceUp}</Text>
                            </TouchableOpacity> : null}
                          </View>
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
                            playing={playing && !buffering && focused && mediaMode === 'lyrics' && mode === 'lyrics'}
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

                    </Animated.View>
                  </View>
                  <View style={styles.playerFooter}>
                    {progressBar}
                    {controls}
                    {bottomRow}
                  </View>
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
                    <Text style={styles.videoTitle} numberOfLines={2}>{current.isSegment ? sourceTitle || '正在读取原视频信息…' : current.title}</Text>
                    <View style={styles.identityUpRow}>
                      <TouchableOpacity disabled={!canOpenCurrentUp} onPress={() => openUp(current)} hitSlop={6} style={styles.upHit}>
                        <Text style={styles.videoUp} numberOfLines={1}>{current.isSegment ? sourceUp || '原 UP' : current.up}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <VideoActionBar track={current} active={mediaMode === 'video'} onShowLyrics={showLyrics} />
                  <View style={{ flex: 1, minHeight: 12 }} />
                  {progressBar}
                  {controls}
                  {videoBottomRow}
                </ScrollView>
              ) : null}
            </Animated.View>
            </>}
          </View>
        </View>

        {/* 菜单、队列、歌单共用应用内浮层，面板间切换不重建容器。 */}
        <BottomSheet visible={!!sheet} onClose={() => setSheet(null)}
          style={sheet === 'menu' ? styles.sheet : styles.queueSheet}>
          {sheet === 'menu' && current ? (
            <>
              <TouchableOpacity style={styles.sheetItem} onPress={() => { toggleLike(current); setSheet(null); }}>
                <IconHeart size={18} color={liked ? colors.accent : colors.text} filled={liked} />
                <Text style={styles.sheetText}>{liked ? '取消我喜欢' : '加入我喜欢'}</Text>
              </TouchableOpacity>
              {!isLive ? (
                <TouchableOpacity style={styles.sheetItem} onPress={() => { toggleLibrary(current); setSheet(null); }}>
                  <IconPlaylist size={18} color={inLibrary ? colors.accent : colors.text} />
                  <Text style={styles.sheetText}>{inLibrary ? '从音乐库移除' : '加入音乐库'}</Text>
                </TouchableOpacity>
              ) : null}
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
              <TouchableOpacity style={styles.sheetItem} onPress={() => {
                const track = current;
                setSheet(null);
                navigation.navigate('ShareCard', { track });
              }}>
                <IconShare size={18} color={colors.accent} />
                <Text style={[styles.sheetText, { color: colors.accent }]}>分享音乐</Text>
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
  playerBody: { flex: 1 },
  playerFooter: { paddingHorizontal: 26, paddingTop: 8, paddingBottom: 6, gap: 6 },
  coverBody: { paddingHorizontal: 26, justifyContent: 'space-between' },
  bigCover: {
    borderRadius: 12, backgroundColor: '#1a1e14', alignSelf: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  bigCoverFallback: { alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  titleBox: { flex: 1, minWidth: 0 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sourceTitle: { color: 'rgba(255,255,255,0.34)', fontSize: 10, fontWeight: '400' },
  identityUpRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 5 },
  up: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 3 },
  upHit: { alignSelf: 'flex-start', maxWidth: '100%' },
  upLink: { color: colors.accent },
  sourceUp: { color: 'rgba(255,255,255,0.32)', fontSize: 10, marginTop: 3 },
  sourceUpLink: { color: 'rgba(251,114,153,0.62)' },
  smallRoundBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center' },
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
  lyricBody: { paddingHorizontal: 22 },
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
