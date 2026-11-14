/* BFCache suspends timers; persisted pagehide must not retire this visit's refresh. */
function startCatalogRefresh(environment,canRefresh,refresh){
  let stopped=false;
  const timer=environment.setInterval(()=>{if(canRefresh())refresh();},10000);
  const onHide=event=>{if(!event.persisted)stop();};
  function stop(){if(stopped)return;stopped=true;environment.clearInterval(timer);environment.removeEventListener('pagehide',onHide);}
  environment.addEventListener('pagehide',onHide);
  return stop;
}
if(typeof module!=='undefined')module.exports={startCatalogRefresh};
