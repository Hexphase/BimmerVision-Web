/* The hosted popup owns Google access; only its paired opener reads car files. */
(function(root){
'use strict';
let handoff,initialError;
// Strip the one-time channel details before any sign-in service can be loaded.
try{
 handoff=root.BVPhoneBridgeSource.consume(root.location,root.history);
 if(!handoff)throw Error('Open Phone Remote Backup from the car’s paired player.');
}catch(error){initialError=error;}
const validSelection=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=1000&&ids.every(id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))&&new Set(ids.map(id=>id.toLowerCase())).size===ids.length;
async function start(){
 const get=id=>root.document.getElementById(id),status=get('phoneBackupConnectionStatus'),error=get('phoneBackupConnectionError'),resume=get('phoneBackupResumeBtn');
 let latestSelection=[],source;
 const controller=new AbortController();
 root.addEventListener('pagehide',()=>controller.abort(),{once:true});
 function failure(value){error.textContent=(value?.message||String(value))+' Keep the original car tab open. Return to that tab and choose Send to Remote Backup again.';error.hidden=false;status.textContent='Phone backup could not connect.';}
 async function openSelection(ids){
  if(!validSelection(ids))throw Error('The car did not provide a valid selection of complete recordings.');
  latestSelection=ids.slice();
  return await root.BVGoogleDriveBackupUI.openDrive(latestSelection,'Selected recordings');
 }
 resume.addEventListener('click',()=>{void openSelection(latestSelection).catch(failure);});
 try{
  if(initialError)throw initialError;
  if(!root.BVSourceManager||!root.BVGoogleDriveBackupUI)throw Error('Phone backup could not load. Reload this window from the original car tab.');
  status.textContent='Connecting to the original car tab…';
  source=await root.BVPhoneBridgeSource.connect({...handoff,signal:controller.signal});
  if(controller.signal.aborted)throw new DOMException('Phone backup connection cancelled.','AbortError');
  if(source?.kind!=='car'||!validSelection(source.selectedIds))throw Error('The car did not provide a valid selection of complete recordings.');
  root.BVSourceManager.setSource(source);
  source.onSelection?.(ids=>{void openSelection(ids).catch(failure);});
  await openSelection(source.selectedIds);
  status.textContent='Connected to your car. Keep both this window and the original car tab open.';resume.hidden=false;
 }catch(value){source?.close?.();failure(value);}
}
if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>{void start();},{once:true});
else void start();
})(window);
