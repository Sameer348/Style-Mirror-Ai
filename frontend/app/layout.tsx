import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AuthProvider } from "@/components/AuthProvider";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "StyleMirror AI | Virtual Try-On Studio",
  description: "Preview clothes and glasses on yourself before you buy — AI clothing try-on, live glasses and a 3D studio.",
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
