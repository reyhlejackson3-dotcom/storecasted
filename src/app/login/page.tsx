import Link from "next/link";
import { supabaseConfigured } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";
import { TRIAL_DAYS, billingEnabled } from "@/lib/billing";

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
        <LoginForm initialMode={signup ? "signup" : "signin"}
          offer={billingEnabled() ? `${TRIAL_DAYS}-day free trial · no card needed to start` : "Free while we're getting started"} />
      ) : (
        <p className="banner">Accounts aren&apos;t switched on yet — the Supabase keys still need adding in Vercel.</p>
      )}
      <p className="note" style={{ marginTop: 34 }}><Link href="/terms">Terms of Service</Link> · <Link href="/privacy">Privacy Policy</Link></p>
    </div>
  );
}
