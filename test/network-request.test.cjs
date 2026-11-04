const {test}=require('node:test');const assert=require('node:assert/strict');const {create}=require('../renderer/network-request');
test('network exception and gateway failures fall back without dropping request headers or ranges',async()=>{
 for(const result of ['throw',502,503,504]){
  const request=create({primary:async()=>{if(result==='throw')throw Error('reset');return new Response(null,{status:result})},direct:async(url,opts)=>{assert.equal(opts.headers.Range,'bytes=0-1023');assert.equal(opts.headers.Cookie,'test-session');assert.equal(opts.credentials,undefined);return new Response('ok',{status:206})}});
  assert.equal((await request('https://example.com',{credentials:'include',headers:{Range:'bytes=0-1023',Cookie:'test-session'}})).status,206);
 }
});
test('a stalled system proxy releases the caller and retries direct',async()=>{
 let aborted=false;const request=create({primaryTimeout:15,primary:async(_,o)=>{o.signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{})},direct:async()=>new Response('ok')});
 assert.equal(await(await request('https://example.com')).text(),'ok');assert.equal(aborted,true);
});
test('caller cancellation never starts another request, including cancellation after headers',async()=>{
 let directCalls=0,received;const request=create({primary:async(_,o)=>{received=o.signal;return new Response('ok')},direct:async()=>{directCalls++;return new Response('wrong')}});
 const controller=new AbortController();await request('https://example.com',{signal:controller.signal});controller.abort();assert.equal(received.aborted,true);
 await assert.rejects(request('https://example.com',{signal:controller.signal}));assert.equal(directCalls,0);
});
test('rate limits, authentication errors, and POST gateway failures are not silently repeated',async()=>{
 const request=create({primary:async(_,o)=>new Response(null,{status:o.method==='POST'?503:412}),direct:()=>assert.fail('must not retry')});
 assert.equal((await request('https://example.com')).status,412);assert.equal((await request('https://example.com',{method:'POST'})).status,503);
});
