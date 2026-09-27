"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Reached from the reset email, already signed in by /auth/callback. */
export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (password.length < 8) return setError("Your password needs at least 8 characters.");
    setBusy(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(/session/i.test(error.message)
      ? "That reset link has expired. Request a new one from the sign-in page."
      : error.message);
    await supabase.auth.signOut();
    router.push("/login?reset=1");
  }

  return (
    <div className="auth-wrap">
      <h1 className="hero" style={{ maxWidth: "12ch" }}>Pick a new password.</h1>
      <div className="auth-form">
        <label htmlFor="password" className="auth-label">New password</label>
        <div className="pw-wrap">
          <input id="password" type={show ? "text" : "password"} autoComplete="new-password"
            placeholder="At least 8 characters" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="auth-input" />
          <button type="button" className="pw-show" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
        </div>
        <button onClick={save} disabled={busy} className="btn" style={{ marginTop: 6 }}>{busy ? "Saving…" : "Save new password"}</button>
        {error && <p className="auth-err">{error}</p>}
      </div>
    </div>
  );
}
