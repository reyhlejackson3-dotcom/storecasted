import { describe, expect, it } from "vitest";
import { checkAccess, fromStripeStatus } from "@/lib/billing";

const NOW = new Date("2026-09-25T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe("who gets in", () => {
  it("lets everyone in while Stripe isn't set up, so no shop gets locked out", () => {
    expect(checkAccess({ subscription_status: "canceled", trial_ends_at: null }, NOW, false).allowed).toBe(true);
  });
  it("lets comped and paying shops in", () => {
    expect(checkAccess({ subscription_status: "free", trial_ends_at: null }, NOW, true)).toMatchObject({ allowed: true, plan: "free" });
    expect(checkAccess({ subscription_status: "active", trial_ends_at: null }, NOW, true)).toMatchObject({ allowed: true, plan: "paid" });
  });
  it("counts down the trial, then closes it", () => {
    expect(checkAccess({ subscription_status: "trialing", trial_ends_at: inDays(9.2) }, NOW, true)).toMatchObject({ allowed: true, trialDaysLeft: 10 });
    expect(checkAccess({ subscription_status: "trialing", trial_ends_at: inDays(-1) }, NOW, true)).toMatchObject({ allowed: false, reason: "trial_ended" });
  });
  it("keeps a shop in when a card fails, with a warning", () => {
    expect(checkAccess({ subscription_status: "past_due", trial_ends_at: null }, NOW, true)).toMatchObject({ allowed: true, warning: "payment_failed" });
  });
  it("closes cancelled and unpaid accounts", () => {
    expect(checkAccess({ subscription_status: "canceled", trial_ends_at: null }, NOW, true)).toMatchObject({ allowed: false, reason: "cancelled" });
    expect(checkAccess({ subscription_status: "unpaid", trial_ends_at: null }, NOW, true)).toMatchObject({ allowed: false, reason: "payment_failed" });
  });
  it("gives a full trial when no end date was recorded", () => {
    expect(checkAccess({ subscription_status: "trialing", trial_ends_at: null }, NOW, true)).toMatchObject({ allowed: true, trialDaysLeft: 7 });
  });
});

describe("Stripe statuses", () => {
  it("maps the ones that need translating", () => {
    expect(fromStripeStatus("incomplete")).toBe("unpaid");
    expect(fromStripeStatus("paused")).toBe("unpaid");
    expect(fromStripeStatus("something_new")).toBe("canceled");
    expect(fromStripeStatus("active")).toBe("active");
  });
});

import { cleanProfile, profileForPrompt } from "@/lib/profile";

describe("signup survey answers", () => {
  it("trims, caps length, and keeps only known choices", () => {
    const p = cleanProfile({
      kind: "Gift shop / boutique",
      business: "  Candles and ceramics  ",
      days: ["Mon", "Sat", "Funday", 7],
      channels: ["Online", "<script>"],
      notes: "x".repeat(5000),
      subscription_status: "active",   // extra fields are dropped
    });
    expect(p.business).toBe("Candles and ceramics");
    expect(p.days).toEqual(["Mon", "Sat"]);
    expect(p.channels).toEqual(["Online"]);
    expect(p.notes.length).toBe(1000);
    expect(p).not.toHaveProperty("subscription_status");
  });
  it("rejects a made-up business type", () => {
    expect(cleanProfile({ kind: "Hacker" }).kind).toBeNull();
  });
  it("survives garbage input", () => {
    expect(cleanProfile(null)).toMatchObject({ business: "", days: [], channels: [] });
    expect(cleanProfile("hello")).toMatchObject({ business: "" });
  });
  it("gives the AI nothing when the owner skipped", () => {
    expect(profileForPrompt(cleanProfile({ skipped: true, business: "x" }))).toBe("");
  });
  it("gives the AI a short plain summary", () => {
    const text = profileForPrompt(cleanProfile({ business: "Candles", days: ["Sat", "Sun"], customers: "Tourists" }));
    expect(text).toBe("What they sell: Candles\nOpen: Sat, Sun\nCustomers: Tourists");
  });
});
