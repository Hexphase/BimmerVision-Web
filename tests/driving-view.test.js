const test=require('node:test'),assert=require('node:assert/strict');
const {BVDrivingView}=require('../driving-view');
const {BimmerVisionPlayer}=require('../player');
function panel(){const nodes={};return {dataset:{},querySelector(s){return nodes[s] ||= {textContent:'',hidden:false,addEventListener(){}};}};}
const parser={telemetryRecords:[],perception:{finish:()=>({gps:[],frames:[{t:0,o:[[1,30,0]],b:[],lead:1}]})}};
test('driving panel follows playback time, labels feet, and disposes abandoned scene loads',async()=>{
 let resolve,disposed=0,times=[];
 const p=panel(),view=new BVDrivingView(p,()=>new Promise(r=>{resolve=r;}));
 const pending=view.load(parser,{startMonotonicUs:0});view.setTime(4);view.reset();
 resolve({createDrivingScene:async()=>{throw Error('abandoned load must not construct a scene');}});await pending;assert.equal(p.dataset.state,'empty');
 view.loader=async()=>({createDrivingScene:async()=>({dispose(){disposed++;},setView(){},setTime(t){times.push(t);return {o:[[1,30,0]],b:[],lead:1};}})});
 await view.load(parser,{});view.setTime(8);assert.equal(view.distance.textContent,'98 ft ahead');assert.equal(times.at(-1),8);
 view.setTime(2);assert.equal(times.at(-1),2);view.reset();assert.equal(disposed,1);
});
test('unsupported metadata and WebGL failures are isolated from video',async()=>{
 const view=new BVDrivingView(panel(),async()=>{throw Error('WebGL unavailable');});
 await view.load({telemetryRecords:[]},{});assert.equal(view.panel.dataset.state,'unavailable');
 await view.load(parser,{});assert.equal(view.panel.dataset.state,'unavailable');assert.match(view.message.textContent,/Video playback is still available/);
});
test('player sends seeks and playback HUD ticks to its driving view',()=>{
 const p=Object.create(BimmerVisionPlayer.prototype),times=[];
 Object.assign(p,{parser:{getTelemetryAtTime:()=>({})},hud:{},manifest:{startMonotonicUs:0},currentTime:4,drivingView:{setTime:t=>times.push(t)}});
 p._updateTelemetryHud();p.currentTime=1;p._updateTelemetryHud();assert.deepEqual(times,[4,1]);
});
test('a scene that finishes constructing after a recording switch is immediately disposed',async()=>{
 let complete,disposed=0;
 const view=new BVDrivingView(panel(),async()=>({createDrivingScene:()=>new Promise(r=>{complete=r;})}));
 const pending=view.load(parser,{});await Promise.resolve();await Promise.resolve();view.reset();
 complete({dispose(){disposed++;}});await pending;assert.equal(disposed,1);assert.equal(view.scene,null);assert.equal(view.panel.dataset.state,'empty');
});
test('native metadata reads abort independently when the selected recording changes',async()=>{
 let signal;global.bvFetch=(_url,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Aborted'))));};
 const view=new BVDrivingView(panel()),pending=view.loadSource('/recording/capture.bvr',{});view.reset();await pending;
 assert.equal(signal.aborted,true);assert.equal(view.panel.dataset.state,'empty');delete global.bvFetch;
});

test('camera analysis cannot hold back the KAFAS playback clock',()=>{
  const view=new BVDrivingView(panel()), calls=[];
  const sample={time:6,results:[]};
  view.cameraEnhancement={at:()=>sample};
  view.scene={setTime:(time,overlay)=>{calls.push([time,overlay]);}};
  view.setTime(6.1);
  view.setTime(6.2);
  assert.deepEqual(calls,[[6.1,sample],[6.2,sample]]);
});
