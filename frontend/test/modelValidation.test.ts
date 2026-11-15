import { describe, expect, it } from "vitest";
import { validateModelFile } from "@/lib/modelValidation";

function glb(version = 2, magic = 0x46546c67) {
  const buf = new ArrayBuffer(20);
  const v = new DataView(buf);
  v.setUint32(0, magic, true);
  v.setUint32(4, version, true);
  v.setUint32(8, 20, true);
  return new File([buf], "avatar.glb");
}

describe("validateModelFile", () => {
  it("accepts a glTF 2 binary", async () => {
    expect(await validateModelFile(glb())).toEqual({ ok: true, kind: "glb" });
  });
  it("rejects wrong magic and version", async () => {
    expect((await validateModelFile(glb(2, 0x12345678))).ok).toBe(false);
    expect(await validateModelFile(glb(1))).toMatchObject({ ok: false, error: expect.stringMatching(/2\.0/) });
  });
  it("rejects other extensions, empty and oversized files", async () => {
    expect((await validateModelFile(new File(["x"], "model.obj"))).ok).toBe(false);
    expect((await validateModelFile(new File([], "a.glb"))).ok).toBe(false);
    expect((await validateModelFile(glb(), 0.00001)).ok).toBe(false);
  });
  it("accepts embedded .gltf and rejects external references", async () => {
    const embedded = { asset: { version: "2.0" }, buffers: [{ uri: "data:application/octet-stream;base64,AAAA" }] };
    expect((await validateModelFile(new File([JSON.stringify(embedded)], "m.gltf"))).ok).toBe(true);
    const external = { asset: { version: "2.0" }, buffers: [{ uri: "scene.bin" }] };
    expect(await validateModelFile(new File([JSON.stringify(external)], "m.gltf"))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/external/),
    });
    expect((await validateModelFile(new File(["{nope"], "m.gltf"))).ok).toBe(false);
  });
});
