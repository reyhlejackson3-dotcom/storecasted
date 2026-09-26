import Link from "next/link";
import { supabaseConfigured } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ mode?: string; e?: string; reset?: string }> }) {
  const { mode, e, reset } = await searchParams;
  const signup = mode === "signup";
  return (
    <div className="auth-wrap">
      <Link href="/" className="auth-back">← Storecasted</Link>
      {reset && <p className="banner">Password updated. Sign in with your new one.</p>}
      {e === "expired" && <p className="banner">That link expired. Please try again.</p>}
      {supabaseConfigured() ? (
        <LoginForm initialMode={signup ? "signup" : "signin"} />
      ) : (
        <p className="banner">Accounts aren&apos;t switched on yet — the Supabase keys still need adding in Vercel.</p>
      )}
    </div>
  );
}
