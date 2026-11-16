'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const signs=require('../traffic-signs');
function sample(type=20,value=0){return {eventDataQualifier:0,extendedQualifier:0,trafficSignRecognition:{numberSigns:1,speedLimitUnit:2,visibilityCondition:0},trafficSign:[{type,value,additionalInfo:1,location:{locationInvalidFlags:0,x:20,y:-5,z:2.5},position:{right:1},firstSupplementalType:255,secondSupplementalType:255}],trafficSignRecognitionQuality:[{qualityType:100,qualityValue:120}]};}
test('sign classification uses OEM types and does not infer stop from supplemental type or traffic-light warning',()=>{
 assert.equal(signs.normalize(sample(20),1).signs[0].kind,'stop');assert.equal(signs.normalize(sample(21),1).signs[0].kind,'yield');
 assert.equal(signs.normalize(sample(12),1).signs[0].kind,'no-entry');assert.equal(signs.normalize(sample(42),1).signs[0].kind,'traffic-light-warning');
 const v=sample(60);v.trafficSign[0].firstSupplementalType=20;assert.equal(signs.normalize(v,1).signs.length,0);
});
test('camera speed limits carry their recorded unit; ambiguous values are excluded',()=>{
 const v=sample(5,50);assert.deepEqual(signs.normalize(v,1).signs[0].unit,'mph');v.trafficSignRecognition.speedLimitUnit=1;assert.equal(signs.normalize(v,1).signs[0].unit,'km/h');
 v.trafficSign[0].additionalInfo=2;assert.equal(signs.normalize(v,1).signs.length,0);v.trafficSign[0].additionalInfo=1;v.trafficSignRecognition.speedLimitUnit=255;assert.equal(signs.normalize(v,1).signs.length,0);
});
test('invalid camera qualifiers clear signs and invalid coordinates do not create road objects',()=>{
 for(const edit of [v=>v.eventDataQualifier=255,v=>v.extendedQualifier=3,v=>v.trafficSignRecognition.visibilityCondition=3,v=>v.trafficSignRecognition.numberSigns=21]){const v=sample();edit(v);assert.deepEqual(signs.normalize(v,1).signs,[]);}
 const v=sample();v.trafficSign[0].location.locationInvalidFlags=1;assert.equal(signs.normalize(v,1).signs[0].position,null);
 v.trafficSign[0].relevance=8;assert.equal(signs.normalize(v,1).signs.length,0);v.trafficSign[0].relevance=65535;assert.equal(signs.normalize(v,1).signs.length,0);
});
test('sign lookup is playback-time based, respects clears and expires instead of borrowing future data',()=>{
 const data={signs:[{t:4,signs:signs.normalize(sample(),0).signs},{t:6,signs:[]}],speedLimits:[{t:1,limit:45,unit:'mph'},{t:3,limit:null,unit:null}],frames:[]};
 assert.equal(signs.at(data,3.99).camera.length,0);assert.equal(signs.at(data,4).camera[0].kind,'stop');assert.equal(signs.at(data,6).camera.length,0);assert.equal(signs.at(data,5).camera.length,1);assert.equal(signs.at(data,7).camera.length,0);
 assert.equal(signs.at(data,1).limit.value,45);assert.equal(signs.at(data,3).limit,null);assert.equal(signs.at(data,0).limit,null);
});
test('positioned signs approach with recorded ego speed and never move ahead of the source sample',()=>{
 const data={signs:[{t:1,signs:signs.normalize(sample(),0).signs}],frames:Array.from({length:31},(_,i)=>({t:i/10,v:22.3693629205}))};
 assert(Math.abs(signs.at(data,2).camera[0].position.x-10)<.01);assert.equal(signs.at(data,.9).camera.length,0);assert.equal(signs.at(data,3.6).camera.length,0);
 assert.equal(signs.at({...data,frames:[]},2).camera[0].position,null);
});
test('both BVR parsers enforce sign source/schema/CRC and preserve invalid clears across chunk boundaries',()=>{
 const {BvrParser,StreamingBvrParser}=require('../bvr-parser'),A=require('./fixtures/bvr');
 const fields=names=>names.map(name=>({name,dataRef:'UInt8'}));
 for(const [source,signal,serviceId,eventId] of [['de.bmw.environmentalmodel.SignRecognitionFrontCamera','TrafficSignRecognitionFrontCamera',53258,32769],['de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy','recognitionTrafficSignCamera2',54580,32770]]){
  const definition={schemaVersion:1,datatypes:{Recognition:{type:'struct',members:fields(['numberSigns','speedLimitUnit','visibilityCondition'])},Location:{type:'struct',members:[...fields(['locationInvalidFlags']),...['x','y','z'].map(name=>({name,dataRef:'Float'}))]},Sign:{type:'struct',members:[...fields(['type','value','additionalInfo']),{name:'location',dataRef:'Location'}]},Quality:{type:'struct',members:fields(['qualityType','qualityValue'])}},interfaces:{[source]:{events:{[signal]:{eventId,outputs:[...fields(['eventDataQualifier','extendedQualifier']),{name:'trafficSignRecognition',dataRef:'Recognition'},{name:'trafficSign',dataRef:'Sign',dimension:1,arrayLengthWidth:0,arrayMinLength:1,arrayMaxLength:1},{name:'trafficSignRecognitionQuality',dataRef:'Quality',dimension:1,arrayLengthWidth:0,arrayMinLength:1,arrayMaxLength:1}]}}}}};
  const bytes=Buffer.alloc(23);[0,0,1,2,0,20,0,1,0].forEach((v,i)=>bytes[i]=v);bytes.writeFloatBE(20,9);bytes.writeFloatBE(-5,13);bytes.writeFloatBE(2.5,17);bytes[21]=100;bytes[22]=120;
  const event={type:'perception',schemaVersion:1,instanceId:1,majorVersion:1,source,signal,serviceId,eventId,payloadEncoding:'base64',payload:bytes.toString('base64')};
  const record=(t,e)=>A.record(2,t,Buffer.from(JSON.stringify(e))),bad=record(3000000,event);bad[20]^=1;
  const archive=Buffer.concat([A.header(),record(1,{type:'perception-schema',definition}),record(2000000,event),bad,record(4000000,{...event,source:'untrusted'})]);
  const full=new BvrParser(archive.buffer.slice(archive.byteOffset,archive.byteOffset+archive.byteLength));full.parse();const streamed=new StreamingBvrParser({});for(let i=0;i<archive.length;i+=19)streamed.append(archive.subarray(i,i+19));
  const a=full.perception.finish([],0,5,[]),b=streamed.perception.finish([],0,5,[]);assert.deepEqual(a.signs,b.signs);assert.equal(a.signs.length,2);assert.equal(a.signs[0].signs[0].kind,'stop');assert.deepEqual(a.signs[1].signs,[]);assert(signs.hasData(a));
 }
});
test('sign recognition clears and labels correctly across seeks even without traffic/lane metadata',async()=>{
 const {BVDrivingView}=require('../driving-view'),nodes={},attrs={};
 const ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 const panel={dataset:{},querySelector(s){return nodes[s]||=(s==='.driving-signs'?{hidden:true,getContext:()=>ctx,setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k]}:{textContent:'',addEventListener(){}});}};
 const view=new BVDrivingView(panel,async()=>({createDrivingScene:async()=>({setView(){},setTime(){return null;},dispose(){}})}));
 await view.load({telemetryRecords:[],speedLimitEvents:[],perception:{finish:()=>({frames:[],gps:[],signs:[{t:1,signs:signs.normalize(sample(),0).signs}]})}},{startMonotonicUs:0});
 assert.equal(panel.dataset.state,'ready');view.setTime(1);assert.equal(view.signCanvas.hidden,false);assert.equal(attrs['aria-label'],'Stop');view.setTime(4);assert.equal(view.signCanvas.hidden,true);view.setTime(1);assert.equal(attrs['aria-label'],'Stop');view.reset();assert.equal(view.signCanvas.hidden,true);
});
test('driving export draws signs at its own timestamp without changing live playback',async()=>{
 const {BVDrivingView}=require('../driving-view'),nodes={},texts=[];
 const doc={body:{append(){}},createElement:()=>({style:{},setAttribute(){},remove(){}})};
 const panel={dataset:{},ownerDocument:doc,querySelector(s){return nodes[s]||={textContent:'',addEventListener(){}};}};
 const view=new BVDrivingView(panel,async()=>({createDrivingScene:async()=>({canvas:{},setSize(){},setTime(){return null;},dispose(){}})}));
 view.data={frames:[],gps:[],signs:[{t:1,signs:signs.normalize(sample(),0).signs}]};view.time=42;
 const ctx=new Proxy({fillText:text=>texts.push(text)},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)}),renderer=await view.createExportRenderer();
 renderer.drawTo(ctx,0,0,640,480,1);assert(texts.includes('STOP'));texts.length=0;renderer.drawTo(ctx,0,0,640,480,4);assert(!texts.includes('STOP'));assert.equal(view.time,42);renderer.dispose();
});
