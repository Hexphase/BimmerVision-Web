const {test}=require('node:test'), assert=require('node:assert/strict');
const {ClipExporter}=require('../exporter');
test('exports follow the car display across midnight and a later manual clock change',()=>{
  const wallMs=Date.UTC(2026,10,26,23,59,59),startMonotonicUs=1000000;
  const manifest={startMonotonicUs,clock:{displayAnchors:[{sampleUs:startMonotonicUs,wallMs},{sampleUs:4000000,wallMs:wallMs+3603000}]}};
  assert.deepEqual(ClipExporter.recordedTime(manifest,2),{ms:wallMs+2000,utc:false});
  assert.deepEqual(ClipExporter.recordedTime(manifest,4),{ms:wallMs+3604000,utc:false});
});
test('older clips use the saved clock offset or explicitly show UTC',()=>{
  const startedAt='2026-11-26T20:03:05Z',base=Date.parse(startedAt);
  assert.deepEqual(ClipExporter.recordedTime({startedAt,clock:{utcOffsetMinutes:-360}},1),{ms:base-21600000+1000,utc:false});
  assert.deepEqual(ClipExporter.recordedTime({startedAt},1),{ms:base+1000,utc:true});
});
