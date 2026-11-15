'use strict';
var table = new Uint32Array(256);
for (var i = 0; i < 256; i++) { var c = i; for (var j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[i] = c >>> 0; }
function crc32(b) { var c = 0xffffffff; for (var i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function header() { var b = Buffer.alloc(16); b.write('BVR1'); b.writeUInt32LE(1,4); b.writeUInt32LE(16,8); return b; }
function validTime(t) { return Number.isSafeInteger(t) && t >= 0; }
function record(type, atUs, payload) {
 if (!Buffer.isBuffer(payload) || !payload.length || (type !== 1 && type !== 2) || payload.length > (type === 1 ? 65536 : 262144)) throw new Error('Invalid record type or payload length');
 if (!validTime(atUs)) throw new Error('Non-exact timestamp');
 var b = Buffer.alloc(24 + payload.length); b.write('BVRR'); b[4] = type; b.writeUInt16LE(24,6); b.writeUInt32LE(payload.length,8); b.writeUInt32LE(atUs % 4294967296,12); b.writeUInt32LE(Math.floor(atUs / 4294967296),16); b.writeUInt32LE(crc32(payload),20); payload.copy(b,24); return b;
}
function checkHeader(b) { if (b.length < 16) return 'Truncated file header'; if (b.toString('ascii',0,4) !== 'BVR1' || b.readUInt32LE(4) !== 1 || b.readUInt32LE(8) !== 16 || b.readUInt32LE(12) !== 0) return 'Invalid archive version/header'; return null; }
function recordHeader(b) {
 if (b.length < 24) throw new Error('Truncated record header');
 if (b.toString('ascii',0,4) !== 'BVRR') throw new Error('Invalid record magic');
 if (b[5] !== 0) throw new Error('Invalid record flags');
 var type=b[4],n=b.readUInt32LE(8),t=b.readUInt32LE(12)+b.readUInt32LE(16)*4294967296;
 if (b.readUInt16LE(6)!==24 || (type!==1 && type!==2) || !n || n>(type===1?65536:262144)) throw new Error('Invalid record type/length/header');
 if (!validTime(t)) throw new Error('Non-exact timestamp');
 return {type:type,atUs:t,payloadBytes:n,crc:b.readUInt32LE(20)};
}
function scan(b) {
 var result={records:[],truncated:false,error:null,validBytes:0};
 if (!Buffer.isBuffer(b)) { result.error='Archive must be a Buffer'; return result; }
 if (b.length < 16) { result.truncated=true; return result; }
 result.error=checkHeader(b); if(result.error)return result; result.validBytes=16;
 var off=16;
 while(off < b.length) {
  if(b.length-off<24){result.truncated=true;break;}
  var r;try{r=recordHeader(b.slice(off,off+24));}catch(e){result.error=e.message;break;}
  if(b.length-off-24<r.payloadBytes){result.truncated=true;break;}
  r.payload=b.slice(off+24,off+24+r.payloadBytes);if(crc32(r.payload)!==r.crc){result.error='CRC mismatch';break;}
  r.offset=off;result.records.push(r);off+=24+r.payloadBytes;result.validBytes=off;
 }
 return result;
}
module.exports={header:header,record:record,scan:scan,crc32:crc32,checkHeader:checkHeader,recordHeader:recordHeader};
