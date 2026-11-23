/**
 * BimmerVision Client-Side MP4 Exporter
 * Encodes selected camera view + telemetry HUD into standard MP4 on device.
 * Triggers native iOS Share Sheet ("Save Video" to Camera Roll) with zero car server CPU load.
 */
class ClipExporter {
  constructor(player) {
    this.player = player;
  }

  // Select source images at the export timestamp, isolated by recorded mode
  // boundaries. No camera selection may crop or omit a takeover image.
  _cameraFramesAt(time, bitmaps = this.player?.decodedFrames) {
    const player=this.player,units=player?.accessUnits || [];
    const cameraView=player?.parser?.getCameraViewAtTime?.(time,player?.manifest?.startMonotonicUs) || null;
    const result={cameraView,rawFrame:null,fr:null,lr:null};
    if(!units.length)return cameraView ? result : null;
    let lo=0,hi=units.length-1,index=-1;
    while(lo<=hi){const mid=(lo+hi)>>1;if(units[mid].time<=time){index=mid;lo=mid+1;}else hi=mid-1;}
    const p0Fr=player.cameraMapping?.phase0!=='leftRight';
    const seen=new Set();
    for(let i=index;i>=Math.max(0,index-12);i--){
      const unit=units[i];if(cameraView && unit.atUs<cameraView.atUs)break;
      const frame=unit.damaged?null:bitmaps?.get(unit.index);
      if(cameraView?.single){
        if(unit.damaged || frame){result.rawFrame=frame || null;break;}
      }else{
        const phase=unit.phase ?? i%2;
        if(!seen.has(phase) && (unit.damaged || frame)){
          seen.add(phase);result[(phase===0)===p0Fr?'fr':'lr']=frame || null;
        }
        if(seen.size===2)break;
      }
    }
    return result;
  }

  _drawRecordedView(ctx, cameraView, frame) {
    if(frame){
      const scale=Math.min(1280/frame.width,960/frame.height),w=frame.width*scale,h=frame.height*scale;
      ctx.drawImage(frame,(1280-w)/2,(960-h)/2,w,h);
    }
    const label=cameraView.label.toUpperCase();
    ctx.save();ctx.font='bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
    const width=ctx.measureText(label).width+32;
    ctx.fillStyle='rgba(10,12,16,0.78)';ctx.beginPath();ctx.roundRect(20,20,width,42,6);ctx.fill();
    ctx.fillStyle='#fff';ctx.textAlign='left';ctx.fillText(label,36,49);ctx.restore();
  }

  _operationContext(options) {
    return {epoch:this.player?._clipEpoch,signals:[options.signal,this.player?._activeStreamAbort?.signal].filter(Boolean),timeoutMs:this.completionTimeoutMs || 15000};
  }
  _checkOperation(operation) {
    if(operation.error)throw operation.error;
    if(operation.signals.some(signal=>signal.aborted) || operation.epoch!==this.player?._clipEpoch) {
      const error=new Error('Export cancelled because the recording changed or the operation was aborted.');error.name='AbortError';throw error;
    }
  }
  async _awaitCompletion(promise,operation,label) {
    const awaited=Promise.resolve(promise);awaited.catch(()=>{});
    this._checkOperation(operation);
    let timer,aborted;
    const start=Date.now();
    try {
      return await Promise.race([awaited,new Promise((_,reject)=>{
        const check=()=>{
          try {
            this._checkOperation(operation);
            if(Date.now()-start>=operation.timeoutMs){const error=new Error(`Timed out ${label}. No incomplete export was saved. Please retry.`);error.name='TimeoutError';throw error;}
            timer=setTimeout(check,Math.min(25,operation.timeoutMs));
          }catch(error){reject(error);}
        };
        aborted=check;
        for(const signal of operation.signals)signal.addEventListener('abort',aborted,{once:true});
        check();
      })]);
    }finally{
      clearTimeout(timer);
      for(const signal of operation.signals)signal.removeEventListener('abort',aborted);
    }
  }
  async _waitForNativeFrame(video,operation) {
    let callbackId=null,animationId=null,timer=null,ended,failed;
    const next=new Promise((resolve,reject)=>{
      ended=()=>resolve(false);
      failed=()=>reject(new Error('The source video failed during export. Please retry.'));
      video.addEventListener('ended',ended,{once:true});video.addEventListener('error',failed,{once:true});
      if(video.ended){resolve(false);return;}
      if(typeof video.requestVideoFrameCallback==='function')callbackId=video.requestVideoFrameCallback(()=>resolve(true));
      else if(typeof requestAnimationFrame==='function')animationId=requestAnimationFrame(()=>resolve(true));
      else timer=setTimeout(()=>resolve(true),16);
    });
    try{return await this._awaitCompletion(next,operation,'waiting for the next source video frame');}
    finally{
      video.removeEventListener('ended',ended);video.removeEventListener('error',failed);
      if(callbackId!==null)video.cancelVideoFrameCallback?.(callbackId);
      if(animationId!==null && typeof cancelAnimationFrame==='function')cancelAnimationFrame(animationId);
      clearTimeout(timer);
    }
  }

