const test=require('node:test'),assert=require('node:assert/strict');
const {ClipExporter}=require('../exporter');
function canvas(){const ctx=new Proxy({measureText:()=>({width:0})},{get:(o,k)=>k in o?o[k]:()=>{}});return {width:0,height:0,getContext:()=>ctx};}
test('export splits existing map column into map above and timestamped Driving view below',()=>{
 const calls=[],e=new ClipExporter({}),c=canvas();
 e.renderFrame(c,{overlays:{includeHud:false,map:true,drivingView:true},time:42.87,map:{drawTo:(_c,...a)=>calls.push(['map',...a])},drivingView:{drawTo:(_c,...a)=>calls.push(['driving',...a])}});
 assert.equal(c.width,1920);assert.equal(c.height,960);
 assert.deepEqual(calls,[['map',1280,0,640,480,42.87],['driving',1280,480,640,480,42.87]]);
});
test('Driving view without map occupies the sidebar while existing map-only exports stay unchanged',()=>{
 const e=new ClipExporter({}),calls=[],c=canvas(),drawTo=(_c,...a)=>calls.push(a);
 e.renderFrame(c,{overlays:{includeHud:false,map:false,drivingView:true},time:12,drivingView:{drawTo}});assert.equal(c.width,1920);assert.deepEqual(calls.pop(),[1280,0,640,960,12]);
 e.renderFrame(c,{overlays:{includeHud:false,map:true},time:8,map:{drawTo}});assert.deepEqual(calls.pop(),[1280,0,640,960,8]);
});
test('a requested but unavailable Driving view cannot silently produce an incomplete export',()=>{
 const e=new ClipExporter({});assert.throws(()=>e.renderFrame(canvas(),{overlays:{map:true,drivingView:true},time:0}),/Driving view/);
});
test('export owns and disposes its separate driving renderer even if encoding fails',async()=>{
 let disposed=0;const renderer={dispose(){disposed++;}},player={_clipEpoch:1,drivingView:{createExportRenderer:async()=>renderer}},e=new ClipExporter(player);
 e._prepareRecording=async()=>{};e._exportPrepared=async options=>{assert.equal(options.drivingViewRenderer,renderer);throw Error('encoding failed');};
 await assert.rejects(e.export({overlays:{drivingView:true}}),/encoding failed/);assert.equal(disposed,1);
});
test('changing recordings during export scene construction disposes late results',async()=>{
 let complete,disposed=0;const player={_clipEpoch:1,drivingView:{createExportRenderer:()=>new Promise(r=>{complete=r;})}},e=new ClipExporter(player);e._prepareRecording=async()=>{};
 const pending=e.export({overlays:{drivingView:true}});await Promise.resolve();await Promise.resolve();player._clipEpoch=2;complete({dispose(){disposed++;}});
 await assert.rejects(pending,/recording changed/);assert.equal(disposed,1);
});
test('map export preparation waits for queued tile batches before encoding the first frame',async()=>{
 const {DarkOsmMap}=require('../dark-osm-map');let draws=0;
 const map={canvas:{ownerDocument:{createElement:()=>({getContext:()=>({})})}},pendingTiles:new Set(),drawTo(){draws++;if(draws<=2){this.pendingTiles.add(draws);setTimeout(()=>this.pendingTiles.clear(),1);}}};
 assert.equal(await DarkOsmMap.prototype.prepareForExport.call(map,42,640,480,{timeoutMs:1000}),true);assert.equal(draws,3);assert.equal(map.pendingTiles.size,0);
});
