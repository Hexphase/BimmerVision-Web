'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {update}=require('../recording-backup-action');
const id='12345678-1234-1234-1234-123456789abc',second='8136e19b-d2fb-4c10-9f55-634ea298980e';
const drive=(ids=[id,second])=>({segments:ids.map(id=>({clip:{id,complete:true}}))});
test('drive action keeps every complete recording and supports local sources',()=>{
 for(const kind of ['car','usb']){const b={dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;}};update(b,drive(),kind);assert.equal(b.attributes['aria-label'],'Send entire drive to Remote Backup');assert.deepEqual(JSON.parse(b.dataset.backupDrive),[id,second]);assert.equal(b.disabled,false);assert.equal(b.hidden,false);}
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
 assert.match(html,/<div class="drive-segments-box">[\s\S]*id="overviewBackupBtn"[^>]*disabled[^>]*hidden[^>]*>Send entire drive to Remote Backup<\/button>[\s\S]*id="driveSegmentsList"/);
 assert.doesNotMatch(html,/playbackBackupBtn|recording-backup-toolbar/);assert.match(html,/recording-backup-action\.js/);assert.match(app,/BVRecordingBackupAction\.update\(overviewBackupBtn,drive,/);assert.match(app,/Send to Remote Backup/);
 assert.match(app,/selectedDrive=null;overviewPlayBtn.disabled=true;[\s\S]*update\(overviewBackupBtn,null,/);
});

test('direct backup actions open upload selection instead of the Remote Backup manager',async()=>{
 const {createActions}=require('../recording-backup-action'),opened=[],picker=[];
 const root={BVSourceManager:{source:{kind:'usb'},generation:1},BVGoogleDriveBackupUI:{open:value=>opened.push([value]),openDrive:ids=>opened.push(ids)},BVRemoteBackupPage:{open:(...args)=>picker.push(args)}};
 const actions=createActions(root);await actions.openRecording(id);await actions.openDrive([id,second]);assert.deepEqual(opened,[[id],[id,second]]);assert.equal(picker.length,0);
 root.BVSourceManager.source={kind:'drive'};assert.throws(()=>actions.openRecording(id),/local|USB|car/);assert.equal(opened.length,2);
 for(const invalid of ['',null,'bad'])assert.throws(()=>actions.openRecording(invalid));assert.throws(()=>actions.openDrive([id,id.toUpperCase()]));
});
test('direct car action preopens its popup synchronously and delegates durable queue work',async()=>{
 const {createActions}=require('../recording-backup-action'),events=[],popup={};let finish;
 const root={BVSourceManager:{source:{kind:'car'},generation:1},BVPhoneBackupLaunch:{preparePopup(){events.push('popup');return popup;},openDirect(ids,window){assert.equal(window,popup);assert.deepEqual(ids,[id]);events.push('durable');return new Promise(resolve=>finish=resolve);}},BVRemoteBackupPage:{open(){throw Error('manager must not open');}}};
 const pending=createActions(root).openRecording(id);assert.deepEqual(events,['popup','durable']);finish(true);assert.equal(await pending,true);
});
test('per-record and drive click routing bypasses manager and prevents duplicate legacy handlers',async()=>{
 const {bindActions}=require('../recording-backup-action'),handlers=[],opened=[],errors=[];
 const root={document:{addEventListener(type,fn,capture){handlers.push({type,fn,capture});}},BVSourceManager:{source:{kind:'usb'},generation:1},alert:error=>errors.push(error)};
 bindActions(root,{openRecording:value=>opened.push([value]),openDrive:ids=>opened.push(ids)});assert.equal(handlers[0].capture,true);
 for(const dataset of [{backupRecording:id},{backupDrive:JSON.stringify([id,second])}]){let stopped=false,prevented=false;const button={dataset,disabled:false};await handlers[0].fn({target:{closest:()=>button},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});assert.equal(stopped,true);assert.equal(prevented,true);assert.equal(button.disabled,false);}
 assert.deepEqual(opened,[[id],[id,second]]);assert.deepEqual(errors,[]);
});
