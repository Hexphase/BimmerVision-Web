/* Retrospective local road sketch. GPS supplies the driven route, not mapped lanes. */
export function createRoadEstimator(data){
  const gps=data.gps||[],frames=data.frames,changes=(data.events||[]).filter(e=>e.kind==='change');
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function index(a,t){let l=0,h=a.length-1;while(l<h){const m=Math.ceil((l+h)/2);if((Array.isArray(a[m])?a[m][0]:a[m].t)<=t)l=m;else h=m-1;}return l;}
  function at(t){return frames[index(frames,t)]||{};}
  function pose(t){
    if(!gps.length||t<gps[0][0]-.1||t>gps.at(-1)[0]+.1)return null;
    const i=index(gps,t),a=gps[i],b=gps[i+1];if(!b)return {e:a[1],n:a[2]};
    if(b[0]-a[0]>1.5)return null;const u=clamp((t-a[0])/(b[0]-a[0]),0,1);return {e:a[1]+u*(b[1]-a[1]),n:a[2]+u*(b[2]-a[2])};
  }
  function heading(t){
    for(const dt of [1,2.5,4]){const a=pose(Math.max(gps[0]?.[0]||0,t-dt)),b=pose(Math.min(gps.at(-1)?.[0]||0,t+dt));if(a&&b&&Math.hypot(b.e-a.e,b.n-a.n)>3)return Math.atan2(b.e-a.e,b.n-a.n);}
    return null;
  }
  function widthAt(t){const f=at(t);if(f.w>=2.4&&f.w<=4.8)return {width:f.w,estimated:false};const recent=frames.filter(p=>p.t<=t&&p.t>t-15&&p.w>=2.4&&p.w<=4.8).map(p=>p.w).sort((a,b)=>a-b);return {width:recent.length?recent[recent.length>>1]:3.5,estimated:true};}
  const correctionModels=new Map();
  function correction(t){
    let e=0,n=0;for(const ev of changes){
      if(!correctionModels.has(ev.at)){
        const a=pose(Math.max(gps[0]?.[0]||0,ev.at-1.4)),b=pose(ev.at+1.4),h=heading(ev.at-1.4),sign=ev.side==='right'?1:-1;
        const observed=a&&b&&h!==null?((b.e-a.e)*Math.cos(h)-(b.n-a.n)*Math.sin(h))*sign:0;
        // Navigation GPS may be road-snapped. Never invent a full lane-width jump.
        correctionModels.set(ev.at,{h,amount:observed>=1.2&&observed<=5.5?Math.min(observed,widthAt(ev.at).width):0,sign});
      }
      const m=correctionModels.get(ev.at),u=clamp((t-(ev.at-1.4))/2.8,0,1);if(m.h===null||!m.amount||!u)continue;
      const d=m.amount*u*u*(3-2*u)*m.sign;e+=Math.cos(m.h)*d;n-=Math.sin(m.h)*d;
    }return {e,n};
  }
  const boundary=(b,x)=>{const dx=x-b[1];return b[2]+Math.tan(b[3]*Math.PI/180)*dx+b[4]*dx*dx/2+b[5]*dx*dx*dx/6;};
  function estimate(f){
    const t=f.t,origin=pose(t),h=heading(t),w=widthAt(t),left=f.b.find(b=>b[0]===0),right=f.b.find(b=>b[0]===1);
    const center0=left&&right?clamp((boundary(left,0)+boundary(right,0))/2,-w.width,w.width):left?boundary(left,0)-w.width/2:right?boundary(right,0)+w.width/2:0;
    const points=[],base=correction(t);let s=0,last=null;
    if(origin&&h!==null){
      for(let dt=0;dt<=16;dt+=.25){const future=t+dt,p=pose(future);if(!p)break;const c=correction(future),de=p.e-origin.e-c.e+base.e,dn=p.n-origin.n-c.n+base.n;
        const x=de*Math.sin(h)+dn*Math.cos(h),y=-de*Math.cos(h)+dn*Math.sin(h);
        if(last){const d=Math.hypot(x-last.x,y-last.y);if(d<.3)continue;s+=d;}if(s>125||x<-.5&&s>5)break;
        const next=at(future),lp=next.leftLane==='present'?1:['absent','not-drivable'].includes(next.leftLane)?0:f.leftLane==='present'?1:0,rp=next.rightLane==='present'?1:['absent','not-drivable'].includes(next.rightLane)?0:f.rightLane==='present'?1:0;
        points.push({x,y,s,t:future,width:widthAt(future).width,l:lp,r:rp});last={x,y};
      }
    }
    const usedGPS=points.length>=3&&s>8;
    if(usedGPS){
      const lerp=(a,b,u)=>Object.fromEntries(['x','y','s','t','width','l','r'].map(k=>[k,a[k]+u*(b[k]-a[k])]));
      let smoothed=points.map(p=>({...p}));
      for(let pass=0;pass<2;pass++){const next=[smoothed[0]];for(let i=0;i<smoothed.length-1;i++)next.push(lerp(smoothed[i],smoothed[i+1],.25),lerp(smoothed[i],smoothed[i+1],.75));next.push(smoothed.at(-1));smoothed=next;}
      points.length=0;let distance=0,nextDistance=0;
      for(let i=0;i<smoothed.length-1;i++){const a=smoothed[i],b=smoothed[i+1],length=Math.hypot(b.x-a.x,b.y-a.y);while(nextDistance<=distance+length&&length>.0001){const p=lerp(a,b,(nextDistance-distance)/length);p.s=nextDistance;points.push(p);nextDistance+=1.5;}distance+=length;}points.push({...smoothed.at(-1),s:distance});
    }
    if(!usedGPS){points.length=0;s=0;const end=left&&right?Math.min(100,left[1]+left[6],right[1]+right[6]):left?Math.min(60,left[1]+left[6]):right?Math.min(60,right[1]+right[6]):15;
      const k=Number.isFinite(f.steering)?clamp(Math.tan(f.steering/15*Math.PI/180)/2.85,-.09,.09):0;
      for(let d=0;d<=end;d+=2){const x=Math.abs(k)>.001?Math.sin(k*d)/k:d,y=Math.abs(k)>.001?(1-Math.cos(k*d))/k:0;points.push({x,y,s:d,t,width:w.width,l:f.leftLane==='present'?1:0,r:f.rightLane==='present'?1:0});}s=end;
    }
    // Blend GPS with the nearby observed corridor; do not extend measured lines.
    for(let i=0;i<points.length;i++){
      const p=points[i],prev=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)],dx=next.x-prev.x,dy=next.y-prev.y,norm=Math.hypot(dx,dy)||1;
      p.x-=dy/norm*center0;p.y+=dx/norm*center0;
      if(left&&right&&p.x>=Math.max(left[1],right[1])&&p.x<=Math.min(left[1]+left[6],right[1]+right[6])){const observed=(boundary(left,p.x)+boundary(right,p.x))/2,weight=Math.exp(-p.s/22);p.y=p.y*(1-weight)+observed*weight;}
    }
    // Near the recording end, the still-valid camera model can complete the view.
    if(usedGPS&&left&&right&&points.at(-1).x>5&&Math.abs(points.at(-1).y-center0)<8){const tail=points.at(-1),end=Math.min(100,left[1]+left[6],right[1]+right[6]),shift=tail.y-(boundary(left,tail.x)+boundary(right,tail.x))/2;
      for(let x=tail.x+2;x<=end;x+=2)points.push({x,y:(boundary(left,x)+boundary(right,x))/2+shift*Math.exp(-(x-tail.x)/15),s:tail.s+x-tail.x,t:tail.t,width:w.width,l:tail.l,r:tail.r});
    }
    for(let i=0;i<points.length;i++){const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1;points[i].nx=-dy/n;points[i].ny=dx/n;}
    return {curve:points,width:w.width,widthEstimated:w.estimated,range:points.at(-1)?.s||0,source:usedGPS?'GPS + lane model':left||right?'Lane model':'Steering sketch'};
  }
  function context(f){
    const c=data.satelliteContext,o=pose(f.t),h=heading(f.t);if(!c||!o||h===null||Math.hypot(c.junction[0]-o.e,c.junction[1]-o.n)>200)return [];
    return c.roads.map(road=>({halfWidth:road.halfWidth,points:road.points.map(p=>{const e=p[0]-o.e,n=p[1]-o.n;return {x:e*Math.sin(h)+n*Math.cos(h),y:-e*Math.cos(h)+n*Math.sin(h)};})}));
  }
  return {estimate,pose,heading,correction,context};
}
