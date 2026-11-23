/**
 * BimmerVision Drive Grouper
 * Groups raw recording clips into continuous 'Drives' matching DriveGrouping.cs.
 */
class DriveGrouper {
  // Drives should show as one if recording times match up within 5 minutes (300 seconds) of each other
  static MaximumGapSeconds = 300.0;

  static routeDistanceMeters(points) {
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1], end = points[i];
      const dLat = (end.latitude - start.latitude) * Math.PI / 180;
      const dLon = (end.longitude - start.longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(start.latitude * Math.PI / 180) * Math.cos(end.latitude * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      distance += 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    }
    return distance;
  }

  static measurement(value) {
    const n = typeof value === 'string' && value.trim() ? Number(value) : value;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  static summarize(drives) {
    let distanceMeters = null, topSpeedKph = null, seconds = 0, recordings = 0;
    for (const drive of drives) {
      for (const {clip} of drive.segments) {
        recordings++;
        seconds += this.measurement(clip.durationSeconds) ?? 0;
        const route = (clip.route || []).filter(DriveGrouper.validRoutePoint);
        const kilometers = this.measurement(clip.metrics?.distanceKm);
        const distance = this.measurement(clip.metrics?.distanceMeters) ??
          (kilometers !== null ? kilometers * 1000 : route.length > 1 ? this.routeDistanceMeters(route) : null);
        if (distance !== null) distanceMeters = (distanceMeters ?? 0) + distance;
        const recordedSpeed = this.measurement(clip.metrics?.topSpeedKph);
        if (recordedSpeed !== null) topSpeedKph = Math.max(topSpeedKph ?? 0, recordedSpeed);
        for (const point of route) {
          const speed = this.measurement(point.speedKph);
          if (speed !== null) topSpeedKph = Math.max(topSpeedKph ?? 0, speed);
        }
      }
    }
    return {distanceMeters, topSpeedKph, seconds, recordings};
  }

  static validRoutePoint(point) {
    return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
  }

  /**
   * Groups a list of recording manifests into DetectedDrive objects.
   * Matches DriveGrouping.cs multi-session merging and enforces the 5-minute threshold.
   * @param {Array} clips - raw recording objects from /api/v1/recordings
   * @returns {Array} drives
   */
  static group(clips) {
    if (!clips || clips.length === 0) return [];

    // 1. Group within same sessionId first
    const sessionMap = new Map();
    for (const clip of clips) {
      const sess = clip.sessionId || "default";
      if (!sessionMap.has(sess)) sessionMap.set(sess, []);
      sessionMap.get(sess).push(clip);
    }

    const runs = [];

    sessionMap.forEach((sessionClips) => {
      // Sort by startMonotonicUs, sequence, then id
      const ordered = sessionClips.slice().sort((a, b) => {
        const monoA = a.startMonotonicUs || 0;
        const monoB = b.startMonotonicUs || 0;
        if (monoA !== monoB) return monoA - monoB;
        const seqA = a.sequence || 0;
        const seqB = b.sequence || 0;
        if (seqA !== seqB) return seqA - seqB;
        return (a.id || "").localeCompare(b.id || "");
      });

      let currentRun = [];

      for (const clip of ordered) {
        if (currentRun.length > 0) {
          const prev = currentRun[currentRun.length - 1];
          const gap = this._connectionGap(prev.clip, clip);
          if (gap !== null) {
            const offset = Math.max(0, prev.offset + (prev.clip.durationSeconds || 4) + gap);
            currentRun.push({ clip, offset });
          } else {
            runs.push(currentRun);
            currentRun = [{ clip, offset: 0 }];
          }
        } else {
          currentRun = [{ clip, offset: 0 }];
        }
      }

      if (currentRun.length > 0) {
        runs.push(currentRun);
      }
    });

    // 2. Sort all runs chronologically ascending (earliest first for merging across sessions)
    runs.sort((a, b) => {
      const timeA = new Date(a[0].clip.startedAt || 0).getTime();
      const timeB = new Date(b[0].clip.startedAt || 0).getTime();
      if (timeA !== timeB) return timeA - timeB;
      const monoA = a[0].clip.startMonotonicUs || 0;
      const monoB = b[0].clip.startMonotonicUs || 0;
      return monoA - monoB;
    });

    // 3. Merge adjacent runs across different sessions if within MaximumGapSeconds (5 minutes)
    const mergedDrives = [];
    for (const run of runs) {
      if (mergedDrives.length > 0) {
        const lastDrive = mergedDrives[mergedDrives.length - 1];
        const lastSeg = lastDrive[lastDrive.length - 1];
        const nextSeg = run[0];

        const gap = this._connectionGap(lastSeg.clip, nextSeg.clip);
        if (gap !== null) {
          const baseOffset = Math.max(0, lastSeg.offset + (lastSeg.clip.durationSeconds || 4) + gap);
          for (const seg of run) {
            lastDrive.push({
              clip: seg.clip,
              offset: baseOffset + seg.offset
            });
          }
          continue;
        }
      }
      mergedDrives.push(run.slice());
    }

    // 4. Sort final merged drives descending (newest drive first for UI display)
    mergedDrives.sort((a, b) => {
      const timeA = new Date(a[0].clip.startedAt || 0).getTime();
      const timeB = new Date(b[0].clip.startedAt || 0).getTime();
      return timeB - timeA;
    });

    // Convert merged runs to rich DetectedDrive objects
    return mergedDrives.map((run, idx) => {
      const firstClip = run[0].clip;
      const lastClip = run[run.length - 1].clip;

      let totalDuration = 0;
      let totalBytes = 0;
      for (const seg of run) {
        totalDuration += (seg.clip.durationSeconds || 4);
        totalBytes += (seg.clip.bytes || 0);
      }

      const startedDate = firstClip.startedAt ? new Date(firstClip.startedAt) : new Date(NaN);
      const formattedDate = !isNaN(startedDate.getTime())
        ? startedDate.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric"
          })
        : "Recorded Drive";

      const dayOfWeek = !isNaN(startedDate.getTime())
        ? startedDate.toLocaleDateString(undefined, { weekday: "long" })
        : "";

      const isoDateStr = !isNaN(startedDate.getTime())
        ? `${startedDate.getFullYear()}-${String(startedDate.getMonth()+1).padStart(2,"0")}-${String(startedDate.getDate()).padStart(2,"0")}`
        : "unknown-date";

      const formattedTime = !isNaN(startedDate.getTime())
        ? startedDate.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit"
          })
        : "";

