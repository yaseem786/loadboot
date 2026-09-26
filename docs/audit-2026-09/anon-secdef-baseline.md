# anon-executable SECURITY DEFINER baseline — `public`

CLAUDE.md §4 used to say the count was **27**. On 9 Sep 2026 neither database read 27:
**prod = 33, staging = 34.** The drift predates bl_bp_0343 and it was not possible to reconstruct
which six the "27" excluded, so this file replaces the number with the actual names. A count tells
you something moved; a list tells you *what* moved, which is the thing you need at 2am.

## The check

```sql
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'execute')
 order by 1;
```

Run it before and after every migration. **Compare the NAMES, not just the count** — two changes
that cancel out leave the count untouched.

Note the companion trap: in `app_private` this same predicate is true for most functions, because
PostgreSQL grants EXECUTE to PUBLIC by default. It proves nothing there. The barrier that matters is
`has_schema_privilege('anon','app_private','usage')` = **false** (true on both databases, 9 Sep 2026).

## PROD baseline — rwscphuhpjoudvljvmdk, 9 Sep 2026 — 33 functions

Grouped by the flow that needs anon. Every one of these is reached before the caller has a session,
which is why it is anon-executable; that is the test to apply to any new name that appears here.

**Public site / marketing (7)**
`all_flags`, `cc_get_public_form`, `get_active_public_announcements`,
`get_public_load_opportunities`, `get_public_market_rates`, `submit_web_form`, `track_web_event`

**Live chat + guided onboarding widget, `lc_*` (12)** — since 19 Sep 2026 `lc_ob_doc_log` is service_role-only
and `lc_ob_upload_check` (caller-scoped upload preflight) took its place; count unchanged, names not.
`lc_brain_write`, `lc_chat_request_call`, `lc_history`, `lc_identify`, `lc_ob_upload_check`,
`lc_ob_get`, `lc_ob_save`, `lc_poll`, `lc_rate`, `lc_request_call`, `lc_send`, `lc_start`

**Email claim / ping links, `lb_email_*` (4)** — the F01 email work
`lb_email_claim_get`, `lb_email_claim_sign`, `lb_email_ping_confirm`, `lb_email_ping_get`

**Broker + agent identity claim by emailed link (4)** — bl_bp_0313 / bl_bp_0318
`partner_agent_confirm`, `partner_agent_confirm_get`, `partner_claim_confirm`, `partner_claim_get`

**Inbound webhooks and device ingest (4)**
`eld_ingest`, `retell_inbound`, `retell_webhook`, `dispatcher_submit_id`

**Other (2)**
`lb_contact_channel`, `outreach_unsubscribe`

## STAGING — snslhvmkjusozgjelghi, 9 Sep 2026 — 32 functions

31 of prod's 33, and the whole difference is feature revision, not a permission gap:

| | on prod only | on staging only |
|---|---|---|
| chat-widget onboarding | — (parity since 19 Sep 2026: `lc_ob_upload_check` on both, `lc_ob_doc_log` service-only on both) | — |
| inbound call webhook | `retell_inbound` | — |

Both databases keep `has_schema_privilege('anon','app_private','usage')` = **false**.

### Resolved 9 Sep 2026 — two staff functions had an anon grant on staging

`cc_cmp_save` and `cc_set_coi_limits` were anon-executable on staging and are not on prod:

```
prod     ACL: postgres=X | authenticated=X | service_role=X
staging  ACL: postgres=X | anon=X | authenticated=X | service_role=X   <- the stray grant
```

`cc_*` is the Command Center namespace — a staff surface. Nothing was actually reachable: both
functions authorise on their FIRST statement (`cc_cmp_save` → `has_global_permission('campaigns.view'
/ 'content.manage' / 'settings.manage')`, `cc_set_coi_limits` → `has_global_permission('documents.review')`),
so an anon caller already got `42501 not authorized`. The grant was still one layer of defence that
should not have been missing, and it made the two environments disagree.

**Revoked on staging** in migration `bl_sec_align_staging_cc_anon_revoke` (idempotent: it only
revokes where the grant is actually present, then asserts it is gone). Staging's anon surface went
34 → 32 and now differs from prod only by the two feature-revision names above.

Worth knowing for next time: these were explicit `anon=X` entries, not PostgreSQL's default
EXECUTE-to-PUBLIC. That is the signature of a blanket `grant execute on all functions in schema
public to anon` — so check this list after any migration that runs one.

## History

- **9 Sep 2026** — two stray anon grants revoked on staging (see above): staging 34 → 32.
- **9 Sep 2026** — baseline recorded during the bl_bp_0343 prod apply. Prod 33 before = 33 after;
  the migration created no `public` function and its CREATE OR REPLACE of `cc_broker_trust_set` /
  `cc_broker_trust_queue` preserved their ACLs (neither is anon-executable on prod).


## 12 September 2026 — dispatcher-test additions and staging correction

