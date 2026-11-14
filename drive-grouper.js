/**
 * BimmerVision Drive Grouper
 * Groups raw recording clips into continuous 'Drives' matching DriveGrouping.cs.
 */
class DriveGrouper {
  // Drives should show as one if recording times match up within 5 minutes (300 seconds) of each other
  static MaximumGapSeconds = 300.0;

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

      const validPoint = p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
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

      // Aggregate drive metrics
      let totalDistanceMeters = 0;
      let maxSpeedKph = 0;
      let totalWeightedSpeed = 0;
      let totalSpeedDuration = 0;
      let maxSteeringDeg = 0;
      let totalBrakeEvents = 0;
      let hasMetrics = false;

      for (const seg of run) {
        const m = seg.clip.metrics;
        if (m) {
          hasMetrics = true;
          if (typeof m.distanceMeters === "number") totalDistanceMeters += m.distanceMeters;
          else if (typeof m.distanceKm === "number" || typeof m.distanceKm === "string") totalDistanceMeters += parseFloat(m.distanceKm) * 1000;
          if (m.topSpeedKph && m.topSpeedKph > maxSpeedKph) maxSpeedKph = m.topSpeedKph;
          if (m.maxSteeringDeg && m.maxSteeringDeg > maxSteeringDeg) maxSteeringDeg = m.maxSteeringDeg;
          if (typeof m.brakeEvents === "number") totalBrakeEvents += m.brakeEvents;
          const segDur = seg.clip.durationSeconds || 4;
          if (m.avgSpeedKph) {
            totalWeightedSpeed += m.avgSpeedKph * segDur;
            totalSpeedDuration += segDur;
          }
        }
      }

      // If distance wasn't summed from metrics, but routeCoordinates has points, compute haversine distance
      if (totalDistanceMeters === 0 && routeCoordinates.length > 1) {
        for (let i = 1; i < routeCoordinates.length; i++) {
          const p1 = routeCoordinates[i - 1];
          const p2 = routeCoordinates[i];
          const dLat = (p2.latitude - p1.latitude) * Math.PI / 180;
          const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
          const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
          totalDistanceMeters += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        if (totalDistanceMeters > 0) hasMetrics = true;
      }

      const avgSpeedKph = totalSpeedDuration > 0 ? Math.round(totalWeightedSpeed / totalSpeedDuration) : (totalDuration > 0 && totalDistanceMeters > 0 ? Math.round((totalDistanceMeters / 1000) / (totalDuration / 3600)) : null);
      const metrics = hasMetrics ? {
        distanceMeters: Math.round(totalDistanceMeters),
        distanceKm: (totalDistanceMeters / 1000).toFixed(1),
        distanceMiles: (totalDistanceMeters / 1609.344).toFixed(1),
        topSpeedKph: Math.round(maxSpeedKph),
        topSpeedMph: Math.round(maxSpeedKph * 0.621371),
        avgSpeedKph: avgSpeedKph != null ? Math.round(avgSpeedKph) : null,
        avgSpeedMph: avgSpeedKph != null ? Math.round(avgSpeedKph * 0.621371) : null,
        maxSteeringDeg: Math.round(maxSteeringDeg),
        brakeEvents: totalBrakeEvents
      } : {
        distanceKm: null, distanceMiles: null, topSpeedKph: null, topSpeedMph: null,
        avgSpeedKph: null, avgSpeedMph: null, maxSteeringDeg: null, brakeEvents: null
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
