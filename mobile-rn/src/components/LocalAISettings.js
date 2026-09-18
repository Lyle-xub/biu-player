import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { modelManager } from '../recommendation/localAnalysis';
import { colors } from '../theme';

const descriptions = { text: '理解视频标题与兴趣描述的接近程度', image: '比较候选封面与你喜欢、收藏的封面' };
export default function LocalAISettings() {
  const state = useSyncExternalStore(modelManager.subscribe, modelManager.getSnapshot);
  const [error, setError] = useState('');
  const [pending, setPending] = useState({});
  const [manage, setManage] = useState(false);
  const [confirm, setConfirm] = useState('');
  const locks = useRef(new Set());
  useEffect(() => { modelManager.ready().catch(e => setError(e.message)); }, []);
  const run = async (id, action) => {
    if (locks.current.has(id)) return;
    locks.current.add(id); setPending(v => ({ ...v, [id]: true })); setError('');
    try { await action(); setConfirm(''); } catch (e) { setError(e.message); }
    finally { locks.current.delete(id); setPending(v => ({ ...v, [id]: false })); }
  };
  const button = (label, onPress, disabled = false) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: .45 }]}><Text style={s.label}>{label}</Text></TouchableOpacity>;
  return <View style={s.card}>
    <Text style={s.title}>仅用于发现页</Text>
    <Text style={s.hint}>标题与封面在手机内分析，不上传图片。模型只下载一次，播放和操作优先。</Text>
    {['text','image'].map(kind => {
      const model = state[kind];
      if (!model) return null;
      const downloading = model.progress != null;
      const progress = Math.min(1, Math.max(0, model.progress || 0));
      return <View key={kind} style={s.model}>
        <View style={s.row}><View style={s.flex}><Text style={s.title}>{model.label}</Text><Text style={s.hint}>{descriptions[kind]}</Text></View>
          {model.installed && !downloading ? <Switch accessibilityLabel={`启用${model.label}`} value={!!model.enabled} disabled={!!pending[kind]}
            onValueChange={enabled => run(kind, () => modelManager.configure({ kind, enabled }))}
            trackColor={{ false: '#363832', true: colors.accentSoft }} thumbColor={model.enabled ? colors.accent : '#a4a69f'} /> : null}
        </View>
        <Text style={s.status}>{downloading ? `下载中 ${Math.round(progress * 100)}%` : model.enabled ? '已开启 · 辅助排序' : model.installed ? '已暂停' : `尚未下载 · ${(model.files.reduce((n,f) => n + f.bytes,0)/1048576).toFixed(1)} MB`}</Text>
        {downloading ? <><View style={s.progress}><View style={[s.progressValue,{width:`${progress * 100}%`}]} /></View>
          {button(`取消${model.label}下载`, () => run('cancel-'+kind, () => modelManager.cancel(kind)), !!pending['cancel-'+kind])}</>
          : !model.installed ? button(`下载并开启${model.label}`, () => run(kind, () => modelManager.download(kind)), !!pending[kind]) : null}
      </View>;
    })}
    <Text style={s.hint}>当前 AI 只辅助已有主题匹配的排序。封面模型开启后，还需要这份画像的喜欢或收藏样本。</Text>
    {button(manage ? '收起存储管理' : '管理模型与缓存', () => setManage(v => !v))}
    {manage && <View style={s.model}>
      <Text style={s.hint}>清理缓存后会重新分析，不会删除画像或收藏；删除模型后可重新下载。</Text>
      {button('清除分析缓存', () => setConfirm('cache'), !!pending.cache)}
      {['text','image'].filter(kind => state[kind]?.installed && state[kind].progress == null).map(kind =>
        <React.Fragment key={kind}>{button(`删除${state[kind].label}模型`, () => setConfirm(kind), !!pending[kind])}</React.Fragment>)}
      {!!confirm && <><Text style={s.hint}>{confirm === 'cache' ? '确认清除本机分析缓存？' : `确认删除${state[confirm]?.label}模型？`}</Text>
        <View style={s.row}>{button('确认清理', () => run(confirm, () => confirm === 'cache' ? modelManager.clear() : modelManager.configure({ kind: confirm, remove: true })), !!pending[confirm])}
          {button('取消清理', () => setConfirm(''))}</View></>}
    </View>}
    {!!error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
  </View>;
}
const s=StyleSheet.create({card:{gap:12,padding:16,borderRadius:18,backgroundColor:colors.card,borderWidth:1,borderColor:colors.cardBorder},
  model:{gap:10,paddingVertical:14,borderTopWidth:1,borderTopColor:colors.cardBorder},row:{flexDirection:'row',alignItems:'center',gap:10},flex:{flex:1},
  button:{minHeight:44,justifyContent:'center',alignItems:'center',padding:12,borderRadius:12,backgroundColor:colors.accentSoft},
  title:{color:colors.text,fontSize:14,fontWeight:'600'},hint:{color:colors.text2,fontSize:12,lineHeight:19},label:{color:colors.accent,fontSize:12},status:{color:colors.accent,fontSize:12},
  error:{color:colors.danger,fontSize:12},progress:{height:4,borderRadius:2,overflow:'hidden',backgroundColor:colors.cardBorder},progressValue:{height:4,backgroundColor:colors.accent}});
