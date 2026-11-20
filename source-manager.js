/* Routes recording access locally; recording files never pass through GitHub. */
(function(root){
'use strict';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
class SourceManager {
 constructor({nativeFetch}={}){this.nativeFetch=nativeFetch;this.source=null;this.generation=0;this.listeners=new Set();this.ready=new Promise(resolve=>{this.resolveReady=resolve;});}
 get readOnly(){return this.source?.readOnly===true;}
 setSource(source){
  if(!source||typeof source.fetch!=='function')throw Error('A recording source is required.');
  const previous=this.source;this.source=source;this.generation++;
  if(previous&&previous!==source){try{Promise.resolve(previous.close?.()).catch(()=>{});}catch(_){}}
  this.resolveReady(source);for(const listener of this.listeners)listener(source);
 }
 subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 async fetch(path,options={}){
  if(typeof path!=='string'||!/^\/api\/v1\//.test(path)||path.includes('\\')||/[\r\n]/.test(path))throw Error('Use a relative recording API path.');
  const source=this.source,generation=this.generation;if(!source)return json({error:'Choose a USB drive or connect to your car first.'},503);
  if(source.kind==='usb'){
   if(path==='/api/v1/capabilities')return json({nativePreview:false,readOnly:source.readOnly!==false,canLock:source.canLock===true,canDelete:false,localFiles:true});
   if(path==='/api/v1/version')return json({version:'0.2.78',repository:'Hexphase/BimmerVision-Web',hostedViewer:true});
  }
  const response=await (this.recordingCache ? this.recordingCache.fetch(source,path,options) : source.fetch(path,options));
  if(generation!==this.generation||source!==this.source){await response.body?.cancel();throw new DOMException('Recording source changed.','AbortError');}if(String(options.method||'GET').toUpperCase()==='POST'&&/\/lock$/.test(path)){
   if(!response.ok){const reason=await response.json().catch(()=>null);throw Error(reason?.error||'The recording lock was not saved.');}
   this.recordingCache?.clear();
  }
  return response;
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={SourceManager};
else{root.BVSourceManager=new SourceManager({nativeFetch:root.fetch.bind(root)});root.BV_WEB_VERSION='0.2.78';}
})(typeof globalThis!=='undefined'?globalThis:this);
