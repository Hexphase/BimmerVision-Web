'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decodePerception,BVPerceptionCapture,frameAt,perceptionFrameIndex,inferReplayTurns}=require('../perception-data');
const {classifyVehicleMotion}=require('../vehicle-motion');
const schema={datatypes:{Pair:{type:'struct',members:[{name:'x',dataRef:'Float'},{name:'y',dataRef:'Float'}]}},interfaces:{sample:{events:{Point:{eventId:1,outputs:[{name:'p',dataRef:'Pair'}]}}}}};
test('embedded schema decoder reads big endian and requires exact bounded payload',()=>{
 const bytes=Buffer.alloc(8);bytes.writeFloatBE(12.5);bytes.writeFloatBE(-3.25,4);
 assert.deepEqual(decodePerception(schema,'sample','Point',bytes),{p:{x:12.5,y:-3.25}});
 assert.throws(()=>decodePerception(schema,'sample','Point',bytes.subarray(0,7)));
 assert.throws(()=>decodePerception(schema,'sample','Point',Buffer.alloc(9)));
 const bad=structuredClone(schema);bad.datatypes.Pair.members[0].dimension=1;bad.datatypes.Pair.members[0].arrayMinLength=bad.datatypes.Pair.members[0].arrayMaxLength=10000000;
 assert.throws(()=>decodePerception(bad,'sample','Point',bytes));
});
test('object joins require identical source timestamps and counts even when events arrive out of order',()=>{
 const c=new BVPerceptionCapture(),timestamp={seconds:1,nanoseconds:2};
 const rec={timestamp,eventDataQualifier:0,numberOfObjects:1,objectRecognitionInfo:[{objectID:7,statusMeasurement:0,classificationType:3,drivingTubeMapping:1,statusMovement:5,referencePoint:5}]};
 const pos={timestamp,eventDataQualifier:0,numberOfObjects:1,objectPositionInfo:[{positionX:20,positionY:-3,objectPositionInfoInvalidFlags:0}],objectDimensionInfo:[]};
 c.accept('ObjectPosition',pos,1000000);c.accept('ObjectRecognition',rec,1000010);
 c.accept('ObjectMovement',{timestamp,eventDataQualifier:0,numberOfObjects:1,objectMovementInfo:[{objectMovementInfoInvalidFlags:224,speedAbsoluteX:9,speedAbsoluteY:0,yawAngle:0}]},1000020);
 let data=c.finish([],1000000,3,[]);assert.equal(data.frames[0].o[0][11],9);
 const wrong=new BVPerceptionCapture();wrong.accept('ObjectPosition',{...pos,timestamp:{seconds:1,nanoseconds:3}},1000000);wrong.accept('ObjectRecognition',rec,1000010);
 assert.equal(wrong.finish([],1000000,3,[]).frames[0].o.length,0);
 const invalid=new BVPerceptionCapture();invalid.accept('ObjectPosition',{...pos,objectPositionInfo:[{...pos.objectPositionInfo[0],objectPositionInfoInvalidFlags:1}]},1000000);invalid.accept('ObjectRecognition',rec,1000010);
 assert.equal(invalid.finish([],1000000,3,[]).frames[0].o.length,0);
});
test('direction uses ground motion, not closing distance when passing slower cars',()=>{
 assert.equal(classifyVehicleMotion([1,15,3,3,1,5,null,5,4,2,1.5,5,0,0],40).direction,'same');
 assert.equal(classifyVehicleMotion([1,15,3,3,1,4,null,5,4,2,1.5,-15,0,3.14],40).direction,'oncoming');
 assert.equal(classifyVehicleMotion([1,15,3,3,1,0],40).known,false);
});
test('frame lookup cannot borrow future observations or hold stale traffic across gaps',()=>{
 const frames=[{t:1,o:[[1,10,0]],b:[]},{t:2,o:[[2,20,0]],b:[]}];
 assert.equal(frameAt(frames,.9),null);assert.equal(frameAt(frames,1.1).o[0][0],1);assert.equal(frameAt(frames,1.8),null);assert.equal(frameAt(frames,2).o[0][0],2);assert.equal(frameAt(frames,1).o[0][0],1);
});
test('both BVR parsers decode CRC checked perception across arbitrary chunk boundaries',()=>{
 const A=require('./fixtures/bvr'),{BvrParser,StreamingBvrParser}=require('../bvr-parser');
 const side={type:'struct',members:[{name:'invalid_flags',dataRef:'UInt8'},{name:'lane_existence_probability',dataRef:'Float'},{name:'lane_type_existence_probability',dataRef:'Float'},{name:'laneType',dataRef:'UInt8'}]};
 const source='de.bmw.environmentalmodel.Lanes',definition={schemaVersion:1,datatypes:{Side:side},interfaces:{[source]:{events:{LanesDetection:{eventId:32769,outputs:[{name:'eventDataQualifier',dataRef:'UInt8'},{name:'laneLeft',dataRef:'Side'},{name:'laneRight',dataRef:'Side'}]}}}}};
 const bytes=Buffer.alloc(21);for(const offset of [1,11]){bytes[offset]=0;bytes.writeFloatBE(.9,offset+1);bytes.writeFloatBE(.9,offset+5);bytes[offset+9]=4;}
 const event={type:'perception',schemaVersion:1,instanceId:1,majorVersion:1,serviceId:53252,eventId:32769,source,signal:'LanesDetection',payloadEncoding:'base64',payload:bytes.toString('base64')};
 const record=(t,e)=>A.record(2,t,Buffer.from(JSON.stringify(e))),bad=record(3,event);bad[20]^=1;
 const b=Buffer.concat([A.header(),record(1,{type:'perception-schema',definition}),record(2,event),bad,record(4,{...event,serviceId:61753})]);
 const p=new BvrParser(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));p.parse();const s=new StreamingBvrParser({});for(let i=0;i<b.length;i+=17)s.append(b.subarray(i,i+17));
 for(const parser of [p,s]){assert.equal(parser.perception.detected.length,1);assert.equal(parser.perception.detected[0].rightLane,'present');assert.equal(parser.perception.rejected,1);}
});
test('stale or invalid telemetry cannot paint blinkers or reconstruct a GPS road',()=>{
 const c=new BVPerceptionCapture();c.accept('LaneBoundaries',{eventDataQualifier:0,laneBoundaryFront:[],laneRecognitionFront:{}},1000000);
 const field={value:32,valid:true,sourceValid:false,atUs:1000000,ageUs:0};
 const data=c.finish([{atUs:1000000,fields:{latitude:field,longitude:field,blinker:{...field,value:'right'},speed:field}}],1000000,1,[]);
 assert.equal(data.gps.length,0);assert.equal(data.frames[0].indicator,'unknown');assert.equal(data.frames[0].v,null);
});
test('a valid latched turn signal persists until its recorded release',()=>{
 const c=new BVPerceptionCapture();c.accept('LaneBoundaries',{eventDataQualifier:0,laneBoundaryFront:[],laneRecognitionFront:{}},10000000);
 const blinker={value:'right',valid:true,sourceValid:true,latched:true,atUs:1000000,ageUs:9000000};
 assert.equal(c.finish([{atUs:10000000,fields:{blinker}}],0,20,[]).frames[0].indicator,'right');
});
test('merging a newer lane sample cannot extend an older traffic observation',()=>{
 const c=new BVPerceptionCapture();c.objects=[{atUs:0,o:[[7,20,0]]}];c.lanes=[{atUs:300000,b:[[0]],w:3.5}];
 const data=c.finish([],0,1,[]);
 assert.equal(frameAt(data.frames,.34).o.length,1);assert.equal(frameAt(data.frames,.64).o.length,0);
});
test('interpolation locates the next snapshot after expiry creates a filtered frame copy',()=>{
 const frames=[{t:1,objectT:1,laneT:0,o:[[1,30,0]],b:[[0]]},{t:1.1,o:[[1,29,0]],b:[]}];
 const f=frameAt(frames,1.05);assert.notEqual(f,frames[0]);assert.equal(f.b.length,0);
 assert.equal(frames[perceptionFrameIndex(frames,f.t)+1],frames[1]);assert.equal(perceptionFrameIndex(frames,.5),-1);
});
test('metadata limits fail explicitly instead of dropping route history or flickering',()=>{
 const c=new BVPerceptionCapture();
 for(let i=0;i<12001;i++)c._push(c.objects,{atUs:i*100000,o:[]});
 const data=c.finish([],0,2000,[]);assert.equal(data.limited,true);assert.equal(data.frames.length,0);assert(c.objects.length<=12000);assert.equal(c.intervalUs,100000);
});
test('turn reconstruction requires matching GPS course, speed, steering and indicator evidence',()=>{
 const gps=[],frames=[];
 for(let t=0;t<=24;t+=.1){gps.push([t,t>12?(t-12)*10:0,Math.min(t,12)*10]);frames.push({t,v:20,steering:t>=10&&t<=14?65:0,indicator:t>=9&&t<=14?'right':'off'});}
 const turns=inferReplayTurns(frames,gps,[]);assert.equal(turns.length,1);assert.equal(turns[0].side,'right');
 assert.equal(inferReplayTurns(frames.map(f=>({...f,steering:0})),gps,[]).length,0);
 assert.equal(inferReplayTurns(frames,gps.map(p=>[p[0],0,p[0]*10]),[]).length,0);
});
