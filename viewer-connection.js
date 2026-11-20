/* A visible paired viewer holds a short local lease; no recording data or cloud traffic. */
(function(root){
'use strict';
function createViewerConnection({manager,document,events,setTimeout,clearTimeout}){
 let timer=null,inFlight=null,epoch=0,pageHidden=false,closed=false,connected=false;
 const available=()=>!closed&&!pageHidden&&document.hidden!==true&&manager.source?.kind==='car';
 function stop(){epoch++;if(timer!==null)clearTimeout(timer);timer=null;inFlight?.abort();inFlight=null;connected=false;}
 async function heartbeat(){
  if(!available()||inFlight)return;
  const source=manager.source,generation=manager.generation,ticket=epoch,controller=new AbortController();inFlight=controller;
  const current=()=>ticket===epoch&&inFlight===controller&&available()&&manager.source===source&&manager.generation===generation;
  let timeout,aborted;
  try{
   const deadline=new Promise((resolve,reject)=>{
    aborted=()=>reject(new DOMException('Viewer heartbeat stopped.','AbortError'));
    controller.signal.addEventListener('abort',aborted,{once:true});
    timeout=setTimeout(()=>controller.abort(),5000);
   });
   // Race the whole response, including JSON: an abandoned custom source may
   // ignore abort or never finish its body. It must not hold the loop open.
   const request=(async()=>{
    const response=await source.fetch('/api/v1/viewer-heartbeat',{method:'GET',signal:controller.signal});
    if(!response.ok)throw Error('Viewer heartbeat unavailable');
    return await response.json();
   })();
   const value=await Promise.race([request,deadline]);
   if(current())connected=value?.connected===true;
  }catch(e){if(current())connected=false;}
  finally{
   if(timeout!==undefined)clearTimeout(timeout);
   controller.signal.removeEventListener('abort',aborted);
   if(inFlight===controller)inFlight=null;
  }
 }
 function schedule(){if(!available()||timer!==null)return;timer=setTimeout(()=>{timer=null;void heartbeat();schedule();},5000);}
 function sync(){stop();if(available()){void heartbeat();schedule();}}
 const unsubscribe=manager.subscribe(sync);
 const hide=()=>{pageHidden=true;stop();};
 const show=()=>{pageHidden=false;sync();};
 const visibility=()=>sync();
 events.addEventListener('pagehide',hide);events.addEventListener('pageshow',show);document.addEventListener('visibilitychange',visibility);
 sync();
 return {get connected(){return connected;},close(){if(closed)return;closed=true;stop();unsubscribe?.();events.removeEventListener('pagehide',hide);events.removeEventListener('pageshow',show);document.removeEventListener('visibilitychange',visibility);}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createViewerConnection};
else root.addEventListener('DOMContentLoaded',()=>{
 if(root.BVSourceManager)root.BVViewerConnection=createViewerConnection({manager:root.BVSourceManager,document:root.document,events:root,setTimeout:root.setTimeout.bind(root),clearTimeout:root.clearTimeout.bind(root)});
});
})(typeof globalThis!=='undefined'?globalThis:this);
