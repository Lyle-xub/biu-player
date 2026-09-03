/* Biu Player RN · 入口：底部 tab（首页/电台/搜索/我的）+ 播放页 stack + 迷你播放条 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from './src/theme';
import { PlayerProvider } from './src/player/PlayerContext';
import MiniBar from './src/components/MiniBar';
import { IconHome, IconRadio, IconSearch, IconUser } from './src/components/icons';
import HomeScreen from './src/screens/HomeScreen';
import RadioScreen from './src/screens/RadioScreen';
import SearchScreen from './src/screens/SearchScreen';
import MineScreen from './src/screens/MineScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import UpScreen from './src/screens/UpScreen';
import VideoScreen from './src/screens/VideoScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
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

function Tabs() {
  return (
    <View style={styles.tabsWrap}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.text3,
          tabBarStyle: {
            backgroundColor: 'rgba(9,11,7,0.94)',
            borderTopColor: 'rgba(255,255,255,0.09)',
          },
          tabBarLabelStyle: { fontSize: 10, letterSpacing: 1 },
          tabBarIcon: ({ color }) => {
            const Icon = TAB_ICONS[route.name];
            return <Icon size={21} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: '首页' }} />
        <Tab.Screen name="Radio" component={RadioScreen} options={{ title: '电台' }} />
        <Tab.Screen name="Search" component={SearchScreen} options={{ title: '搜索' }} />
        <Tab.Screen name="Mine" component={MineScreen} options={{ title: '我的' }} />
      </Tab.Navigator>
      <MiniBar />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PlayerProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="Player" component={PlayerScreen} />
            <Stack.Screen name="Up" component={UpScreen} />
            <Stack.Screen name="Video" component={VideoScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </PlayerProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabsWrap: { flex: 1, backgroundColor: colors.bg },
});
