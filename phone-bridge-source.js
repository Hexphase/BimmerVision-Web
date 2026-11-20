/* The public popup uses postMessage RPC only. It never opens a private-IP request. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.BVPhoneBridgeSource=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const PUBLIC='https://bimmervision.app',MAX=1048576,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function selection(ids){if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Invalid selected recordings from the car page.');return Object.freeze(ids.map(id=>id.toLowerCase()));}
function privateOrigin(value){const url=new URL(value),parts=url.hostname.split('.');if(url.origin!==value||!['http:','https:'].includes(url.protocol)||url.username||url.password||parts.length!==4||parts.some(p=>! /^(0|[1-9]\d{0,2})$/.test(p)||Number(p)>255))throw Error('Invalid private car origin.');const [a,b]=parts.map(Number);if(!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254))throw Error('Invalid private car origin.');return url.origin;}
function request(path,options={}){
 if(Object.keys(options).some(k=>!['method','headers','body','signal','timeoutMs'].includes(k)))throw Error('Unsupported phone backup request options.');
 const method=options.method||'GET',get=typeof path==='string'&&/^\/api\/v1\/(phone-backup|remote-backup|viewer-heartbeat|capabilities|version)$/.test(path),post=typeof path==='string'&&/^\/api\/v1\/(remote-backup\/queue|phone-backup\/(claim|enqueue|[a-f0-9]{32}\/(read|register|heartbeat|release)))$/.test(path);
 if(!(method==='GET'&&get||method==='POST'&&post))throw Error('This car API is not available through phone backup.');
 const headers=new Headers(options.headers||{});for(const [key,value] of headers)if(key!=='content-type'||value!=='application/json'||method!=='POST')throw Error('Car credentials cannot be supplied through phone backup.');
 if(method==='GET'&&options.body!==undefined)throw Error('Unexpected request body.');
 if(method==='POST'){
  const limit=/\/register$/.test(path)?300*1024:/\/(queue|enqueue)$/.test(path)?60*1024:2048;
  if(typeof options.body!=='string'||new TextEncoder().encode(options.body).byteLength>limit)throw Error('Phone backup request is too large.');
  let body;try{body=JSON.parse(options.body);}catch{throw Error('Use a JSON backup request.');}if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Use a JSON backup request.');
  if(/\/read$/.test(path)&&(!Number.isSafeInteger(body.index)||body.index<0||!Number.isSafeInteger(body.offset)||body.offset<0||!Number.isSafeInteger(body.length)||body.length<1||body.length>MAX||!Number.isSafeInteger(body.offset+body.length)))throw Error('Invalid bounded recording read.');
 }
 const maximum=/\/claim$/.test(path)?605000:/\/(queue|enqueue|register)$/.test(path)||path==='/api/v1/remote-backup'?125000:/\/read$/.test(path)?35000:20000;
 return {path,method,...(options.body===undefined?{}:{body:options.body}),timeoutMs:Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(maximum,options.timeoutMs)):maximum};
}
class PhoneBridgeSource{
 static consume(location,history,opener=root.opener){
  const params=new URLSearchParams((location.hash||'').replace(/^#/,''));history.replaceState({},'',location.pathname+(location.search||''));
  if(location.origin!==PUBLIC||[...params.keys()].some(k=>!['origin','nonce'].includes(k))||params.getAll('origin').length!==1||params.getAll('nonce').length!==1||!/^[a-f0-9]{64}$/.test(params.get('nonce')||'')||!opener||opener.closed)throw Error('Open phone backup from the paired car page and keep that page open.');
  return {origin:privateOrigin(params.get('origin')),nonce:params.get('nonce'),opener};
 }
 static async connect(options={}){const source=new PhoneBridgeSource(options);try{await source.connect();return source;}catch(error){source.close(error.message);throw error;}}
 constructor({origin,nonce,opener=root.opener,window=root,signal,handshakeTimeoutMs=15000}={}){
  this.window=window;this.origin=privateOrigin(origin);this.nonce=nonce;this.opener=opener;this.signal=signal;this.handshakeTimeoutMs=handshakeTimeoutMs;
  if(window.location.origin!==PUBLIC||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||!opener||opener.closed)throw Error('Phone backup connection is unavailable. Reopen it from the car page.');
  this.kind='car';this.name='Car · phone backup';this.readOnly=false;this.pending=new Map();this.listeners=new Set();this.nextId=0;this.closed=false;this.connected=false;
 }
 send(type,fields={}){if(!this.closed)this.opener.postMessage({bvBridge:1,type,nonce:this.nonce,...fields},this.origin);}
 connect(){
  this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
  this.listener=event=>this.receive(event);this.unload=()=>this.close('The phone backup page was closed.');this.abort=()=>this.close('Phone backup connection cancelled.');
  this.window.addEventListener('message',this.listener);this.window.addEventListener('pagehide',this.unload);this.signal?.addEventListener('abort',this.abort,{once:true});
  this.timer=setTimeout(()=>this.close('The paired car page did not respond. Keep it open and retry phone backup.'),this.handshakeTimeoutMs);
  this.monitor=setInterval(()=>{if(this.opener.closed)this.close('The paired car page was closed. Reconnect to the car.');},500);
  if(this.signal?.aborted)this.abort();else{try{this.send('hello');}catch{this.close('The paired car page could not be reached.');}}
  return this.ready;
 }
 receive(event){
  const message=event.data;if(this.closed||event.source!==this.opener||event.origin!==this.origin||!message||message.bvBridge!==1||message.nonce!==this.nonce)return;
  if(message.type==='disconnected'){this.close(typeof message.error==='string'?message.error.slice(0,1000):'The paired car page disconnected.');return;}
  if(message.type==='ready'||message.type==='selection'){
   try{this.selectedIds=selection(message.selectedIds);this.backupClipIds=this.selectedIds;}catch{this.close('Invalid selected recordings from the car page.');return;}
   if(message.type==='ready'&&!this.connected){this.connected=true;clearTimeout(this.timer);this.resolve(this);}
   else if(this.connected&&message.type==='selection')for(const fn of this.listeners){try{fn(this.selectedIds);}catch{}}
   return;
  }
  if(!this.connected||message.type!=='response'||!Number.isSafeInteger(message.id))return;
  const pending=this.pending.get(message.id);if(!pending)return;
  if(typeof message.error==='string'){pending.finish(new Error(message.error.slice(0,2000)));return;}
  if(!Number.isInteger(message.status)||message.status<200||message.status>599||!(message.body instanceof ArrayBuffer)||message.body.byteLength>MAX||!message.headers||typeof message.headers!=='object'||Object.entries(message.headers).some(([key,value])=>!['Content-Length','Content-Type'].includes(key)||typeof value!=='string'||value.length>512||/[\r\n]/.test(value))){pending.finish(new Error('Invalid response from the paired car page.'));return;}
  if(Number(message.headers['Content-Length'])!==message.body.byteLength){pending.finish(new Error('Incomplete response from the paired car page.'));return;}
  try{pending.finish(null,new Response([204,205,304].includes(message.status)?null:message.body,{status:message.status,headers:message.headers}));}catch{pending.finish(new Error('Invalid response from the paired car page.'));}
 }
 onSelection(fn){if(typeof fn!=='function')throw Error('A selection callback is required.');this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 async fetch(path,options={}){
  if(this.closed||!this.connected||this.opener.closed)throw Error(this.reason||'Keep the paired car page open for phone backup.');
  if(options.signal?.aborted)throw options.signal.reason||new DOMException('Cancelled','AbortError');
  const call=request(path,options);if(this.pending.size>=4)throw Error('Too many concurrent phone backup requests.');
  const id=++this.nextId;if(!Number.isSafeInteger(id)){this.close('Phone backup connection expired.');throw Error(this.reason);}
  return new Promise((resolve,reject)=>{
   const abort=()=>{try{this.send('cancel',{id});}catch{}finish(options.signal?.reason||new DOMException('Cancelled','AbortError'));};
   const finish=(error,response)=>{if(!this.pending.has(id))return;this.pending.delete(id);clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(response);};
   const timer=setTimeout(()=>{try{this.send('cancel',{id});}catch{}finish(new Error('The paired car page stopped responding. Keep it open and retry.'));},call.timeoutMs);
   this.pending.set(id,{finish});options.signal?.addEventListener('abort',abort,{once:true});
   const {timeoutMs,...fields}=call;try{this.send('request',{id,...fields});}catch{finish(new Error('The paired car page could not be reached.'));}
  });
 }
 returnToCar(){
  if(!this.returnRequested){
   if(this.closed||!this.connected||this.opener.closed)return false;
   this.send('complete');this.returnRequested=true;
  }
  // Both calls can be blocked by mobile browser window policies. The dedicated
  // page keeps a visible button so a fresh user gesture can repeat them.
  try{this.opener.focus();}catch{}
  try{this.window.close();}catch{}
  return this.window.closed===true;
 }
 close(reason='Phone backup disconnected.'){
  if(this.closed)return;this.reason=reason;try{this.send('close');}catch{}this.closed=true;clearTimeout(this.timer);clearInterval(this.monitor);this.window.removeEventListener('message',this.listener);this.window.removeEventListener('pagehide',this.unload);this.signal?.removeEventListener('abort',this.abort);
  for(const pending of [...this.pending.values()])pending.finish(new Error(reason));this.listeners.clear();if(!this.connected)this.reject?.(new Error(reason));
 }
}
PhoneBridgeSource.validateRequest=request;return PhoneBridgeSource;
});
