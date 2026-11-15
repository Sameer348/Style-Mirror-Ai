"use client";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";
import { cameraErrorMessage, createFaceLandmarker } from "@/lib/faceLandmarker";
import { computeGlassesPose, DEFAULT_FIT, drawGlasses, styleById, type Fit, type FrameShape } from "@/lib/glasses";
import { ConsentDialog } from "./ConsentDialog";
import { FitControls, FramePicker } from "./GlassesControls";

type State = "idle" | "starting" | "running" | "error";

export function LiveGlasses() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const landmarker = useRef<FaceLandmarker | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const settings = useRef<{ shape: FrameShape; fit: Fit }>({ shape: "rectangle", fit: DEFAULT_FIT });

  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("Camera is off.");
  const [askConsent, setAskConsent] = useState(false);
  const [faceVisible, setFaceVisible] = useState(true);
  const [shape, setShape] = useState<FrameShape>("rectangle");
  const [fit, setFit] = useState<Fit>(DEFAULT_FIT);
  settings.current = { shape, fit };

  const stop = useCallback((msg = "Camera is off.") => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    const ctx = canvas.current?.getContext("2d");
    if (ctx && canvas.current) ctx.clearRect(0, 0, canvas.current.width, canvas.current.height);
    setState((s) => (s === "error" ? s : "idle"));
    setMessage(msg);
  }, []);

  // Cleanup on unmount; stop the camera when the tab is hidden (privacy + battery).
  useEffect(() => {
    const onHide = () => document.hidden && stream.current && stop("Camera stopped because the tab was hidden.");
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stop();
      landmarker.current?.close();
      landmarker.current = null;
    };
  }, [stop]);

  async function start() {
    setAskConsent(false);
    setState("starting");
    setMessage("Starting camera and loading the face model…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("unsupported", "NotFoundError");
      const [media, detector] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        }),
        landmarker.current ? Promise.resolve(landmarker.current) : createFaceLandmarker("VIDEO"),
      ]);
      landmarker.current = detector;
      stream.current = media;
      const v = video.current;
      if (!v) throw new Error("video element missing");
      v.srcObject = media;
      await v.play();
      setState("running");
      setMessage("Live try-on is running. Video is processed on your device and never recorded or uploaded.");
      let lastTime = -1;
      const draw = () => {
        const c = canvas.current;
        const ctx = c?.getContext("2d");
        if (v && c && ctx && v.videoWidth && v.readyState >= 2) {
          if (c.width !== v.videoWidth) c.width = v.videoWidth;
          if (c.height !== v.videoHeight) c.height = v.videoHeight;
          if (v.currentTime !== lastTime) {
            lastTime = v.currentTime;
            ctx.clearRect(0, 0, c.width, c.height);
            const face = landmarker.current?.detectForVideo(v, performance.now()).faceLandmarks?.[0];
            setFaceVisible(Boolean(face));
            if (face) {
              const { shape: sh, fit: f } = settings.current;
              const style = styleById(sh);
              const pose = computeGlassesPose(face, c.width, c.height, f, style);
              if (pose) drawGlasses(ctx, pose, style, f);
            }
          }
        }
        raf.current = requestAnimationFrame(draw);
      };
      draw();
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      setState("error");
      setMessage(cameraErrorMessage(e));
    }
  }

  const running = state === "running";

  return (
    <section className="panel" aria-labelledby="live-title">
      <h2 id="live-title">Live Camera Glasses Try-On</h2>
      <p className="muted">
        Uses MediaPipe Face Landmarker in your browser. Nothing from the camera is recorded, stored or sent to our
        servers.
      </p>
      <div className="grid2" style={{ marginTop: 18, alignItems: "start" }}>
        <div>
          <div className="videoWrap">
            <video ref={video} playsInline muted aria-label="Mirrored camera preview" />
            <canvas ref={canvas} aria-hidden />
            {!running && <div className="videoOverlay">{state === "starting" ? "Starting…" : "Camera off"}</div>}
            {running && !faceVisible && <div className="videoHint">Face the camera with your eyes visible</div>}
          </div>
          <div className="actions">
            {running ? (
              <button className="primary" onClick={() => stop()}>
                Stop camera
              </button>
            ) : (
              <button className="primary" disabled={state === "starting"} onClick={() => setAskConsent(true)}>
                {state === "starting" ? "Starting…" : "Start live try-on"}
              </button>
            )}
          </div>
          <p className={state === "error" ? "error" : "status"} role={state === "error" ? "alert" : "status"}>
            {message}
          </p>
        </div>
        <div>
          <h3>Frame style</h3>
          <FramePicker value={shape} onChange={setShape} />
          <h3>Adjust fit</h3>
          <FitControls fit={fit} onChange={setFit} />
        </div>
      </div>
      <ConsentDialog
        open={askConsent}
        title="Allow camera access?"
        confirmLabel="Allow camera"
        onConfirm={start}
        onCancel={() => setAskConsent(false)}
      >
        <p>To show glasses on your face live, StyleMirror needs your camera.</p>
        <ul>
          <li>Video is processed only in this browser tab — it is not uploaded, recorded or stored.</li>
          <li>The camera stops when you press Stop, leave this tab, or close the page.</li>
          <li>Your browser will also ask for permission; you can revoke it anytime in site settings.</li>
        </ul>
      </ConsentDialog>
    </section>
  );
}
