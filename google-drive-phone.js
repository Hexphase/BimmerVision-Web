/* Phone carries car recording chunks to its own Google account. Leases stay in POST bodies. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BVGoogleDrivePhone=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ID=/^[A-Za-z0-9_-]{1,256}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const aborted=()=>new DOMException('Phone backup cancelled because its source or Google account changed.','AbortError');
async function backup({manager,account,clipIds,internetConfirmed=false,signal,onProgress=()=>{}}={}){
 if(internetConfirmed!==true)throw Error('Explicit consent is required to use this phone’s internet connection, which may use cellular data.');
 if(!Array.isArray(clipIds)||!clipIds.length||clipIds.length>20||clipIds.some(id=>!UUID.test(id))||new Set(clipIds.map(id=>id.toLowerCase())).size!==clipIds.length)throw Error('Choose up to 20 valid recordings.');
 const source=manager?.source,client=account?.client,sourceGeneration=manager?.generation,accountGeneration=account?.generation,email=account?.user?.emailAddress;
 if(source?.kind!=='car'||!client||typeof email!=='string'||!email)throw Error('Connect the car and the same Google account used by its backup settings.');
 const controller=new AbortController(),cancel=()=>controller.abort(aborted()),unSource=manager.subscribe(cancel),unAccount=account.subscribe(cancel);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const check=()=>{if(controller.signal.aborted)throw controller.signal.reason||aborted();if(manager.source!==source||manager.generation!==sourceGeneration||account.client!==client||account.generation!==accountGeneration)throw aborted();};
 const request=async(path,body,{release=false}={})=>{if(!release)check();const response=await source.fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:release?undefined:controller.signal});if(!response.ok){let reason;try{reason=(await response.json()).error;}catch{}throw Error(reason||'Car phone backup request failed ('+response.status+').');}return response;};
 let job=null,timer,busy=false;
 try{
  const claim=await(await request('/api/v1/phone-backup/claim',{clipIds,accountEmail:email,consent:true})).json();check();
  if(ID.test(claim.jobId)&&typeof claim.leaseToken==='string'&&claim.leaseToken.length>0&&claim.leaseToken.length<=4096&&!/[\r\n]/.test(claim.leaseToken))job={id:claim.jobId,leaseToken:claim.leaseToken};else throw Error('Invalid car phone backup lease.');
  const base='/api/v1/phone-backup/'+job.id,lease={leaseToken:job.leaseToken};
  if(typeof claim.accountEmail!=='string'||claim.accountEmail.toLowerCase()!==email.toLowerCase())throw Error('The phone Google account must match the car’s backup account.');
  const selected=new Set(clipIds.map(v=>v.toLowerCase()));
  if(!claim.root||claim.root.name!=='BimmerVision'||(!claim.root.trustedExisting&&!HASH.test(claim.root.tag))||(claim.root.trustedExisting&&!ID.test(claim.root.id)))throw Error('Invalid car backup root.');
  if(!Array.isArray(claim.folders)||!Array.isArray(claim.files)||!claim.files.length||claim.files.length>60||claim.chunkBytes!==1048576)throw Error('Invalid car recording upload plan.');
  const folders=new Map(),indices=new Set(),names=new Set();
  for(const folder of claim.folders){if(!UUID.test(folder.clipId)||!selected.has(folder.clipId.toLowerCase())||folder.name!==folder.clipId||folders.has(folder.clipId)||(!folder.trustedExisting&&!HASH.test(folder.tag))||(folder.trustedExisting&&!ID.test(folder.id)))throw Error('Invalid selected recording folder.');folders.set(folder.clipId,folder);}
  for(const file of claim.files){const key=file.clipId+'/'+file.name;if(!folders.has(file.clipId)||!selected.has(file.clipId.toLowerCase())||!Number.isSafeInteger(file.index)||file.index<0||indices.has(file.index)||names.has(key)||!['capture.bvr','manifest.json','mapping.json'].includes(file.name)||!Number.isSafeInteger(file.size)||file.size<1||!/^[a-f0-9]{32}$/.test(file.md5)||!HASH.test(file.tag))throw Error('Invalid selected recording upload file.');indices.add(file.index);names.add(key);}
  for(const id of folders.keys())if(!names.has(id+'/capture.bvr')||!names.has(id+'/manifest.json'))throw Error('Car recording files are incomplete.');
  const total=claim.files.reduce((n,f)=>n+f.size,0);let uploaded=0;
  timer=setInterval(()=>{if(busy||controller.signal.aborted)return;busy=true;request(base+'/heartbeat',lease).then(r=>r.json()).then(value=>{if(value.speedPermitted===false)onProgress({phase:'paused',reason:value.reason||'Waiting for the car to permit phone backup.',bytes:uploaded,total,remaining:total-uploaded});}).catch(error=>controller.abort(error)).finally(()=>{busy=false;});},10000);
  const rootId=claim.root.trustedExisting?claim.root.id:(await client.createFolder({name:claim.root.name,tag:claim.root.tag,signal:controller.signal})).id;check();if(!ID.test(rootId))throw Error('Invalid Google Drive root ID.');
  const folderIds={};for(const [id,folder] of folders){folderIds[id]=folder.trustedExisting?folder.id:(await client.createFolder({name:folder.name,parent:rootId,tag:folder.tag,signal:controller.signal})).id;check();if(!ID.test(folderIds[id]))throw Error('Invalid Google Drive folder ID.');}
  const targets=new Map();for(const file of claim.files){check();targets.set(file.index,await client.adoptPhone({file,parent:folderIds[file.clipId],signal:controller.signal}));}
  // Register every durable target before requesting any car bytes or sending media.
  await(await request(base+'/register',{...lease,rootId,folders:folderIds,files:claim.files.map(file=>({index:file.index,...targets.get(file.index)}))})).body?.cancel();check();
  const files=[...claim.files].sort((a,b)=>(a.name==='manifest.json')-(b.name==='manifest.json'));
  for(const file of files){check();await client.uploadPhoneTarget({target:targets.get(file.index),file,signal:controller.signal,chunkSize:claim.chunkBytes,readChunk:async(offset,length)=>{check();if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||length>1048576||offset+length>file.size)throw Error('Invalid bounded car read.');const response=await request(base+'/read',{...lease,index:file.index,offset,length});const blob=await response.blob();check();if(blob.size!==length)throw Error('Incomplete car recording chunk.');return blob;},onProgress:p=>{check();onProgress({phase:'upload',name:file.name,bytes:uploaded+p.bytes,total,remaining:total-uploaded-p.bytes});}});uploaded+=file.size;}
  check();return {pending:true,verified:false};
 }catch(error){if(controller.signal.aborted&&controller.signal.reason)throw controller.signal.reason;throw error;}finally{
  clearInterval(timer);controller.abort(aborted());unSource();unAccount();signal?.removeEventListener('abort',cancel);
  if(job){try{const response=await request('/api/v1/phone-backup/'+job.id+'/release',{leaseToken:job.leaseToken},{release:true});await response.body?.cancel();}catch{}}
 }
}
return {backup};
});
