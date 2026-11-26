/* Retrospective local road sketch. GPS supplies the driven route, not mapped lanes. */
export function anchorDrivePath(distance, estimated, blendDistance = 16) {
  // The car model is centered at (0,0), with positive x pointing forward.
  const t = Math.min(1, distance / blendDistance);
  const blend = t * t * (3 - 2 * t);
  return {
    x: distance + (estimated.x - distance) * blend,
    y: estimated.y * blend
  };
}

const replayStep = .2;
const replayGap = 1.25;
const clampReplay = (value, min, max) => Math.max(min, Math.min(max, value));

function smoothReplayCurve(curve) {
  if (curve.length < 3) return curve;
  // Use equal spacing so slow turns get the same rounding as faster ones.
  let points = [curve[0]], segment = 1;
  for (let distance = 2.5; distance < curve.at(-1).s; distance += 2.5) {
    while (curve[segment].s < distance) segment++;
    const a = curve[segment-1], b = curve[segment], weight = (distance-a.s)/(b.s-a.s);
    points.push({x:a.x + (b.x-a.x)*weight,y:a.y + (b.y-a.y)*weight});
  }
  points.push(curve.at(-1));
  for (let pass = 0; pass < 2; pass++) {
    const rounded = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i-1], b = points[i];
      for (const weight of [.25,.75]) {
        rounded.push({x:a.x + (b.x-a.x)*weight,y:a.y + (b.y-a.y)*weight});
      }
    }
    rounded.push(points.at(-1));
    points = rounded;
  }
  let distance = 0;
  return points.map((point,i) => {
    if (i) distance += Math.hypot(point.x-points[i-1].x,point.y-points[i-1].y);
    return {...point,s:distance};
  });
}

