const test=require('node:test'),assert=require('node:assert/strict');
const {neighboringRecordings,BVRecordingNavigation}=require('../recording-navigation');
const drive={segments:['a','b','c'].map(id=>({clip:{id}}))};
const button=()=>({disabled:false,addEventListener(event,fn){this.click=()=>{if(!this.disabled)fn();};}});
test('neighboring recordings stay in the current drive and disable both missing endpoints',()=>{
 assert.deepEqual(neighboringRecordings(drive,'a'),{previous:null,next:drive.segments[1].clip});
 assert.deepEqual(neighboringRecordings(drive,'c'),{previous:drive.segments[1].clip,next:null});
 for(const [d,id] of [[null,'a'],[drive,'unknown'],[{segments:[]},'a']])assert.deepEqual(neighboringRecordings(d,id),{previous:null,next:null});
});
test('transport buttons open adjacent recordings, become disabled during loading, and update after refresh',()=>{
 let id='a';const previous=button(),next=button(),opened=[];
 const nav=new BVRecordingNavigation({previous,next,getContext:()=>({drive,clipId:id}),openClip:clip=>{opened.push(clip.id);id=clip.id;nav.update();}});
 assert.equal(previous.disabled,true);assert.equal(next.disabled,false);next.click();assert.deepEqual(opened,['b']);assert.equal(previous.disabled,false);
 nav.update(true);next.click();assert.deepEqual(opened,['b']);assert.equal(next.disabled,true);
 nav.update(false);next.click();assert.deepEqual(opened,['b','c']);assert.equal(next.disabled,true);previous.click();assert.deepEqual(opened,['b','c','b']);
});
