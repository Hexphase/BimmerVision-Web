function neighboringRecordings(drive,clipId) {
  const segments=drive?.segments||[],index=segments.findIndex(s=>s.clip.id===clipId);
  return {previous:index>0?segments[index-1].clip:null,next:index>=0?segments[index+1]?.clip||null:null};
}
class BVRecordingNavigation {
  constructor({previous,next,getContext,openClip}) {
    Object.assign(this,{previous,next,getContext,openClip});this.busy=false;
    previous.addEventListener('click',()=>this.go(-1));next.addEventListener('click',()=>this.go(1));this.update();
  }
  update(busy=this.busy) {
    this.busy=busy;const {drive,clipId}=this.getContext(),neighbors=neighboringRecordings(drive,clipId);
    this.previous.disabled=busy||!neighbors.previous;this.next.disabled=busy||!neighbors.next;
  }
  go(direction) {
    if(this.busy)return;const {drive,clipId}=this.getContext(),neighbors=neighboringRecordings(drive,clipId),clip=direction<0?neighbors.previous:neighbors.next;
    if(clip)this.openClip(clip);
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports={neighboringRecordings,BVRecordingNavigation};
