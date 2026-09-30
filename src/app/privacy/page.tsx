import Link from "next/link";
import { CONTACT_EMAIL, LEGAL_ENTITY, MAILING_ADDRESS, PRODUCT, TERMS_EFFECTIVE } from "@/lib/legal";

export const metadata = { title: "Privacy Policy — Storecasted" };

/*
 * DRAFT — have a lawyer review before charging real customers.
 * Every statement here must stay true to the code. If you add analytics,
 * text messages, a new data source or a new provider, update this page first.
 */
export default function Privacy() {
  return (
    <div className="legal">
      <Link href="/" className="auth-back">← {PRODUCT}</Link>
      <h1 className="hero">Privacy Policy</h1>
      <p className="legal-meta">Effective {TERMS_EFFECTIVE}</p>

      <p>
        This policy explains what information {LEGAL_ENTITY} collects when you use {PRODUCT}, how we use it, and the
        choices you have. The short version: we collect what we need to give you your briefing, we don&apos;t sell it,
        and you can ask us to delete it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account information:</b> your email address and password. Passwords are stored in hashed form by our authentication provider; we never see them.</li>
        <li><b>Your survey answers:</b> what you tell us about your business when you sign up.</li>
        <li><b>Square data:</b> when you connect Square, we read your business name, locations, item catalog (names, categories, prices and unit costs), inventory counts and history, and order details such as items sold, quantities, totals, times and refunds. Our access is read-only.</li>
        <li><b>Billing information:</b> handled by Stripe. We receive your subscription status and a customer reference, but never your full card number.</li>
        <li><b>Technical information:</b> basic logs such as IP address, browser type and pages requested, kept by our hosting provider to run and secure the service.</li>
        <li><b>A record of your agreement:</b> which version of our Terms you accepted, and when.</li>
      </ul>
      <p>
        {PRODUCT} is built for businesses. Depending on how you use Square, order records can include information
        about your own customers. We don&apos;t store it: from each order we keep only item quantities and totals,
        rolled up by day. We never contact your customers.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>to calculate your figures and produce your briefings, dashboards and suggestions;</li>
        <li>to run your account, process payments and provide support;</li>
        <li>to keep {PRODUCT} secure and prevent abuse;</li>
        <li>to understand who uses {PRODUCT} and improve it; and</li>
        <li>to meet legal obligations.</li>
      </ul>
      <p>We don&apos;t sell your information, and we don&apos;t use it for advertising.</p>

      <h2>How AI is used</h2>
      <p>
        Some sentences in your briefing may be written with help from an AI model provided by Anthropic. Before that
        happens, we calculate the figures ourselves, so the model receives only a small set of already-calculated facts
        (for example, an item name and how many days of stock are left) and, if you gave them, your survey answers. It
        never receives your raw sales records, your Square login, or your payment details. Our AI provider processes
        this under its commercial terms for API customers.
      </p>

      <h2>Who we share it with</h2>
      <p>We share information only with the providers that help us run {PRODUCT}, and only as they need it:</p>
      <ul>
        <li><b>Square</b> (Block, Inc.) — where your data comes from.</li>
        <li><b>Supabase</b> — database and account sign-in.</li>
        <li><b>Vercel</b> — hosting.</li>
        <li><b>Stripe</b> — payments and billing.</li>
        <li><b>Anthropic</b> — AI-assisted wording, as described above.</li>
      </ul>
      <p>
        We may also disclose information if the law requires it, to protect our rights or the safety of others, or as
        part of a merger, acquisition or sale of assets — in which case this policy continues to apply to it.
      </p>

      <h2>Cookies</h2>
      <p>
        We use only the cookies needed to keep you signed in and keep the service secure. We don&apos;t use advertising
        cookies or third-party tracking.
      </p>

      <h2>How we protect it</h2>
      <p>
        Your Square access credentials are encrypted before they&apos;re stored. Information is sent over encrypted
        connections, and our database is set up so that each account can only reach its own data. No system is
        perfectly secure, but we work to protect your information and will notify you as required by law if a breach
        affects it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is open. If you close your account or ask us to delete your data,
        we&apos;ll delete it within 30 days, except billing and transaction records we&apos;re required to keep for legal,
        tax or accounting reasons.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li><b>Disconnect Square</b> at any time from your Square account. We&apos;ll stop reading new data.</li>
        <li><b>Access, correct or delete</b> your information by emailing {CONTACT_EMAIL}.</li>
        <li><b>Cancel your subscription</b> any time from the Billing page.</li>
      </ul>
      <p>
        Depending on where you live, you may have additional rights under state privacy laws. We&apos;ll honor verified
        requests as those laws require. We don&apos;t sell or share personal information for cross-context behavioral
        advertising.
      </p>

      <h2>Age</h2>
      <p>
        {PRODUCT} is for businesses and is not directed at children. You must be 18 or older to create an account. We
        don&apos;t knowingly collect information from children under 13.
      </p>

      <h2>Where it&apos;s stored</h2>
      <p>Your information is processed and stored in the United States.</p>

      <h2>Changes</h2>
      <p>
        If we make a material change to this policy, we&apos;ll tell you by email or in the app before it takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL_ENTITY}<br />
        {MAILING_ADDRESS}<br />
        {CONTACT_EMAIL}
      </p>
    </div>
  );
}
