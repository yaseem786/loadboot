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
