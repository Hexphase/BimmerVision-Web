'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('./fixtures/bvr'),{BvrParser,StreamingBvrParser}=require('../bvr-parser');
function sign(hex,at){return A.record(2,at,Buffer.from(JSON.stringify({type:'perception',schemaVersion:1,serviceId:0x3540,instanceId:1,majorVersion:1,eventId:0x8001,source:'de.bmw.dass.TrafficSignRecognition',signal:'TrafficSignRecognition',payloadEncoding:'base64',payload:Buffer.from(hex,'hex').toString('base64')})));}
function parsers(records){const b=Buffer.concat([A.header(),...records]),p=new BvrParser(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));p.parse();const s=new StreamingBvrParser();for(let i=0;i<b.length;i+=17)s.append(b.subarray(i,i+17));return [p,s];}
test('recorded car speed limits follow the sign timeline without GPS, telemetry or future inference',()=>{
 for(const p of parsers([sign('01000006fe020001000100000000fd00',1000000),sign('01000009fe020001000101000000fd00',2000000)])){
  assert.equal(p.getTelemetryAtTime(.5,0).speedLimit,null);
  assert.equal(p.getTelemetryAtTime(1.5,0).speedLimit,30);
  assert.equal(p.getTelemetryAtTime(2,0).speedLimit,45);
  assert.equal(p.getTelemetryAtTime(2,0).speedLimitUnit,'mph');
  assert.equal(p.getTelemetryAtTime(1.5,0).speedLimitSource,'Car-detected speed limit');
  assert.equal(p.getTelemetryAtTime(1.5,0).speedLimit,30);
  assert.equal(p.getTelemetryAtTime(5,0).speedLimit,null,'missing sign updates must expire');
 }
});
test('withdrawn, unavailable, invalid units, truncated and corrupt readings clear the limit',()=>{
 for(const hex of ['02000006fe020001000100000000fd00','010000fffe020001000100000000fd00','01000006fe020003000100000000fd00','0100001dfe020001000100000000fd00','01']){
  for(const p of parsers([sign('01000006fe020001000100000000fd00',1000000),sign(hex,1500000)]))assert.equal(p.getTelemetryAtTime(1.6,0).speedLimit,null);
 }
 const corrupt=sign('01000009fe020001000101000000fd00',1500000);corrupt[20]^=1;
 for(const p of parsers([sign('01000006fe020001000100000000fd00',1000000),corrupt]))assert.equal(p.getTelemetryAtTime(1.6,0).speedLimit,null);
 for(const p of parsers([sign('0100000afe000000000100000000fd00',1000000)]))assert.equal(p.getTelemetryAtTime(1,0).speedLimitUnit,'km/h');
});
test('HUD uses only recorded car limits, converts their units and never substitutes cached web limits',()=>{
 const {BimmerVisionPlayer:Player}=require('../player'),p=Object.create(Player.prototype);
 let reading={speedLimit:30,speedLimitUnit:'mph'};
 Object.assign(p,{parser:{getTelemetryAtTime:()=>reading},manifest:{startMonotonicUs:0},currentTime:0,speedUnit:'km/h',hud:{speedLimit:{textContent:''}},currentSpeedLimit:{limit:70,unit:'mph'},_resolveSpeedLimit(){throw Error('Car HUD must not request web limits');},_speedLimitFor(){return this.currentSpeedLimit;}});
 p._updateTelemetryHud();assert.equal(p.hud.speedLimit.textContent,48);
 reading={speedLimit:null,latitude:32,longitude:-95};p._updateTelemetryHud();assert.equal(p.hud.speedLimit.textContent,'—');
});
