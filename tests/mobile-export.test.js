const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function createMockEnvironment() {
  const drawnTexts = [];
  const drawnImages = [];
  const fillStyles = [];
  const roundRects = [];
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'measureText') return (t) => ({ width: t ? t.length * 8 : 10 });
      if (k === 'fillText') return (...args) => { drawnTexts.push(args[0]); };
      if (k === 'drawImage') return (...args) => { drawnImages.push(args); };
      if (k === 'roundRect') return (...args) => { roundRects.push(args); };
      return () => {};
    },
    set: (_, k, v) => {
      if (k === 'fillStyle') fillStyles.push(v);
      return true;
    }
  });

  class Encoder {
    constructor(o) { this.o = o; this.encodeQueueSize = 0; }
    configure() {}
    encode(frame) {
      this.o.output({
        type: 'key',
        timestamp: frame.timestamp,
        duration: null,
        byteLength: 5,
        copyTo: b => b.set([0, 0, 0, 1, 5])
      }, { decoderConfig: { description: new Uint8Array([1]) } });
    }
    async flush() {}
    close() {}
  }

  class Muxer {
    constructor(o) { this.target = { buffer: new ArrayBuffer(10) }; }
    addVideoChunk() { throw new Error('Missing duration'); }
    addVideoChunkRaw(...args) { calls.push(args); }
    finalize() {}
  }

  const calls = [];
  const s = {
    console,
    setTimeout,
    clearTimeout,
    performance,
    document: {
      createElement: () => ({
        getContext: () => ctx,
        width: 1280,
        height: 960
      })
    },
    VideoEncoder: Encoder,
    VideoFrame: class { constructor(_, o) { Object.assign(this, o); } close() {} },
    Mp4Muxer: { Muxer, ArrayBufferTarget: class {} },
    VideoDecoder: undefined
  };

  vm.runInNewContext(fs.readFileSync(require.resolve('../exporter'), 'utf8') + '\nthis.Exporter = ClipExporter;', s);
  return { s, calls, drawnTexts, drawnImages, fillStyles, roundRects, ctx };
}

test('export supplies sample durations when a browser encoder omits them', async () => {
  const { s, calls } = createMockEnvironment();
  const player = { duration: 0.1, manifest: { id: 'test' }, accessUnits: [], lastFrFrame: {}, lastLrFrame: {}, decodedFrames: new Map() };
  const result = await new s.Exporter(player).export({ includeHud: false });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c[3] === 33333));
  assert.match(result.fileName, /\.m4v$/);
});
test('short exports near recording end decode from the preceding keyframe instead of the entire drive',async()=>{
 const {s}=createMockEnvironment(),submitted=[];
 s.EncodedVideoChunk=class{constructor(o){Object.assign(this,o);}};
 s.createImageBitmap=async f=>({close(){}});
 s.RtpH264Assembler={makeAvcC:()=>new Uint8Array([1])};
 s.VideoDecoder=class{constructor(o){this.o=o;this.decodeQueueSize=0;}configure(){}decode(c){submitted.push(c.timestamp);this.o.output({timestamp:c.timestamp,close(){}});}async flush(){}close(){}};
 const player={_clipEpoch:1,duration:10,manifest:{id:'late'},assembler:{},cameraMapping:{phase0:'frontRear'},decodedFrames:new Map(),accessUnits:Array.from({length:100},(_,index)=>({index,time:index/10,isKeyFrame:index%10===0,avcc:new Uint8Array([1])}))};
 await new s.Exporter(player).export({duration:.1,includeHud:false});
 assert.equal(submitted[0],90);assert(submitted.every(i=>i>=90));
});
test('late export from an open GOP skips bitmap conversion for discarded preroll frames',async()=>{
 const {s}=createMockEnvironment(),converted=[];
 s.EncodedVideoChunk=class{constructor(o){Object.assign(this,o);}};
 s.createImageBitmap=async f=>{converted.push(f.timestamp);return {close(){}};};
 s.RtpH264Assembler={makeAvcC:()=>new Uint8Array([1])};
 s.VideoDecoder=class{constructor(o){this.o=o;this.decodeQueueSize=0;}configure(){}decode(c){this.o.output({timestamp:c.timestamp,close(){}});}async flush(){}close(){}};
 const player={_clipEpoch:1,duration:10,manifest:{id:'open-gop'},assembler:{},cameraMapping:{phase0:'frontRear'},decodedFrames:new Map(),accessUnits:Array.from({length:100},(_,index)=>({index,time:index/10,isKeyFrame:index===0,avcc:new Uint8Array([1])}))};
 await new s.Exporter(player).export({duration:.1,includeHud:false});
 assert(converted.length<20);assert(converted.includes(98)&&converted.includes(99));
});

