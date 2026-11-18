/* One-use car pairing handoff. Fragment secrets are removed before validation or Google loading. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./remote-source'):root.BVRemoteSource);if(typeof module==='object'&&module.exports)module.exports=api;else root.BVCarHandoff=api;})(typeof globalThis!=='undefined'?globalThis:this,function(RemoteSource){
'use strict';
function consume(location,history){
 const params=new URLSearchParams((location.hash||'').replace(/^#/,''));if(!['car','code','backup'].some(k=>params.has(k)))return null;
 history.replaceState({},'',location.pathname);
 if(!['https://bimmervision.app','https://www.bimmervision.app'].includes(location.origin)&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(location.origin||''))throw Error('Open phone backup on the hosted BimmerVision website.');
 if([...params.keys()].some(k=>!['car','code','backup'].includes(k))||['car','code','backup'].some(k=>params.getAll(k).length!==1)||params.get('backup')!=='1'||!/^\d{8}$/.test(params.get('code')||''))throw Error('Invalid phone backup link. Reopen Connect Phone in the car.');
 const parsed=RemoteSource.parseInput(params.get('car'));if(parsed.code)throw Error('Use a fresh phone backup link from the car.');
 return {address:parsed.baseUrl,code:params.get('code'),backup:true};
}
return {consume};
});
