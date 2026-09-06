# Paste this to ChatGPT / Codex (after the prod corrective round, 6 Sep ~13:05 UTC)

---

Read this before anything else — **the prod state is ahead of your handoff message.**

Your message said "no production deploy is authorized by this handoff". By the time it reached me, A and B were **already applied to production**, because Yaseen had said "lagao" (= apply it) directly to me before your message arrived. I did not treat your message as a revocation of his word, and I did not treat his word as covering what you had not yet seen. Here is exactly where things stand.

## PROD — done and verified

| | State | Evidence |
|---|---|---|
| **A** | `bl_cmp_0326_broker_precedence_fix` **APPLIED**, prod version `20260906125744` | pre-flight `anchor1_count=1, anchor2_count=1, already_applied=0, case2_will_run=true`. `tests/bl_cmp_0326_rollback_test.sql` on prod → **RESULT PASS on all three cases**: broker-only = active/no-pause/no-email; **lapsed-broker = inactive/paused/expired/emailed** (the pre-0324 behaviour, byte-for-byte — this is the leg staging physically cannot run); carrier verified-inactive = inactive/no-pause/no-email. Post-check `fix_live=true`, 0 items expired by the test, 0 emails. |
| **B** | `load-mail` **v9** deployed, prod slot 7, `ezbr_sha256 044eb611…2706e02` | live check 1 on prod: anon-key caller → HTTP **403 `{"error":"forbidden","code":"LB403"}`** (pg_net req 192731). |

Your finding A was correct and it was **my** bug in `bl_cmp_0324` — I verified the root cause independently against the fmcsa-verify source before fixing: `fromLI()` sets `carrierAuthority = common || contract` and `result.authority = carrierAuthority ? "active" : "inactive"`, so a broker-only docket comes back `authority='inactive'` with `authorityVerified=true` while operating perfectly legally. 0324 applied that precedence to every org kind. Why my own test missed it: **it only covered carriers.** The 0326 test covers broker-only, lapsed-broker and carrier.

## PROD — deliberately NOT done, waiting on Yaseen

- **C — `domain-check` v3 is still staging-only** (slot 4, verified). This is the one place your message and Yaseen's contradicted each other for an item not yet applied, so I stopped rather than guess. **Consequence: prod still carries both SSRF bypasses** — the bracket one you found (`new URL("http://[::1]/").hostname === "[::1]"`, so no IPv6 literal ever matched) and the second one I found while verifying (`::ffff:127.0.0.1` is normalised to `::ffff:7f00:1`, so the v4-mapped branch missed it too). Staging checks: real caller 200 unchanged shape, `0--1.sslip.io` and `169.254.169.254.nip.io` both `refused: resolves to private address`.
- **Live check 5** (inbound-mail → load-mail full chain) not run on prod — it ingests one real test-sender row.

## D — acknowledged, not touched

Branch `audit/s2-f31-client-verdict` @ `1259d12b` off main `7dc83e4`. I have not opened, edited or re-created `app/shared/api.js` or `app/carrier/app.js`. Not merged, not deployed. Live upload → DB → CC verification is still UNKNOWN on both sides.

## The discrepancy you flagged — still UNKNOWN, and I am not guessing

Your 07:30 UTC observation of **M Usman Farooq (Agent)** pending with an expired authority item vs my "zero impact" report. My queries after the backfill found 0 items expired, 0 authlapse emails, 0 notifications, and both brokers the 06:10 UTC dispatch reached returned `no_docket`. Those two are not reconciled. The row may pre-date the collector entirely. **Whoever picks this up: read that org's `org_onboarding_items` rows with `created_at`/`updated_at` first.** Neither of us should write "the collector did it" until that query says so.

## One thing worth carrying forward

v9's first cut **broke the real chain** — it returned LB403 to inbound-mail because I assumed the service key was a JWT. It is an opaque `sb_secret_…` string; this project mixes `sb_publishable_`/`sb_secret_` with legacy JWTs. The end-to-end chain test on staging is the only thing that caught it. v9 final accepts an exact match to `SUPABASE_SERVICE_ROLE_KEY` (length-guarded constant-time compare) **or** a decoded `role=service_role` JWT.

`HANDOFF.md` and `PHASE1-AUDIT.md` are updated on disk with all of the above, plus a new LOG line. NEXT ACTION is now: get Yaseen's yes/no on C and on check 5, then reconcile the M Usman Farooq row. SEO, F33 and WhatsApp all stay parked.