  async _prepareRecording(progress) {
    const player=this.player;
    if (player?.streamComplete === false || (player?.streamPromise && !player.streamComplete)) {
      progress(0.02,'Downloading the complete recording before export…');
      if(player.waitForCompleteRecording) {
        await player.waitForCompleteRecording(45000,(loaded,total)=>{
          const received=total ? `${Math.min(100,Math.floor(loaded/total*100))}%` : `${(loaded/1048576).toFixed(1)} MB`;
          progress(0.02,`Downloading recording: ${received} received…`);
        });
      } else if(player.streamPromise) {
        let timer;
        try { await Promise.race([player.streamPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Recording download stalled. Check the connection and retry.')),45000);})]); }
        finally {clearTimeout(timer);}
      }
      if(!player.streamComplete) throw new Error('The complete recording is unavailable. Reopen the recording and retry export.');
    }
    if(player?.loadError) throw player.loadError;
    if(!player?.manifest) throw new Error('Open a recording before exporting.');
    await ClipExporter.wheelAssetsReady;
  }

  static assets = {
    wheel: null,
    wheelHorn: null,
    wordmark: null,
    eye: null
  };

  /**
   * Export clip with options:
   * @param {Object} options
   * @param {string|string[]} options.view - "quad", "front", "rear", "left", "right", "source", or a camera subset
   * @param {Object} [options.overlays] - individual metadata toggle flags: { blinkers, speed, speedLimit, steering, brake, gas, time }
   * @param {boolean} [options.includeHud] - master telemetry switch (default true)
   * @param {string} options.speedUnit - "mph" or "km/h"
   * @param {string|number} options.duration - "full", 30, 15, 10
   * @param {function} options.onProgress - callback (progress 0..1, statusText)
   */
  async export(options = {}) {
    if(!options.overlays?.drivingView)return this._exportPrepared(options);
    const operation=this._operationContext(options);let renderer,abandoned=false;
    try {
      await this._prepareRecording(options.onProgress||(()=>{}));this._checkOperation(operation);
      if(!this.player?.drivingView?.createExportRenderer)throw new Error('Driving view metadata is unavailable for this recording.');
      const creating=this.player.drivingView.createExportRenderer().then(value=>{if(abandoned){value.dispose();throw new Error('Export cancelled because the recording changed.');}return value;});
      renderer=await this._awaitCompletion(creating,operation,'preparing Driving view');this._checkOperation(operation);
      return await this._exportPrepared({...options,drivingViewRenderer:renderer});
    } finally {abandoned=true;renderer?.dispose();}
  }

  async _exportPrepared(options = {}) {
    if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') {
      if (typeof MediaRecorder !== 'undefined') {
        return this._exportWithMediaRecorder(options);
      }
      throw new Error('Customized video export needs HTTPS and a browser with video encoding support.');
    }
    const player = this.player;
    const view = options.view || 'quad';
    const speedUnit = options.speedUnit || player?.speedUnit || 'mph';
    const progress = options.onProgress || (() => {});

    // Overlays configuration
    const overlays = options.overlays != null ? options.overlays : (options.includeHud !== false ? {
      blinkers: true,
      speed: true,
      speedLimit: true,
      steering: true,
      brake: true,
      gas: true,
      time: true,
      map: true
    } : null);

    const includeMap = overlays ? (overlays.map !== undefined ? Boolean(overlays.map) : Boolean(options.includeMap)) : false;
    const includeDriving=overlays?.drivingView===true,includeSide=includeMap||includeDriving;
    const hasTelemetryBar = overlays ? (overlays.includeHud !== false && (
      overlays.blinkers !== false ||
      overlays.speed !== false ||
      overlays.speedLimit !== false ||
      overlays.steering !== false ||
      overlays.brake !== false ||
      overlays.gas !== false ||
      overlays.time !== false
    )) : false;

    const exportW = includeSide ? 1920 : 1280;
    const exportH = includeSide ? (hasTelemetryBar ? 1080 : 960) : (hasTelemetryBar ? 1040 : 960);

    await this._prepareRecording(progress);
    const operation=this._operationContext(options);this._checkOperation(operation);

    const manifest = player.manifest;
    const units = player.accessUnits;
    const parser = player.parser;
    const full = player.duration || 0;
    const requested = Number(options.duration);
    const duration = requested > 0 ? Math.min(requested, full) : full;
    const start = Math.max(0, full - duration);
    if(includeMap && player.liveMap?.prepareForExport) {
      progress(.03,'Preparing export map…');
      await this._awaitCompletion(player.liveMap.prepareForExport(start,640,includeDriving?480:960,{check:()=>this._checkOperation(operation)}),operation,'preparing map tiles');
    }
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(duration * fps));

    const canvas = document.createElement('canvas');
    canvas.width = exportW;
    canvas.height = exportH;

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: exportW, height: exportH },
      fastStart: 'in-memory'
    });

    let encodeError = null;
    let decodeError = null;
    let fallbackConfig = null;
    let encoder;
    let decoder;
    let submitted = 0,minimumBitmapIndex=0;
    let flushed = false;
    const bitmaps = new Map();
    const pending = new Set(),openFrames=new Set();let disposed=false;
    const mapping = { ...(player.cameraMapping || {}) };

    const nativeVideo = (!units?.length && player._nativeVideo) ? player._nativeVideo : null;
    const wasPaused = nativeVideo ? nativeVideo.paused : true;
    const origTime = nativeVideo ? nativeVideo.currentTime : 0;
    if (nativeVideo && !wasPaused) {
      nativeVideo.pause();
    }

    try {
      encoder = new VideoEncoder({
        output: (chunk, meta) => {
          try {
            let activeMeta = meta;
            if (!meta?.decoderConfig?.description) {
              fallbackConfig ||= this._extractDecoderConfigFromChunk(chunk);
              if (fallbackConfig) activeMeta = { ...meta, decoderConfig: fallbackConfig };
            }
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            muxer.addVideoChunkRaw(bytes, chunk.type, chunk.timestamp, chunk.duration ?? Math.round(1e6 / fps), activeMeta);
          } catch (e) {
            encodeError = e;
          }
        },
        error: e => {
          encodeError = e;
        }
      });
      encoder.configure({
        codec: 'avc1.420028',
        width: exportW,
        height: exportH,
        bitrate: exportW > 1280 ? 6000000 : 4500000,
        framerate: fps,
        avc: { format: 'avc' }
      });

      if (typeof VideoDecoder !== 'undefined' && units?.length && player.assembler) {
        decoder = new VideoDecoder({
          output: frame => {
            if(disposed||frame.timestamp<minimumBitmapIndex){frame.close();return;}
            openFrames.add(frame);
            const job = createImageBitmap(frame).then(bitmap => {
              if(disposed){bitmap.close();return;}
              bitmaps.set(frame.timestamp, bitmap);
            }).catch(e => {
              decodeError = e;
            }).finally(() => {
              frame.close();openFrames.delete(frame);
              pending.delete(job);
            });
            pending.add(job);
          },
          error: e => {
            decodeError = e;
          }
        });
        decoder.configure({
          codec: player._getCodecString ? player._getCodecString() : 'avc1.420028',
          description: RtpH264Assembler.makeAvcC(player.assembler.sps, player.assembler.pps),
          optimizeForLatency: true
        });
      }

      let targetIndex = 0;
      while(targetIndex+1<(units?.length||0)&&units[targetIndex+1].time<=start)targetIndex++;
      // Preserve the preceding camera pair and decode only the required GOP.
      minimumBitmapIndex=Math.max(0,targetIndex-12);
      submitted=Math.max(0,targetIndex-1);
      while(submitted>0&&(!units[submitted].isKeyFrame||units[submitted].damaged))submitted--;
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        this._checkOperation(operation);
        const time = start + frameIndex / fps;

        if (nativeVideo) {
          if (Math.abs(nativeVideo.currentTime - time) > 0.002) {
            await new Promise((resolve) => {
              let done = false;
              const finish = () => {
                if (!done) {
                  done = true;
                  clearTimeout(timer);
                  nativeVideo.removeEventListener('seeked', finish);
                  nativeVideo.removeEventListener('error', finish);
                  resolve();
                }
              };
              const timer = setTimeout(finish, 350);
              nativeVideo.addEventListener('seeked', finish, { once: true });
              nativeVideo.addEventListener('error', finish, { once: true });
              nativeVideo.currentTime = time;
            });
          }
          if (player._nativePairs && player._nativePairs.length >= 2) {
            player._nativePairs[0].getContext('2d').drawImage(nativeVideo, 0, 0, 1280, 480, 0, 0, 1280, 480);
            player._nativePairs[1].getContext('2d').drawImage(nativeVideo, 0, 480, 1280, 480, 0, 0, 1280, 480);
            const p0FrNative = mapping.phase0 === 'frontRear';
            player.lastFrFrame = player._nativePairs[p0FrNative ? 0 : 1];
            player.lastLrFrame = player._nativePairs[p0FrNative ? 1 : 0];
          }
        }

        while (targetIndex + 1 < (units?.length || 0) && units[targetIndex + 1].time <= time) {
          targetIndex++;
        }
        const p0 = targetIndex % 2 === 0 ? targetIndex : targetIndex - 1;
        const p1 = targetIndex % 2 === 1 ? targetIndex : Math.max(1, targetIndex - 1);

        if (decoder) {
          const ahead = Math.min(units.length, targetIndex + 16);
          const began = performance.now();
          const cameraView=parser?.getCameraViewAtTime?.(time,manifest.startMonotonicUs);
          const required=cameraView?.single ? (units[targetIndex].atUs>=cameraView.atUs ? [targetIndex] : []) : [p0,p1];
          while (required.some(i=>!units[i]?.damaged && !bitmaps.has(units[i]?.index ?? i))) {
            if (decodeError) throw new Error('The source recording could not be decoded for export: ' + decodeError.message);
            while (submitted < ahead && decoder.decodeQueueSize < 8) {
              const au = units[submitted++];
              if(au.damaged)continue;
              decoder.decode(new EncodedVideoChunk({ type: au.isKeyFrame ? 'key' : 'delta', timestamp: au.index, data: au.avcc }));
            }
            if (submitted === units.length && !flushed) {
              flushed = true;
              await this._awaitCompletion(decoder.flush(),operation,'flushing source video frames');
              await this._awaitCompletion(Promise.all([...pending]),operation,'preparing source frame bitmaps');
            }
            this._checkOperation(operation);
            if (performance.now() - began > operation.timeoutMs) throw new Error('Timed out waiting for source frames. No incomplete export was saved.');
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const cameraFrames=this._cameraFramesAt(time,bitmaps);

        this.renderFrame(canvas, {
          view: view,
          overlays: overlays,
          speedUnit: speedUnit,
          time: time,
          cameraFrames: cameraFrames,
          fr: player.lastFrFrame,
          lr: player.lastLrFrame,
          telemetry: parser ? parser.getTelemetryAtTime(time, manifest.startMonotonicUs) : null,
          mapping: mapping,
          manifest: manifest,
          drivingView: options.drivingViewRenderer,
          map: player?.liveMap
        });

        const frame = new VideoFrame(canvas, { timestamp: Math.round(frameIndex * 1e6 / fps), duration: Math.round(1e6 / fps) });
        try {
          encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
        } finally {
          frame.close();
        }

        const queueBegan=Date.now();
        while (encoder.encodeQueueSize > 4) {
          this._checkOperation(operation);
          if(Date.now()-queueBegan>=operation.timeoutMs)throw new Error('The video encoder stopped responding. No incomplete export was saved. Please retry.');
          if (encodeError) throw encodeError;
          await new Promise(r => setTimeout(r, 4));
        }
        if (encodeError) throw encodeError;

        for (const [index, bitmap] of bitmaps) {
          if (index < targetIndex - 4) {
            bitmap.close();
            bitmaps.delete(index);
          }
        }
        if (frameIndex % 4 === 0) await new Promise(r => setTimeout(r, 0));
        progress(0.1 + 0.8 * (frameIndex + 1) / totalFrames, `Rendering video · ${Math.round(100 * (frameIndex + 1) / totalFrames)}%`);
      }

      progress(0.94, 'Finalizing M4V video…');
      await this._awaitCompletion(encoder.flush(),operation,'finalizing the video encoder');
      if (encodeError) throw encodeError;
      muxer.finalize();
      progress(1, 'Ready to save');
      return {
        buffer: muxer.target.buffer,
        fileName: `BimmerVision-${manifest.id.slice(0, 8)}-${Array.isArray(view) ? view.join("-") : view}${requested > 0 ? '-' + requested + 's' : ''}.m4v`,
        totalFrames,
        duration
      };
    } finally {
      disposed=true;
      if (nativeVideo) {
        try {
          nativeVideo.currentTime = origTime;
          if (typeof player._renderNativeFrame === 'function') {
            player._renderNativeFrame();
          }
          if (typeof player._updateTelemetryHud === 'function') {
            player._updateTelemetryHud();
          }
          if (!wasPaused) {
            nativeVideo.play().catch(() => {});
          }
        } catch (_) {}
      }
      if (decoder && decoder.state !== 'closed') decoder.close();
      if (encoder && encoder.state !== 'closed') encoder.close();
      for(const frame of openFrames){try{frame.close();}catch(_){}}openFrames.clear();
      // A browser bitmap promise may never settle. Late results close themselves;
      // resource cleanup must not await the same stalled promise that caused failure.
      for (const bitmap of bitmaps.values()) bitmap.close();bitmaps.clear();
    }
  }

  /**
   * MediaRecorder fallback for browsers/environments without WebCodecs VideoEncoder (e.g. HTTP on Android).
   */
  async _exportWithMediaRecorder(options = {}) {
    const player = this.player;
    const view = options.view || 'quad';
    const speedUnit = options.speedUnit || player?.speedUnit || 'mph';
    const progress = options.onProgress || (() => {});

    const overlays = options.overlays != null ? options.overlays : (options.includeHud !== false ? {
      blinkers: true,
      speed: true,
      speedLimit: true,
      steering: true,
      brake: true,
      gas: true,
      time: true,
      map: true
    } : null);

    const includeMap = overlays ? (overlays.map !== undefined ? Boolean(overlays.map) : Boolean(options.includeMap)) : false;
    const includeDriving=overlays?.drivingView===true,includeSide=includeMap||includeDriving;
    const hasTelemetryBar = overlays ? (overlays.includeHud !== false && (
      overlays.blinkers !== false ||
      overlays.speed !== false ||
      overlays.speedLimit !== false ||
      overlays.steering !== false ||
      overlays.brake !== false ||
      overlays.gas !== false ||
      overlays.time !== false
    )) : false;

    const exportW = includeSide ? 1920 : 1280;
    const exportH = includeSide ? (hasTelemetryBar ? 1080 : 960) : (hasTelemetryBar ? 1040 : 960);

    await this._prepareRecording(progress);
    const operation=this._operationContext(options);this._checkOperation(operation);

    const manifest = player.manifest;
    const parser = player.parser;
    const full = player.duration || 0;
    const requested = Number(options.duration);
    const duration = requested > 0 ? Math.min(requested, full) : full;
    const start = Math.max(0, full - duration);
    if(includeMap && player.liveMap?.prepareForExport) {
      progress(.03,'Preparing export map…');
      await this._awaitCompletion(player.liveMap.prepareForExport(start,640,includeDriving?480:960,{check:()=>this._checkOperation(operation)}),operation,'preparing map tiles');
    }
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(duration * fps));

    const canvas = document.createElement('canvas');
    canvas.width = exportW;
    canvas.height = exportH;

    // Render initial frame to setup canvas dimensions
    this.renderFrame(canvas, {
      view: view,
      overlays: overlays,
      speedUnit: speedUnit,
      time: start,
      fr: player.lastFrFrame,
      lr: player.lastLrFrame,
      telemetry: parser ? parser.getTelemetryAtTime(start, manifest.startMonotonicUs) : null,
      mapping: player.cameraMapping,
      manifest: manifest,
      drivingView: options.drivingViewRenderer,
          map: player?.liveMap
    });

    const stream = canvas.captureStream ? canvas.captureStream(fps) : null;
    if (!stream) {
      throw new Error('Canvas stream capture is not supported by this browser.');
    }

    let mimeType = 'video/webm';
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) mimeType = 'video/mp4;codecs=avc1';
      else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
      else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
      else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mimeType = 'video/webm;codecs=vp8';
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: exportW > 1280 ? 6000000 : 4500000 });
    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onerror=e=>{operation.error=e.error || new Error('The video recorder failed. Please retry.');};

    const nativeVideo = player._nativeVideo;
    const originalTime=player.currentTime,wasPlaying=player.isPlaying;
    if(!nativeVideo)player.pause?.();
    const mapping = { ...(player.cameraMapping || {}) };
    const p0FrNative = mapping.phase0 === 'frontRear';
    const frameDelayMs = 1000 / fps;

    let playedSmoothly = false;
    try {
    if(!nativeVideo && player.seekAndWait){
      await this._awaitCompletion(player.seekAndWait(start),operation,'preparing first export frame');
      this.renderFrame(canvas,{view,overlays,speedUnit,time:start,manifest,mapping,drivingView:options.drivingViewRenderer,map:player.liveMap});
    }
    recorder.start(100);
    if (nativeVideo && typeof nativeVideo.play === 'function' && typeof requestAnimationFrame === 'function') {
      try {
        if (Math.abs(nativeVideo.currentTime - start) > 0.05) {
          await new Promise((res) => {
            const onSeek = () => { nativeVideo.removeEventListener('seeked', onSeek); res(); };
            nativeVideo.addEventListener('seeked', onSeek, { once: true });
            setTimeout(onSeek, 400);
            nativeVideo.currentTime = start;
          });
        }
        await this._awaitCompletion(nativeVideo.play(),operation,'starting source video playback');
        playedSmoothly = true;
      } catch (error) {
        if(error.name==='AbortError' || error.name==='TimeoutError')throw error;
        playedSmoothly = false;
      }
    }

      this._checkOperation(operation);
      if (playedSmoothly) {
        const endTime = start + duration;
        const track = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
        let lastRenderedTime = -1,lastAdvance=Date.now();

        while (!nativeVideo.paused && !nativeVideo.ended && nativeVideo.currentTime < endTime) {
          this._checkOperation(operation);
          const curTime = nativeVideo.currentTime;
          if(Date.now()-lastAdvance>=operation.timeoutMs)throw new Error('The source video stopped advancing. No incomplete export was saved. Please retry.');
          if (curTime !== lastRenderedTime) {
            lastRenderedTime = curTime;lastAdvance=Date.now();
            if (player._nativePairs && player._nativePairs.length >= 2) {
              player._nativePairs[0].getContext('2d').drawImage(nativeVideo, 0, 0, 1280, 480, 0, 0, 1280, 480);
              player._nativePairs[1].getContext('2d').drawImage(nativeVideo, 0, 480, 1280, 480, 0, 0, 1280, 480);
              player.lastFrFrame = player._nativePairs[p0FrNative ? 0 : 1];
              player.lastLrFrame = player._nativePairs[p0FrNative ? 1 : 0];
            }

            this.renderFrame(canvas, {
              view: view,
              overlays: overlays,
              speedUnit: speedUnit,
              time: curTime,
              fr: player.lastFrFrame,
              lr: player.lastLrFrame,
              telemetry: parser ? parser.getTelemetryAtTime(curTime, manifest.startMonotonicUs) : null,
              mapping: mapping,
              manifest: manifest,
              drivingView: options.drivingViewRenderer,
          map: player?.liveMap
            });

            if (track && typeof track.requestFrame === 'function') {
              track.requestFrame();
            }

            const pct = Math.min(1, Math.max(0, (curTime - start) / duration));
            progress(0.1 + 0.85 * pct, `Recording video · ${Math.round(100 * pct)}%`);
          }

          if(!await this._waitForNativeFrame(nativeVideo,operation))break;
        }
        try { nativeVideo.pause(); } catch (_) {}
      } else {
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
          this._checkOperation(operation);
          const time = start + frameIndex / fps;
          if (nativeVideo) {
            if (Math.abs(nativeVideo.currentTime - time) > 0.002) {
              await new Promise((resolve) => {
                let done = false;
                const finish = () => {
                  if (!done) {
                    done = true;
                    clearTimeout(timer);
                    nativeVideo.removeEventListener('seeked', finish);
                    nativeVideo.removeEventListener('error', finish);
                    resolve();
                  }
                };
                const timer = setTimeout(finish, 200);
                nativeVideo.addEventListener('seeked', finish, { once: true });
                nativeVideo.addEventListener('error', finish, { once: true });
                nativeVideo.currentTime = time;
              });
            }
            if (player._nativePairs && player._nativePairs.length >= 2) {
              player._nativePairs[0].getContext('2d').drawImage(nativeVideo, 0, 0, 1280, 480, 0, 0, 1280, 480);
              player._nativePairs[1].getContext('2d').drawImage(nativeVideo, 0, 480, 1280, 480, 0, 0, 1280, 480);
              player.lastFrFrame = player._nativePairs[p0FrNative ? 0 : 1];
              player.lastLrFrame = player._nativePairs[p0FrNative ? 1 : 0];
            }
          }

          if(!nativeVideo && player.seekAndWait){
            await this._awaitCompletion(player.seekAndWait(time),operation,'preparing export source frame');
          }

          this.renderFrame(canvas, {
            view: view,
            overlays: overlays,
            speedUnit: speedUnit,
            time: time,
            fr: player.lastFrFrame,
            lr: player.lastLrFrame,
            telemetry: parser ? parser.getTelemetryAtTime(time, manifest.startMonotonicUs) : null,
            mapping: mapping,
            manifest: manifest,
            drivingView: options.drivingViewRenderer,
          map: player?.liveMap
          });

          const track = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
          if (track && typeof track.requestFrame === 'function') {
            track.requestFrame();
          }

          progress(0.1 + 0.85 * (frameIndex + 1) / totalFrames, `Recording video · ${Math.round(100 * (frameIndex + 1) / totalFrames)}%`);
          await new Promise(r => setTimeout(r, Math.max(2, Math.round(frameDelayMs / 2))));
        }
      }

      progress(0.96, 'Finalizing video…');
      const stopPromise = new Promise(resolve => {recorder.onstop=resolve;});
      recorder.stop();
      await this._awaitCompletion(stopPromise,operation,'finalizing the video recorder');

      const blob = new Blob(chunks, { type: mimeType });
      const arrayBuffer = await this._awaitCompletion(blob.arrayBuffer(),operation,'saving the recorded video');
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

      progress(1, 'Ready to save');
      return {
        buffer: arrayBuffer,
        fileName: `BimmerVision-${manifest.id.slice(0, 8)}-${Array.isArray(view) ? view.join("-") : view}${requested > 0 ? '-' + requested + 's' : ''}.${ext}`,
        totalFrames,
        duration
      };
    } finally {
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (_) {}
      }
      recorder.onstop=null;recorder.onerror=null;recorder.ondataavailable=null;
      for(const track of (stream.getTracks?.() || stream.getVideoTracks?.() || []))track.stop?.();
      if(nativeVideo){try{nativeVideo.pause();}catch(_){}}
      else if(operation.epoch===player._clipEpoch){player._seekEpoch=(player._seekEpoch||0)+1;player.seek?.(originalTime);if(wasPlaying)player.play?.();}
    }
  }

  /**
   * Render a complete composite frame (cameras + HUD overlays) to a canvas.
   * Shared by the export encoder loop and live modal preview.
   */
  renderFrame(targetCanvas, options = {}) {
    const overlays = Object.prototype.hasOwnProperty.call(options, 'overlays') ? options.overlays : (options.includeHud !== false ? {
      blinkers: true,
      speed: true,
      speedLimit: true,
      steering: true,
      brake: true,
      gas: true,
      time: true,
      map: true
    } : null);

    const includeMap = overlays ? (overlays.map !== undefined ? Boolean(overlays.map) : Boolean(options.includeMap)) : false;
    const includeDriving=overlays?.drivingView===true,includeSide=includeMap||includeDriving;
    if(includeDriving&&!options.drivingView?.drawTo)throw new Error('Driving view is not ready for export.');
    const hasTelemetryBar = overlays ? (overlays.includeHud !== false && (
      overlays.blinkers !== false ||
      overlays.speed !== false ||
      overlays.speedLimit !== false ||
      overlays.steering !== false ||
      overlays.brake !== false ||
      overlays.gas !== false ||
      overlays.time !== false
    )) : false;

    const exportW = includeSide ? 1920 : 1280;
    const barH = includeSide ? 120 : 80;
    const exportH = includeSide ? (hasTelemetryBar ? 1080 : 960) : (hasTelemetryBar ? 1040 : 960);

    try {
      if (targetCanvas.width !== exportW) targetCanvas.width = exportW;
      if (targetCanvas.height !== exportH) targetCanvas.height = exportH;
    } catch (_) {}

    const ctx = targetCanvas.getContext('2d');
    const w = targetCanvas.width || exportW;
    const h = targetCanvas.height || exportH;
    const view = options.view || 'quad';
    const frames=options.cameraFrames ?? this._cameraFramesAt(options.time ?? this.player?.currentTime ?? 0);
    const cameraView=frames?.cameraView;
    const fr = frames ? frames.fr : options.fr;
    const lr = frames ? frames.lr : options.lr;
    const mapping = options.mapping || (this.player ? this.player.cameraMapping : { phase0: 'frontRear', flipHalves: false });
    const x0 = mapping?.flipHalves ? 640 : 0;
    const x1 = mapping?.flipHalves ? 0 : 640;

    ctx.save();
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    if (cameraView?.single) {
      this._drawRecordedView(ctx,cameraView,frames.rawFrame);
    } else if (Array.isArray(view)) {
      for (const [index, camera] of view.entries()) {
        const image = camera === 'front' || camera === 'rear' ? fr : lr;
        const cropX = camera === 'rear' || camera === 'right' ? x1 : x0;
        const x = index === 2 ? 320 : index * 640;
        const y = view.length === 2 ? 240 : index === 2 ? 480 : 0;
        if (image) {
          try { ctx.drawImage(image, cropX, 0, 640, 480, x, y, 640, 480); } catch (_) {}
        }
        this._drawCameraBadge(ctx, camera.toUpperCase(), x + 20, y + 20);
      }
    } else if (view === 'quad') {
      if (fr) {
        try {
          ctx.drawImage(fr, x0, 0, 640, 480, 0, 0, 640, 480);
          ctx.drawImage(fr, x1, 0, 640, 480, 640, 0, 640, 480);
        } catch (_) {}
      }
      if (lr) {
        try {
          ctx.drawImage(lr, x0, 0, 640, 480, 0, 480, 640, 480);
          ctx.drawImage(lr, x1, 0, 640, 480, 640, 480, 640, 480);
        } catch (_) {}
      }
      this._drawQuadLabels(ctx);
    } else if (view === 'source') {
      if (fr) {
        try { ctx.drawImage(fr, 0, 0, 1280, 480, 0, 0, 1280, 480); } catch (_) {}
      }
      if (lr) {
        try { ctx.drawImage(lr, 0, 0, 1280, 480, 0, 480, 1280, 480); } catch (_) {}
      }
    } else {
      const isFrontRear = ['front', 'rear'].includes(view);
      const isSecondHalf = ['rear', 'right'].includes(view);
      const image = isFrontRear ? fr : lr;
      const cropX = isSecondHalf ? x1 : x0;
      if (image) {
        try {
          ctx.drawImage(image, cropX, 0, 640, 480, 0, 0, 1280, 960);
        } catch (_) {}
      } else {
        ctx.fillStyle = '#11141c';
        ctx.fillRect(0, 0, 1280, 960);
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${view.toUpperCase()} CAMERA`, 640, 480);
        ctx.textAlign = 'left';
      }
    }

    const telem = options.telemetry || (this.player?.parser && options.time != null && this.player?.manifest?.startMonotonicUs != null
      ? this.player.parser.getTelemetryAtTime(options.time, this.player.manifest.startMonotonicUs)
      : null);
    const speedUnit = options.speedUnit || this.player?.speedUnit || 'mph';
    const timeSec = options.time != null ? options.time : (this.player?.currentTime || 0);
    const manifest = options.manifest || this.player?.manifest;

    // Map and Driving view share the original640px sidebar.
    if (includeSide) {
      const mapHeight=includeDriving?480:960;
      if(includeMap) {
        const liveMap = options.map || this.player?.liveMap;
        if(liveMap && typeof liveMap.drawTo==='function')liveMap.drawTo(ctx,1280,0,640,mapHeight,timeSec);
        else this._drawFallbackMap(ctx,1280,0,640,mapHeight,telem,timeSec,manifest);
      }
      if(includeDriving) {
        options.drivingView.drawTo(ctx,1280,includeMap?480:0,640,includeMap?480:960,timeSec);
      }

      // Vertical divider between cameras and map
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(1280, 0);
      ctx.lineTo(1280, 960);
      ctx.stroke();
      ctx.restore();
    }

    // Draw dedicated telemetry console bar below camera playback
    if (hasTelemetryBar) {
      this._drawTelemetryOverlay(ctx, w, 960, barH, telem, speedUnit, timeSec, overlays, manifest);
    }
    ctx.restore();
  }

  renderPreview(targetCanvas, options = {}) {
    this.renderFrame(targetCanvas, options);
  }

  _drawCameraBadge(ctx, text, x, y) {
    ctx.save();
    ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(10, 12, 16, 0.75)";
    ctx.beginPath();
    ctx.roundRect(x, y, 96, 32, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x + 16, y + 23);
    ctx.restore();
  }

  _drawQuadLabels(ctx) {
    ctx.save();
    this._drawCameraBadge(ctx, "FRONT", 20, 20);
    this._drawCameraBadge(ctx, "REAR", 660, 20);
    this._drawCameraBadge(ctx, "LEFT", 20, 500);
    this._drawCameraBadge(ctx, "RIGHT", 660, 500);

    // Dividers
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(640, 0);
    ctx.lineTo(640, 960);
    ctx.moveTo(0, 480);
    ctx.lineTo(1280, 480);
    ctx.stroke();
    ctx.restore();
  }

  _drawTelemetryOverlay(ctx, w, arg3, arg4, telemArg, unitArg, timeSecArg, overlaysArg, manifestArg) {
    let barY = 960;
    let barH = 80;
    let telem = telemArg;
    let unit = unitArg || "mph";
    let timeSec = timeSecArg || 0;
    let overlays = overlaysArg || {};
    let manifest = manifestArg || null;

    if (typeof arg3 === "number" && typeof arg4 === "number") {
      barY = arg3;
      barH = arg4;
    } else {
      // Backward compatibility: (ctx, w, h, telem, unit, timeSec, overlays, manifest)
      const h = arg3;
      telem = arg4;
      unit = telemArg || "mph";
      timeSec = unitArg || 0;
      overlays = timeSecArg || {};
      manifest = overlaysArg || null;
      barY = 960;
      barH = Math.max(48, (h || 1040) - 960);
    }

    if (overlays.includeHud === false) return;

    const ov = {
      blinkers: overlays.blinkers !== false,
      speed: overlays.speed !== false,
      speedLimit: overlays.speedLimit !== false,
      steering: overlays.steering !== false,
      brake: overlays.brake !== false,
      gas: overlays.gas !== false,
      time: overlays.time !== false,
    };

    const anyActive = ov.blinkers || ov.speed || ov.speedLimit || ov.steering || ov.brake || ov.gas || ov.time;
    if (!anyActive) return;

    // RULE: If ANY metadata is visible other than current time, the BimmerVision logo should be visible in the blinker bar.
    const hasOtherMetadata = Boolean(ov.blinkers || ov.speed || ov.speedLimit || ov.steering || ov.brake || ov.gas);
    const showLogo = hasOtherMetadata;

    if (!telem) {
      telem = { speedKph: 0, speedMph: 0, brakePressed: false, acceleratorPercent: 0, steeringAngleDeg: 0, indicator: "off", speedLimit: null };
    }

    ctx.save();

    // Draw functions for each cockpit component
    const indStr = String(telem.indicator || telem.blinker || "off").toLowerCase();
    const isLeftTurn = indStr === 'left' || indStr === 'both' || indStr === 'hazard' || indStr.includes('links') || indStr === 'l';
    const isRightTurn = indStr === 'right' || indStr === 'both' || indStr === 'hazard' || indStr.includes('rechts') || indStr === 'r';
    // Automotive blinking cadence: 1.5 Hz (0.667s period: 333ms ON, 333ms OFF)
    const isBlinkerFlashOn = (timeSec % 0.667) < 0.333;

    const drawBlinkerLeft = (x, centerY) => {
      const active = isLeftTurn && isBlinkerFlashOn;
      ctx.save();
      if (active) {
        ctx.shadowColor = '#38D47A';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#38D47A';
      } else {
        ctx.fillStyle = 'rgba(160, 170, 195, 0.35)';
      }
      ctx.beginPath();
      ctx.translate(x + 2, centerY);
      ctx.scale(1.6, 1.6);
      const ax = 0, ay = 0;
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + 16, ay - 13);
      ctx.lineTo(ax + 16, ay - 5);
      ctx.lineTo(ax + 30, ay - 5);
      ctx.lineTo(ax + 30, ay + 5);
      ctx.lineTo(ax + 16, ay + 5);
      ctx.lineTo(ax + 16, ay + 13);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawBlinkerRight = (x, centerY) => {
      const active = isRightTurn && isBlinkerFlashOn;
      ctx.save();
      if (active) {
        ctx.shadowColor = '#38D47A';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#38D47A';
      } else {
        ctx.fillStyle = 'rgba(160, 170, 195, 0.35)';
      }
      ctx.beginPath();
      ctx.translate(x + 2, centerY);
      ctx.scale(1.6, 1.6);
      const ax = 0, ay = 0;
      ctx.moveTo(ax + 30, ay);
      ctx.lineTo(ax + 14, ay - 13);
      ctx.lineTo(ax + 14, ay - 5);
      ctx.lineTo(ax, ay - 5);
      ctx.lineTo(ax, ay + 5);
      ctx.lineTo(ax + 14, ay + 5);
      ctx.lineTo(ax + 14, ay + 13);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawSpeedCluster = (x, centerY) => {
      let curX = x;
      if (ov.speed) {
        const speed = unit === "mph" ? (telem.speedMph ?? 0) : (telem.speedKph ?? 0);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(`${speed}`, curX, centerY + 15);
        const spdW = measure(String(speed), 44);
        ctx.fillStyle = "rgba(160, 170, 195, 0.85)";
        ctx.font = "bold 15px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(unit.toUpperCase(), curX + spdW + 6, centerY + 13);
        curX += spdW + 6 + measure(unit.toUpperCase(), 15);
      }
      if (ov.speedLimit) {
        const bw = 46, bh = 54;
        const bx = curX + (ov.speed ? 8 : 0);
        const by = centerY - Math.round(bh / 2);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 6);
        ctx.fill();
        ctx.strokeStyle = "#c01025";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#333333";
        ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText("SPEED", bx + 7, by + 14);
        ctx.fillStyle = "#0c0e14";
        ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, sans-serif";
        let limitVal = telem.speedLimit;
        let limitUnit = telem.speedLimitUnit || "mph";
        if (limitVal == null && this.player?.currentSpeedLimit) {
          limitVal = this.player.currentSpeedLimit.limit;
          limitUnit = this.player.currentSpeedLimit.unit || "mph";
        }
        if (limitVal != null) {
          if (unit === "km/h" && limitUnit === "mph") {
            limitVal = Math.round(limitVal * 1.60934);
          } else if (unit === "mph" && limitUnit === "km/h") {
            limitVal = Math.round(limitVal * 0.621371);
          }
        }
        const limitStr = limitVal != null ? String(limitVal) : "—";
        const lw = ctx.measureText ? ctx.measureText(limitStr).width : 14;
        ctx.fillText(limitStr, bx + Math.max(4, Math.round((bw - lw) / 2)), by + 39);
      }
    };

    const drawSteering = (x, centerY) => {
      const angleDeg = telem.steeringAngleDeg || 0;
      const angleRad = (angleDeg * Math.PI) / 180;
      const cx = x + 38;
      const cy = centerY;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);
      ctx.scale(1.5, 1.5);
      const hornWheel = ClipExporter.assets.wheelHorn;
      const wheel = telem.hornPressed === true && hornWheel && hornWheel.complete && hornWheel.naturalWidth ? hornWheel : ClipExporter.assets.wheel;
      if (wheel && wheel.complete && wheel.naturalWidth) {
        try {
          ctx.drawImage(wheel, -24, -24, 48, 48);
        } catch (_) {}
      } else {
        // High-fidelity vector steering wheel
        ctx.strokeStyle = "#c8d0e0";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#1e222d";
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#3da8f2";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = "#8a94a6";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-24, 0); ctx.lineTo(-9, 0);
        ctx.moveTo(24, 0); ctx.lineTo(9, 0);
        ctx.moveTo(0, 9); ctx.lineTo(0, 24);
        ctx.stroke();
      }
      ctx.restore();
    };

    const font = (size, family = '-apple-system, BlinkMacSystemFont, sans-serif') => `bold ${size}px ${family}`;
    const measure = (text, size, family) => {
      ctx.font = font(size, family);
      return ctx.measureText(text).width;
    };
    const usableImage = img => img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    const wordmark = usableImage(ClipExporter.assets.wordmark) ? ClipExporter.assets.wordmark : null;
    const eye = usableImage(ClipExporter.assets.eye) ? ClipExporter.assets.eye : null;
    const brandTextWidth = measure('BIMMERVISION', 16);
    const bimmerWidth = measure('BIMMER', 18);
    const visionWidth = measure('VISION', 18);
    // Reserve exactly what is drawn, including unusually wide source artwork.
    const imageSize = (img, maxW, maxH) => {
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      return { w: img.naturalWidth * scale, h: img.naturalHeight * scale };
    };
    const brandImage = wordmark ? imageSize(wordmark, 184, 32) : eye ? imageSize(eye, 54, 36) : null;
    const brandWidth = wordmark ? brandImage.w : eye ? brandImage.w + 8 + brandTextWidth : 36 + bimmerWidth + visionWidth;
    const drawBrandLogo = (x, centerY) => {
      ctx.save();
      if (wordmark) {
        try { ctx.drawImage(wordmark, x, centerY - brandImage.h / 2, brandImage.w, brandImage.h); } catch (_) {}
      } else if (eye) {
        try { ctx.drawImage(eye, x, centerY - brandImage.h / 2, brandImage.w, brandImage.h); } catch (_) {}
        ctx.fillStyle = '#ffffff';
        ctx.font = font(16);
        ctx.fillText('BIMMERVISION', x + brandImage.w + 8, centerY + 6);
      } else {
        ctx.fillStyle = 'rgba(61, 168, 242, 0.25)';
        ctx.beginPath();
        ctx.arc(x + 16, centerY, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3da8f2';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = '#3da8f2';
        ctx.beginPath();
        ctx.arc(x + 16, centerY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = font(18);
        ctx.fillText('BIMMER', x + 36, centerY + 6);
        ctx.fillStyle = '#3da8f2';
        ctx.fillText('VISION', x + 36 + bimmerWidth, centerY + 6);
      }
      ctx.restore();
    };

    const drawPedals = (x, centerY) => {
      let px = x;
      const pedal = (kind, active) => {
        ctx.save();
        const color=active?(kind==='brake'?'#EE2440':'#38D47A'):'#9aa4b3';
        ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';
        ctx.translate(px,centerY-29);ctx.scale(.8,.8);
        ctx.beginPath();
        if(kind==='brake'){
          ctx.moveTo(32,9);ctx.lineTo(32,19);ctx.stroke();
          ctx.beginPath();ctx.roundRect(12,19,40,26,5);ctx.stroke();
          ctx.beginPath();ctx.moveTo(21,27);ctx.lineTo(43,27);ctx.moveTo(21,36);ctx.lineTo(43,36);
        }else{
          ctx.roundRect(23,9,20,42,5);ctx.stroke();ctx.beginPath();
          ctx.moveTo(29,19);ctx.lineTo(29,41);ctx.moveTo(37,19);ctx.lineTo(37,41);ctx.moveTo(19,55);ctx.lineTo(47,55);
        }
        ctx.stroke();ctx.restore();
        ctx.save();ctx.fillStyle=color;ctx.font='bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(kind==='brake'?'BRAKE':'GAS',px+(kind==='brake'?9:16),centerY+30);ctx.restore();
      };
      if(ov.brake){pedal('brake',Boolean(telem.brakePressed));px+=58;}
      if(ov.gas)pedal('gas',Boolean(telem.gasPressed||(telem.acceleratorPercent??0)>5));
    };

    const startMs = new Date(manifest?.startedAt || this.player?.manifest?.startedAt || '').getTime();
    const date = Number.isFinite(startMs) ? new Date(startMs + timeSec * 1000) : null;
    const dateStr = date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const clockStr = date ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
      : `${String(Math.floor(timeSec / 60)).padStart(2, '0')}:${(timeSec % 60).toFixed(2).padStart(5, '0')}`;
    const timeWidth = Math.max(dateStr ? measure(dateStr, 13) : 0, measure(clockStr, date ? 16 : 17, 'monospace'));
    const drawTime = (x, centerY) => {
      ctx.save();
      if (dateStr) {
        ctx.font = font(13);
        ctx.fillStyle = 'rgba(180, 195, 220, 0.9)';
        ctx.fillText(dateStr, x, centerY - 8);
      }
      ctx.font = font(date ? 16 : 17, 'monospace');
      ctx.fillStyle = '#ffffff';
      ctx.fillText(clockStr, x, centerY + (date ? 13 : 6));
      ctx.restore();
    };

    // 1. Left cluster: Speed & Speed Limit
    const leftModules = [];
    if (ov.speed || ov.speedLimit) {
      let w = 0;
      if (ov.speed) {
        const spd = unit === "mph" ? (telem.speedMph ?? 0) : (telem.speedKph ?? 0);
        w += measure(String(spd), 44) + 6 + measure(unit.toUpperCase(), 15);
      }
      if (ov.speedLimit) w += (ov.speed ? 60 : 50);
      leftModules.push({ id: 'speed', width: w, draw: drawSpeedCluster });
    }

    // 2. Center cluster: Blinker Left | Steering Wheel | Blinker Right (matching web hud-center)
    const centerModules = [];
    if (ov.blinkers) {
      centerModules.push({ id: 'blinker_left', width: 52, draw: drawBlinkerLeft });
    }
    if (ov.steering) {
      centerModules.push({ id: 'steering', width: 76, draw: drawSteering });
    }
    if (ov.blinkers) {
      centerModules.push({ id: 'blinker_right', width: 52, draw: drawBlinkerRight });
    }

    // 3. Right cluster: Pedals (Brake/Gas) | BimmerVision Logo | Time (matching web hud-right)
    const rightModules = [];
    if (ov.brake || ov.gas) {
      let w = 0;
      if (ov.brake) w += 64;
      if (ov.gas) w += 44;
      rightModules.push({ id: 'pedals', width: w, draw: drawPedals });
    }
    if (showLogo) {
      rightModules.push({ id: 'logo', width: brandWidth, draw: drawBrandLogo });
    }
    if (ov.time) {
      rightModules.push({ id: 'time', width: timeWidth, draw: drawTime });
    }

    const totalCount = leftModules.length + centerModules.length + rightModules.length;
    if (totalCount === 0) {
      ctx.restore();
      return;
    }

    // Draw full-width bottom dashboard bar background below camera area
    ctx.fillStyle = "rgba(12, 14, 20, 0.98)";
    ctx.beginPath();
    ctx.roundRect(0, barY, w, barH, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, barY);
    ctx.lineTo(w, barY);
    ctx.stroke();

    const centerY = barY + Math.round(barH / 2);
    const gap = 16;
    const paddingX = w > 1280 ? 56 : 24;
    const clusterWidth = modules => modules.reduce((sum, mod) => sum + mod.width, 0) + Math.max(0, modules.length - 1) * gap;
    const leftW = clusterWidth(leftModules), centerW = clusterWidth(centerModules), rightW = clusterWidth(rightModules);
    const clusterCount = [leftModules, centerModules, rightModules].filter(modules => modules.length).length;
    const needed = leftW + centerW + rightW + Math.max(0, clusterCount - 1) * gap;
    const scale = Math.min(1, (w - 2 * paddingX) / needed);
    const available = (w - 2 * paddingX) / scale;
    const drawCluster = (modules, x) => {
      for (const mod of modules) {
        mod.draw(x, 0);
        x += mod.width + gap;
      }
    };
    ctx.save();
    ctx.translate(paddingX, centerY);
    ctx.scale(scale, scale);
    if (totalCount === 1 && rightModules[0]?.id === 'time') {
      drawTime((available - timeWidth) / 2, 0);
    } else {
      drawCluster(leftModules, 0);
      const rightX = available - rightW;
      // Keep the cockpit near the frame center while respecting both neighbors.
      const minCenterX = leftW ? leftW + gap : 0;
      const maxCenterX = rightW ? rightX - gap - centerW : available - centerW;
      const centerX = Math.max(minCenterX, Math.min((available - centerW) / 2, maxCenterX));
      drawCluster(centerModules, centerX);
      drawCluster(rightModules, rightX);
    }
    ctx.restore();

    ctx.restore();
  }

  _drawFallbackMap(ctx, x, y, w, h, telem, timeSec, manifest) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);

    // Dark base
    ctx.fillStyle = "#121214";
    ctx.fillRect(0, 0, w, h);

    // Vector grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= w; gx += 64) {
      ctx.beginPath();
      ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += 64) {
      ctx.beginPath();
      ctx.moveTo(0, gy); ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const route = (this.player?.parser && manifest?.startMonotonicUs != null)
      ? this.player.parser.getRouteSeries(manifest.startMonotonicUs)
      : (this.player?.routeSeries || []);

    if (route && route.length > 1) {
      let minLat = Infinity, maxLat = -Infinity;
      let minLon = Infinity, maxLon = -Infinity;
      for (const pt of route) {
        if (pt.latitude < minLat) minLat = pt.latitude;
        if (pt.latitude > maxLat) maxLat = pt.latitude;
        if (pt.longitude < minLon) minLon = pt.longitude;
        if (pt.longitude > maxLon) maxLon = pt.longitude;
      }
      const pad = 48;
      const dLat = (maxLat - minLat) || 0.001;
      const dLon = (maxLon - minLon) || 0.001;
      const mapX = (lon) => pad + ((lon - minLon) / dLon) * (w - pad * 2);
      const mapY = (lat) => h - pad - ((lat - minLat) / dLat) * (h - pad * 2);

      ctx.beginPath();
      route.forEach((pt, idx) => {
        const px = mapX(pt.longitude);
        const py = mapY(pt.latitude);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = "rgba(61, 168, 242, 0.4)";
      ctx.lineWidth = 6;
      ctx.stroke();

      ctx.strokeStyle = "#3da8f2";
      ctx.lineWidth = 3;
      ctx.stroke();

      const lat = telem?.latitude ?? route[0].latitude;
      const lon = telem?.longitude ?? route[0].longitude;
      const vx = mapX(lon);
      const vy = mapY(lat);

      ctx.fillStyle = "#38D47A";
      ctx.beginPath();
      ctx.arc(vx, vy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.44)";
      ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GPS Route Map", w / 2, h / 2);
    }

    if (telem && telem.latitude != null && telem.longitude != null) {
      const coordText = `${telem.latitude.toFixed(5)}°, ${telem.longitude.toFixed(5)}°`;
      ctx.fillStyle = "rgba(11, 11, 12, 0.88)";
      ctx.beginPath();
      ctx.roundRect(16, 16, 180, 26, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(coordText, 24, 29);
    }

    ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("© OpenStreetMap", 12, h - 10);

    ctx.restore();
  }

  _extractDecoderConfigFromChunk(chunk) {
    if (!chunk) return null;
    try {
      const byteLen = chunk.byteLength || (chunk.data ? chunk.data.byteLength : 0);
      if (!byteLen) return null;
      const data = new Uint8Array(byteLen);
      if (typeof chunk.copyTo === "function") {
        chunk.copyTo(data);
      } else if (chunk.data) {
        data.set(new Uint8Array(chunk.data));
      }
      if (data.length === 0) return null;

      let sps = null;
      let pps = null;

      // Scan for Annex B NAL start codes [0, 0, 0, 1] or [0, 0, 1]
      for (let i = 0; i < data.length - 4; i++) {
        let nalStart = -1;
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
          nalStart = i + 3;
        } else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
          nalStart = i + 4;
        }
        if (nalStart > 0) {
          const nalType = data[nalStart] & 31;
          let nextStart = data.length;
          for (let j = nalStart; j < data.length - 3; j++) {
            if (data[j] === 0 && data[j + 1] === 0 && (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))) {
              nextStart = j;
              break;
            }
          }
          const nal = data.subarray(nalStart, nextStart);
          if (nalType === 7 && !sps) sps = nal;
          if (nalType === 8 && !pps) pps = nal;
        }
      }

      // If AVCC format (4-byte length prefixes)
      if (!sps && !pps && data.length > 8) {
        let offset = 0;
        while (offset + 4 < data.length) {
          const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
          offset += 4;
          if (len <= 0 || offset + len > data.length) break;
          const nal = data.subarray(offset, offset + len);
          const type = nal[0] & 31;
          if (type === 7 && !sps) sps = nal;
          if (type === 8 && !pps) pps = nal;
          offset += len;
        }
      }

      if (sps && pps && typeof RtpH264Assembler !== "undefined") {
        return {
          codec: "avc1.640028",
          description: RtpH264Assembler.makeAvcC(sps, pps),
          colorSpace: {
            primaries: "bt709",
            transfer: "bt709",
            matrix: "bt709",
            fullRange: false
          }
        };
      }
    } catch (_) {}
    return null;
  }
}

// Preload browser image assets if running in browser
if (typeof Image !== 'undefined') {
  try {
    // Finish loading/decoding both wheels before the first encoded frame.
    // A failed or stalled optional asset stays unavailable for this export path.
    ClipExporter.wheelAssetsReady = Promise.all([
      ['wheel', 'assets/wheel-face.png'], ['wheelHorn', 'assets/wheel-horn.png']
    ].map(([key, src]) => new Promise(resolve => {
      const img = new Image();
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.removeEventListener('load', loaded);
        img.removeEventListener('error', failed);
        if (!ok) ClipExporter.assets[key] = null;
        resolve();
      };
      const failed = () => finish(false);
      const loaded = () => {
        if (!img.naturalWidth) return failed();
        if (typeof img.decode === 'function') img.decode().then(() => finish(true), failed);
        else finish(true);
      };
      const timer = setTimeout(failed, 5000);
      img.addEventListener('load', loaded, {once:true});
      img.addEventListener('error', failed, {once:true});
      ClipExporter.assets[key] = img;
      img.src = src;
      if (img.complete) loaded();
    })));
    const wm = new Image(); wm.src = 'assets/bimmervision-wordmark.png'; ClipExporter.assets.wordmark = wm;
    const eye = new Image(); eye.src = 'assets/bimmervision-eye.png'; ClipExporter.assets.eye = eye;
  } catch (_) {}
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ClipExporter };
}
