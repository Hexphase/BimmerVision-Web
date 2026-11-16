/* OEM TrafficSignTypes, shared by playback, road objects and exported overlays. */
(function(root){
'use strict';
const types={1:['no-passing','No passing'],2:['end-no-passing','End of no passing'],3:['end-limit','End of speed limit'],4:['end-restrictions','End of restrictions'],5:['speed-limit','Speed limit'],6:['end-limit','End of speed limit'],7:['end-limit','End of speed limit'],10:['straight','Straight ahead'],11:['roundabout','Roundabout'],12:['no-entry','No entry'],20:['stop','Stop'],21:['yield','Yield'],22:['priority','Priority road'],23:['end-priority','End of priority road'],24:['bend-left','Left bend'],25:['bend-right','Right bend'],28:['narrow-road','Road narrows'],31:['crossroads','Crossroads'],38:['traffic-jam','Traffic queues'],39:['roadworks','Road works'],42:['traffic-light-warning','Traffic lights ahead'],44:['children','Children crossing'],46:['slippery','Slippery road'],49:['pedestrian-crossing','Pedestrian crossing'],50:['bicycle-crossing','Bicycle crossing'],54:['two-way','Two-way traffic'],68:['pedestrian-crossing','Pedestrian crossing']};
function normalize(v,atUs){
 const result={atUs,signs:[]},r=v?.trafficSignRecognition,count=r?.numberSigns;
 if(![0,1].includes(v?.eventDataQualifier)||v.extendedQualifier!==0||![0,1,2].includes(r?.visibilityCondition)||!Number.isInteger(count)||count<0||count>20||!Array.isArray(v.trafficSign)||v.trafficSign.length<count)return result;
 for(let i=0;i<count;i++){
  const s=v.trafficSign[i],type=types[s?.type],q=v.trafficSignRecognitionQuality?.[i];
  if(!type||!q||!Number.isInteger(q.qualityType)||q.qualityType<=0||q.qualityType===255||('relevance'in s&&(!Number.isInteger(s.relevance)||s.relevance<0||s.relevance>=65535||!(s.relevance&1))))continue;
  const [kind,label]=type,unit=r.speedLimitUnit===2?'mph':r.speedLimitUnit===1?'km/h':null;
  if(kind==='speed-limit'&&(!unit||!Number.isInteger(s.value)||s.value<=0||s.value>=255||s.additionalInfo!==1||q.qualityValue===0||q.qualityValue===255))continue;
  const l=s.location,position=l&&Number.isInteger(l.locationInvalidFlags)&&!(l.locationInvalidFlags&3)&&Number.isFinite(l.x)&&Number.isFinite(l.y)&&l.x>=-20&&l.x<=250&&Math.abs(l.y)<=40?{x:l.x,y:l.y,z:!(l.locationInvalidFlags&4)&&Number.isFinite(l.z)&&l.z>=.3&&l.z<=10?l.z:2.5}:null;
  result.signs.push({kind,label,value:kind==='speed-limit'?s.value:null,unit:kind==='speed-limit'?unit:null,position});
 }
 return result;
}
function index(rows,t){let lo=0,hi=rows.length-1,best=-1;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].t<=t){best=m;lo=m+1;}else hi=m-1;}return best;}
function travel(frames,from,to){
 let i=index(frames,from),at=from,distance=0;if(i<0)return null;
 while(at<to){const f=frames[i];if(!Number.isFinite(f.v)||f.v<0||f.v>180||at-f.t>.35)return null;const end=Math.min(to,frames[i+1]?.t??to);if(end-f.t>.35)return null;distance+=(end-at)*f.v*.44704;at=end;if(at<to)i++;}
 return distance;
}
function at(data,t){
 const rows=data.signs||[],row=rows[index(rows,t)],camera=[];
 if(row&&t-row.t<=2.5)for(let i=0;i<row.signs.length;i++){
  const s=row.signs[i],age=t-row.t,move=age<=.1?0:travel(data.frames||[],row.t,t);
  camera.push({...s,key:i+':'+s.kind+':'+s.value+':'+s.unit,age,opacity:Math.min(1,Math.max(0,(2.5-age)/.7)),position:s.position&&move!==null?{...s.position,x:s.position.x-move}:null});
 }
 const limits=data.speedLimits||[],limit=limits[index(limits,t)];
 const current=limit&&t-limit.t<=2.5&&Number.isFinite(limit.limit)&&limit.limit>0&&['mph','km/h'].includes(limit.unit)?{kind:'speed-limit',label:'Speed limit',value:limit.limit,unit:limit.unit,source:'vehicle'}:null;
 const display=current?[current]:[];
 for(const s of camera)if(!display.some(p=>p.kind===s.kind&&p.value===s.value&&p.unit===s.unit))display.push(s);
 return {camera,limit:current,display:display.slice(0,4)};
}
function draw(ctx,sign,x,y,size){
 ctx.save();ctx.translate(x,y);ctx.scale(size/100,size/100);ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=4;ctx.textAlign='center';ctx.textBaseline='middle';
 const polygon=(n,r,cx=50,cy=50,rotation=-Math.PI/2)=>{ctx.beginPath();for(let i=0;i<n;i++){const a=rotation+i*Math.PI*2/n;const px=cx+Math.cos(a)*r,py=cy+Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();};
 const text=(s,px,py,font=24,color='#18202b')=>{ctx.fillStyle=color;ctx.font='600 '+font+'px -apple-system,BlinkMacSystemFont,Arial,sans-serif';ctx.fillText(s,px,py);};
 if(sign.kind==='stop'){
  polygon(8,43,50,50,Math.PI/8);ctx.fillStyle='#d62e3d';ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();text('STOP',50,51,23,'#fff');
 }else if(sign.kind==='yield'){
  polygon(3,47,50,43,Math.PI/2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#da3c49';ctx.lineWidth=9;ctx.stroke();text('YIELD',50,43,14);
 }else if(sign.kind==='speed-limit'&&sign.unit==='mph'){
  ctx.beginPath();ctx.roundRect(16,3,68,94,5);ctx.fillStyle='#f7f8fa';ctx.fill();ctx.strokeStyle='#18202b';ctx.lineWidth=2;ctx.stroke();text('SPEED',50,20,12);text('LIMIT',50,34,12);text(String(sign.value),50,65,36);
 }else if(['speed-limit','no-entry','end-limit','end-restrictions','no-passing','end-no-passing'].includes(sign.kind)){
  ctx.beginPath();ctx.arc(50,50,41,0,Math.PI*2);ctx.fillStyle=sign.kind==='no-entry'?'#d62e3d':'#f7f8fa';ctx.fill();ctx.strokeStyle=sign.kind.startsWith('end')?'#89929d':'#d62e3d';ctx.lineWidth=7;ctx.stroke();
  if(sign.kind==='no-entry'){ctx.fillStyle='#fff';ctx.fillRect(22,43,56,14);}
  else if(sign.kind==='speed-limit')text(String(sign.value),50,52,36);
  else if(sign.kind==='no-passing'){ctx.fillStyle='#d62e3d';ctx.fillRect(25,35,18,31);ctx.fillStyle='#18202b';ctx.fillRect(56,35,18,31);}
  else {ctx.strokeStyle='#444e5c';ctx.lineWidth=4;for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(27+i*9,72+i*3);ctx.lineTo(67+i*9,22+i*3);ctx.stroke();}}
 }else if(['left','right','straight','roundabout'].includes(sign.kind)){
  ctx.beginPath();ctx.arc(50,50,43,0,Math.PI*2);ctx.fillStyle='#2169c8';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=7;
  if(sign.kind==='roundabout'){ctx.beginPath();ctx.arc(50,50,22,-.3,Math.PI*1.5);ctx.stroke();ctx.beginPath();ctx.moveTo(45,20);ctx.lineTo(56,28);ctx.lineTo(44,33);ctx.stroke();}
  else {ctx.save();if(sign.kind==='left'){ctx.translate(50,50);ctx.rotate(-Math.PI/2);ctx.translate(-50,-50);}if(sign.kind==='right'){ctx.translate(50,50);ctx.rotate(Math.PI/2);ctx.translate(-50,-50);}ctx.beginPath();ctx.moveTo(50,75);ctx.lineTo(50,26);ctx.moveTo(34,43);ctx.lineTo(50,26);ctx.lineTo(66,43);ctx.stroke();ctx.restore();}
 }else if(['priority','end-priority'].includes(sign.kind)){
  polygon(4,44);ctx.fillStyle='#f1cf59';ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();if(sign.kind==='end-priority'){ctx.strokeStyle='#243044';ctx.beginPath();ctx.moveTo(18,82);ctx.lineTo(82,18);ctx.stroke();}
 }else {
  polygon(4,45);ctx.fillStyle='#f1cf59';ctx.fill();ctx.strokeStyle='#2b3038';ctx.stroke();
  if(sign.kind==='traffic-light-warning'){ctx.fillStyle='#252c36';ctx.fillRect(37,23,26,54);for(const [py,color] of [[33,'#d62e3d'],[50,'#eab83c'],[67,'#38ac77']]){ctx.beginPath();ctx.arc(50,py,6,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}}
  else {
   ctx.strokeStyle='#202733';ctx.fillStyle='#202733';ctx.lineWidth=4;
   const line=points=>{ctx.beginPath();points.forEach(([px,py],i)=>i?ctx.lineTo(px,py):ctx.moveTo(px,py));ctx.stroke();};
   const person=(cx,cy,scale=1)=>{ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);ctx.beginPath();ctx.arc(0,-17,5,0,Math.PI*2);ctx.fill();line([[0,-10],[-3,7],[-15,22]]);line([[-3,7],[13,21]]);line([[-12,-1],[0,-8],[12,-1]]);ctx.restore();};
   if(sign.kind==='pedestrian-crossing'){person(50,48,.9);for(let i=0;i<3;i++)line([[29+i*15,73],[37+i*15,73]]);}
   else if(sign.kind==='children'){person(39,49,.72);person(62,51,.56);}
   else if(sign.kind==='roadworks'){person(39,46,.8);line([[48,41],[66,67]]);ctx.beginPath();ctx.moveTo(59,72);ctx.lineTo(78,72);ctx.lineTo(72,62);ctx.closePath();ctx.fill();}
   else if(sign.kind==='bicycle-crossing'){for(const px of [31,69]){ctx.beginPath();ctx.arc(px,61,11,0,Math.PI*2);ctx.stroke();}line([[31,61],[44,39],[55,61],[31,61]]);line([[44,39],[64,39],[69,61]]);line([[60,30],[64,39]]);line([[38,33],[49,33]]);}
   else if(sign.kind==='crossroads'){line([[50,23],[50,77]]);line([[27,44],[73,44]]);}
   else if(sign.kind==='narrow-road'){line([[28,76],[37,53],[37,24]]);line([[72,76],[63,53],[63,24]]);}
   else if(sign.kind==='bend-left'||sign.kind==='bend-right'){ctx.save();if(sign.kind==='bend-right'){ctx.translate(100,0);ctx.scale(-1,1);}line([[57,77],[57,50],[43,35],[26,35]]);line([[37,24],[26,35],[37,46]]);ctx.restore();}
   else if(sign.kind==='traffic-jam'){for(const [px,py] of [[50,33],[35,63],[65,63]]){ctx.beginPath();ctx.roundRect(px-9,py-10,18,21,3);ctx.stroke();line([[px-6,py-3],[px+6,py-3]]);}}
   else if(sign.kind==='two-way'){line([[36,74],[36,27]]);line([[27,38],[36,27],[45,38]]);line([[64,27],[64,74]]);line([[55,63],[64,74],[73,63]]);}
   else if(sign.kind==='slippery'){ctx.beginPath();ctx.roundRect(37,25,26,29,4);ctx.stroke();line([[41,59],[34,65],[43,71],[36,78]]);line([[59,59],[52,65],[61,71],[54,78]]);}
   else text('!',50,49,43);
  }
 }
 ctx.restore();
}
function hasData(data){return !!data&&!data.limited&&(data.frames?.some(f=>f.o.length||f.b.length)||data.signs?.some(r=>r.signs.length)||data.speedLimits?.some(r=>r.limit));}
const api={normalize,at,draw,hasData};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BVTrafficSigns=api;
})(typeof globalThis!=='undefined'?globalThis:this);
