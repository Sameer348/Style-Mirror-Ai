import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AuthProvider } from "@/components/AuthProvider";
import { Nav } from "@/components/Nav";
import "./globals.css";

const description =
  "Preview clothes and glasses on yourself before you buy — AI clothing try-on, live glasses and a 3D studio.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "StyleMirror AI | Virtual Try-On Studio",
  description,
  applicationName: "StyleMirror AI",
  keywords: ["virtual try-on", "AI fashion", "glasses try-on", "3D fashion", "outfit preview"],
  openGraph: { title: "StyleMirror AI", description, type: "website", siteName: "StyleMirror AI" },
  twitter: { card: "summary_large_image", title: "StyleMirror AI", description },
};

export const viewport: Viewport = { themeColor: "#080a12", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="shell">
            <Nav />
            <main>{children}</main>
            <footer className="footer">
              StyleMirror AI · AI results are previews, not guarantees of fit · <Link href="/privacy">Privacy &amp; data</Link>
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
