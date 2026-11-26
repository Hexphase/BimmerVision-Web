import * as THREE from './vendor/three/three.module.min.js';
import {createDrivingHistory} from './driving-history.mjs';
import {RoomEnvironment} from './vendor/three/RoomEnvironment.js';
import {loadStandardFleet} from './standard-fleet.js';
import {createReplayTrajectory, createLaneLookAhead, sampleRecordedBoundary} from './road-estimation.js?v=lane-reconstruction-2';

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
  const canvas=renderer.domElement;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Recorded traffic, blue driver vehicle with a four-second blue route preview and recorded lane boundaries');stage.prepend(canvas);
  const scene=new THREE.Scene();cleanupScene=scene;scene.background=new THREE.Color('#101216');scene.fog=new THREE.Fog('#101216',35,130);
  const camera=new THREE.PerspectiveCamera(39,1,.1,220);camera.position.set(0,15,25);camera.lookAt(0,0,-14);
  scene.add(new THREE.HemisphereLight(0xffffff,0x70747b,1.2));
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-18,30,10);scene.add(sun);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),envTarget=pmrem.fromScene(environment,.04);cleanupEnvironment=envTarget;scene.environment=envTarget.texture;environment.dispose();pmrem.dispose();
  const colors={sceneLight:new THREE.Color('#f6f7fa'),sceneDark:new THREE.Color('#101216'),blue:new THREE.Color('#278cff'),red:new THREE.Color('#df3349'),orange:new THREE.Color('#ffb23e')};
  const ego=fleet.make(colors,{own:true});scene.add(ego);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshBasicMaterial({color:'#101216',toneMapped:false}));ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
  const motion=globalThis.createVehicleMotion(data),actors=new Map(),signActors=new Map();
  let disposed=false,time=0,view='perspective',lastFrame=null,lastSigns={camera:[],display:[]};
  function mesh(max,color,opacity) {
    const positions=new Float32Array(max*18),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setDrawRange(0,0);
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
    const m=new THREE.Mesh(geometry,material);m.frustumCulled=false;scene.add(m);return {m,positions,count:0};
  }
  const white=mesh(1500,'#d5dbe4',.77),yellow=mesh(1500,'#d5b864',.85);
  const edges=mesh(750,'#85919f',.48),roadMeshes=[white,yellow,edges];
  const history = createDrivingHistory(data.frames);
  const pastWhite = mesh(256, '#b7c2d0', .65);
  const pastYellow = mesh(256, '#d5b864', .70);
  roadMeshes.push(pastWhite, pastYellow);
  let historyIndex = -1, pastSegments = [];
  function drawPastLanes(index) {
    if (index !== historyIndex) {
      pastSegments = history.at(index).segments;
      historyIndex = index;
    }
    for (const {a, b, yellow, double} of pastSegments) {
      const layer = yellow ? pastYellow : pastWhite;
      if (double) {
        for (const offset of [-.10, .10]) {
          quad(layer, {x:a.x, y:a.y+offset}, {x:b.x, y:b.y+offset}, .10);
        }
      } else quad(layer, a, b, .11);
    }
  }
  const trajectory = createReplayTrajectory(data);
  const upcomingLanes = createLaneLookAhead(data.frames, trajectory);
  const route = mesh(180, '#218eff', .64);
  const lanePreview = mesh(1600, '#b7c2d0', .60);
  const yellowPreview = mesh(600, '#d5b864', .60);
  let previewFrame, previewLines;
  roadMeshes.push(route, lanePreview, yellowPreview);

  function drawLookAhead(time, frame) {
    const path = trajectory.pathAt(time, 4);
    for (let i = 1; i < (path?.length ?? 0); i++) {
      quad(route, path[i - 1], path[i], .95, .006);
    }
    if (frame !== previewFrame) {
      previewLines = upcomingLanes.at(frame.t, frame.b);
      previewFrame = frame;
    }
    for (const {points, type, color} of previewLines) {
      for (let i = 1; i < points.length; i++) {
        if ([1,5,7].includes(type) && i % 9 >= 4 || type === 3 && i % 2) continue;
        const layer = color === 2 ? yellowPreview : lanePreview;
        if (type === 5 || type === 6) {
          for (const offset of [-.10,.10]) {
            const a = points[i-1], b = points[i];
            quad(layer, {x:a.x,y:a.y+offset}, {x:b.x,y:b.y+offset}, .10);
          }
        } else quad(layer, points[i-1], points[i], .10);
      }
    }
  }

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
  function setTime(t){
    if(disposed)return;
    time=t;
    const f=at(t);lastFrame=f;
    for(const target of roadMeshes)target.count=0;
    const active=new Set();
    if(f) {
      drawPastLanes(globalThis.perceptionFrameIndex(data.frames, f.t));
      drawLookAhead(t, f);
      drawRecordedBoundaries(f.b);
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
    return f;
  }
  resize();
  return {canvas,get hasRoutePreview(){return route.count>0;},setSize(w,h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();},setTime,setView(value){view=value;if(view==='overhead'){camera.position.set(0,55,8);camera.lookAt(0,0,-12);}else{camera.position.set(0,15,25);camera.lookAt(0,0,-14);}setTime(time);},inspect(){return {time,historySegments:pastWhite.count+pastYellow.count,routeSegments:route.count,previewSegments:lanePreview.count+yellowPreview.count,objects:actors.size,lanes:lastFrame?.b.length||0,markingSegments:white.count+yellow.count,edgeSegments:edges.count,signs:[...signActors.values()].map(a=>({kind:a.userData.kind,x:a.position.x,z:a.position.z})),recognizedSigns:lastSigns.display.map(s=>({kind:s.kind,value:s.value,unit:s.unit})),model:fleet.meta.identity,actors:[...actors.values()].map(a=>({direction:a.userData.motion,heading:a.rotation.y}))};},dispose(){if(disposed)return;disposed=true;observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);release(scene);for(const texture of signTextures)texture.dispose();signTextures.clear();fleet.dispose();envTarget.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
  } catch(error) {cleanupObserver?.disconnect();if(cleanupScene)release(cleanupScene);for(const texture of signTextures)texture.dispose();signTextures.clear();cleanupEnvironment?.dispose();fleet.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();throw error;}
}
