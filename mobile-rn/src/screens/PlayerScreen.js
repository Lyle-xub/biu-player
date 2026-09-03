/* Biu Player RN · 播放页（Apple Music Now Playing 风格）
 * 背景：封面高斯模糊（expo-image blurRadius）+ 暗化遮罩；
 * 顶部「歌词 | 原视频」胶囊分段开关（照抄桌面 renderer/styles.css .mode-seg：
 *   半透明玻璃底 rgba(20,22,16,.42) + 白色滑块浮起，仅当前曲目有 bvid 且非直播时显示），
 *   两侧同时挂载，Animated crossfade 300ms Easing.out(quad) 切换；
 * 歌词侧两种子模式——封面模式：大封面 / 标题行（星标 + …）/ 进度条 / 传输控制 / 音量条 / 底部歌词·队列图标；
 *   歌词模式：顶行小封面 + 标题 / AMLL 风格歌词区 / 传输控制（歌词图标切换，不动）；
 * 视频侧：内嵌 VideoPane（16:9 圆角 VideoView + 自绘播放/暂停 + 可拖进度 + 时间），
 *   player 由本屏 useVideoPlayer 持有；互斥——进视频 pauseAll()，回歌词暂停视频并按需 resume()。
 * 歌词（实现见 src/components/LyricsRail.js）：AMLL 风格——fracAnchor 连续滚动、
 *   行级 filter blur / 明暗随与锚点距离连续变化、活跃行逐词白色光头 crossfade、
 *   MaskedView alpha 渐隐遮罩、>3s 空档插「......」间奏行、点行 seek。
 * 直播（isLive）：无分段开关 / 无进度条 / 无歌词 / 无视频入口。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, FlatList, Image, Modal,
  StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import MaskedView from '@react-native-masked-view/masked-view';
import { colors, fmtDur } from '../theme';
import { imageHeaders, streamHeaders } from '../api/client';
import * as bili from '../api/bili';
import { usePlayer } from '../player/PlayerContext';
import LyricsRail, { attachLyricInterludes } from '../components/LyricsRail';
import VideoPane, { useVideoSource } from '../components/VideoPane';
import {
  IconChevronDown, IconLyric, IconMore, IconNext, IconNote, IconPause, IconPlay,
  IconPrev, IconQueue, IconRadio, IconShare, IconStar, IconVideo,
  IconVolumeHigh, IconVolumeLow,
} from '../components/icons';

// 桌面 cleanLyricText：B 站字幕常用 ♪ 包裹歌词，只保留正文
const cleanLyricText = (text) => String(text || '')
  .replace(/^[\s♪♫♬♩♭♮♯]+|[\s♪♫♬♩♭♮♯]+$/gu, '')
  .trim();

export default function PlayerScreen({ navigation }) {
  const {
    current, isLive, playing, buffering, position, duration, playError,
    togglePlay, next, prev, seekTo, isLiked, toggleLike, setVolume, pauseAll, resume,
    queue, playIndex, index,
  } = usePlayer();
  const { width: winW } = useWindowDimensions();

  const [mode, setMode] = useState('cover'); // cover | lyrics（歌词侧子页）
  const [mediaMode, setMediaMode] = useState('lyrics'); // lyrics | video（顶部分段开关）
  const [volume, setVolumeState] = useState(1);
  const [menuVisible, setMenuVisible] = useState(false);
  const [queueVisible, setQueueVisible] = useState(false);

  const barWidth = useRef(1);
  const volWidth = useRef(1);
  const vidBarWidth = useRef(1);
  const [lyrics, setLyrics] = useState(null); // null=加载中 []=无词
  const [activeLine, setActiveLine] = useState(-1);
  const [railSize, setRailSize] = useState({ width: 0, height: 0 });

  const liked = isLiked(current);
  const hasVideo = !!(current && current.bvid && !isLive);
  const coverSize = winW * 0.88;
  const curKey = current && (current.bvid || current.roomid);

  /* ---------- 内嵌视频 player（本屏持有，VideoPane 只负责展示） ---------- */
  const videoPlayer = useVideoPlayer(null, (p) => { p.timeUpdateEventInterval = 0.5; });
  const { isPlaying: videoPlaying } = useEvent(videoPlayer, 'playingChange', { isPlaying: videoPlayer.playing });
  const { status: videoStatus } = useEvent(videoPlayer, 'statusChange', { status: videoPlayer.status });
  const { currentTime: videoTime } = useEvent(videoPlayer, 'timeUpdate', {
    currentTime: videoPlayer.currentTime || 0,
  });
  // 视频流地址预热（scheduleVideoWarmup 思路）：进播放页/切歌 4s 后后台预取 URL，不建 player
  const [videoWarmed, setVideoWarmed] = useState(false);
  useEffect(() => {
    setVideoWarmed(false);
    if (!hasVideo) return undefined;
    const t = setTimeout(() => setVideoWarmed(true), 4000);
    return () => clearTimeout(t);
  }, [curKey, hasVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  const { source: videoSrc, error: videoErr } = useVideoSource(
    current, hasVideo && (mediaMode === 'video' || videoWarmed));
  const wasPlayingRef = useRef(false); // 切到视频前音频是否在播
  const loadedSrcRef = useRef(null);   // 已装载进 videoPlayer 的流地址（防止重复 replace 重载）
  const posRef = useRef(0);            // 最新音频进度（首次切视频时对齐用）
  posRef.current = position;

  /* ---------- crossfade：单一 Animated.Value，两侧常挂载 ---------- */
  const modeAnim = useRef(new Animated.Value(0)).current; // 0=歌词 1=视频
  const [segW, setSegW] = useState(108);
  useEffect(() => {
    Animated.timing(modeAnim, {
      toValue: mediaMode === 'video' ? 1 : 0,
      duration: 300,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [mediaMode, modeAnim]);
  const lyricOpacity = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const lyricDrop = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 10] });
  const videoOpacity = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const videoScale = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });
  const segSlide = modeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, segW] });

  // 分段开关切换：互斥——进视频暂停全局音频，回歌词暂停视频并恢复音频（若之前在播）
  const switchMedia = (m) => {
    if (m === mediaMode) return;
    if (m === 'video') {
      wasPlayingRef.current = playing;
      pauseAll();
    } else {
      try { videoPlayer.pause(); } catch (e) {}
      if (wasPlayingRef.current) resume();
      wasPlayingRef.current = false;
    }
    setMediaMode(m);
  };

  // 切歌重置：回歌词模式、停视频、清标记（离开播放页再回来 state 保留，只有切歌重置）
  useEffect(() => {
    setMediaMode('lyrics');
    wasPlayingRef.current = false;
    loadedSrcRef.current = null;
    try { videoPlayer.pause(); } catch (e) {}
  }, [curKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 视频流就绪后装载并播放；同一流地址只 replace 一次，再次切入直接续播（不重载）
  useEffect(() => {
    if (mediaMode !== 'video' || !videoSrc) return;
    if (loadedSrcRef.current === videoSrc) {
      try { videoPlayer.play(); } catch (e) {}
      return;
    }
    loadedSrcRef.current = videoSrc;
    let cancelled = false;
    videoPlayer.replaceAsync({ uri: videoSrc, headers: streamHeaders() })
      .then(() => {
        if (cancelled) return;
        try { videoPlayer.currentTime = posRef.current; } catch (e) {} // 首次与音频进度对齐
        videoPlayer.play();
      })
      .catch(() => { loadedSrcRef.current = null; }); // 装载失败允许下次重试
    return () => { cancelled = true; };
  }, [mediaMode, videoSrc, videoPlayer]);

  // 切歌拉歌词：清洗 ♪ 包裹 → 间隔 >3s 插间奏行（照抄桌面 attachLyricInterludes）
  useEffect(() => {
    setLyrics(null);
    setActiveLine(-1);
    if (!current || current.isLive) { setLyrics([]); return; }
    let cancelled = false;
    (async () => {
      let lines = await bili.searchLyric(current.title, current.up, current.duration || 0);
      if (!lines && current.bvid && current.cid) {
        lines = await bili.subtitles(current.bvid, current.cid).catch(() => null);
      }
      if (cancelled) return;
      const cleaned = (lines || [])
        .map((l) => ({ ...l, text: cleanLyricText(l.text) }))
        .filter((l) => l.interlude || l.text);
      setLyrics(cleaned.length ? attachLyricInterludes(cleaned) : []);
    })();
    return () => { cancelled = true; };
  }, [curKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 直播没有歌词模式
  useEffect(() => { if (isLive) setMode('cover'); }, [isLive]);

  // 当前行匹配（Monet 轨道自动跟随，无手动滚动）
  useEffect(() => {
    if (!lyrics || !lyrics.length || isLive) return;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i += 1) {
      if (position >= lyrics[i].from) idx = i;
      else break;
    }
    if (idx !== activeLine) setActiveLine(idx);
  }, [position, lyrics, isLive, activeLine]);

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const seekAt = (evt) => {
    if (!duration || isLive) return;
    seekTo((evt.nativeEvent.locationX / barWidth.current) * duration);
  };
  const volumeAt = (evt) => {
    const v = Math.max(0, Math.min(1, evt.nativeEvent.locationX / volWidth.current));
    setVolumeState(v);
    setVolume(v);
  };

  /* ---------- 视频侧进度 ---------- */
  const vDuration = videoPlayer.duration || duration || 0;
  const vPosition = videoTime || 0;
  const vProgress = vDuration > 0 ? Math.min(1, vPosition / vDuration) : 0;
  const vBuffering = videoStatus === 'loading' || (mediaMode === 'video' && !videoSrc && !videoErr);
  const seekVideoAt = (evt) => {
    if (!vDuration) return;
    videoPlayer.currentTime = (evt.nativeEvent.locationX / vidBarWidth.current) * vDuration;
  };

  const openVideo = () => {
    setMenuVisible(false);
    pauseAll();
    try { videoPlayer.pause(); } catch (e) {}
    navigation.navigate('Video', { track: current });
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
      <TouchableOpacity style={styles.roundBtn} onPress={() => setQueueVisible(true)} hitSlop={8}>
        <IconQueue size={19} color="rgba(255,255,255,0.8)" />
      </TouchableOpacity>
    </View>
  );

  const videoBottomRow = (
    <View style={styles.bottomRow}>
      <View style={styles.roundBtn} />
      <TouchableOpacity style={styles.roundBtn} onPress={() => setQueueVisible(true)} hitSlop={8}>
        <IconQueue size={19} color="rgba(255,255,255,0.8)" />
      </TouchableOpacity>
    </View>
  );

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

  const videoControls = (
    <View style={styles.controls}>
      <TouchableOpacity onPress={prev} hitSlop={12}>
        <IconPrev size={34} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.playBtn}
        onPress={() => (videoPlaying ? videoPlayer.pause() : videoPlayer.play())}
        activeOpacity={0.85}
      >
        {vBuffering && !videoErr ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : videoPlaying ? (
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

  const volumeBar = (
    <View style={styles.volumeRow}>
      <IconVolumeLow size={17} color="rgba(255,255,255,0.55)" />
      <View
        style={styles.volumeZone}
        onLayout={(e) => { volWidth.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={volumeAt}
        onResponderMove={volumeAt}
      >
        <View style={styles.volumeTrack}>
          <View style={[styles.volumeFill, { width: `${volume * 100}%` }]} />
        </View>
        <View style={[styles.volumeThumb, { left: `${volume * 100}%` }]} />
      </View>
      <IconVolumeHigh size={17} color="rgba(255,255,255,0.55)" />
    </View>
  );

  const progressBar = isLive ? (
    <Text style={styles.liveHint}>直播中 · 无法拖动进度</Text>
  ) : (
    <View>
      <View
        style={styles.progressZone}
        onLayout={(e) => { barWidth.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={seekAt}
        onResponderMove={seekAt}
      >
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.progressThumb, { left: `${progress * 100}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmtDur(position)}</Text>
        <Text style={styles.time}>{fmtDur(duration)}</Text>
      </View>
    </View>
  );

  const videoProgressBar = (
    <View>
      <View
        style={styles.progressZone}
        onLayout={(e) => { vidBarWidth.current = e.nativeEvent.layout.width; }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={seekVideoAt}
        onResponderMove={seekVideoAt}
      >
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${vProgress * 100}%` }]} />
        </View>
        <View style={[styles.progressThumb, { left: `${vProgress * 100}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmtDur(vPosition)}</Text>
        <Text style={styles.time}>{fmtDur(vDuration)}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* 模糊封面背景 + 暗化遮罩 */}
      {current && current.pic ? (
        <ExpoImage
          source={{ uri: current.pic, headers: imageHeaders() }}
          style={StyleSheet.absoluteFill}
          blurRadius={50}
          contentFit="cover"
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,7,5,0.62)' }]} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* 顶栏：chevron 收起（原视频入口由下方分段开关取代，「…」菜单保留跳路由入口） */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
            <IconChevronDown size={24} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
          <View style={{ width: 21 }} />
        </View>

        {/* 「歌词 | 原视频」分段开关（照抄桌面 .mode-seg：玻璃胶囊底 + 白色滑块） */}
        {hasVideo ? (
          <View style={styles.segRow}>
            <View
              style={styles.seg}
              onLayout={(e) => setSegW((e.nativeEvent.layout.width - 6) / 2)}
            >
              <Animated.View
                style={[styles.segPill, { width: segW, transform: [{ translateX: segSlide }] }]}
              />
              <TouchableOpacity style={styles.segBtn} onPress={() => switchMedia('lyrics')} activeOpacity={0.8}>
                <IconLyric size={13} color={mediaMode === 'lyrics' ? '#171810' : 'rgba(255,255,255,0.56)'} />
                <Text style={[styles.segText, mediaMode === 'lyrics' && styles.segTextOn]}>歌词</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.segBtn} onPress={() => switchMedia('video')} activeOpacity={0.8}>
                <IconVideo size={13} color={mediaMode === 'video' ? '#171810' : 'rgba(255,255,255,0.56)'} />
                <Text style={[styles.segText, mediaMode === 'video' && styles.segTextOn]}>原视频</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* 内容区：歌词侧 / 视频侧同时挂载，crossfade 切换 */}
        <View style={styles.bodyStack}>
          <Animated.View
            pointerEvents={mediaMode === 'lyrics' ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, {
              opacity: lyricOpacity,
              transform: [{ translateY: lyricDrop }],
            }]}
          >
            {!current ? (
              <View style={styles.center}>
                <Text style={styles.hint}>还没有在播的歌，去首页挑一首吧</Text>
              </View>
            ) : mode === 'cover' ? (
              /* ---------- 封面模式 ---------- */
              <View style={styles.coverBody}>
                <TouchableOpacity activeOpacity={0.92} onPress={() => !isLive && setMode('lyrics')}>
                  {current.pic ? (
                    <Image
                      source={{ uri: current.pic, headers: imageHeaders() }}
                      style={[styles.bigCover, { width: coverSize, height: coverSize }]}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.bigCover, styles.bigCoverFallback, { width: coverSize, height: coverSize }]}>
                      {isLive ? <IconRadio size={64} color={colors.accent} /> : <IconNote size={64} color={colors.accent} />}
                    </View>
                  )}
                </TouchableOpacity>

                {/* 标题行：左标题/UP，右星标 + … */}
                <View style={styles.titleRow}>
                  <View style={styles.titleBox}>
                    <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
                    <Text style={styles.up} numberOfLines={1}>{current.up}</Text>
                  </View>
                  <TouchableOpacity style={styles.smallRoundBtn} onPress={() => toggleLike(current)} hitSlop={6}>
                    <IconStar size={17} color={liked ? colors.accent : 'rgba(255,255,255,0.85)'} filled={liked} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallRoundBtn} onPress={() => setMenuVisible(true)} hitSlop={6}>
                    <IconMore size={17} color="rgba(255,255,255,0.85)" />
                  </TouchableOpacity>
                </View>

                {playError ? <Text style={styles.error} numberOfLines={2}>{playError}</Text> : null}
                {progressBar}
                {controls}
                {volumeBar}
                {bottomRow}
              </View>
            ) : (
              /* ---------- 歌词模式 ---------- */
              <View style={styles.lyricBody}>
                {/* 顶行：小封面 + 标题/UP + … */}
                <View style={styles.lyricHead}>
                  {current.pic ? (
                    <Image source={{ uri: current.pic, headers: imageHeaders() }} style={styles.miniCover} />
                  ) : (
                    <View style={[styles.miniCover, styles.bigCoverFallback]}>
                      <IconNote size={16} color={colors.accent} />
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.miniTitle} numberOfLines={1}>{current.title}</Text>
                    <Text style={styles.miniUp} numberOfLines={1}>{current.up}</Text>
                  </View>
                  <TouchableOpacity style={styles.smallRoundBtn} onPress={() => setMenuVisible(true)} hitSlop={6}>
                    <IconMore size={17} color="rgba(255,255,255,0.85)" />
                  </TouchableOpacity>
                </View>

                {/* 歌词区：背景透明融进封面模糊背景；MaskedView alpha 遮罩做上下渐隐
                    （照抄桌面 mask-image: transparent 0 → #000 13% → #000 76% → transparent 100%） */}
                <View
                  style={styles.lyricZone}
                  onLayout={(e) => setRailSize({
                    width: e.nativeEvent.layout.width,
                    height: e.nativeEvent.layout.height,
                  })}
                >
                  {lyrics && lyrics.length ? (
                    <MaskedView
                      style={{ flex: 1 }}
                      maskElement={(
                        <LinearGradient
                          colors={['transparent', '#000', '#000', 'transparent']}
                          locations={[0, 0.13, 0.76, 1]}
                          style={{ flex: 1 }}
                        />
                      )}
                    >
                      <LyricsRail
                        lines={lyrics}
                        activeIndex={activeLine}
                        height={railSize.height}
                        width={railSize.width}
                        position={position}
                        playing={playing}
                        onSeek={(line) => seekTo(line.from)}
                      />
                    </MaskedView>
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

          {/* ---------- 视频侧（内嵌 VideoPane，常挂载） ---------- */}
          <Animated.View
            pointerEvents={mediaMode === 'video' ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.videoBody, {
              opacity: videoOpacity,
              transform: [{ scale: videoScale }],
            }]}
          >
            {current ? (
              <>
                <VideoPane player={videoPlayer} buffering={vBuffering} error={videoErr} />
                <View style={styles.videoMeta}>
                  <Text style={styles.videoTitle} numberOfLines={2}>{current.title}</Text>
                  <Text style={styles.videoUp} numberOfLines={1}>{current.up}</Text>
                </View>
                <View style={{ flex: 1 }} />
                {videoProgressBar}
                {videoControls}
                {videoBottomRow}
              </>
            ) : null}
          </Animated.View>
        </View>
      </SafeAreaView>

      {/* 「…」菜单 */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.sheetMask} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.sheet}>
            {current ? (
              <>
                <TouchableOpacity style={styles.sheetItem} onPress={() => { toggleLike(current); setMenuVisible(false); }}>
                  <IconStar size={18} color={liked ? colors.accent : colors.text} filled={liked} />
                  <Text style={styles.sheetText}>{liked ? '取消喜欢' : '喜欢'}</Text>
                </TouchableOpacity>
                {hasVideo ? (
                  <TouchableOpacity style={styles.sheetItem} onPress={openVideo}>
                    <IconVideo size={18} color={colors.text} />
                    <Text style={styles.sheetText}>播放视频</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.sheetItem} onPress={() => setMenuVisible(false)}>
                  <IconShare size={18} color={colors.text2} />
                  <Text style={[styles.sheetText, { color: colors.text2 }]}>分享（后续版本）</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 队列 */}
      <Modal visible={queueVisible} transparent animationType="slide" onRequestClose={() => setQueueVisible(false)}>
        <TouchableOpacity style={styles.sheetMask} activeOpacity={1} onPress={() => setQueueVisible(false)}>
          <View style={[styles.sheet, styles.queueSheet]}>
            <Text style={styles.queueTitle}>播放队列（{queue.length}）</Text>
            <FlatList
              data={queue}
              keyExtractor={(t, i) => `${t.bvid || t.roomid || t.aid}-${i}`}
              renderItem={({ item, i }) => (
                <TouchableOpacity
                  style={styles.queueRow}
                  onPress={() => { playIndex(queue, i); setQueueVisible(false); }}
                >
                  {item.isLive ? (
                    <View style={styles.queueLive}><Text style={styles.queueLiveText}>LIVE</Text></View>
                  ) : null}
                  <Text
                    style={[styles.queueName, i === index && { color: colors.accent }]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.queueUp} numberOfLines={1}>{item.up}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.hint}>队列为空</Text>}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 8,
  },
  /* 分段开关（照抄桌面 .mode-seg + .pill） */
  segRow: { alignItems: 'center', paddingBottom: 6 },
  seg: {
    flexDirection: 'row', padding: 3,
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
    width: 108, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 999,
  },
  segText: { color: 'rgba(255,255,255,0.56)', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  segTextOn: { color: '#171810' },
  /* 内容区（歌词侧 / 视频侧叠放） */
  bodyStack: { flex: 1 },
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
  progressZone: { paddingVertical: 12, justifyContent: 'center' },
  progressTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  progressThumb: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#fff', marginLeft: -5,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontVariant: ['tabular-nums'] },
  liveHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 58 },
  playBtn: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volumeZone: { flex: 1, paddingVertical: 10, justifyContent: 'center' },
  volumeTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  volumeFill: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.8)' },
  volumeThumb: {
    position: 'absolute', width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#fff', marginLeft: -6,
  },
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
  lyricZone: { flex: 1, marginTop: 4, marginBottom: 6, backgroundColor: 'transparent' },
  noLyric: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center' },
  /* 视频侧 */
  videoBody: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 6 },
  videoMeta: { marginTop: 14 },
  videoTitle: { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 24 },
  videoUp: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 5 },
  /* 菜单 / 队列弹层 */
  sheetMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'rgba(24,27,19,0.97)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingVertical: 10, paddingBottom: 28, paddingHorizontal: 8,
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 15,
  },
  sheetText: { color: colors.text, fontSize: 15 },
  queueSheet: { maxHeight: '62%' },
  queueTitle: {
    color: colors.text, fontSize: 15, fontWeight: '600',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  queueRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  queueName: { color: colors.text, fontSize: 14, flexShrink: 1, flex: 1 },
  queueUp: { color: colors.text3, fontSize: 11, maxWidth: 110 },
  queueLive: {
    backgroundColor: colors.accent, borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  queueLiveText: { color: '#fff', fontSize: 8, fontWeight: '800' },
});
