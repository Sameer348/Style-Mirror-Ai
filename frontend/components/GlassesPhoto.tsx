"use client";
import type { FaceLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { createFaceLandmarker } from "@/lib/faceLandmarker";
import { computeGlassesPose, DEFAULT_FIT, drawGlasses, styleById, type Fit, type FrameShape } from "@/lib/glasses";
import { FitControls, FramePicker } from "./GlassesControls";
import { UploadBox } from "./UploadBox";

const MAX_SELFIE_MB = 15;

export function GlassesPhoto() {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[] | null>(null);
  const [status, setStatus] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [shape, setShape] = useState<FrameShape>("rectangle");
  const [fit, setFit] = useState<Fit>(DEFAULT_FIT);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detector = useRef<Promise<FaceLandmarker> | null>(null);

  useEffect(
    () => () => {
      detector.current?.then((d) => d.close()).catch(() => {});
    },
    [],
  );

  // Load + detect whenever the selfie changes. All processing stays in the browser.
  useEffect(() => {
    setLandmarks(null);
    setImg(null);
    if (!file) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      if (cancelled) return;
      setImg(image);
      setStatus({ kind: "info", text: "Detecting face landmarks on your device…" });
      try {
        detector.current ??= createFaceLandmarker("IMAGE");
        const d = await detector.current;
        if (cancelled) return;
        const out = d.detect(image);
        const face = out.faceLandmarks?.[0];
        if (!face) {
          setStatus({ kind: "error", text: "No face found. Use a clear, front-facing photo with your eyes visible." });
          return;
        }
        setLandmarks(face);
        setStatus(null);
      } catch {
        detector.current = null;
        if (!cancelled) setStatus({ kind: "error", text: "Could not load the face model. Check your connection and retry." });
      }
    };
    image.onerror = () => !cancelled && setStatus({ kind: "error", text: "Could not read this image." });
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Redraw on style / fit changes without re-running detection.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    if (!landmarks) return;
    const style = styleById(shape);
    const pose = computeGlassesPose(landmarks, canvas.width, canvas.height, fit, style);
    if (pose) drawGlasses(ctx, pose, style, fit);
  }, [img, landmarks, shape, fit]);

  function download() {
    canvasRef.current?.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `stylemirror-glasses-${shape}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      "image/png",
    );
  }

  return (
    <section className="panel" aria-labelledby="glasses-title">
      <h2 id="glasses-title">Glasses Photo Try-On</h2>
      <p className="muted">
        Upload a front-facing selfie. Face landmarks are detected <b>on your device</b> — the photo is never uploaded.
        This is a visual preview, not an optical fitting or prescription measurement.
      </p>
      <div className="grid2" style={{ marginTop: 18 }}>
        <div>
          <UploadBox label="Your selfie" hint="Upload a selfie" file={file} onChange={setFile} maxMb={MAX_SELFIE_MB} />
          <h3>Frame style</h3>
          <FramePicker value={shape} onChange={setShape} />
          <h3>Adjust fit</h3>
          <FitControls fit={fit} onChange={setFit} />
        </div>
        <div>
          {img ? (
            <canvas ref={canvasRef} className="photoCanvas" aria-label="Selfie with virtual glasses" />
          ) : (
            <div className="upload placeholder">Your glasses preview will appear here</div>
          )}
          {status && (
            <p className={status.kind === "error" ? "error" : "status"} role={status.kind === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          )}
          {landmarks && (
            <div className="actions">
              <button className="secondary" onClick={download}>
                Download preview
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
