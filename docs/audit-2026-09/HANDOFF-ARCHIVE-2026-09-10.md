# Historical handoff snapshot — preserved 12 September 2026

Do not use this snapshot as current state.

## CURRENT STATE — 2026-09-10 04:00 UTC (rewritten this turn)

### Re-sync, read live this turn (the numbers below were STALE in the 2026-09-07 header)

| | prod `rwscphuhpjoudvljvmdk` | staging `snslhvmkjusozgjelghi` |
|---|---|---|
| newest migration | `bl_bp_0343a_rescreen_must_not_clobber_verdict` (`20260909115519`) | `bl_audit_0342_account_request_boundaries` (`20260910034654`) |
| anon-executable SECDEF in `public` | **33** | **32** |
| `anon` USAGE on `app_private` | false | false |

The 2026-09-07 header said "prod newest `bl_web_0333`, staging newest `bl_sec_0334`". Both moved a long
way since, in **three different lanes**, none of them this file's audit lane:
- **broker-supply lane** — `bl_bp_0343` + `0343a` (broker FMCSA re-screen) applied to PROD 9 Sep and
  resynced onto staging; see project memory `broker_rescreen_2026-09-09.md`.
- **live-chat security lane** — `bl_sec_0335_livechat_visitor_boundaries` (`20260908045736`) and
  `bl_sec_0336_chat_remaining_boundaries` (`20260908052009`) on STAGING. **These already did NEXT
  ACTION item 2 below** (see the next block).
- **account-deletion lane** — `bl_audit_0339`, `0341`, `0342` on STAGING, the last one 2026-09-10
  03:46 UTC, i.e. that lane may still be mid-flight. Not touched.

### F14 live-chat slice — ALREADY DONE ON STAGING by another lane; prod is the gap

The previous NEXT ACTION asked for `lc_send` / `lc_poll` / `lc_rate` / `lc_ob_save` / `lc_start` to be
reviewed against the `lc_history` standard. Read live this turn: **staging already enforces it.** Its
`lc_send` guard now reads

```
elsif coalesce(length(p_visitor_key),0) not between 16 and 64 or p_visitor_key like 'novkey%'
   or v_conv.visitor_key is distinct from p_visitor_key then
```

and `lc_poll`, `lc_rate`, `lc_ob_get`, `lc_ob_save`, `lc_ob_doc_log` all carry the 16–64 floor and the
`novkey` refusal too. Nothing was re-done here. **PROD has none of it** — `lc_ob_get`, `lc_ob_save` and
`lc_ob_doc_log` still gate on `length(p_visitor_key) < 8`, and `lc_send` / `lc_poll` / `lc_rate` still
have no length floor at all.

How exposed prod actually is, read this turn — **latent, not live**: 70 conversations, **0** rows with
both `user_id` and `visitor_key` null, **0** keys shorter than 16 (shortest 26); 1 onboarding row,
shortest key 28, **0** `novkey` rows, 0 rows carrying an `account_email`. So the weak floors are real
but nothing in the data is currently reachable through them.

