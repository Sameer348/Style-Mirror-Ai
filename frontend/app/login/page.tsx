"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getSupabase } from "@/lib/supabase";

type Mode = "signin" | "signup" | "magic";

export default function LoginPage() {
  const supabase = getSupabase();
  const { email: signedInAs } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (signedInAs) router.replace("/studio");
  }, [signedInAs, router]);

  if (!supabase) {
    return (
      <section className="panel narrow">
        <h2>Sign in</h2>
        <p className="muted">
          Accounts are not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to enable them. You can still use the <Link href="/studio">studio</Link>.
        </p>
      </section>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    const redirect = `${window.location.origin}/studio`;
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Check your inbox for a sign-in link." });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setMsg({
          kind: "ok",
          text: data.session ? "Account created." : "Account created — confirm your email to finish signing up.",
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Sign-in failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel narrow" aria-labelledby="login-title">
      <h2 id="login-title">{mode === "signup" ? "Create an account" : "Sign in"}</h2>
      <p className="muted">An account lets you save try-on results to a private history and delete them anytime.</p>
      <div className="tabs" role="tablist">
        {(
          [
            ["signin", "Password"],
            ["magic", "Email link"],
            ["signup", "Sign up"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`tab ${mode === m ? "active" : ""}`}
            onClick={() => {
              setMode(m);
              setMsg(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="form">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== "magic" && (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : mode === "magic" ? "Send link" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </div>
        {msg && (
          <p className={msg.kind === "error" ? "error" : "status"} role={msg.kind === "error" ? "alert" : "status"}>
            {msg.text}
          </p>
        )}
      </form>
    </section>
  );
}
