const {test}=require('node:test');
const assert=require('node:assert/strict');
const {BimmerVisionPlayer}=require('../player');

function fixture(){
  const player=Object.create(BimmerVisionPlayer.prototype);
  player.currentTime=68;
  player.manifest={startMonotonicUs:0};
  player.cameraMapping={phase0:'leftRight',flipHalves:true};
  player.parser={getCameraViewAtTime:()=>({single:false,atUs:60000000})};
  player.accessUnits=[{pair:'frontRear',recordedPair:true},{pair:'leftRight',recordedPair:true}];
  player.getCurrentRawFrame=i=>({bitmap:{},time:68,auIndex:i});
  return player;
}

test('resolves paired frames and preserves a distinct identity for each recorded layout',()=>{
  const p=fixture(),source=p.getEnhancementFrames();
  assert.equal(source.tagged,true);
  assert.equal(source.phase,0);
  assert.equal(source.half,1);
  assert.equal(source.segment,60000000);
  p.manifest.cameraMapping='unverified';
  assert.equal(p.getEnhancementFrames().tagged,false);
  delete p.manifest.cameraMapping;
  p.accessUnits[0].recordedPair=false;
  assert.equal(p.getEnhancementFrames().tagged,false);
});
test('single, missing, stale and seeking frames do not enter the camera model',()=>{
  const p=fixture();
  p.parser.getCameraViewAtTime=()=>({single:true});
  assert.equal(p.getEnhancementFrames(),null);
  p.parser.getCameraViewAtTime=()=>null;
  p.getCurrentRawFrame=i=>i?null:{bitmap:{},time:68};
  assert.equal(p.getEnhancementFrames(),null);
  p.getCurrentRawFrame=()=>({bitmap:{},time:67});
  assert.equal(p.getEnhancementFrames(),null);
  p._nativeVideo={seeking:true};
  assert.equal(p.getEnhancementFrames(),null);
});

test('calibration gathers both paired layouts before returning to the original playback position',async()=>{
  const p=fixture(), visited=[],mappings=new Map();
  p.duration=30;p.currentTime=4;p.isPlaying=true;p._clipEpoch=1;
  p.parser.cameraViewEvents=[{atUs:0},{atUs:10000000},{atUs:20000000}];
  p.parser.getCameraViewAtTime=t=>({single:t>=10&&t<20,atUs:t<10?0:20000000});
  p.pause=()=>{p.isPlaying=false;};p.play=()=>{p.isPlaying=true;};
  p.seekAndWait=async t=>{p.currentTime=t;};
  p.getEnhancementFrames=()=>({segment:p.currentTime<10?0:20000000,tagged:false});
  await p.calibrateCameraLayouts({signal:new AbortController().signal,mappings,choose:async(source,index,total)=>{
    assert.equal(p.isPlaying,false);assert.equal(total,2);
    visited.push(source.segment);return {phase:index%2,half:0};
  }});
  assert.deepEqual(visited,[0,20000000]);assert.equal(mappings.size,2);
  assert.equal(p.currentTime,4);assert.equal(p.isPlaying,true);
});
