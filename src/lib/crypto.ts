import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Square access tokens are the keys to a seller's business. They are encrypted
 * with AES-256-GCM before they touch the database, so a leaked database dump
 * is not a leaked set of merchant accounts.
 *
 * SQUARE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64: openssl rand -base64 32
 */
function key(): Buffer {
  const raw = process.env["SQUARE_TOKEN_ENCRYPTION_KEY"];
  if (!raw) throw new Error("SQUARE_TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("SQUARE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
