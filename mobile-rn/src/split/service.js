import { streamHeaders } from '../api/client';

// MixSplitR fingerprint services.
export async function matchFingerprint(method, args, fetchJson) {
    if (method === 'netease') {
      if (typeof args.encoded !== 'string' || args.encoded.length > 128000 || !(args.duration > 0 && args.duration <= 6)) throw new Error('无效指纹');
      const data = await fetchJson('https://interface.music.163.com/api/music/audio/match', new URLSearchParams({
        sessionId: '441df692-afea-4a54-8aff-f5f20fd34f12', algorithmCode: 'shazam_v2', duration: String(args.duration),
        rawdata: args.encoded, times: '2', decrypt: '1',
      }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: 'chrome-extension://pgphbbekcgpfaekhcbjamjjkegcclhhd', 'User-Agent': streamHeaders()['User-Agent'] });
      const entry = data?.data?.result?.[0], song = entry?.song || entry;
      return song?.id && song.name ? { source: 'netease', id: song.id, title: song.name,
        artist: (song.artists || []).map((artist) => artist.name).join('/'), pic: song.album?.picUrl || null } : null;
    }
    if (method === 'shazam') {
      if (typeof args.uri !== 'string' || !args.uri.startsWith('data:audio/vnd.shazam.sig;') || args.uri.length > 128000
        || !(args.samplems > 0 && args.samplems <= 30000)) throw new Error('无效 Shazam 指纹');
      const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const n = Math.floor(Math.random() * 16); return (ch === 'x' ? n : (n & 3) | 8).toString(16);
      }).toUpperCase();
      const data = await fetchJson(`https://amp.shazam.com/discovery/v5/en-US/GB/iphone/-/tag/${uuid()}/${uuid()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`,
        JSON.stringify({ timezone: 'Asia/Shanghai', signature: { uri: args.uri, samplems: args.samplems }, timestamp: Date.now(), context: {}, geolocation: {} }),
        { 'Content-Type': 'application/json', 'Accept-Language': 'en-US', 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)' });
      return data?.track?.title ? { source: 'shazam', title: data.track.title, artist: data.track.subtitle || '', pic: data.track.images?.coverart || null } : null;
    }
  throw new Error('未知识曲服务');
}
