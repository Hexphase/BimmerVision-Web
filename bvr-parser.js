const PerceptionCapture = typeof BVPerceptionCapture !== 'undefined' ? BVPerceptionCapture : (typeof module !== 'undefined' && module.exports ? require('./perception-data').BVPerceptionCapture : null);
/**
 * BimmerVision BVR1 Archive Parser
 * Extracts H.264 RTP video packets and JSON telemetry from binary .bvr files.
 * Zero external dependencies.
 */
function recordedCameraEvent(obj, atUs, payload, expectedCrc) {
  const schema=obj.type==='perception-schema' && Array.isArray(obj.cameraControlSources) && obj.cameraControlSources.some(source=>source.source==='ICAM.XView3D');
  if (!schema && (obj.type !== 'camera-control' || obj.source !== 'ICAM.XView3D' || obj.schemaVersion !== 1 ||
      !['observed','snapshot','unavailable'].includes(obj.state))) return null;
  let crc = 0xffffffff;
  for (const byte of payload) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  const valid = ((crc ^ 0xffffffff) >>> 0) === expectedCrc;
  if (schema) return {atUs,hex:null,label:valid?'Camera view':'Camera view unavailable'};
  return {atUs, hex: valid && obj.state !== 'unavailable' && /^[0-9a-f]{6}$/i.test(obj.currentStateHex || '') ? obj.currentStateHex.toLowerCase() : null};
}

// BMW TrafficSignRecognition 0x3540/0x8001: 16 UInt8 fields in the
// recorded OEM catalogue. Speed classes use the FASuS five-unit classes;
// 29 is a gong request, 0/254/255 are not numeric limits. This is the
// car's fused sign result, not a claim that the camera alone supplied it.
function recordedSpeedLimitEvent(obj, atUs, payload, expectedCrc) {
  if (obj.type!=='perception' || obj.serviceId!==0x3540 || obj.eventId!==0x8001 ||
      obj.instanceId!==1 || obj.majorVersion!==1 || obj.schemaVersion!==1 ||
      obj.source!=='de.bmw.dass.TrafficSignRecognition') return null;
  const event={atUs,limit:null,unit:null};
  let crc=0xffffffff;
  for (const byte of payload) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  if (((crc^0xffffffff)>>>0)!==expectedCrc || obj.payloadEncoding!=='base64' || typeof obj.payload!=='string') return event;
  try {
    const raw=atob(obj.payload);
    if(raw.length!==16) return event;
    const b=Uint8Array.from(raw,c=>c.charCodeAt(0)),code=b[3];
    if(b[0]!==1 || !((code>=1 && code<=28)||code===30) || b[7]>1) return event;
    event.limit=code*5; event.unit=b[7]===1?'mph':'km/h';
  } catch(e) { /* invalid payload clears the previous reading */ }
  return event;
}

