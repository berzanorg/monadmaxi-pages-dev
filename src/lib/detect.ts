import { FilesetResolver, FaceLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Inference is ~linear in pixel count; cap input so 12MP PFPs don't stall. */
const MAX_DETECT_DIM = 1280;

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

function detectionSource(img: HTMLImageElement): { source: HTMLImageElement | HTMLCanvasElement; invScale: number } {
  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, MAX_DETECT_DIM / Math.max(w, h));
  if (scale >= 1) return { source: img, invScale: 1 };

  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { source: c, invScale: 1 / scale };
}

function loadLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks("/wasm");
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });
    })();
  }
  return landmarkerPromise;
}

export interface Pt { x: number; y: number }
export interface Eyes {
  left:  Pt;
  right: Pt;
  /** Interocular distance in image pixels — drives all laser sizing. */
  interocular: number;
}

// MediaPipe FaceMesh / FaceLandmarker indices.
// Iris center landmarks (only present when the model bundles the iris head — ours does).
const IRIS_RIGHT_CENTER = 468; // subject's right eye iris center
const IRIS_LEFT_CENTER  = 473; // subject's left  eye iris center
// Fallback: eye-corner midpoints, in case iris landmarks aren't returned.
const RIGHT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 133;
const LEFT_EYE_INNER  = 362;
const LEFT_EYE_OUTER  = 263;

function bboxArea(face: NormalizedLandmark[]): number {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of face) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return (maxX - minX) * (maxY - minY);
}

export async function detectEyes(img: HTMLImageElement): Promise<Eyes | null> {
  const lm = await loadLandmarker();
  const { source, invScale } = detectionSource(img);
  const result = lm.detect(source);
  if (!result.faceLandmarks?.length) return null;

  // Pick the biggest face (largest landmark bounding box).
  let best: NormalizedLandmark[] | null = null;
  let bestArea = 0;
  for (const face of result.faceLandmarks) {
    const area = bboxArea(face);
    if (area > bestArea) { bestArea = area; best = face; }
  }
  if (!best) return null;

  const w = source.width, h = source.height;

  const lIris = best[IRIS_LEFT_CENTER];
  const rIris = best[IRIS_RIGHT_CENTER];
  let left: Pt, right: Pt;
  if (lIris && rIris) {
    left  = { x: lIris.x * w * invScale, y: lIris.y * h * invScale };
    right = { x: rIris.x * w * invScale, y: rIris.y * h * invScale };
  } else {
    const ro = best[RIGHT_EYE_OUTER], ri = best[RIGHT_EYE_INNER];
    const li = best[LEFT_EYE_INNER],  lo = best[LEFT_EYE_OUTER];
    if (!ro || !ri || !li || !lo) return null;
    right = { x: ((ro.x + ri.x) / 2) * w * invScale, y: ((ro.y + ri.y) / 2) * h * invScale };
    left  = { x: ((li.x + lo.x) / 2) * w * invScale, y: ((li.y + lo.y) / 2) * h * invScale };
  }

  const interocular = Math.hypot(right.x - left.x, right.y - left.y);
  if (interocular < 4) return null;
  return { left, right, interocular };
}

/** Fallback when no face is detected: two horizontal eyes centered in the image. */
export function defaultEyes(img: HTMLImageElement): Eyes {
  const w = img.naturalWidth, h = img.naturalHeight;
  const cx = w / 2, cy = h / 2;
  const sep = Math.min(w, h) * 0.18;
  return {
    left:  { x: cx + sep / 2, y: cy },
    right: { x: cx - sep / 2, y: cy },
    interocular: sep,
  };
}
