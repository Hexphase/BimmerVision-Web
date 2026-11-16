const PerceptionSigns=typeof BVTrafficSigns!=='undefined'?BVTrafficSigns:(typeof module!=='undefined'&&module.exports?require('./traffic-signs'):null);
/* Recording-only perception. No execution of schema code, network inference or
   joins based on closing speed. Source timestamps keep aligned sensor arrays safe. */
function decodePerception(schema, source, signal, bytes) {
  if (!bytes || bytes.length > 65536) throw Error('Unsupported sensor payload');
  const iface=schema?.interfaces?.[source], node=iface?.events?.[signal] || iface?.fields?.[signal];
  if (!node) throw Error('Unknown sensor schema');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const primitives={UInt8:['getUint8',1],Int8:['getInt8',1],Bool:['getUint8',1],UInt16:['getUint16',2],Int16:['getInt16',2],UInt32:['getUint32',4],Int32:['getInt32',4],Float:['getFloat32',4],Double:['getFloat64',8]};
  let offset=0,budget=20000;
  function read(n,depth=0) {
    if (--budget<0 || depth>24 || !n) throw Error('Schema limit');
    if(typeof n==='string') n={dataRef:n};
    if(n.bitWidth!=null) throw Error('Packed schema is unsupported');
    if(n.dimension) {
      const count=n.arrayMinLength;
      if(n.dimension!==1 || n.arrayLengthWidth!==0 || count!==n.arrayMaxLength || !Number.isInteger(count) || count<0 || count>64) throw Error('Unsupported sensor array');
      return Array.from({length:count},()=>read(n.dataRef,depth+1));
    }
    const p=primitives[n.dataRef];
    if(p) {const value=view[p[0]](offset,false);offset+=p[1];return value;}
    if(n.dataRef) return read(schema.datatypes?.[n.dataRef],depth+1);
    if(n.type==='enum') {
      const p={1:'getUint8',2:'getUint16',4:'getUint32'}[n.enumWidth];
      if(!p) throw Error('Unsupported enum');
      const value=view[p](offset,false);offset+=n.enumWidth;return value;
    }
    const members=n.outputs || (n.type==='struct' && n.members);
    if(!Array.isArray(members) || members.length>128) throw Error('Unsupported schema node');
    return Object.fromEntries(members.map(m=>[m.name,read(m,depth+1)]));
  }
  const value=read(node);
  if(offset!==bytes.length) throw Error('Sensor payload size mismatch');
  return value;
}

function perceptionCRC(bytes) {
  let crc=0xffffffff;
  for(const b of bytes) {crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function perceptionLatest(rows,t) {
  let lo=0,hi=rows.length-1,best=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].atUs<=t){best=m;lo=m+1;}else hi=m-1;}
  return rows[best] || null;
}
function perceptionFrameIndex(frames,t) {
  let lo=0,hi=frames.length-1,best=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(frames[m].t<=t){best=m;lo=m+1;}else hi=m-1;}
  return best;
}
function frameAt(frames,t) {
  // Binary search on relative seconds, independent of a recording's monotonic epoch.
  const f=frames[perceptionFrameIndex(frames,t)];if(!f || t-f.t>.35)return null;
  const objectsStale=t-(f.objectT??f.t)>.35,lanesStale=t-(f.laneT??f.t)>.35,leadStale=t-(f.leadT??f.t)>.35;
  return objectsStale||lanesStale||leadStale?{...f,o:objectsStale?[]:f.o,b:lanesStale?[]:f.b,w:lanesStale?null:f.w,lead:leadStale?null:f.lead}:f;
}

