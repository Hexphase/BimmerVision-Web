// Keep the three connection methods on a linkable screen without reloading the player.
(() => {
  const intro = document.getElementById('welcomeIntro');
  const demo = document.getElementById('homeDemo');
  const playDemo = document.getElementById('playHomeDemo');
  demo.controls = false;
  playDemo.hidden = false;
  playDemo.addEventListener('click', () => {
    demo.controls = true;
    demo.play().then(() => {
      const hadFocus = document.activeElement === playDemo;
      playDemo.hidden = true;
      if (hadFocus) demo.focus();
    }).catch(() => {
      demo.controls = false;
      playDemo.hidden = false;
    });
  });
  const get = id => document.getElementById(id);
  const sheet = get('dashboardSheet');
  const title = get('dashboardSheetTitle');
  const back = get('backToSources');
  const screen = get('sourceScreen');
  const actions = document.querySelector('.dashboard-actions');
  const library = get('openLibraryCard');
  const libraryBack = get('libraryHomeBtn');
  const usbPicker = get('usbInstructions');
  const status = document.querySelector('.source-work-status');
  const statusAnchor = status.previousElementSibling;
  const units = get('webSpeedUnit');
  const continuePlayback = get('webContinuePlayback');
  const manager = window.BVSourceManager;
  const account = window.BVGoogleDriveAccount;
  const backupUsb = get('backupUsbBtn');
  const backupCar = get('backupCarLink');
  const dashboardLabels = {usb:'USB drive', car:'BMW', drive:'Google Drive'};
  const views = {
    about: ['What is BimmerVision?', 'homeAbout'],
    recordings: ['Recordings', 'sourceList'],
    carConnection: ['Connect to your BMW', 'carConnection'],
    googleDriveConnection: ['Google Drive', 'googleDriveConnection'],
    googleAccount: ['Google account', 'googleDriveConnection'],
    backup: ['Remote Backup', 'backupLanding'],
    settings: ['Settings', 'webSettings'],
    connection: ['BMW connection', 'homeConnectionDetails']
  };
  let current = '';
  let backupConnection = null;
  let opener = null;
  let revealingDashboard = false;

  const uploadBar = get('homeUploadBar');
  const uploadProgress = get('homeUploadProgress');
  const connectionCard = get('homeConnectionCard');
  let localUpload = null;
  let carUpload = null;
  let uploadPoll = null;
  let uploadTimer = null;
  let pageHidden = false;

  function renderUpload() {
    const upload = localUpload?.source === manager.source ? localUpload : carUpload;
    uploadBar.hidden = !upload;
    if (!upload) return;
    const {remaining,progress,paused} = upload;
    uploadBar.querySelector('strong').textContent = paused ? 'Backup paused' : 'Uploading recordings';
    get('homeUploadRemaining').textContent = Number.isInteger(remaining)
      ? `${remaining} ${remaining === 1 ? 'recording' : 'recordings'} left`
      : 'Transfer in progress';
    if (Number.isFinite(progress)) uploadProgress.value = progress;
    else uploadProgress.removeAttribute('value');
  }

  function canPollUpload() {
    return !pageHidden && !document.hidden && !screen.hidden && !sheet.open &&
      manager.source?.kind === 'car' && !localUpload;
  }

  async function pollCarUpload() {
    if (!canPollUpload() || uploadPoll) return;
    const source = manager.source;
    const controller = new AbortController();
    uploadPoll = controller;
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
      const response = await source.fetch('/api/v1/remote-backup',{signal,timeoutMs:5000});
      if (!response.ok) throw Error('Backup status unavailable');
      const status = await response.json();
      if (uploadPoll === controller) carUpload = window.BVRemoteBackupPage?.summarizeUpload(status) || null;
    } catch (_) {
      if (uploadPoll === controller) carUpload = null;
    } finally {
      if (uploadPoll === controller) {
        uploadPoll = null;
        renderUpload();
        if (canPollUpload()) uploadTimer = setTimeout(() => {uploadTimer = null;pollCarUpload();},5000);
      }
    }
  }

  function stopUploadPoll() {
    clearTimeout(uploadTimer);
    uploadTimer = null;
    uploadPoll?.abort();
    uploadPoll = null;
    carUpload = null;
  }

  function syncUploadPoll() {
    if (!canPollUpload()) stopUploadPoll();
    else if (uploadTimer === null) pollCarUpload();
    renderUpload();
  }

  function updateSource(source = manager.source) {
    const label = dashboardLabels[source?.kind];
    let address = '';
    if (source?.kind === 'car' && source.baseUrl) {
      try {address = new URL(source.baseUrl).host;} catch (_) {}
    }
    connectionCard.hidden = !address;
    get('homeConnectionPreview').textContent = address ? 'Direct · ' + address : '';
    get('homeConnectionAddress').textContent = address;
    if (localUpload?.source !== source) localUpload = null;
    stopUploadPoll();
    if (current === 'connection' && !address) routeTo('');
    else syncUploadPoll();
    library.disabled = !label;
    get('dashboardSourceName').textContent = label || 'Choose a source first';
    backupUsb.querySelector('span').textContent = source?.kind === 'usb' ? 'Choose USB recordings' : 'Open USB drive';
    get('backupUsbSummary').textContent = source?.kind === 'usb'
      ? 'Select recordings from your open USB drive.'
      : 'Plug the drive into this device to choose recordings.';
    backupCar.hidden = source?.kind === 'car';
    get('manageBackupBtn').hidden = source?.kind !== 'car';
  }

  function updateAccount() {
    const identity = account.user?.emailAddress || account.user?.displayName;
    get('webGoogleAccountStatus').textContent = account.client ? identity || 'Connected' : 'Disconnected';
    const googleContinue = get('connectGoogleDriveBtn');
    googleContinue.hidden = current === 'googleAccount' && !!account.client;
    if (googleContinue.getAttribute('aria-busy') !== 'true') {
      googleContinue.textContent = account.client ? 'Open saved recordings' : 'Continue with Google';
    }
    get('googleDrivePurpose').textContent = current === 'googleAccount'
      ? 'Use your Google account for backups and saved recordings. Sign-in lasts for this page session.'
      : 'Open the recordings you saved with Remote Backup.';
  }

  function moveStatus() {
    if (usbPicker.open) usbPicker.append(status);
    else if (sheet.open) sheet.querySelector('.dashboard-sheet-body').append(status);
    else statusAnchor.after(status);
  }

  function render(route) {
    const view = Object.hasOwn(views, route) &&
      (route !== 'connection' || !connectionCard.hidden) &&
      (route !== 'about' || get('homeTripStats').hidden) ? route : '';
    if (current !== view) {
      get('cancelSourceWork').click();
      get('sourceError').hidden = true;
    }
    current = view;
    if (!view) {
      if (sheet.open) sheet.close();
      moveStatus();
      syncUploadPoll();
      return;
    }
    demo.pause();
    const [heading, panel] = views[view];
    for (const id of new Set(Object.values(views).map(([,id]) => id))) get(id).hidden = id !== panel;
    title.textContent = heading;
    back.hidden = !['carConnection','googleDriveConnection','googleAccount'].includes(view);
    back.href = view === 'googleAccount' ? '#settings' : backupConnection === 'car' ? '#backup' : '#recordings';
    updateAccount();
    if (!sheet.open) sheet.showModal();
    moveStatus();
    sheet.scrollTop = 0;
    title.focus({preventScroll:true});
    syncUploadPoll();
  }

  function routeTo(view) {
    history.replaceState(history.state, '', '#' + (view || 'home'));
    render(view);
  }

  function closeSheet({restoreFocus=true}={}) {
    backupConnection = null;
    routeTo('');
    if (restoreFocus) opener?.focus({preventScroll:true});
  }

  function openLibrary() {
    if (library.disabled) return;
    closeSheet({restoreFocus:false});
    get('returnToRecordingsBtn').click();
    get('playbackBackBtn').click();
    window.scrollTo(0,0);
    get('recordingsPageTitle').focus({preventScroll:true});
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      get('viewRecordings').animate(
        [{transform:'translateY(100dvh)'},{transform:'translateY(0)'}],
        {duration:260,easing:'cubic-bezier(.2,.7,.3,1)'}
      );
    }
  }

  function revealDashboard() {
    if (!screen.hidden) return;
    revealingDashboard = true;
    get('changeSourceBtn').click();
    revealingDashboard = false;
  }

  function showDashboard() {
    revealDashboard();
    routeTo('');
    window.scrollTo(0,0);
    actions.querySelector('[href="#recordings"]').focus({preventScroll:true});
  }

  function openUsb() {
    queueMicrotask(moveStatus);
  }

  actions.addEventListener('click', event => {
    const link = event.target.closest('a[aria-haspopup="dialog"]');
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      opener = link;
      if (location.hash === link.hash) render(link.hash.slice(1));
    }
  });
  get('homeAboutBtn').addEventListener('click', event => {
    opener = event.currentTarget;
    routeTo('about');
  });
  get('closeDashboardSheet').addEventListener('click', () => closeSheet());
  sheet.addEventListener('cancel', event => {event.preventDefault();closeSheet();});
  sheet.addEventListener('click', event => {if (event.target === sheet) closeSheet();});
  usbPicker.addEventListener('close', moveStatus);
  get('openUsbBtn').addEventListener('click', openUsb);
  library.addEventListener('click', openLibrary);
  get('homeAllDrives').addEventListener('click', openLibrary);
  get('homeLatestDrive').addEventListener('click', () => {
    const latest = document.querySelector('.latest-drive-group .btn-view-entire-drive');
    if (!latest || library.disabled) return;
    openLibrary();
    latest.click();
  });
  libraryBack.addEventListener('click', showDashboard);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !screen.hidden ||
        document.body.dataset.screen !== 'library' ||
        document.querySelector('.modal-backdrop.open, dialog[open]') ||
        !get('backToDrives').hidden) return;
    event.preventDefault();
    showDashboard();
  });
  get('changeSourceBtn').addEventListener('click', () => {
    if (revealingDashboard) return;
    queueMicrotask(() => {
      if (screen.hidden) return;
      opener = actions.querySelector('[href="#recordings"]');
      routeTo('recordings');
    });
  });

  function openBackup() {
    closeSheet({restoreFocus:false});
    actions.querySelector('[href="#backup"]').focus({preventScroll:true});
    window.BVRemoteBackupPage.open();
  }

  backupUsb.addEventListener('click', () => {
    if (manager.source?.kind === 'usb') {
      openBackup();
      return;
    }
    backupConnection = 'usb';
    get('openUsbBtn').click();
  });
  backupCar.addEventListener('click', event => {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) backupConnection = 'car';
  });
  get('manageBackupBtn').addEventListener('click', openBackup);

  uploadBar.addEventListener('click', () => {
    if (!window.BVGoogleDriveBackupUI?.showActive()) openBackup();
  });
  document.addEventListener('visibilitychange', syncUploadPoll);
  new MutationObserver(syncUploadPoll).observe(screen,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('pagehide', () => {pageHidden = true;syncUploadPoll();});
  window.addEventListener('pageshow', () => {pageHidden = false;syncUploadPoll();});

  manager.subscribe(updateSource);
  account.subscribe(updateAccount);
  updateSource();
  updateAccount();
  window.BVDashboard = {
    showHomeForUpload() {
      showDashboard();
      uploadBar.focus({preventScroll:true});
    },
    updateUpload(upload) {
      localUpload = upload?.source === manager.source ? upload : null;
      syncUploadPoll();
    },
    get googleAccountOnly() {return current === 'googleAccount';},
    sourceSelected(source) {
      if (!sheet.open) return false;
      if (backupConnection === source.kind) {
        openBackup();
      } else {
        routeTo('recordings');
        library.focus({preventScroll:true});
      }
      return true;
    }
  };

  try {
    units.value = localStorage.getItem('bimmervision_speed_unit') === 'km/h' ? 'km/h' : 'mph';
    continuePlayback.checked = localStorage.getItem('bimmervision_auto_advance') !== 'false';
  } catch (_) {}
  units.addEventListener('change', () => {
    try {localStorage.setItem('bimmervision_speed_unit', units.value);} catch (_) {}
    window.dispatchEvent(new CustomEvent('bimmervision:speed-unit', {detail:units.value}));
  });
  continuePlayback.addEventListener('change', () => {
    try {localStorage.setItem('bimmervision_auto_advance', String(continuePlayback.checked));} catch (_) {}
  });

  function syncRoute() {
    const route = location.hash.slice(1);
    if (route === 'backup' && current !== 'backup') backupConnection = null;
    if (Object.hasOwn(views,route)) revealDashboard();
    render(route);
  }
  window.addEventListener('hashchange', syncRoute);
  const query = new URLSearchParams(location.search);
  if (query.has('car') || query.has('address')) render('carConnection');
  else syncRoute();
})();
