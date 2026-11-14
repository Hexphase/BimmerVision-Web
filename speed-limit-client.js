/* Device-side Overpass fallback. CORS is documented at https://dev.overpass-api.de/command_line.html.
 * Uses the device Internet connection, never recorder cookies/bearer headers. Only explicit,
 * unambiguous OSM maxspeed tags qualify; no road-class defaults. One query/10s, one in flight,
 * 30s negative / 1h positive coordinate cache, bounded to 1000 entries; no persistent GPS cache.
 */
(function(root){
'use strict';
var cache=new Map(),active=false,lastRequest=-Infinity;
function parse(raw){var m=/^(\d+(?:\.\d+)?)\s*(mph|km\/h)?$/.exec(String(raw||'').trim());if(!m)return null;var n=Number(m[1]);return n>0&&n<=200?{limit:n,unit:m[2]==='mph'?'mph':'km/h'}:null;}
function distance(geometry,lat,lon){var best=Infinity,c=Math.cos(lat*Math.PI/180);for(var i=1;i<(geometry||[]).length;i++){var a=geometry[i-1],b=geometry[i],x=(a.lon-lon)*111320*c,y=(a.lat-lat)*111320,dx=(b.lon-a.lon)*111320*c,dy=(b.lat-a.lat)*111320,z=dx*dx+dy*dy,t=z?Math.max(0,Math.min(1,-(x*dx+y*dy)/z)):0;best=Math.min(best,Math.sqrt((x+t*dx)*(x+t*dx)+(y+t*dy)*(y+t*dy)));}return best;}
function fromWays(ways,lat,lon){var near=(ways||[]).filter(function(w){return w.type==='way'&&w.tags&&w.tags.highway&&distance(w.geometry,lat,lon)<=12;});if(near.length!==1)return null;var w=near[0],tags=w.tags;if(Object.keys(tags).some(function(k){return /^maxspeed:/.test(k)&&k!=='maxspeed:type';}))return null;var r=parse(tags.maxspeed);if(!r)return null;r.source='OpenStreetMap maxspeed';r.attribution='© OpenStreetMap contributors';r.sourceUrl='https://www.openstreetmap.org/way/'+w.id;r.road=tags.name||null;r.isEstimated=false;var closest=0,best=Infinity;for(var j=0;j<(w.geometry||[]).length;j++){var g=w.geometry[j],d=Math.pow(g.lat-lat,2)+Math.pow((g.lon-lon)*Math.cos(lat*Math.PI/180),2);if(d<best){best=d;closest=j;}}r.geometry=(w.geometry||[]).slice(Math.max(0,closest-32),closest+33);return r;}

async function readDocument(response){
 if(!response.ok)return null;
 var maximum=1048576,declared=response.headers&&Number(response.headers.get('content-length'));
 if(declared>maximum)throw Error('Map response too large');
 if(!response.body||!response.body.getReader){var text=await response.text();if(text.length>maximum)throw Error('Map response too large');return JSON.parse(text);}
 var reader=response.body.getReader(),decoder=new TextDecoder(),parts=[],size=0;
 try{while(true){var chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maximum){reader.cancel().catch(function(){});throw Error('Map response too large');}parts.push(decoder.decode(chunk.value,{stream:true}));}parts.push(decoder.decode());return JSON.parse(parts.join(''));}
 finally{reader.releaseLock();}
}
async function lookup(lat,lon,signal){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||(lat===0&&lon===0)||signal&&signal.aborted)return null;
 var now=Date.now(),key=lat.toFixed(5)+','+lon.toFixed(5),old=cache.get(key);
 if(old&&now<old.until)return old.value;
 if(active||now-lastRequest<10000)return null;
 active=true;lastRequest=now;
 var abort=new AbortController(),rejectDeadline;
 var deadline=new Promise(function(resolve,reject){rejectDeadline=reject;});
 abort.signal.addEventListener('abort',function(){rejectDeadline(Error('Map lookup cancelled'));},{once:true});
 var timer=setTimeout(function(){abort.abort();},5500);
 function cancel(){abort.abort();}if(signal)signal.addEventListener('abort',cancel,{once:true});
 try{
  var q='[out:json][timeout:4][maxsize:1048576];way["highway"](around:25,'+lat.toFixed(6)+','+lon.toFixed(6)+');out tags geom;';
  var response=await Promise.race([deadline,fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{signal:abort.signal,credentials:'omit',referrerPolicy:'no-referrer',mode:'cors'})]);
  var doc=await Promise.race([deadline,readDocument(response)]);
  if(abort.signal.aborted)return null;
  var value=doc&&!doc.remark?fromWays(doc.elements,lat,lon):null;
  cache.delete(key);cache.set(key,{value:value,until:Date.now()+(value?3600000:30000)});
  while(cache.size>1000)cache.delete(cache.keys().next().value);
  return value;
 }catch(e){if(!abort.signal.aborted){cache.delete(key);cache.set(key,{value:null,until:Date.now()+30000});while(cache.size>1000)cache.delete(cache.keys().next().value);}return null;}
 finally{clearTimeout(timer);if(signal)signal.removeEventListener('abort',cancel);active=false;}
}
var api={lookup:lookup,fromWays:fromWays,parseMaxspeed:parse};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BimmerVisionSpeedLimits=api;
})(typeof globalThis!=='undefined'?globalThis:this);