test('renderFrame renders different camera angle views correctly', () => {
  const { s, drawnImages } = createMockEnvironment();
  const player = {
    duration: 10,
    cameraMapping: { phase0: 'frontRear', flipHalves: false },
    manifest: { id: 'test', startMonotonicUs: 0 }
  };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');
  const dummyFr = { tag: 'fr' };
  const dummyLr = { tag: 'lr' };

  // 1. Quad view
  drawnImages.length = 0;
  exporter.renderFrame(canvas, { view: 'quad', fr: dummyFr, lr: dummyLr, overlays: { includeHud: false } });
  assert.equal(drawnImages.length, 4, 'Quad view must draw 4 camera quadrant slices');

  // 2. Front view
  drawnImages.length = 0;
  exporter.renderFrame(canvas, { view: 'front', fr: dummyFr, lr: dummyLr, overlays: { includeHud: false } });
  assert.equal(drawnImages.length, 1);
  assert.equal(drawnImages[0][0], dummyFr, 'Front view must draw front/rear pair');

  // 3. Left view
  drawnImages.length = 0;
  exporter.renderFrame(canvas, { view: 'left', fr: dummyFr, lr: dummyLr, overlays: { includeHud: false } });
  assert.equal(drawnImages.length, 1);
  assert.equal(drawnImages[0][0], dummyLr, 'Left view must draw left/right pair');

  // 4. Source view
  drawnImages.length = 0;
  exporter.renderFrame(canvas, { view: 'source', fr: dummyFr, lr: dummyLr, overlays: { includeHud: false } });
  assert.equal(drawnImages.length, 2, 'Source view draws both uncropped strips');
});

test('branding rule: BimmerVision logo appears if ANY metadata is visible other than current time', () => {
  const { s, drawnTexts } = createMockEnvironment();
  const player = { duration: 10, manifest: { id: 'test' }, accessUnits: [] };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  const hasLogoText = () => drawnTexts.some(t => String(t).includes('BIMMER') || String(t).includes('BIMMERVISION'));

  // Test 1: All metadata enabled -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: true, speed: true, speedLimit: true, steering: true, brake: true, gas: true, time: true }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when all metadata is enabled');

  // Test 2: ONLY current time enabled -> Logo MUST NOT be visible!
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: false, speed: false, speedLimit: false, steering: false, brake: false, gas: false, time: true }
  });
  assert.ok(!hasLogoText(), 'Logo MUST NOT be visible when ONLY current time is enabled');
  assert.ok(drawnTexts.some(t => t.includes(':')), 'Timecode should be drawn when time is enabled');

  // Test 3: NO metadata enabled at all -> Nothing drawn in telemetry overlay
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    view: 'source',
    time: 5,
    overlays: { blinkers: false, speed: false, speedLimit: false, steering: false, brake: false, gas: false, time: false }
  });
  assert.ok(!hasLogoText(), 'Logo must not be drawn when no metadata is enabled');
  assert.equal(drawnTexts.length, 0, 'No telemetry text should be drawn when no metadata is enabled');

  // Test 4: ONLY Speed enabled (no time) -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: false, speed: true, speedLimit: false, steering: false, brake: false, gas: false, time: false }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when speed is enabled');

  // Test 5: ONLY Blinkers enabled -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: true, speed: false, speedLimit: false, steering: false, brake: false, gas: false, time: false }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when blinkers are enabled');

  // Test 6: ONLY Brake Pedal enabled -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: false, speed: false, speedLimit: false, steering: false, brake: true, gas: false, time: false }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when brake pedal is enabled');
  assert.ok(drawnTexts.some(t => t === 'BRAKE'), 'BRAKE text should be present');

  // Test 7: ONLY Gas Pedal enabled -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: false, speed: false, speedLimit: false, steering: false, brake: false, gas: true, time: false }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when gas pedal is enabled');
  assert.ok(drawnTexts.some(t => t === 'GAS'), 'GAS text should be present');

  // Test 8: ONLY Steering Radius enabled -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: false, speed: false, speedLimit: false, steering: true, brake: false, gas: false, time: false }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when steering radius is enabled');

  // Test 9: Speed and Current Time enabled -> Logo MUST be visible
  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 5,
    overlays: { blinkers: false, speed: true, speedLimit: false, steering: false, brake: false, gas: false, time: true }
  });
  assert.ok(hasLogoText(), 'Logo should be visible when speed and time are enabled');
});

