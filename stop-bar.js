// Search the forward road surface for a bounded stripe that crosses the ego lane.
// The expected pixel span and thickness grow as paint approaches the camera.
function findStopBar(rgba,width=640,height=480){
  const brightness=new Uint8Array(width*height),white=new Uint8Array(width*height);
  for(let y=245;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2];
    brightness[i]=(r+2*g+b)/4;
    white[i]=Math.min(r,g,b)>122 && Math.max(r,g,b)-Math.min(r,g,b)<69;
  }
  const candidates=[];
  for(let cy=268;cy<432;cy+=1){
    const scale=(cy-232)/.9;
    const radius=Math.min(220,Math.round(1.35*scale));
    const step=Math.max(2,Math.floor(radius/24));
    const margin=Math.max(3,Math.round(.45*(cy-232)**2/328.5));
    let best=null;
    for(const slope of [-.12,-.08,-.04,0,.04,.08,.12]){
      let brightPaint=0,hits=0,n=0,left=0,right=0,contrast=0,gap=0,longestGap=0;
      for(let dx=-radius;dx<=radius;dx+=step){
        const x=320+dx,y=Math.round(cy+slope*dx),i=y*width+x;
        const strength=Math.min(brightness[i]-brightness[i-margin*width],brightness[i]-brightness[i+margin*width]);
        n++;
        if(white[i] && strength>22){
          const value=i*4;
          const min=Math.min(rgba[value],rgba[value+1],rgba[value+2]);
          const max=Math.max(rgba[value],rgba[value+1],rgba[value+2]);
          // A sunlit gap between shadows often matches the pavement a little farther away.
          const outer=3*margin*width;
          const surrounding=Math.max(brightness[i-outer]??255,brightness[i+outer]??255);
          if(min>=155 && min>=max*.76 && strength>=27 && brightness[i]>surrounding+12)brightPaint++;
          if(!hits)left=x;
          right=x;hits++;contrast+=Math.min(strength,90);gap=0;
        }else longestGap=Math.max(longestGap,++gap);
      }
      if(brightPaint<n*.35 || hits<n*.78 || longestGap>n*.19 || right-left<radius*1.65)continue;
      const score=contrast/n;
      if(!best||score>best.score)best={cy,score,margin,ends:[left,right].map(x=>[x,Math.round(cy+slope*(x-320))])};
    }
    if(best)candidates.push(best);
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  if(!best)return null;
  // Parallel transverse stripes can be a crosswalk. Withhold an ambiguous bar.
  if(candidates.some(c=>Math.abs(c.cy-best.cy)>2*Math.max(c.margin,best.margin) && c.score>best.score*.68))return null;
  return best.ends;
}
if(typeof module!=='undefined')module.exports={findStopBar};
