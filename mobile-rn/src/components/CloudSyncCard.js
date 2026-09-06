import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCloudSync } from '../store/CloudSyncProvider';
import { streamHeaders } from '../api/client';
import { colors } from '../theme';

function Preview({url}) {
  const [error,setError]=useState('');
  const player=useVideoPlayer(null,p=>{p.muted=true;p.audioMixingMode='mixWithOthers';p.showNowPlayingNotification=false;});
  useEffect(()=>{
    let active=true;
    const subscription=player.addListener('statusChange',({status,error})=>{
      if(active&&status==='error')setError(error?.message||'同步视频暂时无法播放');
    });
    (async()=>{
      try {
        await player.replaceAsync({uri:url,headers:streamHeaders()});
        if(active)player.play();
      } catch(e) {if(active)setError(e.message||'同步视频暂时无法播放');}
    })();
    // useVideoPlayer owns release. Late source loads must never play a released player.
    return()=>{active=false;subscription.remove();};
  },[player,url]);
  return error?<Text style={styles.desc}>{error}</Text>:<View style={styles.video}><VideoView player={player} style={StyleSheet.absoluteFill}
    surfaceType="textureView" keepScreenAwake={false} nativeControls allowsPictureInPicture={false} contentFit="contain" /></View>;
}

function PreviewControl({sync}) {
  const focused=useIsFocused();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const [expanded,setExpanded]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState('');
  const visible=expanded&&focused&&foreground;
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',state=>setForeground(state==='active'));
    return()=>subscription.remove();
  },[]);
  useEffect(()=>{if(!focused||!foreground)setExpanded(false);},[focused,foreground]);
  useEffect(()=>{
    setUrl('');setError('');
    if(!visible)return;
    let active=true;
    (async()=>{
      try {
        const next=sync.preview||await sync.loadPreview();
        if(active){setUrl(next||'');if(!next)setError('同步视频暂时不可用，请稍后重试');}
      } catch(e) {if(active)setError(e.message||'同步视频加载失败，请稍后重试');}
    })();
    return()=>{active=false;};
  },[visible,sync.preview,sync.loadPreview]);
  return <>
    <Action label={visible?'关闭视频预览':'查看同步视频'} onPress={()=>setExpanded(!visible)}/>
    {visible&&<View style={styles.previewRow}>{url?<Preview key={url} url={url}/>:<Text style={styles.desc}>{error||'正在加载同步视频…'}</Text>}</View>}
  </>;
}
function Action({label,onPress,disabled}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.button,disabled&&styles.disabled]}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
}
export default function CloudSyncCard() {
  const sync=useCloudSync(),[details,setDetails]=useState(false);
  const disabled=!sync.ready||sync.saving;
  const message=sync.error || (!sync.signedIn?'登录 B 站后可开启':sync.busy?'正在同步…':sync.pending?'等待云端转码与审核':sync.enabled?'自动同步已开启':'视频云同步已关闭');
  const date=t=>new Date(t).toLocaleString('zh-CN');
  return <View style={styles.card}>
    <View style={styles.row}><Text style={styles.title}>视频云同步</Text>
      <Switch accessibilityLabel="视频云同步" value={!!sync.enabled} disabled={disabled||!sync.signedIn} onValueChange={enabled=>sync.configure({enabled})}
        thumbColor={sync.enabled?colors.accent:colors.text2} trackColor={{false:colors.cardBorder,true:colors.accentSoft}} ios_backgroundColor={colors.bgSoft} />
    </View>
    <Text style={styles.desc}>把喜欢、音乐库、歌单和推荐画像加密保存到 B 站，与桌面端共享同一份云端数据。</Text>
    <Text accessibilityLiveRegion="polite" style={[styles.desc,sync.error&&styles.error]}>{message}</Text>
    <View style={styles.divider}/>
    <Text style={styles.label}>同步间隔</Text>
    <View style={styles.segment}>{[3,6,12,24].map(hours=><TouchableOpacity key={hours} accessibilityRole="radio" accessibilityState={{checked:sync.intervalHours===hours,disabled:disabled||!sync.signedIn}}
      disabled={disabled||!sync.signedIn} onPress={()=>sync.configure({intervalHours:hours})} style={[styles.option,sync.intervalHours===hours&&styles.selected]}>
      <Text style={[styles.optionText,sync.intervalHours===hours&&styles.selectedText]}>{hours===24?'每天':`${hours} 小时`}</Text>
    </TouchableOpacity>)}</View>
    <View style={styles.actions}><Action label="立即同步" onPress={()=>sync.run(false)} disabled={disabled||!sync.enabled||sync.busy}/><Action label="读取云端" onPress={()=>sync.run(true)} disabled={disabled||!sync.hasKey||sync.busy}/>{!!sync.bvid&&<PreviewControl key={`${sync.scope}:${sync.bvid}`} sync={sync}/>}</View>
    {!!sync.lastSync&&<Text style={styles.desc}>最近成功 · {date(sync.lastSync)}</Text>}
    {!!sync.enabled&&!!sync.nextRun&&<Text style={styles.desc}>下次检查 · {date(sync.nextRun)}</Text>}
    <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:details}} onPress={()=>setDetails(!details)} style={styles.detailsButton}><Text style={styles.desc}>{details?'收起同步详情':'查看同步详情'}</Text></TouchableOpacity>
    {details&&<View style={styles.log}>
      {!!sync.bvid&&<Text selectable style={styles.logText}>{sync.bvid}</Text>}
      {(sync.logs || []).slice(-12).map((entry,index)=><Text key={index} selectable style={styles.logText}>{new Date(entry.at).toLocaleTimeString('zh-CN')} {entry.message}</Text>)}
      {!sync.logs?.length&&<Text style={styles.logText}>尚未开始同步</Text>}
    </View>}
    <View style={styles.divider}/>
    <Text style={styles.label}>恢复密钥</Text><Text style={styles.desc}>同账号设备都开启局域网同步后，会自动同步已有密钥；无法连接时也可手动导入。</Text>
    <View style={styles.actions}><Action label="导入恢复密钥" onPress={sync.importKey} disabled={disabled||!sync.signedIn||sync.busy}/><Action label="导出恢复密钥" onPress={sync.exportKey} disabled={disabled||!sync.hasKey}/></View>
    <Text style={styles.note}>离开设置页后继续同步；应用进入后台时暂停，回到前台自动继续。视频需等待 B 站转码与审核。</Text>
  </View>;
}
const styles=StyleSheet.create({
  card:{marginHorizontal:14,marginTop:10,padding:16,backgroundColor:colors.card,borderWidth:1,borderColor:colors.cardBorder,borderRadius:16},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  title:{flex:1,color:colors.text,fontSize:14,fontWeight:'600'},label:{color:colors.text,fontSize:13,fontWeight:'500'},
  desc:{color:colors.text3,fontSize:12,lineHeight:19,marginTop:8},error:{color:colors.accent},
  divider:{height:1,backgroundColor:colors.cardBorder,marginVertical:14},
  segment:{flexDirection:'row',gap:4,padding:4,borderRadius:12,backgroundColor:'rgba(255,255,255,.05)',marginTop:10},
  option:{flex:1,alignItems:'center',justifyContent:'center',height:48,borderRadius:9},selected:{backgroundColor:colors.accentSoft},
  optionText:{color:colors.text2,fontSize:12},selectedText:{color:colors.accent,fontWeight:'600'},
  actions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:12},button:{minHeight:48,paddingHorizontal:14,alignItems:'center',justifyContent:'center',borderRadius:24,borderWidth:1,borderColor:colors.cardBorder},
  previewRow:{width:'100%'},
  buttonText:{color:colors.text2,fontSize:12},disabled:{opacity:.4},
  video:{aspectRatio:16/9,borderRadius:14,overflow:'hidden',marginTop:14,backgroundColor:colors.bgSoft},
  detailsButton:{alignSelf:'flex-start',minHeight:48,justifyContent:'center'},log:{padding:12,borderRadius:12,backgroundColor:colors.bgSoft,marginTop:8},logText:{fontSize:11,lineHeight:18,color:colors.text3},
  note:{fontSize:11,lineHeight:18,color:colors.text3,marginTop:14},
});
