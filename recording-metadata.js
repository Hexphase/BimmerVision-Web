/* Index finalized BVR telemetry without decoding video. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BVRecordingMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const READ_SIZE = 4 * 1024 * 1024;
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
  const abort = () => new DOMException('Recording metadata read cancelled', 'AbortError');
  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) { crc ^= bytes[i]; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
  }
  const magic = (bytes, value) => bytes.length >= value.length && [...value].every((c, i) => bytes[i] === c.charCodeAt(0));
  function validHeader(bytes) {
    if (bytes.length !== 16 || !magic(bytes, 'BVR1')) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint32(4, true) === 1 && view.getUint32(8, true) === 16;
  }
  async function scan(blob, manifest, cancelled, progress = () => {}) {
    let window = new Uint8Array(), windowAt = 0, pos = 16, records = 0, lastTime = -Infinity;
    const route = [];
    const decoder = new TextDecoder();
    const metrics = {};
    let speedSum = 0, speedCount = 0, previousBrake;
    const fieldValue = field => field && field.valid !== false && field.sourceValid !== false ? field.value : undefined;
    async function read(at, length) {
      if (cancelled()) throw abort();
      if (at < windowAt || at + length > windowAt + window.length) {
        windowAt = at;
        window = new Uint8Array(await blob.slice(at, Math.min(blob.size, at + READ_SIZE)).arrayBuffer());
      }
      return window.subarray(at - windowAt, at - windowAt + length);
    }
    if (!validHeader(await read(0, 16))) throw Error('Invalid BVR1 archive');
    while (pos + 24 <= blob.size) {
      if (++records > 2000000) throw Error('Archive record limit exceeded');
      if(records%200===0){await yieldUI();if(cancelled())throw abort();}
      const h = await read(pos, 24);
      if (h.length !== 24 || !magic(h, 'BVRR')) throw Error('Invalid BVR record');
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      const kind = h[4], length = dv.getUint32(8, true), atUs = dv.getUint32(12, true) + dv.getUint32(16, true) * 4294967296, crc = dv.getUint32(20, true);
      if (dv.getUint16(6, true) !== 24 || !length || length > 16777216 || pos + 24 + length > blob.size) throw Error('Invalid BVR record length');
      if (kind === 2 && length <= 65536) {
        const bytes = await read(pos + 24, length);
        let obj = null;
        try { if (crc32(bytes) === crc) obj = JSON.parse(decoder.decode(bytes)); } catch (_) {}
        if (obj && obj.type === 'telemetry' && obj.fields) {
          const f = obj.fields, lat = f.latitude, lon = f.longitude, t = (atUs - manifest.startMonotonicUs) / 1000000;
          const speed = fieldValue(f.speed), brake = fieldValue(f.brake);
          const steering = fieldValue(f.steeringAngleDeg ?? f.steering_wheel_angle);
          if (Number.isFinite(speed) && speed >= 0) {
            metrics.topSpeedKph = Math.max(metrics.topSpeedKph ?? 0, speed);
            speedSum += speed;
            speedCount++;
          }
          if (Number.isFinite(steering)) metrics.maxSteeringDeg = Math.max(metrics.maxSteeringDeg ?? 0, Math.abs(steering));
          if (typeof brake === 'boolean' || Number.isFinite(brake)) {
            const pressed = typeof brake === 'boolean' ? brake : brake > 0.05;
            metrics.brakeEvents = (metrics.brakeEvents ?? 0) + Number(pressed && previousBrake === false);
            previousBrake = pressed;
          }
          const latitude = fieldValue(lat), longitude = fieldValue(lon);
          if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0) && Number.isFinite(t) && t >= 0 && t >= lastTime + .5) {
            const point = {at: t, latitude, longitude};
            if (Number.isFinite(speed) && speed >= 0) point.speedKph = speed;
            // Bound the catalog size while keeping the final reported position.
            route[Math.min(route.length, 14399)] = point;
            lastTime = t;
          }
        }
      }
      pos += 24 + length;
      // Yield regularly so disconnect and source switches can cancel promptly.
      if (records % 512 === 0) { progress(pos, blob.size); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    if (speedCount) metrics.avgSpeedKph = speedSum / speedCount;
    const location = p => ({latitude: p.latitude, longitude: p.longitude});
    return {route, endpoints: route.length ? {start: location(route[0]), end: location(route[route.length - 1])} : null, routeStatus: 'ready', metrics};
  }
  return {scan, validHeader};
});
