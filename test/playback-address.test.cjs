const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function apiFor(respond) {
 const calls=[];
 const window={bili:{get:async(url,opts)=>{calls.push({url,opts});return {status:200,body:JSON.stringify(await respond(url,calls.length))}}}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../renderer/api.js'),'utf8'),
  {window,console,URLSearchParams,TextDecoder,atob,setTimeout,clearTimeout,document:{createElement:()=>({canPlayType:()=>''})}});
 return {api:window.api,calls};
}
const data={dash:{audio:[{baseUrl:'https://cdn/audio',bandwidth:100}],video:[{id:80,codecid:7,baseUrl:'https://cdn/video'}]}};
test('code=0 voucher responses fall through for audio and original-video manifests while preserving CID',async()=>{
 const {api,calls}=apiFor(url=>({code:0,data:url.includes('/wbi/')?{v_voucher:'not-a-stream'}:data}));
 assert.equal(await api.playUrl('BVparts',39646464077),'https://cdn/audio');
 const video=await api.videoUrl('BVparts',39646464077,80);
 assert.equal(video.url,'https://cdn/video');
 assert.equal(calls.length,4);
 assert.ok(calls.every(c=>new URL(c.url).searchParams.get('cid')==='39646464077'));
 assert.ok(calls.every(c=>!c.url.includes('/x/web-interface/playurl')));
});
test('malformed/empty success is not cached and later retry can recover',async()=>{
 let good=false;const {api}=apiFor(()=>({code:0,data:good?data:{}}));
 await assert.rejects(api.playUrl('BVx',1),/未返回可用/);
 await assert.rejects(api.videoQualities('BVx',1),/未返回可用/);
 good=true;assert.equal((await api.videoQualities('BVx',1))[0].quality,80);
});
test('selection skips blank URLs and keeps quality and permission fallbacks',async()=>{
 const {api,calls}=apiFor(()=>({code:0,data:{dash:{flac:{display:false,audio:{baseUrl:'https://cdn/vip'}},audio:[
  {bandwidth:999,baseUrl:''},{bandwidth:200,base_url:'//cdn/high'},{bandwidth:100,url:'http://cdn/low'}]}}}));
 assert.equal(await api.playUrl('BVx',1,2),'https://cdn/high');
 assert.equal(await api.playUrl('BVx',1,0),'https://cdn/low');
 assert.equal(calls.length,2);
});
test('nonzero responses and missing URLs on both endpoints reject, without returning undefined',async()=>{
 const {api}=apiFor(url=>url.includes('/wbi/')?{code:-403,message:'sign expired'}:{code:0,data:{dash:{audio:[{baseUrl:'javascript:bad'}]}}});
 await assert.rejects(api.playUrl('BVx',1),/未返回可用/);
});
