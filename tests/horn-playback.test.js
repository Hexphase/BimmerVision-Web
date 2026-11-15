'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('./fixtures/bvr');
const {BvrParser,StreamingBvrParser}=require('../bvr-parser');
const {BimmerVisionPlayer:Player}=require('../player');
const {ClipExporter}=require('../exporter');
const record=(atUs,obj)=>A.record(2,atUs,Buffer.from(JSON.stringify(obj)));
const horn=(pressed)=>({type:'horn',schemaVersion:1,source:'BDC.HUPE_TASTER',valid:true,pressed});
function parsers(records){const b=Buffer.concat([A.header(),...records]),p=new BvrParser(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));p.parse();const s=new StreamingBvrParser();for(let i=0;i<b.length;i+=17)s.append(b.subarray(i,i+17));return [p,s];}
test('recorded horn is timestamp bounded through press, release, backward seek, unavailable and expiry in both parsers',()=>{
 const records=[record(1000000,{type:'start',startMonotonicUs:1000000}),record(2000000,horn(true)),record(2200000,horn(false)),record(2300000,horn(true)),record(2400000,{type:'horn-status',schemaVersion:1,source:'BDC.HUPE_TASTER',state:'unavailable'}),record(2500000,horn(true))];
 for(const p of parsers(records))for(const [time,pressed] of [[0,false],[1,true],[1.2,false],[1.3,true],[1.4,false],[1.5,true],[3.500001,false],[.9,false]])assert.equal(p.getTelemetryAtTime(time,1000000).hornPressed,pressed,`${p.constructor.name} at ${time}`);
});
test('native telemetry horn uses original sample time and rejects future, stale, invalid or malformed fields',()=>{
 const p=new StreamingBvrParser();
 const good={value:true,atUs:2000000,ageUs:100000,valid:true,sourceValid:true,latched:false};
 p.telemetryRecords=[{atUs:2100000,fields:{horn:good}}];
 for(const [time,pressed] of [[2,false],[2.1,true],[4,true],[4.000001,false],[1,false]])assert.equal(p.getTelemetryAtTime(time,0).hornPressed,pressed,`time ${time}`);
 for(const patch of [{valid:false},{sourceValid:false},{value:1},{atUs:2200000},{ageUs:2000001},{latched:true},{atUs:null},{ageUs:-1}]){p.telemetryRecords=[{atUs:2100000,fields:{horn:{...good,...patch}}}];assert.equal(p.getTelemetryAtTime(2.1,0).hornPressed,false,JSON.stringify(patch));}
 p.telemetryRecords=[{atUs:2100000,fields:{}}];assert.equal(p.getTelemetryAtTime(2.1,0).hornPressed,false);
});
test('bad horn record CRC clears a prior press rather than showing corrupted or stale state',()=>{
 const bad=record(2200000,horn(true));bad[20]^=1;
 for(const p of parsers([record(2000000,horn(true)),bad]))assert.equal(p.getTelemetryAtTime(2.2,0).hornPressed,false);
});
test('HUD swaps only loaded horn image while keeping both wheel transforms synchronized and original fallback',()=>{
 const normal={style:{}},red={style:{},complete:true,naturalWidth:512};let telem={hornPressed:true,steeringAngleDeg:32};
 const p=Object.create(Player.prototype);Object.assign(p,{parser:{getTelemetryAtTime:()=>telem},currentTime:0,manifest:{},hud:{wheelFace:normal,wheelHorn:red,wheelAngleVal:{}}});
 p._updateTelemetryHud();assert.equal(normal.style.visibility,'hidden');assert.equal(red.style.visibility,'visible');assert.equal(normal.style.transform,'rotate(-32deg)');assert.equal(red.style.transform,'rotate(-32deg)');
 telem={hornPressed:false,steeringAngleDeg:-18};p._updateTelemetryHud();assert.equal(normal.style.visibility,'visible');assert.equal(red.style.visibility,'hidden');assert.equal(red.style.transform,'rotate(18deg)');
 telem.hornPressed=true;red.naturalWidth=0;p._updateTelemetryHud();assert.equal(normal.style.visibility,'visible');assert.equal(red.style.visibility,'hidden');
});
test('export selects horn at each timestamp without changing wheel draw size, pivot or rotation',()=>{
 const normal={complete:true,naturalWidth:512},red={complete:true,naturalWidth:512};ClipExporter.assets.wheel=normal;ClipExporter.assets.wheelHorn=red;
 const e=new ClipExporter({});const render=(pressed)=>{const calls=[];const ctx=new Proxy({measureText:()=>({width:0}),drawImage:(...a)=>calls.push(['draw',...a]),rotate:a=>calls.push(['rotate',a]),translate:(...a)=>calls.push(['translate',...a])},{get:(o,k)=>k in o?o[k]:()=>{}});e._drawTelemetryOverlay(ctx,1280,960,80,{hornPressed:pressed,steeringAngleDeg:25},'mph',0,{blinkers:false,speed:false,speedLimit:false,brake:false,gas:false,time:false},null);return calls;};
 const pressed=render(true),released=render(false);assert.equal(pressed.find(c=>c[0]==='draw')[1],red);assert.equal(released.find(c=>c[0]==='draw')[1],normal);assert.deepEqual(pressed.find(c=>c[0]==='draw').slice(2),[-24,-24,48,48]);assert.deepEqual(pressed.filter(c=>c[0]!=='draw'),released.filter(c=>c[0]!=='draw'));
 red.naturalWidth=0;assert.equal(render(true).find(c=>c[0]==='draw')[1],normal);
});
test('export waits for both wheel images to load and decode before preparing frames; failed horn keeps normal available',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),images=[];
 class BrowserImage {constructor(){this.listeners={};this.complete=false;this.naturalWidth=0;images.push(this);}addEventListener(name,fn){this.listeners[name]=fn;}removeEventListener(name){delete this.listeners[name];}decode(){return Promise.resolve();}finish(ok){this.complete=true;this.naturalWidth=ok?512:0;this.listeners[ok?'load':'error']?.();}}
 const box={Image:BrowserImage,setTimeout,clearTimeout,Promise,module:{exports:{}}};vm.runInNewContext(fs.readFileSync(require.resolve('../exporter'),'utf8'),box);
 const Exporter=box.module.exports.ClipExporter,e=new Exporter({manifest:{id:'clip'}});let ready=false;const preparing=e._prepareRecording(()=>{}).then(()=>{ready=true;});
 await Promise.resolve();assert.equal(ready,false,'a not-yet-loaded horn wheel must not silently disappear from initial export frames');
 images.find(i=>i.src==='assets/wheel-face.png').finish(true);await Promise.resolve();assert.equal(ready,false);
 images.find(i=>i.src==='assets/wheel-horn.png').finish(false);await preparing;assert.equal(ready,true);assert.equal(Exporter.assets.wheel.naturalWidth,512);assert.equal(Exporter.assets.wheelHorn,null);
});
test('CRC failures in telemetry cannot resurrect a press; release and unavailable override nearby snapshots',()=>{
 const field={value:true,atUs:2000000,ageUs:0,valid:true,sourceValid:true,latched:false};
 const bad=record(2200000,{type:'telemetry',fields:{horn:{...field,atUs:2200000}}});bad[20]^=1;
 for(const p of parsers([record(2000000,{type:'telemetry',fields:{horn:field}}),record(2100000,horn(false)),bad,record(2300000,horn(true))])){
  assert.equal(p.getTelemetryAtTime(2,0).hornPressed,true);assert.equal(p.getTelemetryAtTime(2.1,0).hornPressed,false);assert.equal(p.getTelemetryAtTime(2.2,0).hornPressed,false);assert.equal(p.getTelemetryAtTime(2.3,0).hornPressed,true);
 }
});
