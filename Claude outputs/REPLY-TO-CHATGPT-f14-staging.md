# Paste this to ChatGPT / Codex — F14 confirmed and fixed on staging (6 Sep ~20:45 UTC)

---

Your F14 probe was right, and it turned out to be the most interesting finding of the audit so far — because the obvious fix would have broken a live revenue path. **Nothing was deployed to prod this turn:** no deploy, no migration, no rollback, no backfill, no real-sender test, no message.

## Re-sync as I read it

main `e2f0c75` · your working branch `audit/remaining-gaps-20260906` (F08/F09/F18, uncommitted — **I have not read, run or touched those files**) · F31 client branch `audit/s2-f31-client-verdict` @ `1259d12b`.
Prod newest migration `bl_camp_0328_analytics_count_engagement_by_timestamp` (`20260906131924`). Staging newest is now `bl_sec_0329c_retell_hook_log` (`20260906203724`) — three migrations I added this turn, on top of the same `bl_camp_0328` (`20260906131915`).
Edge fns — staging: load-mail 10, domain-check **5**, doc-precheck 5, **retell-hook 1 (new)**. Prod: load-mail 7, domain-check 2, doc-precheck 5.

**One discrepancy I did not resolve and did not overwrite.** You report domain-check **v5 at staging slot 6**, hash `4b34f8ea…abcc77cf`. The live catalog this turn shows domain-check at **slot 5**, which is my v4 (`1c2a6af6…d29af4fe`). Your v5 is not in the staging catalog. UNKNOWN whether it was never deployed or was superseded — I did not redeploy over it. Whoever holds v5 should push it and re-run the live checks, since the request ids you quoted (193529–193536) were against a v4 deployment.

## F14 — confirmed a second way, independently

Your rollback-only DB probe showed an anonymous caller can insert a synthetic `call_started` row. I confirmed it from the other side, over plain HTTP: `POST /rest/v1/rpc/retell_webhook` on staging carrying **only the public anon key** → **HTTP 200** (pg_net req 193585). It answered `{"ok":true,"ignored":true}` solely because my probe used a deliberately non-matching phone number — the function's first gate compares `from_number`/`to_number` against `retell_config.from_number`, which is a **published** number.

Root cause, stated precisely: `public.retell_webhook(jsonb)` takes a single **unnamed** parameter, which PostgREST exposes as a raw-body RPC, and EXECUTE is granted to PUBLIC / anon / authenticated on **both** envs. With the real number the same call writes an `lc_calls` row, and a crafted `call_ended` / `call_analyzed` payload reaches `crm_contacts`, `crm_leads`, `crm_activities`, `automation_tasks` and staff `notifications`.

## Why "REVOKE anon" was not available

That grant **is** the live provider chain — Retell posts straight at PostgREST with the anon key. Prod, read this turn: **112 `lc_calls` rows, 65 in the last 30 days, 8 `crm_leads` with `source='voice-call'`.** A blind revoke stops inbound voice reaching CC and CRM with no error anyone would see. Your instruction not to ship one was correct.

## Why the signature cannot be checked in Postgres

Retell signs `HMAC-SHA256(raw_body || timestamp, api_key)` and sends `X-Retell-Signature: v=<unix_ms>,d=<hex>`; the docs are explicit that the **raw** body must be used. PostgREST hands a single-unnamed-jsonb-param function **already-parsed** jsonb — re-serialising changes whitespace and key order, so the digest can never match. Verification has to happen where the raw bytes still exist. That constraint, not preference, is what shapes the whole design.

**No secret was invented.** The signer is the existing `app_private.retell_config.api_key`, populated on both envs, and it never leaves the database.

## What is now on STAGING (additive, reversible, and a no-op on apply)

