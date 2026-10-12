// Browser-only face engine (face-api, lazy-loaded). Detection, landmarks, 128-float descriptors, expressions.
type FaceApi = typeof import("@vladmandic/face-api");

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
let loading: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await (faceapi.tf as unknown as { ready: () => Promise<void> }).ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

export type Pt = { x: number; y: number };
export type FaceFrame = {
  box: { x: number; y: number; width: number; height: number };
  score: number;
  yaw: number; // >0: user turned to their left (raw camera image)
  ear: number; // eye aspect ratio
  smile: number; // 0-1
  descriptor: Float32Array | null; // only computed when asked for (it is the slow part)
};

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function eyeEAR(p: Pt[]) {
  return (dist(p[1]!, p[5]!) + dist(p[2]!, p[4]!)) / (2 * dist(p[0]!, p[3]!));
}

export async function analyzeVideoFrame(
  video: HTMLVideoElement,
  opts: { descriptor?: boolean } = {},
): Promise<FaceFrame | null> {
  const faceapi = await loadFaceApi();
  // Fast path (runs every frame): detector + landmarks + expressions only.
  const r = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceExpressions();
  if (!r) return null;
  const lm = r.landmarks;
  const le = lm.getLeftEye();
  const re = lm.getRightEye();
  const nose = lm.getNose()[3]!;
  const c = (pts: Pt[]) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  });
  const lc = c(le);
  const rc = c(re);
  const eyeDist = dist(lc, rc) || 1;
  const yaw = (nose.x - (lc.x + rc.x) / 2) / eyeDist;
  const b = r.detection.box;

  // Slow path (only on request): the 128-number face fingerprint.
  let descriptor: Float32Array | null = null;
  if (opts.descriptor) {
    const full = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    descriptor = full?.descriptor ?? null;
  }
  return {
    box: { x: b.x, y: b.y, width: b.width, height: b.height },
    score: r.detection.score,
    yaw,
    ear: (eyeEAR(le) + eyeEAR(re)) / 2,
    smile: r.expressions.happy,
    descriptor,
  };
}

// Face descriptor from a still image (ID card front or selfie).
export async function descriptorFromImage(src: string): Promise<Float32Array | null> {
  const faceapi = await loadFaceApi();
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("image load failed"));
    i.src = src;
  });
  const r = await faceapi
    .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return r?.descriptor ?? null;
}

export function compareFaces(a: Float32Array, b: Float32Array) {
  let dot = 0, na = 0, nb = 0, sq = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; na += x * x; nb += y * y; sq += (x - y) ** 2;
  }
  const cosine = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  const euclidean = Math.sqrt(sq);
  // Map cosine (≈0.80 different, ≈0.95+ same) to a 0-100 similarity score.
  const similarity = Math.round(Math.max(0, Math.min(1, (cosine - 0.8) / 0.18)) * 1000) / 10;
  return { cosine, euclidean, similarity, samePerson: euclidean < 0.55 };
}
