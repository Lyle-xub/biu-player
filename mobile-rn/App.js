/* Biu Player RN · 入口：底部 tab（首页/电台/搜索/我的）+ 播放页 stack + 迷你播放条
 * 转场（native-stack 原生转场，全部跑原生驱动）：
 * - 普通页面：iOS / Android 使用原生侧滑
 * - 播放页 / 视频页（全屏媒体）：iOS = slide_from_bottom 底部升起 + 下滑手势关闭；
 *   Android = 透明原生路由 + Animated 升降，退出动画完成后再移除路由
 * - tab 切换直接跟随导航状态；tab 图标选中态轻微 scale 弹性
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer, DefaultTheme, TabActions } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { isRunningInExpoGo } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from './src/theme';
import { PlayerProvider, usePlayer } from './src/player/PlayerContext';
import { LanSyncProvider } from './src/store/LanSyncProvider';
import { CloudSyncProvider } from './src/store/CloudSyncProvider';
import { mediaScreenOptions } from './src/player/useMediaTransition';
import MiniBar from './src/components/MiniBar';
import { OverlayProvider } from './src/components/Overlay';
import PageTransition, { pageScreenOptions } from './src/components/PageTransition';
import { IconDiscover, IconHome, IconRadio, IconSearch, IconUser } from './src/components/icons';
import HomeScreen from './src/screens/HomeScreen';
import DiscoveryScreen from './src/screens/DiscoveryScreen';
import DailyScreen from './src/screens/DailyScreen';
import RadioScreen from './src/screens/RadioScreen';
import SearchScreen from './src/screens/SearchScreen';
import MineScreen from './src/screens/MineScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import UpScreen from './src/screens/UpScreen';
import VideoScreen from './src/screens/VideoScreen';
import LikesScreen from './src/screens/LikesScreen';
import MusicLibraryScreen from './src/screens/MusicLibraryScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import LocalPlaylistScreen from './src/screens/LocalPlaylistScreen';
import PlaylistDetailScreen from './src/screens/PlaylistDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ShareCardScreen from './src/screens/ShareCardScreen';
import { AppUpdateNotice } from './src/components/AppUpdateCard';
import LyricsActivitySync from './src/components/LyricsActivitySync';
import { monitorEventLoop, navigationPressed, navigationCommitted } from './src/performance/diagnostics';

// Release the native splash as soon as the root is laid out. Image callbacks
// cannot gate it: Android keeps the content's pre-draw blocked while it is up.
SplashScreen.preventAutoHideAsync().catch(() => {});
if (!isRunningInExpoGo()) {
  SplashScreen.setOptions({ duration: 350, fade: true });
}

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: 'transparent',
    card: 'transparent',
    text: colors.text,
    border: 'rgba(255,255,255,0.09)',
  },
};

const TAB_ICONS = {
  Home: IconHome,
  Discover: IconDiscover,
  Radio: IconRadio,
  Search: IconSearch,
  Mine: IconUser,
};
const TAB_LABELS = { Home: '首页', Discover: '发现', Radio: '电台', Search: '搜索', Mine: '我的' };

function StartupGlow() {
  const opacity = useRef(new Animated.Value(1)).current;
  const [laidOut, setLaidOut] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    // A missing layout callback must not leave the native window above the app.
    const fallback = setTimeout(() => setLaidOut(true), 1000);
    return () => clearTimeout(fallback);
  }, []);
  useEffect(() => {
    if (!laidOut) return;
    SplashScreen.hideAsync().catch(() => {});
    const animation = Animated.timing(opacity, {
      toValue: 0, duration: 350, useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished) setVisible(false); });
    return () => animation.stop();
  }, [laidOut, opacity]);
  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={() => setLaidOut(true)}
      style={[StyleSheet.absoluteFill, styles.startup, { opacity }]}
    >
      <View style={styles.startupGlow}>
        <Svg width="100%" height="100%" viewBox="0 0 360 360">
          <Defs>
            <RadialGradient id="bootGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#f87ca0" stopOpacity={0.38} />
              <Stop offset="0.3" stopColor="#f1608f" stopOpacity={0.22} />
              <Stop offset="0.62" stopColor="#e74b81" stopOpacity={0.047} />
              <Stop offset="1" stopColor="#e74b81" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="360" height="360" fill="url(#bootGlow)" />
        </Svg>
      </View>
      <Animated.Image
        source={require('./assets/splash-icon.png')}
        resizeMode="contain"
        style={styles.startupLogo}
      />
    </Animated.View>
  );
}

function AmbientBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['rgba(251,114,153,0.085)', 'rgba(251,114,153,0.018)', 'transparent']}
        locations={[0, 0.38, 0.72]}
        start={{ x: 0, y: 0 }} end={{ x: 0.88, y: 0.72 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(142,196,112,0.045)']}
        locations={[0.38, 1]}
        start={{ x: 0.18, y: 0.2 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function screenLayout({ children, options, route, navigation }) {
  const media = route.name === 'Player' || route.name === 'Video';
  if (media && options.presentation === 'transparentModal') return children;
  const content = (
    <View style={styles.app}>
      <AmbientBackground />
      {children}
    </View>
  );
  if (route.name === 'Tabs' || media) return content;
  return <PageTransition navigation={navigation}>{content}</PageTransition>;
}

// tab 图标：选中态轻微 scale 弹性（spring，原生驱动）
function TabIcon({ name, color, focused }) {
  const Icon = TAB_ICONS[name];
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.14 : 1,
      useNativeDriver: true, speed: 24, bounciness: 9,
    }).start();
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon size={21} color={color} />
    </Animated.View>
  );
}

export function GlassTabBar({ state, navigation, blurTargets }) {
  const lastHomePressRef = useRef(null);
  const active = state.routes[state.index];
  useEffect(() => navigationCommitted(active.name), [active.name]);
  const navigate = (route) => {
    // A tap can arrive before React paints the preceding navigation. Use the
    // navigator's current identity and let its router handle same-tab no-ops.
    const currentState = navigation.getState?.() || state;
    const target = currentState.routes.find(item => item.name === route.name);
    if (!target) return;
    const event = navigation.emit({ type: 'tabPress', target: target.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    navigationPressed(target.name);
    const now = Date.now();
    const doublePress = route.name === 'Home' && lastHomePressRef.current !== null
      && now - lastHomePressRef.current <= 300;
    lastHomePressRef.current = route.name === 'Home' && !doublePress ? now : null;
    navigation.dispatch({ ...TabActions.jumpTo(target.name), target: currentState.key });
    if (doublePress) navigation.emit({ type: 'homeDoublePress', target: target.key });
  };
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { height: 49 + insets.bottom, paddingBottom: insets.bottom }]}>
      <BlurView pointerEvents="none"
        blurTarget={blurTargets[active.name]}
        blurMethod="dimezisBlurView"
        intensity={68}
        blurReductionFactor={3}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(18,22,15,0.30)', 'rgba(4,6,3,0.60)']}
        style={StyleSheet.absoluteFill}
      />
      {state.routes.map((route) => {
        const name = route.name;
        const focused = active.key === route.key;
        const color = focused ? colors.accent : colors.text3;
        return (
          <TouchableOpacity
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={TAB_LABELS[name]}
            accessibilityState={{ selected: focused }}
            activeOpacity={1}
            style={styles.tabButton}
            onPress={() => navigate(route)}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          >
            <TabIcon name={name} color={color} focused={focused} />
            <Text style={[styles.tabLabel, { color }, focused && styles.tabLabelActive]}>{TAB_LABELS[name]}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Tabs() {
  const { discoveryEnabled } = usePlayer(['discoveryEnabled']);
  const blurTargets = useRef(Object.fromEntries(Object.keys(TAB_LABELS).map((name) => [name, React.createRef()]))).current;
  const scene = useCallback(({ route, children }) => (
    <View style={styles.tabContent}>
      {/* BlurTarget reparents native children on Android. It must never own
          screen responders, GestureDetectors or video surfaces. */}
      <BlurTargetView ref={blurTargets[route.name]} pointerEvents="none" style={StyleSheet.absoluteFill}>
        <AmbientBackground />
      </BlurTargetView>
      {children}
    </View>
  ), [blurTargets]);
  return (
    <View style={styles.tabsWrap}>
        <Tab.Navigator
          tabBar={(props) => <GlassTabBar {...props} blurTargets={blurTargets} />}
          screenLayout={scene}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: 'transparent' },
            animation: 'none', // Returning from a stack must not resume a half-finished tab fade.
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: '首页' }} />
          {discoveryEnabled ? <Tab.Screen name="Discover" component={DiscoveryScreen}
            options={{ title: '发现' }} /> : null}
          <Tab.Screen name="Radio" component={RadioScreen} options={{ title: '电台' }} />
          <Tab.Screen name="Search" component={SearchScreen} options={{ title: '搜索' }} />
          <Tab.Screen name="Mine" component={MineScreen} options={{ title: '我的' }} />
        </Tab.Navigator>
    </View>
  );
}

