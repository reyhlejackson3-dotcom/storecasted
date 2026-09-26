import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** True once the two public Supabase values are set. Lets the site run without them. */
export const supabaseConfigured = () =>
  Boolean(process.env["NEXT_PUBLIC_SUPABASE_URL"] && process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

/**
 * Server-side Supabase, acting as the signed-in user. Row-level security
 * applies, so a user can only ever read and write their own store.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session instead, so this is safe.
          }
        },
      },
    },
  );
}
