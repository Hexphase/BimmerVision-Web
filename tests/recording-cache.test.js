'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SourceManager}=require('../source-manager');
const {RecordingCache}=require('../recording-cache');
const drive={segments:['a','b','c','d','e'].map(id=>({clip:{id,complete:true}}))};
function setup(options={}){
 const calls=[],manager=new SourceManager(),source={kind:'car',async fetch(path){calls.push(path);if(path.endsWith('manifest.json'))return new Response(JSON.stringify({complete:true,bytes:3}));return new Response('bvr',{headers:{'Content-Length':'3'}});}};
 manager.setSource(source);const cache=new RecordingCache(manager,options);return {calls,manager,source,cache};
}
test('lookahead loads only next two and advances without downloading the cached current clip again',async()=>{
 const {calls,manager,cache}=setup();cache.setWindow(drive,'a');await cache.start();assert.deepEqual([...cache.entries.keys()],['b','c']);assert.equal(calls.length,4);
 cache.setWindow(drive,'b');assert.equal(await(await manager.fetch('/api/v1/recordings/b/capture.bvr')).text(),'bvr');assert.equal(calls.length,4);await cache.start();assert.deepEqual([...cache.entries.keys()],['c','d']);assert.equal(calls.length,6);
 cache.setWindow(drive,'e');await cache.start();assert.equal(cache.entries.size,0);assert.equal(calls.length,6);
});
test('navigation joins an in-flight preload and aborting a consumer does not cancel the shared preload',async()=>{
 const {calls,manager,source,cache}=setup();let release;const original=source.fetch;source.fetch=async(path,options)=>{if(path.endsWith('/b/capture.bvr'))await new Promise(resolve=>release=resolve);return original(path,options);};
 cache.setWindow(drive,'a');const pending=cache.start();while(!release)await new Promise(r=>setTimeout(r,0));cache.setWindow(drive,'b');
 const controller=new AbortController(),cancelled=manager.fetch('/api/v1/recordings/b/capture.bvr',{signal:controller.signal});controller.abort();await assert.rejects(cancelled,{name:'AbortError'});
 const response=manager.fetch('/api/v1/recordings/b/capture.bvr');release();assert.equal(await(await response).text(),'bvr');await pending;assert.equal(calls.filter(p=>p.endsWith('/b/capture.bvr')).length,1);
});
test('source changes discard private cached data and never serve the old source for the same ID',async()=>{
 const {manager,cache}=setup();cache.setWindow(drive,'a');await cache.start();manager.setSource({kind:'car',fetch:async()=>new Response('new source')});assert.equal(cache.entries.size,0);assert.equal(await(await manager.fetch('/api/v1/recordings/b/capture.bvr')).text(),'new source');
});
test('failed, truncated, incomplete and oversized preloads fall back to the selected source',async()=>{
 for(const mode of ['failure','truncated','incomplete','oversized']){
  const {manager,source,cache}=setup({maxEntryBytes:10});const original=source.fetch;source.fetch=async(path,options)=>{
   if(path.endsWith('manifest.json')&&mode==='incomplete')return new Response(JSON.stringify({complete:false}));
   if(path.endsWith('capture.bvr')){if(mode==='failure')return new Response(null,{status:500});if(mode==='truncated')return new Response('short',{headers:{'Content-Length':'9'}});if(mode==='oversized')return new Response('12345678901');}
   return original(path,options);
  };
  cache.setWindow(drive,'a');await cache.start();assert.equal(cache.entries.size,0,mode);
  source.fetch=async()=>new Response('foreground');assert.equal(await(await manager.fetch('/api/v1/recordings/b/capture.bvr')).text(),'foreground');
 }
});
test('range and mutation requests bypass cached full recordings',async()=>{
 const {manager,cache,calls}=setup();cache.setWindow(drive,'a');await cache.start();const count=calls.length;await manager.fetch('/api/v1/recordings/b/capture.bvr',{headers:{Range:'bytes=0-1'}});await manager.fetch('/api/v1/recordings/b/manifest.json',{method:'POST'});assert.equal(calls.length,count+2);
});
test('native lookahead caches preview info and MP4 instead of decoding or reading the raw BVR',async()=>{
 const {manager,source,cache,calls}=setup();const original=source.fetch;source.fetch=async(path,options)=>{if(path.startsWith('/api/v1/preview/')){calls.push(path);return new Response(JSON.stringify({mediaUrl:'/api/v1/media/'+path.split('/').pop()+'.mp4'}));}return original(path,options);};
 cache.setWindow(drive,'a',{native:true});await cache.start();assert(!calls.some(p=>p.endsWith('capture.bvr')));const count=calls.length;const info=await(await manager.fetch('/api/v1/preview/b')).json();assert.equal(await(await manager.fetch(info.mediaUrl)).text(),'bvr');assert.equal(calls.length,count);
});
test('total lookahead bytes remain bounded across the two recordings',async()=>{
 const {cache}=setup({maxBytes:45});cache.setWindow(drive,'a');await cache.start();const bytes=[...cache.entries.values()].reduce((sum,e)=>sum+[...e.files.values()].reduce((n,f)=>n+f.size,0),0);assert(bytes<=45);assert.equal(cache.entries.size,1);
});
test('leaving a drive cancels a pending preload and prevents late results from repopulating it',async()=>{
 const {cache,source}=setup();let release;source.fetch=async()=>{await new Promise(resolve=>release=resolve);return new Response('{}');};cache.setWindow(drive,'a');const pending=cache.start();cache.clear();release();await pending;assert.equal(cache.entries.size,0);
});
test('uncached foreground transfers preempt the car lookahead slot and retry while the server releases it',async()=>{
 for(const file of ['capture.bvr','raw.zip','video.mp4']){
  const {manager,cache,source}=setup();let busy=false,started,attempts=0;const warming=new Promise(resolve=>started=resolve);
  source.fetch=async path=>{
   if(path.endsWith('manifest.json'))return new Response(JSON.stringify({complete:true,bytes:3}));
   if(path.includes('/b/')){busy=true;started();return new Response(new ReadableStream({cancel(){setTimeout(()=>busy=false,40);}}));}
   attempts++;return busy?new Response('busy',{status:429}):new Response('foreground');
  };
  cache.setWindow(drive,'a');const pending=cache.start();await warming;
  const response=await manager.fetch('/api/v1/recordings/a/'+file);assert.equal(await response.text(),'foreground');assert(attempts>=2);cache.clear();await pending;assert.equal(cache.foregroundTokens.size,0);assert.equal(cache.entries.size,0);
 }
});
test('a continuously progressing preload may exceed the inactivity window in total duration',async()=>{
 const {cache,source}=setup({stallTimeoutMs:50});source.fetch=async path=>{
  if(path.endsWith('manifest.json'))return new Response(JSON.stringify({complete:true,bytes:8}));
  let count=0;return new Response(new ReadableStream({async pull(c){await new Promise(resolve=>setTimeout(resolve,15));if(count++===8)c.close();else c.enqueue(new Uint8Array([1]));}}));
 };
 cache.setWindow({segments:drive.segments.slice(0,2)},'a');await cache.start();assert.equal(cache.entries.size,1);assert.equal(cache.entries.get('b').files.get('/api/v1/recordings/b/capture.bvr').size,8);
});
test('lookahead waits for a foreground metadata stream to finish and then resumes',async()=>{
 const {manager,cache,source}=setup();const original=source.fetch;let end;
 source.fetch=async(path,options)=>path.includes('/a/capture.bvr')?new Response(new ReadableStream({start(c){end=()=>c.close();}})):original(path,options);
 cache.setWindow(drive,'a');const foreground=await manager.fetch('/api/v1/recordings/a/capture.bvr');await cache.start();assert.equal(cache.entries.size,0);assert.equal(cache.foregroundTokens.size,1);
 end();await foreground.text();await cache.pump;assert.deepEqual([...cache.entries.keys()],['b','c']);assert.equal(cache.foregroundTokens.size,0);
});

