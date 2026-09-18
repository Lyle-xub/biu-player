import React, { useState, useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { modelManager } from '../recommendation/localAnalysis';
import { colors } from '../theme';
export default function LocalAISettings(){
 const state=useSyncExternalStore(modelManager.subscribe,modelManager.getSnapshot);
 const [error,setError]=useState('');
 const run=async job=>{setError('');try{await job();}catch(e){setError(e.message);}};
 return <View style={styles.card}>
  <Text style={styles.title}>本地 AI</Text>
  <Text style={styles.hint}>按需下载，标题和封面在设备内分析。播放及操作优先，设备繁忙时自动暂停。</Text>
  {['text','image'].map(kind=>{const m=state[kind];if(!m)return null;return <View key={kind} style={styles.row}>
   <Text style={styles.title}>{m.label} · {(m.files.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(1)} MB</Text>
   <Text style={styles.hint}>{m.progress!=null?`下载中 ${Math.round(m.progress*100)}%`:m.enabled?'已开启 · 辅助排序':m.installed?'已暂停':'尚未下载'}</Text>
   <View style={styles.buttons}>
    {m.progress!=null&&<TouchableOpacity style={styles.button} onPress={()=>run(()=>modelManager.cancel(kind))}><Text style={styles.label}>取消下载</Text></TouchableOpacity>}
    {m.progress==null && <TouchableOpacity style={styles.button} onPress={()=>run(()=>m.installed?modelManager.configure({kind,enabled:!m.enabled}):modelManager.download(kind))}><Text style={styles.label}>{m.installed?(m.enabled?'暂停':'开启'):'下载并开启'}</Text></TouchableOpacity>}
    {m.installed&&m.progress==null&&<TouchableOpacity style={styles.button} onPress={()=>run(()=>modelManager.configure({kind,remove:true}))}><Text style={styles.label}>删除模型</Text></TouchableOpacity>}
   </View>
  </View>})}
  <Text style={styles.hint}>实验功能：模型独立放行需通过推荐质量验证，当前仅辅助已有主题匹配的排序。</Text>
  <TouchableOpacity style={styles.button} onPress={()=>run(()=>modelManager.clear())}><Text style={styles.label}>清除分析缓存</Text></TouchableOpacity>
  {!!error&&<Text style={styles.error}>{error}</Text>}
 </View>;
}
const styles=StyleSheet.create({card:{gap:10,paddingVertical:12},row:{gap:6,padding:12,borderRadius:12,backgroundColor:colors.accentSoft},buttons:{flexDirection:'row',gap:8},button:{padding:12,borderRadius:12,backgroundColor:'rgba(255,255,255,0.05)'},title:{color:colors.text,fontSize:14,fontWeight:'600'},hint:{color:colors.text3,fontSize:12,lineHeight:18},label:{color:colors.accent,fontSize:12},error:{color:colors.danger,fontSize:12}});
