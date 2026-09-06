import React from 'react';
import { Share, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { IconBack } from '../components/icons';
import ShareCard from '../components/ShareCard';

export default function ShareCardScreen({ navigation, route }) {
  const track = route.params?.track;
  const link = track?.bvid ? `https://www.bilibili.com/video/${track.bvid}` : '';
  const shareLink = () => {
    if (!link) return;
    Share.share({ title: track?.title || 'Biu Player', message: `${track?.title || 'Biu Player'}\n${link}`, url: link });
  };
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
          <IconBack size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>分享音乐卡片</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ShareCard track={track} />
        <TouchableOpacity style={styles.linkButton} onPress={shareLink} disabled={!link} accessibilityRole="button">
          <Text style={styles.linkButtonText}>分享链接</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  content: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 120 },
  linkButton: { alignSelf: 'center', minWidth: 150, height: 44, paddingHorizontal: 24,
    borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(251,114,153,.13)', borderWidth: 1, borderColor: 'rgba(251,114,153,.55)' },
  linkButtonText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
