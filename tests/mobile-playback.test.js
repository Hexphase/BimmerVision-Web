'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {DriveGrouper}=require('../drive-grouper');
function playerHarness(decoderClass, store = new Map()){
 const ctx=new Proxy({}, {get:(_,k)=>k==='measureText'?()=>({width:10}):()=>{}}),canvas={width:1280,height:960,getContext:()=>ctx};
 const sandbox={console,DOMException,AbortController,Blob,URL,sessionStorage:{getItem:()=>null},Map,setTimeout,clearTimeout,VideoDecoder:decoderClass,EncodedVideoChunk:class{constructor(options){Object.assign(this,options);}},performance:{now:()=>1000},requestAnimationFrame:()=>1,cancelAnimationFrame(){},document:{createElement:()=>canvas,getElementById:()=>null},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},window:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../player'),'utf8')+'\nthis.Player=BimmerVisionPlayer;',sandbox);
 const p=new sandbox.Player(canvas,{});
 p._sandbox=sandbox;
 p._store = store;
 return p;
}
test('missing GPS and metrics never fabricate a route, address or speed',()=>{
 const drive=DriveGrouper.group([{id:'a',sessionId:'s',sequence:1,startedAt:'2026-11-13T15:00:00Z',startMonotonicUs:0,endMonotonicUs:10000000,durationSeconds:10}])[0];
 assert.deepEqual(drive.route,[]);assert.equal(drive.metrics.topSpeedMph,null);assert.equal(drive.endpoints.start.address,'Location unavailable');
});
test('timeline selects recorded clips and leaves recording gaps unavailable',()=>{
 const {DriveTimeline}=require('../drive-timeline');
 const d={segments:[{offset:0,clip:{id:'a',durationSeconds:10}},{offset:15,clip:{id:'b',durationSeconds:5}}]};
 assert.equal(DriveTimeline.segmentAt(d,7).clip.id,'a');assert.equal(DriveTimeline.segmentAt(d,12),null);assert.equal(DriveTimeline.segmentAt(d,17).clip.id,'b');assert.equal(DriveTimeline.duration(d),20);
});
test('playback clock waits for decoded frames instead of reporting false progress',()=>{
 const p=playerHarness();p.duration=10;p.accessUnits=[{index:0,time:0},{index:1,time:0.03},{index:2,time:0.06}];p.currentTime=0.03;p.currentAuIndex=1;p.isPlaying=true;p.lastFrameWallTime=900;p._tick();assert.equal(p.currentTime,0.03);assert.equal(p.playbackState,'buffering');
});
test('paused preparation submits contiguous frames with bounded lookahead',()=>{
 const p=playerHarness();let n=0;p.decoder={state:'configured',decodeQueueSize:0,decode(){n++;}};p.accessUnits=Array.from({length:25},(_,index)=>({index,time:index/30,avcc:new Uint8Array([0,0,0,1,1]),isKeyFrame:index===0}));
 p.nextDecodeIdx=0;p._makeChunk=x=>x;p._decodeAhead();assert.ok(n>0,'paused first-frame/seek preparation must submit frames');
});
test('backward seek onto a keyframe also prepares the preceding camera pair',()=>{
 const p=playerHarness();p.duration=1;p.currentAuIndex=5;
 p.accessUnits=Array.from({length:10},(_,index)=>({index,time:index/10,avcc:new Uint8Array([0,0,0,1,1]),isKeyFrame:index===0||index===5}));
 p._initDecoder=()=>{p.decoder={state:'configured',decodeQueueSize:0,decode:chunk=>p.decodedFrames.set(chunk.timestamp,{close(){}})};};
 p._makeChunk=x=>x;p._resetDecoderForSeek(5);assert.equal(p._hasFramesAt(.5),true);
});
test('backward seek restores evicted frames even with a short decode queue',()=>{
 const p=playerHarness();p.duration=40;p.currentAuIndex=300;p.currentTime=30;p.nextDecodeIdx=308;
 p.accessUnits=Array.from({length:400},(_,index)=>({index,time:index/10,avcc:new Uint8Array([0,0,0,1,1]),isKeyFrame:index===0}));
 p._pendingFrames=new Set();p._initDecoder=()=>{p.decoder={state:'configured',decodeQueueSize:0,decode:chunk=>p.decodedFrames.set(chunk.timestamp,{close(){}})};};p._makeChunk=x=>x;
 p.seek(29.1);assert.equal(p._hasFramesAt(29.1),true);
});
test('secure browsers keep customized exports while HTTP phones use native playback',()=>{
 const p=playerHarness(),choose=p.constructor.useNativePreview;
 assert.equal(choose(true,true,true,false),false);assert.equal(choose(true,false,false,false),true);assert.equal(choose(false,false,false,false),false);assert.equal(choose(true,true,true,true),true);
});

