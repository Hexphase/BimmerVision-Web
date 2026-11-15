'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('./fixtures/bvr'),{BvrParser,StreamingBvrParser}=require('../bvr-parser'),{BimmerVisionPlayer:Player}=require('../player');
function event(hex,at,state='observed'){return A.record(2,at,Buffer.from(JSON.stringify({type:'camera-control',schemaVersion:1,source:'ICAM.XView3D',state,currentStateHex:hex})));}
function parsers(bytes){const b=new BvrParser(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));b.parse();const s=new StreamingBvrParser();for(let off=0;off<bytes.length;off+=19)s.append(bytes.subarray(off,off+19));return [b,s];}
test('both parsers resolve recorded camera modes across forward and backward seeks without future inference',()=>{
 const bytes=Buffer.concat([A.header(),event('323207',1000000),event('010000',2000000),event('020600',3000000),event('020500',4000000),event('323207',5000000)]);
 for(const p of parsers(bytes)){
  assert.equal(p.getCameraViewAtTime(.5,1000000).single,false);
  assert.equal(p.getCameraViewAtTime(1,1000000).label,'Parking view');
  assert.equal(p.getCameraViewAtTime(2.5,1000000).label,'Rear wide view');
  assert.equal(p.getCameraViewAtTime(3.5,1000000).label,'Front wide view');
  assert.equal(p.getCameraViewAtTime(4,1000000).single,false);
  assert.equal(p.getCameraViewAtTime(1.5,1000000).label,'Parking view');
  assert.equal(p.getCameraViewAtTime(0,0).label,'Camera view');
 }
});
test('legacy recordings retain the calibrated layout; unavailable or corrupt metadata never invents a camera identity',()=>{
 for(const p of parsers(A.header()))assert.equal(p.getCameraViewAtTime(0,0),null);
 const bad=event('020500',3000000);bad[20]^=1;
 for(const p of parsers(Buffer.concat([A.header(),event('010000',1000000),event('010000',2000000,'unavailable'),bad,event('123207',4000000)]))){
  assert.equal(p.getCameraViewAtTime(2,0).label,'Camera view unavailable');
  assert.equal(p.getCameraViewAtTime(3,0).label,'Camera view unavailable');
  assert.equal(p.getCameraViewAtTime(4,0).label,'Camera view');
 }
});
function playerFixture(){const p=Object.create(Player.prototype),draws=[],labels=[];Object.assign(p,{canvas:{width:1280,height:960},ctx:{fillRect(){},drawImage(...args){draws.push(args);}},manifest:{startMonotonicUs:0},parser:parsers(Buffer.concat([A.header(),event('323207',0),event('020500',1000000),event('323207',2000000)]))[0],accessUnits:[{index:0,atUs:900000,time:.9,phase:1},{index:1,atUs:1100000,time:1.1,phase:0},{index:2,atUs:2100000,time:2.1,phase:1}],decodedFrames:new Map(),cameraMapping:{phase0:'frontRear',flipHalves:true},lastFrFrame:{old:true},lastLrFrame:{old:true},_drawSingleBadge(ctx,label){labels.push(label);},_drawToCanvas(fr,lr){draws.push(['quad',fr,lr]);}});return {p,draws,labels};}
test('takeover playback draws the latest complete raw image once, without half crops or quad labels',()=>{const {p,draws,labels}=playerFixture(),bmp={width:1280,height:480};p.decodedFrames.set(1,bmp);assert.equal(p._renderFrameAtTime(1.2),true);assert.equal(draws.length,1);assert.deepEqual(draws[0],[bmp,0,240,1280,480]);assert.deepEqual(labels,['FRONT WIDE VIEW']);});
test('recovery and backward seeks cannot reuse a frame from the other side of a mode transition',()=>{const {p,draws}=playerFixture();p.decodedFrames.set(1,{width:1280,height:480});p._renderFrameAtTime(1.2);p.decodedFrames.set(2,{normal:true});p._renderFrameAtTime(2.2);assert.equal(draws.at(-1)[0],'quad');assert.equal(draws.at(-1)[1],null);p.decodedFrames.delete(1);const before=draws.length;assert.equal(p._renderFrameAtTime(1.05),true);assert.equal(draws.length,before,'transition placeholder must not draw the old normal frame');});
