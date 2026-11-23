const test=require('node:test'),assert=require('node:assert/strict');
const history=import('../driving-history.mjs');
function frames(count){
  return Array.from({length:count},(_,i)=>({
    t:i/10,v:10/.44704,steering:0,lead:3,o:[[3,25+i*.2,0,3,0,0,90,0]],
    b:[[0,0,1.7,0,0,0,40,2,1,1],[1,0,-1.7,0,0,0,40,2,2,1]]
  }));
}
test('lead speed adds gap rate to ego speed and starts over for a different target',async()=>{
  const rows=frames(40);
  rows[39].lead=2;rows[39].o[0][0]=2;
  const h=(await history).createDrivingHistory(rows);
  assert.ok(Math.abs(h.at(38).leadSpeed*.44704-12)<.01);
  assert.equal(h.at(39).leadSpeed,null);
  for(const f of rows){f.v=0;f.o[0][1]=8;}
  assert.equal((await history).createDrivingHistory(rows).at(38).leadSpeed,0);
});
test('recorded road remains under the car throughout a stop and resets after a data gap',async()=>{
  const rows=frames(100);
  for(const f of rows.slice(41))f.v=0;
  rows[99].t+=2;
  const h=(await history).createDrivingHistory(rows),early=h.at(50).segments;
  assert.ok(early.some(s=>s.a.x< -10));
  assert.ok(early.every(s=>s.b.x<=.1));
  assert.deepEqual(h.at(95).segments,early);
  assert.deepEqual(h.at(99).segments,[]);
});