Fresh observed counts were production **40**, staging **39**. The seven additions on both were `cc_dispatcher_test_invite`, `cc_dispatcher_test_review`, `cc_dispatcher_test_score`, `dispatcher_test_my`, `dispatcher_test_save`, `dispatcher_test_start`, `dispatcher_test_submit`. All had PUBLIC and explicit anon EXECUTE; their existing sign-in/staff guards refused anonymous staging probes. This is not approval to expand the production baseline.

Staging migration `20260912190639 / audit_dispatcher_test_execute_boundary` revoked only PUBLIC/anon on those seven, preserving exact bodies and authenticated/service grants. Staging is back to **32**; name-level before/after comparison and rollback/reapply rehearsal PASS. Production remains **40**, with the seven pending explicit promotion approval. No other lane's bodies were changed.


## 13 September 2026 — approved production dispatcher restriction

Production is now **33**, staging **32**. Production before/after catalog name arrays prove that exactly the seven dispatcher names listed above were removed and none added. All seven bodies and authenticated/service grants match current staging, including the 0309 race guard on `dispatcher_test_start`. Production migration `20260913111246 / audit_dispatcher_test_execute_prod`; report migration `20260913111048` adds no anonymous surface. Earlier pending-approval status is historical. See `PROD-BEFORE-2026-09-13.json` and `PROD-AFTER-2026-09-13.json`.

### 19 Sep 2026 — live-chat package promoted to prod (bl_sec_0335 / bl_sec_0336 / bl_audit_0344)

Production migrations `20260919195205`, `20260919195240`, `20260919195311`. Prod count **33 → 33** but the NAME set changed exactly as designed: `lc_ob_doc_log` lost anon+authenticated (service_role only, and its body now refuses any non-service JWT with 42501) and `lc_ob_upload_check(text,uuid)` was added (anon/authenticated/service_role). Full 33-name catalog after: all_flags, cc_get_public_form, dispatcher_submit_id, eld_ingest, get_active_public_announcements, get_public_load_opportunities, get_public_market_rates, lb_contact_channel, lb_email_claim_get, lb_email_claim_sign, lb_email_ping_confirm, lb_email_ping_get, lc_brain_write, lc_chat_request_call, lc_history, lc_identify, lc_ob_get, lc_ob_save, lc_ob_upload_check, lc_poll, lc_rate, lc_request_call, lc_send, lc_start, outreach_unsubscribe, partner_agent_confirm, partner_agent_confirm_get, partner_claim_confirm, partner_claim_get, retell_inbound, retell_webhook, submit_web_form, track_web_event. Staging remains 32 (no `retell_inbound`). See `REVIEW-LIVECHAT-PROMOTION-2026-09-19.md`.

## Closing snapshot — 2026-09-22 23:59 UTC (after bl_audit_0368 + retell-inbound-hook v3)
Method (re-runnable on either env; compare the hashes, not the lists):
```sql
with f as (select p.oid, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig, md5(pg_get_functiondef(p.oid)) h,
  p.prosecdef, has_function_privilege('anon',p.oid,'execute') anon_ok,
  (select count(*) from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') sp
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f')
select (select count(*) from f where prosecdef and anon_ok and sig like 'public.%') anon_secdef_n,
       (select md5(string_agg(sig, ',' order by sig)) from f where prosecdef and anon_ok and sig like 'public.%') anon_names_md5,
       (select md5(string_agg(sig||':'||h, ',' order by sig)) from f where prosecdef and anon_ok and sig like 'public.%') anon_bodies_md5,
       (select count(*) from f where sp=0 and prosecdef) mutable_search_path,
       (select count(*) from pg_policies where schemaname in ('public','app_private','storage')) policies;
```
| env | anon SECDEF n | names md5 | bodies md5 | mutable search_path | policies | newest migration |
|---|---|---|---|---|---|---|
| prod rwscphuhpjoudvljvmdk | 33 | 953886bff239ddeeb039d1c060eb4cec | 5a4904e3b501e09986451da717303061 | 0 | 38 | 20260922235612 bl_audit_0368 |
| staging snslhvmkjusozgjelghi | 32 | dfda9a34f957f9522a351db2a93935c4 | 18fc41b2e6d13907a60aef8d19521fa3 | 0 | 37 | 20260923000804 bl_inv_0407 (investor lane) |

(The names md5 here uses schema-qualified signatures with identity args, so it is NOT comparable with the earlier 8736b2d7…/6a7bd230… values, which hashed bare names. Counts are the same 33/32.)

Audit-function body parity (15 functions: cc_erasure_*, erasure_removal_*, erasure_suggest, cc_lc_doc_*, lc_doc_recon_log_add, my_uploads_frozen,
lc_ob_upload_check, cc_account_deletion_process, capture_account_erasure_inventory, cc_retention_classes, retell_hook_verify):
14/15 byte-identical across envs; the one difference is `retell_hook_verify` — staging carries ONE extra comment line
("-- try the dedicated webhook signing key first, then the general api key"), code identical. Accepted, no action.

## 24 Sep 2026 — investor lane: six names appeared, root cause found, revoked (bl_sec_0436)