const MINI_BAR_HIDDEN_ROUTES = new Set(['Settings', 'Player', 'ShareCard']);

function StackChrome({ children, state, closedTransition }) {
  const blurTargetRef = useRef(null);
  const routeName = state.routes[state.index]?.name || 'Tabs';
  const wantsMiniBar = !MINI_BAR_HIDDEN_ROUTES.has(routeName);
  const hiddenAtTransitionRef = useRef(null);
  const wantedLastRenderRef = useRef(true);
  const [miniBarReady, setMiniBarReady] = useState(wantsMiniBar);
  useEffect(() => {
    let revealFrame;
    let fallbackTimer;
    if (!wantsMiniBar) {
      // Capture only on entry. If iOS emits transitionEnd before publishing the
      // destination route, do not overwrite the completed counter while hidden.
      if (wantedLastRenderRef.current) hiddenAtTransitionRef.current = closedTransition;
      setMiniBarReady(false);
    } else if (hiddenAtTransitionRef.current === null) {
      setMiniBarReady(true);
    } else if (closedTransition !== hiddenAtTransitionRef.current) {
      // Reveal on the first frame after native-stack has actually finished. This
      // keeps the bar off the departing lyrics page without leaving a visible gap.
      revealFrame = requestAnimationFrame(() => {
        hiddenAtTransitionRef.current = null;
        setMiniBarReady(true);
      });
    } else {
      // Recover chrome if native-stack omits transitionEnd. Both platforms now
      // own media removal, so allow their native slide to finish first.
      fallbackTimer = setTimeout(() => {
        hiddenAtTransitionRef.current = null;
        setMiniBarReady(true);
      }, 380);
    }
    wantedLastRenderRef.current = wantsMiniBar;
    return () => {
      if (revealFrame != null) cancelAnimationFrame(revealFrame);
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
    };
  }, [closedTransition, wantsMiniBar]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // A lock-screen / Control Center pause can happen while a closing route
      // transition is suspended. Restore chrome as soon as the app is active.
      if (state === 'active' && wantsMiniBar) {
        hiddenAtTransitionRef.current = null;
        setMiniBarReady(true);
      }
    });
    return () => subscription.remove();
  }, [wantsMiniBar]);
  return (
    <View style={styles.app}>
      <OverlayProvider>
      <View style={styles.app}>
        <BlurTargetView ref={blurTargetRef} pointerEvents="none" style={StyleSheet.absoluteFill}>
          <AmbientBackground />
        </BlurTargetView>
        {children}
      </View>
      <MiniBar visible={miniBarReady}
        blurTarget={blurTargetRef} hasBottomTabs={routeName === 'Tabs'} />
      <AppUpdateNotice />
      <StartupGlow />
      </OverlayProvider>
    </View>
  );
}

