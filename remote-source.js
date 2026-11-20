/* BimmerVision car transport. No credentials ever leave the exact paired origin. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.BVRemoteSource=value;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const HELP='Use current Chrome or Edge, allow Local network access, and keep the car Connect screen open on the same Wi-Fi. Update the car app to 0.2.8 or newer.';
const abortError=()=>new DOMException('Connection cancelled.','AbortError');
function key(base){return 'bimmervision.car.session:'+base;}
function storage(action,base,value){try{return globalThis.sessionStorage[action](key(base),value);}catch{return null;}}
function parseInput(value){
  if(typeof value!=='string'||!value.trim())throw new Error('Enter the private car IP address or scan its Connect QR code.');
  const raw=value.trim();if(/[\\\s\u0000-\u001f\u007f]/.test(raw))throw new Error('Invalid car address.');
  const input=/^[a-z][a-z\d+.-]*:\/\//i.test(raw)?raw:'http://'+raw;
  const match=/^(https?):\/\/([^/?#]+)(.*)$/i.exec(input);if(!match)throw new Error('Use an http or https car address.');
  const authority=match[2];if(!/^(?:localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?$/i.test(authority))throw new Error('Use a literal private IPv4 car address.');
  const [host,port]=authority.split(':');
  if((host.toLowerCase()==='localhost'||host==='127.0.0.1')&&globalThis.location&&!['localhost','127.0.0.1','[::1]'].includes(globalThis.location.hostname))throw new Error('Loopback car addresses are available only on local development pages. Use the private car IP address.');if(port!==undefined&&(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535))throw new Error('Invalid car port.');
  if(host.toLowerCase()!=='localhost'){
    const parts=host.split('.');if(parts.some(p=>! /^(0|[1-9]\d{0,2})$/.test(p)||Number(p)>255))throw new Error('Invalid IPv4 address.');
    const [a,b]=parts.map(Number);if(!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254||host==='127.0.0.1'))throw new Error('Only private car addresses are allowed.');
  }
  let url;try{url=new URL(input);}catch{throw new Error('Invalid car address.');}
  if(url.username||url.password||url.hash||url.pathname!=='/'||[...url.searchParams.keys()].some(k=>k!=='code')||url.searchParams.getAll('code').length>1)throw new Error('Use the car Connect URL without extra paths or parameters.');
  const code=url.searchParams.get('code')||'';if(code&&!/^\d{8}$/.test(code))throw new Error('Enter the 8-digit code shown on the car Connect screen.');
  return {baseUrl:new URL(`${url.protocol}//${url.hostname}:${port|| (url.protocol==='https:'?'8766':'8765')}`).origin,code};
}
class RemoteSource{
  constructor(baseUrl){this.kind='car';this.name='Car · '+new URL(baseUrl).hostname;this.readOnly=false;this.baseUrl=baseUrl;this._requests=new Set();this._closed=false;this._token='';this._csrf='';}
  static parseInput(value){return parseInput(value);}
  static async connect(input,{code,signal,onProgress}={}){
    const parsed=parseInput(input);const source=new RemoteSource(parsed.baseUrl);
    const progress=text=>{if(onProgress)onProgress(text);};
    try{
      if(signal?.aborted)throw abortError();
      const explicitCode=String(code||parsed.code||'').trim();
      let saved;if(!explicitCode)try{saved=JSON.parse(storage('getItem',source.baseUrl)||'null');}catch{}
      if(saved&&typeof saved.token==='string'&&saved.token.length<=4096&&saved.token){
        source._token=saved.token;source._csrf=typeof saved.csrf==='string'?saved.csrf:'';progress('Checking saved car session…');
        const response=await source.fetch('/api/v1/recordings',{signal,timeoutMs:15000});
        if(response.ok){await response.arrayBuffer();if(signal?.aborted)throw abortError();return source;}
        await response.body?.cancel();
        if(response.status!==401&&response.status!==403)throw new Error('The car could not validate the saved session. '+HELP);
        source._token='';source._csrf='';storage('removeItem',source.baseUrl);
      }
      const pairingCode=String(code||parsed.code||'').trim();if(!/^\d{8}$/.test(pairingCode))throw new Error('Enter the 8-digit code on the car Connect screen. If it was already used, reopen Connect for a new code.');
      progress('Pairing with the car…');
      const response=await source._request('/api/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:pairingCode,clientId:globalThis.crypto.randomUUID()}),signal,timeoutMs:15000},false);
      if(!response.ok){await response.body?.cancel();throw new Error(response.status===409?'This code was already claimed. Reopen the car Connect screen for a new 8-digit code.':response.status===401||response.status===403?'The code expired or was rejected. Reopen the car Connect screen and enter the new 8-digit code.':'The car could not pair. '+HELP);}
      const text=await response.text();if(text.length>65536)throw new Error('Invalid pairing response.');
      let data;try{data=JSON.parse(text);}catch{throw new Error('Invalid pairing response. Update the car app to 0.2.8 or newer.');}
      if(!data||typeof data.token!=='string'||!data.token||data.token.length>4096||/[\r\n]/.test(data.token)||typeof data.csrf!=='string'||data.csrf.length>4096||/[\r\n]/.test(data.csrf))throw new Error('Invalid pairing response.');
      if(data.backupClipIds!==undefined){
        const ids=data.backupClipIds,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw new Error('Invalid backup selection in pairing response.');
        source.backupClipIds=Object.freeze(ids.map(id=>id.toLowerCase()));
      }
      if(signal?.aborted||source._closed)throw abortError();
      source._token=data.token;source._csrf=data.csrf;storage('setItem',source.baseUrl,JSON.stringify({token:data.token,csrf:data.csrf}));return source;
    }catch(error){source.close();throw error;}
  }
  fetch(path,options={}){return this._request(path,options,true);}
  async _request(path,options,authenticated){
    if(this._closed||options.signal?.aborted)throw abortError();
    if(typeof path!=='string'||!/^\/api\/v1\/[a-z0-9_-]+(?:[/?]|$)/i.test(path)||/[\\\u0000-\u0020\u007f#]/.test(path)||/%(?:2e|2f|5c)/i.test(path)||path.split(/[/?]/).includes('..'))throw new Error('Only relative car API routes are allowed.');
    const url=new URL(path,this.baseUrl);if(url.origin!==this.baseUrl||!url.pathname.startsWith('/api/v1/'))throw new Error('Car API origin mismatch.');
    const headers=new Headers(options.headers);if(headers.has('Authorization')||headers.has('Cookie')||headers.has('X-CSRF-Token')||headers.has('X-BV-CSRF'))throw new Error('Car credentials are managed by the connection.');
    // Bearer requests are cookie-free; the car CORS policy permits Authorization only.
    if(authenticated&&this._token)headers.set('Authorization','Bearer '+this._token);
    const controller=new AbortController();this._requests.add(controller);let timer,streamController,reader;
    const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);this._requests.delete(controller);};
    const abort=()=>controller.abort(options.signal?.reason||abortError());
    const onAbort=()=>{if(streamController){streamController.error(controller.signal.reason||abortError());reader?.cancel().catch(()=>{});}cleanup();};
    options.signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',onAbort,{once:true});
    const timeoutMs=Number.isFinite(options.timeoutMs)?Math.max(1,Math.min(options.timeoutMs,120000)):15000;
    timer=setTimeout(()=>controller.abort(new DOMException('Car request timed out. '+HELP,'TimeoutError')),timeoutMs);
    try{
      const requestOptions={...options,headers,signal:controller.signal,mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'};delete requestOptions.timeoutMs;
      const response=await globalThis.fetch(url.href,requestOptions);
      if(controller.signal.aborted)throw controller.signal.reason||abortError();
      clearTimeout(timer);
      // Bulk recording streams use the player's inactivity bounds. JSON bodies remain bounded.
      if(!/\/api\/v1\/(?:recordings\/[^/]+\/(?:data|download|video|capture\.bvr|raw\.zip|[^/]+\.mp4)|preview\/)/.test(url.pathname))timer=setTimeout(()=>controller.abort(new DOMException('Car response timed out. '+HELP,'TimeoutError')),timeoutMs);
      if(!response.body){cleanup();return response;}
      reader=response.body.getReader();
      const body=new ReadableStream({start(c){streamController=c;},async pull(c){try{const part=await reader.read();if(controller.signal.aborted)return;if(part.done){c.close();cleanup();}else c.enqueue(part.value);}catch(error){if(!controller.signal.aborted)c.error(error);cleanup();}},cancel(reason){cleanup();return reader.cancel(reason);}});
      return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch(error){cleanup();if(controller.signal.aborted)throw controller.signal.reason||abortError();throw new Error('Cannot reach the car. '+HELP);}
  }
  close(){if(this._closed)return;this._closed=true;for(const controller of [...this._requests])controller.abort(abortError());}
}
return RemoteSource;
});
