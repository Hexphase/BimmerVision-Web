/**
 * BimmerVision Unified Web App Controller
 * Full Drives Grouping, Dark OSM Maps, Corrected Sedan Diagram, and Drive Playback.
 */
document.addEventListener("DOMContentLoaded", async () => {
  await window.BVSourceManager.ready;
  // Tabs & Views
  const viewRecordings = document.getElementById("viewRecordings");
  const viewPlayback = document.getElementById("viewPlayback");

  // Drive Overview Elements
  const driveListEl = document.getElementById("driveList");
  const librarySummary = document.getElementById('librarySummary');
  const librarySourceName = document.getElementById('librarySourceName');
  document.getElementById('libraryChangeSourceBtn').addEventListener('click', () => {
    document.getElementById('changeSourceBtn').click();
  });
  const librarySettingsButton = document.getElementById('librarySettingsBtn');

  const overviewTitle = document.getElementById("overviewTitle");
  const overviewSubtitle = document.getElementById("overviewSubtitle");
  const overviewPlayBtn = document.getElementById("overviewPlayBtn");
  const endpointStartAddr = document.getElementById("endpointStartAddr");
  const endpointStartTime = document.getElementById("endpointStartTime");
  const endpointEndAddr = document.getElementById("endpointEndAddr");
  const endpointEndTime = document.getElementById("endpointEndTime");
  const metricDistance = document.getElementById("metricDistance");
  const metricDuration = document.getElementById("metricDuration");
  const metricTopSpeed = document.getElementById("metricTopSpeed");
  const metricAvgSpeed = document.getElementById("metricAvgSpeed");
  const metricMaxSteering = document.getElementById("metricMaxSteering");
  const metricBrakeEvents = document.getElementById("metricBrakeEvents");
  const overviewBackupBtn = document.getElementById("overviewBackupBtn");
  const driveSegmentsList = document.getElementById("driveSegmentsList");

  // Playback & HUD Elements
  const canvas = document.getElementById("videoCanvas");
  const sedanContainer = document.getElementById("sedanSelectorContainer");
  const advancedDetailsToggle = document.getElementById("advancedDetailsToggle");
  const debugBanner = document.getElementById("debugOutput");
  const videoLoadingModal = document.getElementById("videoLoadingModal");
  const loadingModalStatus = document.getElementById("loadingModalStatus");

  let loadingFocus=null;
  function showLoadingModal(title, text) {
    if (videoLoadingModal) {
      if(videoLoadingModal.style.display!=='flex')loadingFocus=document.activeElement;
      document.getElementById("loadingModalTitle").textContent = title;
      if (loadingModalStatus && text) loadingModalStatus.textContent = text;
      document.querySelector(".app-shell").inert = true;
      videoLoadingModal.style.display = "flex";
      document.getElementById("loadingCancelBtn").focus();
    }
  }

  function hideLoadingModal() {
    if (videoLoadingModal) {
      videoLoadingModal.style.display = "none";
      document.querySelector(".app-shell").inert = false;
      if(loadingFocus?.isConnected && loadingFocus.getClientRects().length)loadingFocus.focus();
      loadingFocus=null;
    }
  }

  if (advancedDetailsToggle && debugBanner) {
    advancedDetailsToggle.addEventListener("change", (e) => {
      window.showAdvancedDetails = e.target.checked;
      if (e.target.checked) {
        debugBanner.classList.add("visible");
        debugBanner.style.display = "block";
        if (player) player._updateDebugBanner();
      } else {
        debugBanner.classList.remove("visible");
        debugBanner.style.display = "none";
      }
    });
  }

  const hudElements = {
    playBtn: document.getElementById("playPauseBtn"),
    scrubber: document.getElementById("scrubBar"),
    timeDisplay: document.getElementById("timecode"),
    speedValue: document.getElementById("hudSpeedVal"),
    speedUnit: document.getElementById("hudSpeedUnit"),
    speedLimit: document.getElementById("hudLimitVal"),
    brakePedal: document.getElementById("brakePedalCard"),
    gasPedal: document.getElementById("gasPedalCard"),
    wheelFace: document.getElementById("wheelFace"),
    wheelHorn: document.getElementById("wheelHorn"),
    wheelAngleVal: document.getElementById("wheelAngleVal"),
    blinkerLeft: document.getElementById("blinkerLeft"),
    blinkerRight: document.getElementById("blinkerRight")
  };

  // 1. Initialize Player & Exporter
  const player = new BimmerVisionPlayer(canvas, hudElements);
  window.player = player;
  const drivingView = new BVDrivingView(document.getElementById('drivingViewPanel'));
  player.setDrivingView(drivingView);
  const exporter = new ClipExporter(player);

  // 2. Initialize Dark OSM Maps
  const overviewMapCanvas = document.getElementById("overviewMapCanvas");
  const playbackMapCanvas = document.getElementById("playbackMapCanvas");

  const overviewMap = new DarkOsmMap(overviewMapCanvas, { fitAll: true });
  const playbackMap = new DarkOsmMap(playbackMapCanvas, { fitAll: false });
  player.setLiveMap(playbackMap);

  const driveIcon = name => {
    const paths={backup:'<path d="M7 18H6a4.5 4.5 0 0 1-.4-9 6.5 6.5 0 0 1 12.4-1 5 5 0 0 1 0 10h-1m-5 2V11m-3 3 3-3 3 3"/>',play:'<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',clips:'<rect x="5" y="3" width="16" height="14" rx="2"/><path d="M17 21H5a2 2 0 0 1-2-2V7m8 0h6m-6 4h6"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>'};
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
  };

  // 3. Initialize Interactive Sedan Camera Selector (All, Source, Front, Rear, Left, Right, Identify)
  let sedanSelector = null;
  if (sedanContainer) {
    sedanSelector = new SedanCameraSelector(
      sedanContainer,
      (view) => {
        player.setViewMode(view);
      },
      () => {
        openIdentifyModal();
      }
    );
    player.setSedanSelector(sedanSelector);
    new BVPlaybackLayout(document.getElementById("viewPlayback"),player);
  }

  // 4. Tab Navigation Controller ('Recordings' and 'Playback')
  function switchTab(tabName) {
    if(tabName==='recordings')window.BVRecordingCache?.clear();
    document.body.dataset.screen=tabName==='recordings'?'library':'playback';
    window.scrollTo({top:0,behavior:"instant"});
    if (tabName === "recordings") {
      viewRecordings.classList.add("active");
      viewPlayback.classList.remove("active");
      setTimeout(() => {
        overviewMap.handleResize();
        overviewMap.render();
      }, 50);
    } else {
      viewPlayback.classList.add("active");
      viewRecordings.classList.remove("active");
      setTimeout(() => {
        playbackMap.handleResize();
        playbackMap.render();
        player._renderFrameAtTime(player.currentTime);
      }, 50);
    }
  }

  let detectedDrives = [];
  let selectedDrive = null;
  let activeDrive = null, activeClip = null, loadToken = 0, lastOpen = null;
  const recordingNavigation = new BVRecordingNavigation({previous:document.getElementById('skipBackBtn'),next:document.getElementById('skipFwdBtn'),getContext:()=>({drive:activeDrive,clipId:activeClip?.id}),openClip:clip=>playClipInDrive(clip,true)});
  const cameraStore = new CameraStore(apiFetch, localStorage);
  let dragWasPlaying=false, seekToken=0, previewAt=0;
  const timeline = new DriveTimeline(document.getElementById('driveTimeline'), (seg, offset, options={}) => {
    if(options.preview){
      // Keep the ruler movable while dragging. Cross-clip preparation starts on release.
      if(activeClip?.id===seg.clip.id && performance.now()-previewAt>80){previewAt=performance.now();player.seek(offset);}
      return;
    }
    seekTimeline(seg,offset,dragWasPlaying);
  });
  timeline.onDragStart=()=>{dragWasPlaying=player.isPlaying;player.pause();};
  async function seekTimeline(seg,offset,resume){
    if(activeClip?.id!==seg.clip.id){await playClipInDrive(seg.clip,resume,offset);return;}
    const token=++seekToken, clipToken=loadToken;
    lastOpen={clip:activeClip,autoPlay:resume,startAt:offset};
    showLoadingModal('Preparing video','Rendering the selected camera frames…');
    await paintLoading();
    if(token!==seekToken||clipToken!==loadToken)return;
    try{
      await player.seekAndWait(offset);
      if(token!==seekToken||clipToken!==loadToken)return;
      await paintLoading();
      if(token!==seekToken||clipToken!==loadToken)return;
      hideLoadingModal();
      if(resume)await player.play({restartAtEnd:false});
    }catch(error){
      if(token!==seekToken||clipToken!==loadToken||error.name==='AbortError')return;
      document.getElementById('loadingRetryBtn').hidden=false;
      showLoadingModal('Could not prepare video',error.message);
    }
  }
  function paintLoading(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getLockSvg = (isLocked, size = 15) => isLocked
    ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" fill-opacity="0.2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
    : `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" fill-opacity="0.05"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
  const getTrashSvg = (size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
  const libraryBackButton = document.getElementById('backToDrives');
  const overviewSheet = document.getElementById('driveOverviewSheet');
  function showDriveOverview(open) {
    if (open && !overviewSheet.open) {
      overviewSheet.showModal();
      overviewSheet.querySelector('.drive-overview-stage').scrollTop = 0;
      overviewMap.handleResize();
      overviewMap.render();
    } else if (!open && overviewSheet.open) {
      overviewSheet.close();
      overviewSheet.querySelectorAll('details').forEach(details => { details.open = false; });
    }
  }
  libraryBackButton.addEventListener('click', () => showDriveOverview(false));
  overviewSheet.addEventListener('cancel', event => {
    event.preventDefault();
    showDriveOverview(false);
  });
  overviewSheet.addEventListener('click', event => {
    if (event.target === overviewSheet) showDriveOverview(false);
  });
  document.getElementById('playbackBackBtn').addEventListener('click', () => {player.pause();switchTab('recordings');showDriveOverview(false);});
  document.getElementById('libraryRefreshBtn').addEventListener('click', () => location.reload());
  document.getElementById('loadingCancelBtn').addEventListener('click', () => {loadToken++;player.cancelLoad();hideLoadingModal();switchTab('recordings');});
  document.getElementById('loadingRetryBtn').addEventListener('click', () => {if(lastOpen)playClipInDrive(lastOpen.clip,lastOpen.autoPlay,lastOpen.startAt);});
  player.onTimeUpdate = seconds => {
    if (activeClip && player.parser && player.manifest) {
      timeline.setTelemetry(activeClip.id, player.parser.telemetryRecords,
        player.manifest.startMonotonicUs ?? player.parser.startMonotonicUs, player.speedUnit);
    }
    timeline.update(activeClip?.id,seconds);
    hudElements.scrubber.style.setProperty('--seek-progress',(player.duration>0?Math.max(0,Math.min(100,seconds/player.duration*100)):0)+'%');
    document.getElementById('dockElapsed').textContent=DriveTimeline.format(seconds);
    document.getElementById('dockDuration').textContent=DriveTimeline.format(player.duration);
  };
  const cameraViewUnavailable = document.getElementById('cameraViewUnavailable');
  const cameraViewUnavailableReason = document.getElementById('cameraViewUnavailableReason');
  player.onCameraViewChange = view => {
    const unavailable = !!view?.single;
    const reason = unavailable ? (view.bmwCameraActive
      ? 'BMW was using the cameras at this point in the drive.'
      : 'The recorder’s four-camera feed is unavailable for this part of the drive.') : '';
    if (cameraViewUnavailableReason.textContent !== reason) cameraViewUnavailableReason.textContent = reason;
    cameraViewUnavailable.hidden = !unavailable;
  };
  player.onStateChange = ({state,message,loaded,total,download}) => {
    recordingNavigation.update(state==='loading');
    const status = document.getElementById('playbackStatus');
    status.textContent = message || ({playing:'Playing',paused:'Paused',loading:'Preparing video…',buffering:'Buffering…',ended:'Drive complete',idle:'Choose a recording',error:'Playback unavailable'}[state] || state);
    status.dataset.state=state;
    document.getElementById('playbackProgress').hidden=state!=='buffering';
    if (state === 'loading') { if(message)loadingModalStatus.textContent=message;const verb=window.BVSourceManager.readOnly?'read':'received';const received=total ? `${Math.min(100,Math.round(loaded/total*100))}% ${verb}` : loaded ? `${formatBytes(loaded)} ${verb}` : 'Waiting for recording data…';const rate=download?.elapsedMs>=500&&download.bytesPerSecond>0?' · '+formatBytes(download.bytesPerSecond)+'/s':'';const timing=window.showAdvancedDetails===true&&download?' · Receive wait '+(download.receiveWaitMs/1000).toFixed(1)+'s · Video processing '+(download.processingMs/1000).toFixed(1)+'s':'';document.getElementById('loadingProgress').textContent=received+rate+timing; }
    hudElements.playBtn.disabled=!player.streamComplete||state==='loading'||state==='error';
    document.getElementById('openExportBtn').disabled=hudElements.playBtn.disabled;
    if(state==='error' && !videoLoadingModal.style.display.includes('flex')) document.getElementById('playbackRetryBtn').hidden=false;
  };
  document.getElementById('playbackRetryBtn').addEventListener('click',()=>{if(activeClip)playClipInDrive(activeClip,true,player.currentTime);});
  player.onEnded=()=>{
    const index=activeDrive?.segments.findIndex(s=>s.clip.id===activeClip?.id) ?? -1;
    const next=activeDrive?.segments[index+1];
    if(next && document.getElementById('webContinuePlayback')?.checked!==false)playClipInDrive(next.clip,true);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden)player.pause();});


  async function ensureCarSession() { /* Selected source owns pairing. */ }
  async function allowUsbLock(source){
    if(source?.kind!=='usb' || source.canLock)return true;
    const dialog=document.getElementById('usbWriteDialog');
    if(dialog.open)return false;
    const choose=document.getElementById('usbWriteChoose'),cancel=document.getElementById('usbWriteCancel');
    const help=document.getElementById('usbWriteHelp'),error=document.getElementById('usbWriteError');
    const supported=typeof window.showDirectoryPicker==='function';
    help.textContent=supported
      ? 'Your USB drive is open for viewing. To save this lock change, select the same folder again and choose Allow when your browser asks to edit files. BimmerVision updates the lock in the recording metadata.'
      : 'This browser can view USB recordings. To change a lock, open this page in desktop Chrome or Edge, select the USB folder, then press Lock or Unlock and allow editing.';
    choose.hidden=!supported;choose.disabled=false;cancel.textContent=supported?'Cancel':'Close';error.hidden=true;
    const controller=new AbortController();
    let granted=false;
    return new Promise(resolve=>{
      dialog.onclose=()=>{controller.abort();choose.onclick=null;cancel.onclick=null;resolve(granted && window.BVSourceManager.source===source);};
      cancel.onclick=()=>dialog.close();
      choose.onclick=async()=>{
        choose.disabled=true;error.hidden=true;
        try{
          const root=await window.showDirectoryPicker({id:'bimmervision-recordings',mode:'readwrite'});
          if(controller.signal.aborted || window.BVSourceManager.source!==source){if(dialog.open&&!controller.signal.aborted)dialog.close();return;}
          await source.enableLocks(root,controller.signal);
          granted=true;dialog.close();
        }catch(e){
          if(controller.signal.aborted)return;
          if(e.name==='AbortError'){dialog.close();return;}
          error.textContent=e.name==='NotAllowedError'||e.name==='SecurityError'
            ? 'Editing access was denied. Allow editing in the folder picker, or open this page in desktop Chrome or Edge.'
            : e.name==='NotFoundError'?'Choose the same USB folder you opened for viewing.':e.message;
          error.hidden=false;choose.disabled=false;
        }
      };
      dialog.showModal();
    });
  }
  function apiFetch(url,options={}) { return window.BVSourceManager.fetch(url,options); }

  let stopRecordingNotice=null;
  function updateRecordingNotice(){
    stopRecordingNotice?.();stopRecordingNotice=null;
    const nodes=[document.getElementById('recordingDownloadNotice'),document.getElementById('recordingDownloadNoticeLoading')];
    nodes.filter(Boolean).forEach(node=>{node.hidden=true;});
    if(window.BVSourceManager.source.kind==='car')stopRecordingNotice=startRecordingNotice({fetcher:apiFetch,nodes});
  }
  updateRecordingNotice();window.BVSourceManager.subscribe(updateRecordingNotice);

  let rawController=null,rawReadyUrl=null;
  const rawPanel=document.getElementById('rawDownloadPanel'),rawText=document.getElementById('rawDownloadStatus'),rawSave=document.getElementById('rawDownloadSave'),rawCancel=document.getElementById('rawDownloadCancel');
  function clearRaw(){rawController?.abort();rawController=null;if(rawReadyUrl)URL.revokeObjectURL(rawReadyUrl);rawReadyUrl=null;rawSave.hidden=true;rawPanel.hidden=true;}
  window.BVSourceManager.subscribe(clearRaw);window.addEventListener('pagehide',clearRaw);
  rawCancel.addEventListener('click',()=>rawController?.abort());
  document.getElementById('rawDownloadClose').addEventListener('click',clearRaw);
  async function downloadRaw(id){
    showDriveOverview(false);
    if(rawController){rawPanel.hidden=false;return;}
    clearRaw();rawPanel.hidden=false;rawCancel.hidden=false;rawText.textContent='Preparing original recording and metadata…';
    const controller=new AbortController(),generation=window.BVSourceManager.generation;rawController=controller;
    try{
      const result=await BVRawDownload.save({manager:window.BVSourceManager,id,signal:controller.signal,saveFilePicker:typeof window.showSaveFilePicker==='function'?window.showSaveFilePicker.bind(window):null,onProgress:({bytes,total,sourceKind})=>{if(window.BVSourceManager.generation!==generation)return;rawText.textContent=(sourceKind==='usb'?'Building ZIP from your USB drive':'Downloading original ZIP')+' · '+formatBytes(bytes)+(total?' / '+formatBytes(total):'');}});
      if(window.BVSourceManager.generation!==generation)return;
      if(result.mode==='file'){rawText.textContent='Original recording ZIP saved.';}
      else {rawReadyUrl=URL.createObjectURL(result.blob);rawSave.href=rawReadyUrl;rawSave.download=result.fileName;rawSave.hidden=false;rawText.textContent='Original recording ZIP ready. Save it to Files or Downloads.';rawSave.click();}
    }catch(error){if(window.BVSourceManager.generation===generation)rawText.textContent=error.name==='AbortError'?'ZIP download cancelled.':error.message;}
    finally{if(rawController===controller){rawController=null;rawCancel.hidden=true;}}
  }
  document.addEventListener('click',event=>{const link=event.target.closest?.('[data-raw-recording]');if(link){event.preventDefault();downloadRaw(link.dataset.rawRecording);}});

  const releaseChecker=new ReleaseChecker({fetcher:fetch.bind(window),storage:sessionStorage});
  let checkingUpdates=false;
  async function checkForUpdates(force=false){
    if(checkingUpdates)return;
    checkingUpdates=true;
    const versionSource=window.BVSourceManager.source;
    const button=document.getElementById('checkUpdatesBtn'),status=document.getElementById('releaseCheckStatus'),banner=document.getElementById('releaseNotice');
    if(window.BVSourceManager.source.kind!=='car'){button.hidden=true;banner.hidden=true;document.getElementById('installedCarVersion').textContent='USB viewing';status.textContent='The hosted web player updates when you reload this page. Car updates are available through MGU Store.';checkingUpdates=false;return;}
    button.hidden=false;button.disabled=true;status.textContent='Checking GitHub using your device’s internet connection…';
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
    try{
      const response=await apiFetch('/api/v1/version',{signal:abort.signal});
      if(!response.ok)throw new Error('Installed version unavailable.');
      const info=await response.json();
      if(window.BVSourceManager.source!==versionSource)return;
      document.getElementById('installedCarVersion').textContent=info.version||'Unavailable';
      window.BVAppVersion?.setConnected(info.version);
      const result=await releaseChecker.check(info.version,{force});
      if(window.BVSourceManager.source!==versionSource)return;
      if(result.state==='update'){
        status.textContent=`Version ${result.latestVersion} is available. Installed: ${result.currentVersion}.`;
        document.getElementById('releaseNoticeText').textContent=`BimmerVision ${result.latestVersion} is available · installed ${result.currentVersion}`;
        document.getElementById('releaseNoticeLink').href=result.url;
        let dismissed=false;try{dismissed=sessionStorage.getItem('bimmervision_dismissed_release')===result.latestVersion;}catch(_){}
        banner.hidden=dismissed;
        banner.dataset.version=result.latestVersion;
      }else{
        banner.hidden=true;
        status.textContent=result.state==='current'?`No newer stable release found. Installed: ${info.version}.`:`Could not check for updates. ${result.reason||''}`;
      }
    }catch(error){if(window.BVSourceManager.source===versionSource){banner.hidden=true;status.textContent='Could not check for updates. Check your device’s internet connection and try again.';}}
    finally{clearTimeout(timer);checkingUpdates=false;button.disabled=false;if(window.BVSourceManager.source!==versionSource)checkForUpdates(true);}
  }
  document.getElementById('checkUpdatesBtn').addEventListener('click',()=>checkForUpdates(true));
  document.getElementById('dismissReleaseNotice').addEventListener('click',()=>{
    const banner=document.getElementById('releaseNotice');banner.hidden=true;
    try{sessionStorage.setItem('bimmervision_dismissed_release',banner.dataset.version);}catch(_){}
  });
  checkForUpdates();

  function driveRoutePreview(route) {
    if (route.length < 2) return '';
    const first = route[0];
    const longitudeScale = Math.cos(first.latitude * Math.PI / 180);
    const points = route.map(({latitude, longitude}) => ({
      x: ((longitude - first.longitude + 540) % 360 - 180) * longitudeScale,
      y: first.latitude - latitude
    }));
    const bounds = points.reduce((b, p) => ({
      minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
      minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y)
    }), {minX:0,maxX:0,minY:0,maxY:0});
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const scale = 1 / Math.max(width / 276, height / 88);
    if (!Number.isFinite(scale)) return '';
    const plotted = points.map(({x,y}) => [
      160 + (x - bounds.minX - width / 2) * scale,
      56 + (y - bounds.minY - height / 2) * scale
    ]);
    const [startX,startY] = plotted[0];
    const [endX,endY] = plotted.at(-1);
    return `<div class="drive-route-preview" role="img" aria-label="Recorded route preview">
      <svg viewBox="0 0 320 112" aria-hidden="true">
        <polyline points="${plotted.map(point => point.map(value => value.toFixed(2)).join(',')).join(' ')}"/>
        <circle cx="${startX}" cy="${startY}" r="4"/><circle cx="${endX}" cy="${endY}" r="4"/>
      </svg>
    </div>`;
  }

  const homeTripStats = document.getElementById('homeTripStats');
  const homeLibraryIntro = document.getElementById('homeLibraryIntro');
  const homeLibraryTitle = document.getElementById('homeLibraryTitle');
  const homeLibrarySubtitle = document.getElementById('homeLibrarySubtitle');
  const homeTripNodes = Object.fromEntries(
    ['Source','Distance','DistanceUnit','Speed','SpeedUnit','Time','Count']
      .map(key => [key, document.getElementById('homeTrip' + key)])
  );
  const homeTripNumber = new Intl.NumberFormat(undefined, {maximumFractionDigits:1});
  let homeTripTotals = null;
  function renderHomeTrips() {
    homeTripStats.hidden = homeLibraryIntro.hidden = !homeTripTotals;
    const heading = homeTripTotals ? 'homeLibraryTitle' : 'sourceTitle';
    document.getElementById('sourceScreen').setAttribute('aria-labelledby', heading);
    document.getElementById('welcomeIntro').setAttribute('aria-labelledby', heading);
    if (!homeTripTotals) return;
    const {distanceMeters, topSpeedKph, seconds, recordings} = homeTripTotals;
    const metric = document.getElementById('webSpeedUnit').value === 'km/h';
    const distance = distanceMeters === null ? null : distanceMeters / (metric ? 1000 : 1609.344);
    const speed = topSpeedKph === null ? null : Math.round(topSpeedKph / (metric ? 1 : 1.609344));
    homeTripNodes.Distance.textContent = distance === null ? '—' : distance > 0 && distance < .1 ? '<' + homeTripNumber.format(.1) : homeTripNumber.format(distance);
    homeTripNodes.DistanceUnit.textContent = distance === null ? '' : metric ? 'km' : 'mi';
    homeTripNodes.Speed.textContent = speed === null ? '—' : homeTripNumber.format(speed);
    homeTripNodes.SpeedUnit.textContent = speed === null ? '' : metric ? 'km/h' : 'mph';
    homeTripNodes.Time.textContent = seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
      : seconds > 0 ? DriveTimeline.format(seconds) : '—';
    homeTripNodes.Count.textContent = homeTripNumber.format(detectedDrives.length);
    const kind = window.BVSourceManager.source?.kind;
    const sourceDescription = {car:'your BMW', usb:'your USB drive', drive:'Google Drive'}[kind] || 'your recording source';
    const drives = detectedDrives.length;
    homeLibraryTitle.textContent = kind === 'car' ? 'Your BMW recordings' : 'Your drive library';
    homeLibrarySubtitle.textContent =
      `${homeTripNumber.format(drives)} ${drives === 1 ? 'drive' : 'drives'} · ${homeTripNumber.format(recordings)} ${recordings === 1 ? 'recording' : 'recordings'} from ${sourceDescription}.`;
    homeTripNodes.Source.textContent = `${librarySourceName.textContent} · ${homeTripNumber.format(recordings)} ${recordings === 1 ? 'recording' : 'recordings'}`;
    const {date, startTime} = detectedDrives[0];
    document.getElementById('homeLatestDriveDate').textContent = [date, startTime].filter(Boolean).join(' · ');
  }

  // 5. Fetch USB Recordings & Group as Drives
  let libraryLoading=null, librarySignature=null;
  function recordedLocationStatus(drive) {
    if (drive.segments.some(({clip}) => clip.routeStatus === 'indexing')) return 'Reading recorded location…';
    if (drive.segments.some(({clip}) => clip.routeStatus === 'failed')) return 'Could not read recorded location';
    return 'Location not recorded';
  }
  async function loadLibrary({quiet=false,onlyChanged=false}={}) {
  const librarySource=window.BVSourceManager.source;
  if(libraryLoading===librarySource)return;
  libraryLoading=librarySource;
  const sourceName = librarySource.kind === 'usb' ? 'USB drive'
    : librarySource.kind === 'car' ? 'Connected BMW' : librarySource.name;
  librarySourceName.textContent = sourceName;
  if (!quiet && librarySignature === null) librarySummary.textContent = 'Reading your recordings…';
  try {
    const capabilities = await apiFetch('/api/v1/capabilities').then(r=>r.ok?r.json():{}).catch(()=>({}));
    if(window.BVSourceManager.source!==librarySource)return;
    player.nativeAvailable = BimmerVisionPlayer.useNativePreview(capabilities.nativePreview === true, window.isSecureContext, typeof VideoDecoder !== "undefined", new URLSearchParams(location.search).get("playback") === "native");
    await ensureCarSession();
    const res = await apiFetch("/api/v1/recordings");
    if (!res.ok) throw new Error("Could not reach car server API");
    const data = await res.json();
    if(window.BVSourceManager.source!==librarySource)return;
    if(quiet && !viewRecordings.classList.contains('active'))return;
    const rawClips = (data.recordings || []).filter(clip=>clip.complete===true);
    const signature=JSON.stringify(rawClips.map(c=>[c.id,c.locked,c.bytes,c.durationSeconds,c.routeStatus,(c.route||[]).length,c.endpoints,c.metrics]));
    if(onlyChanged && signature===librarySignature)return;
    librarySignature=signature;

    // Group recordings into continuous Drives
    detectedDrives = DriveGrouper.group(rawClips);updatePlaybackBackup();
    homeTripTotals = detectedDrives.length ? DriveGrouper.summarize(detectedDrives) : null;
    renderHomeTrips();
    driveListEl.innerHTML = "";

    if (detectedDrives.length === 0) {
      driveListEl.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--tesla-muted);">
          No recordings found in this source.
        </div>
      `;
      overviewSubtitle.textContent = "No recordings found.";
      librarySummary.textContent='0 drives · 0 recordings';
      selectedDrive=null;overviewPlayBtn.disabled=true;
      window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);
      showDriveOverview(false);
      return;
    }

    const [newestGroup, ...otherGroups] = DriveGrouper.groupByDate(detectedDrives);
    const [latestDrive, ...olderSameDay] = newestGroup.drives;
    const dateGroups = [
      {featured:true, drives:[latestDrive]},
      ...(olderSameDay.length ? [{...newestGroup, drives:olderSameDay}] : []),
      ...otherGroups
    ];
    const clipCount = rawClips.length;
    librarySummary.textContent = `${detectedDrives.length} drive${detectedDrives.length===1?'':'s'} · ${clipCount} recording${clipCount===1?'':'s'}`;
    if (librarySource.kind === 'drive') {
      const remaining = rawClips.filter(clip => clip.routeStatus === 'indexing').length;
      if (remaining) librarySummary.textContent += ` · Reading metadata (${clipCount - remaining}/${clipCount})`;
    }
    dateGroups.forEach(group => {
      const section = document.createElement('section');
      section.className = group.featured ? 'date-group latest-drive-group' : 'date-group older-drive-group';
      const heading = document.createElement('h2'); heading.className = 'date-group-header';
      heading.textContent = group.featured ? 'Latest drive' : `${group.dayOfWeek ? group.dayOfWeek + ', ' : ''}${group.dateLabel}`;
      section.appendChild(heading);
      group.drives.forEach(drive => {
        const card = document.createElement('article'); card.className = 'drive-card'; card.dataset.id = drive.id;
        const location = drive.endpoints.start.address;
        const isDriveLocked = drive.segments.length > 0 && drive.segments.every(s => s.clip.locked);
        const hasAnyLocked = drive.segments.some(s => s.clip.locked);
        const routePreview = group.featured ? driveRoutePreview(drive.route) : '';
        card.innerHTML = `
          <div class="drive-card-header">
            <h3 class="drive-departure">
              <button class="btn-view-entire-drive" type="button">
                ${driveIcon("clips")}
                <span>${group.featured ? escapeHtml(drive.date) + ' · ' : ''}${escapeHtml(drive.startTime || 'Recorded drive')}</span>
                <img src="assets/chevron.svg" width="16" height="16" alt="">
              </button>
            </h3>
            <p class="drive-route-summary">
              ${escapeHtml(location === 'Location unavailable' ? recordedLocationStatus(drive) : location)}
            </p>
          </div>
          ${routePreview}
          <div class="drive-card-meta">
            ${group.featured ? `
              <dl class="featured-drive-stats">
                <div><dt>Duration</dt><dd>${escapeHtml(drive.durationFormatted)}</dd></div>
                <div><dt>${drive.segments.length === 1 ? 'Recording' : 'Recordings'}</dt><dd>${drive.segments.length}</dd></div>
                <div><dt>Size</dt><dd>${escapeHtml(formatBytes(drive.bytes))}</dd></div>
              </dl>
            ` : `<p class="drive-description">${escapeHtml(drive.durationFormatted)} · ${drive.segments.length} ${drive.segments.length===1?'recording':'recordings'}</p>`}
            <div class="drive-card-tools">
              <details class="drive-manage"><summary>Manage</summary><div class="drive-manage-options">
              <button class="btn-lock-drive ${isDriveLocked ? 'is-locked' : ''}" type="button" title="${isDriveLocked ? 'Drive is locked. Click to unlock entire drive.' : 'Lock entire drive to prevent deletion'}" style="display:flex;align-items:center;background:rgba(255,255,255,0.06);border:1px solid ${isDriveLocked ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'};border-radius:6px;padding:5px 8px;cursor:pointer;color:${isDriveLocked ? '#f59e0b' : 'var(--tesla-muted)'};transition:all 0.2s ease;">
                ${getLockSvg(isDriveLocked, 14)} ${isDriveLocked ? "Unlock drive" : "Lock drive"}
              </button>
              <button class="btn-delete-drive" type="button" title="Delete entire drive" style="display:flex;align-items:center;background:rgba(238,36,64,0.1);border:1px solid rgba(238,36,64,0.3);border-radius:6px;padding:5px 8px;cursor:pointer;color:#EE2440;transition:all 0.2s ease;">
                ${getTrashSvg(14)} Delete drive
              </button>
</div></details>
              ${group.featured ? '' : `<span class="drive-storage">${escapeHtml(formatBytes(drive.bytes))}</span>`}
            </div>
          </div>
          <div class="drive-card-actions">
            <button class="drive-overview-action" type="button" aria-haspopup="dialog" aria-controls="driveOverviewSheet">
              ${driveIcon("clips")}<span>Drive Overview</span>
            </button>
            <button class="drive-play" type="button">${driveIcon("play")}<span>Play Drive</span></button>
          </div>
        `;
        card.querySelector('.drive-play').addEventListener('click', () => { selectDrive(drive,card); playClipInDrive(drive.segments[0].clip,true); });
        const openOverview = () => { selectDrive(drive,card); showDriveOverview(true); };
        card.querySelector('.btn-view-entire-drive').addEventListener('click', openOverview);
        card.querySelector('.drive-overview-action').addEventListener('click', openOverview);

        const lockDriveBtn = card.querySelector('.btn-lock-drive');
        if (lockDriveBtn) {
          lockDriveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if(!await allowUsbLock(librarySource))return;
            const target = !isDriveLocked;
            lockDriveBtn.disabled = true;
            for (const seg of drive.segments) {
              if(window.BVSourceManager.source!==librarySource)break;
              try {
                await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ locked: target })
                });
                seg.clip.locked = target;
              } catch (error) { alert('Could not save lock: '+error.message); break; }
            }
            await loadLibrary();
          });
        }

        const deleteDriveBtn = card.querySelector('.btn-delete-drive');
        if (deleteDriveBtn) {
          deleteDriveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (hasAnyLocked) {
              alert('This drive contains locked recordings. Please unlock the drive or recordings before deleting.');
              return;
            }
            if (!confirm(`Are you sure you want to delete this drive (${drive.segments.length} recordings)? This action cannot be undone.`)) {
              return;
            }
            deleteDriveBtn.disabled = true;
            for (const seg of drive.segments) {
              try {
                await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
              } catch (err) {
                alert(`Failed to delete recording: ${err.message}`);
                break;
              }
            }
            await loadLibrary();
          });
        }

        section.appendChild(card);
      });
      if (!group.featured && !driveListEl.querySelector('.library-older-title')) {
        const olderTitle = document.createElement('h2');
        olderTitle.className = 'library-older-title';
        olderTitle.textContent = 'Earlier drives';
        driveListEl.appendChild(olderTitle);
      }
      driveListEl.appendChild(section);
    });
    if(selectedDrive){const refreshed=detectedDrives.find(d=>d.id===selectedDrive.id);if(refreshed)selectDrive(refreshed,[...document.querySelectorAll(".drive-card")].find(card=>card.dataset.id===refreshed.id));else {selectedDrive=null;showDriveOverview(false);window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);}}
    if(activeDrive){const refreshed=detectedDrives.find(d=>d.id===activeDrive.id);if(refreshed){activeDrive=refreshed;timeline.setDrive(refreshed);timeline.update(activeClip?.id,player.currentTime);recordingNavigation.update();}}
  } catch (err) {
    if(quiet || window.BVSourceManager.source !== librarySource)return;
    librarySummary.textContent = "Could not load recordings";
    console.error("Failed to load recordings:", err);
    driveListEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--m-red);">
        Could not load your drives. ${escapeHtml(err.message)}
      </div>
    `;
  } finally {if(libraryLoading===librarySource)libraryLoading=null;}
  }
  window.BVSourceManager.subscribe(()=>{
    loadToken++;player.cancelLoad();hideLoadingModal();
    activeClip=null;activeDrive=null;selectedDrive=null;detectedDrives=[];librarySignature=null;updatePlaybackBackup();
    homeTripTotals=null;renderHomeTrips();
    window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);
    recordingNavigation.update(false);
    document.getElementById('exportModal').classList.remove('open');document.getElementById('identifyModal').classList.remove('open');
    showDriveOverview(false);switchTab('recordings');loadLibrary();checkForUpdates(true);
  });
  window.addEventListener('bimmervision:library-updated',()=>loadLibrary({quiet:true,onlyChanged:true}));
  await loadLibrary();
  startCatalogRefresh(window,()=>!document.hidden && viewRecordings.classList.contains('active') && !document.querySelector('.modal-backdrop.open') && videoLoadingModal.style.display!=='flex',()=>loadLibrary({quiet:true,onlyChanged:true}));


  function selectDrive(drive, cardEl) {
    document.querySelectorAll(".drive-card.active").forEach((card) => {
      card.classList.remove("active");
      card.querySelector('.btn-view-entire-drive').removeAttribute('aria-current');
    });
    if (cardEl) {
      cardEl.classList.add("active");
      cardEl.querySelector('.btn-view-entire-drive').setAttribute('aria-current', 'true');
    }

    selectedDrive = drive;
    window.BVRecordingBackupAction.update(overviewBackupBtn,drive,window.BVSourceManager.source?.kind);
    overviewPlayBtn.disabled=false;

    const isDriveLocked = drive.segments.length > 0 && drive.segments.every(s => s.clip.locked);
    const overviewLockBtn = document.getElementById('overviewLockBtn');
    const overviewLockIcon = document.getElementById('overviewLockIcon');
    const overviewLockLabel = document.getElementById('overviewLockLabel');
    const overviewDeleteBtn = document.getElementById('overviewDeleteBtn');
    if (overviewLockBtn) {
      overviewLockBtn.disabled = false;
      if (overviewLockLabel) overviewLockLabel.textContent = isDriveLocked ? 'Unlock drive' : 'Lock drive';
      if (overviewLockIcon) overviewLockIcon.innerHTML = getLockSvg(isDriveLocked, 15);
    }
    if (overviewDeleteBtn) {
      overviewDeleteBtn.disabled = false;
    }

    // Populate Overview
    overviewTitle.textContent = [drive.date, drive.startTime].filter(Boolean).join(" · ") || "Recorded drive";
    overviewSubtitle.textContent = `${drive.segments.length} ${drive.segments.length === 1 ? "recording" : "recordings"} · ${formatBytes(drive.bytes)}`;

    const locationStatus = recordedLocationStatus(drive);
    endpointStartAddr.textContent = drive.endpoints.start.address === 'Location unavailable' ? locationStatus : drive.endpoints.start.address;
    endpointStartTime.textContent = drive.endpoints.start.time ? drive.endpoints.start.time : drive.endpoints.start.coords;

    endpointEndAddr.textContent = drive.endpoints.end.address === 'Location unavailable' ? locationStatus : drive.endpoints.end.address;
    endpointEndTime.textContent = drive.endpoints.end.time ? drive.endpoints.end.time : drive.endpoints.end.coords;

    // Update Overview Map
    overviewMap.emptyMessage = locationStatus;
    overviewMap.setTrack(drive.route);

    // Update Live Tracking Map track
    if (!activeDrive) playbackMap.setTrack(drive.route);

    // Update Metrics
    updateMetricsDisplay(drive);

    // List segments
    driveSegmentsList.innerHTML = "";
    drive.segments.forEach((seg, sIdx) => {
      const item = document.createElement("div");
      item.className = "overview-clip";
      const duration = seg.clip.durationSeconds;
      const timing = Number.isFinite(duration)
        ? `${DriveTimeline.format(seg.offset)} into drive · ${DriveTimeline.format(Math.round(duration))} long`
        : `${DriveTimeline.format(seg.offset)} into drive`;
      const lockLabel = seg.clip.locked ? 'Unlock' : 'Lock';

      item.innerHTML = `
        <button class="overview-clip-play" type="button" aria-label="Play clip ${sIdx+1}, ${timing}">
          <span class="overview-clip-play-icon">${driveIcon("play")}</span>
          <span class="overview-clip-copy"><strong>Clip ${sIdx+1}</strong><small>${timing}</small></span>
          <img src="assets/chevron.svg" width="16" height="16" alt="">
        </button>
        <div class="overview-clip-actions">
          ${['usb','car'].includes(window.BVSourceManager.source.kind)?`<button type="button" data-backup-recording="${escapeHtml(seg.clip.id)}" aria-label="Back up clip ${sIdx+1}" title="Send to Remote Backup">${driveIcon("backup")}Back up</button>`:''}
          <a href="#" data-raw-recording="${escapeHtml(seg.clip.id)}" download aria-label="Download original Clip ${sIdx+1} and metadata as ZIP">${driveIcon("download")}Original ZIP</a>
          <button class="btn-lock-clip" type="button" aria-label="${lockLabel} clip ${sIdx+1}">${getLockSvg(seg.clip.locked,18)}${lockLabel}</button>
          <button class="btn-delete-clip" type="button" aria-label="Delete clip ${sIdx+1}">${getTrashSvg(18)}Delete</button>
        </div>
      `;

      item.querySelector('.overview-clip-play').addEventListener("click", () => {
        playClipInDrive(seg.clip);
      });

      const lockClipBtn = item.querySelector('.btn-lock-clip');
      lockClipBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if(!await allowUsbLock(window.BVSourceManager.source))return;
            const target = !seg.clip.locked;
        lockClipBtn.disabled = true;
        try {
          await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked: target })
          });
          seg.clip.locked = target;
          await loadLibrary();
        } catch (err) {
          alert('Could not update lock status.');
          lockClipBtn.disabled = false;
        }
      });

      const delClipBtn = item.querySelector('.btn-delete-clip');
      delClipBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (seg.clip.locked) {
          alert('This recording is locked. You must first unlock the recording before it can be deleted.');
          return;
        }
        if (!confirm(`Are you sure you want to delete Clip ${sIdx + 1}? This action cannot be undone.`)) return;
        delClipBtn.disabled = true;
        try {
          const res = await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Failed to delete recording.');
            delClipBtn.disabled = false;
            return;
          }
          await loadLibrary();
        } catch (err) {
          alert(`Failed to delete: ${err.message}`);
          delClipBtn.disabled = false;
        }
      });

      driveSegmentsList.appendChild(item);
    });
  }

  function updateMetricsDisplay(drive) {
    if (!drive) return;
    const isMph = player.speedUnit === "mph";
    metricDistance.textContent = drive.metrics.distanceKm == null ? "—" : (isMph ? `${drive.metrics.distanceMiles} mi` : `${drive.metrics.distanceKm} km`);
    metricDuration.textContent = drive.durationFormatted;
    metricTopSpeed.textContent = drive.metrics.topSpeedKph == null ? "—" : isMph ? `${drive.metrics.topSpeedMph} MPH` : `${drive.metrics.topSpeedKph} KM/H`;
    metricAvgSpeed.textContent = drive.metrics.avgSpeedKph == null ? "—" : isMph ? `${drive.metrics.avgSpeedMph} MPH` : `${drive.metrics.avgSpeedKph} KM/H`;
    metricMaxSteering.textContent = drive.metrics.maxSteeringDeg == null ? "—" : `${drive.metrics.maxSteeringDeg}°`;
    metricBrakeEvents.textContent = drive.metrics.brakeEvents == null ? "—" : `${drive.metrics.brakeEvents}`;
  }

  // Play Drive button: Jump to playback and play from start
  document.getElementById('overviewClipsBtn').addEventListener('click', () => {
    const heading = overviewSheet.querySelector('.segments-header');
    heading.focus({preventScroll:true});
    heading.scrollIntoView({block:'start',behavior:'instant'});
  });
  overviewPlayBtn.addEventListener("click", () => {
    if (selectedDrive && selectedDrive.segments.length > 0) {
      playClipInDrive(selectedDrive.segments[0].clip, true);
    }
  });

  const overviewLockBtn = document.getElementById('overviewLockBtn');
  const overviewDeleteBtn = document.getElementById('overviewDeleteBtn');

  if (overviewLockBtn) {
    overviewLockBtn.addEventListener('click', async () => {
      if (!selectedDrive || !selectedDrive.segments.length) return;
      const drive=selectedDrive,source=window.BVSourceManager.source;
      if(!await allowUsbLock(source) || window.BVSourceManager.source!==source)return;
      const isDriveLocked = drive.segments.every(s => s.clip.locked);
      const target = !isDriveLocked;
      overviewLockBtn.disabled = true;
      for (const seg of drive.segments) {
        if(window.BVSourceManager.source!==source)break;
        try {
          await apiFetch(`/api/v1/recordings/${seg.clip.id}/lock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locked: target })
          });
          seg.clip.locked = target;
        } catch (error) { alert('Could not save lock: '+error.message); break; }
      }
      await loadLibrary();
    });
  }

  if (overviewDeleteBtn) {
    overviewDeleteBtn.addEventListener('click', async () => {
      if (!selectedDrive || !selectedDrive.segments.length) return;
      if (selectedDrive.segments.some(s => s.clip.locked)) {
        alert('This drive contains locked recordings. Please unlock the drive or recordings before deleting.');
        return;
      }
      if (!confirm(`Are you sure you want to delete this drive (${selectedDrive.segments.length} recordings)? This action cannot be undone.`)) return;
      overviewDeleteBtn.disabled = true;
      for (const seg of selectedDrive.segments) {
        try {
          await apiFetch(`/api/v1/recordings/${seg.clip.id}`, { method: 'DELETE' });
        } catch (err) {
          alert(`Failed to delete recording: ${err.message}`);
          break;
        }
      }
      showDriveOverview(false);
      selectedDrive = null;
      window.BVRecordingBackupAction.update(overviewBackupBtn,null,window.BVSourceManager.source?.kind);
      await loadLibrary();
    });
  }

  function updatePlaybackBackup() {
    const button = document.getElementById('backupPlaybackBtn');
    const kind = window.BVSourceManager.source?.kind;
    const eligible = ['car','usb'].includes(kind) && activeClip?.complete === true &&
      typeof activeClip.id === 'string' &&
      detectedDrives.some(drive => drive.segments.some(segment => segment.clip.id === activeClip.id));
    button.disabled = !eligible;
    if (eligible) button.dataset.currentRecording = activeClip.id;
    else delete button.dataset.currentRecording;
    document.getElementById('backupPlaybackDetail').textContent =
      kind === 'drive' ? 'Already in Google Drive' : 'Save to Google Drive';
  }

  // Settings Modal Event Listeners
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const dismissSettingsBtn = document.getElementById('dismissSettingsBtn');

  if (librarySettingsButton && settingsModal) {
    librarySettingsButton.addEventListener('click', () => {
      settingsModal.classList.add('open');
      closeSettingsBtn?.focus();
    });
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
      librarySettingsButton?.focus();
    });
  }
  if (dismissSettingsBtn && settingsModal) {
    dismissSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
      librarySettingsButton?.focus();
    });
  }
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('open');
    });
  }

  async function playClipInDrive(clip, autoPlay = true, startAt = 0) {
    showDriveOverview(false);
    const token = ++loadToken;
    player.cancelLoad();
    lastOpen={clip,autoPlay,startAt};
    const drive=detectedDrives.find(d=>d.segments.some(s=>s.clip.id===clip.id));
    activeDrive=drive||null;
    if(drive)timeline.setDrive(drive);
    activeClip=clip;
    window.BVRecordingCache?.setWindow(drive,clip.id,{native:player.nativeAvailable});
    recordingNavigation.update(true);
    updatePlaybackBackup();
    document.getElementById('playbackTitle').textContent = drive ? `${drive.date} · ${drive.startTime}` : 'Drive playback';
    document.getElementById('playbackClipLabel').textContent = `Recording ${(drive?.segments.findIndex(s=>s.clip.id===clip.id) ?? 0)+1} of ${drive?.segments.length||1}`;
    document.getElementById('dockRecordingLabel').textContent=document.getElementById('playbackClipLabel').textContent;
    document.getElementById('loadingRetryBtn').hidden=true;
    document.getElementById('playbackRetryBtn').hidden=true;
    document.getElementById('loadingProgress').textContent='';
    videoLoadingModal.classList.remove('has-error');
    showLoadingModal('Preparing your recording','Reading video and synchronizing telemetry…');
    switchTab('playback');
    await paintLoading();
    if(token!==loadToken)return;
    const base=`/api/v1/recordings/${encodeURIComponent(clip.id)}`;
    try {
      await player.loadClip(`${base}/manifest.json`,`${base}/capture.bvr`, clip.id);
      if(token!==loadToken)return;
      const savedMapping=await cameraStore.load(clip.id);
      if(token!==loadToken)return;
      if(savedMapping){player.saveCameraMapping(savedMapping,clip.id);sessionConfirmedClips.add(clip.id);}
      await player.seekAndWait(startAt);
      if(token!==loadToken)return;
      await paintLoading();
      if(token!==loadToken)return;
      hideLoadingModal();
      window.BVRecordingCache?.start();

      if (!isClipIdentified(clip.id) && player.requiresCameraMappingAt(startAt)) {
        openIdentifyModal({
          clip,
          drive,
          isFirstTime: true,
          onComplete: () => {
            if (autoPlay) player.play({restartAtEnd:false});
          }
        });
      } else {
        if(autoPlay)await player.play({restartAtEnd:false});
      }
    } catch(error) {
      if(token!==loadToken || error.name==='AbortError')return;
      player.cancelLoad();
      videoLoadingModal.classList.add('has-error');
      document.getElementById('loadingRetryBtn').hidden=false;
      showLoadingModal('Could not open recording',error.message);
    }
  }

  const saveSheet = document.getElementById('playbackSaveSheet');
  document.getElementById('playbackSaveBtn').addEventListener('click', () => {
    document.getElementById('savePlaybackRawBtn').disabled = !activeClip?.id;
    saveSheet.showModal();
  });
  document.getElementById('closePlaybackSave').addEventListener('click', () => saveSheet.close());
  saveSheet.addEventListener('click', event => {
    if (event.target === saveSheet) saveSheet.close();
  });
  document.getElementById('savePlaybackRawBtn').addEventListener('click', () => {
    saveSheet.close();
    if (activeClip?.id) downloadRaw(activeClip.id);
  });
  window.BVSourceManager.subscribe(() => { if (saveSheet.open) saveSheet.close(); });
  document.getElementById('backupPlaybackBtn').addEventListener('click',event=>{saveSheet.close();const id=event.currentTarget.dataset.currentRecording;if(!id)return;try{Promise.resolve(window.BVBackupActions.openRecording(id)).catch(error=>alert(error.message));}catch(error){alert(error.message);}});

  // 6. Transport Controls
  hudElements.playBtn.addEventListener("click", () => player.togglePlay());

  hudElements.scrubber.addEventListener("input", (e) => {
    player.seek(parseFloat(e.target.value));
  });

  // 7. Speed Unit Management (MPH <-> KM/H)
  const unitBtnMph = document.getElementById("unitBtnMph");
  const unitBtnKph = document.getElementById("unitBtnKph");

  function setSpeedUnit(unit) {
    const nextUnit = unit === "km/h" ? "km/h" : "mph";
    player.setSpeedUnit(nextUnit);
    timeline.speedUnit = nextUnit;
    timeline.draw();
    const webSpeedUnit = document.getElementById('webSpeedUnit');
    if (webSpeedUnit) webSpeedUnit.value = nextUnit;
    renderHomeTrips();
    try {
      localStorage.setItem("bimmervision_speed_unit", nextUnit);
    } catch (_) {}

    if (unitBtnMph && unitBtnKph) {
      if (nextUnit === "mph") {
        unitBtnMph.classList.add("active");
        unitBtnMph.style.background = "var(--m-blue)";
        unitBtnMph.style.color = "#fff";
        unitBtnKph.classList.remove("active");
        unitBtnKph.style.background = "transparent";
        unitBtnKph.style.color = "var(--tesla-muted)";
      } else {
        unitBtnKph.classList.add("active");
        unitBtnKph.style.background = "var(--m-blue)";
        unitBtnKph.style.color = "#fff";
        unitBtnMph.classList.remove("active");
        unitBtnMph.style.background = "transparent";
        unitBtnMph.style.color = "var(--tesla-muted)";
      }
    }

    const exportUnitSelect = document.getElementById("exportUnitSelect");
    if (exportUnitSelect) exportUnitSelect.value = nextUnit;
    if (selectedDrive) updateMetricsDisplay(selectedDrive);
  }

  function toggleSpeedUnit() {
    setSpeedUnit(player.speedUnit === "mph" ? "km/h" : "mph");
  }

  window.addEventListener('bimmervision:speed-unit', event => setSpeedUnit(event.detail));

  const speedToggleEl = document.getElementById("speedToggle");
  if (speedToggleEl) speedToggleEl.addEventListener("click", toggleSpeedUnit);
  if (unitBtnMph) unitBtnMph.addEventListener("click", () => setSpeedUnit("mph"));
  if (unitBtnKph) unitBtnKph.addEventListener("click", () => setSpeedUnit("km/h"));

  try {
    const savedUnit = localStorage.getItem("bimmervision_speed_unit");
    if (savedUnit) setSpeedUnit(savedUnit);
  } catch (_) {}

  // 8. Desktop Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if (document.querySelector(".modal-backdrop.open, .dashboard-sheet[open]") || videoLoadingModal.style.display === "flex") return;
    if (e.defaultPrevented || e.target.closest?.('input,select,textarea,button,a,summary,[contenteditable="true"]')) return;

    if (e.code === "Space") {
      e.preventDefault();
      player.togglePlay();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      player.step(-1);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      player.step(1);
    } else if (e.key === "1") {
      player.setViewMode("quad");
    } else if (e.key === "2") {
      player.setViewMode("source");
    } else if (e.key === "3") {
      player.setViewMode("front");
    } else if (e.key === "4") {
      player.setViewMode("rear");
    } else if (e.key === "5") {
      player.setViewMode("left");
    } else if (e.key === "6") {
      player.setViewMode("right");
    }
  });

  // 10. Export Modal Controller
  const exportModal = document.getElementById("exportModal");
  const openExportBtn = document.getElementById("openExportBtn");
  const closeExportBtn = document.getElementById("closeExportBtn");
  const startExportBtn = document.getElementById("startExportAction");
  const exportProgress = document.getElementById("exportProgress");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressText = document.getElementById("progressText");

  function getExportOverlays() {
    return {
      blinkers: document.getElementById("exportToggleBlinkers") ? document.getElementById("exportToggleBlinkers").checked : true,
      speed: document.getElementById("exportToggleSpeed") ? document.getElementById("exportToggleSpeed").checked : true,
      speedLimit: document.getElementById("exportToggleSpeedLimit") ? document.getElementById("exportToggleSpeedLimit").checked : true,
      steering: document.getElementById("exportToggleSteering") ? document.getElementById("exportToggleSteering").checked : true,
      brake: document.getElementById("exportToggleBrake") ? document.getElementById("exportToggleBrake").checked : true,
      gas: document.getElementById("exportToggleGas") ? document.getElementById("exportToggleGas").checked : true,
      time: document.getElementById("exportToggleTime") ? document.getElementById("exportToggleTime").checked : true,
      drivingView: document.getElementById("exportToggleDriving").checked && !document.getElementById("exportToggleDriving").disabled,
      map: document.getElementById("exportToggleMap") ? document.getElementById("exportToggleMap").checked : true,
    };
  }

  let exportDrivingPreview=null,exportPreviewEpoch=0,exportInProgress=false;
  function releaseExportDrivingPreview(){++exportPreviewEpoch;exportDrivingPreview?.dispose();exportDrivingPreview=null;}
  new MutationObserver(()=>{if(!exportModal.classList.contains('open'))releaseExportDrivingPreview();}).observe(exportModal,{attributes:true,attributeFilter:['class']});

  function selectedExportView() {
    if (exportCameraSelect.value !== 'custom') return exportCameraSelect.value;
    const cameras = Array.from(exportCameraChoices.querySelectorAll('input:checked'), input => input.value);
    return cameras.length === 1 ? cameras[0] : cameras.length === 4 ? 'quad' : cameras;
  }

  async function updateExportPreview() {
    const previewToken=++exportPreviewEpoch,recordingEpoch=player._clipEpoch;

    const previewCanvas = document.getElementById("exportPreviewCanvas");
    if (!previewCanvas) return;
    const view = selectedExportView();
    exportCameraChoices.hidden = exportCameraSelect.value !== 'custom';
    if (Array.isArray(view) && view.length === 0) {
      startExportBtn.disabled = true;
      document.getElementById('exportDrivingNote').textContent = 'Select at least one camera to export.';
      const context = previewCanvas.getContext('2d');
      context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      return;
    }
    const speedUnit = document.getElementById("exportUnitSelect") ? document.getElementById("exportUnitSelect").value : (player.speedUnit || "mph");
    const overlays = getExportOverlays();

    const midInfo = {
      fr:player.lastFrFrame,lr:player.lastLrFrame,time:player.currentTime||0,
      telemetry:player.parser?.getTelemetryAtTime(player.currentTime||0,player.manifest?.startMonotonicUs)
    };

    const tsEl = document.getElementById("exportPreviewTimestamp");
    if (tsEl && midInfo.time != null) {
      const mins = Math.floor(midInfo.time / 60);
      const secs = (midInfo.time % 60).toFixed(2).padStart(5, "0");
      tsEl.textContent = `${String(mins).padStart(2, "0")}:${secs}`;
    }

    const note=document.getElementById('exportDrivingNote');
    if(overlays.drivingView) {
      startExportBtn.disabled=true;
      if(!exportDrivingPreview) {
        note.textContent='Preparing Driving view preview…';
        try {
          const prepared=await player.drivingView.createExportRenderer();
          if(previewToken!==exportPreviewEpoch||recordingEpoch!==player._clipEpoch||!exportModal.classList.contains('open')){prepared.dispose();return;}
          exportDrivingPreview=prepared;
        } catch(error) {if(previewToken===exportPreviewEpoch){note.textContent=error.message;startExportBtn.disabled=true;}return;}
      }
      note.textContent=overlays.map?'Export sidebar: route map on top, Driving view below. Distances in feet.':'Export sidebar: Driving view. Distances in feet.';
      startExportBtn.disabled=exportInProgress;
    } else {
      exportDrivingPreview?.dispose();exportDrivingPreview=null;
      note.textContent=document.getElementById('exportToggleDriving').disabled?'This recording has no supported Driving view metadata available.':'Optional: add Driving view below the route map.';
      startExportBtn.disabled=exportInProgress;
    }

    if(overlays.map&&player.liveMap?.prepareForExport) {
      const sidebarNote=note.textContent;startExportBtn.disabled=true;note.textContent='Preparing map for preview…';
      try {
        await player.liveMap.prepareForExport(midInfo.time,640,overlays.drivingView?480:960,{check:()=>{if(previewToken!==exportPreviewEpoch||recordingEpoch!==player._clipEpoch||!exportModal.classList.contains('open'))throw new Error('Preview changed');}});
      } catch(error) {if(previewToken===exportPreviewEpoch)note.textContent=error.message;return;}
      if(previewToken!==exportPreviewEpoch||recordingEpoch!==player._clipEpoch)return;
      note.textContent=sidebarNote;startExportBtn.disabled=exportInProgress;
    }

    try {exporter.renderPreview(previewCanvas, {
      view: view,
      overlays: overlays,
      speedUnit: speedUnit,
      time: midInfo.time,
      fr: midInfo.fr,
      lr: midInfo.lr,
      telemetry: midInfo.telemetry,
      mapping: player.cameraMapping,
      manifest: player.manifest,
      map: player.liveMap,
      drivingView: exportDrivingPreview
    });} catch(error){exportDrivingPreview?.dispose();exportDrivingPreview=null;note.textContent=error.message;startExportBtn.disabled=true;}
  }

  const overlayCheckboxIds = [
    "exportToggleBlinkers",
    "exportToggleSpeed",
    "exportToggleSpeedLimit",
    "exportToggleSteering",
    "exportToggleBrake",
    "exportToggleGas",
    "exportToggleTime",
    "exportToggleMap",
    "exportToggleDriving"
  ];

  overlayCheckboxIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateExportPreview);
  });

  const exportCameraSelect = document.getElementById("exportCameraSelect");
  const exportCameraChoices = document.getElementById("exportCameraChoices");
  exportCameraSelect.addEventListener("change", updateExportPreview);
  exportCameraChoices.addEventListener("change", updateExportPreview);

  const exportUnitSelect = document.getElementById("exportUnitSelect");
  if (exportUnitSelect) exportUnitSelect.addEventListener("change", updateExportPreview);

  const selectAllOverlaysBtn = document.getElementById("exportSelectAllOverlays");
  if (selectAllOverlaysBtn) {
    selectAllOverlaysBtn.addEventListener("click", () => {
      overlayCheckboxIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.disabled) el.checked = true;
      });
      updateExportPreview();
    });
  }

  const clearAllOverlaysBtn = document.getElementById("exportClearAllOverlays");
  if (clearAllOverlaysBtn) {
    clearAllOverlaysBtn.addEventListener("click", () => {
      overlayCheckboxIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      updateExportPreview();
    });
  }

  const saveExportLink = document.getElementById("downloadExportLink");
  let completedExportClip = null;
  function releaseCompletedExport() {
    if (window.lastExportUrl) URL.revokeObjectURL(window.lastExportUrl);
    window.lastExportUrl = null;
    completedExportClip = null;
    saveExportLink.onclick = null;
    saveExportLink.removeAttribute("href");
    saveExportLink.style.display = "none";
  }
  openExportBtn.addEventListener("click", () => {
    saveSheet.close();
    player.pause();
    exportCameraSelect.value = ["quad", "source", "front", "rear", "left", "right"].includes(player.viewMode) ? player.viewMode : "quad";
    exportModal.classList.add("open");
    const native = !!player._nativeVideo;
    const hasEncoder = (typeof VideoEncoder !== "undefined" && typeof Mp4Muxer !== "undefined") || typeof MediaRecorder !== "undefined";
    const nativeLink = document.getElementById('nativeDownloadLink');
    if (nativeLink) {
      nativeLink.style.display = native ? "inline-block" : "none";
      nativeLink.href = (native && player.nativeInfo) ? player.nativeInfo.downloadUrl : '#';
    }
    const rawLink=document.getElementById('rawRecordingDownloadLink');
    const rawId=player.activeClipId || player.manifest?.id;
    if(rawLink){rawLink.hidden=!rawId;rawLink.href='#';rawLink.dataset.rawRecording=rawId||'';}
    const nativeNote = document.getElementById('nativeExportNote');
    if (nativeNote) nativeNote.hidden = !native;

    document.getElementById('customExportOptions').hidden = false;
    exportProgress.style.display = "none";
    startExportBtn.disabled = false;
    startExportBtn.style.display = "flex";
    if (completedExportClip !== player.manifest) releaseCompletedExport();
    if (exportInProgress || window.lastExportUrl) exportProgress.style.display = "flex";

    const drivingToggle=document.getElementById('exportToggleDriving');
    drivingToggle.disabled=!player.drivingView?.data?.frames?.some(f=>f.o.length||f.b.length);
    if(drivingToggle.disabled)drivingToggle.checked=false;
    updateExportPreview();
  });

  closeExportBtn.addEventListener("click", () => {
    exportModal.classList.remove("open");
  });

  exportModal.addEventListener("click", (e) => {
    if (e.target === exportModal) exportModal.classList.remove("open");
  });

  startExportBtn.addEventListener("click", async (e) => {
    const cameraAngle = selectedExportView();
    if(exportInProgress || (Array.isArray(cameraAngle) && cameraAngle.length === 0))return;
    releaseCompletedExport();
    const exportingClip = player.manifest;
    exportInProgress=true;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    startExportBtn.disabled = true;
    exportProgress.style.display = "flex";
    progressBarFill.style.width = "5%";
    progressText.textContent = "Initializing hardware encoder...";

    const overlays = getExportOverlays();
    const speedUnit = document.getElementById("exportUnitSelect").value;
    const durationOpt = document.getElementById("exportDurationSelect") ? document.getElementById("exportDurationSelect").value : "full";

    try {
      const result = await exporter.export({
        view: cameraAngle,
        overlays: overlays,
        speedUnit: speedUnit,
        duration: durationOpt,
        onProgress: (frac, status) => {
          progressBarFill.style.width = `${Math.round(frac * 100)}%`;
          progressText.textContent = status;
        }
      });

      if (!result.blob?.size) throw new Error("The encoder produced an empty video.");
      const file = new File([result.blob], result.fileName, {type:result.blob.type});
      const save = saveExportLink;
      completedExportClip = exportingClip;
      window.lastExportUrl = URL.createObjectURL(file);
      save.href = window.lastExportUrl;
      save.download = file.name;
      save.textContent = "Save video";
      save.style.display = "block";
      save.onclick = async event => {
        if (!navigator.canShare?.({files:[file]})) return;
        event.preventDefault();
        try {
          await navigator.share({files:[file]});
        } catch (error) {
          if (error.name === "AbortError") return;
          save.onclick = null;
          save.textContent = "Download video";
          progressText.textContent = "Sharing is unavailable. Tap Download video to save your export.";
        }
      };
      progressBarFill.style.width = "100%";
      progressText.textContent = `Ready to save · ${(file.size / 1048576).toFixed(1)} MB`;
      startExportBtn.style.display = "none";
      save.focus();
    } catch (err) {
      console.error("Export failed:", err);
      progressText.textContent = "Export error: " + (err.message || String(err));
      alert("Export failed: " + (err.message || String(err)));
      startExportBtn.disabled = false;
    } finally {exportInProgress=false;}
  });

  // 11. Camera Identity Modal Controller (Matches Mac/Windows Desktop Alignment)
  const identifyModal = document.getElementById("identifyModal");
  const closeIdentifyBtn = document.getElementById("closeIdentifyBtn");
  const doneIdentifyBtn = document.getElementById("doneIdentifyBtn");
  const resetIdentifyBtn = document.getElementById("resetIdentifyBtn");
  const assignFrontRearBtn = document.getElementById("assignFrontRearBtn");
  const assignLeftRightBtn = document.getElementById("assignLeftRightBtn");
  const toggleFlipHalvesBtn = document.getElementById("toggleFlipHalvesBtn");
  const toggleInvertPhaseBtn = document.getElementById("toggleInvertPhaseBtn");
  const identifyCanvas = document.getElementById("identifyCanvas");
  const identifyInfoPill = document.getElementById("identifyInfoPill");
  const identifyLeftLabel = document.getElementById("identifyLeftLabel");
  const identifyRightLabel = document.getElementById("identifyRightLabel");
  const identifyPromptBadge = document.getElementById("identifyPromptBadge");
  const identifyModalDesc = document.getElementById("identifyModalDesc");

  let onIdentifyComplete = null;
  let identifyInspectPhase = 0;

  const sessionConfirmedClips = new Set();

  function isClipIdentified(clipId) {
    if (!clipId) return false;
    return sessionConfirmedClips.has(clipId);
  }

  let continueLocally=false, savingIdentity=false, localFallbackMapping=null;
  async function markClipIdentified(clipId) {
    await cameraStore.save(clipId,player.cameraMapping);
    sessionConfirmedClips.add(clipId);
  }

  function openIdentifyModal(options = {}) {
    player.pause();
    continueLocally=false;
    document.getElementById('identifySaveStatus').textContent='';
    onIdentifyComplete = options.onComplete || null;
    identifyInspectPhase = 0;
    const isFirstTime = !!options.isFirstTime;

    if (identifyPromptBadge) {
      identifyPromptBadge.style.display = isFirstTime ? "inline-block" : "none";
    }
    if (identifyModalDesc) {
      identifyModalDesc.innerHTML = isFirstTime
        ? "<strong>Camera Alignment Required:</strong> Please select Front/Rear and Left/Right camera assignments for this recording to ensure cockpit views and exports are correctly oriented."
        : "Name the side-by-side camera pair for this source frame to ensure views and exports are correctly oriented:";
    }
    if (doneIdentifyBtn) {
      doneIdentifyBtn.textContent = isFirstTime ? "Confirm & Play" : "Apply & Done";
    }

    identifyModal.classList.add("open");
    renderIdentifyFrame();
    updateIdentifyUi();
  }

  function renderIdentifyFrame() {
    const raw = player.getCurrentRawFrame(identifyInspectPhase);
    if (!raw || !raw.bitmap) return;

    const idCtx = identifyCanvas.getContext("2d");
    idCtx.drawImage(raw.bitmap, 0, 0, 1280, 480);

    // Draw central split indicator line
    idCtx.strokeStyle = "rgba(61, 168, 242, 0.75)";
    idCtx.lineWidth = 3;
    idCtx.beginPath();
    idCtx.moveTo(640, 0);
    idCtx.lineTo(640, 480);
    idCtx.stroke();
  }

  function updateIdentifyUi() {
    const raw = player.getCurrentRawFrame(identifyInspectPhase);
    const map = player.cameraMapping || { phase0: "frontRear", phase1: "leftRight", flipHalves: false };

    const isP0 = (identifyInspectPhase === 0);
    const currentPair = isP0 ? map.phase0 : map.phase1;
    const pairName = currentPair === "frontRear" ? "Front / Rear" : "Left / Right";

    const ssrc = raw ? raw.ssrc : "—";
    const rtp = raw ? raw.rtpTimestamp : "—";
    const auIdx = raw ? raw.auIndex : (isP0 ? "0" : "1");

    identifyInfoPill.innerHTML = `
      <strong>Source Frame #${auIdx}</strong> · SSRC ${ssrc} · RTP ${rtp}<br>
      Stream Phase: <strong>${isP0 ? "Phase 0 (Even)" : "Phase 1 (Odd)"}</strong> · Assigned: <span style="color:var(--m-blue);font-weight:700;">${pairName}</span> · Halves: ${map.flipHalves ? "Swapped" : "Standard"} <span style="opacity:0.6;font-size:10px;">(Tap to view alternate pair)</span>
    `;

    // Dynamic labels above halves
    if (currentPair === "frontRear") {
      identifyLeftLabel.textContent = map.flipHalves ? "REAR (640×480)" : "FRONT (640×480)";
      identifyRightLabel.textContent = map.flipHalves ? "FRONT (640×480)" : "REAR (640×480)";
    } else {
      identifyLeftLabel.textContent = map.flipHalves ? "RIGHT (640×480)" : "LEFT (640×480)";
      identifyRightLabel.textContent = map.flipHalves ? "LEFT (640×480)" : "RIGHT (640×480)";
    }

    // Toggle active highlights on action buttons
    assignFrontRearBtn.classList.toggle("active-mapping", currentPair === "frontRear");
    assignLeftRightBtn.classList.toggle("active-mapping", currentPair === "leftRight");
    toggleFlipHalvesBtn.classList.toggle("active-mapping", !!map.flipHalves);
    toggleInvertPhaseBtn.classList.remove("active-mapping");
  }

  identifyInfoPill.style.cursor = "pointer";
  identifyInfoPill.addEventListener("click", () => {
    identifyInspectPhase = 1 - identifyInspectPhase;
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  assignFrontRearBtn.addEventListener("click", () => {
    const isP0 = (identifyInspectPhase === 0);
    player.saveCameraMapping({
      phase0: isP0 ? "frontRear" : "leftRight",
      phase1: isP0 ? "leftRight" : "frontRear"
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  assignLeftRightBtn.addEventListener("click", () => {
    const isP0 = (identifyInspectPhase === 0);
    player.saveCameraMapping({
      phase0: isP0 ? "leftRight" : "frontRear",
      phase1: isP0 ? "frontRear" : "leftRight"
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  toggleFlipHalvesBtn.addEventListener("click", () => {
    const current = player.cameraMapping ? player.cameraMapping.flipHalves : false;
    player.saveCameraMapping({ flipHalves: !current }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  toggleInvertPhaseBtn.addEventListener("click", () => {
    const curP0 = player.cameraMapping ? player.cameraMapping.phase0 : "frontRear";
    const curP1 = player.cameraMapping ? player.cameraMapping.phase1 : "leftRight";
    player.saveCameraMapping({
      phase0: curP1,
      phase1: curP0
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  resetIdentifyBtn.addEventListener("click", () => {
    player.saveCameraMapping({
      phase0: "frontRear",
      phase1: "leftRight",
      flipHalves: false
    }, activeClip?.id);
    renderIdentifyFrame();
    updateIdentifyUi();
  });

  async function completeIdentify() {
    if(savingIdentity||!activeClip)return;
    savingIdentity=true;doneIdentifyBtn.disabled=true;
    const id=activeClip.id;
    try{
      if(!continueLocally || localFallbackMapping!==JSON.stringify(player.cameraMapping))await markClipIdentified(id);
      else sessionConfirmedClips.add(id);
      if(activeClip?.id!==id)return;
      identifyModal.classList.remove('open');
      const cb=onIdentifyComplete;onIdentifyComplete=null;cb?.();
    }catch(error){
      document.getElementById('identifySaveStatus').textContent=error.message;
      continueLocally=!!error.savedLocally;
      localFallbackMapping=JSON.stringify(player.cameraMapping);
      doneIdentifyBtn.textContent=continueLocally?'Continue with browser copy':'Retry save';
    }finally{savingIdentity=false;doneIdentifyBtn.disabled=false;}
  }
  // Dismissing an unconfirmed dialog never marks a recording as identified.
  closeIdentifyBtn.addEventListener('click',()=>{identifyModal.classList.remove('open');onIdentifyComplete=null;});
  doneIdentifyBtn.addEventListener('click',completeIdentify);

  identifyModal.addEventListener("click", (e) => {
    if (e.target === identifyModal) {identifyModal.classList.remove('open');onIdentifyComplete=null;}
  });
});
