import {createSignalHistory} from './signal-history.mjs';
import {createDrivingHistory} from './driving-history.mjs';
import {createRoadUserFusion} from './road-user-fusion.mjs';
import * as THREE from './vendor/three/three.module.min.js';
import {RoomEnvironment} from './vendor/three/RoomEnvironment.js';
import {loadStandardFleet} from './standard-fleet.js';
import {anchorDrivePath,createReplayTrajectory,createLaneLookAhead,createRoadEstimator,laneChangeBend,sampleRecordedBoundary} from './road-estimation.js?v=lane-look-ahead-1';

// Geometry is public site content; recording coordinates never leave the browser.
let modelBytes;
async function fleetBytes() {
  if(!modelBytes)modelBytes=fetch(new URL('./assets/vehicles/sedan-replay.bin.gz',import.meta.url)).then(r=>{if(!r.ok)throw Error('Vehicle asset unavailable');return r.arrayBuffer();}).catch(e=>{modelBytes=null;throw e;});
  return modelBytes;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,u)=>a+(b-a)*u;
function release(group) {
  const materials=new Set();
  group.traverse(node=>{if(node.geometry&&!node.userData.sharedGeometry)node.geometry.dispose();for(const m of Array.isArray(node.material)?node.material:[node.material])if(m)materials.add(m);});
  for(const m of materials)m.dispose();
}

