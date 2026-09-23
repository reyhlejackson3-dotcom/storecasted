/**
 * Every environment variable this app reads, in one place.
 *
 * Eight are required. Everything else is derived, because a value that can be
 * worked out is a value that can be set wrong. Three in particular:
 *
 *  - Square environment: sandbox application IDs are prefixed `sandbox-`,
 *    so the app already knows which one it's talking to.
 *  - Base URL: Vercel injects the deployment host for free.
 *  - Model: a code change, not a config change.
 */

export const REQUIRED = [
  "SQUARE_APPLICATION_ID",
  "SQUARE_APPLICATION_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "SQUARE_TOKEN_ENCRYPTION_KEY",
  "CRON_SECRET",
] as const;

export type RequiredKey = (typeof REQUIRED)[number];

/** The model is pinned here, not in config. Changing it is a deploy. */
export const ANTHROPIC_MODEL = "claude-haiku-4-5";

export function isSandbox(appId = process.env["SQUARE_APPLICATION_ID"] ?? ""): boolean {
  return appId.startsWith("sandbox-");
}

export function baseUrl(e: NodeJS.ProcessEnv = process.env): string {
  if (e["APP_BASE_URL"]) return e["APP_BASE_URL"].replace(/\/$/, "");
  const host = e["VERCEL_PROJECT_PRODUCTION_URL"] ?? e["VERCEL_URL"];
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}

export const squareRedirectUrl = (): string => `${baseUrl()}/api/square/callback`;

/**
 * Returns the names of anything missing or obviously malformed.
 * Called at boot so a bad deploy fails loudly instead of at 5am in the cron.
 */
export function validateEnv(e: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];

  for (const k of REQUIRED) {
    if (!e[k] || e[k]!.trim() === "") problems.push(`${k} is missing`);
  }

  const encKey = e["SQUARE_TOKEN_ENCRYPTION_KEY"];
  if (encKey && Buffer.from(encKey, "base64").length !== 32) {
    problems.push(
      "SQUARE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes — run: openssl rand -base64 32",
    );
  }

  const service = e["SUPABASE_SERVICE_ROLE_KEY"];
  const anon = e["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (service && anon && service === anon) {
    problems.push(
      "SUPABASE_SERVICE_ROLE_KEY and the anon key are identical — you pasted the wrong one",
    );
  }

  for (const k of Object.keys(e)) {
    if (k.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE|API_KEY|ENCRYPTION/.test(k)) {
      problems.push(`${k} is exposed to the browser — drop the NEXT_PUBLIC_ prefix`);
    }
  }

  return problems;
}

export function assertEnv(e: NodeJS.ProcessEnv = process.env): void {
  const problems = validateEnv(e);
  if (problems.length > 0) {
    throw new Error(`Environment is not set up:\n  - ${problems.join("\n  - ")}`);
  }
}
