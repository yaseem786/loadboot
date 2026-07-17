# Intuit Production Keys — Step-by-Step + App Assessment Answer Pack

Goal: move the LoadBoot QuickBooks integration from sandbox to PRODUCTION so real
QuickBooks companies can connect. Everything below is copy-paste ready.
Portal: developer.intuit.com → sign in (jabarali15478@gmail.com) → your app **LoadBoot**.

---

## STAGE 1 — Complete the app profile (required before assessment)

App → **Settings / App details** — fill exactly:

| Field | Value |
|---|---|
| App name | LoadBoot |
| App description | LoadBoot is a US trucking dispatch platform. Carriers deliver freight on LoadBoot; the QuickBooks integration lets each carrier push their delivered-freight invoices and business expenses into their own QuickBooks Online company, and pulls back paid status — eliminating manual bookkeeping. |
| App website | https://loadboot.com |
| EULA / Terms of service URL | https://loadboot.com/terms.html |
| Privacy policy URL | https://loadboot.com/privacy.html |
| Category | Accounting / Bookkeeping (or Transportation & Logistics if offered) |
| Country | United States (app serves US trucking) |
| Support email | hello@loadboot.com |

**Host domain** (if asked): loadboot.com (frontend) — API calls run from Supabase Edge Functions.

## STAGE 2 — Production settings

App → **Production Settings → Keys & credentials**:

1. **Redirect URI (production)** — add ONLY:
   - `https://loadboot.com/app/qbo.html`
   (localhost is not allowed in production — remove it here; keep it in Development.)
2. **Scopes**: `com.intuit.quickbooks.accounting` only. (No payments/payroll scopes.)

## STAGE 3 — App Assessment questionnaire (copy-paste answers)

Intuit's questions vary slightly by version; match by meaning. Honest, accurate answers below.

**What does your app do with QuickBooks data?**
> LoadBoot creates Invoices (for freight the carrier delivered on our platform) and Purchases (the carrier's own recorded business expenses) in the user's QuickBooks Online company, and reads Invoice balance to reflect paid status back in LoadBoot. Each user connects only their own QuickBooks company via OAuth 2.0 and can disconnect at any time.

**Which endpoints/entities do you use?**
> Invoice (create/read), Purchase (create), Customer (create/read), Item (create/read), Account (read). Scope: com.intuit.quickbooks.accounting. Minorversion 73.

**Where is your app hosted?**
> Backend runs on Supabase (managed platform on AWS infrastructure, US region): Postgres database and Deno-based edge functions over HTTPS. The web frontend is static, served by Netlify at loadboot.com.

**How do you store OAuth tokens?**
> Access and refresh tokens are stored server-side in a private Postgres schema that is not exposed to any client API. Only service-role backend functions can read them; end-user sessions cannot. The database is encrypted at rest (AES-256, managed by Supabase/AWS) and all connections use TLS 1.2+.

**How is the OAuth flow implemented?**
> Standard OAuth 2.0 authorization-code flow. The client secret never leaves the server: the token exchange and refresh happen inside a server-side function. The redirect URI is fixed to https://loadboot.com/app/qbo.html and the connecting user is identified from their authenticated session (JWT), not from client-supplied parameters.

**Do you store QuickBooks data? What and how long?**
> We store only minimal sync bookkeeping: the QuickBooks IDs of records we created (invoice/purchase ID), realm ID, and paid status — so we never create duplicates. We do not copy the user's QuickBooks ledger into LoadBoot. Data is deleted when the user disconnects or on request.

**Encryption in transit / at rest?**
> In transit: TLS 1.2+ for all traffic (user ↔ LoadBoot, LoadBoot ↔ Intuit APIs). At rest: AES-256 encryption on the managed Postgres database and storage.

**Who can access production data? Access controls?**
> Access is restricted to the founder/operator. Administrative access to the database and hosting requires authenticated dashboard logins protected by MFA. Application-level access is role-based; QuickBooks tokens are readable only by service-role backend code.

**Do you handle payment card data?**
> No. LoadBoot does not collect, process or store card data. No PCI scope.

**Logging & monitoring?**
> Backend function invocations and API errors are logged (without tokens or secrets). Failed syncs are recorded per record with an error note. Provider dashboards (Supabase/Netlify) give runtime alerts.

**Incident response?**
> If a security incident affecting QuickBooks data is confirmed, we revoke and rotate credentials/tokens immediately, disconnect affected companies, fix the vulnerability, and notify affected users (and Intuit if required) without undue delay, with a follow-up summary of cause and remediation.

**Data deletion / user offboarding?**
> Users can disconnect QuickBooks in-app (tokens deleted). Full account/data deletion is available on request to hello@loadboot.com and is honored within 30 days.

**Third parties / subprocessors?**
> Supabase (database + functions), Netlify (static hosting), Resend (transactional email). No QuickBooks data is shared with any other third party, and none is sold.

**Development/test process?**
> Changes are developed and tested against the QuickBooks sandbox environment on a staging database first, then deployed to production. Secrets are stored server-side only (never in the repository or client code).

**MFA on developer/infra accounts?**
> Yes — MFA is enabled on the Intuit developer account, hosting (Supabase/Netlify) and code repository accounts.

---

## STAGE 4 — After approval (Claude does this)

1. Owner copies **Production Client ID + Client Secret** from Keys & credentials.
2. Claude updates `app_private.qbo_config` (both DBs): new keys + `environment='production'`
   and clears sandbox connections. The edge functions automatically switch to
   `https://quickbooks.api.intuit.com`.
3. First real carrier connects their live QuickBooks from Finance → Taxes.

## Notes / gotchas

- Business registration: the assessment focuses on app security & data handling, not a
  company registry check. Fill company name as "LoadBoot" (sole proprietor). If a
  question strictly requires a registered legal entity, we pause and register first —
  but most assessments pass without it.
- Keep answers consistent with the privacy policy at loadboot.com/privacy.html.
- Assessment review typically takes a few business days; Intuit may email follow-up
  questions to jabarali15478@gmail.com — forward them to Claude for drafted replies.
