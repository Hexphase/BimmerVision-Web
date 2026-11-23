// Runs only while Camera Enhanced View is enabled. All inputs stay in the browser.
importScripts('vendor/camera-vision/ort.wasm.min.js', 'camera-boundaries.js');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('vendor/camera-vision/', self.location.href).href;
const session = ort.InferenceSession.create('vendor/camera-vision/yolop.onnx', {executionProviders:['wasm']});
const plane = 640 * 640;
const means = [.485,.456,.406], deviations = [.229,.224,.225];

function vehicles(predictions) {
  const boxes = [];
  for (let i=0; i<predictions.length; i+=6) {
    const score=predictions[i+4]*predictions[i+5];
    if(score<.55) continue;
    const [cx,cy,w,h]=predictions.subarray(i,i+4);
    const bottom=cy+h/2-80;
    if(bottom<0 || bottom>480 || w<8 || h<8) continue;
    boxes.push({bbox:[cx-w/2,bottom-h,w,h],score});
  }
  const kept=[];
  for(const box of boxes.sort((a,b)=>b.score-a.score)){
    const [x,y,w,h]=box.bbox;
    const duplicate=kept.some(({bbox:[a,b,c,d]})=>{
      const intersection=Math.max(0,Math.min(x+w,a+c)-Math.max(x,a))*Math.max(0,Math.min(y+h,b+d)-Math.max(y,b));
      return intersection/(w*h+c*d-intersection)>.4;
    });
    if(!duplicate)kept.push(box);
    if(kept.length===24)break;
  }
  return kept;
}

async function analyze(model, view, bitmap){
  const canvas=new OffscreenCanvas(640,480), ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bitmap,0,0,640,480);
  const pixels=ctx.getImageData(0,0,640,480), tensor=new Float32Array(3*plane);
  for(let c=0;c<3;c++){
    const offset=c*plane;
    tensor.fill((114/255-means[c])/deviations[c],offset,offset+plane);
    for(let i=0;i<640*480;i++)tensor[offset+80*640+i]=(pixels.data[i*4+c]/255-means[c])/deviations[c];
  }
  const input=new ort.Tensor('float32',tensor,[1,3,640,640]);
  const {lane_line_seg:lanes,det_out:objects}=await model.run({[model.inputNames[0]]:input},['lane_line_seg','det_out']);
  const mask=new Uint8ClampedArray(640*480*4);
  for(let i=0;i<640*480;i++){
    const p=i+80*640;
    if(lanes.data[p+plane]>lanes.data[p])mask.set([109,226,255,170],i*4);
  }
  const boxes=vehicles(objects.data);
  input.dispose();lanes.dispose();objects.dispose();
  const traces=boundaryTraces(pixels.data,mask,boxes,view);
  // Preserve model-supported paint as well as extensions.
  const markings=[];
  // Trace across the image on side cameras and down the image on the front.
  // Only neighboring slices can extend a marking.
  let active=[];
  const isFront=view==='front',limit=isFront?470:640;
  for(let slice=isFront?250:0;slice<limit;slice+=5){
    const next=[];
    let start=-1;
    for(let axis=isFront?0:250;axis<=(isFront?640:470);axis++){
      const x=isFront?axis:slice,y=isFront?slice:axis;
      if(x<640 && y<470 && mask[(y*640+x)*4+3]){
        if(start<0)start=axis;
        continue;
      }
      if(start<0)continue;
      const mid=(axis+start-1)/2,width=axis-start;start=-1;
      if(width<2 || width>60)continue;
      let match=-1,nearest=15;
      for(let i=0;i<active.length;i++){
        const distance=Math.abs(active[i].at(-1)[isFront?0:1]-mid);
        if(distance<nearest){nearest=distance;match=i;}
      }
      const chain=match<0?[]:active.splice(match,1)[0];
      chain.push(isFront?[mid,slice]:[slice,mid]);next.push(chain);
    }
    markings.push(...active.filter(chain=>chain.length>=4));active=next;
  }
  markings.push(...active.filter(chain=>chain.length>=4));
  for(let i=0;i<pixels.data.length;i+=4)if(mask[i+3]){
    for(let c=0;c<3;c++)pixels.data[i+c]=(pixels.data[i+c]+mask[i+c]*2)/3;
  }
  ctx.putImageData(pixels,0,0);
  for(const [kind,chains] of Object.entries(traces)){
    ctx.strokeStyle=kind==='curb'?'#ff91bd':'#f7eb80';ctx.lineWidth=3;
    for(const chain of chains){ctx.beginPath();chain.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
  }
  ctx.strokeStyle='#ffbd68';
  for(const {bbox} of boxes)ctx.strokeRect(...bbox);
  return {view,traces,markings,boxes:boxes.map(b=>b.bbox),preview:canvas.transferToImageBitmap()};
}

self.onmessage=async ({data})=>{
  const results=[];
  try{
    const model=await session;
    for(const {view,bitmap} of data.frames)results.push(await analyze(model,view,bitmap));
    self.postMessage({results},results.map(r=>r.preview));
  }catch(error){self.postMessage({error:String(error.message||error)});}
  finally{for(const f of data.frames)f.bitmap.close();}
};
