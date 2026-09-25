"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function send() {
    if (!email.includes("@")) { setState("error"); setError("That doesn't look like an email address."); return; }
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setState("error"); setError(error.message); } else setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="banner">
        <b>Check your email.</b> We sent a sign-in link to {email}. Open it in this same browser.
      </div>
    );
  }
  return (
    <div className="auth-form">
      <label htmlFor="email" className="auth-label">Email</label>
      <input id="email" type="email" autoComplete="email" inputMode="email" placeholder="you@yourshop.com"
        value={email} onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()} className="auth-input" />
      <button onClick={send} disabled={state === "sending"} className="btn">
        {state === "sending" ? "Sending…" : "Send me a link"}
      </button>
      {state === "error" && <p className="auth-err">{error}</p>}
    </div>
  );
}
