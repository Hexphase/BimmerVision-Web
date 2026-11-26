/* Scale the existing camera art and its hit regions together in every layout. */
class BVPlaybackLayout {
  constructor(root,player) {
    const card=root.querySelector('.sedan-panel-card');
    const stage=card.querySelector('.sedan-stage-wrapper'),box=card.querySelector('.sedan-stage-box');
    const fit=()=>{
      if(!stage.clientWidth || !stage.clientHeight)return;
      const scale=Math.max(.1,Math.min((stage.clientWidth-8)/200,(stage.clientHeight-8)/240,1));
      box.style.transform='scale('+scale+')';
      box.style.setProperty('--camera-touch-size',48/scale+'px');
    };
    if(typeof ResizeObserver!=='undefined'){this.observer=new ResizeObserver(fit);this.observer.observe(stage);}
    fit();
    const canvas=root.querySelector('#videoCanvas'),preview=root.querySelector('#playerStage');
    const feedback=root.ownerDocument.createElement('div');
    feedback.className='playback-action-feedback';feedback.setAttribute('aria-hidden','true');preview.append(feedback);
    canvas.setAttribute('role','button');canvas.tabIndex=0;
    const sync=()=>canvas.setAttribute('aria-label',player.isPlaying?'Pause recording':'Play recording');
    const playButton=root.querySelector('#playPauseBtn');
    const mobile=window.matchMedia('(max-width:999px)');
    const deck=root.querySelector('.playback-vision-pair');
    const dots=[...root.querySelectorAll('.preview-picker button')];
    const panels=[...deck.children];
    const showPreview=index=>{
      const panel=panels[index];
      const left=deck.scrollLeft+panel.getBoundingClientRect().left-deck.getBoundingClientRect().left;
      deck.scrollTo({left,behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    };
    dots.forEach((dot,index)=>dot.addEventListener('click',()=>showPreview(index)));
    // Some mobile browsers hand the gesture to a clipped element inside the card.
    // Complete the swipe if native scrolling never moved the deck.
    let swipeStart;
    deck.addEventListener('touchstart',event=>{
      swipeStart=null;
      if(!mobile.matches || event.touches.length!==1 || event.target.closest('.timeline-viewport'))return;
      const touch=event.touches[0];
      swipeStart={x:touch.clientX,y:touch.clientY,left:deck.scrollLeft,
        index:dots.findIndex(dot=>dot.getAttribute('aria-pressed')==='true')};
    },{passive:true});
    deck.addEventListener('touchcancel',()=>{swipeStart=null;});
    deck.addEventListener('touchend',event=>{
      const start=swipeStart;
      swipeStart=null;
      if(!start || event.touches.length || Math.abs(deck.scrollLeft-start.left)>4)return;
      const touch=event.changedTouches[0],dx=touch.clientX-start.x,dy=touch.clientY-start.y;
      if(Math.abs(dx)<32 || Math.abs(dx)<=Math.abs(dy))return;
      if(event.cancelable)event.preventDefault();
      showPreview(Math.max(0,Math.min(panels.length-1,start.index-Math.sign(dx))));
    },{passive:false});
    deck.addEventListener('scroll',()=>{
      if(!mobile.matches)return;
      const left=deck.getBoundingClientRect().left;
      const distance=panels.map(panel=>Math.abs(panel.getBoundingClientRect().left-left));
      const visibleIndex=distance.indexOf(Math.min(...distance));
      dots.forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===visibleIndex)));
    },{passive:true});
    const hover=event=>{
      if(event.pointerType==='mouse' && !preview.hasAttribute('data-dismissed'))preview.dataset.mouseHover='';
      else delete preview.dataset.mouseHover;
    };
    preview.addEventListener('pointermove',hover);
    preview.addEventListener('pointerenter',hover);
    preview.addEventListener('pointerleave',()=>{delete preview.dataset.mouseHover;delete preview.dataset.dismissed;});
    preview.addEventListener('focusin',event=>{
      if(event.target.matches(':focus-visible'))delete preview.dataset.dismissed;
    });
    let hideTimer;
    const reveal=()=>{
      clearTimeout(hideTimer);
      delete preview.dataset.dismissed;
      preview.dataset.controls='visible';
      hideTimer=setTimeout(()=>delete preview.dataset.controls,3000);
    };
    const overlay=preview.querySelector('.clip-overlay');
    overlay.addEventListener('pointerdown',()=>{reveal();clearTimeout(hideTimer);});
    for(const type of ['pointerup','pointercancel','input','click'])overlay.addEventListener(type,reveal);
    if(typeof MutationObserver!=='undefined'){this.playObserver=new MutationObserver(sync);this.playObserver.observe(playButton,{attributes:true,attributeFilter:['aria-label']});}
    let pending=false,tapTimer=null,tapSide=0;
    const ready=()=>player.manifest&&player.streamComplete&&!player.loadError;
    const flash=(action,side=0)=>{
      feedback.dataset.action=action;
      feedback.style.left=side<0?'max(40px, 9%)':side>0?'min(calc(100% - 40px), 91%)':'50%';
      feedback.innerHTML=side?'<span class="seek-feedback"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="'+(side<0?'m12 5-9 7 9 7zm9 0-9 7 9 7z':'m3 5 9 7-9 7zm9 0 9 7-9 7z')+'"/></svg><span>10s</span></span>':action==='play'?'<svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8Z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4Z"/></svg>';
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
    canvas.setAttribute('aria-description','Tap to show controls. Tap the center to play or pause. Double-tap the left or right edge to seek 10 seconds.');
    canvas.addEventListener('click',event=>{
      const wasVisible=preview.matches('[data-controls="visible"],[data-mouse-hover],:has(:focus-visible)');
      if(wasVisible){
        clearTimeout(hideTimer);
        delete preview.dataset.controls;
        delete preview.dataset.mouseHover;
        preview.dataset.dismissed='';
      }else reveal();
      if(!ready())return;
      const bounds=canvas.getBoundingClientRect(),fraction=(event.clientX-bounds.left)/bounds.width;
      const side=fraction<=.18?-1:fraction>=.82?1:0;
      if(side&&tapTimer&&side===tapSide){
        clearTap();player.seek(Math.max(0,Math.min(player.duration,player.currentTime+side*10)));
        flash(side<0?'backward':'forward',side);return;
      }
      clearTap();
      const vertical=(event.clientY-bounds.top)/bounds.height;
      if(Math.abs(fraction-.5)<.14 && Math.abs(vertical-.5)<.18){toggle();return;}
      if(!side)return;
      tapSide=side;
      tapTimer=setTimeout(clearTap,300);
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
