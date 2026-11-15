import { apiConfigured, apiUrl } from "./config";

export type Category = "upper_body" | "lower_body" | "dresses";
export type JobStatus = "queued" | "processing" | "succeeded" | "failed";

export interface Health {
  status: string;
  provider: string;
  provider_display_name: string;
  provider_note: string;
  tryon_configured: boolean;
  auth_enabled: boolean;
  history_enabled: boolean;
  require_auth: boolean;
  max_upload_mb: number;
  history_retention_days: number;
  job_result_ttl_seconds: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number | null;
  message: string;
  error: string | null;
  error_code: string | null;
  retryable: boolean;
  category: Category;
  created_at: string;
  result_url: string | null;
  history_id: string | null;
  history_error: string | null;
}

export interface HistoryItem {
  id: string;
  job_id: string | null;
  category: Category;
  provider: string;
  garment_description: string | null;
  created_at: string;
  expires_at: string | null;
  image_url: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_MESSAGE = "Could not reach the StyleMirror server. Check that the backend is running.";

async function toApiError(res: Response): Promise<ApiError> {
  let detail = `Request failed (HTTP ${res.status})`;
  let code = "http_error";
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
    if (typeof body?.code === "string") code = body.code;
  } catch {
    /* non-JSON error body */
  }
  const retry = Number(res.headers.get("retry-after"));
  return new ApiError(detail, res.status, code, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}

export async function apiFetch(path: string, init: RequestInit & { token?: string | null } = {}): Promise<Response> {
  const { token, headers, ...rest } = init;
  if (!apiConfigured()) {
    throw new ApiError(
      "AI try-on is not connected on this website yet (no backend API URL in config.js).",
      0,
      "api_not_configured",
    );
  }
  const h = new Headers(headers);
  if (token) h.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, { ...rest, headers: h });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(NETWORK_MESSAGE, 0, "network_error");
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  return (await apiFetch("/api/health", { signal })).json();
}

export interface CreateJobInput {
  person: File;
  garment: File;
  category: Category;
  consent: boolean;
  garmentDescription?: string;
  saveToHistory?: boolean;
}

export async function createJob(input: CreateJobInput, token?: string | null, signal?: AbortSignal): Promise<Job> {
  const fd = new FormData();
  fd.append("person", input.person);
  fd.append("garment", input.garment);
  fd.append("category", input.category);
  fd.append("consent", input.consent ? "true" : "false");
  fd.append("garment_description", input.garmentDescription ?? "");
  fd.append("save_to_history", input.saveToHistory ? "true" : "false");
  return (await apiFetch("/api/tryon/jobs", { method: "POST", body: fd, token, signal })).json();
}

export async function getJob(id: string, token?: string | null, signal?: AbortSignal): Promise<Job> {
  return (await apiFetch(`/api/tryon/jobs/${encodeURIComponent(id)}`, { token, signal })).json();
}

export async function fetchResultBlob(job: Job, token?: string | null, signal?: AbortSignal): Promise<Blob> {
  if (!job.result_url) throw new ApiError("Result is not ready.", 409, "result_not_ready");
  return (await apiFetch(job.result_url, { token, signal })).blob();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

export interface PollOptions {
  token?: string | null;
  signal?: AbortSignal;
  onUpdate?: (job: Job) => void;
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
}

/** Poll a job until it succeeds or fails. Backs off gently; rejects on timeout or abort. */
export async function pollJob(initial: Job, opts: PollOptions = {}): Promise<Job> {
  const { token, signal, onUpdate, intervalMs = 1500, maxIntervalMs = 5000, timeoutMs = 6 * 60_000 } = opts;
  const started = Date.now();
  let job = initial;
  let delay = intervalMs;
  let networkFailures = 0;
  onUpdate?.(job);
  while (job.status === "queued" || job.status === "processing") {
    if (Date.now() - started > timeoutMs) {
      throw new ApiError("Still processing after a long time. Please retry.", 504, "client_timeout");
    }
    await sleep(delay, signal);
    try {
      job = await getJob(job.id, token, signal);
      networkFailures = 0;
    } catch (e) {
      if (e instanceof ApiError && e.code === "network_error" && ++networkFailures < 4) continue;
      throw e;
    }
    onUpdate?.(job);
    delay = Math.min(maxIntervalMs, Math.round(delay * 1.25));
  }
  return job;
}

export async function listHistory(token: string, signal?: AbortSignal): Promise<HistoryItem[]> {
  const body = await (await apiFetch("/api/history?limit=60", { token, signal })).json();
  return body.items as HistoryItem[];
}

export async function deleteHistoryItem(token: string, id: string): Promise<void> {
  await apiFetch(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE", token });
}

export async function deleteAllHistory(token: string): Promise<number> {
  const body = await (await apiFetch("/api/history", { method: "DELETE", token })).json();
  return body.deleted as number;
}
