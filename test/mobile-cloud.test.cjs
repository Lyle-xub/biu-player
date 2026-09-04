const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixture=require('./fixtures/video-cloud-python.json');
test('mobile decrypts desktop Python snapshots including Unicode and Python float formatting',async()=>{
 const {unseal}=await import('../mobile-rn/src/cloud/envelope.js');
 const key=Buffer.from(fixture.key,'hex'),payload=Buffer.from(fixture.payload,'base64');
 assert.deepEqual(unseal(payload,key,fixture.snapshotId),fixture.library);
 assert.throws(()=>unseal(payload,Buffer.alloc(32),fixture.snapshotId));
 const changed=Buffer.from(payload);changed[50]^=1;
 assert.throws(()=>unseal(changed,key,fixture.snapshotId));
});
test('mobile envelope roundtrips and requires the intended snapshot',async()=>{
 const {seal,unseal}=await import('../mobile-rn/src/cloud/envelope.js');
 const key=Buffer.from(fixture.key,'hex'),{payload,snapshotId}=seal(fixture.library,key,Buffer.alloc(12,7),'phone-test');
 assert.deepEqual(unseal(payload,key,snapshotId),fixture.library);
 assert.throws(()=>unseal(payload,key,'0'.repeat(32)));
});
test('mobile crypto and Buffer share signed descriptors with desktop; keys stay outside JSON state',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../mobile-rn');
 const fromMobile=name=>require(require.resolve(name,{paths:[root]}));
 const babel=fromMobile('@babel/core'),secrets=new Map();
 // Use Expo's real URI utilities; only the native filesystem boundary is mocked.
 function loadPathUtility(name) {
  const filename=path.join(root,'node_modules/expo-file-system/src/pathUtilities',name+'.ts');
  const {code}=babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,configFile:false,babelrc:false,plugins:[fromMobile('@babel/plugin-transform-typescript'),fromMobile('@babel/plugin-transform-modules-commonjs')]});
  const module={exports:{}};new Function('require','module','exports',code)(name=>loadPathUtility(name),module,module.exports);
  return module.exports;
 }
 const {PathUtilities}=loadPathUtility('index');
 const file=path.join(root,'src/cloud/platform.js');
 const {code}=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,configFile:false,babelrc:false,plugins:[require.resolve('@babel/plugin-transform-modules-commonjs',{paths:[root]})]});
 const mocks={
  'expo-file-system':{Paths:{document:{uri:'file:///tmp/test-cloud/'},join:PathUtilities.join,info:uri=>{
   // java.io.File(URI) rejects an authority, as FileSystem.info does on Android.
   assert.equal(new URL(uri).host,'');require('node:url').fileURLToPath(uri);return {exists:false};
  }},File:class{},Directory:class{}},
  'expo-modules-core':{requireOptionalNativeModule:()=>({})},
  'expo-crypto':{randomUUID:require('node:crypto').randomUUID,getRandomValues:b=>require('node:crypto').webcrypto.getRandomValues(b)},
  'expo-secure-store':{setItem:(k,v)=>secrets.set(k,v),getItem:k=>secrets.get(k)},
 };
 const module={exports:{}};new Function('require','module','exports',code)(name=>mocks[name]||fromMobile(name),module,module.exports);
 const mobile=module.exports,desktop=require('../cloud-video-bili'),api=require('../renderer/cloud-video-bili-core')(mobile);
 assert.equal(mobile.directory,'file:///tmp/test-cloud/video-cloud');
 for(const base of ['file:///data/user/0/com.biu.player/files/','file:///var/mobile/Containers/Data/Application/test/Documents/']) {
  const file=mobile.path.join(mobile.path.join(base,'video-cloud'),'123','state.json');
  assert.equal(file,base+'video-cloud/123/state.json');
  assert.equal(mobile.fs.existsSync(file),false);
 }
 const meta={version:2,channel:'a'.repeat(16),device:'phone-test',slot:'A',snapshotId:'b'.repeat(32),sequence:1,parts:[{slot:'A',snapshotId:'b'.repeat(32),sequence:1,filename:'video-test'}]};
 const key=mobile.Buffer.from(fixture.key,'hex');
 const signed=api.descriptor(meta,key);
 assert.equal(signed,desktop.descriptor(meta,key));assert.deepEqual(api.parseDescriptor(signed,key),meta);
 const reference=mobile.protect(fixture.key);assert.notEqual(reference,fixture.key);assert.equal(mobile.unprotect(reference),fixture.key);
 assert.throws(()=>mobile.unprotect('arbitrary-key'));
});
