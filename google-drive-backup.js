/* Selected local originals -> the user's own Drive. No automatic uploads or persistent credentials. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.BVGoogleDriveBackup=api;root.BVGoogleDriveAccount=new api.DriveAccount();}})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const abort=()=>new DOMException('Backup cancelled because its source or Google account changed.','AbortError');
async function smallJSON(response){
 if(!response.ok)throw Error('Could not verify the existing Google Drive manifest. Retry the backup.');
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1048576)throw Error('Existing Drive manifest is too large.');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(await new Blob(parts).text());
}
function withoutLock(value){const copy={...value};delete copy.locked;return JSON.stringify(copy,(key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
class DriveAccount {
 constructor(){this.client=null;this.user=null;this.generation=0;this.listeners=new Set();}
 subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 set(client,user){const old=this.client;this.client=client;this.user=user||{};this.generation++;if(old&&old!==client)old.close();for(const listener of this.listeners)listener(this);}
 clear(){this.set(null,null);}
}
async function backupRecording({manager,account,clipId,wifiConfirmed=false,signal,onProgress=()=>{}}={}){
 if(wifiConfirmed!==true)throw Error('Confirm this device is connected to Wi-Fi before each upload. The browser cannot verify Wi-Fi.');
 const source=manager?.source,client=account?.client,sourceGeneration=manager?.generation,accountGeneration=account?.generation;
 if(source?.kind!=='usb'||typeof source.getOriginalFiles!=='function')throw Error('Select a local USB recording to back up.');if(!client)throw Error('Connect your Google Drive account first.');
 const controller=new AbortController(),cancel=()=>controller.abort(abort()),unSource=manager.subscribe(cancel),unAccount=account.subscribe(cancel),unMutation=source.subscribe?.(cancel);
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const check=()=>{if(controller.signal.aborted||manager.source!==source||manager.generation!==sourceGeneration||account.client!==client||account.generation!==accountGeneration)throw abort();};
 try{
  check();const originals=source.getOriginalFiles(clipId),total=originals.reduce((n,f)=>n+f.blob.size,0),prepared=[];let hashed=0,uploaded=0;
  const report=value=>{check();onProgress({...value,total,remaining:Math.max(0,total-(value.phase==='hash'?0:value.bytes||0))});};
  for(const file of originals){check();const value=await client.prepareFile({clipId,name:file.name,blob:file.blob,signal:controller.signal,onProgress:p=>report({phase:'hash',name:file.name,bytes:hashed+p.bytes,hashTotal:total})});check();prepared.push(value);hashed+=file.blob.size;}
  const remote=await client.listRecordings({signal:controller.signal});check();
  const matches=(file,value)=>file.name===value.name&&Number(file.size)===value.size&&file.md5Checksum?.toLowerCase()===value.md5;
  const groups=new Map();for(const file of remote){if(file.parents?.length!==1)continue;const parent=file.parents[0];if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push(file);}
  for(const [parent,files] of groups){if(prepared.every(value=>files.filter(file=>matches(file,value)).length===1)&&files.every(file=>prepared.some(value=>matches(file,value)))){report({phase:'complete',bytes:total});return {skipped:true,parent};}}
  // Lock protects the local original. Do not duplicate a cloud recording just
  // because its otherwise identical manifest has a different local lock bit.
  const manifestPrepared=prepared.find(f=>f.name==='manifest.json');
  for(const [parent,files] of groups){
   const manifests=files.filter(f=>f.name==='manifest.json'),data=prepared.filter(f=>f.name!=='manifest.json');
   if(manifests.length!==1||Number(manifests[0].size)>1048576||files.length!==prepared.length||!data.every(value=>files.filter(file=>matches(file,value)).length===1))continue;
   const local=JSON.parse(await manifestPrepared.blob.text()),remoteManifest=await smallJSON(await client.read(manifests[0].id,{signal:controller.signal}));check();
   if(local.id===clipId&&remoteManifest.id===clipId&&local.complete===true&&remoteManifest.complete===true&&withoutLock(local)===withoutLock(remoteManifest)){
    report({phase:'complete',bytes:total});return {skipped:true,parent,localLockOnly:true};
   }
  }
  let parent,existing=[];
  for(const [candidate,files] of groups){if(files.length&&files.every(file=>prepared.some(value=>matches(file,value)))&&prepared.every(value=>files.filter(file=>file.name===value.name).length<=1)){parent=candidate;existing=files;break;}}
  if(!parent){const roots=await client.findFolders({name:'BimmerVision',signal:controller.signal});check();const root=roots[0]||await client.createFolder({name:'BimmerVision',signal:controller.signal});check();const folders=await client.findFolders({name:clipId,parent:root.id,signal:controller.signal});check();const empty=folders.find(folder=>!groups.has(folder.id));parent=(empty||await client.createFolder({name:clipId,parent:root.id,signal:controller.signal})).id;check();}
  // A complete manifest is written last, after every original data file is verified.
  prepared.sort((a,b)=>(a.name==='manifest.json')-(b.name==='manifest.json'));
  for(const value of prepared){check();if(existing.some(file=>matches(file,value))){uploaded+=value.size;report({phase:'upload',name:value.name,bytes:uploaded});continue;}
   await client.uploadResumable({prepared:value,parent,signal:controller.signal,onProgress:p=>report({phase:'upload',name:value.name,bytes:uploaded+p.bytes})});check();uploaded+=value.size;
  }
  report({phase:'complete',bytes:total});return {skipped:false,parent};
 }finally{unSource();unAccount();unMutation?.();signal?.removeEventListener('abort',cancel);}
}
async function backupDrive({manager,account,clipIds,wifiConfirmed=false,signal,onProgress=()=>{}}={}){
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!Array.isArray(clipIds)||!clipIds.length||clipIds.length>1000||clipIds.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(clipIds.map(id=>id.toLowerCase())).size!==clipIds.length)throw Error('Choose a drive with 1 to 1000 complete recordings.');
 if(!wifiConfirmed)throw Error('Confirm this device is connected to Wi-Fi before each upload.');
 const ids=clipIds.slice(),source=manager?.source,client=account?.client,generation=manager?.generation,accountGeneration=account?.generation;
 if(source?.kind!=='usb'||!client)throw Error('Select local recordings and connect Google Drive first.');
 const controller=new AbortController(),cancel=()=>controller.abort(abort()),offSource=manager.subscribe(cancel),offAccount=account.subscribe(cancel),offMutation=source.subscribe?.(cancel);
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const check=()=>{if(controller.signal.aborted||source!==manager.source||manager.generation!==generation||client!==account.client||account.generation!==accountGeneration)throw abort();};
 try{
  check();const sizes=ids.map(id=>source.getOriginalFiles(id).reduce((n,f)=>n+f.blob.size,0)),total=sizes.reduce((a,b)=>a+b,0);let bytes=0,completed=0,skipped=0,localLockOnly=0;
  if(!Number.isSafeInteger(total)||total<1)throw Error('Invalid drive size.');
  for(let index=0;index<ids.length;index++){
   check();const result=await backupRecording({manager,account,clipId:ids[index],wifiConfirmed:true,signal:controller.signal,onProgress:p=>{
    check();onProgress({...p,bytes:bytes+(p.phase==='hash'?0:p.bytes||0),total,remaining:Math.max(0,total-bytes-(p.phase==='hash'?0:p.bytes||0)),recordingIndex:index+1,recordingsTotal:ids.length,recordingsCompleted:completed});
   }});check();bytes+=sizes[index];completed++;if(result.skipped)skipped++;if(result.localLockOnly)localLockOnly++;
   onProgress({phase:'upload',bytes,total,remaining:Math.max(0,total-bytes),recordingIndex:index+1,recordingsTotal:ids.length,recordingsCompleted:completed});
  }
  onProgress({phase:'complete',bytes:total,total,remaining:0,recordingsTotal:ids.length,recordingsCompleted:completed});return {wholeDrive:true,completed,skipped,localLockOnly};
 }finally{offSource();offAccount();offMutation?.();signal?.removeEventListener('abort',cancel);}
}
return {DriveAccount,backupRecording,backupDrive};
});
