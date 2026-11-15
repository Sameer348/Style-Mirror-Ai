import { MAX_MODEL_MB } from "./config";

function readBlob(blob: Blob, as: "buffer"): Promise<ArrayBuffer>;
function readBlob(blob: Blob, as: "text"): Promise<string>;
function readBlob(blob: Blob, as: "buffer" | "text"): Promise<ArrayBuffer | string> {
  if (as === "buffer" && typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (as === "text" && typeof blob.text === "function") return blob.text();
  // FileReader fallback for older browsers / test environments.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer | string);
    reader.onerror = () => reject(reader.error);
    if (as === "buffer") reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });
}

export type ModelCheck = { ok: true; kind: "glb" | "gltf" } | { ok: false; error: string };

/**
 * Validate a user-supplied 3D model before handing it to GLTFLoader.
 * - extension .glb / .gltf, size limit
 * - .glb: binary header magic "glTF" and container version 2
 * - .gltf: JSON with asset.version 2.x and only embedded (data:) buffers/images,
 *   because a single uploaded file cannot resolve external references.
 */
export async function validateModelFile(file: File, maxMb = MAX_MODEL_MB): Promise<ModelCheck> {
  const name = file.name.toLowerCase();
  const kind = name.endsWith(".glb") ? "glb" : name.endsWith(".gltf") ? "gltf" : null;
  if (!kind) return { ok: false, error: "Please choose a .glb or .gltf file." };
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > maxMb * 1024 * 1024) return { ok: false, error: `Model must be smaller than ${maxMb} MB.` };

  if (kind === "glb") {
    const header = new DataView(await readBlob(file.slice(0, 12), "buffer"));
    if (header.byteLength < 12) return { ok: false, error: "This is not a valid GLB file." };
    const magic = header.getUint32(0, true);
    const version = header.getUint32(4, true);
    if (magic !== 0x46546c67) return { ok: false, error: "This is not a valid GLB file (bad header)." };
    if (version !== 2) return { ok: false, error: `Only glTF 2.0 is supported (file is version ${version}).` };
    return { ok: true, kind };
  }

  let json: {
    asset?: { version?: string };
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  try {
    json = JSON.parse(await readBlob(file, "text"));
  } catch {
    return { ok: false, error: "This .gltf file is not valid JSON." };
  }
  if (!json.asset?.version?.startsWith("2")) return { ok: false, error: "Only glTF 2.0 is supported." };
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((r) => r.uri && !r.uri.startsWith("data:"));
  if (external) {
    return {
      ok: false,
      error: "This .gltf references external files. Export as a single .glb (or embedded .gltf) and try again.",
    };
  }
  return { ok: true, kind };
}
