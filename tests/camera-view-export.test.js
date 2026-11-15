'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{ClipExporter}=require('../exporter');
function fixture(){const draws=[],labels=[],ctx=new Proxy({drawImage(...a){draws.push(a);},fillText(s){labels.push(s);},measureText(s){return {width:s.length*12};}},{get(o,k){return k in o?o[k]:()=>{};}}),canvas={width:1280,height:960,getContext:()=>ctx},old={width:1280,height:480,id:'old'},raw={width:1280,height:480,id:'raw'},after={width:1280,height:480,id:'after'};
 const player={manifest:{startMonotonicUs:0},cameraMapping:{phase0:'frontRear',flipHalves:true},accessUnits:[{index:0,time:.9,atUs:900000,phase:0},{index:1,time:1.1,atUs:1100000,phase:1},{index:2,time:2.1,atUs:2100000,phase:0}],decodedFrames:new Map([[0,old],[1,raw],[2,after]]),parser:{getRouteSeries(){return [];},getTelemetryAtTime(){return null;},getCameraViewAtTime(t){return t<1?null:t<2?{single:true,label:'Parking view',atUs:1000000}:{single:false,label:null,atUs:2000000};}}};
 return {e:new ClipExporter(player),player,canvas,draws,labels,raw,old,after};}
test('every export selection preserves the complete takeover image with one matching label even with overlays off',()=>{
 for(const view of ['quad','source','front','rear','left','right']){
  const {e,canvas,draws,labels,raw}=fixture();e.renderFrame(canvas,{view,time:1.2,includeHud:false});assert.deepEqual(draws,[[raw,0,240,1280,480]]);assert.deepEqual(labels,['PARKING VIEW']);
 }
});
test('front/rear wide exports use actual mode labels, exclude pre-transition frames and restore the selected layout',()=>{
 for(const label of ['Front wide view','Rear wide view']){const {e,player,canvas,draws,labels,after}=fixture();const original=player.parser.getCameraViewAtTime;player.parser.getCameraViewAtTime=t=>{const v=original(t);return v?.single?{...v,label}:v;};
  e.renderFrame(canvas,{view:'quad',time:1.05,includeHud:false});assert.equal(draws.length,0);assert.deepEqual(labels,[label.toUpperCase()]);
  labels.length=0;e.renderFrame(canvas,{view:'quad',time:2.2,includeHud:false});assert.equal(draws.length,2);assert.equal(draws[0][0],after);assert.equal(draws[1][0],after);assert.deepEqual(labels,['FRONT','REAR','LEFT','RIGHT']);
 }
});
test('export frame selection uses explicit AU phases and never borrows a future frame',()=>{const {e,player,raw}=fixture();const f=e._cameraFramesAt(1.2,player.decodedFrames);assert.equal(f.rawFrame,raw);assert.equal(e._cameraFramesAt(1.05,player.decodedFrames).rawFrame,null);player.accessUnits[1].damaged=true;assert.equal(e._cameraFramesAt(1.2,player.decodedFrames).rawFrame,null);});
test('encoder overlay-off sentinel preserves the intended dimensions and mandatory view label',()=>{const {e,canvas,labels}=fixture();e.renderFrame(canvas,{view:'left',time:1.2,overlays:null});assert.equal(canvas.width,1280);assert.equal(canvas.height,960);assert.deepEqual(labels,['PARKING VIEW']);});
test('a timed-out MediaRecorder source seek cannot overwrite restored playback',async t=>{
 const {BimmerVisionPlayer:Player}=require('../player'),player=Object.create(Player.prototype),canvas={getContext(){return {};},captureStream(){return {getTracks:()=>[]};}};
 const previous={document:global.document,MediaRecorder:global.MediaRecorder};t.after(()=>{global.document=previous.document;global.MediaRecorder=previous.MediaRecorder;});
 global.document={createElement:()=>canvas};global.MediaRecorder=class {constructor(){this.state='inactive';}static isTypeSupported(){return true;}};
 Object.assign(player,{manifest:{id:'test',startMonotonicUs:0},duration:1,currentTime:.8,currentAuIndex:8,_clipEpoch:1,isPlaying:false,accessUnits:[{}],cameraMapping:{},pause(){},seek(time){this.currentTime=time;this.currentAuIndex=this._indexAt(time);},_indexAt:t=>Math.round(t*10),_hasFramesAt:()=>false,_decodeAhead(){},_renderFrameAtTime(){return false;}});
 const e=new ClipExporter(player);e.completionTimeoutMs=1;e._prepareRecording=async()=>{};e.renderFrame=()=>{};
 await assert.rejects(e._exportWithMediaRecorder({includeHud:false}),/Timed out/);
 await new Promise(r=>setTimeout(r,55));assert.equal(player.currentTime,.8);assert.equal(player.currentAuIndex,8,'old seek must stop before resetting decoder target');
});
