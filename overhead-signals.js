// Look for repeated horizontal signal housings joined by a thinner mast arm.
// A single dark rectangle (sign, branch or cable) is insufficient evidence.
function overheadSignalCandidates(image) {
  const {width, height, data} = image;
  const skyBottom = Math.floor(height * .48);
  const luma = new Uint8Array(width * skyBottom);
  for (let i = 0; i < luma.length; i++)
    luma[i] = (data[4*i] + 2*data[4*i+1] + data[4*i+2]) / 4;

  const matches = [];
  for (const slope of [-.5,-.4375,-.375,-.3125,-.25,-.125,0,.125,.25,.3125,.375,.4375,.5]) {
    const offset = Int16Array.from({length:width}, (_,x) => Math.round(x*slope));
    // Sample along each sloped scanline. Each housing must be dark across its
    // thickness, with bright sky immediately above and below it.
    for (let intercept = 22-Math.max(0,offset[width-1]); intercept < skyBottom-Math.min(0,offset[width-1]); intercept++) {
      let start = -1, lastHit = -1, prior = null;
      for (let x = 0; x <= width; x++) {
        const y = intercept+offset[x], i = y*width+x;
        const sky = Math.min(luma[i-8*width],luma[i+8*width]);
        const core = Math.max(luma[i],luma[i-width],luma[i+width]);
        if (x<width && y>=14 && y<skyBottom-10 && sky>=138 && sky-core>=30) {
          if (start<0) start=x;
          lastHit=x;
          continue;
        }
        if (start<0 || (x<width && x-lastHit<=2)) continue;
        const end=lastHit, span=end-start+1, center=(start+end)>>1;
        if (span>=9 && span<=36) {
          const current={start,end,span,center,y:intercept+offset[center]};
          if (prior) {
            const gap=start-prior.end-1;
            if (gap>=6 && gap<=3.5*span && Math.min(span,prior.span)>=.58*Math.max(span,prior.span)) {
              let arm=0;
              for (let u=prior.end+1;u<start;u++) {
                const j=(intercept+offset[u])*width+u;
                const sky=Math.min(luma[j-6*width],luma[j+6*width]);
                const dark=Math.min(luma[j-5*width],luma[j-4*width],luma[j-3*width],luma[j-2*width],luma[j-width],luma[j],luma[j+width]);
                if(sky-dark>22 && sky>135)arm++;
              }
              if (arm/gap>=.58) matches.push({pair:[prior,current],slope,score:arm/gap*Math.min(span,prior.span)});
            }
          }
          prior=current;
        }
        start=-1;
      }
    }
  }
  const lights=[];
  for(const match of matches.sort((a,b)=>b.score-a.score)) {
    for(const head of match.pair){
      if(lights.some(({bbox:[x,y,w,h]})=>Math.abs(x+w/2-head.center)<head.span*.7 && Math.abs(y+h/2-head.y)<9))continue;
      const h=7+Math.ceil(Math.abs(match.slope)*head.span);
      lights.push({slope:match.slope,bbox:[head.start,head.y-h/2,head.span,h]});
    }
  }
  return lights;
}
if(typeof module!=='undefined')module.exports={overheadSignalCandidates};
