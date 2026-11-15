// Public (browser-safe) configuration only. Never put secrets in NEXT_PUBLIC_* vars.
// On static hosting, /config.js (public/config.js) can set window.STYLEMIRROR_CONFIG
// so the API / Supabase settings can be changed without rebuilding.
interface RuntimeConfig {
  apiUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

function runtime(): RuntimeConfig {
  if (typeof window === "undefined") return {};
  return (window as unknown as { STYLEMIRROR_CONFIG?: RuntimeConfig }).STYLEMIRROR_CONFIG ?? {};
}

// Static builds have no backend on the same host, so never fall back to localhost there.
const STATIC_BUILD = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
export const apiUrl = () =>
  (runtime().apiUrl || process.env.NEXT_PUBLIC_API_URL || (STATIC_BUILD ? "" : "http://localhost:8000")).replace(
    /\/$/,
    "",
  );
export const apiConfigured = () => apiUrl() !== "";
export const supabaseUrl = () => runtime().supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const supabaseAnonKey = () => runtime().supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const FACE_MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_MODEL_URL ||
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// Served from our own origin by scripts/copy-mediapipe.mjs (matches the installed package version).
export const MEDIAPIPE_WASM_BASE = "/mediapipe/wasm";

export const MAX_UPLOAD_MB_DEFAULT = 12;
export const MAX_MODEL_MB = 50;
