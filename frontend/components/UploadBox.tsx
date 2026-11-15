"use client";
import { useEffect, useId, useState } from "react";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function validateImageFile(file: File, maxMb: number): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "Please choose a JPG, PNG or WEBP image.";
  if (file.size > maxMb * 1024 * 1024) return `Image must be smaller than ${maxMb} MB.`;
  return null;
}

interface Props {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  maxMb: number;
  disabled?: boolean;
}

export function UploadBox({ label, hint, file, onChange, maxMb, disabled }: Props) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    const err = validateImageFile(f, maxMb);
    setError(err);
    onChange(err ? null : f);
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        <b>{label}</b>
      </label>
      <div
        className={`upload ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) pick(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          id={id}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} preview`} />
        ) : (
          <div>
            <div className="plus" aria-hidden>
              ＋
            </div>
            <b>{hint}</b>
            <div className="muted" id={`${id}-hint`}>
              JPG, PNG or WEBP · max {maxMb} MB · drag & drop or click
            </div>
          </div>
        )}
      </div>
      {file && !disabled && (
        <button type="button" className="link" onClick={() => onChange(null)}>
          Remove {label.toLowerCase()}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