// Retrospective turn reconstruction needs sustained steering, a signal, low
// speed AND a matching change in GPS course. A blinker alone is not a turn.
function inferReplayTurns(frames,gps,changes) {
  if(gps.length<4)return [];
  function point(t) {let lo=0,hi=gps.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(gps[m][0]<=t)lo=m;else hi=m-1;}return gps[lo];}
  function course(t0,t1) {if(t0<gps[0][0]||t1>gps.at(-1)[0])return null;const a=point(t0),b=point(t1);return Math.hypot(b[1]-a[1],b[2]-a[2])>=12?Math.atan2(b[1]-a[1],b[2]-a[2]):null;}
  const groups=[];let group=[];
  for(const f of frames) {
    const candidate=Number.isFinite(f.v)&&f.v<=35&&Math.abs(f.steering)>=35&&['left','right'].includes(f.indicator);
    if(candidate&&(!group.length||(f.t-group.at(-1).t<.5&&f.indicator===group[0].indicator)))group.push(f);
    else {if(group.length)groups.push(group);group=candidate?[f]:[];}
  }
  if(group.length)groups.push(group);
  const turns=[];
  for(const g of groups) {
    const start=g[0].t,end=g.at(-1).t,side=g[0].indicator;if(end-start<.6)continue;
    const before=course(start-4,start-1),after=course(end+1,end+4);if(before===null||after===null)continue;
    const delta=Math.atan2(Math.sin(after-before),Math.cos(after-before))*180/Math.PI;
    if(Math.abs(delta)<45||Math.abs(delta)>150||(delta>0?'right':'left')!==side)continue;
    let planStart=start;for(let i=frames.indexOf(g[0])-1;i>=0;i--){if(frames[i].indicator!==side||start-frames[i].t>12)break;planStart=frames[i].t;}
    for(const e of changes)if(e.side===side&&e.at>=planStart&&e.at<start)planStart=Math.max(planStart,e.end);
    turns.push({kind:'turn',side,start,end,at:(start+end)/2,planStart,evidence:'GPS course + sustained steering + signal'});
  }
  return turns;
}