export default function App() {
  const [closedTransition, setClosedTransition] = useState(0);
  useEffect(() => {
    let stop = AppState.currentState === 'background' ? () => {} : monitorEventLoop();
    const listener = AppState.addEventListener('change', state => {
      stop(); stop = state === 'active' ? monitorEventLoop() : () => {};
    });
    return () => { stop(); listener.remove(); };
  }, []);
  return (
    <GestureHandlerRootView style={styles.app}>
    <SafeAreaProvider>
      <PlayerProvider>
        <LyricsActivitySync />
        <CloudSyncProvider>
        <LanSyncProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <Stack.Navigator
            layout={(props) => <StackChrome {...props} closedTransition={closedTransition} />}
            screenLayout={screenLayout}
            screenListeners={{ transitionEnd: ({ data }) => {
              if (data?.closing) setClosedTransition((value) => value + 1);
            } }}
            screenOptions={{
              headerShown: false,
              ...pageScreenOptions,
            }}
          >
            <Stack.Screen name="Tabs" component={Tabs} options={{
              presentation: 'card', animation: 'none', contentStyle: { backgroundColor: colors.bg },
            }} />
            {/* 媒体页由原生导航处理升降转场，不拦截返回。 */}
            <Stack.Screen name="Player" component={PlayerScreen} options={mediaScreenOptions} />
            <Stack.Screen name="Up" component={UpScreen} />
            <Stack.Screen name="Video" component={VideoScreen} options={mediaScreenOptions} />
            <Stack.Screen name="Daily" component={DailyScreen} />
            <Stack.Screen name="Likes" component={LikesScreen} />
            <Stack.Screen name="MusicLibrary" component={MusicLibraryScreen} />
            <Stack.Screen name="History" component={HistoryScreen} />
            <Stack.Screen name="LocalPlaylist" component={LocalPlaylistScreen} />
            <Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="SearchInput" component={SearchScreen} options={{ animation: 'fade', animationDuration: 180 }} />
            <Stack.Screen name="ShareCard" component={ShareCardScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        </LanSyncProvider>
        </CloudSyncProvider>
      </PlayerProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  startup: { zIndex: 100, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  startupGlow: { position: 'absolute', width: 360, height: 360 },
  startupLogo: { width: 140, height: 140 },
  tabsWrap: { flex: 1, backgroundColor: 'transparent' },
  tabContent: { flex: 1 },
  tabBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    elevation: 10, zIndex: 10,
  },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { fontSize: 10, letterSpacing: 1 },
  tabLabelActive: { fontWeight: '600' },
});
