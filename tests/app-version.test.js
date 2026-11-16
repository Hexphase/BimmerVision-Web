'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AppVersion,valid}=require('../app-version'),bundled=require('../app-version-data');
test('footer uses a verified offline iDrive version independently of the web build',()=>{
 const updates=[];new AppVersion({bundled,onChange:v=>updates.push(v)});assert(valid(bundled.version));assert.equal(bundled.repository,'Hexphase/BimmerVision');assert.deepEqual(updates[0],{version:bundled.version,source:'bundled'});
});
test('online refresh reads only the canonical app version without cookies or private data',async()=>{
 let request;const v=new AppVersion({bundled,fetcher:async(url,options)=>{request={url,options};return new Response(JSON.stringify({version:'0.2.37',repository:'Hexphase/BimmerVision'}));}});await v.refresh();assert.equal(v.version,'0.2.37');assert.equal(v.origin,'upstream');assert.equal(request.url,'https://raw.githubusercontent.com/Hexphase/BimmerVision/main/recorder/files/version.json');assert.equal(request.options.credentials,'omit');assert.equal(request.options.referrerPolicy,'no-referrer');assert.equal(request.options.body,undefined);
});
test('a connected car version stays authoritative while an upstream request finishes',async()=>{
 let resolve;const updates=[],v=new AppVersion({bundled,onChange:info=>updates.push(info),fetcher:()=>new Promise(r=>resolve=r)}),pending=v.refresh();v.setConnected('0.2.30');resolve(new Response(JSON.stringify({version:'0.2.37',repository:'Hexphase/BimmerVision'})));await pending;assert.deepEqual(updates.at(-1),{version:'0.2.30',source:'connected'});v.setConnected(null);assert.deepEqual(updates.at(-1),{version:'0.2.37',source:'upstream'});
});
test('invalid metadata, network failures and offline timeouts retain the known version',async()=>{
 for(const fetcher of [async()=>new Response('{}'),async()=>new Response(JSON.stringify({version:'<script>',repository:'Hexphase/BimmerVision'})),async()=>{throw Error('offline');},()=>new Promise(()=>{})]){const v=new AppVersion({bundled,fetcher,timeoutMs:5});await v.refresh();assert.equal(v.version,bundled.version);}
});
test('refreshes are deduplicated and rate limited until forced',async()=>{
 let calls=0,resolve;const v=new AppVersion({bundled,now:()=>1,fetcher:()=>{calls++;return new Promise(r=>resolve=r);}}),pending=v.refresh();assert.equal(v.refresh(),pending);resolve(new Response(JSON.stringify(bundled)));await pending;await v.refresh();assert.equal(calls,1);const forced=v.refresh({force:true});resolve(new Response(JSON.stringify(bundled)));await forced;assert.equal(calls,2);
});