      // Check for real GPS data from car server
      // Check for real GPS data from car server across segments
      let realStart = null;
      let realEnd = null;
      for (let i = 0; i < run.length; i++) {
        if (run[i].clip.endpoints && run[i].clip.endpoints.start) {
          realStart = run[i].clip.endpoints.start;
          break;
        }
      }
      for (let i = run.length - 1; i >= 0; i--) {
        if (run[i].clip.endpoints && run[i].clip.endpoints.end) {
          realEnd = run[i].clip.endpoints.end;
          break;
        }
      }

      const validPoint = DriveGrouper.validRoutePoint;
      const formatCoord = p => validPoint(p) ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : "GPS unavailable";
      const startAddress = realStart?.address || (validPoint(realStart) ? formatCoord(realStart) : "Location unavailable");
      const endAddress = realEnd?.address || (validPoint(realEnd) ? formatCoord(realEnd) : "Location unavailable");
      const routeCoordinates = run.flatMap(seg => (seg.clip.route || []).filter(validPoint).map(p => ({...p, at: seg.offset + (p.at || 0)})));
      const endDate = new Date(new Date(lastClip.startedAt || 0).getTime() + (lastClip.durationSeconds || 0) * 1000);
      const endTime = !isNaN(endDate.getTime()) ? endDate.toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"}) : "";
      const totalRounded = Math.round(totalDuration);
      const durMins = Math.floor(totalRounded / 60);
      const durSecs = totalRounded % 60;
      const durationFormatted = durMins > 0 ? `${durMins}m ${durSecs.toString().padStart(2, "0")}s` : `${durSecs}s`;

      let totalDistanceMeters = null, maxSpeedKph = null, maxSteeringDeg = null, totalBrakeEvents = null;
      let totalWeightedSpeed = 0, totalSpeedDuration = 0;
      for (const {clip} of run) {
        const m = clip.metrics;
        if (!m) continue;
        const kilometers = this.measurement(m.distanceKm);
        const distance = this.measurement(m.distanceMeters) ?? (kilometers === null ? null : kilometers * 1000);
        const speed = this.measurement(m.topSpeedKph), steering = this.measurement(m.maxSteeringDeg);
        const braking = this.measurement(m.brakeEvents), average = this.measurement(m.avgSpeedKph);
        if (distance !== null) totalDistanceMeters = (totalDistanceMeters ?? 0) + distance;
        if (speed !== null) maxSpeedKph = Math.max(maxSpeedKph ?? 0, speed);
        if (steering !== null) maxSteeringDeg = Math.max(maxSteeringDeg ?? 0, steering);
        if (braking !== null) totalBrakeEvents = (totalBrakeEvents ?? 0) + braking;
        if (average !== null) {
          const duration = clip.durationSeconds || 4;
          totalWeightedSpeed += average * duration;
          totalSpeedDuration += duration;
        }
      }

