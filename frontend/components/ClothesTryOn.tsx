"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  createJob,
  fetchResultBlob,
  pollJob,
  type Category,
  type Health,
  type Job,
} from "@/lib/api";
import { MAX_UPLOAD_MB_DEFAULT } from "@/lib/config";
import { useAuth } from "./AuthProvider";
import { UploadBox } from "./UploadBox";

type Phase = "idle" | "uploading" | "waiting" | "done" | "failed";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "upper_body", label: "Upper body — shirt, T-shirt, jacket" },
  { value: "lower_body", label: "Lower body — trousers, jeans, skirt" },
  { value: "dresses", label: "Dress — full-length / one-piece" },
];

interface Props {
  health: Health | null;
  healthError: string | null;
  onRetryHealth: () => void;
}

export function ClothesTryOn({ health, healthError, onRetryHealth }: Props) {
  const { token, email, enabled: authEnabled } = useAuth();
  const [person, setPerson] = useState<File | null>(null);
  const [garment, setGarment] = useState<File | null>(null);
  const [category, setCategory] = useState<Category>("upper_body");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [save, setSave] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const maxMb = health?.max_upload_mb ?? MAX_UPLOAD_MB_DEFAULT;
  const busy = phase === "uploading" || phase === "waiting";
  const configured = Boolean(health?.tryon_configured);
  const needsLogin = Boolean(health?.require_auth && !email);
  const canSave = Boolean(health?.history_enabled && email);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  const blocker = !health
    ? null
    : !configured
      ? "The AI try-on provider is not configured on the server yet, so clothing results cannot be generated. (Admin: set TRYON_PROVIDER and credentials in backend/.env.)"
      : needsLogin
        ? "Please sign in to use AI try-on."
        : null;

  const missing = !person ? "Add your photo." : !garment ? "Add a clothing photo." : !consent ? "Tick the consent box to continue." : null;

  async function run() {
    if (!person || !garment || !consent || busy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setJob(null);
    setResultUrl("");
    setPhase("uploading");
    try {
      const created = await createJob(
        { person, garment, category, consent, garmentDescription: description, saveToHistory: canSave && save },
        token,
        ctrl.signal,
      );
      setPhase("waiting");
      const finished = await pollJob(created, { token, signal: ctrl.signal, onUpdate: setJob });
      if (finished.status === "failed") {
        setError({ message: finished.error || "The try-on failed.", retryable: finished.retryable });
        setPhase("failed");
        return;
      }
      const blob = await fetchResultBlob(finished, token, ctrl.signal);
      setResultUrl(URL.createObjectURL(blob));
      setPhase("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const retryable = !(e instanceof ApiError) || [0, 429, 502, 503, 504].includes(e.status);
      setError({ message: e instanceof Error ? e.message : "Something went wrong.", retryable });
      setPhase("failed");
    }
  }

  function stopWaiting() {
    abortRef.current?.abort();
    setPhase("idle");
    setJob(null);
  }

  return (
    <section className="panel" aria-labelledby="clothes-title">
      <h2 id="clothes-title">AI Clothes Try-On</h2>
      <p className="muted">
        Upload a clear, front-facing photo of yourself (ideally 3:4 portrait, arms visible) and a product image of the
        garment. Results are AI-generated previews and may not match exact fit or colour.
      </p>

      {healthError && (
        <div className="banner warn" role="alert">
          {healthError.includes("not connected") ? healthError : <>Can&apos;t reach the StyleMirror server: {healthError}</>}{" "}
          {!healthError.includes("not connected") && (
            <button className="link" onClick={onRetryHealth}>
              Retry
            </button>
          )}
        </div>
      )}
      {blocker && (
        <div className="banner warn" role="status">
          {blocker} {needsLogin && <Link href="/login">Sign in</Link>}
        </div>
      )}

      <div className="grid2" style={{ marginTop: 18 }}>
        <UploadBox label="Your photo" hint="Upload your full-body photo" file={person} onChange={setPerson} maxMb={maxMb} disabled={busy} />
        <UploadBox label="Clothing photo" hint="Upload the garment image" file={garment} onChange={setGarment} maxMb={maxMb} disabled={busy} />
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="field">
          <label htmlFor="category">Clothing category</label>
          <select id="category" value={category} disabled={busy} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="desc">Garment description (optional)</label>
          <input
            id="desc"
            type="text"
            maxLength={200}
            placeholder="e.g. white linen short-sleeve shirt"
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <label className="check" style={{ marginTop: 16 }}>
        <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I am 18+ (or have a guardian&apos;s permission), this photo is of me or I have the person&apos;s permission, and I
          consent to sending both images to <b>{health?.provider_display_name || "the third-party AI provider"}</b> for
          processing. Photos are not stored by StyleMirror unless I choose to save the result.{" "}
          <Link href="/privacy">Privacy policy</Link>
        </span>
      </label>

      {canSave ? (
        <label className="check">
          <input type="checkbox" checked={save} disabled={busy} onChange={(e) => setSave(e.target.checked)} />
          <span>
            Save the result to my private history
            {health && health.history_retention_days > 0 ? ` (auto-deleted after ${health.history_retention_days} days)` : ""}.
          </span>
        </label>
      ) : (
        health?.history_enabled &&
        authEnabled && (
          <p className="muted">
            <Link href="/login">Sign in</Link> to save results to a private history.
          </p>
        )
      )}

      <div className="actions">
        <button className="primary" disabled={busy || Boolean(blocker) || !health || Boolean(missing)} onClick={run}>
          {phase === "uploading" ? "Uploading…" : phase === "waiting" ? "AI processing…" : "Generate Virtual Try-On"}
        </button>
        {phase === "waiting" && (
          <button className="secondary" onClick={stopWaiting}>
            Stop waiting
          </button>
        )}
        {!busy && !blocker && health && missing && <span className="muted">{missing}</span>}
      </div>

      {busy && (
        <div className="progressBox" role="status" aria-live="polite">
          <div className="progress" aria-label="Try-on progress">
            <div
              className={`bar ${job?.progress == null ? "indeterminate" : ""}`}
              style={job?.progress != null ? { width: `${job.progress}%` } : undefined}
            />
          </div>
          <span>
            {phase === "uploading"
              ? "Uploading images securely…"
              : `${job?.status === "queued" ? "Queued" : "Processing"} — ${job?.message ?? "starting"}${
                  job?.progress != null ? ` (${job.progress}%)` : ""
                }`}
          </span>
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error.message}
          {error.retryable && (
            <button className="secondary small" onClick={run}>
              Retry
            </button>
          )}
        </div>
      )}

      {phase === "done" && resultUrl && (
        <div style={{ marginTop: 22 }}>
          <h2>Your Try-On Result</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="result" src={resultUrl} alt="AI-generated try-on result" />
          {job?.history_error && <p className="error">{job.history_error}</p>}
          {job?.history_id && (
            <p className="status">
              Saved to your <Link href="/history">private history</Link>.
            </p>
          )}
          <div className="actions">
            <a className="secondary" href={resultUrl} download="stylemirror-result.jpg">
              Download result
            </a>
            <button className="secondary" onClick={run}>
              Generate again
            </button>
          </div>
          <p className="muted">AI-generated preview — not a guarantee of real-world fit.</p>
        </div>
      )}
    </section>
  );
}
