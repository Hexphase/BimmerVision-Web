// Ego coordinates are metres forward and left. Camera distances are estimates
// from the bottom of the box and have greater uncertainty along the viewing ray.
function kind(label){
  if(label==='person'||label===0)return 'person';
  if(['bicycle','motorcycle',1,2].includes(label))return 'bike';
  return 'vehicle';
}
function inCamera(view,p){
  if(view==='left')return {depth:p.y-.9,left:.7-p.x};
  if(view==='right')return {depth:-p.y-.9,left:p.x-.7};
  return {depth:p.x,left:p.y};
}
function association(a,b){
  if(a.kind!==b.kind)return Infinity;
  const car=a.kind==='vehicle',dx=a.x-b.x,dy=a.y-b.y;
  const length=car?3.8:1.1,width=car?1.35:.65;
  const error=o=>Math.min(3.5,.09*(o.depth||0));
  const longitudinal=length+(a.view==='front'?error(a):0)+(b.view==='front'?error(b):0);
  const lateral=width+(a.view!=='front'?error(a):0)+(b.view && b.view!=='front'?error(b):0);
  return Math.hypot(dx/longitudinal,dy/lateral);
}
function anchorCost(o,track){
  if(o.kind!==track.kind)return Infinity;
  const {depth,left}=inCamera(o.view,track);
  if(depth<.5)return Infinity;
  const u=320-365*left/depth,v=232+328.5/depth;
  const [x,y,w,h]=o.box;
  // Match in image space too: two bumper observations can disagree by several
  // metres on the ground plane while enclosing the same recorded track.
  const imageCost=Math.hypot((u-x-w/2)/(w*.65+7),(v-y-h*.86)/(h*.55+4));
  return Math.min(association(o,track),imageCost);
}
function match(left,right,cost,accept){
  const candidates=[];
  for(const a of left)for(const b of right){
    const distance=cost(a,b);
    if(distance<=1)candidates.push({a,b,distance});
  }
  const usedA=new Set(),usedB=new Set();
  for(const {a,b} of candidates.sort((a,b)=>a.distance-b.distance)){
    if(usedA.has(a)||usedB.has(b))continue;
    accept(a,b);usedA.add(a);usedB.add(b);
  }
}

export function createRoadUserFusion(){
  let previous=[],lastSample=null,nextId=1;
  return function fuse(sample,rows,project){
    if(!sample){previous=[];lastSample=null;return [];}
    if(sample===lastSample)return previous;
    const elapsed=sample.time-(lastSample?.time??Infinity);
    if(elapsed<=0||elapsed>1.5)previous=[];
    lastSample=sample;
    const anchors=rows.filter(o=>o[1]<=150&&(o[6]==null||o[6]>=30))
      .map(o=>({x:o[1],y:o[2],kind:kind(o[3]),key:o[0]+':'+o[3]}));
    const groups=anchors.map(anchor=>({...anchor,anchor,observations:[]}));
    const pending=[];
    for(const {view,objects} of sample.views){
      const observations=[];
      for(const object of objects){
        const [u,v,w,h]=object.bbox;
        const p=project(view,Math.max(0,Math.min(639,u+w/2)),Math.max(0,Math.min(479,v+h)),view==='front'?45:16);
        if(!p)continue;
        observations.push({...p,depth:inCamera(view,p).depth,kind:kind(object.class),view,box:object.bbox,score:object.score});
      }
      const assigned=new Set();
      match(observations,groups,(o,g)=>anchorCost(o,g.anchor),(o,g)=>{
        g.observations.push(o);assigned.add(o);
      });
      pending.push(observations.filter(o=>!assigned.has(o)));
    }
    for(const observations of pending){
      const assigned=new Set();
      match(observations,groups,(o,g)=>{
        if(!g.observations.length || g.observations.some(other=>other.view===o.view))return Infinity;
        // Every existing observation must agree, preventing a chain of loose
        // matches from joining two vehicles on opposite sides of the car.
        return Math.max(...g.observations.map(other=>association(o,other)));
      },(o,g)=>{g.observations.push(o);assigned.add(o);});
      for(const o of observations)if(!assigned.has(o))groups.push({...o,observations:[o]});
    }
    const cameraOnly=groups.filter(g=>!g.anchor);
    for(const g of cameraOnly){
      const weight=g.observations.reduce((s,o)=>s+o.score,0);
      for(const axis of ['x','y'])g[axis]=g.observations.reduce((s,o)=>s+o[axis]*o.score,0)/weight;
      g.hits=1;g.confirmed=g.observations.length>=2;
    }
    match(cameraOnly,previous,(a,b)=>a.kind!==b.kind?Infinity:
      Math.hypot((a.x-b.x)/(1.3+elapsed*7),(a.y-b.y)/(.65+elapsed*1.5)),
      (g,old)=>{g.id=old.id;g.hits=old.hits+1;g.confirmed||=g.hits>=2;});
    for(const g of cameraOnly)g.id??=nextId++;
    previous=cameraOnly;
    return previous;
  };
}
