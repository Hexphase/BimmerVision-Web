/* Source selection is a user gesture; no recording access happens on page load. */
document.addEventListener('DOMContentLoaded',()=>{
 const manager=window.BVSourceManager,screen=document.getElementById('sourceScreen'),shell=document.querySelector('.app-shell');
 const error=document.getElementById('sourceError'),progress=document.getElementById('sourceProgress'),cancel=document.getElementById('cancelSourceWork'),back=document.getElementById('returnToRecordingsBtn');
 const address=document.getElementById('carAddress'),code=document.getElementById('carCode'),folder=document.getElementById('usbFolderInput'),qrFile=document.getElementById('qrFileInput');
 const camera=document.getElementById('qrCameraPanel');let work=null,scanner=null,scanAbort=null,epoch=0;
 const buttons=['openUsbBtn','connectCarBtn','scanQrBtn','uploadQrBtn'].map(id=>document.getElementById(id));
 function message(text){progress.textContent=text||'';}
 function failure(reason){error.textContent=reason?.message||String(reason);error.hidden=false;}
 function stopScanner(){scanAbort?.abort();scanAbort=null;scanner?.();scanner=null;camera.hidden=true;}
 function stopWork(){epoch++;work?.abort();work=null;stopScanner();buttons.forEach(b=>b.disabled=false);cancel.hidden=true;message('');}
 function startWork(text){stopWork();work=new AbortController();buttons.forEach(b=>b.disabled=true);error.hidden=true;cancel.hidden=false;message(text);return {token:epoch,signal:work.signal};}
 function show(){stopWork();window.player?.pause();shell.hidden=true;shell.inert=true;screen.hidden=false;back.hidden=!manager.source;document.getElementById('openUsbBtn').focus();}
 function hide(){stopWork();screen.hidden=true;shell.hidden=false;shell.inert=false;document.getElementById('changeSourceBtn').focus();}
 function chosen(source){work=null;manager.setSource(source);document.body.dataset.sourceReadonly=String(source.readOnly===true);hide();source.indexing?.then(()=>{if(manager.source===source)window.dispatchEvent(new Event('bimmervision:library-updated'));}).catch(()=>{});}
 function report(value){if(typeof value==='string')message(value);else if(value){const n=value.completed??value.scanned??0,total=value.total;message(value.message||`Reading recordings${total?` · ${n} of ${total}`:n?` · ${n} checked`:''}…`);}}
 document.getElementById('changeSourceBtn').addEventListener('click',show);back.addEventListener('click',hide);cancel.addEventListener('click',stopWork);
 document.getElementById('openUsbBtn').addEventListener('click',()=>{folder.value='';folder.click();});
 folder.addEventListener('change',async()=>{
  if(!folder.files.length)return;const job=startWork('Reading your USB recordings…');
  try{const source=await BVLocalSource.fromFiles(folder.files,{onProgress:report,signal:job.signal});if(job.token!==epoch){source.close();return;}chosen(source);}
  catch(e){if(job.token===epoch&&e.name!=='AbortError'){stopWork();failure(e);}}
 });
 function fillQr(value){const parsed=BVRemoteSource.parseInput(value);address.value=parsed.baseUrl;if(parsed.code)code.value=parsed.code;return parsed;}
 address.addEventListener('change',()=>{try{const p=BVRemoteSource.parseInput(address.value);if(p.code)code.value=p.code;}catch(_){}});
 async function connect(){
  const job=startWork('Connecting directly to your car…');
  try{
   const parsed=BVRemoteSource.parseInput(address.value);const pairingCode=code.value.trim()||parsed.code;
   const fallback=document.getElementById('carFallbackLink');fallback.href=parsed.baseUrl+'/?'+new URLSearchParams(pairingCode?{code:pairingCode}:{});document.getElementById('carFallback').hidden=false;
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
 window.addEventListener('pagehide',event=>{stopWork();if(!event.persisted)manager.source?.close();});
 manager.subscribe(source=>{document.body.dataset.sourceReadonly=String(source.readOnly===true);});
 const params=new URLSearchParams(location.search);const supplied=params.get('car')||params.get('address');
 if(supplied){try{fillQr(supplied);if(params.get('code'))code.value=params.get('code');}catch(e){failure(e);}history.replaceState({},'',location.pathname+location.hash);}
});
