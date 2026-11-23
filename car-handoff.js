/* One-use car pairing handoff. Fragment secrets are removed before validation or Google loading. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./remote-source'):root.BVRemoteSource);if(typeof module==='object'&&module.exports)module.exports=api;else root.BVCarHandoff=api;})(typeof globalThis!=='undefined'?globalThis:this,function(RemoteSource){
'use strict';
function consume(location,history){
 if(location.hash==='#backup')return null;
 const params=new URLSearchParams((location.hash||'').replace(/^#/,''));if(!['car','code','backup'].some(k=>params.has(k)))return null;
 history.replaceState({},'',location.pathname);
 if(!['https://bimmervision.app','https://www.bimmervision.app'].includes(location.origin)&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(location.origin||''))throw Error('Open phone backup on the hosted BimmerVision website.');
 if([...params.keys()].some(k=>!['car','code','backup','clip','drive','queue'].includes(k))||['car','code','backup'].some(k=>params.getAll(k).length!==1)||params.get('backup')!=='1'||!/^\d{8}$/.test(params.get('code')||''))throw Error('Invalid phone backup link. Reopen Connect Phone in the car.');
 if(params.has('clip')&&(params.getAll('clip').length!==1||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.get('clip'))))throw Error('Invalid selected recording.');
 if(params.has('drive')&&(params.has('clip')||params.getAll('drive').length!==1||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(params.get('drive'))))throw Error('Invalid selected drive.');
 if(params.has('queue')&&(params.getAll('queue').length!==1||params.get('queue')!=='1'||params.has('clip')||params.has('drive')))throw Error('Invalid backup queue link.');
 const parsed=RemoteSource.parseInput(params.get('car'));if(parsed.code)throw Error('Use a fresh phone backup link from the car.');
 return {address:parsed.baseUrl,code:params.get('code'),backup:true,...(params.has('queue')?{queue:true}:{}),...(params.has('clip')?{clipId:params.get('clip').toLowerCase()}:{}),...(params.has('drive')?{driveClipId:params.get('drive').toLowerCase()}:{})};
}
return {consume};
});
