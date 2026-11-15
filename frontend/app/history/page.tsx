"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { deleteAllHistory, deleteHistoryItem, listHistory, type HistoryItem } from "@/lib/api";

const CATEGORY_LABEL: Record<string, string> = { upper_body: "Upper body", lower_body: "Lower body", dresses: "Dress" };

export default function HistoryPage() {
  const { enabled, loading: authLoading, token } = useAuth();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setItems(await listHistory(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!token) return;
    setDeleting(id);
    try {
      await deleteHistoryItem(token, id);
      setItems((list) => list?.filter((i) => i.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(null);
    }
  }

  async function removeAll() {
    if (!token) return;
    setDeleting("all");
    try {
      await deleteAllHistory(token);
      setItems([]);
      setConfirmAll(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(null);
    }
  }

  async function download(item: HistoryItem) {
    if (!item.image_url) return;
    try {
      const blob = await (await fetch(item.image_url)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stylemirror-${item.id}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Download failed — the link may have expired. Reload the page.");
    }
  }

  if (!enabled) {
    return (
      <section className="panel">
        <h2>History</h2>
        <p className="muted">Accounts and saved history are not configured on this deployment.</p>
      </section>
    );
  }
  if (authLoading) return <p className="muted">Loading…</p>;
  if (!token) {
    return (
      <section className="panel">
        <h2>History</h2>
        <p className="muted">
          <Link href="/login">Sign in</Link> to see try-on results you chose to save.
        </p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="history-title">
      <div className="dashHead">
        <h2 id="history-title">Your private history</h2>
        {items && items.length > 0 && (
          <div className="actions" style={{ marginTop: 0 }}>
            {confirmAll ? (
              <>
                <span className="muted">Permanently delete all {items.length} results?</span>
                <button className="danger" disabled={deleting === "all"} onClick={removeAll}>
                  {deleting === "all" ? "Deleting…" : "Yes, delete all"}
                </button>
                <button className="secondary" onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="secondary" onClick={() => setConfirmAll(true)}>
                Delete all my data
              </button>
            )}
          </div>
        )}
      </div>
      <p className="muted">Images are stored privately and shown through short-lived signed links.</p>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button className="link" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {!items && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && (
        <p className="muted">
          Nothing saved yet. Tick &ldquo;Save the result&rdquo; in the <Link href="/studio">studio</Link>.
        </p>
      )}
      <div className="historyGrid">
        {items?.map((item) => (
          <figure key={item.id} className="historyItem">
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_url} alt={`Try-on result, ${CATEGORY_LABEL[item.category] ?? item.category}`} />
            ) : (
              <div className="upload placeholder">Image unavailable</div>
            )}
            <figcaption>
              <b>{CATEGORY_LABEL[item.category] ?? item.category}</b>
              {item.garment_description && <span className="muted"> · {item.garment_description}</span>}
              <div className="muted">
                {new Date(item.created_at).toLocaleString()}
                {item.expires_at && ` · deletes ${new Date(item.expires_at).toLocaleDateString()}`}
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button className="secondary small" onClick={() => download(item)} disabled={!item.image_url}>
                  Download
                </button>
                <button className="danger small" disabled={deleting === item.id} onClick={() => remove(item.id)}>
                  {deleting === item.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
