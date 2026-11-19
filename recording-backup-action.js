/* Keep the explicit playback backup action tied to the current local recording. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BVRecordingBackupAction=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function update(button,clip,kind){
 if(!button)return;
 const eligible=['usb','car'].includes(kind)&&clip?.complete===true&&typeof clip.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clip.id);
 button.hidden=!eligible;button.disabled=!eligible;
 if(eligible){button.dataset.backupRecording=clip.id;button.setAttribute('aria-label','Back up recording to Google Drive');}else delete button.dataset.backupRecording;
 const parent=button.parentElement;if(parent?.classList.contains('recording-backup-toolbar'))parent.hidden=!eligible;
}
return {update};
});
