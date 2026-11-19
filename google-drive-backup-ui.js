/* Explicit selected recording/drive backup with fresh network consent per attempt. */
document.addEventListener('DOMContentLoaded',()=>{
 'use strict';
 const manager=window.BVSourceManager,account=window.BVGoogleDriveAccount,get=id=>document.getElementById(id);
 const dialog=get('driveBackupDialog'),wifi=get('driveBackupWifi'),start=get('startDriveBackupBtn'),login=get('driveBackupSignInBtn'),cancel=get('cancelDriveBackupBtn'),close=get('closeDriveBackupBtn'),status=get('driveBackupProgressText'),progress=get('driveBackupProgress'),error=get('driveBackupError'),identity=get('driveBackupAccount');
 let selection=null,source=null,generation=0,work=null,auth=null,epoch=0,ready=false,phoneStatus=null,statusEpoch=0;
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const bytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
 function controls(){
  start.disabled=!!work||!!auth||!wifi.checked||!account.client||!selection||(source?.kind==='car'&&(phoneStatus?.available!==true||phoneStatus?.speedPermitted===false))||manager.source!==source||manager.generation!==generation;
  wifi.disabled=!!work;login.disabled=!!work||!!auth;cancel.hidden=!work&&!auth;
  identity.textContent=account.client?'Google Drive · '+(account.user?.emailAddress||account.user?.displayName||'Connected'):'Connect your own Google Drive account.';
  login.textContent=account.client?'Change Google account':ready||window.google?.accounts?.oauth2?'Connect Google Drive':'Continue with Google';
  start.textContent=selection?.wholeDrive?'Back up entire drive':'Back up this recording';
 }
 function cancelWork(){epoch++;work?.abort();work=null;auth?.abort();auth=null;wifi.checked=false;controls();}
 function closeDialog(){cancelWork();statusEpoch++;dialog.close();}
 function openSelection(ids,{wholeDrive=false,label=''}={}){
  if(work||auth){if(!dialog.open)dialog.showModal();return;}
  selection=Object.freeze({ids:Object.freeze(ids.slice()),wholeDrive,label});source=manager.source;generation=manager.generation;phoneStatus=null;
  const phone=source?.kind==='car',current=++statusEpoch;
  get('driveBackupEyebrow').textContent=wholeDrive?'BACK UP ENTIRE DRIVE':'BACK UP SELECTED RECORDING';
  get('driveBackupTitle').textContent=wholeDrive?'Keep this drive in your Google Drive.':'Keep the original in your Drive.';
  get('driveBackupClip').textContent=wholeDrive?(label?label+' · ':'')+ids.length+' recordings · uploaded one at a time':ids[0];
  get('driveBackupWifiLabel').textContent=phone?'I confirm this phone uses its own cellular data or another non-car internet connection, not BMW hotspot internet. I allow this backup and any data charges.':'I confirm this device is connected to Wi-Fi for this upload.';
  get('driveBackupWifiHelp').textContent=phone?'This browser cannot force cellular routing or verify the active connection. If BMW hotspot internet is enabled, disable its internet sharing and verify the phone uses mobile data before starting. Keep the local connection to the car.':'This browser cannot verify Wi-Fi. Check your device’s network before confirming. Large recordings can use significant data.';
  get('driveBackupPrivacy').textContent=phone?'The car sends original recording chunks to this phone, which uploads directly to the same Google Drive account used by the car. The car verifies completed files later on Wi-Fi. If this page stops, the car keeps the remaining files queued. An unfinished file may restart when the car takes over.':'Upload '+(wholeDrive?'this drive’s recordings':'this recording’s unchanged original files')+' directly from your device to your own Google Drive. No recordings pass through BimmerVision servers.';
  wifi.checked=false;error.hidden=true;progress.hidden=true;
  status.textContent=wholeDrive?'Back up all '+ids.length+' recordings in this drive, one at a time. Your local files stay unchanged.':'Back up this recording’s original video, manifest, and available camera mapping. Your local files stay unchanged.';
  controls();if(!dialog.open)dialog.showModal();wifi.focus();
  if(phone){
   const statusSource=source;status.textContent='Checking the car’s phone backup status…';
   source.fetch('/api/v1/phone-backup').then(async response=>{if(!response.ok)throw Error('Update the car app to use phone backup.');return response.json();}).then(value=>{
    if(current!==statusEpoch||!dialog.open||manager.source!==statusSource)return;
    phoneStatus=value;status.textContent=value.available&&value.speedPermitted!==false?'Select the same Google account as the car: '+(value.accountEmail||'see car backup settings')+'. Confirm internet use, then start.':value.reason||'Phone backup is unavailable. Check the car backup settings.';controls();
   }).catch(e=>{if(current!==statusEpoch||!dialog.open||manager.source!==statusSource)return;error.textContent=e.message;error.hidden=false;controls();});
  }
 }
 window.BVGoogleDriveBackupUI={
  open(id){openSelection([id]);},
  openDrive(ids,label=''){
   if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Choose a drive with 1 to 1000 complete recordings.');
   openSelection(ids,{wholeDrive:true,label});
  }
 };
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-backup-recording], [data-backup-drive]');if(!button)return;
  event.preventDefault();event.stopPropagation();
  if(button.dataset.backupDrive!==undefined){try{window.BVGoogleDriveBackupUI.openDrive(JSON.parse(button.dataset.backupDrive));}catch(e){window.alert?.(e.message);}}
  else window.BVGoogleDriveBackupUI.open(button.dataset.backupRecording);
 });
 wifi.addEventListener('change',controls);
 login.addEventListener('click',async()=>{
  const token=++epoch;auth=new AbortController();const signal=auth.signal;error.hidden=true;controls();let client;
  try{
   const config=window.BV_GOOGLE_DRIVE_CONFIG;if(!config?.clientId)throw Error('Google Drive connection is not configured yet.');
   if(!ready&&!window.google?.accounts?.oauth2){await window.BVGoogleDriveClient.prepare();if(token!==epoch)return;ready=true;status.textContent='Google sign-in is ready. Press Connect Google Drive to select your account.';}
   else{client=await window.BVGoogleDriveClient.connect({clientId:config.clientId,signal,prompt:'select_account'});const about=await client.about({signal});if(token!==epoch){client.close();return;}account.set(client,about.user);client=null;}
  }catch(e){client?.close();if(token===epoch&&e.name!=='AbortError'){error.textContent=e.message;error.hidden=false;}}
  finally{if(token===epoch){auth=null;controls();}}
 });
 start.addEventListener('click',async()=>{
  if(start.disabled)return;const token=++epoch,currentSelection=selection;work=new AbortController();const signal=work.signal;
  error.hidden=true;progress.hidden=false;progress.max=1;progress.value=0;wifi.checked=false;controls();let transferStart=0,completed=0;
  try{
   const phone=source.kind==='car',api=phone?window.BVGoogleDrivePhone:window.BVGoogleDriveBackup;
   const operation=currentSelection.wholeDrive?api.backupDrive:phone?api.backup:api.backupRecording;
   const result=await operation({manager,account,clipId:currentSelection.ids[0],clipIds:currentSelection.ids.slice(),wifiConfirmed:!phone,internetConfirmed:phone,signal,onProgress:p=>{
    if(token!==epoch)return;completed=p.recordingsCompleted||0;
    progress.max=p.progressMax||p.total||1;progress.value=p.progressValue??p.bytes??0;
    const prefix=currentSelection.wholeDrive?'Drive · '+completed+' of '+currentSelection.ids.length+' recordings · ':'';
    if(p.phase==='queue'){status.textContent='Saving the entire drive’s backup queue on the car…';return;}
    if(p.phase==='paused'){status.textContent=prefix+p.reason;return;}
    if(p.phase==='sent'){status.textContent=prefix+'Sent to Google Drive; awaiting the car’s Wi-Fi verification.';return;}
    if(p.phase==='hash'){status.textContent=prefix+'Checking original files…';return;}
    if(!transferStart)transferStart=Date.now();const elapsed=(Date.now()-transferStart)/1000,rate=elapsed>.5?(p.bytes||0)/elapsed:0,seconds=rate>0?Math.ceil(((p.total||0)-(p.bytes||0))/rate):null;
    const estimate=seconds===null?'Estimating time remaining…':seconds>=3600?Math.floor(Math.ceil(seconds/60)/60)+' hr '+String(Math.ceil(seconds/60)%60).padStart(2,'0')+' min remaining':seconds>60?Math.ceil(seconds/60)+' min remaining':seconds+' sec remaining';
    const batch=p.batchesTotal>1?'Batch '+p.batchIndex+' of '+p.batchesTotal+' · ':'';
    status.textContent=prefix+batch+'Uploading '+(p.name||'recording')+' · '+bytes(p.bytes||0)+' / '+bytes(p.total||0)+' · '+bytes(p.remaining||0)+' left · '+estimate;
   }});
   if(token!==epoch)return;
   status.textContent=result.pending?'Transfer sent. The car will independently verify '+(currentSelection.wholeDrive?currentSelection.ids.length+' recordings':'these files')+' in Google Drive when it is on Wi-Fi.':currentSelection.wholeDrive?'Backup complete · '+result.completed+' recordings. Existing verified copies were reused where possible.':result.localLockOnly?'Already backed up. Lock changes protect the USB original; the cloud copy stays unchanged.':result.skipped?'Already backed up. All original files match the verified Google Drive copy.':'Backup complete. Original file sizes and checksums verified in Google Drive.';
   progress.value=progress.max;
  }catch(e){
   if(token!==epoch)return;
   const kept=currentSelection.wholeDrive?' Completed uploads are kept; retry to finish the remaining recordings.':'';
   error.textContent=(e.name==='AbortError'?'Backup cancelled. Confirm the connection before retrying.':e.message)+kept;error.hidden=false;
  }finally{if(token===epoch){work=null;wifi.checked=false;controls();}}
 });
 cancel.addEventListener('click',()=>{cancelWork();status.textContent=source?.kind==='car'?'Backup cancelled. The car keeps queued recordings for Wi-Fi-only fallback.':'Backup cancelled. Completed uploads are kept. Confirm Wi-Fi again before retrying.';});
 close.addEventListener('click',closeDialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
 manager.subscribe(()=>{if(!dialog.open)return;cancelWork();error.textContent='Recording source changed. Open Backup on a recording from the new local source.';error.hidden=false;});
 account.subscribe(()=>{if(work){cancelWork();status.textContent='Google account changed. Confirm the connection again before retrying.';}wifi.checked=false;controls();});
 window.addEventListener('pagehide',cancelWork);
});