// Horn samples are observations, never latched state. Match the recorder's 2s
// freshness limit and keep the archive timestamp separate from the sample time.
function recordedHornEvent(obj, atUs, payload, expectedCrc) {
  const dedicated = (obj.type === 'horn' || obj.type === 'horn-status') && obj.source === 'BDC.HUPE_TASTER';
  const field = obj.type === 'telemetry' && obj.fields && obj.fields.horn;
  if (!dedicated && !field) return null;
  let crc = 0xffffffff;
  for (const byte of payload) { crc ^= byte; for (let bit=0; bit<8; bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  if (((crc ^ 0xffffffff) >>> 0) !== expectedCrc) return {atUs, sampleUs:atUs, pressed:false};
  if (field) return hornFieldEvent(field, atUs);
  return {atUs, sampleUs:atUs, pressed:obj.schemaVersion === 1 && obj.type === 'horn' && obj.valid === true && obj.pressed === true};
}

function hornFieldEvent(field, atUs) {
  const valid = field && field.valid === true && field.sourceValid === true && field.latched === false &&
    typeof field.value === 'boolean' && Number.isFinite(field.atUs) && field.atUs >= 0 && field.atUs <= atUs &&
    Number.isFinite(field.ageUs) && field.ageUs >= 0 && field.ageUs <= 2000000;
  return {atUs, sampleUs:valid ? field.atUs : atUs, pressed:valid && field.value === true};
}

function latestRecordedAt(records, targetUs) {
  let lo=0,hi=records.length-1,best=-1;
  while (lo<=hi) {const mid=(lo+hi)>>1; if(records[mid].atUs<=targetUs){best=mid;lo=mid+1;}else hi=mid-1;}
  return records[best] || null;
}

class BvrParser {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.view = new DataView(arrayBuffer);
    this.bytes = new Uint8Array(arrayBuffer);
    this.videoRecords = [];
    this.telemetryRecords = [];
    this.cameraPairEvents = [];
    this.cameraViewEvents = [];
    this.speedLimitEvents = [];
    this.hornEvents = [];
    this.perception = PerceptionCapture ? new PerceptionCapture() : null;
    this.startMonotonicUs = null;
    this.endMonotonicUs = null;
    this.parsed = false;
  }

  parse() {
    if (this.buffer.byteLength < 16) {
      throw new Error("File too short for BVR1 header");
    }

    // Verify 16-byte BVR1 archive header
    const magic = String.fromCharCode(this.bytes[0], this.bytes[1], this.bytes[2], this.bytes[3]);
    if (magic !== "BVR1") {
      throw new Error(`Invalid archive magic: expected 'BVR1', got '${magic}'`);
    }
    const version = this.view.getUint32(4, true);
    const headerSize = this.view.getUint32(8, true);
    if (version !== 1 || headerSize !== 16) {
      throw new Error(`Unsupported BVR version ${version} or header size ${headerSize}`);
    }

    let offset = 16;
    const totalBytes = this.buffer.byteLength;
    const textDecoder = new TextDecoder("utf-8");

    while (offset + 24 <= totalBytes) {
      // 24-byte record header
      const recMagic = String.fromCharCode(
        this.bytes[offset],
        this.bytes[offset + 1],
        this.bytes[offset + 2],
        this.bytes[offset + 3]
      );
      if (recMagic !== "BVRR") {
        break; // Stop at end or damaged tail
      }

      const kind = this.bytes[offset + 4];
      const reserved = this.bytes[offset + 5];
      const recHdrSize = this.view.getUint16(offset + 6, true);
      const length = this.view.getUint32(offset + 8, true);
      // uint64 monotonic microseconds
      const atUsLow = this.view.getUint32(offset + 12, true);
      const atUsHigh = this.view.getUint32(offset + 16, true);
      const atUs = atUsHigh * 4294967296 + atUsLow;
      const expectedCrc = this.view.getUint32(offset + 20, true);

      if (recHdrSize !== 24 || length <= 0 || offset + 24 + length > totalBytes) {
        break; // Incomplete or malformed tail
      }

      const payload = new Uint8Array(this.buffer, offset + 24, length);

      if (kind === 1) {
        // Type 1: RFC 3550 RTP video packet (H.264)
        this.videoRecords.push({
          atUs: atUs,
          payload: payload
        });
      } else if (kind === 2) {
        // Type 2: JSON event / telemetry
        try {
          const jsonText = textDecoder.decode(payload);
          const obj = JSON.parse(jsonText);
          this.perception?.addEvent(obj, atUs, payload, expectedCrc);
          const horn = recordedHornEvent(obj, atUs, payload, expectedCrc);
          if (horn) this.hornEvents.push(horn);
          const speedLimit = recordedSpeedLimitEvent(obj, atUs, payload, expectedCrc);
          if (speedLimit) this.speedLimitEvents.push(speedLimit);
          const cameraView = recordedCameraEvent(obj, atUs, payload, expectedCrc);
          if (cameraView) this.cameraViewEvents.push(cameraView);
          if (obj.type === "telemetry" && obj.fields) {
            this.telemetryRecords.push({
              atUs: atUs,
              fields: obj.fields
            });
          } else if (obj.type === "cameraPair") {
            this.cameraPairEvents.push({
              atUs: atUs,
              ssrc: obj.ssrc,
              rtpTimestamp: obj.rtpTimestamp,
              pair: obj.pair, // "frontRear" or "leftRight"
              provenance: obj.provenance
            });
          } else if (obj.type === "start" && obj.startMonotonicUs) {
            this.startMonotonicUs = obj.startMonotonicUs;
          }
        } catch (e) {
          // Ignore malformed individual JSON events
        }
      }

      if (this.startMonotonicUs === null) {
        this.startMonotonicUs = atUs;
      }
      this.endMonotonicUs = atUs;

      offset += 24 + length;
    }

    this.parsed = true;
    return {
      videoPackets: this.videoRecords.length,
      telemetryRecords: this.telemetryRecords.length,
      cameraPairEvents: this.cameraPairEvents.length,
      durationSeconds: (this.endMonotonicUs - this.startMonotonicUs) / 1000000.0
    };
  }

  /**
   * Returns interpolated or nearest telemetry at a given playback time in seconds.
   */
  getCameraViewAtTime(seconds, manifestStartUs) {
    const events=this.cameraViewEvents || [];
    if (!events.length) return null; // Legacy recordings have no authoritative view metadata.
    const start=manifestStartUs !== undefined ? manifestStartUs : (this.startMonotonicUs || 0);
    const target=start+seconds*1000000;
    let found=null;
    for (const event of events) if (event.atUs <= target && (!found || event.atUs >= found.atUs)) found=event;
    if (!found) return {single:true,label:'Camera view',atUs:start,rawStateHex:null};
    if (!found.hex) return {single:true,label:found.label || 'Camera view unavailable',atUs:found.atUs,rawStateHex:null};
    const app=parseInt(found.hex.slice(0,2),16),mode=parseInt(found.hex.slice(2,4),16),perspective=parseInt(found.hex.slice(4,6),16);
    let single=true,label='Camera view';
    if ([50,51,52].includes(app) && mode===50 && [7,9,10].includes(perspective)) {single=false;label='Recorder view';}
    else if (app===1) label=mode===3 ? 'Bird’s-eye parking view' : 'Parking view';
    else if (app===2) label=mode===5 ? 'Front wide view' : mode===6 ? 'Rear wide view' : 'Wide camera view';
    else if (app===3) label=mode===13 ? 'Trailer zoom view' : 'Rear camera view';
    else if (app===0) label='Camera switching';
    else if (app===20) label='Off-road view';
    else if (app===60) label='Remote 360° view';
    else if (app===255 || mode===255) label='Camera view unavailable';
    else if ([50,51,52].includes(app)) label=perspective===1 ? 'Front camera' : perspective===2 ? 'Rear camera' : 'Recorder camera view';
    return {single,label,atUs:found.atUs,rawStateHex:found.hex};
  }

  getCarSpeedLimitAtTime(seconds, manifestStartUs) {
    const target=(manifestStartUs ?? this.startMonotonicUs ?? 0)+seconds*1000000;
    const events=this.speedLimitEvents || [];
    let lo=0,hi=events.length-1,best=-1;
    while(lo<=hi){const mid=(lo+hi)>>1;if(events[mid].atUs<=target){best=mid;lo=mid+1;}else hi=mid-1;}
    const found=events[best];
    return found && target-found.atUs<=2500000 ? found : {limit:null,unit:null};
  }

  getHornAtTime(seconds, manifestStartUs) {
    const targetUs=(manifestStartUs ?? this.startMonotonicUs ?? 0)+seconds*1000000;
    let event=latestRecordedAt(this.hornEvents || [],targetUs);
    // Native preview supplies the original telemetry snapshots rather than BVR
    // event records. Never borrow the first (future) snapshot before it occurred.
    const rec=latestRecordedAt(this.telemetryRecords || [],targetUs);
    if(rec && (!event || rec.atUs>event.atUs)) event=hornFieldEvent(rec.fields && rec.fields.horn,rec.atUs);
    return Boolean(event && event.pressed && targetUs>=event.sampleUs && targetUs-event.sampleUs<=2000000);
  }

  getTelemetryAtTime(playbackSeconds, manifestStartUs) {
    const startUs = manifestStartUs !== undefined ? manifestStartUs : (this.startMonotonicUs || 0);
    const targetUs = startUs + playbackSeconds * 1000000.0;
    const carLimit = BvrParser.prototype.getCarSpeedLimitAtTime.call(this, playbackSeconds, startUs);
    const hornPressed = BvrParser.prototype.getHornAtTime.call(this, playbackSeconds, startUs);

    if (!this.telemetryRecords || this.telemetryRecords.length === 0) {
      return {
        speedKph: 0,
        speedMph: 0,
        brakePressed: false,
        gasPressed: false,
        acceleratorPercent: 0,
        steeringAngleDeg: 0,
        hornPressed,
        indicator: "off",
        latitude: null,
        longitude: null,
        speedLimit: carLimit.limit,
        speedLimitSource: "Car-detected speed limit",
        speedLimitUnit: carLimit.unit || "mph"
      };
    }

    // Binary search for closest record at or before targetUs
    let low = 0;
    let high = this.telemetryRecords.length - 1;
    let best = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.telemetryRecords[mid].atUs <= targetUs) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const rec = this.telemetryRecords[best];
    if (!rec) {
      return {
        speedKph: 0,
        speedMph: 0,
        brakePressed: false,
        gasPressed: false,
        acceleratorPercent: 0,
        steeringAngleDeg: 0,
        hornPressed,
        indicator: "off",
        latitude: null,
        longitude: null,
        speedLimit: carLimit.limit,
        speedLimitSource: "Car-detected speed limit",
        speedLimitUnit: carLimit.unit || "mph",
        atUs: targetUs
      };
    }
    const fields = rec.fields || {};

    let speedKph = 0;
    if (fields.speed && typeof fields.speed.value === "number") {
      speedKph = fields.speed.value;
    }

    let brakePressed = false;
    if (fields.brake) {
      if (typeof fields.brake.value === "boolean") {
        brakePressed = fields.brake.value;
      } else if (typeof fields.brake.value === "number") {
        brakePressed = fields.brake.value > 0.05;
      }
    }

    let acceleratorPercent = 0;
    let gasPressed = false;
    const accelField = fields.accelerator || fields.gas;
    if (accelField && accelField.value != null) {
      if (typeof accelField.value === "boolean") {
        gasPressed = accelField.value;
        acceleratorPercent = gasPressed ? 100 : 0;
      } else if (typeof accelField.value === "number") {
        acceleratorPercent = Math.max(0, Math.min(100, accelField.value));
        gasPressed = acceleratorPercent > 5;
      }
    }

    let steeringAngleDeg = 0;
    if (fields.steeringAngleDeg && typeof fields.steeringAngleDeg.value === "number") {
      steeringAngleDeg = fields.steeringAngleDeg.value;
    } else if (fields.steering_wheel_angle && typeof fields.steering_wheel_angle.value === "number") {
      steeringAngleDeg = fields.steering_wheel_angle.value;
    }

    let indicator = "off";
    const blinkerField = fields.blinker || fields.indicator;
    if (blinkerField && blinkerField.value != null) {
      const bVal = String(blinkerField.value).trim().toLowerCase();
      if (bVal.includes("hazard") || bVal.includes("both") || bVal.includes("beidseitig")) {
        indicator = "hazard";
      } else if (bVal.includes("left") || bVal.includes("links") || bVal === "l") {
        indicator = "left";
      } else if (bVal.includes("right") || bVal.includes("rechts") || bVal === "r") {
        indicator = "right";
      } else {
        indicator = bVal;
      }
    }

    let latitude = null;
    let longitude = null;
    if (fields.latitude && typeof fields.latitude.value === "number") {
      latitude = fields.latitude.value;
    }
    if (fields.longitude && typeof fields.longitude.value === "number") {
      longitude = fields.longitude.value;
    }


    return {
      speedKph: Math.round(speedKph),
      speedMph: Math.round(speedKph * 0.621371),
      brakePressed: brakePressed,
      gasPressed: gasPressed,
      acceleratorPercent: Math.round(acceleratorPercent),
      steeringAngleDeg: Math.round(steeringAngleDeg),
      hornPressed,
      indicator: indicator,
      latitude: latitude,
      longitude: longitude,
      speedLimit: carLimit.limit,
      speedLimitSource: "Car-detected speed limit",
      speedLimitUnit: carLimit.unit || "mph",
      atUs: rec.atUs
    };
  }

  /**
   * Extracts real GPS route trace points from the recording's CAN-bus telemetry.
   */
  getRouteSeries(manifestStartUs) {
    const startUs = manifestStartUs !== undefined ? manifestStartUs : (this.startMonotonicUs || 0);
    const points = [];
    const seenTimes = new Set();

    for (const rec of this.telemetryRecords) {
      const f = rec.fields;
      if (!f || !f.latitude || !f.longitude) continue;

      const lat = typeof f.latitude.value === "number" ? f.latitude.value : parseFloat(f.latitude.value);
      const lon = typeof f.longitude.value === "number" ? f.longitude.value : parseFloat(f.longitude.value);

      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

      const t = Math.max(0, (rec.atUs - startUs) / 1000000.0);
      const timeBin = Math.round(t * 10) / 10;
      if (seenTimes.has(timeBin)) continue;
      seenTimes.add(timeBin);

      const spd = f.speed && typeof f.speed.value === "number" ? f.speed.value : 0;
      points.push({
        at: t,
        latitude: lat,
        longitude: lon,
        speedKph: Math.round(spd)
      });
    }

    // If single GPS fix (e.g. stationary / parked recording), provide start and end so map renders vehicle dot and pin
    if (points.length === 1) {
      const dur = this.endMonotonicUs && this.startMonotonicUs
        ? (this.endMonotonicUs - this.startMonotonicUs) / 1000000.0
        : 120;
      points.push({
        at: dur,
        latitude: points[0].latitude,
        longitude: points[0].longitude,
        speedKph: points[0].speedKph
      });
    }

    return points;
  }
}

