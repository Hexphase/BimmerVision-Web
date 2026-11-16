'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sourceAPI = require('../local-source.js');
const ID = '12345678-1234-1234-1234-123456789abc';
function crc32(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); } return (c^-1)>>>0; }
function archive(events = []) {
  const header = Buffer.alloc(16); header.write('BVR1'); header.writeUInt32LE(1,4); header.writeUInt32LE(16,8);
  return Buffer.concat([header, ...events.map(event => { const data = Buffer.from(JSON.stringify(event.obj)); const h=Buffer.alloc(24); h.write('BVRR');h[4]=2;h.writeUInt16LE(24,6);h.writeUInt32LE(data.length,8);h.writeUInt32LE(event.atUs,12);h.writeUInt32LE(event.badCRC?0:crc32(data),20); return Buffer.concat([h,data]); })]);
}
function file(path, contents) { const blob = new Blob([contents]); Object.defineProperties(blob, {name:{value:path.split('/').pop()},webkitRelativePath:{value:path}}); return blob; }
function fixture(root = 'USB/BimmerVision', changes = {}, bytes = archive()) {
  const manifest = {id:ID,schemaVersion:1,format:'bvr1',complete:true,bytes:bytes.length,startMonotonicUs:1000000,...changes};
  return [file(`${root}/${ID}/manifest.json`,JSON.stringify(manifest)),file(`${root}/${ID}/capture.bvr`,bytes)];
}
const list = async s => (await (await s.fetch('/api/v1/recordings')).json()).recordings;
const mapping = {schemaVersion:1,confirmed:true,phase0:'frontRear',phase1:'leftRight',flipHalves:false};
test('USB raw ZIP remains read-only and exports original manifest bytes rather than browser mappings',async()=>{const files=fixture(),source=await sourceAPI.fromFiles(files);try{const response=await source.fetch(`/api/v1/recordings/${ID}/raw.zip`);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/zip');const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);assert.equal(source.readOnly,true);assert.equal(files.length,2);}finally{source.close();await source.indexing;}});
test('accepts supported USB roots and streams byte ranges without copying whole capture', async () => {
  for (const root of ['USB/BimmerVision','BimmerVision','Library']) {
    const files=fixture(root); files[1].arrayBuffer=()=>{throw Error('whole-file read forbidden');};
    const source=await sourceAPI.fromFiles(files); assert.equal(source.readOnly,true);assert.equal((await list(source)).length,1);
    const response=await source.fetch(`/api/v1/recordings/${ID}/capture.bvr`,{headers:{Range:'bytes=0-3'}});
    assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 0-3/16');assert.equal(await response.text(),'BVR1');
    assert.equal(await (await source.fetch(`/api/v1/recordings/${ID}/capture.bvr`,{headers:{Range:'bytes=-4'}})).arrayBuffer().then(b=>b.byteLength),4);
    for (const Range of ['bytes=16-','bytes=-0','bytes=0-1,3-4','bytes=9-1','bytes=9007199254740992-','bytes=-9007199254740992']) assert.equal((await source.fetch(`/api/v1/recordings/${ID}/capture.bvr`,{headers:{Range}})).status,416);
    source.close();await source.indexing;
  }
});
test('rejects unsafe paths, partials, invalid and duplicate IDs, mismatched size and oversized manifests',async()=>{
  for(const changes of [{complete:false},{schemaVersion:2},{format:'bad'},{id:'bad'},{bytes:20}]){const s=await sourceAPI.fromFiles(fixture('Library',changes));assert.equal((await list(s)).length,0);s.close();}
  for (const root of ['../Library','USB/.partials','USB/foo.partial']) {const s=await sourceAPI.fromFiles(fixture(root));assert.equal((await list(s)).length,0);}
  const duplicate=await sourceAPI.fromFiles([...fixture('A'),...fixture('B')]);assert.equal((await list(duplicate)).length,0);assert.match(duplicate.warnings[0],/Duplicate/);
  const oversized=fixture();oversized[0]=file(`USB/${ID}/manifest.json`,' '.repeat(1048577));const s=await sourceAPI.fromFiles(oversized);assert.equal((await list(s)).length,0);
});
test('write methods are denied and mapping writes stay solely in browser storage',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  const files=fixture();files.push(file(`USB/BimmerVision/${ID}/mapping.json`,JSON.stringify({...mapping,flipHalves:true})));
  const source=await sourceAPI.fromFiles(files);
  const endpoint=`/api/v1/recordings/${ID}`;
  for(const [path,method] of [[endpoint,'DELETE'],[`${endpoint}/lock`,'POST'],['/api/v1/recordings','DELETE'],[`${endpoint}/capture.bvr`,'PUT']]){const response=await source.fetch(path,{method});assert.equal(response.status,403);assert.match(await response.text(),/USB view only/);}
  assert.equal((await (await source.fetch(`${endpoint}/mapping.json`)).json()).flipHalves,true);
  assert.equal((await source.fetch(`${endpoint}/mapping`,{method:'POST',body:JSON.stringify(mapping)})).status,200);
  assert.equal((await (await source.fetch(`${endpoint}/mapping.json`)).json()).flipHalves,false);
  assert.equal(JSON.parse(await files[2].text()).flipHalves,true); assert.equal(storage.size,1);
  assert.equal((await source.fetch(`${endpoint}/mapping`,{method:'POST',body:'{}'})).status,400);
  source.close();await source.indexing;delete globalThis.localStorage;
});
test('progressively indexes CRC-verified GPS at at most 2Hz and excludes invalid fixes',async()=>{
  const fields=(latitude=30)=>({latitude:{value:latitude},longitude:{value:-97},speed:{value:45}});
  const events=[{atUs:1000000,obj:{type:'telemetry',fields:fields()}},{atUs:1100000,obj:{type:'telemetry',fields:fields()}},{atUs:1500000,obj:{type:'telemetry',fields:fields()}},{atUs:2000000,badCRC:true,obj:{type:'telemetry',fields:fields()}},{atUs:2500000,obj:{type:'telemetry',fields:fields(100)}}];
  const source=await sourceAPI.fromFiles(fixture('Library',{},archive(events)));
  assert.equal((await list(source))[0].routeStatus,'indexing');await source.indexing;
  const recording=(await list(source))[0];assert.equal(recording.routeStatus,'ready');assert.deepEqual(recording.route.map(p=>p.at),[0,.5]);assert.equal(recording.endpoints.start.latitude,30);source.close();
});
test('directory handles request only file reads; cancellation prevents further use',async()=>{
  const files=fixture('Library'); const child={name:ID,kind:'directory',async *entries(){for(const f of files)yield [f.name,{kind:'file',getFile:async()=>f,createWritable(){throw Error('write forbidden');}}];},removeEntry(){throw Error('delete forbidden');}};
  const handle={name:'Library',kind:'directory',async *entries(){yield [ID,child];},requestPermission(){throw Error('no write permission request');}};
  const source=await sourceAPI.fromDirectoryHandle(handle);assert.equal((await list(source)).length,1);source.close();await assert.rejects(()=>source.fetch('/api/v1/recordings'),{name:'AbortError'});await source.indexing;
  const controller=new AbortController();controller.abort();await assert.rejects(()=>sourceAPI.fromFiles(files,{signal:controller.signal}),{name:'AbortError'});
});
test('large compatibility folder listings yield before cataloguing and honour cancellation',async()=>{
 const files=Array.from({length:10000},(_,i)=>({name:'ignored-'+i,webkitRelativePath:'BimmerVision/ignored-'+i})),controller=new AbortController();let yielded=false;setTimeout(()=>{yielded=true;controller.abort();},0);
 await assert.rejects(sourceAPI.fromFiles([...files,...fixture()],{signal:controller.signal}),{name:'AbortError'});assert.equal(yielded,true);
});
test('native directory enumeration yields and can cancel before walking a huge folder',async()=>{
 const controller=new AbortController();let visited=0;const handle={name:'BimmerVision',async*entries(){for(let i=0;i<10000;i++){visited++;yield['ignored-'+i,{kind:'file',getFile(){throw Error('unrelated file must not be read');}}];}}};setTimeout(()=>controller.abort(),0);
 await assert.rejects(sourceAPI.fromDirectoryHandle(handle,{signal:controller.signal}),{name:'AbortError'});assert(visited<=100);
});
