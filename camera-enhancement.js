// Camera inference runs on sampled frames. Each overlay uses KAFAS from that same instant.
class BVCameraEnhancement {
  constructor(owner,panel){
    this.owner=owner;
    this.toggle=panel.querySelector('.camera-enhanced-toggle');
    this.output=panel.querySelector('.camera-enhanced-output');
    this.status=panel.querySelector('.camera-enhanced-status');
    this.cameras=panel.querySelector('.camera-enhanced-cameras');
    this.objectPreviews=panel.querySelector('.camera-object-previews');
    this.key=panel.querySelector('.camera-enhanced-key');
    this.calibrate=panel.querySelector('.camera-enhanced-calibrate');
    this.mappings=new Map();
    this.generation=0;
    this.picker=panel.querySelector('.camera-picker');
    this.grid=panel.querySelector('.camera-picker-grid');
    this.note=panel.querySelector('.camera-picker-note');
    this.details=panel.querySelector('.camera-enhanced-details');
    this.details.onclick=()=>this.output.showModal();
    panel.querySelector('.camera-details-close').onclick=()=>this.output.close();
    const cancel=()=>this.setup?.abort();
    panel.querySelector('.camera-picker-cancel').onclick=cancel;
    this.picker.oncancel=e=>{e.preventDefault();cancel();};
    this.toggle.onchange=()=>{
      if(this.toggle.checked){this.configure(false);return;}
      this.requested=false;this.invalidate();this.owner.setTime(this.owner.time);
    };
    this.calibrate.onclick=()=>this.configure(true);
  }

  async configure(force){
    if(this.setup)return;
    this.requested=false;this.invalidate();
    const controller=new AbortController(), mappings=new Map(this.mappings);
    this.setup=controller;this.toggle.disabled=true;
    this.note.textContent='Preparing camera layouts…';
    this.picker.showModal();
    try{
      await this.owner.calibrateCameraLayouts({signal:controller.signal,mappings,force,
        choose:(...args)=>this.pick(...args,controller.signal)});
      controller.signal.throwIfAborted();
      if(!mappings.size && !this.owner.cameraSource?.()?.front)throw Error('No complete camera layouts');
      this.mappings=mappings;this.requested=true;
    }catch(error){
      if(!controller.signal.aborted)this.status.textContent='Could not prepare the camera layouts. Try again.';
    }finally{
      if(this.setup===controller){
        this.setup=null;this.toggle.disabled=false;this.picker.close();this.grid.replaceChildren();
        if(this.status.textContent && !this.requested)this.output.showModal();
        this.owner.setTime(this.owner.time);
      }
    }
  }

