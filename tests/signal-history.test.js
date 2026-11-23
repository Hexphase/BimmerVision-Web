const test=require('node:test');
const assert=require('node:assert/strict');
const light={bbox:[90,80,11,6]};
const sample=(time,lights,segment=1)=>({time,segment,views:[{view:'front',lights}]});

test('retains an observed signal through misses at a stop, then releases it on departure',async()=>{
  const {createSignalHistory}=await import('../signal-history.mjs');
  const speeds=Array.from({length:40},(_,i)=>[i,i<=30?0:18]);
  const at=createSignalHistory(speeds);
  assert.deepEqual(at(2,sample(2,[light]),true),[light]);
  assert.deepEqual(at(25,sample(25,[]),true),[light]);
  assert.deepEqual(at(32,sample(32,[]),true),[]);
});

test('missing speed, a new layout, disabling, and rewinding cannot carry a stale housing',async()=>{
  const {createSignalHistory}=await import('../signal-history.mjs');
  const at=createSignalHistory();
  for(const [time,detection,enabled,count] of [
    [2,sample(2,[light]),true,1],[5,sample(5,[]),true,0],
    [6,sample(6,[light]),true,1],[6.3,sample(6.3,[],2),true,0],
    [7,sample(7,[light]),true,1],[7.1,null,false,0],
    [8,sample(8,[light]),true,1],[7.9,null,true,0]
  ])assert.equal(at(time,detection,enabled).length,count);
});
