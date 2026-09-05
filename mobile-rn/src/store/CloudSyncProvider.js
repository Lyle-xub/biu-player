import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { usePlayer } from '../player/PlayerContext';
import { authStatus, biliFetch, cloudCsrf, streamHeaders } from '../api/client';
import createProtocol from '../../../renderer/video-cloud-sync-core';
import createApi from '../../../renderer/cloud-video-bili-core';
import * as platform from '../cloud/platform';
import { createMobileVideoRuntime } from '../cloud/runtime';
import { syncLanCloudKey } from '../cloud/lanKeyExchange';
const Context=createContext(null);
export const useCloudSync=()=>useContext(Context);

export function CloudSyncProvider({children}) {
  const player=usePlayer(),latest=useRef(player);latest.current=player;
  const runner=useRef(null),accountUpdates=useRef(Promise.resolve());
  const [ready,setReady]=useState(false),[saving,setSaving]=useState(false),[status,setStatus]=useState({});
  const mounted=useRef(true);
  const scope=player.account?.isLogin?String(player.account.mid || ''):'';
  const syncLanKey=useCallback(async(peer,expected,remote,clientId,signal,request)=>{
    const service=runner.current;
    const active=()=>mounted.current && !signal.aborted && latest.current.libraryReady
      && latest.current.account?.isLogin && String(latest.current.account.mid)===expected;
    if(!service || !active())return null;
    return syncLanCloudKey({peer,scope:expected,clientId,remote,local:service.lanKeyStatus(expected),signal,request,
      randomBytes:platform.crypto.randomBytes,
      exchange:(value,account)=>service.exchangeLanRecovery(value,account,active)});
  },[]);
  const publish=state=>{if(mounted.current)setStatus(state);};
  useEffect(()=>{
    mounted.current=true;let cancelled=false;
    (async()=>{
      if(!platform.native){publish({error:'视频云同步需要新版开发构建，请重新安装应用'});return;}
      const cover=await Asset.fromModule(require('../../assets/cloud-sync-cover.png')).downloadAsync();
      if(cancelled)return;
      const api=createApi(platform).createBiliVideoApi({request:biliFetch,uploadFetch:(url,opts)=>fetch(url,{...opts,headers:{...opts.headers,...streamHeaders()},credentials:'omit'}),csrf:cloudCsrf,coverFile:cover.localUri});
      runner.current=createProtocol(platform).createVideoCloudSync({directory:platform.directory,api,runtime:createMobileVideoRuntime(),auth:authStatus,
        readLibrary:account=>latest.current.getSyncLibrary(account),
        writeLibrary:(account,library,base)=>latest.current.applySyncLibrary(library,base,account),
        protect:platform.protect,unprotect:platform.unprotect,onStatus:publish});
      setReady(true);
    })().catch(e=>publish({error:e.message || '云同步初始化失败'}));
    const subscription=AppState.addEventListener('change',state=>{
      if(state==='active')runner.current?.resume();else runner.current?.stop();
    });
    return()=>{cancelled=true;mounted.current=false;subscription.remove();runner.current?.stop();};
  },[]);
  useEffect(()=>{
    if(!ready)return;
    const currentScope=player.libraryReady?scope:'';
    runner.current.stop();
    accountUpdates.current=accountUpdates.current.catch(()=>{}).then(async()=>{
      if(!mounted.current)return;
      await runner.current.setAccount(currentScope);
      if(AppState.currentState!=='active')runner.current.stop();else runner.current.resume();
    }).catch(e=>publish({...runner.current.status(),error:e.message}));
  },[ready,scope,player.libraryReady]);
  const act=async action=>{
    if(!ready || saving || !runner.current)return;
    setSaving(true);
    try {await accountUpdates.current;await action(runner.current);publish(runner.current.status());}
    catch(e){publish({...runner.current.status(),error:e.message || '同步失败，请重试'});}
    finally{if(mounted.current)setSaving(false);}
  };
  return <Context.Provider value={{...status,ready,saving,available:!!platform.native,syncLanKey,
    configure:patch=>act(service=>service.configure(patch)),
    loadPreview:()=>runner.current?.loadPreview() || Promise.resolve(''),
    run:readOnly=>act(service=>service.run(!!readOnly,!readOnly)),
    exportKey:()=>act(async service=>{
      const file=new File(Paths.cache,'Biu-云同步恢复密钥.json');
      platform.fs.writeFileSync(file.uri,JSON.stringify(service.exportRecovery()));
      try{await Sharing.shareAsync(file.uri,{mimeType:'application/json',UTI:'public.json',dialogTitle:'保存云同步恢复密钥'});}finally{if(file.exists)file.delete();}
    }),
    importKey:()=>act(async service=>{
      const DocumentPicker=require('expo-document-picker');
      const result=await DocumentPicker.getDocumentAsync({type:['application/json','text/plain'],copyToCacheDirectory:true,multiple:false});
      if(result.canceled)return;const file=new File(result.assets[0].uri);
      try{if(file.size>8192)throw Error('恢复密钥文件过大');await service.importRecovery(JSON.parse(await file.text()));}finally{if(file.exists)file.delete();}
    }),
  }}>{children}</Context.Provider>;
}
