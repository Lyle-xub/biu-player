import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconBack } from '../components/icons';
import RecommendationProfileCard from '../components/RecommendationProfileCard';
import { colors } from '../theme';

export default function DiscoveryProfileScreen({ navigation }) {
  return <SafeAreaView style={styles.page} edges={['top']}>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.back}>
      <IconBack size={22} color={colors.text} /></TouchableOpacity><Text style={styles.title}>发现页画像</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><RecommendationProfileCard source="discovery" /></ScrollView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:colors.bg},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:10,paddingVertical:8,gap:10},
  back:{width:48,height:48,alignItems:'center',justifyContent:'center'},title:{color:colors.text,fontSize:16,fontWeight:'600'},content:{paddingBottom:130}});
