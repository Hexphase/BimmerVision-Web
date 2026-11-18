/* Source selection is a user gesture; no recording access happens on page load. */
document.addEventListener('DOMContentLoaded',()=>{
 const account=window.BVGoogleDriveAccount;
 const manager=window.BVSourceManager,screen=document.getElementById('sourceScreen'),shell=document.querySelector('.app-shell');
 const error=document.getElementById('sourceError'),progress=document.getElementById('sourceProgress'),cancel=document.getElementById('cancelSourceWork'),back=document.getElementById('returnToRecordingsBtn');
 const address=document.getElementById('carAddress'),code=document.getElementById('carCode'),folder=document.getElementById('usbFolderInput'),qrFile=document.getElementById('qrFileInput');
 const usbDialog=document.getElementById('usbInstructions'),usbOpen=document.getElementById('openUsbBtn');
 let directoryPickerAllowed=true;
 const closeUsb=()=>{if(usbDialog?.open)usbDialog.close();};
 const camera=document.getElementById('qrCameraPanel');let work=null,scanner=null,scanAbort=null,epoch=0;
 const buttons=['openUsbBtn','selectUsbDriveBtn','connectCarBtn','scanQrBtn','uploadQrBtn','prepareGoogleDriveBtn','connectGoogleDriveBtn','changeGoogleDriveAccountBtn'].map(id=>document.getElementById(id));
 function message(text){progress.textContent=text||'';}
 function failure(reason){error.textContent=reason?.message||String(reason);error.hidden=false;}
 function stopScanner(){scanAbort?.abort();scanAbort=null;scanner?.();scanner=null;camera.hidden=true;}
 function stopWork(){epoch++;work?.abort();work=null;stopScanner();buttons.forEach(b=>b.disabled=false);cancel.hidden=true;message('');}
 function startWork(text){stopWork();work=new AbortController();buttons.forEach(b=>b.disabled=true);error.hidden=true;cancel.hidden=false;message(text);return {token:epoch,signal:work.signal};}
 function show(){closeUsb();stopWork();window.player?.pause();shell.hidden=true;shell.inert=true;screen.hidden=false;back.hidden=!manager.source;document.getElementById('openUsbBtn').focus();}
 function hide(){closeUsb();stopWork();screen.hidden=true;shell.hidden=false;shell.inert=false;const button=document.getElementById('changeSourceBtn'),menu=button.closest?.('details');(menu&&!menu.open?menu.querySelector('summary'):button).focus();}
 function chosen(source){work=null;manager.setSource(source);document.body.dataset.sourceReadonly=String(source.readOnly===true);hide();source.indexing?.then(()=>{if(manager.source===source)window.dispatchEvent(new Event('bimmervision:library-updated'));}).catch(()=>{});}
 function report(value){if(typeof value==='string')message(value);else if(value){const n=value.completed??value.scanned??0,total=value.total;message(value.message||`Reading recordings${total?` · ${n} of ${total}`:n?` · ${n} checked`:''}…`);}}
 const driveStatus=document.getElementById('googleDriveStatus'),driveConnect=document.getElementById('connectGoogleDriveBtn'),drivePrepare=document.getElementById('prepareGoogleDriveBtn'),driveDisconnect=document.getElementById('disconnectGoogleDriveBtn'),driveChange=document.getElementById('changeGoogleDriveAccountBtn');
 drivePrepare.addEventListener('click',async()=>{const job=startWork('Loading Google sign-in…');try{if(!window.BV_GOOGLE_DRIVE_CONFIG?.clientId)throw Error('Google Drive connection is not configured yet.');await BVGoogleDriveClient.prepare();if(job.token!==epoch)return;stopWork();drivePrepare.hidden=true;driveConnect.hidden=false;driveStatus.textContent='Google sign-in is ready. Choose Connect Google Drive to select your account.';driveConnect.focus();}catch(e){if(job.token===epoch){stopWork();failure(e);}}});
 async function connectDrive(){const job=startWork('Connecting to your Google Drive…');let client;try{client=await BVGoogleDriveClient.connect({clientId:window.BV_GOOGLE_DRIVE_CONFIG?.clientId,signal:job.signal,prompt:'select_account'});if(job.token!==epoch){client.close();return;}const source=await BVGoogleDriveSource.fromClient(client,{signal:job.signal,onProgress:report,closeClient:false});if(job.token!==epoch){source.close();client.close();return;}account.set(client,source.account);driveStatus.textContent='Connected · '+(source.account.emailAddress||source.account.displayName||'Google Drive');driveDisconnect.hidden=false;driveChange.hidden=false;chosen(source);}catch(e){client?.close();if(job.token===epoch&&e.name!=='AbortError'){stopWork();failure(e);}}}
 driveConnect.addEventListener('click',connectDrive);driveChange.addEventListener('click',connectDrive);
 driveDisconnect.addEventListener('click',()=>{account.clear();if(manager.source?.kind==='drive'){manager.source.close();manager.setSource({kind:'disconnected',readOnly:true,name:'Disconnected',fetch:async()=>new Response(JSON.stringify({recordings:[]}),{headers:{'Content-Type':'application/json'}})});}show();back.hidden=true;driveStatus.textContent='Disconnected. Your Google Drive session has been removed from this page.';driveDisconnect.hidden=true;driveChange.hidden=true;});
 document.getElementById('changeSourceBtn').addEventListener('click',show);back.addEventListener('click',hide);cancel.addEventListener('click',stopWork);
 usbOpen.addEventListener('click',()=>usbDialog.showModal());
 document.getElementById('closeUsbInstructionsBtn').addEventListener('click',closeUsb);
 usbDialog.addEventListener('click',event=>{const r=usbDialog.getBoundingClientRect();if(event.target===usbDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))closeUsb();});
 usbDialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const controls=[...usbDialog.querySelectorAll('button:not([disabled])')],first=controls[0],last=controls.at(-1);if(!first)return;if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
 document.getElementById('selectUsbDriveBtn').addEventListener('click',async()=>{
  if(!directoryPickerAllowed||typeof window.showDirectoryPicker!=='function'){closeUsb();folder.value='';folder.click();return;}
  const job=startWork('Choose your BimmerVision recording folder…');
  try{
   const handle=await window.showDirectoryPicker({id:'bimmervision-recordings',mode:'read'});
   if(job.token!==epoch)return;closeUsb();message('Reading your USB recordings…');
   const source=await BVLocalSource.fromDirectoryHandle(handle,{onProgress:report,signal:job.signal});
   if(job.token!==epoch){source.close();return;}chosen(source);
  }catch(e){
   if(job.token!==epoch)return;stopWork();
   if(e.name==='AbortError')return;
   if(['SecurityError','NotSupportedError'].includes(e.name)){
    directoryPickerAllowed=false;
    document.getElementById('usbPickerStatus').textContent='This browser needs the compatibility folder picker. Press Select Drive again to continue.';
    if(!usbDialog.open)usbDialog.showModal();document.getElementById('selectUsbDriveBtn').focus();return;
   }
   closeUsb();failure(e);
  }
 });
 folder.addEventListener('change',async()=>{
  if(!folder.files.length)return;const job=startWork('Reading your USB recordings…');
  try{const source=await BVLocalSource.fromFiles(folder.files,{onProgress:report,signal:job.signal});if(job.token!==epoch){source.close();return;}chosen(source);}
  catch(e){if(job.token===epoch&&e.name!=='AbortError'){stopWork();failure(e);}}
 });
 function fillQr(value){const parsed=BVRemoteSource.parseInput(value);address.value=parsed.baseUrl;if(parsed.code)code.value=parsed.code;return parsed;}
 address.addEventListener('change',()=>{try{const p=BVRemoteSource.parseInput(address.value);if(p.code)code.value=p.code;}catch(_){}});
 async function connect({fragmentHandoff=false}={}){
  const job=startWork('Connecting directly to your car…');
  try{
   const parsed=BVRemoteSource.parseInput(address.value);const pairingCode=code.value.trim()||parsed.code;
   const fallback=document.getElementById('carFallbackLink');fallback.href=parsed.baseUrl+'/'+(fragmentHandoff?'':'?'+new URLSearchParams(pairingCode?{code:pairingCode}:{}));document.getElementById('carFallback').hidden=false;
   const source=await BVRemoteSource.connect(address.value,{code:pairingCode,signal:job.signal,onProgress:report});if(job.token!==epoch){source.close();return;}chosen(source);
  }catch(e){if(job.token===epoch&&e.name!=='AbortError'){stopWork();failure(e);}}
 }
 document.getElementById('carConnectForm').addEventListener('submit',e=>{e.preventDefault();connect();});
 document.getElementById('uploadQrBtn').addEventListener('click',()=>{qrFile.value='';qrFile.click();});
 qrFile.addEventListener('change',async()=>{
  if(!qrFile.files.length)return;const job=startWork('Reading QR code on your device…');
  try{const value=await BVQRScanner.decodeFile(qrFile.files[0]);if(job.token!==epoch)return;fillQr(value);stopWork();connect();}catch(e){if(job.token===epoch){stopWork();failure(e);}}
 });
 document.getElementById('scanQrBtn').addEventListener('click',async()=>{
  stopWork();error.hidden=true;camera.hidden=false;scanAbort=new AbortController();const cameraEpoch=epoch;
  try{const stop=await BVQRScanner.start(document.getElementById('qrCameraVideo'),{signal:scanAbort.signal,onResult:value=>{if(cameraEpoch!==epoch)return;try{fillQr(value);stopScanner();connect();}catch(e){stopScanner();failure(e);}},onError:e=>{if(cameraEpoch!==epoch)return;stopScanner();failure(e);}});if(cameraEpoch!==epoch){stop();return;}scanner=stop;}
  catch(e){if(cameraEpoch!==epoch)return;stopScanner();if(e.name!=='AbortError')failure(e);}
 });
 document.getElementById('stopQrBtn').addEventListener('click',stopScanner);
 window.addEventListener('pagehide',event=>{stopWork();if(!event.persisted){manager.source?.close();account.clear();}});
 function updateDriveStatus(){driveDisconnect.hidden=!account.client;driveChange.hidden=!account.client;driveStatus.textContent=account.client?'Connected · '+(account.user?.emailAddress||account.user?.displayName||'Google Drive'):'Google Drive is disconnected.';}
 account.subscribe(updateDriveStatus);manager.subscribe(source=>{document.body.dataset.sourceReadonly=String(source.readOnly===true);if(source.kind!=='car')document.getElementById('phoneBackupInstructions').hidden=true;updateDriveStatus();});
 let handoff;try{handoff=BVCarHandoff.consume(location,history);}catch(e){failure(e);return;}
 if(handoff){address.value=handoff.address;code.value=handoff.code;connect({fragmentHandoff:true}).then(()=>{code.value='';if(manager.source?.kind==='car'){const instructions=document.getElementById('phoneBackupInstructions');instructions.hidden=false;instructions.textContent='Phone backup is ready. Open a drive’s clips, choose Back up to Drive on a recording, then connect the same Google account as the car and confirm phone internet use.';}});return;}
 const params=new URLSearchParams(location.search);const supplied=params.get('car')||params.get('address');
 if(supplied){try{fillQr(supplied);if(params.get('code'))code.value=params.get('code');}catch(e){failure(e);}history.replaceState({},'',location.pathname+location.hash);}
});
