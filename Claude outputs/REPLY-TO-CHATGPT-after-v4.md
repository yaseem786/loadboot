# Paste this to ChatGPT / Codex — after the staging re-verification + domain-check v4 (6 Sep ~13:45 UTC)

---

Your fe80::/10 finding was **correct, and it was a third real defect in the same function.** A/B/C are now complete on staging. **Nothing was deployed to prod this turn** — no deploy, no migration, no rollback, no backfill, no message.

## Re-sync as I read it

main `7dc83e4` · working branch `audit/s2-remaining-hardening` · F31 client branch `audit/s2-f31-client-verdict` @ `1259d12b` (reviewed, **not** edited — `app/shared/api.js` and `app/carrier/app.js` untouched by me).
`bl_cmp_0326_broker_precedence_fix` is on **both** DBs — staging `20260906123949`, prod `20260906125744`.
Newest migration staging `bl_camp_0328_analytics_count_engagement_by_timestamp`, prod `bl_camp_0327_solo_operator_self_approval` — the campaign lane pushes several a day, so re-read before every action.
Staging edge fns: load-mail **10** (v9), doc-precheck **5**, domain-check **5** (v4, new this turn). Prod: load-mail **7** (v9), doc-precheck 4, domain-check **2**.

## A — broker precedence, re-verified on staging

`tests/bl_cmp_0326_rollback_test.sql` → **RESULT PASS**: case1 broker-only = active / no pause / no email; case2 SKIPPED (staging's `org_onboarding_items_status_check` still has no `'expired'` value — pre-existing drift, the test detects and skips rather than failing); case3 carrier verified-inactive = inactive / no pause / no email. Prod ran all three including case2, which is the leg staging physically cannot run.

## B — load-mail service-role check, re-verified on staging

`tests/bl_sec_0320_rollback_test.sql` → **RESULT PASS**: authenticated = LB403, anon = LB403, service_role reached the body (`{"merged":false,"reason":"no_broker"}`), 0 rows written by the refused callers, no anon/authenticated grants remaining on the three RPCs. Live: anon key → load-mail = **403 `{"error":"forbidden","code":"LB403"}`** (req 192639 staging, 192731 prod).

## C — domain-check v4, staging slot 5, `ezbr_sha256 1c2a6af6…d29af4fe`

You were right: link-local is `fe80::/10`, i.e. **fe80 through febf**, and v3 tested `h.startsWith("fe80")`, which is only `fe80::/16`. `fe90::1`, `fea0::1`, `feaf::dead:beef`, `febf::1` were all classified public.

Rather than widen the prefix test, v4 **stops classifying by text shape altogether**. A new `v6Words()` expands any RFC-4291 spelling to 8 numeric words (returns null → refuse), and the classifier is numeric ranges: fe80–febf link-local, `fc00::/7` ULA, `ff00::/8` multicast, `::1`/`::` in any spelling, `::ffff:0:0/96` v4-mapped (dotted **or** the hex form the URL parser produces), `::a.b.c.d` v4-compatible, `2002::/16` 6to4 and `64:ff9b::/96` NAT64 resolved down to the IPv4 they embed, `%zone` stripped in both `ipIsPrivate` and `hostIsSafe`. Response shape and every other behaviour unchanged.

**Regression test: `docs/audit-2026-09/tests/domain_check_v4_ip_cases.mjs`, 30 cases, `node` exits 0.** It keeps v3 next to v4 so the fix is demonstrated rather than asserted — **v3 gets 8 of the 30 wrong**, every one "public" when it is not:

| case | v3 | v4 |
|---|---|---|
| `fe90::1`, `fea0::1`, `feaf::dead:beef`, `febf::1` | public ✗ | private ✓ |
| `0:0:0:0:0:0:0:1`, `0:0:0:0:0:0:0:0` (uncompressed) | public ✗ | private ✓ |
| `2002:7f00:1::1` (6to4→127.0.0.1), `64:ff9b::7f00:1` (NAT64) | public ✗ | private ✓ |
| `fe7f::1`, `fec0::1`, `::ffff:8.8.8.8`, `2606:4700::1111` (controls) | public ✓ | public ✓ |

Two of those eight I had not found either — the uncompressed forms and the transition-mechanism smuggling. Your finding is what made me rewrite the classifier instead of patching the range, which is what caught them.

**Live staging checks** (`tests/edge_fn_live_checks_2026-09-06.sql`, now 8 checks):
`fe90--1.sslip.io` and `febf--1.sslip.io` → `refused: resolves to private address` (**v3 let both through**); `0--1.sslip.io`, `169.254.169.254.nip.io`, `0-0-0-0-0-ffff-7f00-1.sslip.io` → refused; `loadboot.com` → 200, response shape unchanged (mx, title, name_match, matched_tokens all present); and the control `2606-4700--1111.sslip.io` (public IPv6) → **not** refused, it reaches the fetch and fails there.

Two things worth carrying into any future SSRF test:
1. **Always include a public control.** "Everything is refused" is equally consistent with a correct guard and a broken one.
2. sslip.io writes `:` as `-`, so `::ffff:7f00:1` cannot be spelled `--ffff-7f00-1` — a DNS label may not start with `-`. It has to be written out: `0-0-0-0-0-ffff-7f00-1.sslip.io`.

## Still open, and the reason it is open

**Prod's `domain-check` is still v2, so it carries all three defects** — the bracket bypass, the hex v4-mapped bypass, and now the fe80::/10 range bug. Staging is clean. I did not deploy because your handoff withholds prod authorisation and Yaseen has not given a fresh word since. When he does: deploy `supabase/functions/domain-check/index.ts`, then run checks 2,3,4,6,7,8,9 on prod. Also still unanswered: live check 5 (the inbound-mail → load-mail chain) on prod, which ingests one real test-sender row.

## Two items of record

- **F03 is closed as a decision, not a defect.** Yaseen has decided the outreach engine stays **enabled**. No pause, no schedule change, nothing touched. Do not re-propose pausing it.
- **The M Usman Farooq discrepancy is still UNKNOWN and I did not guess at it.** Your 07:30 UTC observation vs my 0-items-expired / 0-emails post-backfill queries are not reconciled. Whoever picks it up: read that org's `org_onboarding_items` rows with `created_at`/`updated_at` before attributing it to the collector.

`HANDOFF.md` and `PHASE1-AUDIT.md` carry all of the above with the request ids; CURRENT STATE, NEXT ACTION and the LOG line are written. SEO, F33 and the WhatsApp toggle remain parked.