test('decoder dequeue refills the first-frame preparation queue while paused',async()=>{
 const submitted=[];
 class Decoder{constructor(){this.state='configured';this.decodeQueueSize=0;this.handlers={};}configure(){}addEventListener(n,fn){this.handlers[n]=fn;}decode(chunk){submitted.push(chunk.timestamp);this.decodeQueueSize++;}}
 const p=playerHarness(Decoder);p._initDecoder();p.accessUnits=Array.from({length:40},(_,index)=>({index,time:index/30,avcc:new Uint8Array([0,0,0,1,1]),isKeyFrame:index===0}));
 p.nextDecodeIdx=0;p._decodeAhead();assert.equal(submitted.length,8);
 p.decoder.decodeQueueSize=0;p.decoder.handlers.dequeue();await new Promise(r=>setTimeout(r,5));assert.equal(submitted.length,16);assert.equal(p.isPlaying,false);
});

test('recording camera mapping loads per-clip identity and preserves distinct assignments',()=>{
 const p=playerHarness();
 p.saveCameraMapping({phase0:'leftRight',phase1:'frontRear',flipHalves:true},'clip-123');
 assert.equal(p.cameraMapping.phase0,'leftRight');
 assert.equal(p.cameraMapping.flipHalves,true);
 const loaded=p._loadCameraMapping('clip-123');
 assert.equal(loaded.phase0,'leftRight');
 assert.equal(loaded.phase1,'frontRear');
 assert.equal(loaded.flipHalves,true);
});

test('fixed-scale timeline preserves seconds per pixel and resolves gaps in drag direction',()=>{
 const {DriveTimeline:T}=require('../drive-timeline');
 const d={segments:[{offset:0,clip:{id:'a',durationSeconds:10}},{offset:15,clip:{id:'b',durationSeconds:5}}]};
 assert.equal(T.timeAfterDrag(20,50),10);
 assert.equal(T.timeAfterDrag(20,-50),30);
 assert.equal(T.targetAt(d,12,1).segment.clip.id,'b');
 assert.equal(T.targetAt(d,12,1).offset,0);
 assert.equal(T.targetAt(d,12,-1).segment.clip.id,'a');
 assert.ok(T.targetAt(d,12,-1).offset<10);
 assert.equal(T.targetAt(d,20,1).segment.clip.id,'b');
});
test('awaited seek waits for both camera frames and a rendered frame before completing',async()=>{
 const p=playerHarness();p.duration=10;p.accessUnits=[{index:0,time:0},{index:1,time:1}];
 let ready=false,drawn=false;p._hasFramesAt=()=>ready;p._decodeAhead=()=>{};p._renderFrameAtTime=()=>{drawn=ready;return ready;};
 const pending=p.seekAndWait(1);let settled=false;pending.then(()=>settled=true);
 await new Promise(r=>setTimeout(r,10));assert.equal(settled,false);
 ready=true;await pending;assert.equal(drawn,true);assert.equal(p.currentTime,1);
});

