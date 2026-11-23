// Analyze road users independently so a nearby person or car need not wait for lane processing.
importScripts('overhead-signals.js','vendor/camera-objects/tf.min.js','vendor/camera-objects/tf-backend-wasm.min.js','vendor/camera-objects/coco-ssd.min.js');
const assets=new URL('vendor/camera-objects/',self.location.href);
tf.wasm.setThreadsCount(1);
tf.wasm.setWasmPaths(assets.href);
const model=(async()=>{
  await tf.setBackend('wasm');
  return cocoSsd.load({base:'lite_mobilenet_v2',modelUrl:new URL('model.json',assets).href});
})();
const labels=new Set(['person','car','truck','bus','motorcycle','bicycle']);
function overlaps(a,b){
  const [x,y,w,h]=a.bbox,[u,v,r,s]=b.bbox;
  const overlap=Math.max(0,Math.min(x+w,u+r)-Math.max(x,u))*Math.max(0,Math.min(y+h,v+s)-Math.max(y,v));
  return overlap>Math.min(w*h,r*s)*.60;
}
async function detect(detector,ctx,view){
  const candidates=[],lights=[];
  // Side views can contain just the nose or tail of a nearby car at either edge.
  const regions=view==='front'?[[0,640]]:[[0,640],[0,320],[320,320]];
  for(const [offset,width] of regions){
    const tensor=tf.browser.fromPixels(ctx.getImageData(offset,0,width,480));
    try{
      for(const object of await detector.detect(tensor,30,.40)){
        if(view==='front' && object.class==='traffic light' && object.score>=.45){
          lights.push(object);
          continue;
        }
        if(!labels.has(object.class) || (object.class==='person' && object.score<.60))continue;
        const [x,y,w,h]=object.bbox;
        if(width<640 && (offset===0?x>45:x+w<width-45))continue;
        candidates.push({...object,bbox:[x+offset,y,w,h]});
      }
    }finally{tensor.dispose();}
  }
  const kept=[];
  for(const object of candidates.sort((a,b)=>b.score-a.score)){
    if(!kept.some(o=>(o.class==='person')===(object.class==='person') && overlaps(o,object)))kept.push(object);
  }
  return {objects:kept,lights};
}
async function signalHeads(detector,ctx){
  // Crop the approach, including the sky above the intersection: resizing the
  // whole camera image can reduce a suspended signal head to just a few pixels.
  const lights=[];
  for(const [x,y,w,h] of [[0,0,350,265],[290,0,350,265]]){
    const input=tf.browser.fromPixels(ctx.getImageData(x,y,w,h));
    try{
      for(const o of await detector.detect(input,30,.38)){
        if(o.class!=='traffic light')continue;
        const [u,v,bw,bh]=o.bbox;
        if(bw<4||bh<5)continue;
        const light={...o,bbox:[u+x,v+y,bw,bh]};
        if(!lights.some(other=>overlaps(light,other)))lights.push(light);
      }
    }finally{input.dispose();}
  }
  return lights;
}
// Recheck plausible mast-mounted heads upright at several context scales.
// Geometry proposes a crop. Only matching model predictions enter the preview.
async function mastSignals(detector,ctx,lights){
  const image=ctx.getImageData(0,0,640,480);
  const candidates=overheadSignalCandidates(image);
  for(const candidate of candidates.slice(0,6)){
    if(lights.some(light=>overlaps(light,candidate)))continue;
    const [x,y,w,h]=candidate.bbox, cx=x+w/2,cy=y+h/2;
    // Tiny lamps lose shape on resize. A compact cluster of warm pixels
    // inside a dark housing provides additional evidence for a model match.
    let warm=0,peak=0,lampX=cx,lampY=cy;
    for(let v=Math.ceil(y);v<y+h;v++)for(let u=x;u<x+w;u++){
      const i=(v*image.width+u)*4,[r,g,b]=image.data.subarray(i,i+3);
      const contrast=r-Math.max(g,b);
      if(r>=115 && contrast>=35){
        warm++;
        if(contrast>peak){peak=contrast;lampX=u;lampY=v;}
      }
    }
    const lamp=warm>=2 && warm<=w*h*.27;
    const increment=Math.PI/8;
    const angle=Math.round((Math.PI/2-Math.atan(candidate.slope))/increment)*increment;
    let votes=0;
    const sizes=new Set([4,5,13].map(scale=>Math.max(48,Math.min(256,Math.round(w*scale/16)*16))));
    scales: for(const size of sizes){
      for(const orientation of [angle,angle-Math.PI]){
        const crop=new OffscreenCanvas(size,size),context=crop.getContext('2d',{willReadFrequently:true});
        context.translate(size/2,size/2);
        context.rotate(orientation);
        const centerOnLamp=lamp && orientation===angle;
        context.drawImage(ctx.canvas,centerOnLamp?-lampX:-cx,centerOnLamp?-lampY:-cy);
        const input=tf.browser.fromPixels(context.getImageData(0,0,size,size));
        try{
          const predictions=await detector.detect(input,20,lamp ? .19 : .25);
          const hit=predictions.find(({class:label,bbox:[u,v,bw,bh]})=>
            label==='traffic light' && bw>=3 && bh>=5 &&
            Math.hypot(u+bw/2-size/2,v+bh/2-size/2)<=w*.7);
          if(!hit)continue;
          if(++votes>=2 || hit.score>=(lamp ? .28 : .38)){
            lights.push({...hit,bbox:candidate.bbox});
            break scales;
          }
          break;
        }finally{input.dispose();}
      }
    }
  }
}
// Preserve native resolution for small, sometimes horizontally mounted heads.
async function singleFrontSignals(detector,bitmap){
  const width=bitmap.width,height=bitmap.height,lights=[];
  for(const rotated of [false,true]){
    const size=Math.min(width,Math.round(height*(rotated ? .20 : 8/15)));
    const step=Math.floor(size*.70),top=Math.floor(height*.25);
    const tile=new OffscreenCanvas(size,size),ctx=tile.getContext('2d',{willReadFrequently:true});
    if(rotated){ctx.translate(size,0);ctx.rotate(Math.PI/2);}
    for(let start=0;start<width;start+=step){
      const x=Math.min(start,width-size);
      ctx.drawImage(bitmap,x,top,size,size,0,0,size,size);
      const input=tf.browser.fromPixels(ctx.getImageData(0,0,size,size));
      try{
        for(const item of await detector.detect(input,20,rotated ? .32 : .38)){
          if(item.class!=='traffic light')continue;
          const [u,v,w,h]=item.bbox;
          const box=rotated?[x+v,top+size-u-w,h,w]:[x+u,top+v,w,h];
          const light={...item,bbox:box.map((n,i)=>n*(i%2?480/height:640/width))};
          if(!lights.some(other=>overlaps(other,light)))lights.push(light);
        }
      }finally{input.dispose();}
      if(x===width-size)break;
    }
  }
  return lights;
}
self.onmessage=async({data})=>{
  const results=[];
  try{
    const detector=await model;
    for(const {view,bitmap,singleFront} of data.frames){
      const canvas=new OffscreenCanvas(640,480),ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(bitmap,0,0,640,480);
      const {objects,lights}=singleFront
        ? {objects:[],lights:await singleFrontSignals(detector,bitmap)}
        : await detect(detector,ctx,view);
      if(view==='front' && !lights.length)lights.push(...await signalHeads(detector,ctx));
      if(view==='front' && !singleFront)await mastSignals(detector,ctx,lights);
      if(view==='front' && data.reportSignals)self.postMessage({signals:lights});
      ctx.lineWidth=3;ctx.font='bold 16px system-ui';
      for(const {class:label,bbox} of [...objects,...lights]){
        const color=label==='person'?'#8be8d1':'#ffbd68';
        const [x,y]=bbox,top=Math.max(18,y);
        ctx.strokeStyle=color;ctx.strokeRect(...bbox);ctx.fillStyle='#17191c';
        ctx.fillRect(x,top-18,ctx.measureText(label).width+6,18);
        ctx.fillStyle=color;ctx.fillText(label,x+3,top-4);
      }
      results.push({view,objects,lights,preview:canvas.transferToImageBitmap()});
    }
    self.postMessage({results},results.map(r=>r.preview));
  }catch(e){self.postMessage({error:e.message});}
  finally{for(const f of data.frames)f.bitmap.close();for(const r of results)r.preview.close();}
};