Worth stating precisely, because it changes the priority: `lc_send` / `lc_poll` / `lc_rate` also require
the conversation **uuid** and an **equality** match on the stored key, so a length floor is defence in
depth there. `lc_ob_get` / `lc_ob_save` / `lc_ob_doc_log` are keyed on the visitor key **alone** — that
is where the floor is load-bearing, and `lc_ob_save` is the **write** side (it can overwrite a
visitor's role, step, merged data, `account_email` and `completed_at`).

### 🆕 F36 — `lc_ob_save` has a rate limit that cannot limit anything (both envs)

```sql
declare v_id uuid; v_saves int;
  select count(*) into v_saves from app_private.lc_onboarding
    where visitor_key = p_visitor_key and updated_at > now() - interval '1 day';
```

`v_saves` is assigned and then **never read** — so nothing is throttled. And it could not work even if
it were wired: `lc_onboarding_visitor_key_key` is a **UNIQUE index on `visitor_key`**, so that count is
0 or 1, forever. A reader would reasonably believe onboarding saves are capped per day. They are not,
on either environment. Not fixed this turn — see NEXT ACTION 2; the throttle number is Yaseen's call
and the account-deletion lane was mid-flight on staging.

---

### The 2026-09-07 prod deploys — still true, unchanged since

**Yaseen said "tyar sab karo" — all three prod deploys are DONE.** Nothing was revoked and nothing was switched
to enforce. Prod is in the state where the old doors still work and the new signed doors also work.

### PROD, after this turn

| what | prod state | evidence |
|---|---|---|
| `domain-check` | **v5 deployed**, slot 3, `ezbr_sha256 9a2e429dd11263e323b79bdabe270205150ed5c691ab5089caa9531abdc3de67` | live checks below |
| `retell-hook` | **v2 deployed**, slot 1, `1b0fbaa94a68d4f1922216e3bef1ee0f41832d75018f3414b2f487b8928fd0dd`, `verify_jwt=false` | signed end-to-end chain below |
| `bl_sec_0329` / `0329b` / `0329c` | **applied**. `allow_unsigned_webhook = TRUE` (observe) — the live Retell chain is untouched | test below |
| `retell-inbound-hook` | **v1 deployed**, slot 1, `c45b322eff1cfa1cc3d5b89c4a4275d1ad86a889d05585fc72affe1f4468e160`, `verify_jwt=false` | live checks below |
| `bl_sec_0330` | **applied**. `retell_inbound_verified` grants: `postgres:EXECUTE, service_role:EXECUTE` | md5 equivalence below |
| `public.retell_inbound` | **UNCHANGED**, grants still `postgres, anon, authenticated, service_role` | deliberate — the Retell inbound webhook may still point at it |
| `public.retell_webhook` | guarded, but the guard is inert while the flag is TRUE | |

**`bl_sec_0330` on prod was built from prod's OWN live definition**, not from a pasted copy. Verification:
prod's `pg_get_functiondef(retell_inbound)` + the guard inserted after the single `begin
` + the rename hashes
to **`43b69a2488ac4a99661bd74ad82f46f9`**, and `pg_get_functiondef(retell_inbound_verified)` hashes to the same.
**byte_identical = true.** Every branch, string and precedence rule is prod's own.

### Prod evidence, all run this turn

**domain-check v5** — real caller `loadboot.com` → 200, response shape unchanged (req 195107).
`0--1.sslip.io`, `169.254.169.254.nip.io`, `fe90--1.sslip.io`, `febf--1.sslip.io` and
`0-0-0-0-0-ffff-7f00-1.sslip.io` all → `refused: resolves to private address` (195108–195112).
Control `2606-4700--1111.sslip.io` (public IPv6) → **not refused**; it reached the network and failed on a TLS
handshake (195113). All three former bypasses are closed on prod.

**bl_sec_0329 + 0329b, one rollback-txn block → RESULT PASS on four counts:** flag TRUE → anon still works and
still writes (proves the apply is a no-op for the live chain); flag FALSE → anon **and** authenticated both
LB403 with **0 rows written**; flag FALSE → service_role still reaches the body; and the verifier, using the
**real prod api_key** — a correctly signed body verifies, a forged digest and a one-space-altered body are
rejected, `anon` gets LB403.

**retell-hook v2 end-to-end on prod, signed, with zero writes:** a correctly signed `call_started` whose
from/to numbers deliberately do not match `retell_config.from_number` →
`{"ok":true,"verified":true,"enforce":false,"reason":"signature_ok","forwarded":true,"upstream":{"ok":true,"ignored":true}}`
(req 195128). The whole chain — verify, forward as service_role, upstream answer — works on prod **before**
Yaseen repoints anything.

**bl_sec_0330 rollback test on prod → RESULT PASS, 4 cases:** anon / authenticated / empty-claims all refused
with the empty `{"call_inbound":{}}` envelope; the four cheap branches match; the form branch returns the
caller's own words; the broker branch keeps precedence over the form.

**retell-inbound-hook live on prod:** q1 valid signature → **200** with the full envelope (195120); q2 forged
digest → **401** `digest_mismatch` (195121); q3 missing header → **401** `signature_header_unparsable` (195122);
q4 stale by 66 minutes → **401** `timestamp_outside_skew` (195123); q5 valid signature over a different body →
**401** `digest_mismatch` (195124). Every refusal returns the EMPTY envelope.

**Prod left clean:** `lc_calls` = **112**, unchanged; **0** `bl0329-*` or `prodchain*` rows; flag still TRUE
(observe); `retell_hook_log` holds 6 verdict rows and **no phone numbers, no bodies, no context**.

### What is still OFF, and why

- `allow_unsigned_webhook` is **TRUE**. The old anon door to `retell_webhook` still works. That is intentional:
  Retell is still posting there.
- `public.retell_inbound` still has its `anon` / `authenticated` grants. Also intentional, same reason.
- Neither can be closed until Yaseen repoints the two webhooks in the Retell dashboard and a real signed
  delivery is seen verifying in `app_private.retell_hook_log`.

### Still not covered anywhere
The `body_not_json` → 400 branch of `retell-inbound-hook`: `pg_net` can only post a jsonb body, so a non-JSON
raw body cannot be produced from Postgres. Code inspection only — **UNKNOWN**.


### Staging re-verification + domain-check v4 (2026-09-06, after Codex's fe80::/10 finding)

Working branch `audit/s2-remaining-hardening`; main `7dc83e4`; F31 client branch `audit/s2-f31-client-verdict` @ `1259d12b` (reviewed, NOT edited).
Staging newest migration `bl_camp_0328_analytics_count_engagement_by_timestamp` (campaign lane); prod newest `bl_camp_0327_solo_operator_self_approval`. `bl_cmp_0326_broker_precedence_fix` is on BOTH (staging `20260906123949`, prod `20260906125744`).

| | Staging evidence, re-run this turn |
|---|---|
| **A** | `tests/bl_cmp_0326_rollback_test.sql` → **RESULT PASS**: case1 broker-only = active/no-pause/no-email; case2 SKIPPED (staging's `org_onboarding_items_status_check` has no `'expired'`); case3 carrier verified-inactive = inactive/no-pause/no-email. Prod ran all three, case2 included. |
| **B** | `tests/bl_sec_0320_rollback_test.sql` → **RESULT PASS**: authenticated=LB403, anon=LB403, service_role reached the body (`{"merged":false,"reason":"no_broker"}`), 0 rows written by refused callers, no anon/authenticated grants remain. Live: anon key → load-mail = **403 LB403** (req 192639). load-mail staging slot 10, prod slot 7. |
| **C** | **`domain-check` v4 deployed to staging (slot 5), `ezbr_sha256 1c2a6af6…d29af4fe`.** Codex was right: link-local is `fe80::/10` (fe80 **through** febf) and v3's `startsWith("fe80")` only covered `fe80::/16`. |

**What v4 changes.** Every IPv6 prefix test is replaced by a real address parser (`v6Words`) plus numeric range
checks, so the classifier no longer depends on how an address happens to be spelled:
`fe80–febf` link-local, `fc00::/7` ULA, `ff00::/8` multicast, `::1`/`::` in any spelling, `::ffff:0:0/96`
v4-mapped (dotted **or** the hex form the URL parser produces), `::a.b.c.d` v4-compatible, `2002::/16` 6to4 and
`64:ff9b::/96` NAT64 resolved down to the IPv4 they embed, `%zone` stripped, anything unparsable refused.

**Regression evidence — `tests/domain_check_v4_ip_cases.mjs`, 30 cases, `node` exits 0.** The file carries v3
alongside v4 so the fix is demonstrated, not asserted: **v3 gets 8 of the 30 wrong**, all of them "public" when
they are not — `fe90::1`, `fea0::1`, `feaf::dead:beef`, `febf::1` (the range bug), `0:0:0:0:0:0:0:1` and
`0:0:0:0:0:0:0:0` (uncompressed loopback/unspecified), `2002:7f00:1::1` and `64:ff9b::7f00:1` (6to4 and NAT64
smuggling 127.0.0.1). Negative controls in the same file: `fe7f::1` and `fec0::1` stay public, `::ffff:8.8.8.8`
and `2606:4700::1111` stay public.

**Live staging checks (`tests/edge_fn_live_checks_2026-09-06.sql`), all as expected:**
`fe90--1.sslip.io` and `febf--1.sslip.io` → `refused: resolves to private address` (**v3 let both through**);
`0--1.sslip.io`, `169.254.169.254.nip.io`, `0-0-0-0-0-ffff-7f00-1.sslip.io` → refused;
`loadboot.com` → 200 with the response shape unchanged (mx, title, name_match, matched_tokens all present);
and the control, `2606-4700--1111.sslip.io` (public IPv6) → **not** refused, it reaches the fetch and fails
there. Test-authoring note: sslip.io writes `:` as `-`, so `--ffff-7f00-1` is an invalid DNS label (a label
cannot start with `-`) — the v4-mapped case must be spelled `0-0-0-0-0-ffff-7f00-1`.

**Recorded, not acted on:** Yaseen has decided the outreach engine stays **enabled**. F03 is therefore closed as
a decision, not as a defect — no pause, no schedule change. Nothing was touched.

**Prod untouched this turn.** No deploy, no migration, no rollback, no backfill, no message.