/**
 * Streaming BVR1 Archive Parser
 * Parses incoming chunks incrementally, handling records split across chunk boundaries.
 */
class StreamingBvrParser {
  constructor(callbacks = {}) {
    this.onVideoRecord = callbacks.onVideoRecord || (() => {});
    this.onTelemetryRecord = callbacks.onTelemetryRecord || (() => {});
    this.onCameraPair = callbacks.onCameraPair || (() => {});
    this.onStartUs = callbacks.onStartUs || (() => {});

    this.headerParsed = false;
    this.leftover = null;
    this.textDecoder = new TextDecoder("utf-8");

    this.telemetryRecords = [];
    this.cameraPairEvents = [];
    this.cameraViewEvents = [];
    this.speedLimitEvents = [];
    this.hornEvents = [];
    this.perception = PerceptionCapture ? new PerceptionCapture() : null;
    this.startMonotonicUs = null;
    this.endMonotonicUs = null;
  }

  append(chunk) {
    if (!chunk || chunk.length === 0) return;

    let buf;
    if (this.leftover && this.leftover.length > 0) {
      buf = new Uint8Array(this.leftover.length + chunk.length);
      buf.set(this.leftover, 0);
      buf.set(chunk, this.leftover.length);
      this.leftover = null;
    } else {
      buf = chunk;
    }

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;
    const totalBytes = buf.byteLength;

    if (!this.headerParsed) {
      if (totalBytes < 16) {
        this.leftover = buf;
        return;
      }
      const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
      if (magic !== "BVR1") {
        throw new Error(`Invalid archive magic: expected 'BVR1', got '${magic}'`);
      }
      offset = 16;
      this.headerParsed = true;
    }

    while (offset + 24 <= totalBytes) {
      const b0 = buf[offset], b1 = buf[offset + 1], b2 = buf[offset + 2], b3 = buf[offset + 3];
      if (b0 !== 0x42 || b1 !== 0x56 || b2 !== 0x52 || b3 !== 0x52) { // "BVRR"
        let found = false;
        for (let i = offset + 1; i + 24 <= totalBytes; i++) {
          if (buf[i] === 0x42 && buf[i+1] === 0x56 && buf[i+2] === 0x52 && buf[i+3] === 0x52) {
            offset = i;
            found = true;
            break;
          }
        }
        if (!found) {
          offset = Math.max(offset, totalBytes - 3);
          break;
        }
      }

      const kind = buf[offset + 4];
      const recHdrSize = view.getUint16(offset + 6, true);
      const length = view.getUint32(offset + 8, true);

      if (recHdrSize !== 24 || length <= 0) {
        offset++;
        continue;
      }

      if (offset + 24 + length > totalBytes) {
        break; // Incomplete record, wait for next chunk
      }

      const atUsLow = view.getUint32(offset + 12, true);
      const atUsHigh = view.getUint32(offset + 16, true);
      const atUs = atUsHigh * 4294967296 + atUsLow;
      const expectedCrc = view.getUint32(offset + 20, true);

      const payload = new Uint8Array(buf.buffer, buf.byteOffset + offset + 24, length);

      if (kind === 1) {
        this.onVideoRecord({ atUs, payload });
      } else if (kind === 2) {
        try {
          const jsonText = this.textDecoder.decode(payload);
          const obj = JSON.parse(jsonText);
          this.perception?.addEvent(obj, atUs, payload, expectedCrc);
          const horn = recordedHornEvent(obj, atUs, payload, expectedCrc);
          if (horn) this.hornEvents.push(horn);
          const speedLimit = recordedSpeedLimitEvent(obj, atUs, payload, expectedCrc);
          if (speedLimit) this.speedLimitEvents.push(speedLimit);
          const cameraView = recordedCameraEvent(obj, atUs, payload, expectedCrc);
          if (cameraView) this.cameraViewEvents.push(cameraView);
          if (obj.type === "telemetry" && obj.fields) {
            const rec = { atUs, fields: obj.fields };
            this.telemetryRecords.push(rec);
            this.onTelemetryRecord(rec);
          } else if (obj.type === "cameraPair") {
            const ev = {
              atUs,
              ssrc: obj.ssrc,
              rtpTimestamp: obj.rtpTimestamp,
              pair: obj.pair,
              provenance: obj.provenance
            };
            this.cameraPairEvents.push(ev);
            this.onCameraPair(ev);
          } else if (obj.type === "start" && obj.startMonotonicUs) {
            if (!this.startMonotonicUs) this.startMonotonicUs = obj.startMonotonicUs;
            this.onStartUs(obj.startMonotonicUs);
          }
        } catch (_) {}
      }

      if (this.startMonotonicUs === null) {
        this.startMonotonicUs = atUs;
      }
      this.endMonotonicUs = atUs;

      offset += 24 + length;
    }

    if (offset < totalBytes) {
      this.leftover = buf.slice(offset);
    }
  }

  getCameraViewAtTime(seconds, manifestStartUs) {
    return BvrParser.prototype.getCameraViewAtTime.call(this, seconds, manifestStartUs);
  }

  getTelemetryAtTime(playbackSeconds, manifestStartUs) {
    return BvrParser.prototype.getTelemetryAtTime.call(this, playbackSeconds, manifestStartUs);
  }

  getRouteSeries(manifestStartUs) {
    return BvrParser.prototype.getRouteSeries.call(this, manifestStartUs);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { BvrParser, StreamingBvrParser };
}
