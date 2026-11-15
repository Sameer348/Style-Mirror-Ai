"use client";
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible modal used for explicit camera consent. */
export function ConsentDialog({ open, title, children, confirmLabel, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="modalBackdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="consent-title">{title}</h2>
        <div className="muted">{children}</div>
        <div className="actions">
          <button ref={confirmRef} className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="secondary" onClick={onCancel}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
