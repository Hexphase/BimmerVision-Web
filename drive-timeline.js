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
    this.telemetry = new Map();
    this.speedUnit = 'mph';
    this.viewport=root.querySelector('.timeline-viewport');
    const labels = ['Speed', 'Accelerator', 'Brake'];
    this.plots = labels.map((label, i) => {
      const row = document.createElement('div');
      row.className = 'telemetry-lane';
      row.innerHTML = '<div><span></span><strong></strong></div><svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke"/></svg>';
      row.querySelector('span').textContent = label;
      this.root.append(row);
      return {value:row.querySelector('strong'), path:row.querySelector('path')};
    });
    this.viewport.addEventListener('pointerdown',e=>{
      if(e.button!==0||!this.drive||this.drag)return;
      this.drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,time:this.time,last:this.time,direction:1};
      this.viewport.setPointerCapture(e.pointerId);this.viewport.focus({preventScroll:true});
    });
    this.viewport.addEventListener('pointermove',e=>{
      if(this.drag?.pointer!==e.pointerId)return;
      if(!this.scrubbing){
        const dx=Math.abs(e.clientX-this.drag.x),dy=Math.abs(e.clientY-this.drag.y);
        if(dx<5 || dx<=dy)return;
        this.drag.time=this.time;
        this.scrubbing=true;
        this.onDragStart?.();
      }
      const t=Math.max(0,Math.min(DriveTimeline.duration(this.drive),DriveTimeline.timeAfterDrag(this.drag.time,e.clientX-this.drag.x)));
      this.drag.direction=t>=this.drag.last?1:-1;this.drag.last=t;this.time=t;this.draw();
      const target=DriveTimeline.targetAt(this.drive,t,this.drag.direction);
      if(target&&!target.gap)this.onSeek(target.segment,target.offset,{preview:true});
    });
    const finish=e=>{
      if(this.drag?.pointer!==e.pointerId)return;
      if(!this.scrubbing){this.drag=null;return;}
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
  setDrive(drive){if(this.drive===drive)return;if(this.drive?.id!==drive?.id)this.telemetry.clear();this.drive=drive;this.time=0;this.feedback('');this.draw();}
  update(clipId,seconds){this.clipId=clipId;if(this.scrubbing)return;const s=this.drive?.segments.find(s=>s.clip.id===clipId);this.time=s?s.offset+seconds:0;this.draw();}
  setTelemetry(id, records, startUs, unit) {
    this.speedUnit = unit;
    if (records?.length && Number.isFinite(startUs)) this.telemetry.set(id, {records, startUs});
  }
  drawTelemetry(start, end) {
    const paths = ['', '', ''], current = ['—', '—', '—'];
    const previous = [null, null, null];
    for (const segment of this.drive?.segments || []) {
      previous.fill(null);
      const source = this.telemetry.get(segment.clip.id);
      const finish = segment.offset + segment.clip.durationSeconds;
      if (!source || end < segment.offset || start >= finish) continue;
      const {records, startUs} = source;
      const timeOf = rec => segment.offset + (rec.atUs - startUs) / 1e6;
      let low = 0, high = records.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (timeOf(records[mid]) < start) low = mid + 1;
        else high = mid;
      }
      for (let i = Math.max(0, low - 1); i < records.length; i++) {
        const t = timeOf(records[i]);
        if (t > end || t >= finish) break;
        // Break the trace when samples stop arriving.
        const until = Math.min(t + 2, finish, records[i+1] ? timeOf(records[i+1]) : Infinity);
        const a = Math.max(start, segment.offset, t), b = Math.min(end, until);
        if (b <= a) continue;
        const fields = records[i].fields || {};
        const speed = fields.speed?.value, pedal = (fields.accelerator ?? fields.gas)?.value;
        const brake = fields.brake?.value;
        const pressed = typeof brake === 'boolean' ? brake : Number.isFinite(brake) ? brake > .05 : null;
        const levels = [Number.isFinite(speed) ? speed / 160 : null,
          typeof pedal === 'boolean' ? Number(pedal) : Number.isFinite(pedal) ? pedal / 100 : null,
          pressed === null ? null : Number(pressed)];
        const x = time => (100 * (time-start)/(end-start)).toFixed(2);
        levels.forEach((level, lane) => {
          if (level === null) return;
          const y = (21 - Math.max(0,Math.min(1,level))*18).toFixed(1);
          paths[lane] += (previous[lane] === a ? 'V'+y : 'M'+x(a)+' '+y)+'H'+x(b);
          previous[lane] = b;
        });
        if (this.time >= a && this.time < until) {
          current[0] = levels[0] === null ? '—' : Math.round(speed / (this.speedUnit === 'mph' ? 1.609344 : 1))+' '+this.speedUnit;
          current[1] = levels[1] === null ? '—' : typeof pedal === 'boolean' ? (pedal ? 'Pressed' : 'Released') : Math.round(100*Math.min(1,Math.max(0,levels[1])))+'%';
          current[2] = pressed === null ? '—' : pressed ? 'Pressed' : 'Released';
        }
      }
    }
    this.plots.forEach((plot, i) => {
      plot.path.setAttribute('d', paths[i]);
      plot.value.textContent = current[i];
    });
  }
  draw(){
    const duration=DriveTimeline.duration(this.drive),width=this.viewport.clientWidth||300,center=width/2;
    const start=this.time-center/5,end=this.time+center/5;
    this.drawTelemetry(start,end);
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
