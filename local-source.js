/* Local playback; native directory handles may explicitly save lock metadata only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BVLocalSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MAX_JSON = 1048576;
  const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
  const rawZip = typeof module === 'object' && module.exports ? require('./raw-zip') : globalThis.BVRawZip;
  const {scan, validHeader} = typeof module === 'object' && module.exports ? require('./recording-metadata') : globalThis.BVRecordingMetadata;
  const LABEL = 'USB view only, mappings saved this browser';
  const abort = () => new DOMException('USB reading cancelled', 'AbortError');
  function check(signal) { if (signal && signal.aborted) throw abort(); }
  function safeParts(path) {
    if (typeof path !== 'string' || path.includes('\\') || path.includes('\0')) return null;
    const parts = path.split('/');
    return parts.length && parts.every(p => p && p !== '.' && p !== '..' && !p.endsWith('.partial') && p !== '.partials') ? parts : null;
  }
  function recordingId(directory) {
    const id=directory.replace(/^BimmerVision-/i, '');
    return UUID.test(id) ? id.toLowerCase() : null;
  }
  function json(value, status = 200) { return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}}); }
  function validMapping(m) {
    return m && m.schemaVersion === 1 && m.confirmed === true && ['frontRear', 'leftRight'].includes(m.phase0) && ['frontRear', 'leftRight'].includes(m.phase1) && m.phase0 !== m.phase1 && typeof m.flipHalves === 'boolean';
  }
  function ranged(blob, range, method) {
    const headers = {'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream'};
    let start = 0, end = blob.size - 1, status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (!m[1] && !m[2])) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': `bytes */${blob.size}`}});
      if (m[1]) { start = Number(m[1]); end = m[2] ? Number(m[2]) : end; }
      else { const suffix = Number(m[2]); if (!Number.isSafeInteger(suffix)) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': `bytes */${blob.size}`}}); start = Math.max(0, blob.size - suffix); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= blob.size || start > end || (!m[1] && Number(m[2]) === 0)) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': `bytes */${blob.size}`}});
      end = Math.min(end, blob.size - 1); status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${blob.size}`;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    return new Response(method === 'HEAD' ? null : blob.slice(start, end + 1), {status, headers});
  }
  async function create(entries, name, options = {}) {
    const {signal, onProgress = () => {}} = options;
    check(signal);
    const groups = new Map(), warnings = [], recordings = new Map();
    let discoveryCount=0;
    for (const {path, file, handle} of entries) {
      if(++discoveryCount%200===0){await yieldUI();check(signal);}
      const parts = safeParts(path);
      if (!parts || parts.length < 2) continue;
      const id=recordingId(parts[parts.length-2]);
      if (!id) continue;
      const dir = parts.slice(0, -1).join('/'), filename = parts[parts.length - 1];
      if (!['manifest.json', 'capture.bvr', 'mapping.json'].includes(filename)) continue;
      if (!groups.has(dir)) groups.set(dir, {id, directory:parts.slice(1,-1), files: new Map(), handles: new Map(), ambiguous: false});
      const group = groups.get(dir);
      if (group.files.has(filename)) group.ambiguous = true;
      group.files.set(filename, file);
      if(handle)group.handles.set(filename,handle);
    }
    const ids = new Map();
    for (const group of groups.values()) ids.set(group.id.toLowerCase(), (ids.get(group.id.toLowerCase()) || 0) + 1);
    let count = 0;
    for (const group of groups.values()) {
      check(signal);
      const mf = group.files.get('manifest.json'), capture = group.files.get('capture.bvr');
      try {
        if (ids.get(group.id.toLowerCase()) !== 1 || group.ambiguous) throw Error('Duplicate recording ID or ambiguous files');
        if (!mf || !capture || mf.size > MAX_JSON || mf.size === 0) throw Error('Missing archive or invalid manifest size');
        const manifest = JSON.parse(await mf.text());
        if (!manifest || !UUID.test(manifest.id) || manifest.id.toLowerCase() !== group.id || manifest.complete !== true || manifest.schemaVersion !== 1 || manifest.format !== 'bvr1') throw Error('Invalid or incomplete recording manifest');
        if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes !== capture.size || capture.size < 16) throw Error('Archive size does not match manifest');
        const header = new Uint8Array(await capture.slice(0, 16).arrayBuffer());
        if (!validHeader(header)) throw Error('Invalid archive header');
        recordings.set(manifest.id.toLowerCase(), {directory:group.directory, manifest, manifestFile:mf, manifestHandle:group.handles.get('manifest.json'), captureHandle:group.handles.get('capture.bvr'), capture, mappingFile: group.files.get('mapping.json'), overview: {route: [], endpoints: null, routeStatus: 'indexing'}});
      } catch (error) { warnings.push(`${group.id}: ${error.message}`); }
      onProgress({phase: 'catalog', completed: ++count, total: groups.size});
      if(count%20===0){await yieldUI();check(signal);}
    }
    let closed = false, lockQueue=Promise.resolve(), revision=0;
    const listeners=new Set();
    let permissionHandle=options.permissionHandle,canLock=recordings.size>0&&[...recordings.values()].every(r=>typeof r.manifestHandle?.createWritable==='function'&&typeof r.manifestHandle?.requestPermission==='function'&&typeof r.captureHandle?.getFile==='function');
    function live(requestSignal){check(signal);check(requestSignal);if(closed)throw abort();}
    async function saveLock(record,locked,permission,requestSignal){
      let writable,committed=false;
      try{
        live(requestSignal);
        if(await permission!=='granted')return json({error:'Write permission is required to save a USB lock. Use Chrome or Edge, or lock the original through the connected car.'},403);
        live(requestSignal);
        const current=await record.manifestHandle.getFile(),text=await record.manifestFile.text();
        if(current.size>MAX_JSON||await current.text()!==text)throw Error('USB recording metadata changed. Reopen the drive before locking.');
        const capture=await record.captureHandle.getFile();
        if(capture.size!==record.capture.size||capture.lastModified!==record.capture.lastModified)throw Error('USB recording changed. Reopen the drive before locking.');
        live(requestSignal);
        const value={...record.manifest,locked},bytes=JSON.stringify(value,null,2)+'\n';
        writable=await record.manifestHandle.createWritable({keepExistingData:false});live(requestSignal);
        await writable.write(bytes);live(requestSignal);
        const beforeCommit=await record.manifestHandle.getFile();
        if(beforeCommit.size>MAX_JSON||await beforeCommit.text()!==text)throw Error('USB metadata changed while saving. Reopen the drive before locking.');
        live(requestSignal);
        // The browser commits its temporary file only when this stream closes.
        await writable.close();committed=true;
        const saved=await record.manifestHandle.getFile();
        if(await saved.text()!==bytes)throw Error('USB lock could not be verified. Reopen the drive to check its status.');
        record.manifest=value;record.manifestFile=new Blob([bytes],{type:'application/json'});revision++;
        for(const listener of listeners)listener();
        return json({id:record.manifest.id,locked});
      }catch(error){
        if(error.name==='AbortError')throw error;
        return json({error:committed?'USB lock was saved but verification failed. Reopen the drive to check its status.':error.message||'Could not save USB lock.'},409);
      }finally{if(writable&&!committed)await writable.abort().catch(()=>{});}
    }
    const source = {
      kind: 'usb', name, recordingCount: recordings.size, get readOnly(){return !canLock;}, get canLock(){return canLock;}, canDelete:false, label: canLock?'USB locking available; video stays unchanged':LABEL, warnings,
      async enableLocks(root, requestSignal){
        live(requestSignal);
        if(root.name!==name)throw Error('Choose the same folder you opened for viewing.');
        const handles=[];
        for(const record of recordings.values()){
          live(requestSignal);
          let dir=root;
          for(const part of record.directory)dir=await dir.getDirectoryHandle(part);
          const manifest=await dir.getFileHandle('manifest.json'),capture=await dir.getFileHandle('capture.bvr');
          const file=await manifest.getFile(),video=await capture.getFile();
          if(file.size!==record.manifestFile.size || await file.text()!==await record.manifestFile.text() ||
             video.size!==record.capture.size || video.lastModified!==record.capture.lastModified)
            throw Error('This folder does not match the open recordings.');
          handles.push({record,manifest,capture});
        }
        live(requestSignal);
        for(const {record,manifest,capture} of handles){record.manifestHandle=manifest;record.captureHandle=capture;}
        permissionHandle=root;canLock=handles.length>0;
      },
      get revision(){return revision;},
      subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
      getOriginalFiles(id) { check(signal);if(closed)throw abort();if(typeof id!=='string'||!UUID.test(id))throw Error('Invalid recording.');const record=recordings.get(id.toLowerCase());if(!record)throw Error('Recording unavailable.');const files=[{name:'capture.bvr',blob:record.capture}];if(record.mappingFile)files.push({name:'mapping.json',blob:record.mappingFile});files.push({name:'manifest.json',blob:record.manifestFile});return files; },
      close() { closed = true; recordings.forEach(r => { if (r.overview.routeStatus === 'indexing') r.overview.routeStatus = 'cancelled'; }); },
      async fetch(path, init = {}) {
        check(signal); check(init.signal);
        if (closed) throw abort();
        const request = typeof Request !== 'undefined' && path instanceof Request ? path : null;
        const method = String(init.method || (request && request.method) || 'GET').toUpperCase();
        let url;
        try { url = new URL(request ? request.url : path, 'https://usb.invalid'); } catch (_) { return json({error: 'Invalid path'}, 400); }
        const lockMatch=/^\/api\/v1\/recordings\/([a-f0-9-]+)\/lock$/i.exec(url.pathname);
        if(method==='POST'&&lockMatch&&canLock){
          const record=recordings.get(lockMatch[1].toLowerCase());if(!record)return json({error:'Recording unavailable'},404);
          let body;try{body=JSON.parse(init.body);}catch{return json({error:'Invalid lock request'},400);}
          if(typeof body?.locked!=='boolean')return json({error:'Lock must be true or false'},400);
          // Ask while still in the user's click gesture, before serialized I/O awaits.
          const permission=Promise.resolve().then(()=>(permissionHandle||record.manifestHandle).requestPermission({mode:'readwrite'}));
          permission.catch(()=>{});
          const result=lockQueue.then(()=>saveLock(record,body.locked,permission,init.signal));lockQueue=result.catch(()=>{});return result;
        }
        if (method === 'DELETE' || (method !== 'GET' && method !== 'HEAD' && !/\/mapping(?:\.json)?$/.test(url.pathname))) return json({error: 'USB view only. Connect to the car to lock or delete recordings. Original files are never changed.'}, 403);
        if (url.pathname === '/api/v1/recordings' && method === 'GET') return json({recordings: [...recordings.values()].map(r => ({...r.manifest, ...r.overview})), warnings});
        if (url.pathname === '/api/v1/capabilities') return json({nativePreview: false, readOnly: !canLock, canLock, canDelete:false, mappingStorage: 'browser'});
        if (url.pathname === '/api/v1/version') return json({version: '0.2.8', repository: 'Hexphase/BimmerVision'});
        if (url.pathname === '/api/v1/speed-limit') return json(null);
        const match = /^\/api\/v1\/recordings\/([a-f0-9-]+)\/(manifest\.json|capture\.bvr|raw\.zip|mapping(?:\.json)?)$/i.exec(url.pathname);
        if (!match) return json({error: 'USB endpoint unavailable'}, 404);
        const record = recordings.get(match[1].toLowerCase());
        if (!record) return json({error: 'Recording unavailable'}, 404);
        if (match[2] === 'raw.zip') {
          const files=[{name:'manifest.json',file:record.manifestFile},{name:'capture.bvr',file:record.capture}];
          if(record.mappingFile)files.push({name:'mapping.json',file:record.mappingFile});
          const body=method==='HEAD'?null:rawZip.createStream(files,'BimmerVision-'+record.manifest.id,{signal:init.signal,guard(){check(signal);if(closed)throw abort();}});
          return new Response(body,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="BimmerVision-'+record.manifest.id+'.zip"'}});
        }
        if (match[2] === 'manifest.json') return json(record.manifest);
        if (match[2] === 'capture.bvr') return ranged(record.capture, new Headers(init.headers || (request && request.headers) || {}).get('Range'), method);
        const key = 'bimmervision_mapping_' + record.manifest.id;
        if (method === 'POST') {
          let mapping;
          try { mapping = JSON.parse(init.body === undefined && request ? await request.text() : init.body); } catch (_) { return json({error: 'Invalid mapping JSON'}, 400); }
          if (!validMapping(mapping)) return json({error: 'Invalid confirmed camera mapping'}, 400);
          const value = {schemaVersion: 1, confirmed: true, phase0: mapping.phase0, phase1: mapping.phase1, flipHalves: mapping.flipHalves};
          try { globalThis.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { return json({error: 'Enable browser storage to save this mapping. USB files were not changed.'}, 507); }
          return json(value);
        }
        if (method !== 'GET') return json({error: 'USB view only'}, 403);
        try { const value = JSON.parse(globalThis.localStorage.getItem(key)); if (validMapping(value)) return json(value); } catch (_) {}
        if (record.mappingFile && record.mappingFile.size <= MAX_JSON) { try { const value = JSON.parse(await record.mappingFile.text()); if (validMapping(value)) return json(value); } catch (_) {} }
        return json({error: 'No confirmed camera mapping'}, 404);
      }
    };
    // Sequential background work avoids reading every video while listing the USB.
    source.indexing = (async () => {
      for (const [id, record] of recordings) {
        if (closed || signal && signal.aborted) break;
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
          const {route, endpoints, routeStatus} = await scan(record.capture, record.manifest, () => closed || signal && signal.aborted, (completed, total) => onProgress({phase: 'route', id, completed, total}));
          if (!closed && !(signal && signal.aborted)) record.overview = {route, endpoints, routeStatus};
        } catch (error) { record.overview.routeStatus = error.name === 'AbortError' ? 'cancelled' : 'unavailable'; }
        onProgress({phase: 'route', id, completed: record.capture.size, total: record.capture.size, status: record.overview.routeStatus});
      }
    })();
    return source;
  }
  async function fromFiles(files, options = {}) {
    const entries=[];let count=0;
    for(const file of files){check(options.signal);const path=file.webkitRelativePath||file.name;if(['manifest.json','capture.bvr','mapping.json'].includes(file.name||path.split('/').at(-1)))entries.push({path,file});if(++count%200===0)await yieldUI();}
    return create(entries, entries[0] && entries[0].path.split('/')[0] || 'USB recordings', options);
  }
  async function fromDirectoryHandle(handle, options = {}) {
    const entries = [];let visited=0;
    async function walk(dir, prefix, depth) {
      check(options.signal);
      if (depth > 8) return;
      for await (const [name, child] of dir.entries()) {
        check(options.signal);
        if(++visited%100===0){options.onProgress?.({phase:'discovery',message:'Finding your recordings…'});await yieldUI();check(options.signal);}
        if (!safeParts(name)) continue;
        if (child.kind === 'directory') {
          if (depth === 0 || name === 'BimmerVision' || name === 'Library' || recordingId(name)) await walk(child, prefix + name + '/', depth + 1);
        } else if (['manifest.json', 'capture.bvr', 'mapping.json'].includes(name)) entries.push({path: prefix + name, file: await child.getFile(), handle: child});
      }
    }
    await walk(handle, handle.name + '/', 0);
    return create(entries, handle.name || 'USB recordings', {...options,permissionHandle:typeof handle.requestPermission==='function'?handle:null});
  }
  return {fromFiles, fromDirectoryHandle};
});