      if ((totalDistanceMeters ?? 0) === 0 && routeCoordinates.length > 1) {
        totalDistanceMeters = this.routeDistanceMeters(routeCoordinates);
      }
      const avgSpeedKph = totalSpeedDuration > 0 ? totalWeightedSpeed / totalSpeedDuration
        : (totalDuration > 0 && totalDistanceMeters > 0 ? (totalDistanceMeters / 1000) / (totalDuration / 3600) : null);
      const metrics = {
        distanceMeters: totalDistanceMeters === null ? null : Math.round(totalDistanceMeters),
        distanceKm: totalDistanceMeters === null ? null : (totalDistanceMeters / 1000).toFixed(1),
        distanceMiles: totalDistanceMeters === null ? null : (totalDistanceMeters / 1609.344).toFixed(1),
        topSpeedKph: maxSpeedKph === null ? null : Math.round(maxSpeedKph),
        topSpeedMph: maxSpeedKph === null ? null : Math.round(maxSpeedKph * 0.621371),
        avgSpeedKph: avgSpeedKph === null ? null : Math.round(avgSpeedKph),
        avgSpeedMph: avgSpeedKph === null ? null : Math.round(avgSpeedKph * 0.621371),
        maxSteeringDeg: maxSteeringDeg === null ? null : Math.round(maxSteeringDeg),
        brakeEvents: totalBrakeEvents
      };

      return {
        id: firstClip.id || `drive-${idx}`,
        title: formattedTime ? `Drive · ${formattedDate} · ${formattedTime}` : `Drive · ${formattedDate}`,
        subtitle: `${formattedTime ? formattedTime + " · " : ""}${run.length} clip${run.length === 1 ? "" : "s"} · ${(totalBytes / (1024 * 1024)).toFixed(0)} MB`,
        date: formattedDate,
        dayOfWeek: dayOfWeek,
        isoDate: isoDateStr,
        startTime: formattedTime,
        durationFormatted: durationFormatted,
        startedAt: firstClip.startedAt,
        durationSeconds: Math.round(totalDuration),
        bytes: totalBytes,
        segments: run,
        route: routeCoordinates,
        metrics: metrics,
        endpoints: {
          start: {
            address: startAddress,
            coords: formatCoord(realStart),
            time: formattedTime
          },
          end: {
            address: endAddress,
            coords: formatCoord(realEnd),
            time: endTime
          }
        }
      };
    });
  }

  /**
   * Groups DetectedDrives into chronological Date Groups (newest date first).
   * @param {Array} drives - array of DetectedDrive
   * @returns {Array} dateGroups: [{ isoDate, dateLabel, dayOfWeek, drives: [...] }]
   */
  static groupByDate(drives) {
    if (!drives || drives.length === 0) return [];

    const map = new Map();
    for (const drive of drives) {
      const key = drive.isoDate || "unknown-date";
      if (!map.has(key)) {
        map.set(key, {
          isoDate: key,
          dateLabel: drive.date || key,
          dayOfWeek: drive.dayOfWeek || "",
          drives: []
        });
      }
      map.get(key).drives.push(drive);
    }

    // Convert map to array sorted by ISO date descending
    const dateGroups = Array.from(map.values());
    dateGroups.sort((a, b) => b.isoDate.localeCompare(a.isoDate));
    return dateGroups;
  }

  static _connectionGap(a, b) {
    const sameSession = (a.sessionId || "") === (b.sessionId || "");
    let gap = 0;

    if (sameSession) {
      if ((b.sequence || 0) <= (a.sequence || 0)) return null;
      gap = ((b.startMonotonicUs || 0) - (a.endMonotonicUs || 0)) / 1000000.0;
    } else {
      const timeA = new Date(a.startedAt || 0).getTime();
      const timeB = new Date(b.startedAt || 0).getTime();
      if (isNaN(timeA) || isNaN(timeB)) return null;
      gap = (timeB - timeA) / 1000.0 - (a.durationSeconds || 4);
    }

    // Must be between -2.0s (slight recording overlap) and 300.0s (5 minutes)
    if (!isFinite(gap) || gap < -2.0 || gap > this.MaximumGapSeconds) {
      return null;
    }
    return gap;
  }


}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DriveGrouper };
}
