import { REQUIRED, baseUrl, isSandbox, squareRedirectUrl, validateEnv } from "../src/lib/env.ts";

/**
 * Run before you deploy, and again after you paste the variables into Vercel.
 * Catches the boring mistakes that otherwise surface at 5am inside the cron.
 */
const problems = validateEnv();

console.log("\nStorecasted — environment check\n");
for (const k of REQUIRED) {
  const v = process.env[k];
  const shown = v ? v.slice(0, 6) + "…" + (v.length > 12 ? v.slice(-4) : "") : "";
  console.log(`  ${v ? "✓" : "✗"}  ${k.padEnd(30)} ${shown}`);
}

console.log("\n  derived:");
console.log(`     Square environment  ${isSandbox() ? "sandbox" : "PRODUCTION"}`);
console.log(`     base URL            ${baseUrl()}`);
console.log(`     Square redirect     ${squareRedirectUrl()}`);
console.log("     model               claude-haiku-4-5");

if (problems.length > 0) {
  console.error("\n  problems:");
  for (const p of problems) console.error(`     ✗ ${p}`);
  console.error("");
  process.exit(1);
}
console.log("\n  All good. Register that redirect URL in the Square console.\n");
