 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 let yields=0,clock=0;
 const scope={module:{exports:{}},DOMException,AbortController,performance:{now:()=>clock},setTimeout(fn,ms){if(ms===0){yields++;fn();return 0;}return setTimeout(fn,ms);},clearTimeout,sessionStorage:{getItem:()=>null},window:{},fetch:async()=>new Response(new ReadableStream({start(c){for(let i=0;i<128;i++)c.enqueue(new Uint8Array([i]));c.close();}}))};
 vm.runInNewContext(fs.readFileSync(require.resolve('../player'),'utf8'),scope);
 const p=Object.create(scope.module.exports.BimmerVisionPlayer.prototype),controller=new AbortController();
 Object.assign(p,{_activeStreamAbort:controller,_setState(){}});
 return {p,signal:controller.signal,get yields(){return yields;},tick(){clock+=1;}};
}
test('cached recording replay yields by elapsed work instead of delaying every chunk',async()=>{
 const h=harness(),bytes=[];await h.p._downloadRecording('/capture',h.signal,value=>{bytes.push(...value);h.tick();});
 assert.equal(bytes.length,128);assert.equal(h.p.loadedByteOffset,128);
 assert(h.yields<=8,'128 ready chunks should need at most eight paint yields, observed '+h.yields);
});
