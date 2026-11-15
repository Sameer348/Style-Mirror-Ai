import Link from "next/link";

const FEATURES = [
  {
    icon: "✨",
    title: "AI Clothes Try-On",
    text: "Apni photo par kapray virtually check karein — upper body, lower body and dresses.",
    href: "/studio?tab=clothes",
  },
  {
    icon: "🕶️",
    title: "Glasses Photo",
    text: "Selfie upload karein; face landmarks align five frame styles on your face — on your device.",
    href: "/studio?tab=glasses",
  },
  {
    icon: "📷",
    title: "Live Glasses",
    text: "Real-time webcam try-on with MediaPipe. Nothing is recorded or uploaded.",
    href: "/studio?tab=live",
  },
  {
    icon: "🧍",
    title: "3D Studio",
    text: "Orbit a 3D avatar and load your own GLB/GLTF avatar and garment assets.",
    href: "/studio?tab=3d",
  },
];

export default function Landing() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Your style, before you buy</div>
        <h1>
          Try it on.
          <br />
          <em>See your style.</em>
        </h1>
        <p className="sub">
          Kapray aur glasses khareedne se pehle virtually try karein. Apni photo upload karein, apna look explore karein
          aur apni personal style discover karein.
        </p>
        <div className="actions">
          <Link className="primary" href="/studio">
            Open the studio
          </Link>
          <Link className="secondary" href="/privacy">
            How we handle your photos
          </Link>
        </div>
      </section>
      <div className="grid4">
        {FEATURES.map((f) => (
          <Link key={f.title} href={f.href} className="feature">
            <span aria-hidden>{f.icon}</span>
            <b>{f.title}</b>
            <small>{f.text}</small>
          </Link>
        ))}
      </div>
      <section className="panel" style={{ marginTop: 28 }}>
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <b>Upload</b> a clear photo of yourself and a product image of the garment.
          </li>
          <li>
            <b>Consent</b> to sending both images to the configured AI provider — nothing is sent without it.
          </li>
          <li>
            <b>Preview</b> the AI-generated result, download it, or save it to your private history.
          </li>
        </ol>
        <p className="muted">
          Glasses try-on and the 3D studio run entirely in your browser. Only clothing try-on uses a server-side AI
          model.
        </p>
      </section>
    </>
  );
}
