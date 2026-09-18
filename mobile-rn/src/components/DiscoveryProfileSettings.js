import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { activeProfile, parseTagsText, tagsText } from '../../../renderer/recommendation-profile';
import { interests, visualSamples } from '../../../renderer/profile-interest';
import { qualified } from '../../../renderer/daily-recommendation';
import { colors } from '../theme';
import { IconChevronDown, IconChevronRight, IconPlus } from './icons';
import LocalAISettings from './LocalAISettings';
import ProfilePortrait from './ProfilePortrait';

const timeLabel = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未更新';
const draftFor = profile => ({ id: profile.id, name: profile.name, description: profile.interests?.description || '',
  avoid: (profile.interests?.avoid || []).join('、'), tags: tagsText(profile.tags) });

function Action({ label, onPress, disabled, primary, danger }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} style={[s.action, primary && s.primary, disabled && s.disabled]}>
    <Text style={[s.actionText, primary && s.primaryText, danger && { color: colors.danger }]}>{label}</Text>
  </TouchableOpacity>;
}
function Group({ title, detail, children }) {
  return <View style={s.group}><Text style={s.groupTitle}>{title}</Text>{detail ? <Text style={s.hint}>{detail}</Text> : null}{children}</View>;
}
function Fold({ title, children }) {
  const [open, setOpen] = useState(false);
  return <View style={s.fold}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.foldHeader}>
      <Text style={s.label}>{title}</Text>{open ? <IconChevronDown size={16} color={colors.text3} /> : <IconChevronRight size={16} color={colors.text3} />}
    </TouchableOpacity>{open ? <View style={s.gap}>{children}</View> : null}
  </View>;
}
function Chips({ values, empty }) {
  return values.length ? <View style={s.wrap}>{values.map((value, index) => <View key={`${value}:${index}`} style={s.chip}><Text style={s.chipText}>{value}</Text></View>)}</View> : <Text style={s.hint}>{empty}</Text>;
}

