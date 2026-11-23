// Local odometry only spans continuous recording data. Accumulating distance
// makes the last few metres of paint available throughout a long stop or seek.
const mpsPerMph=.44704;
function paintAtCar(lines,slot){
  const line=lines.find(l=>l[0]===slot);
  if(!line || ![1,2,3,5,6,7,8].includes(line[7]) || Math.abs(line[1])>2)return null;
  return {y:line[2]-line[1]*Math.tan(line[3]*Math.PI/180),style:line[7],color:line[9],id:line[8]};
}
function estimateSpeed(window){
  const first=window[0],last=window.at(-1);
  if(window.length<4 || last.t-first.t<.65)return null;
  // Fit ego travel + longitudinal gap against time. Averaging over the
  // window also accounts for changes in the recording vehicle's speed.
  let sumT=0,sumD=0,cross=0,squares=0;
  for(const p of window){
    const t=p.t-first.t,d=p.d-first.d;
    sumT+=t;sumD+=d;cross+=t*d;squares+=t*t;
  }
  const n=window.length,slope=(cross-sumT*sumD/n)/(squares-sumT*sumT/n);
  const intercept=(sumD-slope*sumT)/n;
  if(window.some(p=>Math.abs(p.d-first.d-intercept-slope*(p.t-first.t))>1.8))return null;
  return slope>=-1 && slope<90?Math.max(0,slope)/mpsPerMph:null;
}
export function createDrivingHistory(frames){
  const poses=[],trail=[];
  let x=0,y=0,angle=0,s=0,run=0,window=[],lastObjectTime=null,leadKey=null,speed=null;
  for(let i=0;i<frames.length;i++){
    const f=frames[i],prev=frames[i-1],dt=prev?f.t-prev.t:0;
    if(!prev || dt>.35 || dt<=0 || !Number.isFinite(f.v) || !Number.isFinite(prev.v)){
      run++;s=0;x=0;y=0;angle=0;window=[];speed=null;lastObjectTime=null;
    }else{
      const ds=(prev.v+f.v)*.5*mpsPerMph*dt;
      const curvature=Math.tan(((prev.steering??0)+(f.steering??0))/30*Math.PI/180)/2.85;
      const turn=ds*Math.max(-.18,Math.min(.18,curvature));
      x+=ds*Math.cos(angle+turn/2);y+=ds*Math.sin(angle+turn/2);angle+=turn;s+=ds;
    }
    const lead=f.o.find(o=>o[0]===f.lead && o[1]>0 && [3,4,5,6].includes(o[3]) && (o[6]==null||o[6]>=30));
    const key=lead?lead[0]+'/'+lead[7]:null;
    if(!lead || key!==leadKey){window=[];speed=null;lastObjectTime=null;}
    leadKey=key;
    const ot=f.objectT??f.t;
    if(lead && Number.isFinite(f.v) && ot!==lastObjectTime && Math.abs(f.t-ot)<.001){
      const d=s+lead[1],last=window.at(-1);
      if(last && (ot-last.t>.35 || ot<=last.t || Math.abs(d-last.d)>2+70*(ot-last.t)))window=[];
      window.push({t:ot,d});
      while(window.length && ot-window[0].t>1.35)window.shift();
      speed=estimateSpeed(window);lastObjectTime=ot;
    }
    const pose={x,y,angle,s,run,leadSpeed:speed,end:trail.length};
    if(Number.isFinite(f.v)&&(trail.at(-1)?.run!==run || s-trail.at(-1).s>=.45)){
      trail.push({...pose,paint:[0,1].map(slot=>paintAtCar(f.b,slot))});
    }
    pose.end=trail.length;poses.push(pose);
  }
  function at(index){
    const pose=poses[index],segments=[];
    if(!pose)return {segments,leadSpeed:null};
    const cos=Math.cos(pose.angle),sin=Math.sin(pose.angle);
    function point(row,mark){
      const dx=row.x-Math.sin(row.angle)*mark.y-pose.x;
      const dy=row.y+Math.cos(row.angle)*mark.y-pose.y;
      return {x:dx*cos+dy*sin,y:dy*cos-dx*sin};
    }
    let newer={...pose,paint:[0,1].map(slot=>paintAtCar(frames[index].b,slot))};
    for(let i=pose.end-1;i>=0;i--){
      const older=trail[i];
      if(older.run!==pose.run || pose.s-older.s>12)break;
      for(let slot=0;slot<2;slot++){
        const a=older.paint[slot],b=newer.paint[slot];
        if(!a||!b||a.id!==b.id||a.style!==b.style||Math.abs(a.y-b.y)>1 || newer.s-older.s<.01)continue;
        const start=point(older,a),end=point(newer,b);
        if(start.x>.1 || end.x>.1)continue;
        const dashed=[1,3,5,7].includes(a.style),period=a.style===3?2:9;
        const on=a.style===3?.5:3.5;
        const length=newer.s-older.s;
        for(let d=0;d<length-1e-6;){
          const phase=(older.s+d)%period,painted=!dashed || phase<on-1e-6;
          const next=dashed?Math.min(length,d+Math.max(.001,(painted?on:period)-phase)):length;
          const lerp=k=>({x:start.x+(end.x-start.x)*k/length,y:start.y+(end.y-start.y)*k/length});
          if(painted)segments.push({a:lerp(d),b:lerp(next),yellow:a.color===2,double:[5,6].includes(a.style)});
          d=next;
        }
      }
      newer=older;
    }
    return {segments,leadSpeed:pose.leadSpeed};
  }
  return {at};
}
