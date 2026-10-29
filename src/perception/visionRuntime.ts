import { FilesetResolver, PoseLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';

/**
 * Loads MediaPipe Tasks (Apache-2.0) from files bundled with this app. All inference runs on
 * the device in the browser — camera frames are never uploaded.
 */
const BASE = import.meta.env.BASE_URL;
const WASM = `${BASE}mediapipe/wasm`;
export const POSE_MODEL = `${BASE}models/pose_landmarker_lite.task`;
export const OBJECT_MODEL = `${BASE}models/efficientdet_lite0.tflite`;

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
const fileset = () => (filesetPromise ??= FilesetResolver.forVisionTasks(WASM));

let poseCache: { numPoses: number; p: Promise<PoseLandmarker> } | null = null;
let objectPromise: Promise<ObjectDetector> | null = null;
export let activeDelegate: 'GPU' | 'CPU' | null = null;

/** Software-emulated WebGL (no real GPU) is far slower than the WASM CPU path, so use CPU there. */
function hasRealGpu(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch { return false; }
}

async function withDelegate<T>(make: (d: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  if (!hasRealGpu()) {
    const r = await make('CPU');
    activeDelegate = 'CPU';
    return r;
  }
  try {
    const r = await make('GPU');
    activeDelegate = 'GPU';
    return r;
  } catch {
    const r = await make('CPU');
    activeDelegate = 'CPU';
    return r;
  }
}

export function getPoseLandmarker(numPoses: number): Promise<PoseLandmarker> {
  if (poseCache && poseCache.numPoses === numPoses) return poseCache.p;
  const old = poseCache;
  const p = (async () => {
    if (old) (await old.p.catch(() => null))?.close();
    const fs = await fileset();
    return withDelegate((delegate) => PoseLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }));
  })();
  poseCache = { numPoses, p };
  p.catch(() => { if (poseCache?.p === p) poseCache = null; });
  return p;
}

export function getObjectDetector(): Promise<ObjectDetector> {
  if (objectPromise) return objectPromise;
  const p = (async () => {
    const fs = await fileset();
    return withDelegate((delegate) => ObjectDetector.createFromOptions(fs, {
      baseOptions: { modelAssetPath: OBJECT_MODEL, delegate },
      runningMode: 'VIDEO',
      scoreThreshold: 0.25,
      maxResults: 8,
      categoryAllowlist: ['sports ball', 'person'],
    }));
  })();
  objectPromise = p;
  p.catch(() => { objectPromise = null; });
  return p;
}

/** MediaPipe VIDEO mode requires strictly increasing timestamps across every call. */
let lastTs = 0;
export function nextTimestamp(): number {
  lastTs = Math.max(lastTs + 1, Math.round(performance.now()));
  return lastTs;
}
