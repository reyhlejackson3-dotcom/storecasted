import { redirect } from "next/navigation";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import WelcomeForm from "./WelcomeForm";

export const dynamic = "force-dynamic";

export default async function Welcome() {
  if (!supabaseConfigured()) redirect("/login");
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="auth-wrap" style={{ maxWidth: 640 }}>
      <p className="dateline">One minute, then you&apos;re in</p>
      <h1 className="hero" style={{ maxWidth: "14ch" }}>Tell us about your shop.</h1>
      <p className="sub" style={{ marginBottom: 30 }}>
        Helps your briefing sound like it knows your business. Everything&apos;s optional.
      </p>
      <WelcomeForm />
    </div>
  );
}
