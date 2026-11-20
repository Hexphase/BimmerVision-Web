'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RtpH264Assembler}=require('../rtp-h264');
function packet(timestamp,sequence){const payload=new Uint8Array(14);payload[0]=0x80;payload[1]=0x80|96;new DataView(payload.buffer).setUint16(2,sequence);new DataView(payload.buffer).setUint32(4,timestamp);payload[12]=0x65;payload[13]=0x88;return {atUs:1000000+sequence*33333,payload};}
test('incremental camera-pair lookup preserves exact access units and metadata overrides',()=>{
 const arrayAssembler=new RtpH264Assembler({startMonotonicUs:1000000}),lookupAssembler=new RtpH264Assembler({startMonotonicUs:1000000}),events=[],lookup=new Map();
 for(let i=0;i<12;i++){
  // The second observation of a timestamp must win, as in the legacy array path.
  for(const pair of ['frontRear',i%3===0?'leftRight':'frontRear']){const ev={rtpTimestamp:i*3000,pair};events.push(ev);lookup.set(ev.rtpTimestamp,ev.pair);}
  const record=packet(i*3000,i);arrayAssembler.process([record],events);lookupAssembler.process([record],lookup);
 }
 arrayAssembler.flush(events);lookupAssembler.flush(lookup);
 assert.deepEqual(lookupAssembler.accessUnits,arrayAssembler.accessUnits);
 assert.equal(lookupAssembler.accessUnits[0].pair,'leftRight');
});
test('an indexed camera-pair lookup is queried without re-enumerating recording history',()=>{
 const lookup=new Map(Array.from({length:10000},(_,i)=>[i,'leftRight']));
 lookup[Symbol.iterator]=()=>{throw Error('Re-enumerated complete camera-pair history');};
 const assembler=new RtpH264Assembler({startMonotonicUs:1000000});
 assembler.process([packet(42,0)],lookup);assembler.flush(lookup);
 assert.equal(assembler.accessUnits[0].pair,'leftRight');
});

test('player indexes arriving camera-pair metadata without revisiting parser history',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');let callbacks;
 class Parser{
  constructor(value){callbacks=value;}
  get cameraPairEvents(){throw Error('Player rescanned complete pairing history');}
  append(){callbacks.onCameraPair({rtpTimestamp:42,pair:'leftRight'});callbacks.onVideoRecord(packet(42,0));}
 }
 const sandbox={VideoDecoder:class {},module:{exports:{}},AbortController,DOMException,Map,performance:{now:()=>0},RtpH264Assembler,StreamingBvrParser:Parser,window:{BVSourceManager:{fetch:async()=>({ok:true,json:async()=>({id:'clip',startMonotonicUs:1000000,durationSeconds:1})})}},sessionStorage:{getItem:()=>null}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../player'),'utf8'),sandbox);
 const p=Object.create(sandbox.module.exports.BimmerVisionPlayer.prototype);
 Object.assign(p,{_clipEpoch:0,cancelLoad(){this._clipEpoch++;},_loadOperation:p=>p,_setState(){},_loadCameraMapping:()=>({}),_updateScrubber(){},_initDecoder(){},_decodeAhead(){},_hasFramesAt:()=>true,_renderFrameAtTime(){},_updateTelemetryHud(){},async _downloadRecording(url,signal,onChunk){onChunk(new Uint8Array());}});
 await p._loadClip('/manifest','/capture');
 assert.equal(p.accessUnits[0].pair,'leftRight');assert.equal(p.streamComplete,true);
});
