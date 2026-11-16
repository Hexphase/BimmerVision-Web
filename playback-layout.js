/* Scale the existing camera art and its hit regions together in every layout. */
class BVPlaybackLayout {
  constructor(root,player) {
    const card=root.querySelector('.sedan-panel-card');
    const stage=card.querySelector('.sedan-stage-wrapper'),box=card.querySelector('.sedan-stage-box');
    const fit=()=>{if(stage.clientWidth&&stage.clientHeight)box.style.transform='scale('+Math.max(.1,Math.min((stage.clientWidth-8)/200,(stage.clientHeight-8)/240,1))+')';};
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(fit);this.observer.observe(stage);}
    fit();
    const canvas=root.querySelector('#videoCanvas'),preview=root.querySelector('#playerStage');
    const feedback=root.ownerDocument.createElement('div');
    feedback.className='playback-action-feedback';feedback.setAttribute('aria-hidden','true');preview.append(feedback);
    const hover=root.ownerDocument.createElement('div');hover.className='playback-hover-control';hover.setAttribute('aria-hidden','true');preview.append(hover);
    canvas.setAttribute('role','button');canvas.tabIndex=0;
    const sync=()=>{canvas.setAttribute('aria-label',player.isPlaying?'Pause recording':'Play recording');hover.innerHTML=player.isPlaying?'<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4Z"/></svg>':'<svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8Z"/></svg>';};
    const playButton=root.querySelector('#playPauseBtn');
    if(typeof MutationObserver!=='undefined'){this.playObserver=new MutationObserver(sync);this.playObserver.observe(playButton,{attributes:true,attributeFilter:['aria-label']});}
    let pending=false,tapTimer=null,tapSide=0;
    const ready=()=>player.manifest&&player.streamComplete&&!player.loadError;
    const flash=(action,side=0)=>{
      feedback.dataset.action=action;
      feedback.style.left=side<0?'max(40px, 9%)':side>0?'min(calc(100% - 40px), 91%)':'50%';
      feedback.innerHTML=side?'<span class="seek-feedback"><span aria-hidden="true">'+(side<0?'‹‹':'››')+'</span><span>10s</span></span>':action==='play'?'<svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8Z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4Z"/></svg>';
      this.feedbackAnimation?.cancel();
      feedback.dataset.animating='true';
      const reduce=root.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion:reduce)').matches;
      this.feedbackAnimation=feedback.animate(reduce?[{opacity:1},{opacity:1,offset:.6},{opacity:0}]:[{opacity:0,transform:'scale(.8)'},{opacity:1,transform:'scale(1)',offset:.18},{opacity:1,transform:'scale(1)',offset:.6},{opacity:0,transform:'scale(1.15)'}],{duration:500,easing:'ease-out'});
      this.feedbackAnimation.onfinish=()=>{feedback.dataset.animating='false';};
    };
    const toggle=async()=>{
      if(pending||!ready())return;
      pending=true;
      const wasPlaying=player.isPlaying;
      try {
        if(wasPlaying)player.pause();else await player.play();
        sync();
        if(player.isPlaying!==wasPlaying)flash(player.isPlaying?'play':'pause');
      } finally {pending=false;}
    };
    const clearTap=()=>{clearTimeout(tapTimer);tapTimer=null;tapSide=0;};
    canvas.setAttribute('aria-description','Tap to play or pause. Double-tap the left or right edge to seek 10 seconds.');
    canvas.addEventListener('click',event=>{
      if(!ready())return;
      const bounds=canvas.getBoundingClientRect(),fraction=(event.clientX-bounds.left)/bounds.width;
      const side=fraction<=.18?-1:fraction>=.82?1:0;
      if(side&&tapTimer&&side===tapSide){
        clearTap();player.seek(Math.max(0,Math.min(player.duration,player.currentTime+side*10)));
        flash(side<0?'backward':'forward',side);return;
      }
      if(tapTimer){clearTap();toggle();}
      if(!side){toggle();return;}
      tapSide=side;
      tapTimer=setTimeout(()=>{clearTap();toggle();},300);
    });
    // A pending edge tap must not start another recording after navigation.
    const bodyObserver=new MutationObserver(clearTap);
    bodyObserver.observe(root.ownerDocument.body,{attributes:true,attributeFilter:['data-screen']});
    const title=root.ownerDocument.querySelector('#playbackClipLabel');
    if(title){this.clipObserver=new MutationObserver(clearTap);this.clipObserver.observe(title,{childList:true,subtree:true,characterData:true});}
    canvas.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();event.stopPropagation();clearTap();if(!event.repeat)toggle();}});
    sync();
  }
}