export default function DiscoveryProfileSettings({ manager, state, ready }) {
  const profile = activeProfile(state);
  const portraitProfile = useMemo(() => ({ ...profile, tags: interests(profile) }), [profile]);
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState('interests');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState('');
  const lock = useRef(false);
  useEffect(() => { setDraft(null); setConfirm(''); setError(''); setNotice(''); }, [profile.id]);
  const disabled = !ready || !state.ready || saving;
  const run = async (action, message = '') => {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError(''); setNotice('');
    try { await action(); if (!manager.getSnapshot().error) setNotice(message); setConfirm(''); }
    catch (reason) { setError(reason.message || '操作失败，请重试'); }
    finally { lock.current = false; setSaving(false); }
  };
  const patch = value => manager.edit({ type: 'interests', id: profile.id, patch: value });
  const learning = useMemo(() => {
    const events = (state.daily?.events || []).filter(e => (e.profileId || 'auto') === profile.id);
    const valid = events.filter(qualified);
    const samples = [...new Map(visualSamples(profile).map(v => [v.pic, v])).values()];
    return { events: events.length, qualified: valid.length, pending: valid.filter(e => e.at > (state.auto.updatedAt || 0)).length,
      samples, authors: new Set(samples.map(v => v.owner)).size };
  }, [state.daily?.events, state.auto.updatedAt, profile]);
  const setAuthor = (author, mode) => run(() => patch({ authors: [...(profile.interests?.authors || []).filter(a => a.mid !== author.mid),
    { mid: author.mid, name: author.name, mode, at: Date.now() }] }));
  const save = () => run(async () => {
    const value = { description: draft.description.trim(), avoid: draft.avoid.split(/[、,，\n]/).map(v => v.trim()).filter(Boolean) };
    if (draft.id === 'auto') await patch(value);
    else await manager.edit({ type: 'save', id: draft.id, name: draft.name, tags: parseTagsText(draft.tags), interests: value });
    setDraft(null);
  }, '偏好已保存');

  return <View style={s.content}>
    <ProfilePortrait profile={portraitProfile} ready={ready && state.ready} flipped={flipped} onFlip={() => setFlipped(v => !v)} />
    {flipped && <>
    <View style={s.hero}>
      <View style={s.row}><View style={s.flex}><Text style={s.title}>发现页画像</Text><Text style={s.hint}>只用于卡片发现，与首页画像独立</Text></View>
        <Switch accessibilityLabel="发现页画像推荐" value={state.enabled} disabled={disabled}
          onValueChange={enabled => run(() => manager.edit({ type: 'enable', enabled }))}
          trackColor={{ false: '#363832', true: colors.accentSoft }} thumbColor={state.enabled ? colors.accent : '#a4a69f'} />
      </View>
      {!state.enabled ? <Text style={s.hint}>当前使用 B 站原生推荐。你仍可在这里编辑和保存画像。</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.profiles}>
        {[state.auto, ...state.profiles].map(p => <TouchableOpacity key={p.id} accessibilityRole="radio" accessibilityLabel={`选择发现画像：${p.name}`}
          accessibilityState={{ checked: p.id === profile.id, disabled }} disabled={disabled}
          onPress={() => run(() => manager.edit({ type: 'select', id: p.id }))} style={[s.profilePill, p.id === profile.id && s.selected]}>
          <Text style={[s.label, p.id === profile.id && { color: colors.accent }]}>{p.name}</Text>
        </TouchableOpacity>)}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="新建发现画像" disabled={disabled} style={s.profilePill}
          onPress={() => { setTab('interests'); setDraft({ name: '', description: '', avoid: '', tags: '' }); setConfirm(''); }}>
          <IconPlus size={16} color={colors.accent} /><Text style={s.actionText}>新建</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
    <View style={s.tabs}>{[['interests', '兴趣设置'], ['learning', '学习记录'], ['models', '本地 AI']].map(([id, title]) =>
      <TouchableOpacity key={id} accessibilityRole="tab" accessibilityLabel={title} accessibilityState={{ selected: tab === id }}
        onPress={() => setTab(id)} style={[s.tab, tab === id && s.selected]}><Text style={[s.label, tab === id && { color: colors.accent }]}>{title}</Text></TouchableOpacity>)}</View>
    {!!(error || state.error) && <Text accessibilityLiveRegion="polite" style={s.error}>{error || state.error}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={s.success}>{notice}</Text>}
    {!state.ready ? <Action label="重新读取发现画像" onPress={() => run(() => manager.ready())} disabled={saving} /> : null}

    {tab === 'interests' && <>
      <Group title={draft ? (draft.id ? '编辑偏好' : '新建画像') : `${profile.name} · 推荐偏好`} detail="描述想看的内容，填写不想看的主题。兴趣可以不限于音乐。">
        {draft ? <>
          {draft.id !== 'auto' && <><Text style={s.label}>画像名称</Text><TextInput accessibilityLabel="发现画像名称" maxLength={40}
            value={draft.name} onChangeText={name => setDraft(v => ({ ...v, name }))} placeholder="给这份兴趣起个名字" placeholderTextColor={colors.text3} style={s.input} /></>}
          <Text style={s.label}>想看什么</Text><TextInput accessibilityLabel="发现兴趣描述" multiline maxLength={500} textAlignVertical="top"
            value={draft.description} onChangeText={description => setDraft(v => ({ ...v, description }))}
            placeholder="例如：摄影、旅行记录、城市夜景" placeholderTextColor={colors.text3} style={[s.input, s.multiline]} />
          <Text style={s.label}>不想看什么</Text><TextInput accessibilityLabel="发现排除主题" multiline maxLength={1200}
            value={draft.avoid} onChangeText={avoid => setDraft(v => ({ ...v, avoid }))} placeholder="例如：广告、影视剪辑；用逗号或换行分隔"
            placeholderTextColor={colors.text3} style={s.input} />
          {draft.id !== 'auto' && <Fold title="高级：主题权重"><Text style={s.hint}>已有主题会保留。每行一个，可写“摄影:80”；无需填写也能使用兴趣描述。</Text>
            <TextInput accessibilityLabel="发现主题权重" multiline textAlignVertical="top" value={draft.tags}
              onChangeText={tags => setDraft(v => ({ ...v, tags }))} style={[s.input, s.multiline]} />
          </Fold>}
          <View style={s.wrap}><Action label="保存偏好" primary disabled={disabled} onPress={save} /><Action label="取消编辑" disabled={saving} onPress={() => setDraft(null)} /></View>
        </> : <>
          <Chips values={interests(profile).map(t => t.name)} empty="还没有兴趣，添加描述或观看喜欢的视频后更新画像。" />
          {!!profile.interests?.avoid?.length && <><Text style={s.label}>已排除</Text><Chips values={profile.interests.avoid} /></>}
          <Action label="编辑兴趣" primary disabled={disabled} onPress={() => setDraft(draftFor(profile))} />
        </>}
      </Group>
      <Group title="封面辅助推荐" detail="通过这份画像下喜欢或收藏的视频封面，学习视觉偏好。普通观看不会自动成为封面样本。">
        <View style={s.row}><View style={s.flex}><Text style={s.label}>使用封面偏好</Text><Text style={s.hint}>{learning.samples.length} 个可用样本 · {learning.authors} 位 UP 主</Text></View>
          <Switch accessibilityLabel="使用发现封面偏好" value={profile.interests?.visualEnabled !== false} disabled={disabled}
            onValueChange={visualEnabled => run(() => patch({ visualEnabled }))} trackColor={{ false: '#363832', true: colors.accentSoft }} thumbColor={colors.accent} />
        </View>
        <Text style={s.hint}>还需在“本地 AI”中开启封面模型。当前仅辅助排序，不会只凭封面放行视频。</Text>
      </Group>
      {profile.id !== 'auto' && <Fold title="管理这份画像"><View style={s.wrap}>
        <Action label="复制为新画像" disabled={disabled} onPress={() => { setDraft({ ...draftFor(profile), id: undefined, name: profile.name + ' 副本' }); setConfirm(''); }} />
        <Action label="删除这份画像" danger disabled={disabled} onPress={() => setConfirm('delete')} />
      </View>{confirm === 'delete' && <><Text style={s.hint}>确认删除“{profile.name}”？其他画像会保留。</Text><View style={s.wrap}>
        <Action label="确认删除画像" danger disabled={disabled} onPress={() => run(() => manager.edit({ type: 'delete', id: profile.id }))} />
        <Action label="保留画像" onPress={() => setConfirm('')} />
      </View></>}</Fold>}
    </>}

    {tab === 'learning' && <>
      <Group title="学习进度" detail="观看会先记录，每 15 分钟批量学习；快速划过不会作为强偏好。">
        <View style={s.metrics}>{[[learning.events, '观看片段'], [learning.qualified, '达到门槛'], [learning.pending, '待批量更新']].map(([n, label]) =>
          <View key={label} style={s.metric}><Text style={s.number}>{n}</Text><Text style={s.hint}>{label}</Text></View>)}</View>
        <Text style={s.hint}>最近批量更新：{timeLabel(state.auto.updatedAt)}</Text>
        <View style={s.row}><Action label={state.busy ? '正在更新画像' : '现在更新画像'} disabled={disabled || state.busy} onPress={() => run(() => manager.refresh(true), '已完成本轮更新')} />
          {state.busy ? <ActivityIndicator color={colors.accent} /> : null}</View>
        {!!state.auto.pending && <Text style={s.hint}>整套发现画像还有 {state.auto.pending} 个视频等待补充标签；标题和已完成的结果仍可使用。</Text>}
      </Group>
      <Group title="UP 主偏好" detail="UP 主只影响符合兴趣的视频排序。“忽略偏好”取消加分，“不再推荐”屏蔽该 UP 主。">
        {!(profile.learned?.authors || []).length && <Text style={s.hint}>还没有学到 UP 主偏好，下一次批量更新后会出现在这里。</Text>}
        {(profile.learned?.authors || []).slice(0,8).map(author => {
          const rule = profile.interests?.authors?.find(a => a.mid === author.mid);
          return <View key={author.mid} style={s.author}><Text numberOfLines={1} style={s.label}>{author.name}</Text>
            <View style={s.wrap}>{['ignore','block'].includes(rule?.mode) ? <Action label={`恢复 ${author.name}`} disabled={disabled} onPress={() => setAuthor(author,'normal')} /> : <>
              <Action label={`忽略偏好：${author.name}`} disabled={disabled} onPress={() => setAuthor(author,'ignore')} />
              <Action label={`不再推荐：${author.name}`} disabled={disabled} onPress={() => setAuthor(author,'block')} />
            </>}</View></View>;
        })}
        {(profile.interests?.authors || []).filter(a => a.mode !== 'normal' && !profile.learned?.authors?.slice(0,8).some(v => v.mid === a.mid)).map(a =>
          <Action key={a.mid} label={`恢复 ${a.name || a.mid}`} disabled={disabled} onPress={() => setAuthor(a,'normal')} />)}
      </Group>
      <Fold title={`封面学习样本 · ${learning.samples.length}`}>
        {!learning.samples.length && <Text style={s.hint}>在发现页喜欢或收藏视频，再更新画像后，符合当前兴趣的封面会显示在这里。</Text>}
        {learning.samples.slice(0,12).map(sample => <View key={sample.bvid} style={s.row}>
          <Image source={{ uri: sample.pic }} style={s.cover} contentFit="cover" cachePolicy="memory-disk" />
          <Text numberOfLines={2} style={[s.label,s.flex]}>{sample.title || sample.bvid}</Text>
          <Action label="移除" disabled={disabled} onPress={() => run(() => patch({ removedSamples: [...(profile.interests?.removedSamples || []), { bvid: sample.bvid, at: Date.now() }] }))} />
        </View>)}
        <Action label="重置封面学习" danger disabled={disabled} onPress={() => setConfirm('visual')} />
        {confirm === 'visual' && <><Text style={s.hint}>重置后，仅使用此后新增的喜欢与收藏样本。</Text><View style={s.wrap}>
          <Action label="确认重置封面学习" danger disabled={disabled} onPress={() => run(() => patch({ visualResetAt: Date.now() }))} />
          <Action label="取消重置" onPress={() => setConfirm('')} />
        </View></>}
      </Fold>
    </>}
    {tab === 'models' && <LocalAISettings />}
    </>}
  </View>;
}

