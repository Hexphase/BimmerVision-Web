/* Keep the overview backup action tied to every complete recording in the selected drive. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else {root.BVRecordingBackupAction=api;root.BVBackupActions=api.createActions(root);root.addEventListener('DOMContentLoaded',()=>api.bindActions(root,root.BVBackupActions));}})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function update(button,drive,kind){
 if(!button)return;
 const segments=drive?.segments;
 const ids=Array.isArray(segments)?Array.from(segments,segment=>segment?.clip?.id):[];
 const eligible=['usb','car'].includes(kind)&&ids.length>0&&ids.length<=1000&&segments.every(segment=>segment?.clip?.complete===true)&&ids.every(id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))&&new Set(ids.map(id=>id.toLowerCase())).size===ids.length;
 button.hidden=!eligible;button.disabled=!eligible;
 delete button.dataset.backupRecording;
 if(eligible){button.dataset.backupDrive=JSON.stringify(ids);button.setAttribute('aria-label','Send entire drive to Remote Backup');}else delete button.dataset.backupDrive;
}

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function selection(ids){if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Choose 1 to 1000 distinct complete recordings.');return ids.slice();}
function createActions(root){
 function open(ids,wholeDrive){
  ids=selection(ids);const kind=root.BVSourceManager?.source?.kind;
  if(!['usb','car'].includes(kind))throw Error('Choose a local USB source or connect to the car before backing up recordings.');
  if(kind==='car'&&root.BVPhoneBackupLaunch){
   // This happens before any await so mobile browsers keep the popup gesture.
   const popup=root.BVPhoneBackupLaunch.preparePopup();return Promise.resolve(root.BVPhoneBackupLaunch.openDirect(ids,popup)).then(accepted=>{if(accepted===false)throw Error('Could not open recording backup. Check the car connection and try again.');return true;});
  }
  const ui=root.BVGoogleDriveBackupUI;if(!ui)throw Error('Reload this page before starting a recording backup.');
  return Promise.resolve(wholeDrive?ui.openDrive(ids,'Selected recordings'):ui.open(ids[0])).then(accepted=>accepted!==false);
 }
 return {openRecording(id){return open([id],false);},openDrive(ids){return open(ids,true);}};
}
function bindActions(root,actions){
 root.document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-backup-recording],[data-backup-drive]');if(!button||button.disabled)return;
  event.preventDefault();event.stopImmediatePropagation();const source=root.BVSourceManager?.source,generation=root.BVSourceManager?.generation;button.disabled=true;
  let result;try{result=button.dataset.backupDrive!==undefined?actions.openDrive(JSON.parse(button.dataset.backupDrive)):actions.openRecording(button.dataset.backupRecording);}
  catch(error){root.alert(error.message);button.disabled=false;return;}
  return Promise.resolve(result).catch(error=>root.alert(error.message)).finally(()=>{if(root.BVSourceManager?.source===source&&root.BVSourceManager?.generation===generation)button.disabled=false;});
 },true);
}
return {update,selection,createActions,bindActions};
});
