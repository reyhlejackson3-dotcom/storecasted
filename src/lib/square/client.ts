import { SquareClient, SquareEnvironment } from "square";
import { decryptToken, encryptToken } from "../crypto";
import { isSandbox } from "../env";

/**
 * Square, per seller. Every call this app makes is a read — the OAuth scopes
 * requested below contain no _WRITE permission at all, which is both the
 * product promise and the thing the merchant sees on the consent screen.
 */
export const SQUARE_SCOPES = [
  "ORDERS_READ",            // sales, line items, timestamps, discounts, refunds
  "ITEMS_READ",             // names, categories, prices, vendor unit cost
  "INVENTORY_READ",         // stock counts and receipt history
  "MERCHANT_PROFILE_READ",  // store name and locations
] as const;

// Sandbox application IDs are prefixed `sandbox-`, so there is no separate
// environment flag to get out of sync with the credentials.
const OAUTH_BASE = isSandbox()
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env["SQUARE_APPLICATION_ID"] ?? "",
    scope: SQUARE_SCOPES.join(" "),
    session: "false",
    state,
  });
  return `${OAUTH_BASE}/oauth2/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
}

async function tokenCall(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": "2025-01-23" },
    body: JSON.stringify({
      client_id: process.env["SQUARE_APPLICATION_ID"],
      client_secret: process.env["SQUARE_APPLICATION_SECRET"],
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Square token call failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string) {
  const t = await tokenCall({ grant_type: "authorization_code", code });
  return {
    merchantId: t.merchant_id,
    accessToken: encryptToken(t.access_token),
    refreshToken: encryptToken(t.refresh_token),
    expiresAt: t.expires_at,
  };
}

/**
 * Refresh WITHOUT passing a scopes field. Passing one narrows the new token to
 * exactly that list, which is a documented way to silently lose a permission
 * you still need. Omitting it preserves whatever the seller originally granted.
 */
export async function refreshAccessToken(encryptedRefresh: string) {
  const t = await tokenCall({
    grant_type: "refresh_token",
    refresh_token: decryptToken(encryptedRefresh),
  });
  return {
    accessToken: encryptToken(t.access_token),
    refreshToken: encryptToken(t.refresh_token),
    expiresAt: t.expires_at,
  };
}

export function clientFor(encryptedAccessToken: string): SquareClient {
  return new SquareClient({
    token: decryptToken(encryptedAccessToken),
    environment: isSandbox() ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
  });
}

/** Square tells us when a seller has revoked or narrowed a permission. */
export function isScopeError(err: unknown): boolean {
  return JSON.stringify(err ?? "").includes("INSUFFICIENT_SCOPES");
}