test('blinker arrow flashes at automotive cadence (1.5 Hz: ON for first half-period, OFF for second half-period)', () => {
  const { s, fillStyles } = createMockEnvironment();
  const player = { duration: 10, manifest: { id: 'test' }, accessUnits: [] };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  // t = 0s: within [0, 0.333s] -> blinker MUST be ON (#38D47A)
  fillStyles.length = 0;
  exporter.renderFrame(canvas, {
    time: 0.1,
    telemetry: { indicator: 'left' },
    overlays: { blinkers: true, speed: false, speedLimit: false, steering: false, brake: false, gas: false, time: false }
  });
  assert.ok(fillStyles.includes('#38D47A'), 'Blinker should be active green during ON phase');

  // t = 0.45s: within [0.333s, 0.667s] -> blinker MUST be OFF (rgba(160, 170, 195, ...))
  fillStyles.length = 0;
  exporter.renderFrame(canvas, {
    time: 0.45,
    telemetry: { indicator: 'left' },
    overlays: { blinkers: true, speed: false, speedLimit: false, steering: false, brake: false, gas: false, time: false }
  });
  assert.ok(!fillStyles.includes('#38D47A'), 'Blinker should NOT be active green during OFF phase');

  // t = 0.75s: next cycle [0.667s, 1.0s] -> blinker MUST be ON again (#38D47A)
  fillStyles.length = 0;
  exporter.renderFrame(canvas, {
    time: 0.75,
    telemetry: { indicator: 'left' },
    overlays: { blinkers: true, speed: false, speedLimit: false, steering: false, brake: false, gas: false, time: false }
  });
  assert.ok(fillStyles.includes('#38D47A'), 'Blinker should be active green again in next ON phase');
});

test('blinker bar width is spacious (>= 760px) in 1280x960 export', () => {
  const { s, roundRects } = createMockEnvironment();
  const player = { duration: 10, manifest: { id: 'test' }, accessUnits: [] };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  roundRects.length = 0;
  exporter.renderFrame(canvas, {
    time: 1.0,
    overlays: { blinkers: true, speed: true, speedLimit: true, steering: true, brake: true, gas: true, time: true }
  });
  // Find the telemetry banner (height >= 48)
  const banner = roundRects.find(r => r[3] >= 48);
  assert.ok(banner, 'Telemetry overlay should draw banner roundRect background');
  const bannerWidth = banner[2];
  assert.ok(bannerWidth >= 760, `Banner width (${bannerWidth}px) should be at least 760px for a wide, un-squished display`);
});

test('steering wheel does not render degrees text in export', () => {
  const { s, drawnTexts } = createMockEnvironment();
  const player = { duration: 10, manifest: { id: 'test' }, accessUnits: [] };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 1.0,
    telemetry: { steeringAngleDeg: 45 },
    overlays: { steering: true, speed: false, speedLimit: false, blinkers: false, brake: false, gas: false, time: false }
  });
  assert.ok(!drawnTexts.some(t => t.includes('°')), 'Steering wheel degrees number should be removed in export');
});

test('export seeks native preview video to advance frames when in native mode', async () => {
  const { s, calls } = createMockEnvironment();
  const soughtTimes = [];
  const mockVideo = {
    currentTime: 0,
    paused: true,
    addEventListener: (evt, handler) => {
      if (evt === 'seeked') setTimeout(handler, 0);
    },
    removeEventListener: () => {}
  };
  Object.defineProperty(mockVideo, 'currentTime', {
    get: () => mockVideo._time || 0,
    set: (t) => {
      mockVideo._time = t;
      soughtTimes.push(t);
    }
  });

  const mockPairs = [
    { getContext: () => ({ drawImage: () => {} }) },
    { getContext: () => ({ drawImage: () => {} }) }
  ];

  const player = {
    duration: 0.1,
    manifest: { id: 'test' },
    accessUnits: [],
    cameraMapping: { phase0: 'frontRear' },
    _nativeVideo: mockVideo,
    _nativePairs: mockPairs,
    lastFrFrame: {},
    lastLrFrame: {}
  };

  const exporter = new s.Exporter(player);
  await exporter.export({ duration: 0.1, includeHud: false });
  assert.ok(soughtTimes.length >= 3, 'Native video must be sought across frames to keep video moving');
});