test('paused seek advances its decode target when more of the recording arrives',async()=>{
 const p=playerHarness();p.duration=10;p.accessUnits=Array.from({length:10},(_,index)=>({index,time:index/10}));
 p._decodeAhead=()=>{p.nextDecodeIdx=Math.min(p.accessUnits.length,p.currentAuIndex+26);};
 p._hasFramesAt=t=>p.accessUnits.length>80&&p.nextDecodeIdx>80;
 p._renderFrameAtTime=()=>p.currentAuIndex===80;
 const pending=p.seekAndWait(8);
 p.accessUnits=Array.from({length:100},(_,index)=>({index,time:index/10}));
 const result=await Promise.race([pending.then(()=>true),new Promise(r=>setTimeout(()=>r(false),100))]);
 if(!result)p._clipEpoch++;
 await pending.catch(()=>{});
 assert.equal(result,true,'new streamed frames must move the paused decoding window to the requested time');
});
test('a newer awaited seek cancels the older target',async()=>{
 const p=playerHarness();p.duration=10;p.accessUnits=[{index:0,time:0},{index:1,time:1}];p._hasFramesAt=()=>false;p._decodeAhead=()=>{};
 const first=p.seekAndWait(1),firstRejected=assert.rejects(first,e=>e.name==='AbortError');
 const second=p.seekAndWait(2),secondRejected=assert.rejects(second,e=>e.name==='AbortError');p._clipEpoch++;
 await Promise.all([firstRejected,secondRejected]);
});
test('resuming a timeline endpoint does not restart the recording',async()=>{
 const p=playerHarness();p.manifest={};p.streamComplete=true;p.duration=10;p.currentTime=9.99;p._tick=()=>{};let restarted=false;p.seek=()=>{restarted=true;};
 await p.play({restartAtEnd:false});assert.equal(restarted,false);assert.equal(p.currentTime,9.99);
 const {DriveTimeline:T}=require('../drive-timeline');assert.equal(T.targetAt({segments:[{offset:0,clip:{durationSeconds:10}}]},10,1).gap,false);
});
test('native startup seeks to the first frame containing both camera pairs',async()=>{
 const p=playerHarness();p.duration=4;p.nativeInfo={firstCompleteFrameTime:0.04};p._nativeVideo={currentTime:0,readyState:2,seeking:false};p._renderFrameAtTime=()=>true;
 await p.seekAndWait(0);assert.equal(p.currentTime,0.04);
});


test('Play is gated until the entire encoded recording is received',async()=>{
 const p=playerHarness();p.manifest={};p.streamComplete=false;p._tick=()=>{};
 await p.play();assert.equal(p.isPlaying,false);
 p.streamComplete=true;await p.play();assert.equal(p.isPlaying,true);
});
test('decoded first frames cannot mark a partial download ready',()=>{
 const p=playerHarness();p.manifest={};p.streamComplete=false;p._setState('loading');p._setState('paused');
 assert.equal(p.playbackState,'loading');
});
test('complete-transfer waiter rejects cancellation and never follows a replacement clip',async()=>{
 const p=playerHarness();p.manifest={id:'old'};p.streamComplete=false;
 const waiting=p.waitForCompleteRecording(100);const rejected=assert.rejects(waiting,e=>e.name==='AbortError');
 p.cancelLoad();p.manifest={id:'new'};p.streamComplete=true;await rejected;
});
test('complete-transfer waiter returns an actionable bounded failure for a stalled source',async()=>{
 const p=playerHarness();p.manifest={id:'test'};p.streamComplete=false;
 await assert.rejects(p.waitForCompleteRecording(15),/connection.*retry/i);
});
test('cancel clears completion state from the previous clip',()=>{
 const p=playerHarness();p.streamPromise=Promise.resolve();p.streamComplete=true;p.cancelLoad();
 assert.equal(p.streamPromise,null);assert.equal(p.streamComplete,false);
});


