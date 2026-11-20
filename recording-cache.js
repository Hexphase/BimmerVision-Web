/* Session-only lookahead: at most two future recordings, no persistent storage. */
(function(root){
'use strict';
const aborted=()=>new DOMException('Recording source changed or request cancelled.','AbortError');
function wait(promise,signal){
 if(!signal)return promise;if(signal.aborted)return Promise.reject(aborted());
 return new Promise((resolve,reject)=>{const cancel=()=>reject(aborted());signal.addEventListener('abort',cancel,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});
}
class RecordingCache {
 constructor(manager,{maxBytes=768*1024*1024,maxEntryBytes=512*1024*1024,stallTimeoutMs=60000}={}){
  this.stallTimeoutMs=stallTimeoutMs;this.manager=manager;this.maxBytes=maxBytes;this.maxEntryBytes=maxEntryBytes;this.entries=new Map();this.foregroundTokens=new Set();this.next=[];this.attempted=new Set();this.paused=true;this.epoch=0;this.pump=null;
  manager.recordingCache=this;manager.subscribe(()=>this.clear());
 }
 clear(){this.epoch++;this.foregroundTokens.clear();for(const entry of this.entries.values())entry.controller.abort();this.entries.clear();this.next=[];this.attempted.clear();this.paused=true;this.pump=null;}
 setWindow(drive,clipId,{native=false}={}){
  this.native=native;
  this.paused=true;const segments=drive?.segments||[],index=segments.findIndex(s=>s.clip.id===clipId);
  this.next=index<0?[]:segments.slice(index+1,index+3).filter(s=>s.clip.complete!==false).map(s=>s.clip.id);
  const keep=new Set([clipId,...this.next]);for(const [id,entry] of this.entries)if(!keep.has(id)){entry.controller.abort();this.entries.delete(id);}
  this.current=clipId;this.attempted.clear();
 }
 start(){
  this.paused=false;const entry=this.entries.get(this.current);if(entry){entry.controller.abort();this.entries.delete(this.current);}
  if(this.foregroundTokens.size)return Promise.resolve();
  if(this.pump)return this.pump;
  const epoch=this.epoch;
  const job=(async()=>{while(!this.paused&&!this.foregroundTokens.size&&epoch===this.epoch){const id=this.next.find(id=>!this.entries.has(id)&&!this.attempted.has(id));if(!id)break;this.attempted.add(id);await this.warm(id,epoch);}})();
  this.pump=job;job.finally(()=>{if(this.pump===job)this.pump=null;});return job;
 }
 async warm(id,epoch){
  const source=this.manager.source;if(!source)return;
  const entry={controller:new AbortController(),files:new Map(),reads:new Map(),complete:false,promise:null,paths:new Set()};this.entries.set(id,entry);
  let timeout;const progress=(ms=this.stallTimeoutMs)=>{clearTimeout(timeout);timeout=setTimeout(()=>entry.controller.abort(),ms);};
  entry.promise=(async()=>{
   const signal=entry.controller.signal,base='/api/v1/recordings/'+encodeURIComponent(id);
   const read=async(path,limit,state)=>{
    const preparation=/^\/api\/v1\/preview\/[^/]+$/.test(path);progress(preparation?120000:this.stallTimeoutMs);
    const request=Promise.resolve(source.fetch(path,{signal,timeoutMs:preparation?120000:60000}));
    request.then(response=>{if(signal.aborted)return response.body?.cancel();}).catch(()=>{});
    const response=await wait(request,signal);progress();if(response.status!==200)throw Error('Not cacheable');
    const expected=Number(response.headers.get('Content-Length'))||0;
    if(expected>limit){await response.body?.cancel();throw Error('Lookahead cache budget exceeded');}
    const reader=response.body.getReader(),parts=[];let size=0;
    const headers=new Headers(response.headers),file={parts,size:0,headers};
    state.file=file;state.ready.resolve();
    try{while(true){if(signal.aborted)throw aborted();const {done,value}=await wait(reader.read(),signal);if(done)break;progress();size+=value.byteLength;if(size>limit)throw Error('Lookahead cache budget exceeded');parts.push(value);file.size=size;state.notify();}
     if(expected&&expected!==size)throw Error('Incomplete lookahead recording');
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    headers.set('Content-Length',String(size));return file;
   };
   // Keep byte chunks so cached playback does not depend on a speculative
   // Blob resource still being readable when Safari opens the next clip.
   const used=[...this.entries.values()].reduce((sum,e)=>sum+(e===entry?0:[...e.files.values()].reduce((n,f)=>n+f.size,0)),0);
   let remaining=this.maxBytes-used;
   const add=(path,limit=this.maxEntryBytes)=>{
    entry.paths.add(path);
    const state={done:false,error:null};
    state.ready={};state.ready.promise=new Promise((resolve,reject)=>Object.assign(state.ready,{resolve,reject}));
    state.ready.promise.catch(()=>{});
    const changed=()=>{state.changed=new Promise(resolve=>state.wake=resolve);};changed();
    state.notify=()=>{state.wake();changed();};entry.reads.set(path,state);
    const job=read(path,Math.min(limit,remaining),state).then(file=>{
     remaining-=file.size;entry.files.set(path,file);state.done=true;state.notify();return file;
    },error=>{state.error=error;state.done=true;state.ready.reject(error);state.notify();throw error;});
    return job;
   };
   const json=file=>new Response(this.body(file)).json();
   const manifest=await add(base+'/manifest.json',1024*1024),info=await json(manifest);
   if(info.complete===false)throw Error('Recording is still changing');
   if(this.native){
    const previewPath='/api/v1/preview/'+encodeURIComponent(id),preview=await add(previewPath,8*1024*1024);
    const info=await json(preview);
    if(typeof info.mediaUrl!=='string'||!/^\/api\/v1\//.test(info.mediaUrl)||info.mediaUrl.includes('\\')||/[\r\n]/.test(info.mediaUrl))throw Error('Invalid preview media path');
    await add(info.mediaUrl);
   }else{
    if(remaining<=0||Number(info.bytes)>Math.min(this.maxEntryBytes,remaining))throw Error('Lookahead cache budget exceeded');
    await add(base+'/capture.bvr');
   }
   if(signal.aborted||epoch!==this.epoch||source!==this.manager.source||this.entries.get(id)!==entry)throw aborted();
   entry.complete=true;
  })().catch(()=>{if(this.entries.get(id)===entry)this.entries.delete(id);}).finally(()=>clearTimeout(timeout));
  await entry.promise;
 }
 async preempt(){
  this.paused=true;const jobs=[];
  for(const [id,entry] of this.entries)if(!entry.complete){entry.controller.abort();this.entries.delete(id);this.attempted.delete(id);jobs.push(entry.promise);}
  await Promise.allSettled(jobs);
 }
 async foreground(source,path,options){
  const token={},epoch=this.epoch,current=this.current,resume=!this.paused;this.foregroundTokens.add(token);
  let finished=false;
  const finish=()=>{
   if(finished)return;finished=true;this.foregroundTokens.delete(token);
   if(epoch!==this.epoch||current!==this.current)return;
   if(resume)this.paused=false;
   if(!this.paused&&!this.foregroundTokens.size)this.start();
  };
  try{
   await this.preempt();
   for(let attempt=0;;attempt++){
    if(source!==this.manager.source||options.signal?.aborted)throw aborted();
    const response=await source.fetch(path,options);
    if(response.status===429&&attempt<4){
     const delay=Math.min(2000,Math.max(250,Number(response.headers.get('Retry-After'))*1000||250*2**attempt));
     await response.body?.cancel();await wait(new Promise(resolve=>setTimeout(resolve,delay)),options.signal);continue;
    }
    if(!response.ok||!response.body){finish();return response;}
    const reader=response.body.getReader();
    const body=new ReadableStream({async pull(c){try{const part=await reader.read();if(part.done){reader.releaseLock();c.close();finish();}else c.enqueue(part.value);}catch(error){c.error(error);finish();}},async cancel(reason){try{await reader.cancel(reason);}finally{reader.releaseLock();finish();}}});
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
   }
  }catch(error){finish();throw error;}
 }
 // Each consumer owns its stream, so cancelling playback cannot cancel a future
 // consumer of the same cached bytes. No Blob re-streaming or object URL is used.
 body(file,signal,state){
  let index=0;
  return new ReadableStream({async pull(controller){
   try{
    while(true){
     if(signal?.aborted)throw aborted();
     if(state?.error)throw state.error;
     if(index<file.parts.length){controller.enqueue(file.parts[index++]);return;}
     if(!state||state.done){controller.close();return;}
     await wait(state.changed,signal);
    }
   }catch(error){controller.error(error);}
  }});
 }
 async fetch(source,path,options={}){
  const match=/^\/api\/v1\/(?:recordings\/([^/]+)\/(?:manifest\.json|capture\.bvr)|preview\/([^/]+))$/.exec(path);
  const headers=new Headers(options.headers||{});
  if((!options.method||options.method==='GET')&&!headers.has('Range')){
   const entry=match?this.entries.get(decodeURIComponent(match[1]||match[2])):[...this.entries.values()].find(e=>e.paths.has(path));
   if(entry){
    // A selected preload exposes its headers and buffered bytes immediately.
    // The player can now observe inactivity per read, rather than timing out
    // while a healthy full recording downloads behind the response promise.
    const state=entry.reads.get(path);
    if(!entry.files.has(path))await wait(state?state.ready.promise:entry.promise,options.signal).catch(()=>{});
    if(source!==this.manager.source||options.signal?.aborted)throw aborted();
    const file=entry.files.get(path)||(state&&!state.error&&state.file);
    if(file)return new Response(this.body(file,options.signal,state),{headers:file.headers});
   }
  }
  if(options.signal?.aborted||source!==this.manager.source)throw aborted();
  if(source.kind==='car'&&/\/api\/v1\/(?:recordings\/[^/]+\/(?:data|download|video|capture\.bvr|raw\.zip|[^/]+\.mp4)|preview\/[^/]+\/.+|media\/)/.test(path))return this.foreground(source,path,options);
  return source.fetch(path,options);
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={RecordingCache};
else root.BVRecordingCache=new RecordingCache(root.BVSourceManager);
})(typeof globalThis!=='undefined'?globalThis:this);
