/* Only public version metadata is fetched; no recording or pairing data is sent. */
(function(root){
'use strict';
const ENDPOINT='https://raw.githubusercontent.com/Hexphase/BimmerVision/main/recorder/files/version.json';
const valid=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)&&value.split('.').every(part=>Number.isSafeInteger(Number(part)));
class AppVersion {
 constructor({bundled,fetcher=fetch,onChange=()=>{},timeoutMs=4000,now=Date.now}={}){this.version=valid(bundled?.version)?bundled.version:null;this.connected=null;this.origin='bundled';this.fetcher=fetcher;this.onChange=onChange;this.timeoutMs=timeoutMs;this.now=now;this.lastCheck=-Infinity;this.pending=null;this.emit();}
 emit(){this.onChange({version:this.connected||this.version,source:this.connected?'connected':this.origin});}
 setConnected(version){this.connected=valid(version)?version:null;this.emit();}
 refresh({force=false}={}){
  if(this.pending)return this.pending;if(!force&&this.now()-this.lastCheck<900000)return Promise.resolve();this.lastCheck=this.now();
  const job=(async()=>{const controller=new AbortController();let timer;
   try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Version check timed out'));},this.timeoutMs);});
    const work=(async()=>{const response=await this.fetcher(ENDPOINT,{method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Version unavailable');const info=await response.json();if(info.repository!=='Hexphase/BimmerVision'||!valid(info.version))throw Error('Invalid version');return info.version;})();
    this.version=await Promise.race([work,timeout]);this.origin='upstream';this.emit();
   }catch(_){/* Keep the verified bundled/last known version offline. */}finally{clearTimeout(timer);}
  })();this.pending=job;job.finally(()=>{if(this.pending===job)this.pending=null;});return job;
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports={AppVersion,valid};
else root.addEventListener('DOMContentLoaded',()=>{
 const node=document.getElementById('footerAppVersion');if(!node)return;
 const version=new AppVersion({bundled:root.BV_IDRIVE_VERSION,fetcher:root.fetch.bind(root),onChange:info=>{node.textContent=info.version?'BimmerVision v'+info.version:'BimmerVision';node.title=info.source==='connected'?'Version reported by the connected iDrive app':info.source==='upstream'?'iDrive app version from its release metadata':'Bundled iDrive app version; refreshed when online';node.dataset.versionSource=info.source;}});
 root.BVAppVersion=version;root.BVSourceManager?.subscribe(()=>version.setConnected(null));version.refresh();
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)version.refresh();});root.addEventListener('online',()=>version.refresh({force:true}));
 setInterval(()=>{if(!document.hidden)version.refresh();},900000);
});
})(typeof globalThis!=='undefined'?globalThis:this);
