/* Absolute ground velocity determines direction; closing range alone never does.
   Render arrays: ...dimensions[8..10], absoluteVX[11], absoluteVY[12], yawRad[13]. */
function classifyVehicleMotion(o,egoMph=null){
 const finite=Number.isFinite,vx=o[11],vy=o[12],yaw=o[13],status=o[5],base={known:false,direction:'unknown',heading:finite(yaw)?yaw:0,source:'unknown',label:'Direction unknown'};
 const vector=finite(vx)&&finite(vy)?Math.atan2(vy,vx):null;
 let direction,heading,source;
 if([1,4,8].includes(status)){direction='oncoming';heading=Math.PI;source='movement status';}
 else if([2,5,9].includes(status)){direction='same';heading=0;source='movement status';}
 else if([3,6,10].includes(status)){direction='crossing';heading=finite(yaw)&&Math.abs(Math.sin(yaw))>.3?yaw:vector;source='movement status';}
 else if(finite(vx)&&Math.abs(vx)>1.5){direction=vx<0?'oncoming':'same';heading=vector??(vx<0?Math.PI:0);source='absolute velocity';}
 else if(finite(vy)&&Math.abs(vy)>1.5){direction='crossing';heading=vector??Math.sign(vy)*Math.PI/2;source='absolute velocity';}
 else return base;
 if(direction!=='crossing'){
  const consistent=a=>finite(a)&&(direction==='oncoming'?Math.cos(a)<-.45:Math.cos(a)>.45);
  if(consistent(yaw))heading=yaw;else if(consistent(vector))heading=vector;
 }
 if(!finite(heading))return {...base,direction:'crossing',source,label:'Crossing · heading unknown'};
 let label=direction==='oncoming'?'Oncoming':direction==='same'?'Same direction':'Crossing';
 if([1,2,3,8,9,10].includes(status))label='Stopped · '+label.toLowerCase();
 if(direction==='same'&&finite(egoMph)&&finite(vx)&&egoMph*.44704-vx>1.2&&Math.abs(o[2])>1.8&&o[1]<45)label+=' · you’re passing';
 return {known:true,direction,heading,source,label};
}
function createVehicleMotion(data){
 const tracks=new Map();
 for(const f of data.frames)for(const o of f.o){
  let a=tracks.get(o[0]);if(!a){a=[];tracks.set(o[0],a);}
  const time=f.objectT??f.t,prev=a.at(-1);
  if(prev?.t===time)continue;
  const segment=!prev?0:prev.segment+(time-prev.t>.7||Math.hypot(o[1]-prev.x,o[2]-prev.y)>Math.max(12,(time-prev.t)*85)?1:0);
  a.push({t:time,x:o[1],y:o[2],segment,...classifyVehicleMotion(o,f.v)});
 }
 function at(t,o,egoMph){
  const raw=classifyVehicleMotion(o,egoMph),a=tracks.get(o[0]);if(!a?.length)return raw;
  let l=0,h=a.length-1;while(l<h){const m=Math.ceil((l+h)/2);if(a[m].t<=t)l=m;else h=m-1;}
  const anchor=a[l];if(Math.abs(t-anchor.t)>.7)return raw;
  const near=a.slice(Math.max(0,l-5),Math.min(a.length,l+6)).filter(p=>p.segment===anchor.segment&&Math.abs(p.t-t)<.3&&p.known);
  let result=raw;
  if(!result.known){const nearest=near.reduce((best,p)=>!best||Math.abs(p.t-t)<Math.abs(best.t-t)?p:best,null);if(nearest&&Math.abs(nearest.t-t)<.2)result={...nearest,source:'track continuity'};}
  if(!result.known)return raw;
  let x=0,y=0;
  for(const p of near)if(p.direction===result.direction){const w=Math.exp(-Math.pow((p.t-t)/.12,2)/2);x+=Math.cos(p.heading)*w;y+=Math.sin(p.heading)*w;}
  return {...result,heading:Math.hypot(x,y)>.05?Math.atan2(y,x):result.heading};
 }
 return {at,tracks};
}
if(typeof module!=='undefined'&&module.exports)module.exports={classifyVehicleMotion,createVehicleMotion};