test('export includes formatted date with the time when startedAt is provided in manifest', () => {
  const { s, drawnTexts } = createMockEnvironment();
  const player = {
    duration: 10,
    manifest: { id: 'test', startedAt: '2026-11-13T13:04:26.000Z' },
    cameraMapping: { phase0: 'frontRear' }
  };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 0,
    overlays: { time: true, speed: false, blinkers: false, speedLimit: false, steering: false, brake: false, gas: false },
    manifest: player.manifest
  });

  assert.ok(drawnTexts.some(t => /Nov\s+13,\s+2026|11\/13\/2026|13\s+Nov/i.test(t)), 'Export time display should include formatted date');
});

test('export renders speed limit sign with correct limit value', () => {
  const { s, drawnTexts } = createMockEnvironment();
  const player = {
    duration: 10,
    manifest: { id: 'test' },
    cameraMapping: { phase0: 'frontRear' },
    currentSpeedLimit: { limit: 45, unit: 'mph' }
  };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  drawnTexts.length = 0;
  exporter.renderFrame(canvas, {
    time: 0,
    telemetry: { speedLimit: 45, speedLimitUnit: 'mph' },
    overlays: { speedLimit: true, speed: false, blinkers: false, steering: false, brake: false, gas: false, time: false }
  });

  assert.ok(drawnTexts.includes('SPEED'), 'Speed limit sign header SPEED must be rendered');
  assert.ok(drawnTexts.includes('45'), 'Speed limit value 45 must be rendered inside the badge');
});

test('gas pedal activates when CAN accelerator is boolean true or percentage > 5', () => {
  const { s, fillStyles } = createMockEnvironment();
  const player = { duration: 10, manifest: { id: 'test' }, cameraMapping: { phase0: 'frontRear' } };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  // Test boolean true (BMW SOME/IP CAN record format)
  fillStyles.length = 0;
  exporter.renderFrame(canvas, {
    time: 0,
    telemetry: { gasPressed: true, acceleratorPercent: 100 },
    overlays: { gas: true, brake: false, speed: false, blinkers: false, steering: false, speedLimit: false, time: false, map: false }
  });
  assert.ok(fillStyles.includes('#38D47A'), 'Gas pedal must light up green (#38D47A) when gasPressed is boolean true');

  // Test idle / not pressed
  fillStyles.length = 0;
  exporter.renderFrame(canvas, {
    time: 0,
    telemetry: { gasPressed: false, acceleratorPercent: 0 },
    overlays: { gas: true, brake: false, speed: false, blinkers: false, steering: false, speedLimit: false, time: false, map: false }
  });
  assert.ok(!fillStyles.includes('#38D47A'), 'Gas pedal must NOT light up green when gas is idle');
});

test('blinker/telemetry bar is positioned below camera playback at y >= 960 with full video width', () => {
  const { s, roundRects } = createMockEnvironment();
  const player = { duration: 10, manifest: { id: 'test' }, cameraMapping: { phase0: 'frontRear' } };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  // 1. Without map (1280 wide): bar at y = 960, width = 1280, height = 80
  roundRects.length = 0;
  exporter.renderFrame(canvas, {
    time: 0,
    overlays: { map: false, blinkers: true, speed: true, time: true }
  });
  const barNoMap = roundRects.find(r => r[1] === 960 && r[2] === 1280);
  assert.ok(barNoMap, 'Telemetry bar must be at y = 960 with full video width 1280');
  assert.equal(barNoMap[3], 80, 'Bar height without map should be 80px');

  // 2. With map (1920 wide): bar at y = 960, width = 1920, height = 120
  roundRects.length = 0;
  exporter.renderFrame(canvas, {
    time: 0,
    overlays: { map: true, blinkers: true, speed: true, time: true }
  });
  const barWithMap = roundRects.find(r => r[1] === 960 && r[2] === 1920);
  assert.ok(barWithMap, 'Telemetry bar must be at y = 960 with full video width 1920');
  assert.equal(barWithMap[3], 120, 'Bar height with map should be 120px');
});

