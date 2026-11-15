/* Selected-source ZIP saving. Credentials stay inside the car transport. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BVRawDownload=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
async function save({manager,id,signal,saveFilePicker,onProgress=()=>{},maxBlobBytes=512*1024*1024,inactivityMs=45000}){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw Error('Invalid recording');
 const source=manager.source,generation=manager.generation,controller=new AbortController(),fileName='BimmerVision-'+id+'.zip';
 let response,reader,writable,completed=false,total=0,tail=new Uint8Array(),prefix=new Uint8Array();const chunks=[];
 const stop=()=>controller.abort(signal?.reason||new DOMException('Download cancelled','AbortError'));
 const changed=()=>controller.abort(new DOMException('Recording source changed. Download cancelled.','AbortError'));
 const unsubscribe=manager.subscribe(changed);
 signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
 function check(){if(controller.signal.aborted)throw controller.signal.reason;if(manager.generation!==generation||manager.source!==source)throw new DOMException('Recording source changed','AbortError');}
 function cancelReader(){reader?.cancel(controller.signal.reason).catch(()=>{});}
 controller.signal.addEventListener('abort',cancelReader,{once:true});
 async function bounded(promise,label){let timer,rejectAbort;try{check();return await Promise.race([promise,new Promise((resolve,reject)=>{rejectAbort=()=>reject(controller.signal.reason||new DOMException('Cancelled','AbortError'));controller.signal.addEventListener('abort',rejectAbort,{once:true});timer=setTimeout(()=>{const e=new DOMException('Timed out '+label+'. Check the connection and retry.','TimeoutError');controller.abort(e);reject(e);},inactivityMs);})]);}finally{clearTimeout(timer);if(rejectAbort)controller.signal.removeEventListener('abort',rejectAbort);}}
 try{
  check();
  if(saveFilePicker){const handle=await saveFilePicker({suggestedName:fileName,types:[{description:'Original BimmerVision recording and metadata',accept:{'application/zip':['.zip']}}]});check();writable=await handle.createWritable();check();}
  response=await bounded(manager.fetch(`/api/v1/recordings/${id}/raw.zip`,{signal:controller.signal}),'opening the recording ZIP');check();
  if(!response.ok){response.body?.cancel().catch(()=>{});throw Error(response.status===404?'Raw ZIP downloads from the car require car app 0.2.15 or newer. You can also open its USB folder here.':response.status===429?'Another car download is active. Wait for it to finish and retry.':response.status===401||response.status===403?'Reconnect to your car, then retry the ZIP download.':'Original recording download failed: HTTP '+response.status);}
  if(!/^application\/(zip|x-zip-compressed|octet-stream)\b/i.test(response.headers.get('Content-Type')||''))throw Error('The selected source did not return a ZIP file.');
  const expected=Number(response.headers.get('Content-Length'))||0;
  if(!writable&&expected>maxBlobBytes)throw Error('This ZIP is too large for a buffered browser download. Use a desktop browser with streamed saving or the car’s built-in download page.');
  if(!response.body?.getReader)throw Error('Streaming downloads are unavailable in this browser.');
  reader=response.body.getReader();
  for(;;){
   const part=await bounded(reader.read(),'reading the recording ZIP');check();if(part.done)break;const value=part.value;total+=value.byteLength;
   if(!writable&&total>maxBlobBytes)throw Error('Browser download size limit reached. Use a desktop browser with streamed saving or the car’s built-in download page.');
   if(prefix.length<4){const p=new Uint8Array(Math.min(4,prefix.length+value.length));p.set(prefix);p.set(value.subarray(0,p.length-prefix.length),prefix.length);prefix=p;}
   const next=new Uint8Array(Math.min(22,tail.length+value.length));if(value.length>=22)next.set(value.subarray(value.length-22));else{const keep=next.length-value.length;next.set(tail.subarray(tail.length-keep));next.set(value,keep);}tail=next;
   if(writable)await bounded(writable.write(value),'saving the recording ZIP');else chunks.push(value);
   onProgress({bytes:total,total:expected,sourceKind:source.kind});
  }
  if(prefix.length!==4||prefix[0]!==80||prefix[1]!==75||prefix[2]!==3||prefix[3]!==4||tail.length!==22||tail[0]!==80||tail[1]!==75||tail[2]!==5||tail[3]!==6||expected&&total!==expected)throw Error('The ZIP download was incomplete. No completed file was saved. Retry the download.');
  if(writable){await bounded(writable.close(),'finishing the ZIP file');check();completed=true;return {mode:'file',fileName,bytes:total};}
  const blob=new Blob(chunks,{type:'application/zip'});completed=true;return {mode:'blob',blob,fileName,bytes:total};
 }finally{
  unsubscribe();signal?.removeEventListener('abort',stop);controller.signal.removeEventListener('abort',cancelReader);
  if(!completed){controller.abort();if(!reader)response?.body?.cancel().catch(()=>{});reader?.cancel().catch(()=>{});if(writable)Promise.resolve(writable.abort()).catch(()=>{});}
  try{reader?.releaseLock();}catch(_){}chunks.length=0;
 }
}
return {save};
});
