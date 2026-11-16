/* Approved, unbranded standard G20 geometry. Read once and shared by all cars.
   Coordinate convention: +X right, +Y up, -Z vehicle front. */
export async function loadStandardFleet(THREE,bytes){
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),buffer=await new Response(stream).arrayBuffer(),headerLength=new DataView(buffer).getUint32(0,true),meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,headerLength)));let offset=4+headerLength;
 const rawPosition=new Int16Array(buffer,offset,meta.vertices*3);offset+=meta.vertices*6;const rawNormal=new Int8Array(buffer,offset,meta.vertices*3);offset+=meta.vertices*3;offset=(offset+3)&~3;
 const input=new Uint8Array(buffer),indices=meta.vertices<65536?new Uint16Array(meta.indices):new Uint32Array(meta.indices);let pointer=offset,previous=0;
 for(let i=0;i<meta.indices;i++){let value=0,shift=0,byte;do{if(pointer>=input.length||shift>28)throw new Error('Invalid car geometry');byte=input[pointer++];value|=(byte&127)<<shift;shift+=7;}while(byte&128);previous+=(value>>>1)^-(value&1);if(previous<0||previous>=meta.vertices)throw new Error('Car index out of range');indices[i]=previous;}
 const p=new Float32Array(rawPosition.length),n=new Float32Array(rawNormal.length);for(let i=0;i<p.length;i++){p[i]=rawPosition[i]/meta.scale;n[i]=rawNormal[i]/meta.normalScale;}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.BufferAttribute(n,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));meta.parts.forEach((part,i)=>geometry.addGroup(part.start,part.count,i));geometry.computeBoundingSphere();
 function make(colors,options={}){
  const own=!!options.own,light=colors.sceneLight||colors.fg,dark=colors.sceneDark||colors.bg;
  const specs={paint:{color:own?colors.blue.clone().multiplyScalar(.28):light.clone().multiplyScalar(.055),metalness:.14,roughness:.58,clearcoat:.06},glass:{color:dark.clone().lerp(light,.025),metalness:.25,roughness:.22},trim:{color:dark.clone().lerp(light,.025),metalness:.18,roughness:.6},lens:{color:light.clone().multiplyScalar(.08),metalness:0,roughness:.15,transparent:true,opacity:.12,depthWrite:false},tire:{color:dark.clone().multiplyScalar(.45),metalness:0,roughness:.92},wheel:{color:light.clone().multiplyScalar(.13),metalness:.6,roughness:.45},metal:{color:light.clone().multiplyScalar(.13),metalness:.6,roughness:.4},tail:{color:colors.red.clone().multiplyScalar(.65),emissive:colors.red,emissiveIntensity:.35,metalness:0,roughness:.3}};
  const materials=meta.parts.map(part=>new THREE.MeshPhysicalMaterial({...specs[part.kind],side:THREE.DoubleSide})),mesh=new THREE.Mesh(geometry,materials);mesh.name='Unbranded standard sedan';mesh.userData.sharedGeometry=true;
  const group=new THREE.Group();group.add(mesh);group.userData={modelKey:'car',modelSource:meta.identity,real3d:true,lamps:[],modelHeight:options.height||meta.baseHeight};
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,24),new THREE.MeshBasicMaterial({color:dark.clone().multiplyScalar(.25),transparent:true,opacity:.28,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.006;shadow.scale.set(1.02,2.28,1);group.add(shadow);
  if(own)for(const side of [-1,1]){const lamp=new THREE.Mesh(new THREE.BoxGeometry(.20,.045,.025),new THREE.MeshBasicMaterial({color:colors.orange,toneMapped:false}));lamp.position.set(side*.71,.95,2.31);lamp.userData.side=side;lamp.visible=false;group.add(lamp);group.userData.lamps.push(lamp);}
  group.scale.set((options.width||meta.baseWidth)/meta.baseWidth,(options.height||meta.baseHeight)/meta.baseHeight,(options.length||meta.baseLength)/meta.baseLength);return group;
 }
 return {make,meta,dispose:()=>geometry.dispose()};
}
