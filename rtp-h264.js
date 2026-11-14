/**
 * RFC 6184 RTP H.264 Depacketizer & Frame Assembler
 * Turns raw RTP packets into clean H.264 Access Units (Annex-B format) with timing and camera pair tags.
 */
class RtpH264Assembler {
  constructor(options = {}) {
    this.startMonotonicUs = options.startMonotonicUs || 0;
    this._lastSequenceBySsrc = new Map();
    this.currentAuDamaged = false;
    this.currentFu = null; // Buffer array for FU-A fragments
    this.currentFuNalHeader = 0;
    this.currentAuNals = [];
    this.accessUnits = [];
    this.sps = null;
    this.pps = null;

    // Load initial SPS/PPS from recoveryInfo in manifest if available
    if (options.recoveryInfo) {
      for (const ssrcKey in options.recoveryInfo) {
        const info = options.recoveryInfo[ssrcKey];
        if (info.sps && !this.sps) {
          const raw = atob(info.sps);
          const buf = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
          this.sps = buf;
        }
        if (info.pps && !this.pps) {
          const raw = atob(info.pps);
          const buf = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
          this.pps = buf;
        }
      }
    }

    // Standard BMW head-unit H.264 SPS/PPS parameters fallback (Profile 0x42 Main/Baseline, Level 0x1F, 1280x480)
    // Ensures clips without recoveryInfo in manifest.json never render as black frames on initial chunk
    if (!this.sps) {
      // 67 42 40 1F A6 80 50 0F 64 (Base64 "Z0JAH6aAUA9k")
      this.sps = new Uint8Array([0x67, 0x42, 0x40, 0x1F, 0xA6, 0x80, 0x50, 0x0F, 0x64]);
    }
    if (!this.pps) {
      // 68 CE 38 80 (Base64 "aM44gA==")
      this.pps = new Uint8Array([0x68, 0xCE, 0x38, 0x80]);
    }
  }

  static makeAvcC(sps, pps) {
    if (!sps || !pps || sps.length < 4 || pps.length < 1) return null;
    const avcC = new Uint8Array(11 + sps.length + pps.length);
    avcC[0] = 1; // configurationVersion
    avcC[1] = sps[1]; // AVCProfileIndication
    avcC[2] = sps[2]; // profile_compatibility
    avcC[3] = sps[3]; // AVCLevelIndication
    avcC[4] = 0xFF; // lengthSizeMinusOne: 3 (4 bytes)
    avcC[5] = 0xE1; // numOfSequenceParameterSets: 1
    avcC[6] = (sps.length >> 8) & 0xFF;
    avcC[7] = sps.length & 0xFF;
    avcC.set(sps, 8);
    const ppsOffset = 8 + sps.length;
    avcC[ppsOffset] = 1; // numOfPictureParameterSets: 1
    avcC[ppsOffset + 1] = (pps.length >> 8) & 0xFF;
    avcC[ppsOffset + 2] = pps.length & 0xFF;
    avcC.set(pps, ppsOffset + 3);
    return avcC;
  }

  static toKeyAvcc(avcc) {
    if (!avcc || avcc.length < 5) return avcc;
    // Check if it already has Recovery Point SEI (0x06, 0x06, 0x01, 0xC4)
    if (avcc.length >= 8 && avcc[0] === 0 && avcc[1] === 0 && avcc[2] === 0 && avcc[3] === 4 &&
        avcc[4] === 0x06 && avcc[5] === 0x06 && avcc[6] === 0x01 && avcc[7] === 0xC4) {
      return avcc;
    }
    const recoverySei = [0, 0, 0, 4, 0x06, 0x06, 0x01, 0xC4];
    const out = new Uint8Array(recoverySei.length + avcc.length);
    out.set(recoverySei, 0);
    out.set(avcc, recoverySei.length);

    let offset = recoverySei.length;
    while (offset + 4 < out.length) {
      const nlen = (out[offset] << 24) | (out[offset + 1] << 16) | (out[offset + 2] << 8) | out[offset + 3];
      offset += 4;
      if (offset < out.length) {
        const ntype = out[offset] & 31;
        if (ntype === 1) {
          out[offset] = (out[offset] & 0xE0) | 5;
          break;
        }
      }
      offset += nlen;
    }
    return out;
  }

