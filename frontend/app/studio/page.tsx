import { Suspense } from "react";
import { Studio } from "./Studio";

export const metadata = { title: "Studio | StyleMirror AI" };

export default function StudioPage() {
  return (
    <Suspense fallback={<p className="muted">Loading studio…</p>}>
      <Studio />
    </Suspense>
  );
}
