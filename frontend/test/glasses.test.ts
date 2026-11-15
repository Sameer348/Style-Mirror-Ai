import { describe, expect, it, vi } from "vitest";
import { computeGlassesPose, DEFAULT_FIT, drawGlasses, FRAME_STYLES, LM, styleById, type Landmark } from "@/lib/glasses";

function face(opts: { tilt?: number } = {}): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const dy = opts.tilt ?? 0;
  pts[LM.rightEyeOuter] = { x: 0.35, y: 0.4 - dy };
  pts[LM.rightEyeInner] = { x: 0.45, y: 0.4 - dy / 2 };
  pts[LM.leftEyeInner] = { x: 0.55, y: 0.4 + dy / 2 };
  pts[LM.leftEyeOuter] = { x: 0.65, y: 0.4 + dy };
  pts[LM.noseBridge] = { x: 0.5, y: 0.42 };
  pts[LM.rightFaceEdge] = { x: 0.25, y: 0.45 };
  pts[LM.leftFaceEdge] = { x: 0.75, y: 0.45 };
  return pts;
}

describe("computeGlassesPose", () => {
  const style = FRAME_STYLES[0];

  it("centres glasses between the eyes and sizes them to the face", () => {
    const pose = computeGlassesPose(face(), 1000, 1000, DEFAULT_FIT, style)!;
    expect(pose.center.x).toBeCloseTo(500, 0);
    expect(pose.center.y).toBeGreaterThan(400);
    expect(pose.center.y).toBeLessThan(410);
    expect(pose.angle).toBeCloseTo(0, 5);
    expect(pose.frameWidth).toBeCloseTo(500 * 0.96, 1);
    expect(pose.lensHeight).toBeCloseTo(pose.lensWidth * style.lensAspect);
  });

  it("follows head roll and user rotation", () => {
    const tilted = computeGlassesPose(face({ tilt: 0.05 }), 1000, 1000, DEFAULT_FIT, style)!;
    expect(tilted.angle).toBeGreaterThan(0.1);
    const adjusted = computeGlassesPose(face(), 1000, 1000, { ...DEFAULT_FIT, rotation: 10 }, style)!;
    expect(adjusted.angle).toBeCloseTo((10 * Math.PI) / 180, 5);
  });

  it("applies scale and vertical offset", () => {
    const base = computeGlassesPose(face(), 1000, 1000, DEFAULT_FIT, style)!;
    const big = computeGlassesPose(face(), 1000, 1000, { ...DEFAULT_FIT, scale: 1.2, offsetY: 1 }, style)!;
    expect(big.frameWidth).toBeCloseTo(base.frameWidth * 1.2, 5);
    expect(big.center.y).toBeGreaterThan(base.center.y);
  });

  it("returns null for missing landmarks", () => {
    expect(computeGlassesPose([], 100, 100, DEFAULT_FIT, style)).toBeNull();
  });
});

describe("drawGlasses", () => {
  it("draws every frame style without throwing", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, prop: string) => (prop in target ? target[prop] : (...args: unknown[]) => calls.push(prop) && args),
      set: (target, prop: string, v) => ((target[prop] = v), true),
    });
    for (const style of FRAME_STYLES) {
      const pose = computeGlassesPose(face(), 800, 800, DEFAULT_FIT, style)!;
      drawGlasses(ctx as never, pose, style, DEFAULT_FIT);
    }
    expect(calls.filter((c) => c === "stroke").length).toBeGreaterThanOrEqual(FRAME_STYLES.length * 5);
    expect(calls).toContain("fill");
  });

  it("styleById falls back to the first style", () => {
    expect(styleById("nope").id).toBe("rectangle");
    expect(styleById("aviator").name).toBe("Aviator");
    expect(vi.isMockFunction(URL.createObjectURL)).toBe(true);
  });
});
