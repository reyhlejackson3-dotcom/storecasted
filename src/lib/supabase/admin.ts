import { createClient } from "@supabase/supabase-js";

/**
 * Supabase with the service-role key: bypasses row-level security. Server-only,
 * and only for the jobs that write a store's synced data — never hand this to
 * anything a user can reach directly.
 */
export function supabaseAdmin() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
