/* A fixed time scale: drag recordings beneath the stationary playhead. */
class DriveTimeline {
  static duration(drive) {
    return Math.max(0, ...(drive?.segments || []).map(s => s.offset + (s.clip.durationSeconds || 0)));
  }
  static segmentAt(drive, time) {
    return (drive?.segments || []).find(s => time >= s.offset && time < s.offset + (s.clip.durationSeconds || 0)) || null;
  }
  static timeAfterDrag(time, pixels) { return time - pixels / 5; }
  static targetAt(drive, seconds, direction = 1) {
    const segments=(drive?.segments || []).filter(s=>s.clip.durationSeconds>0);
    if(!segments.length)return null;
    const time=Math.max(0,Math.min(DriveTimeline.duration(drive),seconds));
    let segment=DriveTimeline.segmentAt(drive,time);
    const gap=!segment && time!==DriveTimeline.duration(drive);
    if(!segment)segment=direction>=0 ? segments.find(s=>s.offset>=time)||segments[segments.length-1] : [...segments].reverse().find(s=>s.offset+s.clip.durationSeconds<=time)||segments[0];
    return {segment,offset:Math.max(0,Math.min(segment.clip.durationSeconds-0.01,time-segment.offset)),gap};
  }
  static format(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  constructor(root, onSeek) {
    this.root=root;this.onSeek=onSeek;this.drive=null;this.time=0;this.clipId=null;
    root.innerHTML='<div class="timeline-heading"><span>DRIVE TIMELINE</span><span class="timeline-position">Choose a drive</span></div><div class="timeline-viewport" tabindex="0" role="slider" aria-label="Drag timeline to scrub recordings" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div class="timeline-ruler"></div><div class="drive-timeline-track"></div><div class="timeline-playhead" aria-hidden="true"></div></div><p class="timeline-feedback" aria-live="polite"></p>';
    this.viewport=root.querySelector('.timeline-viewport');
    this.viewport.addEventListener('pointerdown',e=>{
      if(e.button!==0||!this.drive)return;
      this.scrubbing=true;this.drag={x:e.clientX,time:this.time,last:this.time,direction:1};
      this.viewport.setPointerCapture(e.pointerId);this.viewport.focus();this.onDragStart?.();
    });
    this.viewport.addEventListener('pointermove',e=>{
      if(!this.scrubbing)return;
      const t=Math.max(0,Math.min(DriveTimeline.duration(this.drive),DriveTimeline.timeAfterDrag(this.drag.time,e.clientX-this.drag.x)));
      this.drag.direction=t>=this.drag.last?1:-1;this.drag.last=t;this.time=t;this.draw();
      const target=DriveTimeline.targetAt(this.drive,t,this.drag.direction);
      if(target&&!target.gap)this.onSeek(target.segment,target.offset,{preview:true});
    });
    const finish=e=>{
      if(!this.scrubbing)return;
      const target=DriveTimeline.targetAt(this.drive,this.time,this.drag.direction);
      this.scrubbing=false;this.drag=null;
      if(this.viewport.hasPointerCapture(e.pointerId))this.viewport.releasePointerCapture(e.pointerId);
      if(target){this.time=target.segment.offset+target.offset;this.feedback(target.gap?'No footage in this gap · moved to the nearest recording.':'');this.draw();this.onSeek(target.segment,target.offset,{preview:false});}
      this.onDragEnd?.();
    };
    this.viewport.addEventListener('pointerup',finish);
    this.viewport.addEventListener('pointercancel',finish);
    this.viewport.addEventListener('keydown',e=>{
      let time=this.time;
      if(e.key==='ArrowLeft')time-=e.shiftKey?10:1;
      else if(e.key==='ArrowRight')time+=e.shiftKey?10:1;
      else if(e.key==='Home')time=0;
      else if(e.key==='End')time=DriveTimeline.duration(this.drive);
      else return;
      e.preventDefault();const target=DriveTimeline.targetAt(this.drive,time,time>=this.time?1:-1);
      if(target){this.onDragStart?.();this.time=target.segment.offset+target.offset;this.draw();this.onSeek(target.segment,target.offset,{preview:false});this.onDragEnd?.();}
    });
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>this.draw()).observe(this.viewport);
  }
  feedback(text){this.root.querySelector('.timeline-feedback').textContent=text;}
  setDrive(drive){if(this.drive===drive)return;this.drive=drive;this.time=0;this.feedback('');this.draw();}
  update(clipId,seconds){this.clipId=clipId;if(this.scrubbing)return;const s=this.drive?.segments.find(s=>s.clip.id===clipId);this.time=s?s.offset+seconds:0;this.draw();}
  draw(){
    const duration=DriveTimeline.duration(this.drive),width=this.viewport.clientWidth||300,center=width/2;
    const start=this.time-center/5,end=this.time+center/5;
    const track=this.root.querySelector('.drive-timeline-track');track.replaceChildren();
    (this.drive?.segments||[]).forEach((s,i)=>{
      if(s.offset+s.clip.durationSeconds<start||s.offset>end)return;
      const b=document.createElement('div');b.className='timeline-segment'+(s.clip.id===this.clipId?' current':'');
      b.style.left=`${center+(s.offset-this.time)*5}px`;b.style.width=`${s.clip.durationSeconds*5}px`;
      b.dataset.mColor=String(i%3);
      b.textContent=`${i+1}`;track.appendChild(b);
    });
    const ruler=this.root.querySelector('.timeline-ruler');ruler.replaceChildren();
    for(let t=Math.max(0,Math.ceil(start/10)*10);t<=Math.min(duration,end);t+=10){const tick=document.createElement('span');tick.style.left=`${center+(t-this.time)*5}px`;tick.textContent=DriveTimeline.format(t);ruler.appendChild(tick);}
    const index=this.drive?.segments.findIndex(s=>s.clip.id===this.clipId)??-1;
    this.root.querySelector('.timeline-position').textContent=`${DriveTimeline.format(this.time)} / ${DriveTimeline.format(duration)}${index>=0?` · Clip ${index+1} of ${this.drive.segments.length}`:''}`;
    this.viewport.setAttribute('aria-valuemax',String(duration));this.viewport.setAttribute('aria-valuenow',String(this.time));
    this.viewport.setAttribute('aria-valuetext',`${DriveTimeline.format(this.time)} of ${DriveTimeline.format(duration)}`);
  }
}
if(typeof module!=='undefined')module.exports={DriveTimeline};