class BVPerceptionCapture {
  constructor() {this.schema=null;this.telemetry=[];this.hasSourceEvents=false;this.pending=new Map();this.objects=[];this.lanes=[];this.detected=[];this.front=[];this.gaps=[];this.changes=[];this.signs=[];this.intervalUs=100000;this.lastObjectUs=-Infinity;this.rejected=0;}
  addEvent(event,atUs,payload,crc) {
    if(this.limited)return;
    const spec={53258:['de.bmw.environmentalmodel.SignRecognitionFrontCamera',1,{TrafficSignRecognitionFrontCamera:32769}],54580:['de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy',1,{recognitionTrafficSignCamera2:32770}],13625:['de.bmw.dass.GapVehicleAhead',1,{GapVehicleDrivingAhead:32769,DataFrontVehicle:32770}],61753:['de.bmw.environmentalmodel.ObjectRecognitionFrontCamera2',2,{ObjectRecognition:32769,ObjectPosition:32770,ObjectMovement:32771,ObjectProbability:32775}],53284:['de.bmw.environmentalmodel.LaneBoundaries',1,{LaneBoundaries:32771}],53252:['de.bmw.environmentalmodel.Lanes',1,{LanesDetection:32769,LaneChange:32770}]};
    this.hasSourceEvents=true;
    if(event.type==='telemetry'){if(perceptionCRC(payload)===crc && event.fields)this._push(this.telemetry,{atUs,fields:event.fields});return;}
    const isSchema=event.type==='perception-schema';
    const s=spec[event.serviceId];
    if(!isSchema && !(event.type==='perception' && event.schemaVersion===1 && event.instanceId===1 && s && event.source===s[0] && event.majorVersion===s[1] && event.eventId===s[2][event.signal]))return;
    const signSignal=['TrafficSignRecognitionFrontCamera','recognitionTrafficSignCamera2'].includes(event.signal);
    if(perceptionCRC(payload)!==crc){this.rejected++;if(signSignal)this._push(this.signs,{atUs,signs:[]});return;}
    if(isSchema) {
      if(event.definition?.schemaVersion===1 && event.definition?.datatypes && event.definition?.interfaces && payload.length<1000000)this.schema=event.definition;
      return;
    }
    if(!this.schema || event.payloadEncoding!=='base64' || typeof event.payload!=='string' || event.payload.length>90000){if(signSignal)this._push(this.signs,{atUs,signs:[]});return;}
    try {
      const node=this.schema.interfaces?.[event.source]?.events?.[event.signal] || this.schema.interfaces?.[event.source]?.fields?.[event.signal];
      if(node?.eventId!==event.eventId && node?.notifier?.id!==event.eventId)return;
      const bytes=Uint8Array.from(atob(event.payload),c=>c.charCodeAt(0));
      this.accept(event.signal,decodePerception(this.schema,event.source,event.signal,bytes),atUs);
    } catch(e) {this.rejected++;if(signSignal)this._push(this.signs,{atUs,signs:[]});}
  }
  _push(rows,value) {
    if(rows.length>=12000){this.limited=true;return;}
    rows.push(value);
  }
  accept(signal,v,atUs) {
    if(this.limited || !Number.isFinite(atUs))return;
    if(['TrafficSignRecognitionFrontCamera','recognitionTrafficSignCamera2'].includes(signal)){this._push(this.signs,PerceptionSigns.normalize(v,atUs));return;}
    if(signal.startsWith('Object')) {
      const stamp=v.timestamp;
      if(!stamp || !Number.isInteger(stamp.seconds) || !Number.isInteger(stamp.nanoseconds) || stamp.nanoseconds<0 || stamp.nanoseconds>=1e9 || !Number.isInteger(v.numberOfObjects) || v.numberOfObjects<0 || v.numberOfObjects>20)return;
      const key=stamp.seconds+':'+stamp.nanoseconds;
      let g=this.pending.get(key);if(!g){g={};this.pending.set(key,g);}
      g[signal]={v,atUs};
      while(this.pending.size>32){const first=this.pending.keys().next().value;this._flush(this.pending.get(first));this.pending.delete(first);}
    } else if(signal==='LaneBoundaries') {
      if(atUs-(this.lanes.at(-1)?.atUs??-Infinity)<this.intervalUs)return;
      const b=[],valid=[0,1].includes(v.eventDataQualifier),lr=v.laneRecognitionFront;
      if(valid)for(const [i,line] of (v.laneBoundaryFront||[]).entries()) {
        const p=line.pointSegment1,base=line.baseSegment1,par=line.parametersSegment1,prop=v.laneBoundaryPropertiesFront?.[i];
        if(i>3 || ![0,1].includes(line.modelQualifier) || ![0,1,2,3,4,5].includes(line.statusMeasurement) || !p || !base || !par || (p.commonPoint2DInvalidFlags&3) || (base.commonClothoidBaseInvalidFlags&3) || (par.commonClothoidParametersInvalidFlags&3))continue;
        if(![p.x,p.y,base.angle,base.curvature,par.curvatureChange,par.validLength].every(Number.isFinite) || Math.abs(p.y)>25 || Math.abs(base.curvature)>.3 || par.validLength<=0 || par.validLength>300)continue;
        const type=prop?.typeInfo && !(prop.typeInfo.laneBoundaryTypeInfoInvalidFlags&1)?prop.typeInfo.type:0;
        const color=prop && !(prop.laneBoundaryPropertiesInvalidFlags&1)?prop.color:0;
        b.push([i,p.x,p.y,base.angle,base.curvature,par.curvatureChange,par.validLength,type,line.id,color]);
      }
      this._push(this.lanes,{atUs,b,w:valid && lr && !(lr.laneRecognitionInvalidFlags&1) && lr.widthEgoLane>2 && lr.widthEgoLane<7?lr.widthEgoLane:null});
    } else if(signal==='LanesDetection') {
      function side(a){if(![0,1].includes(v.eventDataQualifier)||!a||(a.invalid_flags&1))return 'unknown';if(a.lane_existence_probability<=.2)return 'absent';if((a.invalid_flags&2)||a.lane_type_existence_probability<.5)return 'unknown';return a.lane_existence_probability>=.65&&[2,4].includes(a.laneType)?'present':'unknown';}
      this._push(this.detected,{atUs,leftLane:side(v.laneLeft),rightLane:side(v.laneRight)});
    } else if(signal==='LaneChange') {
      const c=v.laneChangeInfo;
      if([0,1].includes(v.eventDataQualifier)&&c&&!(c.laneChangeInfoStructInvalidFlags&1)&&[1,2].includes(c.laneChange)&&c.existenceProbability>=.8)this._push(this.changes,{atUs,side:c.laneChange===1?'left':'right'});
    } else if(signal==='DataFrontVehicle')this._push(this.front,{atUs,id:[0,1].includes(v.qualifierEventDataFunctionFrontVehicle)&&v.qualifierExtendedFunctionFrontVehicle===0&&v.frontVehicleObjectID<253?v.frontVehicleObjectID:null});
    else if(signal==='GapVehicleDrivingAhead')this._push(this.gaps,{atUs,valid:[1,2,3,4].includes(v.statusMeasurementVehicleDrivingAhead)});
  }
  _flush(g) {
    const rec=g.ObjectRecognition;
    if(!rec || rec.atUs-this.lastObjectUs<this.intervalUs)return;
    this.lastObjectUs=rec.atUs;
    const r=rec.v,p=g.ObjectPosition,m=g.ObjectMovement,q=g.ObjectProbability,o=[];
    const paired=e=>e && e.v.numberOfObjects===r.numberOfObjects && [0,1].includes(e.v.eventDataQualifier) && Math.abs(e.atUs-rec.atUs)<300000;
    if([0,1].includes(r.eventDataQualifier) && paired(p))for(let i=0;i<r.numberOfObjects;i++) {
      const a=r.objectRecognitionInfo?.[i],b=p.v.objectPositionInfo?.[i];
      if(!a || !b || a.objectID===255 || ![0,1,2].includes(a.statusMeasurement) || (b.objectPositionInfoInvalidFlags&3) || ![b.positionX,b.positionY].every(Number.isFinite) || b.positionX< -20 || b.positionX>250 || Math.abs(b.positionY)>30)continue;
      const dim=p.v.objectDimensionInfo?.[i],move=paired(m)?m.v.objectMovementInfo?.[i]:null;
      const dimensions=dim && !(dim.objectDimensionInfoInvalidFlags&7) && dim.length>.4 && dim.length<20 && dim.width>.3 && dim.width<4 && dim.heigth>.3 && dim.heigth<5?[dim.length,dim.width,dim.heigth]:[null,null,null];
      const motion=(field,bit)=>move && !(move.objectMovementInfoInvalidFlags&(1<<bit)) && Number.isFinite(move[field])?move[field]:null;
      const probability=paired(q)?q.v.objectProbabilityInfo?.[i]?.existenceProbability:null;
      o.push([a.objectID,b.positionX,b.positionY,a.classificationType,a.drivingTubeMapping,a.statusMovement,Number.isFinite(probability)&&probability>=0&&probability<=100?probability:null,a.referencePoint,...dimensions,motion('speedAbsoluteX',0),motion('speedAbsoluteY',1),motion('yawAngle',4)]);
    }
    this._push(this.objects,{atUs:rec.atUs,o});
  }
  finish(telemetry,startUs,duration,route) {
    if(this.hasSourceEvents)telemetry=this.telemetry;
    for(const g of this.pending.values())this._flush(g);this.pending.clear();
    if(this.limited)return {duration,frames:[],gps:[],events:[],limited:true};
    for(const rows of [this.objects,this.lanes,this.detected,this.front,this.gaps,this.signs])rows.sort((a,b)=>a.atUs-b.atUs);
    const fresh=(rows,t,age=350000)=>{const p=perceptionLatest(rows,t);return p && t-p.atUs<=age?p:null;};
    const times=[...new Set([...this.objects,...this.lanes].map(x=>x.atUs))].sort((a,b)=>a-b);
    const frames=[];let last=-Infinity;
    for(const atUs of times) {
      if(atUs-last<this.intervalUs*.8)continue;last=atUs;
      const obj=fresh(this.objects,atUs),lane=fresh(this.lanes,atUs),det=fresh(this.detected,atUs),front=fresh(this.front,atUs),gap=fresh(this.gaps,atUs);
      const rec=fresh(telemetry,atUs,2000000),fields=rec?.fields||{};
      const field=(name,age)=>{const f=fields[name];return f?.valid===true && f.sourceValid===true && Number.isFinite(f.atUs) && f.atUs<=atUs && Number.isFinite(f.ageUs) && f.ageUs>=0 && ((name==='blinker' && f.latched===true) || (atUs-f.atUs<=age && f.ageUs<=age))?f.value:null;};
      const speed=field('speed',2000000),steering=field('steeringAngleDeg',500000),blink=field('blinker',2000000);
      frames.push({t:(atUs-startUs)/1e6,objectT:obj?(obj.atUs-startUs)/1e6:null,laneT:lane?(lane.atUs-startUs)/1e6:null,leadT:front&&gap?(Math.min(front.atUs,gap.atUs)-startUs)/1e6:null,o:obj?.o||[],b:lane?.b||[],w:lane?.w||null,v:Number.isFinite(speed)?speed/1.609344:null,steering:Number.isFinite(steering)?steering:0,indicator:['left','right','both','hazard','off'].includes(blink)?blink:'unknown',leftLane:det?.leftLane||'unknown',rightLane:det?.rightLane||'unknown',lead:gap?.valid?front?.id??null:null});
    }
    // ENU coordinates stay local to this recording and are never requested online.
    const validGPS=(f,t)=>f?.valid===true && f.sourceValid===true && Number.isFinite(f.value) && Number.isFinite(f.atUs) && f.atUs<=t && t-f.atUs<=2000000 && Number.isFinite(f.ageUs) && f.ageUs>=0 && f.ageUs<=2000000;
    route=telemetry.filter(r=>validGPS(r.fields?.latitude,r.atUs)&&validGPS(r.fields?.longitude,r.atUs)).map(r=>({at:(r.atUs-startUs)/1e6,latitude:r.fields.latitude.value,longitude:r.fields.longitude.value})).filter(p=>Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&(p.latitude!==0||p.longitude!==0));
    const first=route[0],gps=[];
    if(first)for(const p of route){const lat=p.latitude??p.lat,lon=p.longitude??p.lng??p.lon,lat0=first.latitude??first.lat,lon0=first.longitude??first.lng??first.lon,t=p.at??p.time??p.t;if([lat,lon,lat0,lon0,t].every(Number.isFinite))gps.push([t,(lon-lon0)*Math.PI/180*6371000*Math.cos(lat0*Math.PI/180),(lat-lat0)*Math.PI/180*6371000]);}
    const events=[];
    for(const change of this.changes) {
      const at=(change.atUs-startUs)/1e6;
      if(events.some(e=>e.side===change.side&&Math.abs(e.at-at)<.3))continue;
      let planStart=at;
      for(let i=frames.length-1;i>=0;i--)if(frames[i].t<=at){if(frames[i].indicator!==change.side||at-frames[i].t>8)break;planStart=frames[i].t;}
      events.push({kind:'change',side:change.side,at,planStart,start:Math.max(planStart,at-1.6),end:at+.5,evidence:'Recorded lane change'});
    }
    events.push(...inferReplayTurns(frames,gps,events));events.sort((a,b)=>a.at-b.at);
    return {duration,frames,gps,events,signs:this.signs.map(r=>({t:(r.atUs-startUs)/1e6,signs:r.signs})),rejected:this.rejected};
  }
}
if(typeof module!=='undefined' && module.exports)module.exports={decodePerception,BVPerceptionCapture,frameAt,perceptionFrameIndex,inferReplayTurns};
