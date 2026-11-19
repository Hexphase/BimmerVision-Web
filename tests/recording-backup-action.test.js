'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {update}=require('../recording-backup-action');
const id='12345678-1234-1234-1234-123456789abc',second='8136e19b-d2fb-4c10-9f55-634ea298980e';
const drive=(ids=[id,second])=>({segments:ids.map(id=>({clip:{id,complete:true}}))});
test('drive action keeps every complete recording and supports local sources',()=>{
 for(const kind of ['car','usb']){const b={dataset:{},setAttribute(){}};update(b,drive(),kind);assert.deepEqual(JSON.parse(b.dataset.backupDrive),[id,second]);assert.equal(b.disabled,false);assert.equal(b.hidden,false);}
});
test('drive action accepts exactly one thousand valid recordings',()=>{
 const ids=Array.from({length:1000},(_,i)=>i.toString(16).padStart(8,'0')+'-1234-1234-1234-123456789abc'),b={dataset:{},setAttribute(){}};update(b,drive(ids),'car');assert.equal(b.hidden,false);assert.deepEqual(JSON.parse(b.dataset.backupDrive),ids);
});
test('drive action clears IDs for missing, cloud, incomplete, duplicate or invalid selections',()=>{
 for(const [selection,kind] of [[null,'car'],[drive(),'cloud'],[drive([]),'car'],[drive([id,id]),'car'],[drive(['bad']),'car'],[{segments:[{clip:{id,complete:false}}]},'car'],[drive(Array.from({length:1001},(_,i)=>i.toString(16).padStart(8,'0')+'-1234-1234-1234-123456789abc')),'car'],[{segments:Array(1)},'car'],[drive([id,id.toUpperCase()]),'car']]){
 const b={dataset:{backupDrive:'stale',backupRecording:id},setAttribute(){}};update(b,selection,kind);assert.equal(b.disabled,true);assert.equal(b.hidden,true);assert.equal(b.dataset.backupDrive,undefined);assert.equal(b.dataset.backupRecording,undefined);
 }
});
test('website places entire drive backup beside overview recordings and retains per-clip actions',()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),app=fs.readFileSync(require.resolve('../app.js'),'utf8');
 assert.match(html,/<div class="drive-segments-box">[\s\S]*id="overviewBackupBtn"[^>]*disabled[^>]*hidden[^>]*>Back up entire drive<\/button>[\s\S]*id="driveSegmentsList"/);
 assert.doesNotMatch(html,/playbackBackupBtn|recording-backup-toolbar/);assert.match(html,/recording-backup-action\.js/);assert.match(app,/BVRecordingBackupAction\.update\(overviewBackupBtn,drive,/);assert.match(app,/Back up recording to Google Drive/);
 assert.match(app,/selectedDrive=null;overviewPlayBtn.disabled=true;[\s\S]*update\(overviewBackupBtn,null,/);
});
