/* A native modal drawer keeps navigation clear and keyboard focus contained. */
(function(root){
'use strict';
class MoreMenu {
 constructor(details){
  this.details=details;this.trigger=details.querySelector('summary');const content=details.querySelector('.app-menu-content');if(!this.trigger||!content)return;
  this.dialog=document.createElement('dialog');this.dialog.id='moreMenuPanel';this.dialog.className='more-menu-panel';this.dialog.setAttribute('aria-labelledby','moreMenuTitle');
  const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.id='moreMenuTitle';title.textContent='More';close.type='button';close.className='more-menu-close';close.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 6 12 12M6 18 18 6"/></svg>';close.setAttribute('aria-label','Close More menu');header.append(title,close);this.dialog.append(header,content);document.body.append(this.dialog);
  this.trigger.setAttribute('aria-haspopup','dialog');this.trigger.setAttribute('aria-controls',this.dialog.id);this.trigger.setAttribute('aria-expanded','false');
  this.trigger.addEventListener('click',event=>{event.preventDefault();this.dialog.open?this.close():this.open();});
  close.onclick=()=>this.close();this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  this.dialog.addEventListener('click',event=>{if(event.target===this.dialog)this.close();else if(event.target.closest('button')&&!event.target.closest('[data-more-keep-open]'))this.close(false);});
  this.dialog.addEventListener('close',()=>{details.open=false;this.trigger.setAttribute('aria-expanded','false');});
  details.addEventListener('toggle',()=>{if(!details.open&&this.dialog.open)this.close(false);});
 }
 open(){if(this.dialog.open)return;this.details.open=true;this.trigger.setAttribute('aria-expanded','true');this.dialog.showModal();const first=this.dialog.querySelector('.more-navigation button:not(:disabled)');first?.focus();}
 close(restore=true){this.details.open=false;this.trigger.setAttribute('aria-expanded','false');if(this.dialog.open)this.dialog.close();if(restore)this.trigger.focus();}
}
root.BVMoreMenu=MoreMenu;
function start(){const details=document.querySelector('.app-menu');if(details&&!document.getElementById('moreMenuPanel'))root.BVMoreMenuInstance=new MoreMenu(details);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof globalThis!=='undefined'?globalThis:this);