export function createReplayTrajectory({gps = [], frames = [], events = []}) {
  function position(points, time) {
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (points[mid][0] <= time) lo = mid;
      else hi = mid - 1;
    }
    const a = points[lo], b = points[lo + 1];
    if (!b) return a.slice(1);
    const fraction = clampReplay((time - a[0]) / (b[0] - a[0]), 0, 1);
    return [a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction];
  }

  const runs = [];
  let run = [];
  for (const point of gps) {
    if (point.length < 3 || !point.slice(0,3).every(Number.isFinite)) continue;
    const previous = run.at(-1);
    if (previous) {
      const elapsed = point[0] - previous[0];
      if (elapsed <= 0) continue;
      if (elapsed > replayGap || Math.hypot(point[1] - previous[1], point[2] - previous[2]) > Math.max(12, elapsed * 65)) {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    run.push(point);
  }
  if (run.length > 1) runs.push(run);

  // Overlapping reports for the same maneuver should contribute one correction.
  const changes = [];
  for (const event of events.filter(event => event.kind === 'change').sort((a,b) => a.start - b.start)) {
    const previous = changes.at(-1);
    if (previous?.side === event.side && event.start <= previous.end) previous.end = Math.max(previous.end, event.end);
    else changes.push({...event});
  }

  const tracks = runs.map(rows => {
    const start = rows[0][0], end = rows.at(-1)[0], uniform = [];
    for (let time = start; time < end; time += replayStep) uniform.push([time, ...position(rows,time)]);
    uniform.push([end, ...rows.at(-1).slice(1)]);
    let points = uniform.map(([time,east,north], i) => {
      if (i < 3 || i >= uniform.length - 3) return [time,east,north];
      // Symmetric smoothing preserves the timing of turns while removing GPS steps.
      let e = 0, n = 0;
      for (let j = -3; j <= 3; j++) {
        const weight = 4 - Math.abs(j);
        e += uniform[i+j][1] * weight;
        n += uniform[i+j][2] * weight;
      }
      return [time,e/16,n/16];
    });
    const corrections = [];
    for (const change of changes) {
      if (change.start - .6 < start || change.end + .6 > end || change.end <= change.start) continue;
      const [e0,n0] = position(points,change.start - 1.6), [e1,n1] = position(points,change.start);
      const [e2,n2] = position(points,change.end), [e3,n3] = position(points,change.end + 1.6);
      const approach = Math.hypot(e1-e0,n1-n0), exit = Math.hypot(e3-e2,n3-n2);
      if (approach < 3 || exit < 3) continue;
      const east = (e1-e0)/approach + (e3-e2)/exit, north = (n1-n0)/approach + (n3-n2)/exit;
      const norm = Math.hypot(east,north);
      if (norm < 1.8) continue;
      const side = change.side === 'left' ? 1 : -1;
      const observed = side * ((n2-n1)*east - (e2-e1)*north)/norm;
      const measuredWidth = frames.find(frame => Math.abs(frame.t-change.start) < .5 && frame.w >= 2.4 && frame.w <= 4.8)?.w;
      const width = measuredWidth ?? 3.5;
      // Add only the missing lateral movement when navigation GPS hugs a road centerline.
      const missing = observed >= width * .8 ? 0 : width - Math.max(0,observed);
      if (missing > 0) corrections.push({...change,east:-north/norm*side*missing,north:east/norm*side*missing});
    }
    if (corrections.length) {
      points = points.map(([time,east,north]) => {
        for (const change of corrections) {
          const u = clampReplay((time-change.start)/(change.end-change.start),0,1);
          const easing = u**3 * (10 - 15*u + 6*u*u);
          east += change.east * easing;
          north += change.north * easing;
        }
        return [time,east,north];
      });
    }
    return {start,end,points};
  });

  function poseAt(time) {
    const track = tracks.find(({start,end}) => time >= start - .1 && time <= end);
    if (!track) return null;
    const {start,end,points} = track, origin = position(points,time);
    let east = 0, north = 0;
    for (const span of [.8,1.6,3]) {
      const before = position(points,Math.max(start,time-span));
      const after = position(points,Math.min(end,time+.16));
      east = after[0] - before[0];
      north = after[1] - before[1];
      if (Math.hypot(east,north) >= 2) break;
    }
    if (Math.hypot(east,north) < 2) {
      const ahead = position(points,Math.min(end,time+1.6));
      east = ahead[0] - origin[0];
      north = ahead[1] - origin[1];
    }
    const norm = Math.hypot(east,north);
    return {track,origin,forward:norm < 1 ? null : [east/norm,north/norm]};
  }

  function pathAt(time, secondsAhead = 9) {
    const pose = poseAt(time);
    if (!pose) return null;
    const curve = [{x:0,y:0,s:0}];
    if (!pose.forward) return curve;
    const {origin,track:{end,points},forward:[east,north]} = pose;
    const limit = Math.min(end,time+secondsAhead);
    for (let future = Math.min(limit,time+.25); future > time;) {
      const [e,n] = position(points,future);
      const de = e-origin[0], dn = n-origin[1];
      const x = de*east+dn*north, y = dn*east-de*north;
      const previous = curve.at(-1), length = Math.hypot(x-previous.x,y-previous.y);
      if (length >= .25) {
        const s = previous.s + length;
        if (s > 80) break;
        curve.push({x,y,s});
      }
      if (future >= limit) break;
      future = Math.min(limit,future+.25);
    }
    return smoothReplayCurve(curve);
  }
  return {pathAt,poseAt};
}

export function laneChangeBend(change, time, width, boundary, mergeDistance, estimatedLateral) {
  const direction = change.side === 'left' ? 1 : -1;
  const destination = boundary ? boundary[2] + direction * width / 2 : direction * width;
  // The estimated path may already include part of the same maneuver.
  const missingShift = Math.max(0, Math.min(width, direction * (destination - estimatedLateral)));
  const ramp = Math.max(0, Math.min(1, (time - change.start) / .25, (change.end - time) / .5));
  return distance => {
    const t = Math.min(1, distance / mergeDistance);
    return direction * missingShift * ramp * t * t * (3 - 2 * t);
  };
}

const markingStyles = {
  1: {period: 9, painted: 3.5},
  2: {},
  3: {period: 2, painted: 0.5},
  5: {period: 9, painted: 3.5, double: true},
  6: {double: true},
  7: {period: 9, painted: 3.5},
  8: {}
};

// Integrate the camera clothoid in its own coordinates for the measured length.
// The style codes describe markings separately from curbs and other edges.
export function sampleRecordedBoundary(line) {
  const [, x, y, headingDegrees, curvature, curvatureChange, length, type] = line;
  const marking = markingStyles[type];
  const points = [{x, y, s: 0, angle: headingDegrees * Math.PI / 180}];
  const end = Math.min(110, length);
  for (let s = 0; s < end;) {
    const phase = marking?.period ? s % marking.period : 0;
    const painted = !marking?.period || phase < marking.painted - 1e-6;
    const step = Math.min(0.75, end - s, marking?.period
      ? (painted ? marking.painted : marking.period) - phase
      : Infinity);
    if (step < 1e-9) break;
    const midpoint = s + step / 2, next = s + step;
    const direction = points[0].angle + curvature * midpoint + curvatureChange * midpoint ** 2 / 2;
    const previous = points.at(-1);
    points.push({
      x: previous.x + Math.cos(direction) * step,
      y: previous.y + Math.sin(direction) * step,
      s: next,
      angle: points[0].angle + curvature * next + curvatureChange * next ** 2 / 2,
      painted
    });
    s = next;
  }
  return {points, isEdge: !marking, offsets: marking?.double ? [-0.10, 0.10] : [0]};
}

export function createLaneLookAhead(frames, trajectory) {
  const slots = new Map(), tracks = new Map(), sampled = new Map();
  let lastTime = -Infinity;
  for (const frame of frames) {
    const time = frame.laneT ?? (frame.laneT === undefined ? frame.t : null);
    if (!Number.isFinite(time) || time <= lastTime) continue;
    lastTime = time;
    for (const line of frame.b || []) {
      if (!Number.isInteger(line[8]) || line[8] === 255) continue;
      if (!slots.has(line[0])) slots.set(line[0],[]);
      const row = {time,line};
      slots.get(line[0]).push(row);
      if (!tracks.has(line[8])) tracks.set(line[8], []);
      tracks.get(line[8]).push(row);
    }
  }

  function firstAfter(rows,time) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function samples(line) {
    if (!sampled.has(line)) {
      sampled.set(line,sampleRecordedBoundary(line).points);
      if (sampled.size > 24) sampled.delete(sampled.keys().next().value);
    }
    return sampled.get(line);
  }

  function project(row, target) {
    const source = trajectory.poseAt(row.time);
    if (!source?.forward || source.track !== target.track) return [];
    const [se,sn] = source.forward, [te,tn] = target.forward;
    const cos = se*te + sn*tn, sin = sn*te - se*tn;
    // Do not drag a lane across a junction or a large heading change.
    if (cos < .86) return [];
    const east = source.origin[0]-target.origin[0], north = source.origin[1]-target.origin[1];
    const dx = east*te+north*tn, dy = north*te-east*tn;
    const points = [];
    for (const p of samples(row.line)) {
      const x = dx+p.x*cos-p.y*sin, y = dy+p.x*sin+p.y*cos;
      if (points.length && x <= points.at(-1).x) break;
      points.push({x,y});
    }
    return points;
  }

  function yAt(points,x) {
    if (!points.length || x < points[0].x || x > points.at(-1).x) return null;
    const i = points.findIndex(p => p.x >= x);
    const b = points[i], a = points[i-1] ?? b;
    return a === b ? b.y : a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
  }

  const same = (a,b) => a && b && a[8] === b[8] && a[7] === b[7];
  function pathBetween(start,end,y) {
    if (end-start < 2) return [];
    const points = [];
    for (let x = start; x < end; x += 1) points.push({x,y:y(x)});
    points.push({x:end,y:y(end)});
    return points;
  }

  function at(time, measured) {
    const pose = trajectory.poseAt(time);
    if (!pose?.forward) return [];
    const inferred = [];
    for (const [slot,rows] of slots) {
      const line = measured.find(boundary => boundary[0] === slot);
      let points = [];
      if (line) {
        // Grow the observed line through overlapping measurements in the current
        // vehicle's coordinates. At road speed the last observation may be far
        // beyond the original line, so validate each intermediate join.
        const rowsForTrack = tracks.get(line[8]);
        if (!rowsForTrack) continue;
        let tail = samples(line);
        let i = firstAfter(rowsForTrack, time);
        while (i < rowsForTrack.length) {
          const future = rowsForTrack[i];
          if (future.time > time + 5 || tail.at(-1).x >= 145) break;
          i = firstAfter(rowsForTrack, future.time + .25);
          if (!same(line, future.line)) continue;
          const projected = project(future,pose);
          const end = tail.at(-1), checkX = end.x - 3;
          const join = yAt(projected,end.x), overlap = yAt(projected,checkX);
          const prior = yAt(tail,checkX);
          if (join === null || overlap === null || prior === null ||
              Math.abs(join-end.y) > 1 || Math.abs((join-overlap)-(end.y-prior)) > .5) continue;
          const shift = end.y-join;
          const extension = pathBetween(end.x, Math.min(145,projected.at(-1).x),
            x => yAt(projected,x)+shift*Math.max(0,1-(x-end.x)/10));
          if (!extension.length) continue;
          if (points.length) points.pop();
          points.push(...extension);
          tail = points.length >= 5 ? points : [...tail.slice(0,-1), ...extension];
        }
      } else {
        const i = firstAfter(rows,time), before = rows[i-1], after = rows[i];
        if (!same(before?.line,after?.line) || after.time-before.time > 5) continue;
        const a = project(before,pose), b = project(after,pose);
        if (a.length < 2 || b.length < 2) continue;
        const start = Math.max(0,a[0].x,b[0].x), end = Math.min(85,a.at(-1).x,b.at(-1).x);
        if (end-start < 5 || [start,(start+end)/2,end].some(x => Math.abs(yAt(a,x)-yAt(b,x)) > 1)) continue;
        const blend = (time-before.time)/(after.time-before.time);
        points = pathBetween(start,end,x => yAt(a,x)*(1-blend)+yAt(b,x)*blend);
      }
      if (points.length) {
        const observation = line ?? rows[firstAfter(rows,time)].line;
        inferred.push({points, type: observation[7], color: observation[9]});
      }
    }
    return inferred;
  }
  return {at};
}

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