Observed 24 Sep before the fix: **prod 39, staging 38** = the 33 / 32 above plus six investor-lane
names on both: `cc_inv_expense_attach`, `cc_inv_request_attach`, `cc_inv_set_txn_time`,
`inv_claim_by_email`, `inv_publish_self_doc`, `inv_self_onboard` (bl_inv_0408 / 0409 / 0410 / 0412 / 0413).

**Root cause — this is the mechanism, not a stray blanket grant.** `pg_default_acl` on both databases
carries Supabase's default for role `postgres` in schema `public`, object type `f`:
`{postgres=X, anon=X, authenticated=X, service_role=X}`. Every function created in `public` gets an
EXPLICIT `anon=X` entry at creation. The five migrations each ran
`revoke all on function … from public; grant execute … to authenticated;` — that removes PUBLIC's
implicit EXECUTE but does not touch the explicit anon entry, so all six stayed anon-executable.

**Why nothing was reachable:** each one authorises on its first statement — `auth.uid() is null →
42501 'not signed in'` (`inv_claim_by_email`, `inv_self_onboard`), `app_private.inv_can_manage()`
(`cc_inv_*`), `app_private.inv_my_investor()` (`inv_publish_self_doc`). Same shape as the 9 Sep `cc_cmp_save`
case: a missing layer, not an open door.

**Fix:** `migrations/bl_sec_0436_inv_anon_revoke.sql` — `revoke execute … from public, anon` on the six
exact signatures, then a DO block that asserts none is anon-executable and all keep authenticated +
service_role. Applied staging (38 → **32**, names = the staging list above) and prod (39 → **33**, names
= the 19 Sep catalog exactly). `has_schema_privilege('anon','app_private','usage')` still false on both.

**Rule from here (added to CLAUDE.md §4):** a migration that creates a `public` function must
`revoke execute on function … from public, anon` explicitly — revoking from PUBLIC alone leaves the
default-ACL anon grant in place — and must re-run the check above and compare names.

### 25 Sep 2026 — market data registry (bl_mkt_0442), staging

`bl_mkt_0442_site_facts_registry` adds ONE intentional anon name: **`get_public_site_facts()`** — the
public-site build's read of site facts + diesel + rates `as_of`, same shape and reason as
`get_public_market_rates` (reached by `build_site.py` on Netlify with the anon key, no session). The six
staff functions it creates (`cc_site_facts`, `cc_site_fact_set`, `cc_site_publish_config_set`,
`cc_site_rebuild`, `cc_market_rates_preview`, `cc_market_rates_publish`) are revoked from public + anon
in the migration, which asserts that at the end. Staging name-level check after apply: **32 → 33**, the
only added name is `get_public_site_facts`. **Prod applied the same day** (bl_mkt_0442–0445): **33 → 34**,
name-level diff = `+get_public_site_facts`, nothing removed. Full 34-name prod catalog after: all_flags, cc_get_public_form,
dispatcher_submit_id, eld_ingest, get_active_public_announcements, get_public_load_opportunities, get_public_market_rates,
get_public_site_facts, lb_contact_channel, lb_email_claim_get, lb_email_claim_sign, lb_email_ping_confirm, lb_email_ping_get,
lc_brain_write, lc_chat_request_call, lc_history, lc_identify, lc_ob_get, lc_ob_save, lc_ob_upload_check, lc_poll, lc_rate,
lc_request_call, lc_send, lc_start, outreach_unsubscribe, partner_agent_confirm, partner_agent_confirm_get,
partner_claim_confirm, partner_claim_get, retell_inbound, retell_webhook, submit_web_form, track_web_event.
Staging = the same minus `retell_inbound` = 33. `diesel_pull_record` (0443) is service_role-only and asserted so.
CLAUDE.md §4 updated to 34/33.

### 25 Sep 2026 — unsubscribe engine (bl_comm_0446), staging

`bl_comm_0446_unsubscribe_engine` adds **no anon name**. The preference page (`supabase/functions/unsubscribe`,
`verify_jwt=false` as before) talks to three NEW service_role-only RPCs — `unsub_link_get`, `unsub_link_apply`,
`unsub_link_reason` — with the service key it already held; `outreach_unsubscribe` keeps its anon grant (old links
in inboxes) with a body that now routes through `app_private.unsub_apply`. The eleven staff RPCs (`cc_unsub_*`,
`cc_email_can_send`) and the two worker guards (`cc_delivery_worker_unsubscribe`, `cc_delivery_worker_optional_allowed`,
`cc_mail_unsubscribe_from`) are revoked from public + anon in the migration. Staging name-level check after apply:
**33 → 33, identical name set.** Prod expectation: 34 → 34, identical.

**Prod applied 26 Sep 2026** (`bl_comm_0446_unsubscribe_engine` + `bl_comm_0446d_backfill_events_unknown_addresses`):
**34 → 34**, name-set md5 `d98c0b18…` before and after (identical names; `get_public_site_facts` list above),
`has_schema_privilege('anon','app_private','usage')` still false. `0446d` adds no function.