export async function createDrivingScene(stage,data,onFailure) {
  // Fetch first: an abandoned load does not keep a WebGL context alive.
  const bytes=await fleetBytes(),fleet=await loadStandardFleet(THREE,bytes);
  let renderer;
  try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch(e){fleet.dispose();throw e;}
  let cleanupScene,cleanupEnvironment,cleanupObserver;const signTextures=new Set();
  try {
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const canvas=renderer.domElement;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Recorded traffic, blue driver vehicle and estimated road');stage.prepend(canvas);
  const scene=new THREE.Scene();cleanupScene=scene;scene.background=new THREE.Color('#101216');scene.fog=new THREE.Fog('#101216',35,130);
  const camera=new THREE.PerspectiveCamera(39,1,.1,220);camera.position.set(0,12.5,22);camera.lookAt(0,0,-10);
  scene.add(new THREE.HemisphereLight(0xffffff,0x70747b,1.2));
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-18,30,10);scene.add(sun);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),envTarget=pmrem.fromScene(environment,.04);cleanupEnvironment=envTarget;scene.environment=envTarget.texture;environment.dispose();pmrem.dispose();
  const colors={sceneLight:new THREE.Color('#f6f7fa'),sceneDark:new THREE.Color('#101216'),blue:new THREE.Color('#278cff'),red:new THREE.Color('#df3349'),orange:new THREE.Color('#ffb23e')};
  const ego=fleet.make(colors,{own:true});scene.add(ego);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshBasicMaterial({color:'#101216',toneMapped:false}));ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
  const estimator=createRoadEstimator(data),motion=globalThis.createVehicleMotion(data),actors=new Map(),roadCache=new Map(),signActors=new Map();
  const replayTrajectory = createReplayTrajectory(data);
  const laneLookAhead = createLaneLookAhead(data.frames,replayTrajectory);
  let disposed=false,time=0,view='perspective',lastFrame=null,lastSigns={camera:[],display:[]};
  function mesh(max,color,opacity) {
    const positions=new Float32Array(max*18),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setDrawRange(0,0);
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
    const m=new THREE.Mesh(geometry,material);m.frustumCulled=false;scene.add(m);return {m,positions,count:0};
  }
  const white=mesh(1500,'#d5dbe4',.77),yellow=mesh(1500,'#d5b864',.85);
  const edges=mesh(750,'#85919f',.48),ribbon=mesh(200,'#539bdb',.42),arrow=mesh(80,'#409eff',.8);
  const inferredEdges=mesh(450,'#93a8bc',.47);
  const cameraCurb=mesh(1024,'#ff91bd',.92),cameraPaint=mesh(1536,'#f7eb80',.9);
  const stopBarLayer=mesh(64,'#ffffff',1);
  stopBarLayer.m.renderOrder=2;
  const roadMeshes=[stopBarLayer,cameraCurb,cameraPaint,white,yellow,edges,inferredEdges,ribbon,arrow];
  let boundaryRows, boundarySamples;
  function drawRecordedBoundaries(lines) {
    if (lines !== boundaryRows) {
      boundaryRows = lines;
      boundarySamples = lines.map(line => ({line, ...sampleRecordedBoundary(line)}));
    }
    for (const {line, points, isEdge, offsets} of boundarySamples) {
      const layer = isEdge ? edges : line[9] === 2 ? yellow : white;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (!b.painted) continue;
        for (const shift of offsets) {
          const offset = p => ({x: p.x - Math.sin(p.angle) * shift, y: p.y + Math.cos(p.angle) * shift});
          quad(layer, shift ? offset(a) : a, shift ? offset(b) : b, isEdge ? .085 : .11);
        }
      }
    }
  }
  function quad(target,a,b,width,y=.02) {
    const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1,nx=-dy/n*width/2,ny=dx/n*width/2;
    stripSegment(target,
      {x:a.x+nx,y:a.y+ny},{x:a.x-nx,y:a.y-ny},
      {x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},y);
  }
  function stripSegment(target,aLeft,aRight,bLeft,bRight,height) {
    const i=target.count*18;
    if(i+18>target.positions.length)return;
    target.positions.set([
      -aLeft.y,height,-aLeft.x, -aRight.y,height,-aRight.x, -bLeft.y,height,-bLeft.x,
      -aRight.y,height,-aRight.x, -bRight.y,height,-bRight.x, -bLeft.y,height,-bLeft.x
    ],i);
    target.count++;
  }
  const at=t=>globalThis.frameAt(data.frames,t);
  function road(f){const key=f.t+':'+(f.b.length?'lanes':'no-lanes');if(!roadCache.has(key)){roadCache.set(key,estimator.estimate(f));if(roadCache.size>12)roadCache.delete(roadCache.keys().next().value);}return roadCache.get(key);}
  function curveAt(curve,s) {
    let lo=0,hi=curve.length-2;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (curve[mid].s <= s) lo = mid;
      else hi = mid - 1;
    }
    const a=curve[lo],b=curve[lo+1],u=clamp((s-a.s)/(b.s-a.s||1),0,1);
    return {x:lerp(a.x,b.x,u),y:lerp(a.y,b.y,u)};
  }
  function drawDrivePath(f,change) {
    const replayCurve = replayTrajectory.pathAt(time);
    if (!replayCurve && (!f || (!f.b.length && !change))) return;
    const curve = replayCurve ?? road(f).curve;
    if (curve.length < 2) return;
    const next = replayCurve ? null : data.frames[globalThis.perceptionFrameIndex(data.frames,f.t)+1];
    const u = next && next.t-f.t < .35 ? clamp((time-f.t)/(next.t-f.t),0,1) : 0;
    const nextCurve = u ? road(next).curve : null;
    function estimatedPoint(s) {
      const p=curveAt(curve,s);
      if(nextCurve?.length>1){const q=curveAt(nextCurve,s);p.x=lerp(p.x,q.x,u);p.y=lerp(p.y,q.y,u);}
      return p;
    }
    const end=Math.min(110,curve.at(-1).s),width=f?.w||3.5;
    const anchoredPoint = s => anchorDrivePath(s,estimatedPoint(s),replayCurve ? 5 : 16);
    let lateralBend;
    if (!replayCurve && change && end > 0) {
      const boundary = f.b.find(b => b[0] === (change.side === 'left' ? 0 : 1));
      const mergeDistance = Math.min(end,clamp((f.v || 25) * .44704 * (change.end - time),10,34));
      lateralBend = laneChangeBend(change,time,width,boundary,mergeDistance,anchoredPoint(mergeDistance).y);
    }
    const drivePoint = s => {
      const p = anchoredPoint(s);
      if (lateralBend) p.y += lateralBend(s);
      return p;
    };
    function point(s,offset=0,center=estimatedPoint) {
      const p=center(s);
      if (!offset) return p;
      const a=center(Math.max(0,s-1)),b=center(s+1),dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1;
      return {x:p.x-dy/n*offset,y:p.y+dx/n*offset};
    }
    const pathEnd = Math.min(end, 70);
    const pathHalfWidth = .39;
    let left = point(0,pathHalfWidth,drivePoint), right = point(0,-pathHalfWidth,drivePoint);
    for (let at = 0; at < pathEnd;) {
      const nextDistance = Math.min(at + 1.5, pathEnd);
      const taper = Math.min((pathEnd - nextDistance) / 13, 1);
      const halfWidth = pathHalfWidth * taper * taper * (3 - 2 * taper);
      const nextLeft = point(nextDistance, halfWidth,drivePoint);
      const nextRight = point(nextDistance, -halfWidth,drivePoint);
      stripSegment(ribbon,left,right,nextLeft,nextRight,.012);
      left = nextLeft;
      right = nextRight;
      at = nextDistance;
    }
    const turn=!replayCurve && !change && data.events?.find(e=>e.kind==='turn'&&time>=e.planStart&&time<=e.end);
    if(turn){for(let s=3;s<Math.min(end,35);s+=1.5)quad(arrow,point(s),point(s+1.5),.14,.035);}
  }
  function generic(classCode,o) {
    const group=new THREE.Group(),body=new THREE.MeshStandardMaterial({color:'#545b66',roughness:.62});
    const bike=[1,2].includes(classCode),ped=classCode===0,w=ped?.45:bike?.65:o[9]||2.1,h=ped?1.7:bike?1.3:o[10]||2.8,l=ped?.45:bike?2:o[8]||6;
    const shell=new THREE.Mesh(new THREE.BoxGeometry(w,h*.65,l),body);shell.position.y=h*.4;group.add(shell);
    if(!ped){const dark=new THREE.MeshStandardMaterial({color:'#171b21',roughness:.4}),glass=new THREE.Mesh(new THREE.BoxGeometry(w*.86,h*.28,l*.3),dark);glass.position.set(0,h*.82,-l*.24);group.add(glass);}
    group.userData.lamps=[];return group;
  }
  function updateSigns(t){
    const state=globalThis.BVTrafficSigns.at(data,t);lastSigns=state;const active=new Set();
    for(const s of state.camera){
      if(!s.position||s.position.x< -6||s.position.x>150||s.opacity<=0)continue;
      active.add(s.key);let actor=signActors.get(s.key);
      if(!actor){
        const image=stage.ownerDocument.createElement('canvas');image.width=128;image.height=128;
        globalThis.BVTrafficSigns.draw(image.getContext('2d'),s,0,0,128);
        const texture=new THREE.CanvasTexture(image);texture.colorSpace=THREE.SRGBColorSpace;signTextures.add(texture);
        actor=new THREE.Group();actor.userData.texture=texture;actor.userData.kind=s.kind;
        const board=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,toneMapped:false,depthWrite:false}));
        board.userData.sharedGeometry=true;board.scale.set(1.5,1.5,1);board.position.y=s.position.z;
        const height=Math.max(.3,s.position.z-.6),pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,1,6),new THREE.MeshBasicMaterial({color:'#7f8995',transparent:true,toneMapped:false}));pole.scale.y=height;pole.position.y=height/2;actor.userData.pole=pole;actor.userData.board=board;
        actor.add(pole,board);scene.add(actor);signActors.set(s.key,actor);
      }
      actor.position.set(-s.position.y,0,-s.position.x);const height=Math.max(.3,s.position.z-.6);actor.userData.pole.scale.y=height;actor.userData.pole.position.y=height/2;actor.userData.board.position.y=s.position.z;
      actor.traverse(node=>{if(node.material)node.material.opacity=s.opacity;});
    }
    for(const [key,actor] of signActors)if(!active.has(key)){scene.remove(actor);actor.userData.texture.dispose();signTextures.delete(actor.userData.texture);release(actor);signActors.delete(key);}
  }
  function resize() {if(disposed)return;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);}
  const observer=new ResizeObserver(resize);cleanupObserver=observer;observer.observe(stage);
  const lost=e=>{e.preventDefault();onFailure?.('The 3D view is unavailable on this device. Video playback is still available.');};canvas.addEventListener('webglcontextlost',lost);
  // Approximate ground contact in the ego frame. Bound the side projections
  // to the immediate surroundings where fisheye distortion is less severe.
  function cameraPoint(view,u,v,maxDepth=view==='front'?28:8){
    const depth=328.5/(v-232),left=(320-u)*depth/365;
    if(v<=244 || depth>maxDepth)return null;
    if(view==='left')return {x:.7-left,y:.9+depth};
    if(view==='right')return {x:.7+left,y:-.9-depth};
    return {x:depth,y:left};
  }
  // Stationary boundaries can be carried forward using recorded movement.
  // Moving vehicle positions expire separately because ego motion cannot predict them.
  function cameraTransform(from,to) {
    const age=to-from;
    if(age<0 || age>4)return null;
    if(age<.08)return p=>p;
    const a=replayTrajectory.poseAt(from), b=replayTrajectory.poseAt(to);
    if(!a?.forward || !b?.forward || a.track!==b.track)return null;
    const [ax,ay]=a.forward,[bx,by]=b.forward;
    const cos=ax*bx+ay*by,sin=ay*bx-ax*by;
    if(cos<.9)return null;
    const east=a.origin[0]-b.origin[0],north=a.origin[1]-b.origin[1];
    return p=>({x:east*bx+north*by+p.x*cos-p.y*sin,y:north*bx-east*by+p.x*sin+p.y*cos});
  }
  function drawCameraResults(sample,frame,t){
    const transform=cameraTransform(sample.time,t);
    const boundaries=new Map();
    for(const {view,traces,markings} of transform?sample.results:[]){
      const project=([u,v])=>{
        const p=cameraPoint(view,u,v);
        return p && transform(p);
      };
      // KAFAS supplies the road markings. Use the longest coherent camera
      // boundary on either side; raw segmentation stays in Camera details.
      const paint=frame?.b?.length?traces.paint:[...traces.paint,...markings];
      for(const [kind,chains] of [['curb',traces.curb],['paint',paint]]){
        for(const chain of chains){
          const points=chain.map(project).filter(p=>p && p.x>=-3 && p.x<=30);
          if(points.length<4)continue;
          const first=points[0],last=points.at(-1),span=Math.abs(first.x-last.x);
          const side=Math.sign(first.y);
          if(span<2 || points.some(p=>p.y*side<.9 || Math.abs(p.y)>7))continue;
          const lateralRange=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
          if(lateralRange>Math.max(.75,span*.28))continue;
          if(!boundaries.has(side)||boundaries.get(side).span<span)boundaries.set(side,{kind,points,span});
        }
      }
    }
    for(const {kind,points} of boundaries.values()){
      for(let i=1;i<points.length;i++)quad(kind==='curb'?cameraCurb:cameraPaint,points[i-1],points[i],.12,.065);
    }
  }
  const cameraActors=new Map();
  const history=createDrivingHistory(data.frames);
  const fuseRoadUsers=createRoadUserFusion();
  function drawRoadUsers(sample,frame,t){
    const active=new Set(),detections=sample?.roadUsers;
    const objects=fuseRoadUsers(detections, detections?at(detections.time)?.o??[]:[],cameraPoint);
    if(detections && t>=detections.time && t-detections.time<=1.4){
      for(const p of objects){
          if(!p.confirmed)continue;
          const person=p.kind==='person',bike=p.kind==='bike';
          // A newly acquired KAFAS track takes over immediately between camera samples.
          if(frame?.o.some(o=>(o[6]==null||o[6]>=30) &&
            (o[3]===0?'person':[1,2].includes(o[3])?'bike':'vehicle')===p.kind &&
            Math.hypot((o[1]-p.x)/(person?1:3),(o[2]-p.y)/(person?.65:1.25))<=1))continue;
          const key=p.kind+':'+p.id;
          let actor=cameraActors.get(key);
          if(!actor){
            actor=p.kind==='vehicle'?fleet.make(colors,{}):generic(person?0:1,[]);
            if(person){
              const head=new THREE.Mesh(new THREE.SphereGeometry(.17,8,6),new THREE.MeshStandardMaterial({color:'#d3a46f'}));
              head.position.y=1.43;actor.add(head);
            }
            cameraActors.set(key,actor);scene.add(actor);
          }
          active.add(key);actor.position.set(-p.y,0,-p.x);
      }
    }
    for(const [key,actor] of cameraActors)if(!active.has(key)){scene.remove(actor);release(actor);cameraActors.delete(key);}
  }
  // Stop bars belong to the recorded track. Store their endpoints in local
  // east/north metres once so camera layout changes cannot move the paint.
  const bars=[];
  let lastPaint,barDepth=null;
  function orientedPose(t){
    const points=data.gps;
    if(!points?.length || t<points[0][0] || t>points.at(-1)[0])return null;
    let lo=0,hi=points.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid][0]<=t)lo=mid+1;else hi=mid;}
    const a=points[lo-1],b=points[lo]??a,dt=b[0]-a[0];
    const movement=Math.hypot(b[1]-a[1],b[2]-a[2]);
    // The recorder can omit GPS reports while stopped at a light. Bridge
    // nearby fixes only; do not place a landmark during an unobserved trip.
    if(dt>1.25 && (dt>15 || movement>4))return null;
    const f=dt?(t-a[0])/dt:0;
    const origin=[lerp(a[1],b[1],f),lerp(a[2],b[2],f)];
    const heading=replayTrajectory.poseAt(t)?.forward;
    if(heading)return {origin,forward:heading};
    for(let i=lo-1;i>=0 && t-points[i][0]<60;i--){
      const dx=origin[0]-points[i][1],dy=origin[1]-points[i][2],distance=Math.hypot(dx,dy);
      if(distance>=2)return {origin,forward:[dx/distance,dy/distance]};
    }
    return null;
  }
  function drawStopBars(t,paint){
    barDepth=null;
    const local=paint?.ends.map(([u,v])=>cameraPoint('front',u,v));
    if(paint && paint!==lastPaint && paint.time<=t && local.every(Boolean)){
      lastPaint=paint;
      const pose=orientedPose(paint.time);
      if(pose?.forward){
        const [e,n]=pose.forward;
        const ends=local.map(p=>[pose.origin[0]+e*p.x-n*p.y,pose.origin[1]+n*p.x+e*p.y]);
        const center=ends[0].map((v,i)=>(v+ends[1][i])/2);
        const existing=bars.find(b=>Math.hypot(b.center[0]-center[0],b.center[1]-center[1])<2);
        if(existing)existing.time=Math.min(existing.time,paint.time);
        else bars.push({ends,center,time:paint.time});
      }
    }
    const current=orientedPose(t);
    if(current?.forward){
      const [e,n]=current.forward;
      for(const bar of bars){
        if(bar.time>t)continue;
        const [a,b]=bar.ends.map(([east,north])=>{
          const dx=east-current.origin[0],dy=north-current.origin[1];
          return {x:dx*e+dy*n,y:-dx*n+dy*e};
        });
        const depth=(a.x+b.x)/2;
        if(depth< -30 || depth>65 || Math.abs(a.y+b.y)>60)continue;
        quad(stopBarLayer,a,b,.32,.059);
        if(barDepth===null || Math.abs(depth)<Math.abs(barDepth))barDepth=depth;
      }
    }
    if(barDepth===null && local?.every(Boolean) && t>=paint.time && t-paint.time<.12){
      quad(stopBarLayer,...local,.32,.059);barDepth=local[0].x;
    }
  }

  // Camera detections provide bearing, but no measured signal distance.
  // Use camera-facing neutral markers within the scene for both replay angles.
  const signalMarkers=[];
  const signalImage=stage.ownerDocument.createElement('canvas');
  signalImage.width=120;signalImage.height=52;
  const ink=signalImage.getContext('2d');
  ink.fillStyle='#182026';ink.strokeStyle='#e3ebf3';ink.lineWidth=4;
  ink.beginPath();ink.roundRect(3,4,114,44,11);ink.fill();ink.stroke();
  ink.fillStyle='#9aa8b4';
  for(const x of [25,60,95]){ink.beginPath();ink.arc(x,26,11,0,Math.PI*2);ink.fill();}
  const signalTexture=new THREE.CanvasTexture(signalImage);
  signalTexture.colorSpace=THREE.SRGBColorSpace;signTextures.add(signalTexture);
  const signalHistory=createSignalHistory(data.speeds);
  let signalCount=0;
  function drawSignalMarkers(t,detection,enabled){
    const lights=signalHistory(t,detection,enabled);
    signalCount=lights.length;
    camera.updateMatrixWorld();
    const sorted=[...lights].sort((a,b)=>a.bbox[0]-b.bbox[0]);
    let previousX=-Infinity;
    sorted.forEach(({bbox:[x,y,w,h]},i)=>{
      let marker=signalMarkers[i];
      if(!marker){
        marker=new THREE.Sprite(new THREE.SpriteMaterial({map:signalTexture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,fog:false}));
        marker.userData.sharedGeometry=true;marker.renderOrder=5;scene.add(marker);signalMarkers.push(marker);
      }
      // Relative image coordinates keep heads on the correct side without
      // inventing a surveyed location, including the wider single-camera view.
      const u=(x+w/2)/640,v=(y+h/2)/480;
      const widthFraction=Math.min(.16/camera.aspect,.12);
      const markerX=Math.min(.82-(sorted.length-i-1)*widthFraction*2.15,
        Math.max(previousX+widthFraction*2.15,(u-.5)*1.45));
      previousX=markerX;
      marker.position.set(markerX,.46-v*.70,0).unproject(camera);
      const extent=2*marker.position.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()))*Math.tan(camera.fov*Math.PI/360);
      const size=extent*Math.min(.16,camera.aspect*.12);
      marker.scale.set(size,size*52/120,1);marker.visible=true;
    });
    for(let i=lights.length;i<signalMarkers.length;i++)signalMarkers[i].visible=false;
  }
  let cameraResults, cameraEnabled=false;
  function setTime(t,enhancements,enabled=!!enhancements) {
    cameraEnabled=enabled;
    cameraResults=enhancements;
    if(disposed)return;time=t;const f=at(t);lastFrame=f;
    const change=data.events?.find(event=>event.kind==='change'&&t>=event.start&&t<=event.end);
    for(const target of roadMeshes)target.count=0;
    const past=history.at(globalThis.perceptionFrameIndex(data.frames,t));
    for(const {a,b,yellow:isYellow,double} of past.segments){
      const layer=isYellow?yellow:white;
      if(double){
        for(const offset of [-.1,.1])quad(layer,{x:a.x,y:a.y+offset},{x:b.x,y:b.y+offset},.10);
      }else quad(layer,a,b,.11);
    }
    drawDrivePath(f,change);
    barDepth=null;
    if(enabled)drawStopBars(t,enhancements?.stopBar);
    drawSignalMarkers(t,enhancements?.signalSample??enhancements?.roadUsers,enabled);
    drawRoadUsers(enhancements,f,t);
    if(enhancements)drawCameraResults(enhancements,f,t);
    const active=new Set();
    if(f) {
      drawRecordedBoundaries(f.b);
      for (const points of laneLookAhead.at(t,f.b)) {
        for (let i = 1; i < points.length; i++) {
          if (i % 4 < 2) quad(inferredEdges,points[i-1],points[i],.09,.015);
        }
      }
      const objectTime = f.objectT ?? f.t;
      let next;
      if (f.o.length) {
        for (let i = globalThis.perceptionFrameIndex(data.frames, f.t) + 1; i < data.frames.length; i++) {
          const candidate = data.frames[i];
          if (candidate.t - objectTime > .35) break;
          if ((candidate.objectT ?? candidate.t) > objectTime) { next = candidate; break; }
        }
      }
      const u = next ? clamp((t - objectTime) / ((next.objectT ?? next.t) - objectTime), 0, 1) : 0;
      for(const o of f.o) {
        if(o[1]>150 || (o[6]!==null&&o[6]<30))continue;
        const key=o[0]+':'+o[3];active.add(key);let actor=actors.get(key);
        if(!actor){actor=o[3]===3?fleet.make(colors,{length:o[8]||4.77,width:o[9]||1.85,height:o[10]||1.45}):generic(o[3],o);actors.set(key,actor);scene.add(actor);}
        const target=next?.o.find(p=>p[0]===o[0]&&p[3]===o[3]&&Math.hypot(p[1]-o[1],p[2]-o[2])<12),x=target?lerp(o[1],target[1],u):o[1],y=target?lerp(o[2],target[2],u):o[2],heading=motion.at(t,o,f.v).heading;
        const length=o[8]||4.77,width=o[9]||1.85,dx=[0,1,2].includes(o[7])?-length/2:[4,5,6].includes(o[7])?length/2:0,dy=[0,6,7].includes(o[7])?-width/2:[2,3,4].includes(o[7])?width/2:0;
        actor.position.set(-(y+dx*Math.sin(heading)+dy*Math.cos(heading)),0,-(x+dx*Math.cos(heading)-dy*Math.sin(heading)));actor.rotation.y=heading;
        actor.userData.motion=motion.at(t,o,f.v).direction;
      }
    }
    for(const [id,actor] of actors)if(!active.has(id)){scene.remove(actor);release(actor);actors.delete(id);}
    for(const lamp of ego.userData.lamps)lamp.visible=!!f&&Math.floor(t*2)%2===0&&(f.indicator==='hazard'||f.indicator==='both'||(f.indicator==='left'&&lamp.userData.side===-1)||(f.indicator==='right'&&lamp.userData.side===1));
    for(const target of roadMeshes){
      const geometry=target.m.geometry;
      geometry.setDrawRange(0,target.count*6);
      if(target.count){
        const position=geometry.attributes.position;
        position.clearUpdateRanges();
        position.addUpdateRange(0,target.count*18);
        position.needsUpdate=true;
      }
    }
    updateSigns(t);renderer.render(scene,camera);
    return f && {...f,leadSpeedMph:past.leadSpeed,laneChange:change?.side,inferredLanes:inferredEdges.count>0};
  }
  resize();
  return {canvas,setSize(w,h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();},setTime,setView(value){view=value;if(view==='overhead'){camera.position.set(0,55,8);camera.lookAt(0,0,-22);}else{camera.position.set(0,12.5,22);camera.lookAt(0,0,-10);}setTime(time,cameraResults,cameraEnabled);},get signalCount(){return signalCount;},get stopBarDepth(){return barDepth;},get stopBarVisible(){return stopBarLayer.count>0;},inspect(){return {time,barDepth,trafficLights:signalMarkers.filter(m=>m.visible).length,stopBar:stopBarLayer.count>0,objects:actors.size,cameraObjects:[...cameraActors.keys()],lanes:lastFrame?.b.length||0,markingSegments:white.count+yellow.count,edgeSegments:edges.count,inferredLaneSegments:inferredEdges.count,routePoints:data.gps.length,signs:[...signActors.values()].map(a=>({kind:a.userData.kind,x:a.position.x,z:a.position.z})),recognizedSigns:lastSigns.display.map(s=>({kind:s.kind,value:s.value,unit:s.unit})),model:fleet.meta.identity,actors:[...actors.values()].map(a=>({direction:a.userData.motion,heading:a.rotation.y}))};},dispose(){if(disposed)return;disposed=true;observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);release(scene);for(const texture of signTextures)texture.dispose();signTextures.clear();fleet.dispose();envTarget.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
  } catch(error) {cleanupObserver?.disconnect();if(cleanupScene)release(cleanupScene);for(const texture of signTextures)texture.dispose();signTextures.clear();cleanupEnvironment?.dispose();fleet.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();throw error;}
}
