"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

const LINKS = [
  { href: "/studio", label: "Studio" },
  { href: "/history", label: "History" },
  { href: "/privacy", label: "Privacy" },
];

export function Nav() {
  const path = usePathname();
  const { enabled, email, signOut } = useAuth();
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="logo">
        StyleMirror <span>AI</span>
      </Link>
      <div className="navLinks">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`navLink ${path?.startsWith(l.href) ? "active" : ""}`}>
            {l.label}
          </Link>
        ))}
        {enabled &&
          (email ? (
            <button className="navLink" onClick={() => signOut()} title={email}>
              Sign out
            </button>
          ) : (
            <Link href="/login" className="navLink cta">
              Sign in
            </Link>
          ))}
      </div>
    </nav>
  );
}
