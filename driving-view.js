const DrivingSigns=typeof BVTrafficSigns!=='undefined'?BVTrafficSigns:(typeof module!=='undefined'&&module.exports?require('./traffic-signs'):null);
/* The player owns time. The view owns only rendering and may fail independently. */
class BVDrivingView {
  constructor(panel,sceneLoader=()=>import('./driving-scene.js?v=signs-1')) {
    this.panel=panel;this.stage=panel.querySelector('.driving-stage');this.message=panel.querySelector('.driving-message');this.detail=panel.querySelector('.driving-detail');this.distance=panel.querySelector('.driving-distance');this.status=panel.querySelector('.driving-status');this.signCanvas=panel.querySelector('.driving-signs');this.loader=sceneLoader;this.epoch=0;this.time=0;
    panel.querySelector('.driving-angle')?.addEventListener('click',e=>{this.overhead=!this.overhead;e.currentTarget.setAttribute('aria-pressed',String(this.overhead));this.scene?.setView(this.overhead?'overhead':'perspective');});
  }
  reset(message='Open a recording to build its driving view.') {
    ++this.epoch;this.abort?.abort();this.abort=null;this.scene?.dispose();this.scene=null;this.data=null;this.time=0;this.message.hidden=false;this.message.textContent=message;this.status.textContent='RECORDED';this.detail.textContent='';this.distance.textContent='';this.signKey=null;this.panel.dataset.state='empty';this.updateSigns();
  }
  // Native previews contain telemetry only. Read raw events independently while
  // the MP4 plays; no video packets are retained or decoded a second time.
  async loadSource(url,manifest) {
    const token=++this.epoch,controller=new AbortController();this.abort=controller;
    this.message.hidden=false;this.message.textContent='Reading driving metadata…';this.panel.dataset.state='loading';
    let reader,timer;
    const deadline=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),45000);};
    try {
      deadline();const response=await bvFetch(url,{signal:controller.signal});if(!response.ok)throw Error('Metadata unavailable');
      const parser=new StreamingBvrParser({});reader=response.body.getReader();
      while(true){deadline();const {done,value}=await reader.read();if(controller.signal.aborted)throw Error('Cancelled');if(done)break;parser.append(value);}
      if(token===this.epoch)await this.load(parser,manifest);
    } catch(e) {if(token===this.epoch){this.message.textContent='Driving metadata could not be read. Video playback is still available.';this.status.textContent='UNAVAILABLE';this.panel.dataset.state='unavailable';}}
    finally {clearTimeout(timer);if(reader){if(controller.signal.aborted)await reader.cancel().catch(()=>{});reader.releaseLock();}if(this.abort===controller)this.abort=null;}
  }
  async load(parser,manifest) {
    const token=++this.epoch;this.scene?.dispose();this.scene=null;this.message.hidden=false;this.message.textContent='Building driving view…';this.panel.dataset.state='loading';
    try {
      const data=parser.perception?.finish(parser.telemetryRecords,manifest.startMonotonicUs,manifest.durationSeconds||0,[]) || {frames:[],gps:[]};data.speedLimits=(parser.speedLimitEvents||[]).map(e=>({...e,t:(e.atUs-(manifest.startMonotonicUs||0))/1e6}));this.data=data;this.updateSigns();
      if(!DrivingSigns.hasData(data)){this.message.textContent=data.limited?'This recording exceeds the driving-view metadata limit. Video playback is still available.':'This recording has no supported lane or traffic metadata.';this.panel.dataset.state='unavailable';this.status.textContent='UNAVAILABLE';return;}
      const module=await this.loader();if(token!==this.epoch)return;
      const scene=await module.createDrivingScene(this.stage,data,message=>{if(token===this.epoch){this.message.hidden=false;this.message.textContent=message;this.panel.dataset.state='unavailable';}});
      if(token!==this.epoch){scene.dispose();return;}
      this.scene=scene;this.scene.setView(this.overhead?'overhead':'perspective');this.message.hidden=true;this.panel.dataset.state='ready';this.status.textContent='';this.setTime(this.time);
    } catch(e) {if(token!==this.epoch)return;this.message.hidden=false;this.message.textContent='The 3D view could not load. Video playback is still available.';this.panel.dataset.state='unavailable';this.status.textContent='UNAVAILABLE';}
  }
  setTime(t) {
    this.time=t;this.updateSigns();if(!this.scene)return;
    try {
      const f=this.scene.setTime(t),lead=f?.o.find(o=>o[0]===f.lead&&o[1]>0);
      this.distance.textContent=lead?Math.round(lead[1]/.3048)+' ft ahead':'';
      this.detail.textContent=f?(f.b.length?'Recorded lanes':'Lanes unavailable')+(this.data.gps.length>2?' · GPS estimate ahead':''):'No fresh perception at this time';
    } catch(e) {this.reset('The 3D view is unavailable. Video playback is still available.');}
  }
  updateSigns(){
    if(!this.signCanvas?.getContext)return;
    const signs=this.data?DrivingSigns.at(this.data,this.time).display:[],canvas=this.signCanvas;
    canvas.hidden=!signs.length;
    if(!signs.length){this.signKey=null;canvas.removeAttribute('aria-label');return;}
    const key=JSON.stringify(signs.map(s=>[s.kind,s.value,s.unit]));if(key===this.signKey)return;this.signKey=key;
    canvas.width=96*signs.length;canvas.height=112;const ctx=canvas.getContext('2d');
    for(let i=0;i<signs.length;i++)DrivingSigns.draw(ctx,signs[i],i*96,0,96);
    canvas.setAttribute('aria-label',signs.map(s=>s.label+(s.value?' '+s.value+' '+s.unit:'')).join(', '));
  }
  async createExportRenderer() {
    const data=this.data,token=this.epoch;
    if(!DrivingSigns.hasData(data))throw new Error('Driving view metadata is unavailable for this recording.');
    const module=await this.loader();
    if(token!==this.epoch)throw new Error('Export cancelled because the recording changed.');
    const doc=this.panel.ownerDocument,stage=doc.createElement('div');
    stage.style.cssText='position:fixed;left:-10000px;top:0;width:640px;height:480px;pointer-events:none;';
    stage.className='driving-export-stage';stage.setAttribute('aria-hidden','true');doc.body.append(stage);
    let scene,disposed=false,failure;
    const dispose=()=>{if(disposed)return;disposed=true;scene?.dispose();stage.remove();};
    try {
      scene=await module.createDrivingScene(stage,data,message=>{failure=new Error(message);});
      if(token!==this.epoch)throw new Error('Export cancelled because the recording changed.');
      return {drawTo(ctx,x,y,w,h,t){
        if(disposed||failure)throw failure||new Error('Driving view export was closed.');
        scene.setSize(w,h);const f=scene.setTime(t);
        ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(scene.canvas,x,y,w,h);
        ctx.fillStyle='#d6dfec';ctx.font='14px -apple-system, BlinkMacSystemFont, sans-serif';ctx.textAlign='left';ctx.fillText('DRIVING VIEW',x+16,y+24);
        const lead=f?.o.find(o=>o[0]===f.lead&&o[1]>0);
        if(lead){ctx.font='18px -apple-system, BlinkMacSystemFont, sans-serif';ctx.fillText(Math.round(lead[1]/.3048)+' ft ahead',x+16,y+50);}
        const signs=DrivingSigns.at(data,t).display;for(let i=0;i<signs.length;i++)DrivingSigns.draw(ctx,signs[i],x+w-16-(signs.length-i)*48,y+12,44);
        ctx.restore();
      },dispose};
    } catch(error){dispose();throw error;}
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports={BVDrivingView};
