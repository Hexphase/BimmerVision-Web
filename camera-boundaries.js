// Follow locally supported chains across columns. Widths below are pixels in the 640px camera crop.
function boundaryTraces(image, paintMask, objects, view) {
 const width=640, height=480, stride=8, luminance=new Float32Array(width*height);
 for(let i=0;i<luminance.length;i++) luminance[i]=(image[i*4]*.3+image[i*4+1]*.59+image[i*4+2]*.11);
 function light(x,y){
  const index=y*width+x;
  return (luminance[index-2]+luminance[index]+luminance[index+2])/3;
 }
 function blocked(x,y){
  return objects.some(({bbox:[a,b,w,h]})=>x>=a-3 && x<=a+w+3 && y>=b-3 && y<=b+h+3);
 }
 // For the forward view, a longitudinal boundary should keep a nearly
 // constant lateral offset over short distances on the local road plane.
 function followsRoad(points,kind){
  if(view!=='front')return true;
  const offsets=points.map(p=>.9*(p.x-320)/(p.y-232));
  const sorted=offsets.slice().sort((a,b)=>a-b);
  const quantile=f=>sorted[Math.floor((sorted.length-1)*f)];
  if(kind==='curb' && Math.abs(quantile(.5))<1.8)return false;
  return quantile(.9)-quantile(.1)<(kind==='curb'?.85:.48);
 }
 function paintColor(x,y){
  const i=(y*width+x)*4,r=image[i],g=image[i+1],b=image[i+2];
  // Pale white and saturated yellow paint in the forward camera.
  return (Math.min(r,g,b)>145 && Math.max(r,g,b)-Math.min(r,g,b)<48)
    || (r>145 && g>110 && r-g<77 && g-b>47 && b/g<.63);
 }
 function trace(kind){
  const chains=[], columns=[];
  for(let x=4;x<width-3;x+=stride){
   const col=[];
   for(let y=244;y<471;y+=2){
    if(blocked(x,y))continue;
    let score=0;
    if(kind==='curb'){
     // A raised face has a darker band above the road contact and a second edge at its lip.
     if(y<254 || light(x,y+3)-light(x,y-2)<12)continue;
     for(const band of [5,9,15,23,35,51,67]){
      const face=(light(x,y-2)+light(x,y-Math.ceil(band/2)))/2;
      const base=light(x,y+3)-face,lip=light(x,y-band-3)-face;
      score=Math.max(score,Math.min(base,lip,48)-.35*Math.abs(light(x,y+6)-light(x,y+3)));
     }
     if(score<16)continue;
    }else{
     // Follow bright paint ridges. Later require a connection to a learned marking.
     for(const half of [2,4,7,10]){
      const mid=light(x,y);
      score=Math.max(score,Math.min(mid-light(x,y-half-2),mid-light(x,y+half+2),55));
     }
     if(score<20)continue;
    }
    col.push({x,y,score,seed:paintMask && paintMask[(y*width+x)*4+3]>0});
   }
   columns.push(col);
  }
  for(let pass=0;pass<6;pass++){
   let best=null;
   for(let c=0;c<columns.length;c++)for(const p of columns[c]){
    if(p.used)continue;
    p.total=p.score-10;p.prev=null;p.slope=0;
    for(const q of columns[c-1]||[]){
     const slope=p.y-q.y;
     if(q.used||Math.abs(slope)>12)continue;
     const total=q.total+p.score-10-Math.abs(slope)*.45-(q.prev?Math.abs(slope-q.slope)*2:0);
     if(total>p.total){p.total=total;p.prev=q;p.slope=slope;}
    }
    if(!best||p.total>best.total)best=p;
   }
   if(!best)break;
   const pts=[];
   for(let p=best;p;p=p.prev)pts.unshift(p);
   for(const p of pts)for(const q of columns[(p.x-4)/stride])if(Math.abs(q.y-p.y)<12)q.used=true;
   if(!followsRoad(pts,kind))continue;
   const seeds=pts.filter(p=>p.seed).length;
   if(kind==='paint' && (seeds<4 || pts.length-seeds<3))continue;
   if(pts.length<(kind==='curb'?19:9))continue;
   if(kind==='curb' && pts.reduce((sum,p,i)=>i<2?sum:sum+Math.abs(p.y-2*pts[i-1].y+pts[i-2].y),0)/pts.length>2.4)continue;
   if(kind==='curb' && pts.filter(p=>p.seed).length>pts.length*.15)continue;
   if(kind==='paint'){
    if(Math.max(...pts.map(p=>p.y))<270)continue;
    let extension=[];
    function addExtension(){
     if(extension.length<3)return;
     if(view==='front' && extension.filter(([x,y])=>paintColor(x,y)).length<extension.length*.5)return;
     chains.push(extension);
    }
    for(const p of pts){
     if(!p.seed){extension.push([p.x,p.y]);continue;}
     addExtension();
     extension=[];
    }
    addExtension();
   }else{
    chains.push(pts.map(p=>[p.x,p.y]));
   }
   if(kind==='curb')break;
  }
  return chains;
 }
 return {curb:trace('curb'),paint:paintMask?trace('paint'):[]};
}
