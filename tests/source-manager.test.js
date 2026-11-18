'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SourceManager}=require('../source-manager');
test('API requests stay with selected source and never go to the hosted site',async()=>{
 let external=0,calls=[];const m=new SourceManager({nativeFetch:async()=>{external++;throw Error('network');}});
 assert.equal((await m.fetch('/api/v1/recordings')).status,503);
 m.setSource({kind:'usb',name:'Drive',fetch:async(path,options)=>{calls.push([path,options]);return new Response('{}');},close(){}});
 await m.ready;await m.fetch('/api/v1/recordings');assert.equal(external,0);assert.equal(calls[0][0],'/api/v1/recordings');
 await assert.rejects(m.fetch('https://evil.example/api/v1/recordings'),/relative|API/);
});
test('switching source closes the old source and exposes view-only state',async()=>{
 let closed=0;const m=new SourceManager({nativeFetch:fetch});const a={kind:'usb',name:'USB',readOnly:true,fetch(){},close(){closed++;}};
 m.setSource(a);assert.equal(m.readOnly,true);m.setSource({kind:'car',name:'Car',readOnly:false,fetch(){}});assert.equal(closed,1);assert.equal(m.readOnly,false);
});
test('USB metadata is local and unsupported operations fail rather than uploading',async()=>{
 const m=new SourceManager({nativeFetch:()=>{throw Error('Unexpected network')}});m.setSource({kind:'usb',readOnly:true,fetch:async()=>new Response('{}')});
 const c=await (await m.fetch('/api/v1/capabilities')).json();assert.equal(c.nativePreview,false);assert.equal(c.readOnly,true);
 const v=await(await m.fetch('/api/v1/version')).json();assert.equal(v.version,require('../package.json').version);
});
test('late requests from replaced sources cannot return old account data',async()=>{let release;const manager=new SourceManager();manager.setSource({kind:'drive',fetch:()=>new Promise(resolve=>release=resolve)});const pending=manager.fetch('/api/v1/recordings');manager.setSource({kind:'usb',fetch:async()=>new Response('new')});release(new Response('old private data'));await assert.rejects(pending,{name:'AbortError'});});
test('USB locking capabilities remain distinct from deletion',async()=>{const m=new SourceManager();m.setSource({kind:'usb',readOnly:false,canLock:true,canDelete:false,fetch:async()=>new Response('{}')});const c=await(await m.fetch('/api/v1/capabilities')).json();assert.equal(c.readOnly,false);assert.equal(c.canLock,true);assert.equal(c.canDelete,false);});
test('rejected lock requests throw before callers can mark a recording protected',async()=>{for(const status of [403,409,507]){const m=new SourceManager();m.setSource({kind:'car',fetch:async()=>new Response('{"error":"Lock not saved"}',{status})});await assert.rejects(m.fetch('/api/v1/recordings/id/lock',{method:'POST'}),/Lock not saved/);}});
