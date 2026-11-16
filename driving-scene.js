import * as THREE from './vendor/three/three.module.min.js';
import {RoomEnvironment} from './vendor/three/RoomEnvironment.js';
import {loadStandardFleet} from './standard-fleet.js';
import {createRoadEstimator} from './road-estimation.js';

// Geometry is public site content; recording coordinates never leave the browser.
let modelBytes;
async function fleetBytes() {
  if(!modelBytes)modelBytes=fetch(new URL('./assets/vehicles/sedan.bin.gz',import.meta.url)).then(r=>{if(!r.ok)throw Error('Vehicle asset unavailable');return r.arrayBuffer();}).catch(e=>{modelBytes=null;throw e;});
  return modelBytes;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,u)=>a+(b-a)*u;
const paintStyle=type=>({1:{dashed:true},2:{},3:{dashed:true,dotted:true},5:{dashed:true,double:true},6:{double:true},7:{dashed:true},8:{}})[type];
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
  const camera=new THREE.PerspectiveCamera(38,1,.1,220);camera.position.set(0,14,22);camera.lookAt(0,0,-25);
  scene.add(new THREE.HemisphereLight(0xffffff,0x70747b,1.2));
  const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-18,30,10);scene.add(sun);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),envTarget=pmrem.fromScene(environment,.04);cleanupEnvironment=envTarget;scene.environment=envTarget.texture;environment.dispose();pmrem.dispose();
  const colors={sceneLight:new THREE.Color('#f6f7fa'),sceneDark:new THREE.Color('#101216'),blue:new THREE.Color('#278cff'),red:new THREE.Color('#df3349'),orange:new THREE.Color('#ffb23e')};
  const ego=fleet.make(colors,{own:true});scene.add(ego);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshBasicMaterial({color:'#101216',toneMapped:false}));ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
  const estimator=createRoadEstimator(data),motion=globalThis.createVehicleMotion(data),actors=new Map(),roadCache=new Map(),signActors=new Map();
  let disposed=false,time=0,view='perspective',lastFrame=null,lastSigns={camera:[],display:[]};
  function mesh(max,color,opacity) {
    const positions=new Float32Array(max*18),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setDrawRange(0,0);
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
    const m=new THREE.Mesh(geometry,material);m.frustumCulled=false;scene.add(m);return {m,positions,count:0};
  }
  const white=mesh(1500,'#c5cbd4',.38),yellow=mesh(1500,'#d5b864',.43),ribbon=mesh(200,'#278cff',.22),arrow=mesh(80,'#409eff',.8);
  function quad(target,a,b,width,y=.02) {
    const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1,nx=-dy/n*width/2,ny=dx/n*width/2,i=target.count*18;
    if(i+18>target.positions.length)return;
    target.positions.set([-(a.y+ny),y,-(a.x+nx),-(a.y-ny),y,-(a.x-nx),-(b.y+ny),y,-(b.x+nx),-(a.y-ny),y,-(a.x-nx),-(b.y-ny),y,-(b.x-nx),-(b.y+ny),y,-(b.x+nx)],i);target.count++;
  }
  const at=t=>globalThis.frameAt(data.frames,t);
  function road(f){const key=f.t+':'+(f.b.length?'lanes':'no-lanes');if(!roadCache.has(key)){roadCache.set(key,estimator.estimate(f));if(roadCache.size>12)roadCache.delete(roadCache.keys().next().value);}return roadCache.get(key);}
  function curveAt(curve,s){let i=Math.min(curve.length-2,Math.max(0,Math.floor(s/1.5)));while(i>0&&curve[i].s>s)i--;while(i<curve.length-2&&curve[i+1].s<s)i++;const a=curve[i],b=curve[i+1]||a,u=clamp((s-a.s)/(b.s-a.s||1),0,1);return {x:lerp(a.x,b.x,u),y:lerp(a.y,b.y,u)};}
  function boundaries(f,curve) {
    const next=data.frames[globalThis.perceptionFrameIndex(data.frames,f.t)+1],u=next&&next.t-f.t<.35?clamp((time-f.t)/(next.t-f.t),0,1):0;
    const nextCurve=u?road(next).curve:null;
    function point(s,offset=0) {
      const p=curveAt(curve,s),a=curveAt(curve,Math.max(0,s-1)),b=curveAt(curve,s+1),dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1;
      if(nextCurve){const q=curveAt(nextCurve,s);p.x=lerp(p.x,q.x,u);p.y=lerp(p.y,q.y,u);}
      return {x:p.x-dy/n*offset,y:p.y+dx/n*offset};
    }
    const end=Math.min(110,curve.at(-1).s),width=f.w||3.5,phase=(time*(f.v||0)*.44704)%9;
    // Nearby sensor geometry blends continuously into the recorded route ahead.
    for(const line of f.b) {
      const style=paintStyle(line[7]);if(!style)continue;
      const nextLine=next?.b.find(b=>b[0]===line[0]&&b[8]===line[8]);
      const offset=nextLine?lerp(line[2],nextLine[2],u):line[2];
      const center=f.b.find(b=>b[0]===0),right=f.b.find(b=>b[0]===1),center0=center&&right?(center[2]+right[2])/2:0;
      const target=line[9]===2?yellow:white;
      for(let s=0;s<end;s+=1.5) {
        if(style.dashed&&(s+phase)%(style.dotted?2:9)>(style.dotted?.5:3.5))continue;
        for(const shift of style.double?[-.10,.10]:[0]) {
          function marking(d){const p=point(d,offset-center0+shift),dx=Math.max(0,d-line[1]),observed=line[2]+Math.tan(line[3]*Math.PI/180)*dx+line[4]*dx*dx/2+line[5]*dx*dx*dx/6+shift;
            const weight=d<=line[1]+line[6]?Math.exp(-d/22):0;p.y=lerp(p.y,observed,weight);return p;}
          quad(target,marking(s),marking(s+1.5),.065);
        }
      }
    }
    if(f.b.length||data.gps.length>2)for(let s=3;s<Math.min(end,70);s+=1.5)quad(ribbon,point(s),point(s+1.5),width*.22,.012);
    // Only show a merge destination with positive adjacent-lane evidence.
    const turn=data.events?.find(e=>e.kind==='turn'&&time>=e.planStart&&time<=e.end),change=data.events?.find(e=>e.kind==='change'&&time>=e.planStart&&time<=e.end),side=f.indicator==='right'?-1:f.indicator==='left'?1:0,adjacent=side===-1?f.rightLane:f.leftLane;
    if(turn){for(let s=3;s<Math.min(end,35);s+=1.5)quad(arrow,point(s),point(s+1.5),.14,.035);}
    else if(side && (adjacent==='present'||change?.side===f.indicator)) {
      const boundary=f.b.find(b=>b[0]===(side===-1?1:0)),destination=boundary?boundary[2]+side*width/2:side*width;
      const remaining=change?clamp((change.end-time)/(change.end-change.start),0,1):clamp(Math.abs(destination)/width,0,1),length=5+remaining*20;
      const target=change?side*width*remaining:destination;
      for(let s=3;s<length;s+=1){const u=clamp((s-3)/(length-3),0,1),v=clamp((s-2)/(length-3),0,1);quad(arrow,point(s,target*u*u*(3-2*u)),point(s+1,target*v*v*(3-2*v)),.14,.035);}
    }
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
  function setTime(t) {
    if(disposed)return;time=t;const f=at(t);lastFrame=f;
    for(const target of [white,yellow,ribbon,arrow])target.count=0;
    const active=new Set();
    if(f) {
      const curve=road(f).curve;if(curve.length>1)boundaries(f,curve);
      const next=data.frames[globalThis.perceptionFrameIndex(data.frames,f.t)+1],u=next&&next.t-f.t<.35?clamp((t-f.t)/(next.t-f.t),0,1):0;
      for(const o of f.o) {
        if(o[1]< -12 || o[1]>150 || (o[6]!==null&&o[6]<30))continue;
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
    for(const target of [white,yellow,ribbon,arrow]){target.m.geometry.setDrawRange(0,target.count*6);target.m.geometry.attributes.position.needsUpdate=true;}
    updateSigns(t);renderer.render(scene,camera);
    return f;
  }
  resize();
  return {canvas,setSize(w,h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();},setTime,setView(value){view=value;if(view==='overhead'){camera.position.set(0,65,8);camera.lookAt(0,0,-22);}else{camera.position.set(0,14,22);camera.lookAt(0,0,-25);}setTime(time);},inspect(){return {time,objects:actors.size,lanes:lastFrame?.b.length||0,routePoints:data.gps.length,signs:[...signActors.values()].map(a=>({kind:a.userData.kind,x:a.position.x,z:a.position.z})),recognizedSigns:lastSigns.display.map(s=>({kind:s.kind,value:s.value,unit:s.unit})),model:fleet.meta.identity,actors:[...actors.values()].map(a=>({direction:a.userData.motion,heading:a.rotation.y}))};},dispose(){if(disposed)return;disposed=true;observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);release(scene);for(const texture of signTextures)texture.dispose();signTextures.clear();fleet.dispose();envTarget.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}};
  } catch(error) {cleanupObserver?.disconnect();if(cleanupScene)release(cleanupScene);for(const texture of signTextures)texture.dispose();signTextures.clear();cleanupEnvironment?.dispose();fleet.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();throw error;}
}
