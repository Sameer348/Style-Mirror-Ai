/**
 * Glasses geometry from MediaPipe Face Landmarker (478-point face mesh).
 * Pure functions so they can be unit-tested and shared by photo + live modes.
 */

export interface Landmark {
  x: number; // normalised 0..1
  y: number;
  z?: number;
}

export interface Fit {
  scale: number; // 0.8 – 1.25
  offsetY: number; // -1 – 1 (fraction of lens height, + = down)
  rotation: number; // degrees, added to detected roll
  tint: number; // 0 – 0.8 lens opacity
}

export const DEFAULT_FIT: Fit = { scale: 1, offsetY: 0, rotation: 0, tint: 0.22 };

export type FrameShape = "rectangle" | "round" | "aviator" | "cateye" | "wayfarer";

export interface FrameStyle {
  id: FrameShape;
  name: string;
  frame: string;
  lens: string; // rgb triplet "r,g,b"
  thickness: number; // relative to frame width
  lensAspect: number; // height / width
}

export const FRAME_STYLES: FrameStyle[] = [
  { id: "rectangle", name: "Classic Rectangle", frame: "#16141f", lens: "150,190,220", thickness: 0.018, lensAspect: 0.62 },
  { id: "round", name: "Round Wire", frame: "#b08d57", lens: "200,210,220", thickness: 0.011, lensAspect: 0.95 },
  { id: "aviator", name: "Aviator", frame: "#c9c9cf", lens: "70,90,80", thickness: 0.012, lensAspect: 0.85 },
  { id: "cateye", name: "Cat-Eye", frame: "#7a1f3d", lens: "230,170,190", thickness: 0.022, lensAspect: 0.6 },
  { id: "wayfarer", name: "Wayfarer", frame: "#0d0d10", lens: "40,40,50", thickness: 0.028, lensAspect: 0.7 },
];

// Face mesh indices
export const LM = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  leftEyeInner: 362,
  leftEyeOuter: 263,
  noseBridge: 168,
  rightFaceEdge: 234,
  leftFaceEdge: 454,
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface GlassesPose {
  center: Point;
  angle: number; // radians
  frameWidth: number;
  lensWidth: number;
  lensHeight: number;
  lensOffset: number; // distance from centre to each lens centre
  templeTargets: [Point, Point]; // where the arms go (face edges, near ears)
}

const px = (l: Landmark, w: number, h: number): Point => ({ x: l.x * w, y: l.y * h });
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function computeGlassesPose(
  landmarks: Landmark[],
  width: number,
  height: number,
  fit: Fit,
  style: FrameStyle,
): GlassesPose | null {
  const need = Object.values(LM);
  if (!landmarks || landmarks.length <= Math.max(...need)) return null;
  const p = (i: number) => px(landmarks[i], width, height);

  const eyeA = mid(p(LM.rightEyeOuter), p(LM.rightEyeInner)); // appears on image left
  const eyeB = mid(p(LM.leftEyeInner), p(LM.leftEyeOuter));
  const edgeA = p(LM.rightFaceEdge);
  const edgeB = p(LM.leftFaceEdge);
  const eyeDist = dist(eyeA, eyeB);
  if (eyeDist < 4) return null;

  const roll = Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x);
  const angle = roll + (fit.rotation * Math.PI) / 180;

  // Typical adult proportions: frame ≈ 0.96 × face width, lens centres ≈ pupils.
  const faceWidth = Math.max(dist(edgeA, edgeB), eyeDist * 1.8);
  const frameWidth = faceWidth * 0.96 * fit.scale;
  const lensOffset = frameWidth * 0.25;
  const lensWidth = frameWidth * 0.38;
  const lensHeight = lensWidth * style.lensAspect;

  // Centre between pupils, nudged slightly toward the bridge, then user offset
  // applied perpendicular to the eye line so it follows head tilt.
  const eyesMid = mid(eyeA, eyeB);
  const bridge = p(LM.noseBridge);
  const base = { x: eyesMid.x * 0.85 + bridge.x * 0.15, y: eyesMid.y * 0.85 + bridge.y * 0.15 };
  const shift = fit.offsetY * lensHeight * 0.6;
  const center = { x: base.x - Math.sin(angle) * shift, y: base.y + Math.cos(angle) * shift };

  return { center, angle, frameWidth, lensWidth, lensHeight, lensOffset, templeTargets: [edgeA, edgeB] };
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "rotate"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "quadraticCurveTo"
  | "bezierCurveTo"
  | "arcTo"
  | "ellipse"
  | "closePath"
  | "fill"
  | "stroke"