function downloadHarness(){
 const p=playerHarness();let controller;
 const stream=new ReadableStream({start(c){controller=c;}});
 const signal=new AbortController();p._activeStreamAbort=signal;
 p._sandbox.fetch=async()=>({ok:true,headers:{get:()=> '4'},body:stream});
 return {p,controller,signal:signal.signal};
}
test('complete download keeps readiness gated through its final bytes and reports byte progress',async()=>{
 const {p,controller,signal}=downloadHarness();let received=0,settled=false;
 const pending=p._downloadRecording('/capture',signal,v=>received+=v.length).then(()=>settled=true);
 controller.enqueue(new Uint8Array([1,2]));await new Promise(r=>setTimeout(r,10));
 assert.equal(settled,false);assert.equal(p.loadedByteOffset,2);assert.equal(p.totalBytes,4);assert.equal(p.playbackState,'loading');
 controller.enqueue(new Uint8Array([3,4]));controller.close();await pending;
 assert.equal(received,4);assert.equal(p.loadedByteOffset,4);
});
test('truncated downloads fail instead of declaring a complete recording',async()=>{
 const {p,controller,signal}=downloadHarness();controller.enqueue(new Uint8Array([1]));controller.close();
 await assert.rejects(p._downloadRecording('/capture',signal,()=>{}),/incomplete/i);
});
test('cross-clip cancellation releases a stalled recording reader promptly',async()=>{
 const {p,signal}=downloadHarness();const pending=p._downloadRecording('/capture',signal,()=>{});
 const rejected=assert.rejects(pending,e=>e.name==='AbortError');
 await new Promise(r=>setTimeout(r,5));p.cancelLoad();await rejected;
});
test('stalled download terminates the actual network read with a retry error',async()=>{
 const {p,signal}=downloadHarness();p.loadTimeoutMs=15;
 await assert.rejects(p._downloadRecording('/capture',signal,()=>{}),/connection.*retry/i);
 assert.equal(signal.aborted,true);
});

test('synthetic BVR parsing finishes the source before initializing the bounded decoder',async()=>{
 const p=playerHarness(class {}),{manifest,bytes}=require('./helpers/synthetic-bvr')();let body;
 const stream=new ReadableStream({start(c){body=c;}});
 Object.assign(p._sandbox,{TextDecoder,atob,StreamingBvrParser:require('../bvr-parser').StreamingBvrParser,RtpH264Assembler:require('../rtp-h264').RtpH264Assembler});
 p._sandbox.fetch=async url=>url==='/manifest'?{ok:true,json:async()=>manifest}:{ok:true,headers:{get:()=>String(bytes.length)},body:stream};
 let initialized=false;p._initDecoder=()=>{initialized=true;for(let i=0;i<2;i++)p.decodedFrames.set(i,{close(){}});};
 p._decodeAhead=()=>{};p._updateTelemetryHud=()=>{};p._renderFrameAtTime=()=>true;
 const pending=p.loadClip('/manifest','/capture');let settled=false;pending.then(()=>settled=true);
 body.enqueue(bytes.slice(0,bytes.length/2));await new Promise(r=>setTimeout(r,15));
 assert.ok(p.accessUnits.length>2);assert.equal(initialized,false);assert.equal(settled,false);assert.equal(p.streamComplete,false);
 body.enqueue(bytes.slice(bytes.length/2));body.close();await pending;
 assert.equal(p.streamComplete,true);assert.equal(initialized,true);assert.equal(p.loadedByteOffset,bytes.length);assert.equal(p.playbackState,'paused');
 assert.ok(p.accessUnits.length>50);assert.equal(p.decodedFrames.size,2);
});