test('export with route map renders 1920x1080 Full HD without camera quality loss', () => {
  const { s, drawnTexts } = createMockEnvironment();
  let mapDrawn = false;
  let mapX = 0, mapY = 0, mapW = 0, mapH = 0;
  const mockLiveMap = {
    drawTo: (_ctx, x, y, w, h, _time) => {
      mapDrawn = true;
      mapX = x; mapY = y; mapW = w; mapH = h;
    }
  };

  const player = {
    duration: 10,
    manifest: { id: 'test' },
    cameraMapping: { phase0: 'frontRear' },
    liveMap: mockLiveMap
  };
  const exporter = new s.Exporter(player);
  const canvas = s.document.createElement('canvas');

  exporter.renderFrame(canvas, {
    time: 2.5,
    map: mockLiveMap,
    overlays: { map: true, blinkers: true, speed: true, time: true }
  });

  assert.equal(canvas.width, 1920, 'Export canvas width must be 1920 when map is included');
  assert.equal(canvas.height, 1080, 'Export canvas height must be 1080 (1080p Full HD) when map and telemetry are included');
  assert.ok(mapDrawn, 'Live route map must be drawn');
  assert.equal(mapX, 1280, 'Map must start at x = 1280 alongside 1280px cameras');
  assert.equal(mapY, 0, 'Map must start at y = 0');
  assert.equal(mapW, 640, 'Map width must be 640');
  assert.equal(mapH, 960, 'Map height must be 960 matching native camera height');
});

test('MediaRecorder fallback exports video when VideoEncoder is not available', async () => {
  const { s } = createMockEnvironment();
  delete s.VideoEncoder;

  class MockMediaRecorder {
    constructor(stream, opts) {
      this.stream = stream;
      this.opts = opts;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      setTimeout(() => {
        if (this.ondataavailable) {
          this.ondataavailable({ data: { size: 10, slice: () => new Uint8Array([1, 2, 3]) } });
        }
        if (this.onstop) this.onstop();
      }, 0);
    }
  }
  s.MediaRecorder = MockMediaRecorder;
  s.Blob = class {
    constructor(chunks, opts) { this.chunks = chunks; this.type = opts?.type; }
    async arrayBuffer() { return new ArrayBuffer(10); }
  };

  const origCreateElement = s.document.createElement;
  s.document.createElement = (tag) => {
    const el = origCreateElement(tag);
    if (tag === 'canvas') {
      el.captureStream = () => ({
        getVideoTracks: () => [{ requestFrame: () => {} }]
      });
    }
    return el;
  };

  const player = {
    duration: 0.05,
    manifest: { id: 'test-mr-001' },
    accessUnits: [],
    lastFrFrame: {},
    lastLrFrame: {}
  };

  const exporter = new s.Exporter(player);
  const result = await exporter.export({ duration: 0.05, overlays: { map: false } });
  assert.ok(result.buffer, 'Result must contain video buffer');
  assert.match(result.fileName, /BimmerVision-test-mr-/);
});


test('export rejects a transfer that resolves without a complete recording', async()=>{
  const {s}=createMockEnvironment();
  const player={manifest:{id:'partial'},streamComplete:false,streamPromise:Promise.resolve()};
  await assert.rejects(new s.Exporter(player).export({includeHud:false}),/incomplete|complete recording/i);
});
test('export waits on the cancellable recording gate and does not encode a replacement clip',async()=>{
  const {s,calls}=createMockEnvironment();let waited=false;
  const player={manifest:{id:'old'},streamComplete:false,streamPromise:Promise.resolve(),
    async waitForCompleteRecording(){waited=true;throw new Error('Recording changed. Reopen export.');}};
  await assert.rejects(new s.Exporter(player).export({includeHud:false}),/Recording changed/);
  assert.equal(waited,true);assert.equal(calls.length,0);
});

test('export quarantines damaged source AUs and keeps missing camera footage blank',async()=>{
 const {s}=createMockEnvironment(),submitted=[],images=[];
 s.EncodedVideoChunk=class{constructor(o){Object.assign(this,o);}};
 s.createImageBitmap=async f=>({index:f.timestamp,close(){}});
 s.RtpH264Assembler={makeAvcC:()=>new Uint8Array([1])};
 s.VideoDecoder=class{constructor(o){this.o=o;this.decodeQueueSize=0;}configure(){}decode(c){submitted.push(c.timestamp);this.o.output({timestamp:c.timestamp,close(){}});}async flush(){}close(){}};
 const player={duration:.1,manifest:{id:'loss'},streamComplete:true,assembler:{},cameraMapping:{phase0:'frontRear'},decodedFrames:new Map(),lastLrFrame:{stale:true},
   accessUnits:[{index:0,time:0,isKeyFrame:true,avcc:new Uint8Array([1])},{index:1,time:.03,damaged:true,avcc:new Uint8Array([2])},{index:2,time:.06,avcc:new Uint8Array([3])}]};
 const e=new s.Exporter(player);e.renderFrame=(_,o)=>images.push(o.cameraFrames || {fr:o.fr,lr:o.lr});
 await e.export({includeHud:false});assert.deepEqual(submitted,[0,2]);assert.ok(images.length>0);assert.ok(images.every(o=>o.lr===null));assert.ok(images.every(o=>o.fr));
});

