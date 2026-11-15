"use client";
import { DEFAULT_FIT, FRAME_STYLES, type Fit, type FrameShape } from "@/lib/glasses";

export function FramePicker({ value, onChange }: { value: FrameShape; onChange: (v: FrameShape) => void }) {
  return (
    <div className="framePicker" role="radiogroup" aria-label="Frame style">
      {FRAME_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          className={`chip ${value === s.id ? "active" : ""}`}
          onClick={() => onChange(s.id)}
        >
          <span className="swatch" style={{ background: s.frame }} aria-hidden />
          {s.name}
        </button>
      ))}
    </div>
  );
}

const SLIDERS: { key: keyof Fit; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: "scale", label: "Size", min: 0.8, max: 1.25, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "offsetY", label: "Height", min: -1, max: 1, step: 0.02, fmt: (v) => (v === 0 ? "0" : v > 0 ? `↓${v.toFixed(2)}` : `↑${(-v).toFixed(2)}`) },
  { key: "rotation", label: "Tilt", min: -15, max: 15, step: 0.5, fmt: (v) => `${v}°` },
  { key: "tint", label: "Lens tint", min: 0, max: 0.8, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
];

export function FitControls({ fit, onChange }: { fit: Fit; onChange: (f: Fit) => void }) {
  return (
    <div className="fitControls">
      {SLIDERS.map((s) => (
        <label key={s.key} className="slider">
          <span>
            {s.label} <em>{s.fmt(fit[s.key])}</em>
          </span>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={fit[s.key]}
            onChange={(e) => onChange({ ...fit, [s.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <button type="button" className="link" onClick={() => onChange(DEFAULT_FIT)}>
        Reset fit
      </button>
    </div>
  );
}