  invalidate(){
    ++this.generation;
    this.toggle.checked=false;
    this.details.hidden=true;
    if(this.output.open)this.output.close();
    if(this.picker.open)this.picker.close();
    this.grid.replaceChildren();
    this.objectPreviews.replaceChildren();
    this.paintWorker?.terminate();this.paintWorker=null;
    this.paintBusy=false;this.paintTime=null;this.stopBar=null;this.paintFailed=false;
    this.objectWorker?.terminate();this.objectWorker=null;
    this.objectBusy=false;this.roadUsers=null;this.signalSample=null;this.objectFailed=false;
    this.worker?.terminate();
    this.worker=null;this.busy=false;this.sample=null;this.failed=false;this.picking=false;
    this.cameras.replaceChildren();this.key.hidden=true;this.calibrate.hidden=true;this.status.textContent='';
  }
  reset(){
    this.setup?.abort();this.setup=null;this.toggle.disabled=false;
    this.invalidate();this.mappings.clear();this.segment=null;
    this.requested=false;
  }
  pick(source,index,total,time,signal){
    this.note.textContent='Layout '+index+' of '+total+' · '+Math.floor(time/60)+':'+String(Math.floor(time%60)).padStart(2,'0')+' · Choose the view looking straight ahead.';
    this.grid.replaceChildren();
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      for(let i=0;i<4;i++){
        const phase=i>>1,half=i%2,button=document.createElement('button'),canvas=document.createElement('canvas');
        canvas.width=192;canvas.height=144;
        canvas.getContext('2d').drawImage(source.pairs[phase],half*640,0,640,480,0,0,192,144);
        button.type='button';button.setAttribute('aria-label','Use camera '+(i+1)+' as front');
        button.append(canvas);this.grid.append(button);
        if(i===0)button.focus();
        button.onclick=()=>{
          signal.removeEventListener('abort',abort);this.grid.replaceChildren();
          this.note.textContent='Preparing camera layouts…';resolve({phase,half});
        };
      }
    });
  }

  at(t){
    if(!this.requested || this.failed)return null;
    const source=this.owner.cameraSource?.();
    if(!source){
      // Pair decoding can briefly lag playback. A missing bitmap within the
      // same layout must not terminate in-flight inference or reload the model.
      if(this.segment!=null && this.segment===this.owner.cameraSegmentAt?.(t)){
        return {time:this.sample?.time??t,results:this.sample?.results??[],roadUsers:this.roadUsers,signalSample:this.signalSample,stopBar:this.stopBar};
      }
      if(this.worker||this.objectWorker||this.sample)this.invalidate();
      this.toggle.checked=true;
      this.details.hidden=false;
      this.status.textContent='Showing KAFAS while paired camera frames are unavailable.';
      return null;
    }
    if(source.segment!==this.segment){this.invalidate();this.segment=source.segment;}
    const mapping=this.mappings.has(source.segment)?this.mappings.get(source.segment):source.tagged?source:null;
    if(!mapping){
      this.toggle.checked=true;this.details.hidden=false;this.calibrate.hidden=false;
      this.status.textContent='No calibration for this layout. Showing KAFAS.';
      return null;
    }
    if(this.picker.open)this.picker.close();
    this.toggle.checked=true;
    this.details.hidden=false;
    this.calibrate.hidden=false;
    if(this.paintTime!=null && (t<this.paintTime || t-this.paintTime>1.2))this.stopBar=null;
    if(!source.front && !this.paintBusy && !this.paintFailed && (this.paintTime==null || Math.abs(t-this.paintTime)>=.085))
      this.detectPaint(t,source,mapping);
    if(!this.objectBusy && !this.objectFailed && (!this.roadUsers || Math.abs(t-this.roadUsers.time)>(source.front ? .7 : .20)))
      this.detectRoadUsers(t,source,mapping);
    if(!source.front && !this.busy && (!this.sample || Math.abs(t-this.sample.time)>.4)){
      this.start(t,source,mapping);
    }
    if(!this.sample && !this.roadUsers && !this.signalSample && !this.stopBar)return null;
    return {time:this.sample?.time??t,results:this.sample?.results??[],roadUsers:this.roadUsers,signalSample:this.signalSample,stopBar:this.stopBar};
  }
  async detectPaint(time,source,{phase,half}){
    const generation=this.generation;
    this.paintBusy=true;this.paintTime=time;
    const failed=()=>{
      if(generation!==this.generation)return;
      this.paintFailed=true;this.paintBusy=false;this.stopBar=null;
      this.paintWorker?.terminate();this.paintWorker=null;
    };
    try{
      const worker=this.paintWorker??=new Worker(new URL('stop-bar-worker.js',document.baseURI));
      worker.onerror=failed;
      worker.onmessage=({data:ends})=>{
        if(generation!==this.generation)return;
        this.paintBusy=false;
        if(ends)this.stopBar={time,ends};
        this.owner.setTime(this.owner.time);
      };
      const bitmap=await createImageBitmap(source.pairs[phase],half*640,0,640,480);
      if(generation===this.generation)worker.postMessage(bitmap,[bitmap]);
      else bitmap.close();
    }catch{failed();}
  }
  async detectRoadUsers(time,source,{phase,half}){
    this.objectBusy=true;
    const generation=this.generation,frames=[];
    const failed=()=>{
      if(generation!==this.generation)return;
      this.objectWorker?.terminate();this.objectWorker=null;this.objectFailed=true;this.objectBusy=false;
      this.roadUsers=null;this.objectPreviews.replaceChildren();this.updateStatus();
    };
    try{
      const worker=this.objectWorker??=new Worker(new URL('camera-object-worker.js?v=signal-hold-1',document.baseURI));
      worker.onerror=failed;
      worker.onmessage=({data})=>{
        if(generation!==this.generation){data.results?.forEach(r=>r.preview.close());return;}
        if(data.error){failed();return;}
        if(data.signals){
          this.signalSample={time,segment:source.segment,views:[{view:'front',lights:data.signals}]};
          this.owner.setTime(this.owner.time);
          return;
        }
        this.drawPreviews(this.objectPreviews,data.results);
        this.roadUsers={time,segment:source.segment,views:data.results};this.objectBusy=false;
        this.updateStatus();this.owner.setTime(this.owner.time);
      };
      if(source.front){
        frames.push({view:'front',singleFront:true,bitmap:await createImageBitmap(source.front)});
      }else{
        const sources=[['front',phase,half],['left',1-phase,half],['right',1-phase,1-half]];
        const crops=await Promise.allSettled(sources.map(([,pair,side])=>
          createImageBitmap(source.pairs[pair],side*640,0,640,480)));
        crops.forEach((crop,i)=>{if(crop.status==='fulfilled')frames.push({view:sources[i][0],bitmap:crop.value});});
        if(frames.length!==3)throw Error('Missing camera crop');
      }
      if(generation===this.generation)worker.postMessage({frames,reportSignals:true},frames.map(f=>f.bitmap));
    }catch{failed();}
    finally{for(const f of frames)f.bitmap.close();}
  }
  drawPreviews(container,results){
    container.replaceChildren();
    for(const result of results){
      const fig=document.createElement('figure'),caption=document.createElement('figcaption'),canvas=document.createElement('canvas');
      canvas.width=240;canvas.height=180;canvas.getContext('2d').drawImage(result.preview,0,0,240,180);
      result.preview.close();delete result.preview;
      caption.textContent={front:'Front',left:'Left',right:'Right'}[result.view];
      fig.append(canvas,caption);container.append(fig);
    }
  }
  updateStatus(){
    const labels=[];
    if(this.sample)labels.push('Lane sample '+this.sample.time.toFixed(1)+' s');
    if(this.objectFailed)labels.push('Road-user detection unavailable');
    if(this.roadUsers){
      const total=this.roadUsers.views.reduce((n,v)=>n+v.objects.length,0);
      const front=this.roadUsers.views.find(v=>v.view==='front');
      if(this.stopBar && this.owner.time>=this.stopBar.time && this.owner.time-this.stopBar.time<=1.2)labels.push('Possible stop bar');
      if(front?.lights?.length)labels.push('Traffic light visible');
      labels.push(total+' road-user detections at '+this.roadUsers.time.toFixed(1)+' s');
    }
    this.status.textContent=labels.join(' · ');
  }
  async start(time,source,{phase,half}){
    this.busy=true;
    const generation=this.generation,frames=[];
    try{
      if(!this.worker)this.worker=new Worker(new URL('camera-vision-worker.js',document.baseURI));
      const worker=this.worker;
      worker.onerror=()=>this.fail(generation);
      worker.onmessage=({data})=>{
        if(generation!==this.generation){data.results?.forEach(r=>r.preview.close());return;}
        if(data.error){this.fail(generation);return;}
        this.drawPreviews(this.cameras,data.results);
        this.key.hidden=false;
        this.sample={time,results:data.results};this.busy=false;
        this.updateStatus();
        this.owner.setTime(this.owner.time);
      };
      if(!this.sample)this.status.textContent='Analyzing front and side cameras…';
      for(const [view,pair,side] of [['front',phase,half],['left',1-phase,half],['right',1-phase,1-half]]){
        // Snapshot mutable native video canvases before yielding.
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        canvas.getContext('2d').drawImage(source.pairs[pair],side*640,0,640,480,0,0,640,480);
        frames.push({view,canvas});
      }
      for(const frame of frames){frame.bitmap=await createImageBitmap(frame.canvas);delete frame.canvas;}
      if(generation!==this.generation)return;
      worker.postMessage({frames},frames.map(f=>f.bitmap));
    }catch{this.fail(generation);}
    finally{for(const frame of frames)frame.bitmap?.close();}
  }
  fail(generation){
    if(generation!==this.generation)return;
    this.invalidate();this.failed=true;this.requested=false;this.output.showModal();
    this.status.textContent='Camera analysis is unavailable. Showing KAFAS. Toggle to retry.';
    this.owner.setTime(this.owner.time);
  }
}