> & { lineWidth: number; strokeStyle: string | CanvasGradient | CanvasPattern; fillStyle: string | CanvasGradient | CanvasPattern; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin };

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Trace one lens outline centred at (cx, 0). side = -1 (image-left) or 1. */
function lensPath(ctx: Ctx, shape: FrameShape, cx: number, w: number, h: number, side: number) {
  const x = cx - w / 2;
  const y = -h / 2;
  ctx.beginPath();
  switch (shape) {
    case "round":
      ctx.ellipse(cx, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "aviator": {
      // flat-ish top, teardrop bottom that sags toward the nose
      const inner = cx - side * (w / 2);
      const outer = cx + side * (w / 2);
      ctx.moveTo(inner, y + h * 0.05);
      ctx.quadraticCurveTo(cx, y - h * 0.05, outer, y + h * 0.05);
      ctx.bezierCurveTo(outer + side * w * 0.05, y + h * 0.6, cx + side * w * 0.2, y + h * 1.05, cx - side * w * 0.05, y + h);
      ctx.bezierCurveTo(cx - side * w * 0.35, y + h * 0.95, inner, y + h * 0.6, inner, y + h * 0.05);
      ctx.closePath();
      break;
    }
    case "cateye": {
      const outer = cx + side * (w / 2);
      const inner = cx - side * (w / 2);
      ctx.moveTo(inner, y + h * 0.2);
      ctx.quadraticCurveTo(cx, y, outer + side * w * 0.12, y - h * 0.18); // upswept wing
      ctx.quadraticCurveTo(outer, y + h * 0.7, cx + side * w * 0.1, y + h);
      ctx.quadraticCurveTo(inner, y + h, inner, y + h * 0.2);
      ctx.closePath();
      break;
    }
    case "wayfarer": {
      // trapezoid: wider at the top
      const t = w * 0.06;
      ctx.moveTo(x - t, y);
      ctx.lineTo(x + w + t, y);
      ctx.quadraticCurveTo(x + w, y + h * 0.9, x + w * 0.8, y + h);
      ctx.lineTo(x + w * 0.2, y + h);
      ctx.quadraticCurveTo(x, y + h * 0.9, x - t, y);
      ctx.closePath();
      break;
    }
    default:
      roundedRect(ctx, x, y, w, h, h * 0.28);
  }
}

export function drawGlasses(ctx: Ctx, pose: GlassesPose, style: FrameStyle, fit: Fit) {
  const { center, angle, frameWidth, lensWidth, lensHeight, lensOffset, templeTargets } = pose;
  const lw = Math.max(1.5, frameWidth * style.thickness);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toWorld = (lx: number, ly: number): Point => ({
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  });

  // Temples (arms) first so the front frame overlaps them.
  ctx.save();
  ctx.lineWidth = lw * 0.8;
  ctx.lineCap = "round";
  ctx.strokeStyle = style.frame;
  [-1, 1].forEach((side, i) => {
    const hinge = toWorld(side * (lensOffset + lensWidth / 2), -lensHeight * 0.3);
    const target = templeTargets[i];
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  });
  ctx.restore();

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = lw;
  ctx.strokeStyle = style.frame;
  ctx.fillStyle = `rgba(${style.lens},${Math.max(0, Math.min(0.85, fit.tint))})`;
  [-1, 1].forEach((side) => {
    lensPath(ctx, style.id, side * lensOffset, lensWidth, lensHeight, side);
    ctx.fill();
    ctx.stroke();
  });

  // Bridge
  const innerEdge = lensOffset - lensWidth / 2;
  ctx.beginPath();
  ctx.moveTo(-innerEdge, -lensHeight * 0.12);
  ctx.quadraticCurveTo(0, -lensHeight * 0.32, innerEdge, -lensHeight * 0.12);
  ctx.stroke();
  if (style.id === "aviator") {
    ctx.beginPath();
    ctx.moveTo(-lensOffset, -lensHeight * 0.52);
    ctx.lineTo(lensOffset, -lensHeight * 0.52);
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
  }
  ctx.restore();
}

export function styleById(id: string): FrameStyle {
  return FRAME_STYLES.find((s) => s.id === id) ?? FRAME_STYLES[0];
}
