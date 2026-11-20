'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Source=require('../phone-bridge-source');
const ORIGIN='http://192.168.100.1:8765',PUBLIC='https://bimmervision.app',NONCE='1'.repeat(64),ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(respond=true){const listeners=new Set(),sent=[],window={location:{origin:PUBLIC},addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}},opener={closed:false,postMessage(message,target){assert.equal(target,ORIGIN);sent.push(message);if(message.type==='hello')queueMicrotask(()=>emit({bvBridge:1,type:'ready',nonce:NONCE,selectedIds:[ID]}));else if(message.type==='request'&&respond)queueMicrotask(()=>emit({bvBridge:1,type:'response',nonce:NONCE,id:message.id,status:200,headers:{'Content-Type':'application/json','Content-Length':'11'},body:new TextEncoder().encode('{"ok":true}').buffer}));}};
 function emit(data,{origin=ORIGIN,source=opener}={}){for(const fn of listeners)fn({origin,source,data});}
 return {window,opener,sent,emit,connect:options=>Source.connect({window,opener,origin:ORIGIN,nonce:NONCE,...options})};
}
test('fragment secrets are cleared before validating an opener-bound connection',()=>{
 const writes=[],location={origin:PUBLIC,pathname:'/phone-backup.html',hash:'#'+new URLSearchParams({origin:ORIGIN,nonce:NONCE})},opener={closed:false};
 const value=Source.consume(location,{replaceState(...args){writes.push(args[2]);}},opener);assert.equal(value.origin,ORIGIN);assert.equal(value.nonce,NONCE);assert.equal(value.opener,opener);assert.deepEqual(writes,['/phone-backup.html']);
 for(const hash of ['#origin=https://evil.example&nonce='+NONCE,location.hash+'&nonce='+NONCE,location.hash+'&code=secret']){const cleaned=[];assert.throws(()=>Source.consume({...location,hash},{replaceState(...args){cleaned.push(args[2]);}},opener));assert.deepEqual(cleaned,['/phone-backup.html']);}
});
test('popup makes RPC requests without invoking private-IP fetch or sending auth headers',async()=>{
 const original=global.fetch;global.fetch=()=>{throw Error('Private fetch must not run');};const f=fixture(),source=await f.connect();
 try{assert.deepEqual(source.selectedIds,[ID]);assert(Object.isFrozen(source.selectedIds));assert.deepEqual(await(await source.fetch('/api/v1/phone-backup')).json(),{ok:true});assert.equal(f.sent.filter(m=>m.type==='request').length,1);await assert.rejects(source.fetch('/api/v1/phone-backup',{headers:{Authorization:'secret'}}),/credentials/);await assert.rejects(source.fetch('/api/v1/recordings'),/not available/);}
 finally{global.fetch=original;source.close();}
});
test('spoofed replies are ignored and parent disconnect rejects every pending request',async()=>{
 const f=fixture(false),source=await f.connect();let settled=false;const pending=source.fetch('/api/v1/phone-backup').finally(()=>settled=true);const message={bvBridge:1,type:'response',nonce:NONCE,id:1,error:'spoofed'};
 f.emit(message,{origin:'https://evil.example'});f.emit(message,{source:{}});f.emit({...message,nonce:'2'.repeat(64)});await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 f.emit({bvBridge:1,type:'disconnected',nonce:NONCE,error:'Recording source changed.'});await assert.rejects(pending,/source changed/);await assert.rejects(source.fetch('/api/v1/phone-backup'),/source changed/);assert.equal(source.pending.size,0);
});
test('selected additions notify listeners and caller abort sends a bounded cancellation RPC',async()=>{
 const f=fixture(false),source=await f.connect(),seen=[],id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',off=source.onSelection(ids=>seen.push(ids));
 f.emit({bvBridge:1,type:'selection',nonce:NONCE,selectedIds:[id]});assert.deepEqual(seen,[[id]]);off();assert.deepEqual(source.selectedIds,[id]);
 const controller=new AbortController(),pending=source.fetch('/api/v1/phone-backup',{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.sent.at(-1).type,'cancel');assert.equal(f.sent.at(-1).id,1);source.close();
});
test('closed opener and oversized or credential-bearing replies fail without new work',async()=>{
 const f=fixture(false),source=await f.connect(),pending=source.fetch('/api/v1/phone-backup');
 f.emit({bvBridge:1,type:'response',nonce:NONCE,id:1,status:200,headers:{'Content-Length':'1048577'},body:new ArrayBuffer(1048577)});await assert.rejects(pending,/Invalid response/);
 const next=source.fetch('/api/v1/phone-backup');f.emit({bvBridge:1,type:'response',nonce:NONCE,id:2,status:200,headers:{'Content-Length':'0',Authorization:'secret'},body:new ArrayBuffer(0)});await assert.rejects(next,/Invalid response/);
 f.opener.closed=true;await assert.rejects(source.fetch('/api/v1/phone-backup'),/Keep the paired/);source.close();
});
test('return to car sends only an opener-bound completion and leaves an explicit retry when focus is blocked',async()=>{const f=fixture(),source=await f.connect();let focused=0,closed=0;f.opener.focus=()=>{focused++;throw Error('Focus blocked');};f.window.close=()=>{closed++;};assert.equal(source.returnToCar(),false);assert.equal(f.sent.at(-1).type,'complete');assert.equal(f.sent.at(-1).nonce,NONCE);assert.equal(focused,1);assert.equal(closed,1);source.close();source.returnToCar();assert.equal(focused,2);assert.equal(closed,2);});