test('native playback receives a complete local media Blob and releases it on clip change',async()=>{
 const p=playerHarness();p.nativeAvailable=true;let body,mediaBlob,released=false,source=null;
 const stream=new ReadableStream({start(c){body=c;}}),events=new Map();
 const canvas=p.canvas,video={duration:2,currentTime:0,readyState:2,seeking:false,style:{},setAttribute(){},removeAttribute(){},remove(){},pause(){},
   addEventListener(n,f){if(!events.has(n))events.set(n,new Set());events.get(n).add(f);},removeEventListener(n,f){events.get(n)?.delete(f);},
   load(){if(this.src){source=this.src;for(const f of [...events.get('loadeddata')||[]])f();}}};
 p._sandbox.document={body:{appendChild(){}},getElementById:()=>null,createElement:tag=>tag==='video'?video:canvas};
 p._sandbox.URL={createObjectURL:b=>{mediaBlob=b;return 'blob:complete-recording';},revokeObjectURL:()=>{released=true;}};
 p._sandbox.StreamingBvrParser=class{getRouteSeries(){return [];}};
 p._sandbox.fetch=async url=>url==='/manifest'?{ok:true,json:async()=>({id:'native',durationSeconds:2})}:url.includes('/preview/native')?{ok:true,json:async()=>({mediaUrl:'/video'})}:{ok:true,headers:{get:()=> '4'},body:stream};
 p._updateTelemetryHud=()=>{};p._renderNativeFrame=()=>true;
 const pending=p.loadClip('/manifest','/capture');body.enqueue(new Uint8Array([1,2]));await new Promise(r=>setTimeout(r,10));
 assert.equal(source,null);assert.equal(p.streamComplete,false);
 body.enqueue(new Uint8Array([3,4]));body.close();await pending;
 assert.equal(mediaBlob.size,4);assert.equal(source,'blob:complete-recording');assert.equal(p.streamComplete,true);
 p.cancelLoad();assert.equal(released,true);
});

test('speed limits never carry across locations or accept estimated road-class defaults',async()=>{
 const p=playerHarness();p._updateTelemetryHud=()=>{};p._sandbox.fetch=async()=>({ok:true,json:async()=>({limit:30,unit:'mph',isEstimated:true})});
 await p._resolveSpeedLimit(32,-95);await new Promise(r=>setImmediate(r));assert.equal(p.currentSpeedLimit,null);
 p.currentSpeedLimit={limit:45,unit:'mph',key:'32.0000,-95.0000'};p._sandbox.fetch=async()=>({ok:true,json:async()=>({limit:null})});
 await p._resolveSpeedLimit(33,-95);await new Promise(r=>setImmediate(r));assert.equal(p.currentSpeedLimit,null);
});
test('late speed-limit replies cannot populate another recording and valid tagged limits retain units',async()=>{
 const p=playerHarness();p._updateTelemetryHud=()=>{};let finish;p._sandbox.fetch=()=>new Promise(r=>{finish=r;});
 const pending=p._resolveSpeedLimit(32,-95);p.cancelLoad();finish({ok:true,json:async()=>({limit:80,unit:'km/h',source:'OpenStreetMap maxspeed',isEstimated:false})});await pending;await new Promise(r=>setImmediate(r));assert.equal(p.currentSpeedLimit,null);
 p._sandbox.fetch=async()=>({ok:true,json:async()=>({limit:50,unit:'mph',source:'OpenStreetMap maxspeed',isEstimated:false})});await p._resolveSpeedLimit(34,-95);assert.equal(p.currentSpeedLimit.limit,50);assert.equal(p.currentSpeedLimit.unit,'mph');
});