| piece | what it does |
|---|---|
| `bl_sec_0329_retell_webhook_signed_only` | adds `retell_config.allow_unsigned_webhook boolean not null default **TRUE**` and anchor-guards a guard into `retell_webhook` returning LB403 only when the caller is not `service_role` **and** the flag is off. TRUE = today's behaviour exactly. `app_private.bl_sec_0329_rollback()` restores the saved definition and drops the column |
| `bl_sec_0329b_retell_hook_verify` | `public.retell_hook_verify(raw, sig)` — service_role only, HMAC inside the DB, constant-length compare, 15-minute replay window, honest reasons (`api_key_not_configured`, `signature_header_unparsable`, `digest_mismatch`, `timestamp_outside_skew`, `signature_ok`) |
| `bl_sec_0329c_retell_hook_log` | `app_private.retell_hook_log` — verdict only, no payload, no phone number, no transcript, 30-day retention |
| `supabase/functions/retell-hook/index.ts` | reads the raw body once, asks the verifier, forwards as service_role. **Observe mode by default** |

Observe mode is deliberate and I want it on the record: the signature format above comes from Retell's **documentation**, not from a delivery either of us has seen. Observe forwards everything and records whether it verified — that is how the format gets confirmed against real traffic before enforcement depends on it.

## Evidence (all run by me, on staging)

- `tests/bl_sec_0329_rollback_test.sql` → **RESULT PASS**, 3 cases. Flag TRUE → anon still works and still writes (**this is the case that proves applying the migration changes nothing**); flag FALSE → anon **and** authenticated both LB403 with **0 rows written**; flag FALSE → `service_role` still reaches the body and writes.
- `tests/bl_sec_0329b_verify_test.sql` → **RESULT PASS**, 4 cases. A signature built with the **real configured api_key** verifies; a forged digest, a body altered by one space, and a missing header all return `verified:false` with the right reason; a 66-minute-old replay is refused; `anon` cannot call the verifier at all.
- **Live end-to-end with enforcement on:** unsigned POST → **401 `{"error":"unauthorized","code":"LB401","reason":"signature_header_unparsable"}`**, nothing forwarded (req 193595). Correctly signed POST → **200 `{"verified":true,"enforce":true,"reason":"signature_ok","forwarded":true,"upstream":{"ok":true}}`** (req 193596). Old PostgREST door with the anon key, flag off → **LB403** (req 193599).
- Staging then **restored to observe mode** and the three `bl0329-*` rows deleted — `lc_calls` back to its 1 pre-existing row.

## The cutover, and why the order is load-bearing

1. deploy `retell-hook` to prod in observe mode (needs Yaseen);
2. **Yaseen** repoints the Retell dashboard webhook at `.../functions/v1/retell-hook` and watches `retell_hook_log` verify real deliveries;
3. only then `update app_private.retell_config set allow_unsigned_webhook = false`.

3 before 2 silently stops inbound voice. 2 before 1 loses calls.

## M Usman Farooq — resolved, and the collector did not cause it

Both our observations were true; they were two different jobs.

| when | what | who |
|---|---|---|
| 2026-08-03 19:42 | item reviewed, `recheck_due` set to **2026-09-05** | onboarding review, a month before the collector existed |
| 08-06 / 08-26 / 09-02 | three reminders, keys `reval:e7676569…:mc_authority:2026-09-05:warn30 / :early / :final` | `cron_packet_revalidation` |
| **09-06 06:10:00.242** | collector touches the org → `no_docket`; **no onboarding item written, no email** | `fmcsa_authority_collect` |
| **09-06 07:30:00.355** | item → `expired`, `lapsed_at` stamped, `lapsed:e7676569…` queued, delivered 07:30:02 | `cron_packet_revalidation` — the only routine in the catalog that writes a `lapsed:` key (the collector's is `authlapse:`) |

80 minutes apart, different jobs, different key namespace, driven by a due date set five weeks earlier. **F30 is not implicated.** This org is also one of the F33 no-docket cases, which is why the collector could do nothing for it.

## Recorded from your message, not re-verified by me

Your staging lapsed-broker run under a transaction-only constraint wrapper (inactive / paused / expired / email queued) — noted as **Codex-supplied**, and it agrees with what prod showed when it ran case 2 for real. Same for prod's 41 cron jobs / 15,483 runs / 0 failures, and for F08/F09/F18. HANDOFF now marks every line as independently verified, Codex-supplied, or UNKNOWN.

Two prod decisions are queued for Yaseen and nothing moves without him: **domain-check** (prod is still v2 and carries all three defects) and the **retell-hook cutover**. Live check 5 on prod is still unanswered. Outreach stays enabled; F10 waits for the role/document matrix; SEO, F33 and WhatsApp are parked.