test('next clip metadata is available before its in-flight lookahead media finishes',async()=>{
 const {cache,manager,source}=setup();let started,release;
 const began=new Promise(resolve=>started=resolve),original=source.fetch;
 source.fetch=async(path,options)=>{
  if(path.endsWith('/b/capture.bvr')){started();await new Promise(resolve=>release=resolve);}
  return original(path,options);
 };
 cache.setWindow(drive,'a');const warming=cache.start();await began;cache.setWindow(drive,'b');
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50);
  try{assert.equal((await(await manager.fetch('/api/v1/recordings/b/manifest.json',{signal:controller.signal})).json()).complete,true);}
  finally{clearTimeout(timer);}
 }finally{release();cache.clear();await warming;}
});
test('lookahead playback does not depend on browser Blob resource streams',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 class ExpiredBlob extends Blob {stream(){throw Error('blob loading failed');}}
 const scope={module:{exports:{}},DOMException,AbortController,Headers,Response,ReadableStream,Blob:ExpiredBlob,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('../recording-cache'),'utf8'),scope);
 const {manager,source,calls}=setup(),cache=new scope.module.exports.RecordingCache(manager);
 cache.setWindow(drive,'a');await cache.start();cache.setWindow(drive,'b');const count=calls.length;
 assert.equal(await(await manager.fetch('/api/v1/recordings/b/capture.bvr')).text(),'bvr');
 assert.equal(calls.length,count,'cached bytes must survive loss of browser Blob resource backing');cache.clear();
});

test('selecting an in-flight next clip exposes progress before its download finishes',async()=>{
 const {cache,manager,source,calls}=setup();let stream,started;const began=new Promise(resolve=>started=resolve),original=source.fetch;
 source.fetch=async(path,options)=>{
  if(path.endsWith('/b/capture.bvr')){calls.push(path);return new Response(new ReadableStream({start(c){stream=c;c.enqueue(new Uint8Array([98]));started();}}),{headers:{'Content-Length':'3'}});}
  return original(path,options);
 };
 cache.setWindow(drive,'a');const warming=cache.start();await began;cache.setWindow(drive,'b');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100);
 try{
  const response=await manager.fetch('/api/v1/recordings/b/capture.bvr',{signal:controller.signal}),reader=response.body.getReader();
  assert.deepEqual([...((await reader.read()).value)],[98]);
  stream.enqueue(new Uint8Array([118,114]));stream.close();
  assert.deepEqual([...((await reader.read()).value)],[118,114]);assert.equal((await reader.read()).done,true);
  assert.equal(calls.filter(p=>p.endsWith('/b/capture.bvr')).length,1);
 }finally{clearTimeout(timer);cache.clear();await warming;}
});
