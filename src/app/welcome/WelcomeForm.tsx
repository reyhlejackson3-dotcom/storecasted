"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHANNELS, DAYS, KINDS } from "@/lib/profile";

export default function WelcomeForm() {
  const router = useRouter();
  const [kind, setKind] = useState<string | null>(null);
  const [business, setBusiness] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [customers, setCustomers] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save(skipped: boolean) {
    setBusy(true); setError("");
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skipped ? { skipped: true } : { kind, business, days, channels, customers, notes }),
    });
    setBusy(false);
    if (!res.ok) return setError("Couldn't save that. Try again in a moment.");
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="survey">
      <fieldset>
        <legend>What kind of business is it?</legend>
        <div className="chips">
          {KINDS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>{k}</button>
          ))}
        </div>
        <input className="auth-input" placeholder="In your words — e.g. candles, ceramics and small home goods"
          value={business} onChange={(e) => setBusiness(e.target.value)} maxLength={200} />
      </fieldset>

      <fieldset>
        <legend>Which days are you open?</legend>
        <div className="chips">
          {DAYS.map((d) => (
            <button key={d} type="button" className="chip chip-day" aria-pressed={days.includes(d)} onClick={() => toggle(days, setDays, d)}>{d}</button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Where do you sell?</legend>
        <div className="chips">
          {CHANNELS.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={channels.includes(c)} onClick={() => toggle(channels, setChannels, c)}>{c}</button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Who are your customers?</legend>
        <input className="auth-input" placeholder="e.g. locals, tourists, gift shoppers, regulars"
          value={customers} onChange={(e) => setCustomers(e.target.value)} maxLength={300} />
      </fieldset>

      <fieldset>
        <legend>Anything else we should know?</legend>
        <textarea className="auth-input survey-notes" rows={4}
          placeholder="Busy seasons, things you're trying to fix, how you like to reorder — anything."
          value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </fieldset>

      <div className="survey-actions">
        <button className="btn lp-btn-big" disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : "Continue"}</button>
        <button className="link-btn" disabled={busy} onClick={() => save(true)}>Skip for now</button>
      </div>
      {error && <p className="auth-err">{error}</p>}
    </div>
  );
}
