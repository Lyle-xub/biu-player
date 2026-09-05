import { File, Directory, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';

export { Buffer };
export const native = requireOptionalNativeModule('BiuVideoCloud');
const Crypto = native ? require('expo-crypto') : null;
const SecureStore = native ? require('expo-secure-store') : null;
export const path = {
  join: (...pieces) => Paths.join(...pieces),
  dirname: file => file.slice(0,file.lastIndexOf('/')),
  basename: (file,suffix='') => {const name=file.split('/').pop();return suffix && name.endsWith(suffix)?name.slice(0,-suffix.length):name;},
  extname: file => /\.[^./]+$/.exec(file)?.[0] || '',
};
const bytes = value => typeof value==='string'?Buffer.from(value):value;
function digest(hash) {
  return {update(value){hash.update(bytes(value));return this;},digest(encoding){const out=Buffer.from(hash.digest());return encoding?out.toString(encoding):out;}};
}
export const crypto = {
  createHash: name => {if(name!=='sha256')throw Error('不支持的摘要算法');return digest(sha256.create());},
  createHmac: (name,key) => {if(name!=='sha256')throw Error('不支持的签名算法');return digest(hmac.create(sha256,key));},
  timingSafeEqual: (a,b) => {let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a[i]^(b[i] || 0);return diff===0;},
  randomUUID: () => Crypto.randomUUID(),
  // Keep byte arrays away from Expo's iOS JSI converter. The cloud module uses
  // the platform secure RNG and returns hex, so the native boundary is strings only.
  randomBytes: size => Buffer.from(native.randomHex(size),'hex'),
};
export const fs = {
  existsSync: uri => Paths.info(uri).exists,
  mkdirSync: uri => new Directory(uri).create({intermediates:true,idempotent:true}),
  // File.write accepts Either<String, TypedArray>; Expo SDK 57 can SIGTRAP while
  // probing that union on iOS 27. Marshal through string-only native functions.
  writeFileSync: (uri,data) => {
    if(typeof data==='string')native.writeTextFile(uri,data);
    else native.writeBase64File(uri,Buffer.from(data).toString('base64'));
  },
  readFileSync: (uri,encoding) => encoding?new File(uri).textSync():Buffer.from(new File(uri).bytesSync()),
  renameSync: (from,to) => native.replaceFile(from,to),
  unlinkSync: uri => new File(uri).delete(),
  rmSync: uri => {const info=Paths.info(uri);if(info.exists)(info.isDirectory?new Directory(uri):new File(uri)).delete();},
  statSync: uri => {const node=Paths.info(uri).isDirectory?new Directory(uri):new File(uri);return {size:node.size,mtimeMs:node.info().modificationTime || 0};},
  readdirSync: uri => new Directory(uri).list().map(node=>({name:node.name,isDirectory:()=>node instanceof Directory})),
  promises:{open:async uri=>{const handle=new File(uri).open('r');return {
    read:async(buffer,offset,length,position)=>{handle.offset=position;const data=handle.readBytes(length);buffer.set(data,offset);return {bytesRead:data.length};},
    close:async()=>handle.close(),
  };}},
};
export const directory=path.join(Paths.document.uri,'video-cloud');
// The JSON state stores only a reference; actual keys stay in Keychain / Android Keystore.
export function protect(secret) {
  const reference='biu.cloud.key.'+crypto.createHash('sha256').update(secret).digest('hex');
  SecureStore.setItem(reference,secret,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
  return reference;
}
export function unprotect(reference) {
  if(!/^biu\.cloud\.key\.[a-f0-9]{64}$/.test(reference || ''))throw Error('云同步密钥无效');
  const key=SecureStore.getItem(reference);
  if(!key)throw Error('恢复密钥不可用，请重新导入');return key;
}