test('damaged source AUs are not submitted and do not freeze source-time playback',()=>{
 const p=playerHarness();p.streamComplete=true;p.duration=1;p.accessUnits=[{index:0,time:0,avcc:new Uint8Array([1]),damaged:false},{index:1,time:.03,avcc:new Uint8Array([2]),damaged:true},{index:2,time:.06,avcc:new Uint8Array([3]),damaged:false}];
 const submitted=[];p.decoder={state:'configured',decodeQueueSize:0,decode:x=>submitted.push(x.timestamp)};p.currentAuIndex=1;p._makeChunk=x=>x;
 p._decodeAhead();assert.deepEqual(submitted,[0,2]);p.decodedFrames.set(0,{close(){}});assert.equal(p._hasFramesAt(.03),true);
 p.lastLrFrame={stale:true};let rendered;p._drawToCanvas=(fr,lr)=>{rendered={fr,lr};};p._renderFrameAtTime(.03);
 assert.equal(rendered.lr,null,'missing source must not be shown as old footage');assert.ok(rendered.fr);
});

test('finite playback flushes the decoder once to release delayed final camera pictures',async()=>{
 let flushes=0;
 class Decoder{constructor(o){this.o=o;this.state='configured';this.decodeQueueSize=0;this.held=[];}configure(){}addEventListener(){}decode(c){this.held.push(c.timestamp);}close(){this.state='closed';}async flush(){flushes++;for(const timestamp of this.held)this.o.output({timestamp,close(){}});}}
 const p=playerHarness(Decoder);p._sandbox.createImageBitmap=async f=>({index:f.timestamp,close(){}});
 p.manifest={};p.streamComplete=true;p.duration=.1;p.accessUnits=[{index:0,time:0,isKeyFrame:true,avcc:new Uint8Array([1])},{index:1,time:.03,avcc:new Uint8Array([2])}];
 p._initDecoder();p._decodeAhead();await new Promise(r=>setTimeout(r,10));p._decodeAhead();
 assert.equal(flushes,1);assert.equal(p._hasFramesAt(.1),true);
 let ended=0;p.onEnded=()=>ended++;p.currentTime=.099;p.isPlaying=true;p.lastFrameWallTime=900;p._tick();
 assert.equal(p.playbackState,'ended');assert.equal(ended,1);
});
test('EOF marks a missing decoder output unavailable only after pending image jobs settle',async()=>{
 let finishBitmap;
 class Decoder{constructor(o){this.o=o;this.state='configured';this.decodeQueueSize=0;}configure(){}addEventListener(){}close(){}decode(c){if(c.timestamp===0)this.o.output({timestamp:0,close(){}});}async flush(){}}
 const p=playerHarness(Decoder);p._sandbox.createImageBitmap=()=>new Promise(r=>finishBitmap=()=>r({close(){}}));
 p.manifest={};p.streamComplete=true;p.duration=.1;p.accessUnits=[{index:0,time:0,isKeyFrame:true,avcc:new Uint8Array([1])},{index:1,time:.03,avcc:new Uint8Array([2])}];
 p._initDecoder();p._decodeAhead();await new Promise(r=>setTimeout(r,5));assert.equal(p._hasFramesAt(.1),false);
 finishBitmap();await new Promise(r=>setTimeout(r,5));assert.equal(p._hasFramesAt(.1),true);
 assert.equal(p._decoderMissingFrames.has(0),false);assert.equal(p._decoderMissingFrames.has(1),true);
});
test('an obsolete EOF flush cannot publish missing-frame state into a replacement clip',async()=>{
 let finishFlush;
 class Decoder{constructor(){this.state='configured';this.decodeQueueSize=0;}configure(){}addEventListener(){}close(){this.state='closed';}decode(){}flush(){return new Promise(r=>finishFlush=r);}}
 const p=playerHarness(Decoder);p.streamComplete=true;p.accessUnits=[{index:0,time:0,isKeyFrame:true,avcc:new Uint8Array([1])}];p._initDecoder();p._decodeAhead();
 p.cancelLoad();p._decoderMissingFrames=new Set();finishFlush();await new Promise(r=>setTimeout(r,5));assert.equal(p._decoderMissingFrames.size,0);assert.equal(p.loadError,undefined);
});
