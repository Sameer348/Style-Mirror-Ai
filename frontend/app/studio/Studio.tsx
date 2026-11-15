"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClothesTryOn } from "@/components/ClothesTryOn";
import { GlassesPhoto } from "@/components/GlassesPhoto";
import { LiveGlasses } from "@/components/LiveGlasses";
import { useHealth } from "@/lib/useHealth";

const ThreeStudio = dynamic(() => import("@/components/ThreeStudio").then((m) => m.ThreeStudio), {
  ssr: false,
  loading: () => <div className="viewer" />,
});

const TABS = [
  { id: "clothes", label: "👕 Clothes Try-On" },
  { id: "glasses", label: "🕶️ Glasses Photo" },
  { id: "live", label: "📷 Live Glasses" },
  { id: "3d", label: "🧍 3D Studio" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Studio() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "clothes";
  const { health, error, reload } = useHealth();

  return (
    <>
      <div className="dashHead">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1 className="pageTitle">Virtual fashion studio</h1>
        </div>
        <div className="statusPills" aria-label="Service status">
          <span className={`pill ${health?.tryon_configured ? "ok" : "off"}`}>
            AI try-on: {health ? (health.tryon_configured ? health.provider : "not configured") : error ? "offline" : "…"}
          </span>
          <span className="pill ok">Glasses: on-device</span>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Try-on modes">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => router.replace(`${pathname}?tab=${t.id}`, { scroll: false })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "clothes" && <ClothesTryOn health={health} healthError={error} onRetryHealth={reload} />}
        {tab === "glasses" && <GlassesPhoto />}
        {tab === "live" && <LiveGlasses />}
        {tab === "3d" && (
          <section className="panel" aria-labelledby="studio-title">
            <h2 id="studio-title">3D Fashion Studio</h2>
            <p className="muted">
              Drag to orbit, scroll/pinch to zoom, right-drag to pan. Load your own avatar and garment as GLB/GLTF —
              files stay in your browser.
            </p>
            <div style={{ marginTop: 18 }}>
              <ThreeStudio />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
