/* Biu Player RN · 入口：底部 tab（首页/电台/搜索/我的）+ 播放页 stack + 迷你播放条
 * 转场（native-stack 原生转场，全部跑原生驱动）：
 * - 普通页面：ios_from_right（iOS 风格右滑推入，Android 上也是右推）+ 全宽手势返回
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
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from './src/theme';
import { PlayerProvider } from './src/player/PlayerContext';
import { mediaScreenOptions } from './src/player/useMediaTransition';
import MiniBar from './src/components/MiniBar';
import { IconHome, IconRadio, IconSearch, IconUser } from './src/components/icons';
import HomeScreen from './src/screens/HomeScreen';
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
  const [activeTab, setActiveTab] = useState('Home');
  const reportTab = useCallback((navigation, name) => {
    tabNavigationRef.current = navigation;
    setActiveTab(name);
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
        navigate={(name) => tabNavigationRef.current?.navigate(name)}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PlayerProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <View style={styles.app}>
            <AmbientBackground />
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
                // 普通页面：iOS 风格右滑推入 + 全宽手势返回（iOS 上即默认交互手势转场）
                animation: 'ios_from_right',
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
              }}
            >
              <Stack.Screen name="Tabs" component={Tabs} />
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
              <Stack.Screen name="Likes" component={LikesScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
              <Stack.Screen name="LocalPlaylist" component={LocalPlaylistScreen} />
              <Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </Stack.Navigator>
          </View>
        </NavigationContainer>
      </PlayerProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
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