  /**
   * Process all RTP video packets and correlate with camera pair metadata
   */
  process(videoRecords, cameraPairEvents = []) {
    // Build map of camera pair metadata by rtpTimestamp
    const pairMap = new Map();
    for (const cp of cameraPairEvents) {
      if (cp.rtpTimestamp !== undefined) {
        pairMap.set(cp.rtpTimestamp, cp.pair);
      }
    }

    let auNals = this.auNals || [];
    let damaged = this.currentAuDamaged || false;
    let currentRtpTs = this.currentRtpTs !== undefined ? this.currentRtpTs : null;
    let currentAtUs = this.currentAtUs !== undefined ? this.currentAtUs : null;
    let currentSsrc = this.currentSsrc !== undefined ? this.currentSsrc : null;

    for (let i = 0; i < videoRecords.length; i++) {
      const rec = videoRecords[i];
      const p = rec.payload;
      if (p.length < 12) continue; // Minimum RTP header size

      // RTP header parsing
      const v = p[0] >>> 6;
      if (v !== 2) continue; // Version must be 2

      const pBit = (p[0] >> 5) & 1;
      const xBit = (p[0] >> 4) & 1;
      const cc = p[0] & 15;
      const marker = (p[1] >> 7) & 1;
      const pt = p[1] & 127;

      const seq = (p[2] << 8) | p[3];
      const rtpTimestamp = ((p[4] << 24) | (p[5] << 16) | (p[6] << 8) | p[7]) >>> 0;
      const ssrc = ((p[8] << 24) | (p[9] << 16) | (p[10] << 8) | p[11]) >>> 0;

      let payloadOffset = 12 + cc * 4;
      let payloadEnd = p.length;

      // Header extension
      if (xBit) {
        if (payloadOffset + 4 <= payloadEnd) {
          const extLen = ((p[payloadOffset + 2] << 8) | p[payloadOffset + 3]) * 4;
          payloadOffset += 4 + extLen;
        }
      }

      // Padding
      if (pBit && payloadEnd > payloadOffset) {
        const padLen = p[payloadEnd - 1];
        if (padLen <= payloadEnd - payloadOffset) {
          payloadEnd -= padLen;
        }
      }

      if (payloadOffset >= payloadEnd) continue;

      const payload = p.subarray(payloadOffset, payloadEnd);
      const nalHeader = payload[0];
      const nalType = nalHeader & 31;

      if (currentRtpTs === null) {
        currentRtpTs = rtpTimestamp;
        currentAtUs = rec.atUs;
        currentSsrc = ssrc;
      }

      // A timestamp boundary also terminates an incomplete fragmented picture.
      if (rtpTimestamp !== currentRtpTs) {
        if (auNals.length || this.currentFu || damaged) this._emitAu(auNals, currentRtpTs, currentAtUs, currentSsrc, pairMap, damaged || !!this.currentFu);
        auNals = []; damaged = false; this.currentFu = null;
        currentRtpTs = rtpTimestamp;
        currentAtUs = rec.atUs;
        currentSsrc = ssrc;
      }
      const previousSeq=this._lastSequenceBySsrc.get(ssrc);
      this._lastSequenceBySsrc.set(ssrc,seq);
      if(previousSeq!==undefined && seq!==((previousSeq+1)&65535)) {
        // Quarantine the picture instead of submitting partial slices to WebCodecs.
        // Retain its bytes for diagnostics/legacy consumers and a timed placeholder
        // so alternating camera identities do not shift after missing footage.
        damaged=true;
      }

      // Extract NALs based on RFC 6184
      if (nalType >= 1 && nalType <= 23) {
        // Single NAL unit packet
        this.currentFu = null;
        this._recordParamSets(payload);
        auNals.push(payload);
      } else if (nalType === 24) {
        // STAP-A aggregation packet
        this.currentFu = null;
        let stapOffset = 1;
        while (stapOffset + 2 <= payload.length) {
          const nsize = (payload[stapOffset] << 8) | payload[stapOffset + 1];
          stapOffset += 2;
          if (stapOffset + nsize > payload.length) break;
          const subNal = payload.subarray(stapOffset, stapOffset + nsize);
          this._recordParamSets(subNal);
          auNals.push(subNal);
          stapOffset += nsize;
        }
      } else if (nalType === 28) {
        // FU-A fragmentation packet
        if (payload.length >= 3) {
          const fuIndicator = payload[0];
          const fuHeader = payload[1];
          const startBit = (fuHeader >> 7) & 1;
          const endBit = (fuHeader >> 6) & 1;
          const originalNalType = fuHeader & 31;
          const reconstructedHeader = (fuIndicator & 0xE0) | originalNalType;

          if (startBit) {
            this.currentFuNalHeader = reconstructedHeader;
            this.currentFu = [payload.subarray(2)];
          } else if (this.currentFu) {
            this.currentFu.push(payload.subarray(2));
          } else {
            damaged=true;
          }

          if (endBit && this.currentFu) {
            // Calculate total length
            let totalLen = 1; // 1 byte for reconstructed NAL header
            for (let part of this.currentFu) totalLen += part.length;

            const fullNal = new Uint8Array(totalLen);
            fullNal[0] = this.currentFuNalHeader;
            let writePos = 1;
            for (let part of this.currentFu) {
              fullNal.set(part, writePos);
              writePos += part.length;
            }

            this._recordParamSets(fullNal);
            auNals.push(fullNal);
            this.currentFu = null;
          }
        }
      }

      // Marker bit signals the completion of this Access Unit
      if (marker && (auNals.length > 0 || damaged || this.currentFu)) {
        this._emitAu(auNals, currentRtpTs, currentAtUs, currentSsrc, pairMap, damaged || !!this.currentFu);
        auNals = []; damaged = false; this.currentFu=null;
        currentRtpTs = null;
        currentAtUs = null;
        currentSsrc = null;
      }
    }

    this.auNals = auNals;
    this.currentAuDamaged=damaged;
    this.currentRtpTs = currentRtpTs;
    this.currentAtUs = currentAtUs;
    this.currentSsrc = currentSsrc;
    return this.accessUnits;
  }