const s = StyleSheet.create({
  content:{paddingHorizontal:14,paddingTop:8,gap:12},hero:{gap:14,padding:18,borderRadius:22,backgroundColor:colors.card,borderWidth:1,borderColor:colors.cardBorder},
  title:{color:colors.text,fontSize:21,fontWeight:'700',marginBottom:6},row:{flexDirection:'row',alignItems:'center',gap:12},flex:{flex:1},gap:{gap:12},
  hint:{color:colors.text2,fontSize:12,lineHeight:19},label:{color:colors.text,fontSize:13,fontWeight:'500'},profiles:{gap:8},
  profilePill:{minHeight:44,paddingHorizontal:14,borderRadius:22,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:colors.card},
  selected:{backgroundColor:colors.accentSoft},tabs:{flexDirection:'row',padding:4,borderRadius:16,backgroundColor:colors.card,gap:4},
  tab:{flex:1,minHeight:44,borderRadius:12,alignItems:'center',justifyContent:'center'},group:{padding:16,gap:12,borderRadius:18,backgroundColor:colors.card,borderWidth:1,borderColor:colors.cardBorder},
  groupTitle:{color:colors.text,fontSize:15,fontWeight:'600'},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'},
  chip:{backgroundColor:colors.accentSoft,paddingVertical:7,paddingHorizontal:12,borderRadius:12},chipText:{color:colors.accent,fontSize:12},
  action:{minHeight:44,paddingHorizontal:14,paddingVertical:10,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(255,255,255,0.05)'},
  actionText:{color:colors.accent,fontSize:12,fontWeight:'500'},primary:{backgroundColor:colors.accent},primaryText:{color:colors.bg,fontWeight:'600'},disabled:{opacity:.45},
  input:{backgroundColor:colors.bgSoft,borderColor:colors.cardBorder,borderWidth:1,borderRadius:12,padding:12,minHeight:46,color:colors.text,fontSize:14},multiline:{minHeight:92},
  fold:{backgroundColor:colors.card,paddingHorizontal:16,paddingBottom:12,borderRadius:16},foldHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:48},
  metrics:{flexDirection:'row',gap:8},metric:{flex:1,paddingVertical:12,alignItems:'center',borderRadius:12,backgroundColor:colors.bgSoft},number:{color:colors.text,fontSize:23,fontWeight:'600',marginBottom:4},
  author:{gap:8,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.cardBorder},cover:{width:60,height:44,borderRadius:8},error:{color:colors.danger,fontSize:12},success:{color:colors.accent,fontSize:12},
});
