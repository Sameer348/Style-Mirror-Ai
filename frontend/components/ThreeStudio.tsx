"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { validateModelFile } from "@/lib/modelValidation";

const TARGET_HEIGHT = 2.6; // world units the avatar is normalised to
const FLOOR_Y = -1.2;

type Slot = "avatar" | "garment";

interface ModelInfo {
  name: string;
  meshes: number;
  triangles: number;
  skinned: boolean;
  animations: number;
}

interface SceneApi {
  setModel: (slot: Slot, gltf: GLTF | null) => void;
  resetView: () => void;
  setAutoRotate: (on: boolean) => void;
}

function buildMannequin(): THREE.Group {
  const avatar = new THREE.Group();
  avatar.name = "default-mannequin";
  const cloth = new THREE.MeshStandardMaterial({ color: 0xc7a9ff, roughness: 0.65 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8b69e, roughness: 0.8 });
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, 0);
    o.castShadow = true;
    avatar.add(o);
  };
  part(new THREE.SphereGeometry(0.42, 32, 24), skin, 0, 1.65);
  part(new THREE.CapsuleGeometry(0.48, 0.95, 8, 16), cloth, 0, 0.55);
  part(new THREE.CylinderGeometry(0.13, 0.16, 0.95, 16), skin, -0.7, 0.58);
  part(new THREE.CylinderGeometry(0.13, 0.16, 0.95, 16), skin, 0.7, 0.58);
  part(new THREE.CylinderGeometry(0.19, 0.14, 1.15, 16), cloth, -0.25, -0.55);
  part(new THREE.CylinderGeometry(0.19, 0.14, 1.15, 16), cloth, 0.25, -0.55);
  return avatar;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (!m) return;
        Object.values(m).forEach((v) => v instanceof THREE.Texture && v.dispose());
        m.dispose();
      });
    }
  });
}

function inspect(name: string, gltf: GLTF): ModelInfo {
  let meshes = 0;
  let triangles = 0;
  let skinned = false;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    const g = mesh.geometry;
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });
  return { name, meshes, triangles: Math.round(triangles), skinned, animations: gltf.animations.length };
}

export function ThreeStudio() {
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<SceneApi | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [info, setInfo] = useState<Record<Slot, ModelInfo | null>>({ avatar: null, garment: null });
  const [busy, setBusy] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setWebglError("WebGL is not available in this browser, so the 3D studio cannot be shown.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.95;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    const resetView = () => {
      // Frames the whole normalised avatar (floor at -1.2, height 2.6 + head).
      camera.position.set(0, 0.9, 7.4);
      controls.target.set(0, 0.35, 0);
      controls.update();
    };
    resetView();

    // Lighting: soft ambient + key + rim
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554477, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb69cff, 1.4);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.1, 64), new THREE.MeshStandardMaterial({ color: 0x171327 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);

    const mannequin = buildMannequin();
    scene.add(mannequin);
    const slots: Record<Slot, THREE.Object3D | null> = { avatar: null, garment: null };
    // Transform applied to the avatar; reused for the garment so assets authored
    // in the same coordinate space line up.
    let avatarTransform: { scale: number; offset: THREE.Vector3 } | null = null;

    const normalise = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
      const center = box.getCenter(new THREE.Vector3());
      const offset = new THREE.Vector3(-center.x * scale, FLOOR_Y - box.min.y * scale, -center.z * scale);
      return { scale, offset };
    };

    const setModel = (slot: Slot, gltf: GLTF | null): void => {
      const prev = slots[slot];
      if (prev) {
        scene.remove(prev);
        disposeObject(prev);
        slots[slot] = null;
      }
      if (slot === "avatar") {
        mannequin.visible = !gltf;
        avatarTransform = null;
      }
      if (!gltf) return;
      const obj = gltf.scene;
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      const t = slot === "garment" && avatarTransform ? avatarTransform : normalise(obj);
      obj.scale.setScalar(t.scale);
      obj.position.copy(t.offset);
      if (slot === "avatar") {
        avatarTransform = t;
        // Re-align an already loaded garment to the new avatar space.
        if (slots.garment) {
          slots.garment.scale.setScalar(t.scale);
          slots.garment.position.copy(t.offset);
        }
      }
      slots[slot] = obj;
      scene.add(obj);
    };

    api.current = {
      setModel,
      resetView,
      setAutoRotate: (on) => {
        controls.autoRotate = on;
      },
    };

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      Object.values(slots).forEach((o) => o && disposeObject(o));
      disposeObject(scene);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      api.current = null;
    };
  }, []);

  async function load(slot: Slot, file: File) {
    setError(null);
    const check = await validateModelFile(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(slot);
    const url = URL.createObjectURL(file);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const details = inspect(file.name, gltf);
      if (details.meshes === 0) throw new Error("The model contains no meshes.");
      api.current?.setModel(slot, gltf);
      setInfo((i) => ({ ...i, [slot]: details }));
    } catch (e) {
      setError(`Could not load ${file.name}: ${e instanceof Error ? e.message : "invalid model"}`);
    } finally {
      URL.revokeObjectURL(url);
      setBusy(null);
    }
  }

  function clear(slot: Slot) {
    api.current?.setModel(slot, null);
    setInfo((i) => ({ ...i, [slot]: null }));
  }

  if (webglError) return <div className="banner warn">{webglError}</div>;

  return (
    <>
      <div className="banner info">
        <b>Static 3D preview.</b> Models are shown as authored — garments are <u>not</u> physically simulated
        (no draping, collisions or fabric physics) and are not auto-fitted to the avatar. For alignment, export the
        avatar and garment from the same tool in the same coordinate space.
      </div>
      <div className="viewer" ref={mount} aria-label="3D viewer. Drag to orbit, scroll or pinch to zoom." />
      <div className="actions">
        {(["avatar", "garment"] as Slot[]).map((slot) => (
          <div key={slot} className="modelSlot">
            <label className={`secondary ${busy ? "disabled" : ""}`}>
              {busy === slot ? "Loading…" : `Upload ${slot} (GLB/GLTF)`}
              <input
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                hidden
                disabled={Boolean(busy)}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) load(slot, f);
                }}
              />
            </label>
            {info[slot] && (
              <button className="link" onClick={() => clear(slot)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button className="secondary" onClick={() => api.current?.resetView()}>
          Reset view
        </button>
        <label className="check inline">
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => {
              setAutoRotate(e.target.checked);
              api.current?.setAutoRotate(e.target.checked);
            }}
          />
          Auto-rotate
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="modelInfo">
        {(["avatar", "garment"] as Slot[]).map((slot) => {
          const m = info[slot];
          return (
            <p key={slot} className="muted">
              <b>{slot === "avatar" ? "Avatar" : "Garment"}:</b>{" "}
              {m
                ? `${m.name} — ${m.meshes} mesh(es), ${m.triangles.toLocaleString()} triangles${m.skinned ? ", rigged" : ""}${
                    m.animations ? `, ${m.animations} animation(s) (not played)` : ""
                  }`
                : slot === "avatar"
                  ? "Built-in mannequin"
                  : "None"}
            </p>
          );
        })}
      </div>
    </>
  );
}
