// Public (browser-safe) configuration only. Never put secrets in NEXT_PUBLIC_* vars.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const FACE_MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_MODEL_URL ||
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// Served from our own origin by scripts/copy-mediapipe.mjs (matches the installed package version).
export const MEDIAPIPE_WASM_BASE = "/mediapipe/wasm";

export const MAX_UPLOAD_MB_DEFAULT = 12;
export const MAX_MODEL_MB = 50;