  flush(pairSource) {
    let pairMap = pairSource;
    if (Array.isArray(pairSource)) {
      pairMap = new Map();
      for (const cp of pairSource) {
        if (cp && cp.rtpTimestamp !== undefined) {
          pairMap.set(cp.rtpTimestamp, cp.pair);
        }
      }
    }
    if ((this.auNals && this.auNals.length > 0) || this.currentFu || this.currentAuDamaged) {
      this._emitAu(this.auNals || [], this.currentRtpTs, this.currentAtUs, this.currentSsrc, pairMap, this.currentAuDamaged || !!this.currentFu);
      this.currentFu=null;this.currentAuDamaged=false;
      this.auNals = [];
      this.currentRtpTs = null;
      this.currentAtUs = null;
      this.currentSsrc = null;
    }
    return this.accessUnits;
  }

  _recordParamSets(nal) {
    const type = nal[0] & 31;
    if (type === 7) this.sps = nal;
    if (type === 8) this.pps = nal;
  }

  _isIntraSlice(nal) {
    if (!nal || nal.length < 2) return false;
    try {
      // Remove H.264 emulation prevention bytes (0x000003 -> 0x0000)
      const rbsp = [];
      let i = 1;
      while (i < nal.length) {
        if (i + 2 < nal.length && nal[i] === 0 && nal[i + 1] === 0 && nal[i + 2] === 3) {
          rbsp.push(0);
          rbsp.push(0);
          i += 3;
        } else {
          rbsp.push(nal[i]);
          i++;
        }
      }
      let bitPos = 0;
      const readBit = () => {
        const byteIdx = bitPos >> 3;
        if (byteIdx >= rbsp.length) return null;
        const val = (rbsp[byteIdx] >> (7 - (bitPos & 7))) & 1;
        bitPos++;
        return val;
      };
      const readUe = () => {
        let zeros = 0;
        while (true) {
          const bit = readBit();
          if (bit === null) return null;
          if (bit === 0) {
            zeros++;
            if (zeros > 31) return null;
          } else {
            let val = 1;
            for (let z = 0; z < zeros; z++) {
              const b = readBit();
              if (b === null) return null;
              val = (val << 1) | b;
            }
            return val - 1;
          }
        }
      };
      if (readUe() === null) return false;
      const sliceType = readUe();
      if (sliceType === null) return false;
      // H.264 slice_type: 2=I, 4=SI, 7=I, 9=SI
      return sliceType === 2 || sliceType === 4 || sliceType === 7 || sliceType === 9;
    } catch (e) {
      return false;
    }
  }

