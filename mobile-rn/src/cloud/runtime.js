import { Paths, File } from 'expo-file-system';
import { createDownloadResumable } from 'expo-file-system/legacy';
import { native, crypto, fs, path, Buffer } from './platform';
import { backgroundCompute } from '../performance/backgroundCompute';
import { streamHeaders } from '../api/client';
const ensureActive = signal => {if(signal?.aborted)throw Error('同步已取消');};
export function createMobileVideoRuntime() {
  return {
    ensure: async signal => {ensureActive(signal);if(!native)throw Error('视频云同步需要新版开发构建，请重新安装应用');},
    async run(request,signal,emit) {
      ensureActive(signal);if(!native)throw Error('视频云同步需要新版开发构建');
      let download,downloadFile;
      const abort=()=>{native.cancel();download?.pauseAsync().catch(()=>{});};
      native.prepare();signal?.addEventListener('abort',abort,{once:true});
      const subscription=native.addListener('progress',emit);
      try {
        if(request.operation==='encode') {
          const result=await backgroundCompute('seal',request.library,request.key,crypto.randomBytes(12).toString('hex'),request.device,request.parents);
          ensureActive(signal);
          fs.mkdirSync(request.folder);
          const payload=path.join(request.folder,'snapshot.bin'),output=path.join(request.folder,'video.mp4');
          await fs.promises.writeFile(payload,Buffer.from(result.payload,'base64'));ensureActive(signal);
          const proof=await native.encode(payload,output,result.snapshotId);ensureActive(signal);return proof;
        }
        if(request.operation!=='decode')throw Error('不支持的同步任务');
        const url=new URL(request.url);
        if(url.protocol!=='https:' || !['bilivideo.com','bilivideo.cn'].some(host=>url.hostname===host || url.hostname.endsWith('.'+host)))throw Error('无效云端视频地址');
        downloadFile=new File(Paths.cache,`biu-cloud-${crypto.randomUUID()}.mp4`);
        let received=0,total=0;
        download=createDownloadResumable(url.href,downloadFile.uri,{headers:streamHeaders()},progress=>{
          received=progress.totalBytesWritten;total=progress.totalBytesExpectedToWrite;
          emit({type:'download',bytes:received,total});
        });
        const response=await download.downloadAsync();ensureActive(signal);
        if(!response || response.status!==200)throw Error('云端视频下载失败');
        const proof=await native.decode(downloadFile.uri,request.snapshotId);ensureActive(signal);
        const library=await backgroundCompute('unseal',proof.payload,request.key,request.snapshotId);ensureActive(signal);
        const raw=await backgroundCompute('stringify',library);ensureActive(signal);
        await fs.promises.writeFile(request.output,raw);
        ensureActive(signal);
        const result={passed:true,receivedBytes:received,totalBytes:total,downloadFraction:1,scannedFrames:proof.scannedFrames,snapshotId:request.snapshotId};
        emit({type:'verified',...result});return result;
      } finally {
        subscription.remove();signal?.removeEventListener('abort',abort);
        if(downloadFile?.exists)downloadFile.delete();
      }
    },
  };
}
