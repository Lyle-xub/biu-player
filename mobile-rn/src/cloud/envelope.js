import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gzipSync, gunzipSync } from 'fflate';
import { Buffer } from 'buffer';
const MAX_JSON=8*1024*1024,MAX_CIPHER=512*1024,AAD=Buffer.from('biu-video-v2');
export const hash = value => Buffer.from(sha256(typeof value==='string'?Buffer.from(value):value)).toString('hex');
function requireValue(ok,message){if(!ok)throw Error(message);}
export function seal(library,key,nonce,device,parents=[]) {
  const raw=JSON.stringify(library),rawBytes=Buffer.from(raw);
  requireValue(library?.version===1 && rawBytes.length<=MAX_JSON,'音乐库数据超出容量');
  const meta={version:2,deviceId:device,parents,createdAt:Date.now()/1000,librarySha256:hash(rawBytes),libraryBytes:rawBytes.length,library};
  const cipher=gcm(key,nonce,AAD).encrypt(gzipSync(Buffer.from(JSON.stringify(meta))));
  const payload=Buffer.concat([Buffer.from('BIU2'),nonce,cipher]);
  requireValue(payload.length>=192&&payload.length<=MAX_CIPHER,'音乐库压缩后超过 512 KB，暂不支持本次同步');
  return {payload,snapshotId:hash(payload).slice(0,32)};
}
// Preserve the authenticated JSON bytes: Python and JS format some floating-point numbers differently.
function libraryJSON(json) {
  let depth=0;
  for(let i=0;i<json.length;i++) {
    const c=json[i];if(c==='{')depth++;else if(c==='}')depth--;
    else if(c==='"') {
      const start=i;while(++i<json.length){if(json[i]==='\\')i++;else if(json[i]==='"')break;}
      if(depth===1&&json.slice(start,i+1)==='"library"') {
        let at=i+1;while(/\s/.test(json[at] || '')&&at<json.length)at++;
        if(json[at++]!==':')continue;while(/\s/.test(json[at] || '')&&at<json.length)at++;
        const begin=at;let nesting=0;
        for(;at<json.length;at++){if(json[at]==='"'){while(++at<json.length){if(json[at]==='\\')at++;else if(json[at]==='"')break;}}
          else if(json[at]==='{')nesting++;else if(json[at]==='}'&&--nesting===0)return json.slice(begin,at+1);}
      }
    }
  }
  throw Error('快照缺少音乐库');
}
export function unseal(payload,key,expected) {
  requireValue(payload.length>=192&&payload.length<=MAX_CIPHER&&Buffer.from(payload.subarray(0,4)).toString()==='BIU2','无效加密快照');
  requireValue(hash(payload).slice(0,32)===expected,'快照摘要不匹配');
  const compressed=gcm(key,payload.subarray(4,16),AAD).decrypt(payload.subarray(16));
  requireValue(compressed.length>=18,'压缩数据无效');
  const length=new DataView(compressed.buffer,compressed.byteOffset,compressed.byteLength).getUint32(compressed.length-4,true);
  requireValue(length>0&&length<=MAX_JSON,'解压后音乐库超过容量');
  const plain=gunzipSync(compressed,{out:new Uint8Array(length)}),json=Buffer.from(plain).toString('utf8'),meta=JSON.parse(json);
  requireValue(meta.version===2&&Array.isArray(meta.parents)&&meta.library?.version===1,'不支持的快照格式');
  const raw=Buffer.from(libraryJSON(json));
  requireValue(raw.length===meta.libraryBytes&&hash(raw)===meta.librarySha256,'音乐库完整性验证失败');
  requireValue(JSON.stringify(JSON.parse(raw.toString('utf8')))===JSON.stringify(meta.library),'快照包含冲突的音乐库');
  return meta.library;
}
