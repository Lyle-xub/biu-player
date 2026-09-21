import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { streamHeaders } from '../api/client';

export async function saveDownloadedVideo(uri) {
  // The Expo legacy writer requires WRITE_EXTERNAL_STORAGE below API 33.
  // Newer Android inserts our own media without requesting library read access.
  if (Platform.OS === 'ios' || Number(Platform.Version) < 33) {
    const permission = await MediaLibrary.requestPermissionsAsync(true, []);
    if (!permission.granted) throw new Error('视频已保留在应用内，请允许添加到相册后重试，或选择保存到文件');
  }
  await MediaLibrary.saveToLibraryAsync(uri);
}

export function createVideoDownload(info, uri, onProgress, onPhase) {
  let cancelled = false, task = null;
  const video = uri + '.video.mp4', audio = uri + '.audio.m4a', output = uri + '.part.mp4';
  const check = () => { if (cancelled) throw new Error('下载已取消'); };
  return {
    cancel() { cancelled = true; task?.cancelAsync().catch(() => {}); },
    async run() {
      const native = info.audioUrl ? requireOptionalNativeModule('BiuMediaExport') : null;
      if (info.audioUrl && !native?.mux) throw new Error('请安装新版本以启用高清视频下载');
      const sources = info.audioUrl ? [[info.url, video], [info.audioUrl, audio]] : [[info.url, output]];
      try {
        for (let i = 0; i < sources.length; i++) {
          check();
          task = FileSystem.createDownloadResumable(sources[i][0], sources[i][1], { headers: streamHeaders() }, p => {
            if (!cancelled && p.totalBytesExpectedToWrite > 0) {
              onProgress((i + Math.min(1, p.totalBytesWritten / p.totalBytesExpectedToWrite)) / sources.length);
            }
          });
          const result = await task.downloadAsync();
          task = null;
          check();
          if (!result || result.status < 200 || result.status >= 300) throw new Error(`下载失败：HTTP ${result?.status || '中断'}`);
          const file = await FileSystem.getInfoAsync(sources[i][1]);
          const expected = Number(Object.entries(result.headers || {}).find(([key]) => key.toLowerCase() === 'content-length')?.[1]);
          if (!file.exists || !file.size || (expected > 0 && expected !== file.size)) throw new Error('下载文件不完整，请重试');
        }
        if (native) {
          onPhase('正在合并音画');
          await native.mux(video, audio, output);
        }
        check();
        await FileSystem.moveAsync({ from: output, to: uri });
        return uri;
      } finally {
        task = null;
        await Promise.all([video, audio, output].map(path => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {})));
      }
    },
  };
}