function exportPlayer(){return {duration:.05,manifest:{id:'bounded'},streamComplete:true,accessUnits:[],lastFrFrame:{},lastLrFrame:{},decodedFrames:new Map()};}
async function rejectsWithoutHanging(promise,pattern){
 const result=await Promise.race([promise.then(()=>({ok:true}),error=>({error})),new Promise(r=>setTimeout(()=>r({hung:true}),120))]);
 assert.equal(result.hung,undefined,'export completion must terminate instead of waiting indefinitely');assert.ok(result.error,'export must report failure');assert.match(result.error.message,pattern);
}
test('a never-settling encoder flush fails and closes the encoder',async()=>{
 const {s}=createMockEnvironment();let closed=false;s.VideoEncoder=class{constructor(){this.encodeQueueSize=0;}configure(){}encode(){}flush(){return new Promise(()=>{});}close(){closed=true;}};
 const e=new s.Exporter(exportPlayer());e.completionTimeoutMs=15;
 await rejectsWithoutHanging(e.export({includeHud:false}),/finaliz|encoder|retry/i);assert.equal(closed,true);
});
for(const stalled of ['flush','bitmap'])test(`a never-settling source ${stalled} fails without blocking cleanup`,async()=>{
 const {s}=createMockEnvironment();let closed=false;s.EncodedVideoChunk=class{constructor(o){Object.assign(this,o);}};s.RtpH264Assembler={makeAvcC:()=>new Uint8Array([1])};
 s.createImageBitmap=()=>new Promise(()=>{});
 s.VideoDecoder=class{constructor(o){this.o=o;this.decodeQueueSize=0;}configure(){}decode(c){if(stalled==='bitmap')this.o.output({timestamp:c.timestamp,close(){}});}flush(){return stalled==='flush'?new Promise(()=>{}):Promise.resolve();}close(){closed=true;}};
 const p=exportPlayer();p.assembler={};p.accessUnits=[{index:0,time:0,isKeyFrame:true,avcc:new Uint8Array([1])},{index:1,time:.03,avcc:new Uint8Array([2])}];
 const e=new s.Exporter(p);e.completionTimeoutMs=15;await rejectsWithoutHanging(e.export({includeHud:false}),/source|bitmap|retry/i);assert.equal(closed,true);
});
function recorderEnvironment(){
 const env=createMockEnvironment(),{s}=env;delete s.VideoEncoder;let stopped=0;
 const make=s.document.createElement;s.document.createElement=tag=>{const c=make(tag);c.captureStream=()=>({getVideoTracks:()=>[{requestFrame(){},stop(){stopped++;}}]});return c;};
 s.Blob=class{async arrayBuffer(){return new ArrayBuffer(5);}};
 s.MediaRecorder=class{constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';}};
 return {...env,stopped:()=>stopped};
}
test('a recorder that never fires stop times out and releases canvas tracks',async()=>{
 const {s,stopped}=recorderEnvironment();const e=new s.Exporter(exportPlayer());e.completionTimeoutMs=15;
 await rejectsWithoutHanging(e.export({includeHud:false}),/finaliz|recorder|retry/i);assert.ok(stopped()>0);
});
test('a native frame callback that never fires is bounded and removed on failure',async()=>{
 const {s,stopped}=recorderEnvironment();let cancelled=false;const listeners=new Map(),p=exportPlayer();
 s.requestAnimationFrame=()=>1;p._nativeVideo={currentTime:0,paused:true,ended:false,play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},requestVideoFrameCallback(){return 7;},cancelVideoFrameCallback(id){assert.equal(id,7);cancelled=true;},addEventListener(n,f){listeners.set(n,f);},removeEventListener(n,f){if(listeners.get(n)===f)listeners.delete(n);}};
 const e=new s.Exporter(p);e.completionTimeoutMs=15;await rejectsWithoutHanging(e.export({includeHud:false}),/frame|retry/i);assert.equal(cancelled,true);assert.equal(listeners.size,0);assert.ok(stopped()>0);
});

