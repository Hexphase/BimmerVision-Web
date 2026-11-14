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
 const v=await(await m.fetch('/api/v1/version')).json();assert.equal(v.version,'0.1.0');
});
