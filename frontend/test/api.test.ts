import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, pollJob, type Job } from "@/lib/api";

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  status: "queued",
  progress: null,
  message: "",
  error: null,
  error_code: null,
  retryable: false,
  category: "upper_body",
  created_at: "",
  result_url: null,
  history_id: null,
  history_error: null,
  ...over,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("adds the bearer token and parses error bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ detail: "Slow down", code: "rate_limited" }, 429, { "retry-after": "30" }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await apiFetch("/api/x", { token: "t0k" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Slow down", status: 429, code: "rate_limited", retryAfter: 30 });
    expect((fetchMock.mock.calls[0][1].headers as Headers).get("Authorization")).toBe("Bearer t0k");
  });

  it("maps network failures to a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});

describe("pollJob", () => {
  it("polls until the job finishes and reports progress", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(job({ status: "processing", progress: 40 })))
      .mockResolvedValueOnce(json(job({ status: "succeeded", progress: 100, result_url: "/r" })));
    vi.stubGlobal("fetch", fetchMock);
    const updates: (number | null)[] = [];
    const done = await pollJob(job(), { intervalMs: 1, onUpdate: (j) => updates.push(j.progress) });
    expect(done.status).toBe("succeeded");
    expect(updates).toEqual([null, 40, 100]);
  });

  it("returns failed jobs without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(job({ status: "failed", error: "bad pose" }))));
    const done = await pollJob(job(), { intervalMs: 1 });
    expect(done.error).toBe("bad pose");
  });

  it("can be aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(job({ status: "processing" }))));
    const ctrl = new AbortController();
    const p = pollJob(job(), { intervalMs: 50, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(job({ status: "processing" }))));
    await expect(pollJob(job(), { intervalMs: 5, timeoutMs: 20 })).rejects.toMatchObject({ code: "client_timeout" });
  });
});

describe("static build without API", () => {
  it("does not call fetch when no API URL is configured", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_STATIC_EXPORT", "1");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mod = await import("@/lib/api");
    await expect(mod.getHealth()).rejects.toMatchObject({ code: "api_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
