/**
 * BimmerVision BVR1 Archive Parser
 * Extracts H.264 RTP video packets and JSON telemetry from binary .bvr files.
 * Zero external dependencies.
 */
class BvrParser {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.view = new DataView(arrayBuffer);
    this.bytes = new Uint8Array(arrayBuffer);
    this.videoRecords = [];
    this.telemetryRecords = [];
    this.cameraPairEvents = [];
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
  getTelemetryAtTime(playbackSeconds, manifestStartUs) {
    const startUs = manifestStartUs !== undefined ? manifestStartUs : (this.startMonotonicUs || 0);
    const targetUs = startUs + playbackSeconds * 1000000.0;

    if (!this.telemetryRecords || this.telemetryRecords.length === 0) {
      return {
        speedKph: 0,
        speedMph: 0,
        brakePressed: false,
        gasPressed: false,
        acceleratorPercent: 0,
        steeringAngleDeg: 0,
        indicator: "off",
        latitude: null,
        longitude: null,
        speedLimit: null,
        speedLimitUnit: "mph"
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
        indicator: "off",
        latitude: null,
        longitude: null,
        speedLimit: null,
        speedLimitUnit: "mph",
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

    let speedLimit = null;
    let speedLimitUnit = "mph";
    const limitField = fields.speedLimit || fields.speed_limit || fields.maxspeed;
    if (limitField && limitField.value != null) {
      speedLimit = Number(limitField.value);
      if (limitField.unit) speedLimitUnit = limitField.unit;
    }

    return {
      speedKph: Math.round(speedKph),
      speedMph: Math.round(speedKph * 0.621371),
      brakePressed: brakePressed,
      gasPressed: gasPressed,
      acceleratorPercent: Math.round(acceleratorPercent),
      steeringAngleDeg: Math.round(steeringAngleDeg),
      indicator: indicator,
      latitude: latitude,
      longitude: longitude,
      speedLimit: speedLimit,
      speedLimitUnit: speedLimitUnit,
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

      const payload = new Uint8Array(buf.buffer, buf.byteOffset + offset + 24, length);

      if (kind === 1) {
        this.onVideoRecord({ atUs, payload });
      } else if (kind === 2) {
        try {
          const jsonText = this.textDecoder.decode(payload);
          const obj = JSON.parse(jsonText);
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
