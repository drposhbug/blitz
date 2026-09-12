// pose.js — webcam + MediaPipe PoseLandmarker wrapper. Loaded from CDN at runtime.
// Every frame yields two landmark sets (each entry {x, y, z, visibility}):
//   last      - 33 normalized image landmarks (x, y in 0..1, z relative depth), what the pip and gestures use
//   lastWorld - 33 world landmarks in metres, hip-centred: real distances, so punch speed comes out in m/s
(function (global) {
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  class PoseCam {
    constructor(video) { this.video = video; this.lmk = null; this.last = null; this.lastWorld = null; this.lastVT = -1; this.ready = false; }

    async start(onStatus) {
      const status = s => onStatus && onStatus(s);
      status('asking for webcam...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' }, audio: false });
      this.video.srcObject = stream;
      await new Promise(res => { this.video.onloadedmetadata = () => res(); });
      await this.video.play();
      status('loading pose model...');
      const vision = await import(CDN + '/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(CDN + '/wasm');
      const make = delegate => vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      try { this.lmk = await make('GPU'); } catch (e) { status('GPU unavailable, using CPU'); this.lmk = await make('CPU'); }
      this.ready = true;
      status('ready');
    }

    // Returns 33 normalized landmarks or null. Only runs the model on new video frames;
    // the matching world landmarks are in .lastWorld / .world afterwards.
    detect(nowMs) {
      if (!this.ready || this.video.readyState < 2) return this.last;
      const vt = this.video.currentTime;
      if (vt === this.lastVT) return this.last;
      this.lastVT = vt;
      try {
        const res = this.lmk.detectForVideo(this.video, nowMs);
        this.last = (res && res.landmarks && res.landmarks[0]) || null;
        this.lastWorld = (res && res.worldLandmarks && res.worldLandmarks[0]) || null; // metres, hip-centred: better depth for the arms
      } catch (e) { this.last = null; this.lastWorld = null; }
      return this.last;
    }

    // Both landmark sets of the newest frame: { lm, world } (either may be null).
    detectAll(nowMs) { const lm = this.detect(nowMs); return { lm, world: lm ? this.lastWorld : null }; }
    get world() { return this.last ? this.lastWorld : null; }

    stop() {
      const s = this.video.srcObject; if (s) s.getTracks().forEach(t => t.stop());
      this.video.srcObject = null; this.ready = false; this.last = null; this.lastWorld = null;
    }
  }
  global.PoseCam = PoseCam;
})(typeof window !== 'undefined' ? window : globalThis);
