/* Synthetic archive for parser/transfer-order tests; not a playable camera video. */
module.exports=function(){
 const chunks=[],header=Buffer.alloc(16);header.write('BVR1');header.writeUInt32LE(1,4);header.writeUInt32LE(16,8);chunks.push(header);let sequence=0;
 function crc32(b){let c=-1;for(const x of b){c^=x;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return(c^-1)>>>0;}
 function packet(nal,frame,marker){const payload=Buffer.alloc(12+nal.length);payload[0]=0x80;payload[1]=96|(marker?128:0);payload.writeUInt16BE(sequence++%65536,2);payload.writeUInt32BE(frame*3000,4);payload.writeUInt32BE(0x12345678,8);Buffer.from(nal).copy(payload,12);const h=Buffer.alloc(24);h.write('BVRR');h[4]=1;h.writeUInt16LE(24,6);h.writeUInt32LE(payload.length,8);h.writeBigUInt64LE(BigInt(1000000+Math.floor(frame*1000000/30)),12);h.writeUInt32LE(crc32(payload),20);chunks.push(h,payload);}
 packet([0x67,0x42,0x00,0x1f],0,false);packet([0x68,0xce,0x06,0xe2],0,false);for(let i=0;i<120;i++)packet([0x65,0x88,0x84,0x21],i,true);
 const bytes=new Uint8Array(Buffer.concat(chunks));return {bytes,manifest:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',schemaVersion:1,format:'bvr1',complete:true,startMonotonicUs:1000000,endMonotonicUs:5000000,durationSeconds:4,bytes:bytes.length}};
};
