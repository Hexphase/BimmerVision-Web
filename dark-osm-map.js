/**
 * BimmerVision Dark OSM Map Component
 * High-performance dark-themed OpenStreetMap renderer with GPS route polyline,
 * start/end endpoints, live vehicle location marker, and coordinate pill.
 * 100% compliant with DarkOsmMap.cs in the Windows and Mac desktop apps.
 */
class DarkOsmMap {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.fitAll = options.fitAll !== false;
    this.track = options.track || []; // [{ at, latitude, longitude }]
    this.currentTime = 0;

    this.tileCache = new Map(); // key -> HTMLCanvasElement (pre-darkened)
    this.pendingTiles = new Set();
    this.failedTiles = new Map();
    this.defaultZoom = 16;

    // Use ResizeObserver for automatic DPI and container adaptation
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.handleResize());
      this.ro.observe(this.canvas);
    }
    window.addEventListener("resize", () => this.handleResize());
    this.handleResize();
  }

  handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    if (w > 0 && h > 0) {
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      this.render();
    }
  }

  setTrack(track) {
    this.track = track || [];
    this.smoothHeading = null;
    this.handleResize();
  }

  setTime(seconds) {
    this.currentTime = seconds;
    if (!this.fitAll) {
      this.render();
    }
  }

  render() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || 320;
    const h = rect.height || 170;

    if (w <= 0 || h <= 0) return;

    // Ensure backing store matches CSS dimensions * dpr
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark Tesla/BimmerVision base
    ctx.fillStyle = "#121214";
    ctx.fillRect(0, 0, w, h);

    if (!this.track || this.track.length === 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.44)";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.emptyMessage || "Location was not recorded", w / 2, h / 2);
      this._drawAttribution(ctx, w, h);
      return;
    }

    if (this.fitAll) {
      this._renderFitAll(ctx, w, h);
    } else {
      this._renderLiveTracking(ctx, w, h);
    }

    this._drawAttribution(ctx, w, h);
  }

  /**
   * Directly renders the live tracking map into an external 2D context at (x, y, w, h).
   * Used by Exporter for embedding the GPS route map into video export frames.
   */
  drawTo(targetCtx, x, y, w, h, time) {
    if (!targetCtx || w <= 0 || h <= 0) return;
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.rect(x, y, w, h);
    targetCtx.clip();
    targetCtx.translate(x, y);

    // Dark base
    targetCtx.fillStyle = "#121214";
    targetCtx.fillRect(0, 0, w, h);

    if (!this.track || this.track.length === 0) {
      targetCtx.fillStyle = "rgba(255, 255, 255, 0.44)";
      targetCtx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      targetCtx.textAlign = "center";
      targetCtx.textBaseline = "middle";
      targetCtx.fillText("Location was not recorded", w / 2, h / 2);
      this._drawAttribution(targetCtx, w, h);
      targetCtx.restore();
      return;
    }

    const t = typeof time === "number" ? time : this.currentTime;
    const vehicleFix = this._getVehicleFix(t);
    const zoom = this.defaultZoom || 16;
    const centerWorld = this._project(vehicleFix.latitude, vehicleFix.longitude, zoom);

    // 1. Draw tiles centered on current vehicle position
    this._drawTiles(targetCtx, w, h, zoom, centerWorld);

    // 2. Draw route polyline
    this._drawRoute(targetCtx, w, h, zoom, centerWorld, vehicleFix);

    // 3. Draw Start & End markers
    const startPt = this.track[0];
    const endPt = this.track[this.track.length - 1];
    this._drawMarker(targetCtx, w, h, zoom, centerWorld, startPt, "#3DA8F2", "START");
    this._drawMarker(targetCtx, w, h, zoom, centerWorld, endPt, "#EE2440", "END");

    // 4. Draw Vehicle Navigation Arrow in center
    this._drawVehicleArrow(targetCtx, w / 2, h / 2, vehicleFix.heading);

    // 5. Coordinate pill
    this._drawCoordinatePill(targetCtx, vehicleFix);

    // 6. Attribution
    this._drawAttribution(targetCtx, w, h);

    targetCtx.restore();
  }

  _renderFitAll(ctx, w, h) {
    // 1. Calculate bounding box
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    for (const pt of this.track) {
      if (pt.latitude < minLat) minLat = pt.latitude;
      if (pt.latitude > maxLat) maxLat = pt.latitude;
      if (pt.longitude < minLon) minLon = pt.longitude;
      if (pt.longitude > maxLon) maxLon = pt.longitude;
    }

    const padLat = Math.max((maxLat - minLat) * 0.28, 0.0035);
    const padLon = Math.max((maxLon - minLon) * 0.28, 0.0045);
    minLat -= padLat; maxLat += padLat;
    minLon -= padLon; maxLon += padLon;

    // Determine zoom
    let zoom = 16;
    for (let z = 18; z >= 2; z--) {
      const p1 = this._project(maxLat, minLon, z);
      const p2 = this._project(minLat, maxLon, z);
      if (Math.abs(p2.x - p1.x) <= w && Math.abs(p2.y - p1.y) <= h) {
        zoom = z;
        break;
      }
    }

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const centerWorld = this._project(centerLat, centerLon, zoom);

    // 2. Draw map tiles
    this._drawTiles(ctx, w, h, zoom, centerWorld);

    // 3. Draw route polyline
    this._drawRoute(ctx, w, h, zoom, centerWorld, null);

    // 4. Draw Start & End markers
    const startPt = this.track[0];
    const endPt = this.track[this.track.length - 1];
    this._drawMarker(ctx, w, h, zoom, centerWorld, startPt, "#3DA8F2", "START");
    this._drawMarker(ctx, w, h, zoom, centerWorld, endPt, "#EE2440", "END");

    // 5. Coordinate pill
    this._drawCoordinatePill(ctx, startPt);
  }

  _renderLiveTracking(ctx, w, h) {
    // Interpolate vehicle position smoothly along the track based on currentTime
    const vehicleFix = this._getVehicleFix(this.currentTime);
    const zoom = this.defaultZoom;
    const centerWorld = this._project(vehicleFix.latitude, vehicleFix.longitude, zoom);

    // 1. Draw tiles centered on current vehicle position
    this._drawTiles(ctx, w, h, zoom, centerWorld);

    // 2. Draw route polyline (with driven breadcrumbs up to current vehicle position)
    this._drawRoute(ctx, w, h, zoom, centerWorld, vehicleFix);

    // 3. Draw Start & End markers if near or visible
    const startPt = this.track[0];
    const endPt = this.track[this.track.length - 1];
    this._drawMarker(ctx, w, h, zoom, centerWorld, startPt, "#3DA8F2", "START");
    this._drawMarker(ctx, w, h, zoom, centerWorld, endPt, "#EE2440", "END");

    // 4. Draw Vehicle Navigation Arrow in center
    this._drawVehicleArrow(ctx, w / 2, h / 2, vehicleFix.heading);

    // 5. Coordinate pill
    this._drawCoordinatePill(ctx, vehicleFix);
  }

  _getVehicleFix(time) {
    if (!this.track || this.track.length === 0) {
      return { latitude: 0, longitude: 0, heading: 0 };
    }
    if (this.track.length === 1) {
      return { latitude: this.track[0].latitude, longitude: this.track[0].longitude, heading: 0 };
    }

    // Find bounding fixes
    let p0 = this.track[0];
    let p1 = this.track[1];
    let idx = 0;

    if (time <= p0.at) {
      idx = 0;
      p0 = this.track[0];
      p1 = this.track[Math.min(1, this.track.length - 1)];
    } else {
      const last = this.track[this.track.length - 1];
      if (time >= last.at) {
        idx = this.track.length - 1;
        p0 = this.track[Math.max(0, this.track.length - 2)];
        p1 = last;
      } else {
        for (let i = 0; i < this.track.length - 1; i++) {
          if (time >= this.track[i].at && time <= this.track[i + 1].at) {
            idx = i;
            p0 = this.track[i];
            p1 = this.track[i + 1];
            break;
          }
        }
      }
    }

    const delta = p1.at - p0.at;
    const t = delta > 0 ? (time - p0.at) / delta : 0;
    const lat = p0.latitude + (p1.latitude - p0.latitude) * t;
    const lon = p0.longitude + (p1.longitude - p0.longitude) * t;

    // Calculate stable vehicle travel heading using a lookahead window (>= 3.0 meters)
    // to filter out stationary GPS noise and identical lat/lon CAN records
    const rawHeading = this._calcStableHeading(idx, { latitude: lat, longitude: lon });

    // Smooth heading with angular low-pass filter (handles 360/0 degree wrapping cleanly)
    if (this.smoothHeading === undefined || this.smoothHeading === null) {
      this.smoothHeading = rawHeading;
    } else {
      let diff = rawHeading - this.smoothHeading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      this.smoothHeading = this.smoothHeading + diff * 0.25;
      while (this.smoothHeading > Math.PI) this.smoothHeading -= 2 * Math.PI;
      while (this.smoothHeading < -Math.PI) this.smoothHeading += 2 * Math.PI;
    }

    return { latitude: lat, longitude: lon, heading: this.smoothHeading };
  }

  _calcStableHeading(currentIdx, currentPos) {
    // 1. Search forward for a point at least 3 meters away
    let aheadPt = null;
    for (let i = currentIdx + 1; i < Math.min(this.track.length, currentIdx + 30); i++) {
      if (this._geoDistMeters(currentPos, this.track[i]) >= 3.0) {
        aheadPt = this.track[i];
        break;
      }
    }
    if (aheadPt) {
      return this._calcHeading(currentPos, aheadPt);
    }

    // 2. If near end of route or stopped, look backward for a point at least 3 meters behind
    let behindPt = null;
    for (let i = currentIdx - 1; i >= Math.max(0, currentIdx - 30); i--) {
      if (this._geoDistMeters(this.track[i], currentPos) >= 3.0) {
        behindPt = this.track[i];
        break;
      }
    }
    if (behindPt) {
      return this._calcHeading(behindPt, currentPos);
    }

    // 3. Fallback to last known heading
    return (this.smoothHeading !== undefined && this.smoothHeading !== null) ? this.smoothHeading : 0;
  }

  _geoDistMeters(p0, p1) {
    const latMid = (p0.latitude + p1.latitude) * 0.5 * Math.PI / 180;
    const dLat = (p1.latitude - p0.latitude) * 111320;
    const dLon = (p1.longitude - p0.longitude) * 111320 * Math.cos(latMid);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }

  _calcHeading(p0, p1) {
    const lat1 = p0.latitude * Math.PI / 180;
    const lat2 = p1.latitude * Math.PI / 180;
    const dLon = (p1.longitude - p0.longitude) * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.atan2(y, x);
  }

  _loadTile(tileKey, zoom, x, y) {
    if(this.pendingTiles.has(tileKey) || this.pendingTiles.size>=8) return;
    this.pendingTiles.add(tileKey);
    let attempt=0;
    const load=(direct)=>{
      const token=++attempt, image=new Image();
      image.crossOrigin='anonymous';
      let done=false,timer;
      const finish=(ok)=>{
        if(done || token!==attempt)return;
        done=true;clearTimeout(timer);image.onload=null;image.onerror=null;
        if(!ok)image.src='';
        this.pendingTiles.delete(tileKey);
        if(ok){this.failedTiles.delete(tileKey);this.tileCache.set(tileKey,image);while(this.tileCache.size>256)this.tileCache.delete(this.tileCache.keys().next().value);}
        else {this.failedTiles.set(tileKey,Date.now());while(this.failedTiles.size>256)this.failedTiles.delete(this.failedTiles.keys().next().value);}
        this.render();
      };
      image.onload=()=>finish(true);image.onerror=()=>finish(false);
      timer=setTimeout(()=>finish(false),8000);
      // External Image requests carry no recorder bearer headers. Anonymous CORS
      // also keeps the map canvas usable by video export.
      image.src=`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
    };
    load(true);
  }

  _drawTiles(ctx, w, h, zoom, centerWorld) {
    const tileSize = 256;
    const originX = w / 2 - centerWorld.x;
    const originY = h / 2 - centerWorld.y;

    const startTileX = Math.floor((-originX) / tileSize);
    const endTileX = Math.floor((w - originX) / tileSize);
    const startTileY = Math.floor((-originY) / tileSize);
    const endTileY = Math.floor((h - originY) / tileSize);

    const maxTile = 1 << zoom;
    let visibleFailure=false;

    // Draw dark vector grid lines first (ensures crisp display on vehicle Wi-Fi)
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    for (let tx = startTileX; tx <= endTileX; tx++) {
      const posX = originX + tx * tileSize;
      ctx.beginPath();
      ctx.moveTo(posX, 0);
      ctx.lineTo(posX, h);
      ctx.stroke();
    }
    for (let ty = startTileY; ty <= endTileY; ty++) {
      const posY = originY + ty * tileSize;
      ctx.beginPath();
      ctx.moveTo(0, posY);
      ctx.lineTo(w, posY);
      ctx.stroke();
    }
    ctx.restore();

    for (let tx = startTileX; tx <= endTileX; tx++) {
      for (let ty = startTileY; ty <= endTileY; ty++) {
        if (ty < 0 || ty >= maxTile) continue;
        const normalizedTx = ((tx % maxTile) + maxTile) % maxTile;

        const tileKey = `${zoom}_${normalizedTx}_${ty}`;
        const cachedImg = this.tileCache.get(tileKey);
        const posX = Math.round(originX + tx * tileSize);
        const posY = Math.round(originY + ty * tileSize);

        if (cachedImg && cachedImg.width > 0) {
          ctx.save();
          ctx.filter='invert(92%) hue-rotate(180deg) saturate(55%) brightness(85%)';
          ctx.drawImage(cachedImg, posX, posY, tileSize, tileSize);
          ctx.restore();
        } else {
          if(this.failedTiles.has(tileKey))visibleFailure=true;
          if (!this.pendingTiles.has(tileKey) && Date.now()-(this.failedTiles.get(tileKey)||0)>30000) {
            this._loadTile(tileKey,zoom,normalizedTx,ty);
          }
        }
      }
    }
    if(visibleFailure){ctx.fillStyle='#10141c';ctx.fillRect(6,6,230,22);ctx.fillStyle='#c6cdd8';ctx.font='10px system-ui';ctx.fillText('Street map unavailable • Internet needed',14,21);}
  }

  _drawRoute(ctx, w, h, zoom, centerWorld, vehicleFix) {
    if (this.track.length < 2) return;

    const originX = w / 2 - centerWorld.x;
    const originY = h / 2 - centerWorld.y;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Full planned route path (subtle neon cyan)
    ctx.beginPath();
    for (let i = 0; i < this.track.length; i++) {
      const p = this._project(this.track[i].latitude, this.track[i].longitude, zoom);
      const sx = originX + p.x;
      const sy = originY + p.y;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }

    // Outer route glow
    ctx.strokeStyle = "rgba(61, 168, 242, 0.35)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Inner crisp route line
    ctx.strokeStyle = "#3DA8F2";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 2. Driven breadcrumbs highlight (up to current time)
    if (vehicleFix) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < this.track.length; i++) {
        if (this.track[i].at <= this.currentTime) {
          const p = this._project(this.track[i].latitude, this.track[i].longitude, zoom);
          const sx = originX + p.x;
          const sy = originY + p.y;
          if (!started) { ctx.moveTo(sx, sy); started = true; }
          else ctx.lineTo(sx, sy);
        } else {
          break;
        }
      }

      // Add vehicle current position
      const vp = this._project(vehicleFix.latitude, vehicleFix.longitude, zoom);
      if (started) {
        ctx.lineTo(originX + vp.x, originY + vp.y);
      }

      ctx.strokeStyle = "rgba(48, 67, 166, 0.9)";
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawMarker(ctx, w, h, zoom, centerWorld, pt, color, label) {
    const originX = w / 2 - centerWorld.x;
    const originY = h / 2 - centerWorld.y;
    const p = this._project(pt.latitude, pt.longitude, zoom);
    const sx = Math.round(originX + p.x);
    const sy = Math.round(originY + p.y);

    // Only draw if within bounds
    if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) return;

    ctx.save();
    // Halo glow
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fill();

    // White core
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // Label tag
    ctx.font = "bold 9px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(10, 11, 14, 0.88)";
    ctx.beginPath();
    ctx.roundRect(sx - 18, sy - 22, 36, 16, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, sx, sy - 14);
    ctx.restore();
  }

  _drawVehicleArrow(ctx, x, y, angleRad) {
    ctx.save();
    ctx.translate(x, y);

    // Pulsing radar aura
    const pulseRadius = 14 + (Math.sin(Date.now() / 250) * 2);
    ctx.beginPath();
    ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(61, 168, 242, 0.22)";
    ctx.fill();

    ctx.rotate(angleRad); // Rotate to true vehicle heading

    // Navigation chevron
    ctx.shadowColor = "#3DA8F2";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fillStyle = "#3DA8F2";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  _drawCoordinatePill(ctx, pt) {
    if (!pt) return;
    const ns = pt.latitude >= 0 ? "N" : "S";
    const ew = pt.longitude >= 0 ? "E" : "W";
    const text = `${Math.abs(pt.latitude).toFixed(5)}° ${ns}, ${Math.abs(pt.longitude).toFixed(5)}° ${ew}`;

    ctx.save();
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'SF Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const textWidth = ctx.measureText(text).width;
    const pillW = textWidth + 14;
    const pillH = 20;
    const pillX = 8;
    const pillY = 8;

    ctx.fillStyle = "rgba(11, 11, 12, 0.88)";
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillText(text, pillX + 7, pillY + 5);
    ctx.restore();
  }

  _drawAttribution(ctx, w, h) {
    ctx.save();
    ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("© OpenStreetMap contributors", 8, h - 5);
    ctx.restore();
  }

  _project(lat, lon, zoom) {
    const sinLat = Math.sin(lat * Math.PI / 180);
    const clampedSinLat = Math.max(-0.9999, Math.min(0.9999, sinLat));
    const x = ((lon + 180.0) / 360.0) * (256 << zoom);
    const y = (0.5 - Math.log((1.0 + clampedSinLat) / (1.0 - clampedSinLat)) / (4.0 * Math.PI)) * (256 << zoom);
    return { x, y };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DarkOsmMap };
}