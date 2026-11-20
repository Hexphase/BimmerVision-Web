/* Explicit selected recording/drive backup with fresh network consent per attempt. */
document.addEventListener('DOMContentLoaded',()=>{
 'use strict';
 const manager=window.BVSourceManager,account=window.BVGoogleDriveAccount,get=id=>document.getElementById(id);
 const dialog=get('driveBackupDialog'),wifi=get('driveBackupWifi'),start=get('startDriveBackupBtn'),login=get('driveBackupSignInBtn'),cancel=get('cancelDriveBackupBtn'),close=get('closeDriveBackupBtn'),status=get('driveBackupProgressText'),progress=get('driveBackupProgress'),error=get('driveBackupError'),identity=get('driveBackupAccount');
 let selection=null,source=null,generation=0,work=null,auth=null,epoch=0,ready=false,phoneStatus=null,statusEpoch=0,session=null;
 const setup=get('driveBackupSetup'),percent=get('driveBackupPercent'),counts=get('driveBackupCounts'),stats=get('driveBackupTransferStats'),add=get('addDriveBackupBtn');
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const bytes=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';
 function controls(){
  start.disabled=!!work||!!auth||!wifi.checked||!account.client||!selection||(source?.kind==='car'&&(phoneStatus?.available!==true||phoneStatus?.speedPermitted===false))||manager.source!==source||manager.generation!==generation;
  wifi.disabled=!!work;login.disabled=!!work||!!auth;cancel.hidden=!work&&!auth;
  identity.textContent=account.client?'Google Drive · '+(account.user?.emailAddress||account.user?.displayName||'Connected'):'Connect your own Google Drive account.';
  login.textContent=account.client?'Change Google account':ready||window.google?.accounts?.oauth2?'Connect Google Drive':'Continue with Google';
  start.textContent='Start Remote Backup upload';
  setup.hidden=!!work;start.hidden=!!work;close.hidden=!!work;add.hidden=!work;
  dialog.setAttribute?.('data-uploading',String(!!work));
 }
 function cancelWork(){epoch++;work?.abort();work=null;if(session){session.pending.length=0;session=null;}auth?.abort();auth=null;wifi.checked=false;controls();}
 function closeDialog(){if(work){status.textContent='Upload is still running. Use Cancel upload to stop it.';return;}cancelWork();statusEpoch++;dialog.close();}
 function openSelection(ids,{wholeDrive=false,label=''}={}){
  if(work){if(!dialog.open)dialog.showModal();return appendSelection(ids);}
  if(auth){if(!dialog.open)dialog.showModal();return;}
  selection=Object.freeze({ids:Object.freeze(ids.slice()),wholeDrive,label});source=manager.source;generation=manager.generation;phoneStatus=null;
  const phone=source?.kind==='car',current=++statusEpoch;
  get('driveBackupEyebrow').textContent=wholeDrive?'REMOTE BACKUP · ENTIRE DRIVE':'REMOTE BACKUP · SELECTED RECORDING';
  get('driveBackupTitle').textContent=wholeDrive?'Upload this drive to Remote Backup.':'Upload this recording to Remote Backup.';
  get('driveBackupClip').textContent=wholeDrive?(label?label+' · ':'')+ids.length+' recordings · uploaded one at a time':ids[0];
  get('driveBackupWifiLabel').textContent=phone?'I confirm this phone uses its own cellular data or another non-car internet connection, not BMW hotspot internet. I allow this backup and any data charges.':'I confirm this device is connected to Wi-Fi for this upload.';
  get('driveBackupWifiHelp').textContent=phone?'This browser cannot force cellular routing or verify the active connection. If BMW hotspot internet is enabled, disable its internet sharing and verify the phone uses mobile data before starting. Keep the local connection to the car.':'This browser cannot verify Wi-Fi. Check your device’s network before confirming. Large recordings can use significant data.';
  get('driveBackupPrivacy').textContent=phone?'The car sends original recording chunks to this phone, which uploads directly to the same Google Drive account used by the car. The car verifies completed files later on Wi-Fi. If this page stops, the car keeps the remaining files queued. An unfinished file may restart when the car takes over.':'Upload '+(wholeDrive?'this drive’s recordings':'this recording’s unchanged original files')+' directly from your device to your own Google Drive. No recordings pass through BimmerVision servers.';
  wifi.checked=false;error.hidden=true;progress.hidden=true;percent.hidden=true;counts.hidden=true;stats.hidden=true;
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
  open(id){return openSelection([id]);},
  openDrive(ids,label=''){
   if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Choose a drive with 1 to 1000 complete recordings.');
   return openSelection(ids,{wholeDrive:true,label});
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
 const cancelled=()=>new DOMException('Upload cancelled because its source or account changed.','AbortError');
 function checkSession(current){if(session!==current||!work||work.signal.aborted||manager.source!==current.source||manager.generation!==current.generation||account.client!==current.client||account.generation!==current.accountGeneration)throw cancelled();}
 function renderProgress(current,p={},operationCount=0){
  if(session!==current)return;
  const inner=p.phase==='hash'?0:Math.max(0,p.progressValue??(p.total?Math.min(1,(p.bytes||0)/p.total)*operationCount:0));
  current.completed=Math.max(current.completed,current.finished+(p.recordingsCompleted||0));
  const value=Math.min(current.ids.size,current.finished+inner),total=current.ids.size;
  progress.max=total||1;progress.value=value;percent.textContent=Math.floor(value/(total||1)*100)+'%';
  counts.textContent=current.completed+' completed · '+Math.max(0,total-current.completed)+' left · '+total+' recordings';
  const now=Date.now();if((p.bytes||0)>0&&!current.uploadStarted)current.uploadStarted=now;
  const transferred=current.bytes+(p.bytes||0),elapsed=current.uploadStarted?(now-current.uploadStarted)/1000:0;
  const rate=elapsed>=.5?transferred/elapsed:0;
  const seconds=elapsed>=.5&&value>0?Math.ceil((total-value)*elapsed/value):null;
  const eta=seconds===null?'Estimating time remaining…':seconds>=3600?Math.floor(Math.ceil(seconds/60)/60)+' hr '+String(Math.ceil(seconds/60)%60).padStart(2,'0')+' min remaining':seconds>60?Math.ceil(seconds/60)+' min remaining':seconds+' sec remaining';
  stats.textContent=bytes(transferred)+' sent'+(rate?' · '+bytes(rate)+'/s':'')+' · '+eta;
  if(p.phase==='paused')status.textContent=p.reason||'Waiting for the car to permit this upload.';
  else if(p.phase==='queue')status.textContent='Saving all selected recordings on the car before upload…';
  else if(p.phase==='hash')status.textContent='Checking original files…';
  else if(p.phase==='sent')status.textContent='Recordings sent. Continuing the upload queue…';
  else status.textContent='Uploading '+(p.name||'original recording files')+' to your Google Drive. Keep this page open.';
 }
 function appendSelection(ids){
  const current=session;if(!current)return Promise.resolve(false);
  const chosen=ids.filter(id=>!current.ids.has(id.toLowerCase())&&!current.reserved.has(id.toLowerCase()));
  if(!chosen.length)return Promise.resolve(true);
  if(current.ids.size+current.reserved.size+chosen.length>1000){error.textContent='This upload can include up to 1000 recordings. Finish it before adding more.';error.hidden=false;return Promise.resolve(false);}
  chosen.forEach(id=>current.reserved.add(id.toLowerCase()));
  const task=current.addTail.then(async()=>{
   try{
    checkSession(current);
    if(current.source.kind==='car'){
     const response=await current.source.fetch('/api/v1/remote-backup',{signal:work.signal});checkSession(current);
     const value=await response.json();checkSession(current);if(!response.ok||!value.sourceToken)throw Error(value.error||'Could not confirm the current recording source.');
     const saved=await current.source.fetch('/api/v1/remote-backup/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',clipIds:chosen,sourceToken:value.sourceToken}),signal:work.signal});checkSession(current);
     const receipt=await saved.json();checkSession(current);if(!saved.ok)throw Error(receipt.error||'Could not save the additional recordings on the car.');
    }
    checkSession(current);chosen.forEach(id=>current.ids.add(id.toLowerCase()));current.pending.push({ids:chosen.slice(),wholeDrive:true});
    renderProgress(current,current.lastProgress,current.activeCount);return true;
   }catch(e){if(session===current&&e.name!=='AbortError'){error.textContent=e.message;error.hidden=false;}return false;}
   finally{chosen.forEach(id=>current.reserved.delete(id.toLowerCase()));}
  });
  current.addTail=task;return task;
 }
 add.addEventListener('click',async()=>{if(work)await window.BVRemoteBackupPage?.open([],{add:true});});
 start.addEventListener('click',async()=>{
  if(start.disabled)return;const token=++epoch;work=new AbortController();const signal=work.signal;
  const current=session={source,generation,client:account.client,accountGeneration:account.generation,ids:new Set(selection.ids.map(id=>id.toLowerCase())),reserved:new Set(),pending:[selection],addTail:Promise.resolve(),finished:0,completed:0,bytes:0,uploadStarted:0,lastProgress:{},activeCount:0};
  error.hidden=true;progress.hidden=false;percent.hidden=false;counts.hidden=false;stats.hidden=false;progress.max=1;progress.value=0;wifi.checked=false;
  get('driveBackupTitle').textContent='Uploading to Remote Backup';get('driveBackupEyebrow').textContent='KEEP THIS PAGE OPEN';controls();renderProgress(current);
  try{
   const phone=source.kind==='car',api=phone?window.BVGoogleDrivePhone:window.BVGoogleDriveBackup;
   let lastResult;
   while(current.pending.length||current.reserved.size){
    checkSession(current);
    if(!current.pending.length){await current.addTail;continue;}
    const item=current.pending.shift();current.activeCount=item.ids.length;let transferred=0;
    const operation=item.wholeDrive?api.backupDrive:phone?api.backup:api.backupRecording;
    lastResult=await operation({manager,account,clipId:item.ids[0],clipIds:item.ids.slice(),wifiConfirmed:!phone,internetConfirmed:phone,signal,onProgress:p=>{
     if(token!==epoch)return;transferred=p.bytes||0;current.lastProgress=p;renderProgress(current,p,item.ids.length);
    }});
    checkSession(current);current.finished+=item.ids.length;current.completed=current.finished;current.bytes+=lastResult.bytes??transferred;
    current.lastProgress={};current.activeCount=0;renderProgress(current);
    // A durable addition already in flight belongs to this consented attempt.
    await current.addTail;
   }
   checkSession(current);
   get('driveBackupTitle').textContent=phone?'Upload sent to Remote Backup':'Remote Backup complete';
   status.textContent=phone?'Transfer sent. The car will independently verify '+current.completed+' recordings in Google Drive when it is on Wi-Fi.':current.ids.size===1&&lastResult?.localLockOnly?'Already backed up. Lock changes protect the USB original; the cloud copy stays unchanged.':'Backup complete · '+current.completed+' recordings. Original file sizes and checksums verified in Google Drive.';
   progress.value=progress.max;percent.textContent='100%';stats.textContent=bytes(current.bytes)+' sent'+(phone?' · Awaiting car Wi-Fi verification':' · Verified');
  }catch(e){
   if(token!==epoch)return;
   error.textContent=(e.name==='AbortError'?'Backup cancelled. Confirm the connection before retrying.':e.message)+(source?.kind==='car'?' The car keeps queued recordings for Wi-Fi-only fallback.':' Completed uploads are kept.');error.hidden=false;
  }finally{if(token===epoch){work=null;session=null;wifi.checked=false;controls();}}
 });
 cancel.addEventListener('click',()=>{cancelWork();status.textContent=source?.kind==='car'?'Backup cancelled. The car keeps queued recordings for Wi-Fi-only fallback.':'Backup cancelled. Completed uploads are kept. Confirm Wi-Fi again before retrying.';});
 close.addEventListener('click',closeDialog);dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
 manager.subscribe(()=>{if(!dialog.open)return;cancelWork();error.textContent='Recording source changed. Open Backup on a recording from the new local source.';error.hidden=false;});
 account.subscribe(()=>{if(work){cancelWork();status.textContent='Google account changed. Confirm the connection again before retrying.';}wifi.checked=false;controls();});
 window.addEventListener('pagehide',cancelWork);
});
