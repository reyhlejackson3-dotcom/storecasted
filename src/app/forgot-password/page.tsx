"use client";

import Link from "next/link";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setError("");
    if (!email.includes("@")) return setError("That doesn't look like an email address.");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    // Say the same thing whether or not the account exists, so this page
    // can't be used to find out who has an account.
    if (error && !/rate limit/i.test(error.message)) setError(error.message);
    else if (error) setError("Too many tries. Wait a minute and try again.");
    else setSent(true);
  }

  return (
    <div className="auth-wrap">
      <Link href="/login" className="auth-back">← Back to sign in</Link>
      <h1 className="hero" style={{ maxWidth: "12ch" }}>Reset your password.</h1>
      {sent ? (
        <p className="banner"><b>Check your email.</b> If there&apos;s an account for {email}, we&apos;ve sent a link to set a new password.</p>
      ) : (
        <div className="auth-form">
          <p className="sub" style={{ marginBottom: 12 }}>Enter the email you signed up with and we&apos;ll send you a link.</p>
          <label htmlFor="email" className="auth-label">Email</label>
          <input id="email" type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} className="auth-input" />
          <button onClick={send} disabled={busy} className="btn" style={{ marginTop: 6 }}>{busy ? "Sending…" : "Send reset link"}</button>
          {error && <p className="auth-err">{error}</p>}
        </div>
      )}
    </div>
  );
}
