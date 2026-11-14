/* Confirmed recording identity, independent of browser-specific view defaults. */
class CameraStore {
  constructor(fetcher,storage){this.fetcher=fetcher;this.storage=storage;}
  static valid(m){return !!m&&m.schemaVersion===1&&m.confirmed===true&&['frontRear','leftRight'].includes(m.phase0)&&['frontRear','leftRight'].includes(m.phase1)&&m.phase0!==m.phase1&&typeof m.flipHalves==='boolean';}
  key(id){return 'bimmervision_confirmed_mapping_'+id;}
  async load(id){
    let local=null;
    try{local=JSON.parse(this.storage.getItem(this.key(id)));}catch(_){}
    if(local?.pending && CameraStore.valid(local.mapping))return local.mapping;
    try{const r=await this.fetcher(`/api/v1/recordings/${encodeURIComponent(id)}/mapping.json`);if(r.ok){const m=await r.json();if(CameraStore.valid(m))return m;}}catch(_){}
    const fallback=local?.mapping||local;
    return CameraStore.valid(fallback)?fallback:null;
  }
  async save(id,mapping){
    const m={schemaVersion:1,confirmed:true,phase0:mapping.phase0,phase1:mapping.phase1,flipHalves:mapping.flipHalves};
    if(!CameraStore.valid(m))throw new Error('Confirm both camera pairs before saving.');
    let savedLocally=false;
    try{this.storage.setItem(this.key(id),JSON.stringify({mapping:m,pending:true}));savedLocally=true;}catch(_){}
    try{const r=await this.fetcher(`/api/v1/recordings/${encodeURIComponent(id)}/mapping.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});if(!r.ok)throw new Error('HTTP '+r.status);}
    catch(cause){const error=new Error(savedLocally?'Camera assignments saved in this browser only. The server save failed.':'Camera assignments could not be saved. Check the connection and retry.');error.savedLocally=savedLocally;throw error;}
    try{this.storage.setItem(this.key(id),JSON.stringify({mapping:m,pending:false}));}catch(_){}
    return m;
  }
}
if(typeof module!=='undefined')module.exports={CameraStore};
