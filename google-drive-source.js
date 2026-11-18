/* Read-only Drive library adapter. Listing downloads small manifests, never BVR video. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BVGoogleDriveSource=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const rawZip=typeof module==='object'&&module.exports?require('./raw-zip'):globalThis.BVRawZip;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,ID=/^[A-Za-z0-9_-]{1,256}$/,MAX_JSON=1048576;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const abort=()=>new DOMException('Google Drive source closed.','AbortError');
async function bounded(response){if(Number(response.headers.get('Content-Length'))>MAX_JSON){await response.body?.cancel();throw Error('Manifest exceeds size limit.');}const reader=response.body.getReader(),parts=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_JSON)throw Error('Manifest exceeds size limit.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}return JSON.parse(await new Blob(parts).text());}
async function fromClient(client,{signal,onProgress=()=>{},closeClient=true}={}){
 const controller=new AbortController();let closed=false;const recordings=new Map(),warnings=[];
 const check=()=>{if(closed||signal?.aborted)throw abort();};
 const cancel=()=>controller.abort(abort());signal?.addEventListener('abort',cancel,{once:true});
 const close=()=>{closed=true;controller.abort(abort());signal?.removeEventListener('abort',cancel);recordings.clear();if(closeClient)client.close();};
 try{check();const account=await client.about({signal:controller.signal});check();const files=await client.listRecordings({signal:controller.signal}),groups=new Map();
  for(const file of files){if(!ID.test(file.id)||!['manifest.json','capture.bvr','mapping.json'].includes(file.name)||!Array.isArray(file.parents)||file.parents.length!==1||!ID.test(file.parents[0])||!/^[a-f0-9]{64}$/.test(file.appProperties?.bimmervision||''))continue;const parent=file.parents[0];if(!groups.has(parent))groups.set(parent,new Map());const group=groups.get(parent);if(group.has(file.name))group.set(file.name,null);else group.set(file.name,file);}
  let n=0;const duplicateIds=new Set();
  for(const group of groups.values()){check();const mf=group.get('manifest.json'),capture=group.get('capture.bvr');if(!mf||!capture||Number(mf.size)>MAX_JSON)continue;
   try{const manifest=await bounded(await client.read(mf.id,{signal:controller.signal}));check();if(!manifest||!UUID.test(manifest.id)||manifest.complete!==true||manifest.schemaVersion!==1||manifest.format!=='bvr1'||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<16||manifest.bytes!==Number(capture.size))throw Error('Incomplete or invalid recording.');const key=manifest.id.toLowerCase();if(recordings.has(key)||duplicateIds.has(key)){recordings.delete(key);duplicateIds.add(key);throw Error('Duplicate recording ID.');}recordings.set(key,{manifest,files:group});}catch(e){check();warnings.push(e.message);}onProgress({completed:++n,total:groups.size,message:`Reading Google Drive library · ${n} of ${groups.size}…`});
  }
  return {kind:'drive',readOnly:true,name:'Google Drive',account:account.user||{},warnings,close,
   async fetch(path,options={}){check();if(options.signal?.aborted)throw abort();const method=(options.method||'GET').toUpperCase();if(!['GET','HEAD'].includes(method))return json({error:'Google Drive viewing is read only. Locking and deletion are unavailable.'},403);
    if(path==='/api/v1/recordings')return json({recordings:[...recordings.values()].map(r=>({...r.manifest,route:[],endpoints:null,routeStatus:'unavailable'})),warnings});
    if(path==='/api/v1/capabilities')return json({nativePreview:false,readOnly:true,cloudFiles:true});
    if(path==='/api/v1/version')return json({version:globalThis.BV_WEB_VERSION||'0.2.39',hostedViewer:true});
    if(path==='/api/v1/speed-limit')return json(null);
    const match=/^\/api\/v1\/recordings\/([a-f0-9-]+)\/(manifest\.json|capture\.bvr|raw\.zip|mapping(?:\.json)?)$/i.exec(path);if(!match)return json({error:'Drive endpoint unavailable'},404);const record=recordings.get(match[1].toLowerCase());if(!record)return json({error:'Recording unavailable'},404);const requestSignal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    if(match[2]==='raw.zip'){
     const files=[...record.files.values()].filter(Boolean).map(file=>({name:file.name,file:{size:Number(file.size),slice(start,end){end=Math.min(end,Number(file.size));return {async arrayBuffer(){check();const response=await client.read(file.id,{range:`bytes=${start}-${end-1}`,signal:requestSignal});if(response.status!==206){await response.body?.cancel();throw Error('Google Drive did not honor the requested byte range.');}const bytes=await response.arrayBuffer();check();if(bytes.byteLength!==end-start)throw Error('Incomplete Google Drive range.');return bytes;}};}}}));
     return new Response(method==='HEAD'?null:rawZip.createStream(files,'BimmerVision-'+record.manifest.id,{signal:requestSignal,guard:check}),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="BimmerVision-'+record.manifest.id+'.zip"'}});
    }
    const filename=match[2]==='mapping'?'mapping.json':match[2],file=record.files.get(filename);if(!file)return json({error:'Recording file unavailable'},404);
    if(method==='HEAD')return new Response(null,{headers:{'Content-Length':file.size||'0','Accept-Ranges':'bytes'}});
    const response=await client.read(file.id,{range:new Headers(options.headers).get('Range')||undefined,signal:requestSignal});check();return response;
   }};
 }catch(e){close();throw e;}
}
return {fromClient};
});