test('aborting an export interrupts a never-settling encoder flush promptly',async()=>{
 const {s}=createMockEnvironment();let closed=false;s.VideoEncoder=class{constructor(){this.encodeQueueSize=0;}configure(){}encode(){}flush(){return new Promise(()=>{});}close(){closed=true;}};
 const controller=new AbortController(),e=new s.Exporter(exportPlayer());e.completionTimeoutMs=10000;
 const pending=e.export({includeHud:false,signal:controller.signal});setTimeout(()=>controller.abort(),10);
 await rejectsWithoutHanging(pending,/cancelled|aborted/i);assert.equal(closed,true);
});
test('native EOF releases a pending frame callback without waiting for its timeout',async()=>{
 const {s}=createMockEnvironment();let ended,removed=0,cancelled=0;
 const video={ended:false,addEventListener(n,f){if(n==='ended')ended=f;},removeEventListener(){removed++;},requestVideoFrameCallback(){return 9;},cancelVideoFrameCallback(){cancelled++;}};
 const e=new s.Exporter(exportPlayer()),operation=e._operationContext({});const waiting=e._waitForNativeFrame(video,operation);
 video.ended=true;ended();assert.equal(await waiting,false);assert.equal(removed,2);assert.equal(cancelled,1);
});
test('late bitmap output after a timeout is closed instead of being retained',async()=>{
 const {s}=createMockEnvironment();let release,closed=false;s.EncodedVideoChunk=class{constructor(o){Object.assign(this,o);}};s.RtpH264Assembler={makeAvcC:()=>new Uint8Array([1])};
 s.createImageBitmap=()=>new Promise(r=>release=()=>r({close(){closed=true;}}));
 s.VideoDecoder=class{constructor(o){this.o=o;this.decodeQueueSize=0;}configure(){}decode(c){if(c.timestamp===0)this.o.output({timestamp:0,close(){}});}flush(){return Promise.resolve();}close(){}};
 const p=exportPlayer();p.assembler={};p.accessUnits=[{index:0,time:0,isKeyFrame:true,avcc:new Uint8Array([1])},{index:1,time:.03,avcc:new Uint8Array([2]),damaged:true}];
 const e=new s.Exporter(p);e.completionTimeoutMs=15;await rejectsWithoutHanging(e.export({includeHud:false}),/bitmap|retry/i);
 release();await new Promise(r=>setTimeout(r,5));assert.equal(closed,true);
});

