/* Biu Player RN · 入口：底部 tab（首页/电台/搜索/我的）+ 播放页 stack + 迷你播放条
 * 转场（native-stack 原生转场，全部跑原生驱动）：
 * - 普通页面：Android 保留完整路由至侧滑结束；iOS 使用原生侧滑
 * - 播放页 / 视频页（全屏媒体）：iOS = slide_from_bottom 底部升起 + 下滑手势关闭；
 *   Android = 透明原生路由 + Animated 升降，退出动画完成后再移除路由
 * - tab 切换：fade 轻淡 crossfade；tab 图标选中态轻微 scale 弹性
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { isRunningInExpoGo } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from './src/theme';
import { PlayerProvider } from './src/player/PlayerContext';
import { LanSyncProvider } from './src/store/LanSyncProvider';
import { CloudSyncProvider } from './src/store/CloudSyncProvider';
import { mediaScreenOptions } from './src/player/useMediaTransition';
import MiniBar from './src/components/MiniBar';
import { OverlayProvider } from './src/components/Overlay';
import PageTransition, { pageScreenOptions } from './src/components/PageTransition';
import { IconHome, IconRadio, IconSearch, IconUser } from './src/components/icons';
import HomeScreen from './src/screens/HomeScreen';
import DailyScreen from './src/screens/DailyScreen';
import RadioScreen from './src/screens/RadioScreen';
import SearchScreen from './src/screens/SearchScreen';
import MineScreen from './src/screens/MineScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import UpScreen from './src/screens/UpScreen';
import VideoScreen from './src/screens/VideoScreen';
import LikesScreen from './src/screens/LikesScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import LocalPlaylistScreen from './src/screens/LocalPlaylistScreen';
import PlaylistDetailScreen from './src/screens/PlaylistDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';

// 等启动遮罩完成布局且 Logo 加载后再交接，避免露出空白帧。
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
  Radio: IconRadio,
  Search: IconSearch,
  Mine: IconUser,
};
const TAB_LABELS = { Home: '首页', Radio: '电台', Search: '搜索', Mine: '我的' };

function StartupGlow() {
  const opacity = useRef(new Animated.Value(1)).current;
  const [laidOut, setLaidOut] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!laidOut || !imageReady) return;
    SplashScreen.hideAsync().catch(() => {});
    const animation = Animated.timing(opacity, {
      toValue: 0, delay: 450, duration: 650, useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished) setVisible(false); });
    return () => animation.stop();
  }, [laidOut, imageReady, opacity]);
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
        onLoadEnd={() => setImageReady(true)}
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

function TabBarBridge({ navigation, state, report }) {
  useEffect(() => {
    report(navigation, state.routes[state.index].name);
  }, [navigation, report, state]);
  return null;
}

function GlassTabBar({ active, blurTarget, navigate }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { height: 49 + insets.bottom, paddingBottom: insets.bottom }]}>
      <BlurView
        blurTarget={blurTarget}
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
      {Object.keys(TAB_ICONS).map((name) => {
        const focused = active === name;
        const color = focused ? colors.accent : colors.text3;
        return (
          <TouchableOpacity
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={TAB_LABELS[name]}
            accessibilityState={{ selected: focused }}
            activeOpacity={1}
            style={styles.tabButton}
            onPress={() => navigate(name)}
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
  const blurTargetRef = useRef(null);
  const tabNavigationRef = useRef(null);
  const lastHomePressRef = useRef(null);
  const [activeTab, setActiveTab] = useState('Home');
  const reportTab = useCallback((navigation, name) => {
    tabNavigationRef.current = navigation;
    setActiveTab(name);
  }, []);
  const navigateTab = useCallback((name) => {
    const navigation = tabNavigationRef.current;
    if (!navigation) return;
    const now = Date.now();
    const doublePress = name === 'Home' && lastHomePressRef.current !== null
      && now - lastHomePressRef.current <= 300;
    lastHomePressRef.current = name === 'Home' && !doublePress ? now : null;
    navigation.navigate(name);
    if (doublePress) {
      const home = navigation.getState().routes.find((route) => route.name === 'Home');
      if (home) navigation.emit({ type: 'homeDoublePress', target: home.key });
    }
  }, []);
  return (
    <View style={styles.tabsWrap}>
      <BlurTargetView ref={blurTargetRef} style={styles.tabContent}>
        <Tab.Navigator
          tabBar={(props) => <TabBarBridge {...props} report={reportTab} />}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: 'transparent' },
            animation: 'fade', // tab 切换轻淡 crossfade（bottom-tabs v7 原生转场）
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: '首页' }} />
          <Tab.Screen name="Radio" component={RadioScreen} options={{ title: '电台' }} />
          <Tab.Screen name="Search" component={SearchScreen} options={{ title: '搜索' }} />
          <Tab.Screen name="Mine" component={MineScreen} options={{ title: '我的' }} />
        </Tab.Navigator>
      </BlurTargetView>
      <MiniBar blurTarget={blurTargetRef} />
      <GlassTabBar
        active={activeTab}
        blurTarget={blurTargetRef}
        navigate={navigateTab}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PlayerProvider>
        <CloudSyncProvider>
        <LanSyncProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <View style={styles.app}>
            <OverlayProvider>
            <Stack.Navigator
              screenLayout={screenLayout}
              screenOptions={{
                headerShown: false,
                ...pageScreenOptions,
              }}
            >
              <Stack.Screen name="Tabs" component={Tabs} options={{
                presentation: 'card', animation: 'none', contentStyle: { backgroundColor: colors.bg },
              }} />
              {/* 媒体页共用升降转场，Android 在动画完成前保留路由。 */}
              <Stack.Screen
                name="Player"
                component={PlayerScreen}
                options={mediaScreenOptions}
              />
              <Stack.Screen name="Up" component={UpScreen} />
              <Stack.Screen
                name="Video"
                component={VideoScreen}
                options={mediaScreenOptions}
              />
              <Stack.Screen name="Daily" component={DailyScreen} />
              <Stack.Screen name="Likes" component={LikesScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
              <Stack.Screen name="LocalPlaylist" component={LocalPlaylistScreen} />
              <Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </Stack.Navigator>
            <StartupGlow />
            </OverlayProvider>
          </View>
        </NavigationContainer>
        </LanSyncProvider>
        </CloudSyncProvider>
      </PlayerProvider>
    </SafeAreaProvider>
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
    elevation: 10,
  },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { fontSize: 10, letterSpacing: 1 },
  tabLabelActive: { fontWeight: '600' },
});
