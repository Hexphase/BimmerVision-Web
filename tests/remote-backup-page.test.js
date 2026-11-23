'use strict';const test=require('node:test'),assert=require('node:assert/strict');const {selection,estimate,queueDrives,uploadRoute,summarizeUpload}=require('../remote-backup-page');
test('Remote Backup selection is bounded and durations use hours and minutes',()=>{const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';assert.deepEqual(selection([id]),[id]);for(const ids of [[],[id,id],['invalid'],Array(1001).fill(id)])assert.throws(()=>selection(ids));assert.equal(estimate(3660),'1 hr 01 min remaining');assert.equal(estimate(null),'');});

test('Queue contains only pending recordings and leaves the source library intact',()=>{const drives=[{id:'drive',clips:[{id:'pending',queued:true,state:'Queued'},{id:'active',queued:true,state:'Uploading',progress:.5},{id:'complete',queued:true,state:'Complete'},{id:'removed',queued:true,state:'Removed'},{id:'local',queued:false,state:'Not queued'}]},{id:'empty',clips:[{id:'done',queued:false,state:'Complete'}]}],snapshot=JSON.stringify(drives);const queue=queueDrives(drives);assert.deepEqual(queue.map(d=>d.id),['drive']);assert.deepEqual(queue[0].clips.map(c=>c.id),['pending','active']);assert.equal(JSON.stringify(drives),snapshot);assert.deepEqual(queueDrives(),[]);});
test('selection rejects case-insensitive duplicate recording identifiers',()=>{const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';assert.throws(()=>selection([id,id.toUpperCase()]));});

test('paired viewer pauses the car route while an active phone upload takes priority',()=>{const paired=uploadRoute({viewerConnected:true,wifiEligible:true,transport:'car-wifi'});assert.equal(paired.label,'Phone connected · car backup paused');assert.equal(paired.active,false);assert.equal(paired.carUploading,false);const phone=uploadRoute({viewerConnected:true,transport:'phone'});assert.equal(phone.label,'This phone · Internet');assert.equal(phone.active,true);assert.equal(uploadRoute({viewerConnected:false,transport:'car-wifi'}).carUploading,true);assert.equal(uploadRoute({viewerConnected:true,transport:'phone'},false).label,'This device · Local recordings');});

test('Home summary reports active progress and excludes completed or removed clips',()=>{
 const drives=[{clips:[
  {queued:true,state:'Uploading',bytes:400,confirmedBytes:100},
  {queued:true,state:'Complete',bytes:300,confirmedBytes:300},
  {queued:true,state:'Removed',bytes:200,confirmedBytes:0}
 ]}];
 assert.deepEqual(summarizeUpload({transport:'car-wifi',drives}),{remaining:1,progress:.25});
 assert.equal(summarizeUpload({transport:'car-wifi',viewerConnected:true,drives}),null);
 assert.deepEqual(summarizeUpload({transport:'phone',drives,phoneProgress:{bytes:20,total:40}}),{remaining:1,progress:.5});
 assert.deepEqual(summarizeUpload({transport:'phone',drives:[]}),{remaining:null,progress:null});
});
