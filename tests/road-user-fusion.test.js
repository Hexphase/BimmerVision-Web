const test=require('node:test'),assert=require('node:assert/strict');
const model=import('../road-user-fusion.mjs');
const box=(x,y,label='car')=>({class:label,score:.8,bbox:[x-1,y-2,2,2]});
const view=(view,...objects)=>({view,objects});
const project=(_,x,y)=>({x,y});
test('front and side views produce one vehicle, with KAFAS taking ownership when present',async()=>{
  const fuse=(await model).createRoadUserFusion();
  const sample={time:1,views:[view('left',box(9,4)),view('front',box(11,4))]};
  const confirmed=fuse(sample,[],project).filter(o=>o.confirmed);
  assert.equal(confirmed.length,1);assert.equal(confirmed[0].observations.length,2);
  assert.equal(fuse({...sample,time:1.3},[[12,10,4,3]],project).length,0);
});
test('separate cars in one camera cannot consume the same track',async()=>{
  const fuse=(await model).createRoadUserFusion();
  const views=[view('front',box(8,2),box(8,5)),view('left',box(8,5))];
  const tracks=fuse({time:1,views},[[3,8,2,3]],project);
  assert.equal(tracks.length,1);assert.equal(tracks[0].confirmed,true);assert.equal(tracks[0].y,5);
});
test('isolated boxes require a second sample and a pedestrian cannot confirm a car',async()=>{
  const fuse=(await model).createRoadUserFusion(),views=[view('front',box(10,4)),view('left',box(10,4,'person'))];
  const sample={time:1,views};assert.ok(fuse(sample,[],project).every(o=>!o.confirmed));
  assert.ok(fuse(sample,[],project).every(o=>!o.confirmed));
  assert.ok(fuse({time:1.5,views},[],project).every(o=>o.confirmed));
  fuse(null,[],project);assert.ok(fuse(sample,[],project).every(o=>!o.confirmed));
});
