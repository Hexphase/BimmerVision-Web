/* Selected local originals -> the user's own Drive. No automatic uploads or persistent credentials. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.BVGoogleDriveBackup=api;root.BVGoogleDriveAccount=new api.DriveAccount();}})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const abort=()=>new DOMException('Backup cancelled because its source or Google account changed.','AbortError');
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
 const controller=new AbortController(),cancel=()=>controller.abort(abort()),unSource=manager.subscribe(cancel),unAccount=account.subscribe(cancel);
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
  let parent,existing=[];
  for(const [candidate,files] of groups){if(files.length&&files.every(file=>prepared.some(value=>matches(file,value)))&&prepared.every(value=>files.filter(file=>file.name===value.name).length<=1)){parent=candidate;existing=files;break;}}
  if(!parent){const roots=await client.findFolders({name:'BimmerVision',signal:controller.signal});check();const root=roots[0]||await client.createFolder({name:'BimmerVision',signal:controller.signal});check();const folders=await client.findFolders({name:clipId,parent:root.id,signal:controller.signal});check();const empty=folders.find(folder=>!groups.has(folder.id));parent=(empty||await client.createFolder({name:clipId,parent:root.id,signal:controller.signal})).id;check();}
  // A complete manifest is written last, after every original data file is verified.
  prepared.sort((a,b)=>(a.name==='manifest.json')-(b.name==='manifest.json'));
  for(const value of prepared){check();if(existing.some(file=>matches(file,value))){uploaded+=value.size;report({phase:'upload',name:value.name,bytes:uploaded});continue;}
   await client.uploadResumable({prepared:value,parent,signal:controller.signal,onProgress:p=>report({phase:'upload',name:value.name,bytes:uploaded+p.bytes})});check();uploaded+=value.size;
  }
  report({phase:'complete',bytes:total});return {skipped:false,parent};
 }finally{unSource();unAccount();signal?.removeEventListener('abort',cancel);}
}
return {DriveAccount,backupRecording};
});
