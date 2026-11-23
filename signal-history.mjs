// A detected housing stays at approximately the same camera bearing while
// stopped. Use measured travel to limit how long that bearing can be reused.
export function signalHoldEnd(time, speeds) {
  let low=0, high=speeds.length;
  while(low<high){
    const mid=(low+high)>>>1;
    if(speeds[mid][0]<=time)low=mid+1;else high=mid;
  }
  let index=low-1, end=time, metres=0;
  if(index<0 || time-speeds[index][0]>1)return time+1.4;
  for(;index+1<speeds.length;index++){
    const [start,v]=speeds[index], [next,w]=speeds[index+1];
    if(next-start>1 || v==null || w==null)break;
    const rate=Math.max(Math.abs(v),Math.abs(w))/3.6;
    const distance=(next-end)*rate;
    if(metres+distance>6){end+=(6-metres)/rate;break;}
    metres+=distance;
    end=next;
  }
  return Math.max(time+1.4,end);
}

export function createSignalHistory(speeds=[]) {
  let tracks=[], previous=null, previousTime=-Infinity, segment;
  return function visible(t,detection,enabled){
    if(!enabled || t<previousTime || (detection && detection.segment!==segment)){
      tracks=[];previous=null;
    }
    previousTime=t;
    tracks=tracks.filter(track=>track.end>=t);
    if(!enabled)return [];
    if(detection && detection!==previous && t>=detection.time){
      previous=detection;segment=detection.segment;
      const observations=detection.views.find(v=>v.view==='front')?.lights??[];
      if(observations.length){
        const end=signalHoldEnd(detection.time,speeds);
        const matched=new Set();
        for(const light of observations){
          if(end<t)continue;
          const [x,y,w,h]=light.bbox, cx=x+w/2,cy=y+h/2;
          let nearest=null,best=Infinity;
          for(const track of tracks){
            const distance=Math.hypot(cx-track.cx,cy-track.cy);
            if(!matched.has(track) && distance<Math.max(12,w*1.25) && distance<best){
              nearest=track;best=distance;
            }
          }
          const track=nearest??{};
          if(!nearest)tracks.push(track);
          Object.assign(track,{light,cx,cy,end});
          matched.add(track);
        }
      }
    }
    return tracks.map(track=>track.light);
  };
}