// Record canvas coordinates after transforms so layout assertions cover the actual
// artwork and text draw calls, rather than repeating the layout calculations.
function hudDrawing(width, assets, overlays, telemetry = {}) {
  const { s } = createMockEnvironment();
  Object.assign(s.Exporter.assets, assets);
  const draws = [], stack = [];
  let state = { x: 0, y: 0, sx: 1, sy: 1, font: '10px sans-serif' }, points = [];
  const textWidth = t => String(t).length * Number(state.font.match(/([\d.]+)px/)[1]) * 0.62;
  const bounds = (kind, x, y, w, h, extra = {}) => draws.push({ kind, x: state.x + x * state.sx, y: state.y + y * state.sy, w: w * state.sx, h: h * state.sy, ...extra });
  const ctx = new Proxy({}, {
    set: (_, key, value) => { state[key] = value; return true; },
    get: (_, key) => ({
      save: () => stack.push({ ...state }), restore: () => { state = stack.pop(); },
      translate: (x, y) => { state.x += x * state.sx; state.y += y * state.sy; },
      scale: (x, y) => { state.sx *= x; state.sy *= y; },
      measureText: t => ({ width: textWidth(t) }),
      fillText: (t, x, y) => bounds('text', x, y - Number(state.font.match(/([\d.]+)px/)[1]), textWidth(t), Number(state.font.match(/([\d.]+)px/)[1]), { text: String(t) }),
      drawImage: (image, x, y, w, h) => bounds(image.tag, x, y, w, h),
      beginPath: () => { points = []; },
      moveTo: (x, y) => points.push([x, y]), lineTo: (x, y) => points.push([x, y]),
      fill: () => {
        if (points.length === 7) {
          const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
          bounds('arrow', Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        }
      }
    }[key] || (() => {}))
  });
  const manifest = { startedAt: '2026-11-13T13:04:26.000Z' };
  new s.Exporter({ manifest })._drawTelemetryOverlay(ctx, width, 960, 80, telemetry, 'mph', 0.1, overlays, manifest);
  return draws;
}

const hudAsset = (tag, naturalWidth, naturalHeight) => ({ tag, complete: true, naturalWidth, naturalHeight });

test('HUD artwork and date/time stay separated at every export width and metadata toggle combination', () => {
  const keys = ['blinkers', 'speed', 'speedLimit', 'steering', 'brake', 'gas', 'time'];
  for (const width of [720, 1080, 1280, 1920]) {
    for (const brand of ['wordmark', 'eye', 'vector']) {
      for (let mask = 1; mask < 128; mask++) {
        const overlays = Object.fromEntries(keys.map((key, i) => [key, Boolean(mask & (1 << i))]));
        const draws = hudDrawing(width, {
          wheel: hudAsset('wheel', 256, 256),
          wordmark: brand === 'wordmark' ? hudAsset('logo', 880, 127) : null,
          eye: brand === 'eye' ? hudAsset('logo', 634, 428) : null
        }, overlays, { speedMph: 123, speedLimit: 65 });
        const label = `${width}px ${brand} mask ${mask}`;
        for (const draw of draws) {
          assert.ok(draw.x >= 0 && draw.x + draw.w <= width + 0.01, `${label}: ${draw.kind} outside horizontal bounds`);
          assert.ok(draw.y >= 960 && draw.y + draw.h <= 1040.01, `${label}: ${draw.kind} outside bar`);
        }
        const logo = draws.filter(d => d.kind === 'logo' || /BIMMER|VISION/.test(d.text || ''));
        const time = draws.filter(d => d.kind === 'text' && /:|2026/.test(d.text));
        const cockpit = draws.filter(d => ['wheel', 'arrow'].includes(d.kind));
        const speed = draws.filter(d => d.kind === 'text' && /^(123|MPH|65|SPEED)$/.test(d.text));
        const pedals = draws.filter(d => /^(BRAKE|GAS)$/.test(d.text || ''));
        for (const a of logo) for (const b of time) assert.ok(a.x + a.w + 6 <= b.x, `${label}: branding overlaps date/time`);
        for (const a of pedals) for (const b of [...logo, ...time]) assert.ok(a.x + a.w + 4 <= b.x, `${label}: pedals overlap ${b.text || b.kind}`);
        for (const a of speed) for (const b of [...logo, ...time, ...pedals]) assert.ok(a.x + a.w + 4 <= b.x, `${label}: speed overlaps ${b.text || b.kind}`);
        for (const a of cockpit) for (const b of [...logo, ...time, ...speed, ...pedals]) {
          assert.ok(a.x + a.w + 4 <= b.x || b.x + b.w + 4 <= a.x, `${label}: cockpit overlaps ${b.text || b.kind}`);
        }
        if (overlays.time) assert.equal(time.length, 2, `${label}: preserve both date and clock`);
        assert.equal(logo.length > 0, keys.slice(0, -1).some(key => overlays[key]), `${label}: mandatory branding`);
      }
    }
  }
});

test('export arrows and wheel remain readable even with every overlay at narrow widths', () => {
  for (const width of [720, 1080, 1280, 1920]) {
    const draws = hudDrawing(width, { wheel: hudAsset('wheel', 256, 256), wordmark: hudAsset('logo', 880, 127) }, {}, { speedMph: 123 });
    const wheel = draws.find(d => d.kind === 'wheel');
    assert.ok(wheel.w >= 56, `${width}px: wheel must remain larger than the previous 48px artwork`);
    const arrows = draws.filter(d => d.kind === 'arrow');
    assert.equal(arrows.length, 2);
    assert.ok(arrows.every(d => d.w >= 36), `${width}px: arrows must remain larger than the previous 30px artwork`);
  }
});


test('unusually wide branding remains bounded and zero-height images use the text fallback', () => {
  const draws = hudDrawing(720, { wheel: hudAsset('wheel', 256, 256), wordmark: hudAsset('logo', 10000, 20) }, {});
  const logo = draws.find(d => d.kind === 'logo');
  const clock = draws.find(d => /:/.test(d.text || ''));
  assert.ok(logo.w <= 184);
  assert.ok(logo.x + logo.w + 6 <= clock.x);
  const fallback = hudDrawing(720, { wordmark: hudAsset('logo', 880, 0), eye: null }, {});
  assert.ok(fallback.some(d => d.text === 'BIMMER'));
  assert.ok(fallback.some(d => d.text === 'VISION'));
  assert.ok(!fallback.some(d => d.kind === 'logo'));
});
