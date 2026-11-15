import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { FACE_MODEL_URL, MEDIAPIPE_WASM_BASE } from "./config";

/**
 * Create a MediaPipe Face Landmarker. Runs fully in the browser: frames and
 * photos are never uploaded. Falls back from GPU to CPU delegate.
 */
export async function createFaceLandmarker(mode: "IMAGE" | "VIDEO"): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
    runningMode: mode,
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

export function cameraErrorMessage(e: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera needs a secure (HTTPS) connection. Open the site over https:// or on localhost.";
  }
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access in your browser's site settings and try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and try again.";
    default:
      return "Could not start the camera or face model. Check your connection and try again.";
  }
}
