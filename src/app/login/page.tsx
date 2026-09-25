import Link from "next/link";
import { supabaseConfigured } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function Login() {
  return (
    <div className="auth-wrap">
      <Link href="/" className="auth-back">← Back to the demo</Link>
      <p className="dateline">Free while we&apos;re getting started</p>
      <h1 className="hero" style={{ maxWidth: "12ch" }}>Sign in or sign up.</h1>
      <p className="sub" style={{ marginBottom: 28 }}>
        Same form for both. Enter your email and we&apos;ll send you a link — no password to remember.
      </p>
      {supabaseConfigured() ? (
        <LoginForm />
      ) : (
        <p className="banner">Accounts aren&apos;t switched on yet — the Supabase keys still need adding in Vercel.</p>
      )}
    </div>
  );
}
