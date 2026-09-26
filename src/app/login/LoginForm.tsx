"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "signin" | "signup";

/** Supabase's messages, in plain English. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match. Check both and try again.";
  if (m.includes("already registered") || m.includes("already been registered")) return "There's already an account with that email — sign in instead.";
  if (m.includes("email not confirmed")) return "Confirm your email first — check your inbox for the link we sent.";
  if (m.includes("password should be") || m.includes("weak")) return "Pick a stronger password — at least 8 characters.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many tries. Wait a minute and try again.";
  return message;
}

export default function LoginForm({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmSent, setConfirmSent] = useState(false);

  const signup = mode === "signup";

  async function submit() {
    setError("");
    if (!email.includes("@")) return setError("That doesn't look like an email address.");
    if (signup && password.length < 8) return setError("Your password needs at least 8 characters.");
    if (!signup && password.length === 0) return setError("Enter your password.");

    setBusy(true);
    const supabase = supabaseBrowser();
    const { data, error } = signup
      ? await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) return setError(friendly(error.message));
    // With email confirmation switched off in Supabase, a session comes back
    // straight away. With it on, the user has to click the email link first.
    if (data.session) {
      router.push("/app");
      router.refresh();
    } else {
      setConfirmSent(true);
    }
  }

  if (confirmSent) {
    return (
      <div className="banner">
        <b>One last step.</b> We sent a confirmation link to {email}. Click it and you&apos;re in.
      </div>
    );
  }

  return (
    <>
    <p className="dateline">{signup ? "Free while we're getting started" : "Welcome back"}</p>
    <h1 className="hero" style={{ maxWidth: "12ch" }}>{signup ? "Create your account." : "Sign in."}</h1>
    <div className="auth-form">
      <div className="seg auth-toggle" role="group" aria-label="Sign in or sign up">
        <button aria-pressed={!signup} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
        <button aria-pressed={signup} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
      </div>

      <label htmlFor="email" className="auth-label">Email</label>
      <input id="email" type="email" autoComplete="email" inputMode="email" placeholder="you@yourshop.com"
        value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input" />

      <label htmlFor="password" className="auth-label">Password</label>
      <div className="pw-wrap">
        <input id="password" type={show ? "text" : "password"}
          autoComplete={signup ? "new-password" : "current-password"}
          placeholder={signup ? "At least 8 characters" : ""}
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} className="auth-input" />
        <button type="button" className="pw-show" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
      </div>

      <button onClick={submit} disabled={busy} className="btn" style={{ marginTop: 6 }}>
        {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </button>
      {error && <p className="auth-err">{error}</p>}

      {!signup && <Link href="/forgot-password" className="auth-link">Forgot your password?</Link>}
    </div>
    </>
  );
}
