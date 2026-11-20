/* Keep the overview backup action tied to every complete recording in the selected drive. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BVRecordingBackupAction=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function update(button,drive,kind){
 if(!button)return;
 const segments=drive?.segments;
 const ids=Array.isArray(segments)?Array.from(segments,segment=>segment?.clip?.id):[];
 const eligible=['usb','car'].includes(kind)&&ids.length>0&&ids.length<=1000&&segments.every(segment=>segment?.clip?.complete===true)&&ids.every(id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))&&new Set(ids.map(id=>id.toLowerCase())).size===ids.length;
 button.hidden=!eligible;button.disabled=!eligible;
 delete button.dataset.backupRecording;
 if(eligible){button.dataset.backupDrive=JSON.stringify(ids);button.setAttribute('aria-label','Send entire drive to Remote Backup');}else delete button.dataset.backupDrive;
}
return {update};
});