  _emitAu(nals, rtpTimestamp, atUs, ssrc, pairMap, damaged = false) {
    if ((!nals || nals.length === 0) && !damaged) return;

    // Determine camera pair and phase
    const phase = this.accessUnits.length % 2;

    let pair = (pairMap && typeof pairMap.get === "function") ? pairMap.get(rtpTimestamp) : null;
    if (!pair) {
      pair = phase === 0 ? "frontRear" : "leftRight";
    }

    // In WebCodecs, only the first frame bootstraps with recovery point SEI
    const isFirstAu = (this.accessUnits.length === 0);
    const hasIdrNal = nals.some(n => (n[0] & 31) === 5);
    const isKeyFrame = isFirstAu || hasIdrNal;

    // Record SPS/PPS for description configuration
    for (const nal of nals) {
      const type = nal[0] & 31;
      if (type === 7) this.sps = nal;
      if (type === 8) this.pps = nal;
    }

    // Build Annex-B byte buffer
    let totalSize = 0;
    for (const nal of nals) totalSize += 4 + nal.length;
    const annexB = new Uint8Array(totalSize);
    let offset = 0;

    const appendNal = (nal) => {
      annexB[offset] = 0;
      annexB[offset + 1] = 0;
      annexB[offset + 2] = 0;
      annexB[offset + 3] = 1;
      offset += 4;
      annexB.set(nal, offset);
      offset += nal.length;
    };

    for (const nal of nals) appendNal(nal);

    // Build AVCC byte buffer (4-byte length prefix per NAL; SPS/PPS omitted as they live in description)
    // If isFirstAu is true: prepend Recovery Point SEI and rewrite initial slice NAL header to IDR (type 5)
    const recoverySei = new Uint8Array([0x06, 0x06, 0x01, 0xC4]);
    let avccSize = isFirstAu ? (4 + recoverySei.length) : 0;
    for (const nal of nals) {
      const type = nal[0] & 31;
      if (type === 7 || type === 8) continue;
      avccSize += 4 + nal.length;
    }
    if (avccSize === 0 && !damaged) return;
    const avcc = new Uint8Array(avccSize);
    let avccOffset = 0;

    if (isFirstAu) {
      const seiLen = recoverySei.length;
      avcc[avccOffset] = (seiLen >>> 24) & 0xFF;
      avcc[avccOffset + 1] = (seiLen >>> 16) & 0xFF;
      avcc[avccOffset + 2] = (seiLen >>> 8) & 0xFF;
      avcc[avccOffset + 3] = seiLen & 0xFF;
      avccOffset += 4;
      avcc.set(recoverySei, avccOffset);
      avccOffset += seiLen;
    }

    for (const nal of nals) {
      const type = nal[0] & 31;
      if (type === 7 || type === 8) continue;
      const len = nal.length;
      avcc[avccOffset] = (len >>> 24) & 0xFF;
      avcc[avccOffset + 1] = (len >>> 16) & 0xFF;
      avcc[avccOffset + 2] = (len >>> 8) & 0xFF;
      avcc[avccOffset + 3] = len & 0xFF;
      avccOffset += 4;
      
      // Do not mutate slice NAL header - keep valid uncorrupted slice syntax
      avcc.set(nal, avccOffset);
      avccOffset += len;
    }

    const timeSec = Math.max(0, (atUs - this.startMonotonicUs) / 1000000.0);

    this.accessUnits.push({
      index: this.accessUnits.length,
      rtpTimestamp: rtpTimestamp,
      atUs: atUs,
      time: timeSec,
      ssrc: ssrc,
      isKeyFrame: isKeyFrame,
      damaged: Boolean(damaged),
      phase: phase,
      pair: pair,
      data: annexB,
      avcc: avcc
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RtpH264Assembler };
}
