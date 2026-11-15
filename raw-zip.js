/* Read-only original recording export. Stored ZIP: no recompression or clip-sized JS buffers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BVRawZip=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MAX=0xffffffff,CHUNK=65536,encoder=new TextEncoder(),table=new Uint32Array(256);
for(let i=0;i<256;i++){let c=i;for(let b=0;b<8;b++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[i]=c>>>0;}
function crcPart(crc,bytes){for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return crc>>>0;}
function crc32(bytes){return (crcPart(0xffffffff,bytes)^0xffffffff)>>>0;}
function block(size){const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);return {bytes,u16:(p,n)=>view.setUint16(p,n,true),u32:(p,n)=>view.setUint32(p,n,true)};}
function createStream(files,folder,{signal,guard=()=>{}}={}){
 if(!/^BimmerVision-[a-z0-9-]+$/i.test(folder))throw Error('Invalid ZIP folder');
 const seen=new Set();for(const f of files){if(!['capture.bvr','manifest.json','mapping.json'].includes(f.name)||seen.has(f.name)||!Number.isSafeInteger(f.file?.size))throw Error('Invalid original recording file');if(f.name!=='capture.bvr'&&f.file.size>1048576)throw Error('Original metadata file is too large');seen.add(f.name);}
 const capture=files.find(f=>f.name==='capture.bvr')?.file;
 if(!capture||!seen.has('manifest.json'))throw Error('Original recording files are incomplete');
 if(capture.size*5+1048576>MAX)throw Error('Raw ZIP is too large. Copy this recording directly from the USB drive.');
 function check(){if(signal?.aborted)throw signal.reason||new DOMException('ZIP cancelled','AbortError');guard();}
 async function* fileChunks(file){for(let pos=0;pos<file.size;pos+=CHUNK){check();const b=new Uint8Array(await file.slice(pos,pos+CHUNK).arrayBuffer());if(b.length!==Math.min(CHUNK,file.size-pos))throw Error('Original file read interrupted');yield b;}}
 async function* metadata(){
  let pos=16,at=-1,window=new Uint8Array();
  async function read(offset,size){check();if(offset<at||offset+size>at+window.length){at=offset;window=new Uint8Array(await capture.slice(offset,Math.min(capture.size,offset+Math.max(CHUNK,size))).arrayBuffer());}const b=window.subarray(offset-at,offset-at+size);if(b.length!==size)throw Error('Truncated recording metadata');return b;}
  const header=await read(0,16),dv=new DataView(header.buffer,header.byteOffset,header.byteLength);
  if(String.fromCharCode(...header.subarray(0,4))!=='BVR1'||dv.getUint32(4,true)!==1||dv.getUint32(8,true)!==16||dv.getUint32(12,true)!==0)throw Error('Invalid BVR archive header');
  while(pos<capture.size){
   const h=await read(pos,24),v=new DataView(h.buffer,h.byteOffset,h.byteLength),kind=h[4],length=v.getUint32(8,true),time=v.getUint32(12,true)+v.getUint32(16,true)*4294967296;
   if(String.fromCharCode(...h.subarray(0,4))!=='BVRR'||h[5]!==0||v.getUint16(6,true)!==24||![1,2].includes(kind)||!length||length>(kind===1?65536:262144)||!Number.isSafeInteger(time)||pos+24+length>capture.size)throw Error('Invalid BVR record');
   if(kind===2){const b=await read(pos+24,length);if(crc32(b)!==v.getUint32(20,true))throw Error('Metadata CRC mismatch');yield encoder.encode(JSON.stringify({atMonotonicUs:time,event:JSON.parse(new TextDecoder().decode(b))})+'\n');}
   pos+=24+length;
  }
 }
 async function* generate(){
  const entries=files.map(f=>({name:f.name,produce:()=>fileChunks(f.file)}));
  entries.push({name:'metadata.jsonl',produce:metadata});
  entries.push({name:'README.txt',produce:async function*(){yield encoder.encode('BimmerVision original recording\n\ncapture.bvr is the unchanged original BVR1 archive containing compressed camera video and all recorded metadata. It is not an MP4. Use a compatible BimmerVision viewer.\nmanifest.json and optional mapping.json are copied unchanged from the selected USB folder. Browser-only camera assignments are not substituted for original metadata.\nmetadata.jsonl contains atMonotonicUs and event for each CRC-validated original metadata event. Use manifest.startMonotonicUs for relative time. Raw perception bytes remain base64 with their recorded source identifiers and schemas. Missing data is not a negative detection.\nNo original files were changed or uploaded. No separate H.264 file is included.\n');}});
  let offset=0;const central=[];
  for(const entry of entries){
   check();const name=encoder.encode(folder+'/'+entry.name),start=offset,h=block(30);h.u32(0,0x04034b50);h.u16(4,20);h.u16(6,0x0808);h.u16(12,33);h.u16(26,name.length);yield h.bytes;yield name;offset+=30+name.length;
   let size=0,crc=0xffffffff;
   for await(const value of entry.produce()){for(let p=0;p<value.length;p+=CHUNK){check();const b=value.subarray(p,p+CHUNK);size+=b.length;offset+=b.length;if(offset>MAX||size>MAX)throw Error('ZIP capacity exceeded');crc=crcPart(crc,b);yield b;}}
   crc=(crc^0xffffffff)>>>0;const d=block(16);d.u32(0,0x08074b50);d.u32(4,crc);d.u32(8,size);d.u32(12,size);yield d.bytes;offset+=16;
   const c=block(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(8,0x0808);c.u16(14,33);c.u32(16,crc);c.u32(20,size);c.u32(24,size);c.u16(28,name.length);c.u32(42,start);central.push(c.bytes,name);
  }
  check();const start=offset;for(const b of central){yield b;offset+=b.length;}const end=block(22);end.u32(0,0x06054b50);end.u16(8,entries.length);end.u16(10,entries.length);end.u32(12,offset-start);end.u32(16,start);yield end.bytes;
 }
 const iterator=generate();let cancelled=false;
 return new ReadableStream({async pull(controller){try{check();const result=await iterator.next();if(cancelled)return;if(result.done)controller.close();else controller.enqueue(result.value);}catch(e){if(!cancelled)controller.error(e);}},cancel(){cancelled=true;return iterator.return();}});
}
return {createStream,crc32};
});
