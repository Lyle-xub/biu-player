import { Buffer } from 'buffer';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

// This uses the existing trusted-LAN peer/account checks. Ephemeral ECDH keeps
// recovery keys out of cleartext HTTP, TXT advertisements and library baselines.
export async function syncLanCloudKey({peer,scope,clientId,remote,local,exchange,request,signal,randomBytes}) {
  if(remote?.version!==1 || !local || local.channel===remote.channel)return null;
  if(local.channel && remote.channel)return 'conflict';
  if(!/^[a-f0-9]{64}$/.test(remote.publicKey || ''))throw Error('电脑密钥交换信息无效');
  const active=()=>!signal?.aborted;
  if(!active())throw Error('密钥同步已取消');
  const recovery=local.channel?(await exchange(null,scope,active)).recovery:null;
  const secret=randomBytes(32),publicKey=Buffer.from(x25519.getPublicKey(secret)).toString('hex');
  const context=`biu-lan-cloud-v1:${scope}:${peer.id}:${clientId}:${remote.publicKey}:${publicKey}`;
  const shared=x25519.getSharedSecret(secret,Buffer.from(remote.publicKey,'hex'));
  const key=sha256(Buffer.concat([shared,Buffer.from(context)]));
  const nonce=randomBytes(12);
  const ciphertext=gcm(key,nonce,Buffer.from(context+':request')).encrypt(Buffer.from(JSON.stringify(recovery)));
  const response=await request(peer,scope,'cloud-key',{clientId,publicKey,nonce:Buffer.from(nonce).toString('hex'),ciphertext:Buffer.from(ciphertext).toString('hex')},signal);
  if(!active())throw Error('密钥同步已取消');
  if(!/^[a-f0-9]{24}$/.test(response.nonce || '') || !/^(?:[a-f0-9]{2}){16,8192}$/.test(response.ciphertext || ''))throw Error('密钥同步响应无效');
  const plain=gcm(key,Buffer.from(response.nonce,'hex'),Buffer.from(context+':response')).decrypt(Buffer.from(response.ciphertext,'hex'));
  const result=JSON.parse(Buffer.from(plain).toString('utf8'));
  if(result.conflict)return 'conflict';
  if(!result.recovery)return null;
  const applied=await exchange(result.recovery,scope,active);
  return applied.conflict?'conflict':'synced';
}
