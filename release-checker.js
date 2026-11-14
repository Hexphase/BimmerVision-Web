/* Device-side only. Never pass this request through apiFetch or the car. */
class ReleaseChecker {
  constructor({fetcher=fetch,storage=null,timeoutMs=8000,nowMs=Date.now}={}){this.fetcher=fetcher;this.storage=storage;this.timeoutMs=timeoutMs;this.nowMs=nowMs;}
  static parse(version){
    const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version||''));
    if(!m)return null;const parts=m.slice(1,4).map(Number);return parts.every(Number.isSafeInteger)?parts:null;
  }
  static compare(a,b){const x=this.parse(a),y=this.parse(b);if(!x||!y)return null;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]?1:-1;}return 0;}
  static safeUrl(value){try{const url=new URL(value);return url.origin==='https://github.com'&&/^\/Hexphase\/BimmerVision\/releases\/tag\/[^/]+$/i.test(url.pathname)&&!url.username&&!url.password&&!url.search&&!url.hash?url.href:null;}catch(_){return null;}}
  static validCache(result,version){
    if(!result||result.currentVersion!==version)return false;
    if(result.state==='unavailable')return typeof result.reason==='string';
    const comparison=this.compare(result.latestVersion,version);
    return comparison!==null&&this.safeUrl(result.url)&&((result.state==='update'&&comparison>0)||(result.state==='current'&&comparison<=0));
  }
  async check(currentVersion,{force=false}={}){
    const key='bimmervision_release_check_v1',now=this.nowMs();
    if(!ReleaseChecker.parse(currentVersion))return {state:'unavailable',reason:'Installed version unavailable.'};
    if(!force){try{const cache=JSON.parse(this.storage?.getItem(key)||'null');const ttl=cache?.result?.state==='unavailable'?60000:900000;if(cache?.version===currentVersion&&now>=cache.at&&now-cache.at<ttl&&ReleaseChecker.validCache(cache.result,currentVersion))return cache.result;}catch(_){}}
    const controller=new AbortController();let timer;
    let result;
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Update check timed out.'));},this.timeoutMs);});
      const work=(async()=>{
        const response=await this.fetcher('https://api.github.com/repos/Hexphase/BimmerVision/releases/latest',{method:'GET',mode:'cors',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json'},signal:controller.signal});
        if(!response.ok)throw new Error(response.status===404?'No accessible published stable release found.':response.status===403||response.status===429?'GitHub update check is temporarily limited.':'GitHub update check unavailable.');
        return response.json();
      })();
      const data=await Promise.race([work,timeout]);
      const version=ReleaseChecker.parse(data.tag_name),url=ReleaseChecker.safeUrl(data.html_url);
      if(data.draft!==false||data.prerelease!==false||!version||!url)throw new Error('No recognized stable release found.');
      result={state:ReleaseChecker.compare(data.tag_name,currentVersion)>0?'update':'current',currentVersion,latestVersion:version.join('.'),url};
    }catch(error){result={state:'unavailable',currentVersion,reason:error.name==='AbortError'?'Update check timed out.':error.message||'Update check unavailable.'};}
    finally{clearTimeout(timer);}
    try{this.storage?.setItem(key,JSON.stringify({version:currentVersion,at:now,result}));}catch(_){}
    return result;
  }
}
if(typeof module!=='undefined')module.exports={ReleaseChecker};
