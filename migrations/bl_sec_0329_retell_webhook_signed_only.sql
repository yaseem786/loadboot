-- bl_sec_0329_retell_webhook_signed_only.sql — audit F14 (first confirmed instance).
--
-- THE FINDING (Codex probed it on staging; Claude re-confirmed it independently over plain HTTP):
--   public.retell_webhook(jsonb) is SECURITY DEFINER and granted EXECUTE to PUBLIC, anon and authenticated on
--   BOTH envs. It is a single-unnamed-parameter function, which PostgREST exposes as a raw-body RPC, so anyone
--   holding the PUBLIC anon key can POST to /rest/v1/rpc/retell_webhook and reach the body. Claude's probe on
--   staging (req 193585) returned HTTP 200 {"ok":true,"ignored":true} — "ignored" only because the probe used a
--   deliberately non-matching phone number. With the real from_number (which is a published phone number) the
--   same call inserts an app_private.lc_calls row and, on a crafted call_ended/call_analyzed payload, can create
--   a crm_contact, a crm_lead, a crm_activity, an automation_task and staff notifications.
--
-- WHY THERE IS NO "JUST REVOKE ANON" FIX:
--   Retell posts the webhook straight at PostgREST with the anon key — that grant IS the live provider chain.
--   Prod evidence: 112 app_private.lc_calls rows (65 in the last 30 days) and 8 crm_leads with source='voice-call'.
--   A blind REVOKE would silently stop every inbound call from reaching CC and CRM.
--
-- WHY THE SIGNATURE CANNOT BE CHECKED IN POSTGRES:
--   Retell signs `HMAC-SHA256(raw_body + timestamp, api_key)` and sends it as `X-Retell-Signature: v=<ts_ms>,d=<hex>`,
--   and its docs are explicit that the RAW body must be used, not a re-serialised version. PostgREST hands this
--   function ALREADY-PARSED jsonb; re-serialising changes whitespace and key order, so the digest can never match.
--   Verification therefore has to happen where the raw bytes still exist — an edge function. That is
--   supabase/functions/retell-hook/index.ts, which verifies the signature and then calls this RPC as service_role.
--
-- WHAT THIS MIGRATION DOES — additive, reversible, and a NO-OP the moment it is applied:
--   1. adds app_private.retell_config.allow_unsigned_webhook boolean not null default TRUE.
--      TRUE = exactly today's behaviour. Nothing changes on apply. This is the kill switch, not the fix.
--   2. prepends a guard to public.retell_webhook: refuse with LB403 only when the caller is not service_role
--      AND allow_unsigned_webhook is FALSE. Anchor-guarded patch (the anchor is asserted to occur exactly once);
--      the rest of the body is untouched, which matters because the two envs' bodies differ.
--   3. app_private.bl_sec_0329_rollback() puts the old definition back and drops the column.
--
-- THE CUTOVER IS A THREE-STEP THAT ONLY YASEEN CAN COMPLETE, IN THIS ORDER:
--   a. deploy supabase/functions/retell-hook (verify_jwt=false) — it runs in OBSERVE mode first, logging whether
--      each real delivery verifies, and forwards either way. This is what proves the doc-derived signature format
--      against an actual Retell delivery before anything depends on it.
--   b. once real deliveries are observed verifying, change the webhook URL in the Retell dashboard to
--      .../functions/v1/retell-hook and set RETELL_HOOK_ENFORCE=true on the function.
--   c. only then: update app_private.retell_config set allow_unsigned_webhook = false.
--   Doing (c) before (b) stops inbound voice from reaching CC. Doing (b) before (a) risks losing calls to a
--   signature format nobody has yet seen a real example of.
--
-- STAGING RESULT 2026-09-06: tests/bl_sec_0329_rollback_test.sql → RESULT PASS (3 cases).
-- PROD: NOT APPLIED. Awaiting Yaseen's explicit approval.
do $$
declare src text; anchor text; guard text; n int;
begin
  alter table app_private.retell_config
    add column if not exists allow_unsigned_webhook boolean not null default true;

  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
   where n2.nspname='public' and p.proname='retell_webhook';
  if src is null then raise exception 'bl_sec_0329: public.retell_webhook not found'; end if;
  if src like '%LB403%' then raise notice 'bl_sec_0329: already applied, skipping patch'; return; end if;

  -- keep the pre-patch definition so the rollback helper can restore it byte for byte
  create table if not exists app_private.bl_sec_0329_backup(proname text primary key, def text, saved_at timestamptz default now());
  insert into app_private.bl_sec_0329_backup(proname, def) values ('retell_webhook', src)
    on conflict (proname) do nothing;

  anchor := E'  event := payload->>''event'';';
  select count(*) into n from regexp_matches(src, anchor, 'g');
  if n <> 1 then raise exception 'bl_sec_0329: anchor found % times, expected exactly 1', n; end if;

  guard := E'  -- bl_sec_0329 (audit F14): the PUBLIC anon key can reach this RPC through PostgREST. The signature\n'
        || E'  -- cannot be verified here (Retell signs the RAW body; PostgREST hands us parsed jsonb), so the real\n'
        || E'  -- check lives in the retell-hook edge function, which calls us as service_role. This is the switch\n'
        || E'  -- that closes the old door AFTER the provider has been moved. Default TRUE = no behaviour change.\n'
        || E'  if coalesce(current_setting(''request.jwt.claims'', true)::jsonb->>''role'','''') <> ''service_role''\n'
        || E'     and not coalesce((select allow_unsigned_webhook from app_private.retell_config where id = 1), true) then\n'
        || E'    return jsonb_build_object(''ok'', false, ''error'', ''forbidden'', ''code'', ''LB403'');\n'
        || E'  end if;\n'
        || anchor;

  src := replace(src, anchor, guard);
  execute src;
end $$;

create or replace function app_private.bl_sec_0329_rollback() returns text
language plpgsql security definer set search_path to 'app_private, public' as $$
declare d text;
begin
  select def into d from app_private.bl_sec_0329_backup where proname='retell_webhook';
  if d is null then return 'nothing to roll back'; end if;
  execute d;
  alter table app_private.retell_config drop column if exists allow_unsigned_webhook;
  delete from app_private.bl_sec_0329_backup where proname='retell_webhook';
  return 'bl_sec_0329 rolled back: retell_webhook restored, allow_unsigned_webhook dropped';
end $$;
revoke all on function app_private.bl_sec_0329_rollback() from public, anon, authenticated;
