-- bl_bp_0321 — agent-confirm email: idempotency key per VERIFICATION CODE (audit F05, Sprint 1)
-- 2026-09-05 · staging first, prod on Yaseen's "apply to prod"
--
-- BUG (bl_bp_0318, app_private.broker_parent_confirm_send_p)
--   Every send expires the previous unconsumed email code and inserts a fresh one, but the
--   sys_email idempotency key was  'agentconfirm:<parent_id>:<1|r>:<md5(email)>'  — identical
--   for every non-reminder send (and for every reminder). sys_email does
--   ON CONFLICT (idempotency_key) DO NOTHING, so after the first send (or once the 10-minute
--   throttle passed) a "Resend" invalidated the old code and the NEW code was never emailed.
--   The agent saw "Confirmation sent", the brokerage got nothing, and the only live code was
--   one nobody had.
--
-- FIX (surgical, anchor-guarded, same signature → grants preserved)
--   • capture the new verify_codes.id (`returning id into v_vc`)
--   • key = 'agentconfirm:<parent_id>:<verify_code_id>:<md5(email)>'
--     → each deliberate send/resend = one new code = one new delivery; a *retry* of the same
--       code (same row id) still dedupes. Throttle (10 min), 5-attempt limit, 7-day expiry and
--       the no-calls-for-agents rule are untouched.
--
-- ROLLBACK: `select app_private.bl_bp_0321_rollback();` restores the three original lines.
--
-- STAGING HISTORY: first application (recorded as bl_bp_0321_agent_confirm_resend_idem) declared v_vc as
-- uuid — verify_codes.id is BIGINT; the rollback-txn test caught it (22P02), the patch was rolled back with
-- bl_bp_0321_rollback() and re-applied as bl_bp_0321b with bigint. This file is the corrected version; on
-- prod apply it once.

do $mig$
declare
  src text; n1 int; n2 int; n3 int;
  a_decl constant text := $a$declare ap app_private.agent_parents; v_agent text;$a$;
  b_decl constant text := $a$declare ap app_private.agent_parents; v_vc bigint; v_agent text;$a$;
  a_ins  constant text := $a$values (ap.agent_org, 'parent', 'email', ap.id, array_to_string(v_to, ', '), v_hash, now() + interval '7 days', null);$a$;
  b_ins  constant text := $a$values (ap.agent_org, 'parent', 'email', ap.id, array_to_string(v_to, ', '), v_hash, now() + interval '7 days', null) returning id into v_vc;$a$;
  a_idem constant text := $a$'agentconfirm:' || ap.id::text || ':' || case when p_reminder then 'r' else '1' end || ':' || md5(e)$a$;
  b_idem constant text := $a$'agentconfirm:' || ap.id::text || ':' || v_vc::text || ':' || md5(e) /* bl_bp_0321 */$a$;
begin
  src := pg_get_functiondef('app_private.broker_parent_confirm_send_p(uuid,boolean)'::regprocedure);
  if position('bl_bp_0321' in src) > 0 then raise notice 'bl_bp_0321: already applied — skip'; return; end if;
  n1 := (length(src)-length(replace(src,a_decl,'')))/length(a_decl);
  n2 := (length(src)-length(replace(src,a_ins ,'')))/length(a_ins);
  n3 := (length(src)-length(replace(src,a_idem,'')))/length(a_idem);
  if n1 <> 1 or n2 <> 1 or n3 <> 1 then
    raise exception 'bl_bp_0321: anchors not unique (decl=%, insert=%, idem=%) — function differs from 0318; inspect before applying', n1, n2, n3;
  end if;
  src := replace(src, a_decl, b_decl);
  src := replace(src, a_ins,  b_ins);
  src := replace(src, a_idem, b_idem);
  execute src;
  raise notice 'bl_bp_0321: broker_parent_confirm_send_p patched — idempotency key now per verification code';
end $mig$;

create or replace function app_private.bl_bp_0321_rollback()
returns text language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare src text;
  a_decl constant text := $a$declare ap app_private.agent_parents; v_agent text;$a$;
  b_decl constant text := $a$declare ap app_private.agent_parents; v_vc bigint; v_agent text;$a$;
  a_ins  constant text := $a$values (ap.agent_org, 'parent', 'email', ap.id, array_to_string(v_to, ', '), v_hash, now() + interval '7 days', null);$a$;
  b_ins  constant text := $a$values (ap.agent_org, 'parent', 'email', ap.id, array_to_string(v_to, ', '), v_hash, now() + interval '7 days', null) returning id into v_vc;$a$;
  a_idem constant text := $a$'agentconfirm:' || ap.id::text || ':' || case when p_reminder then 'r' else '1' end || ':' || md5(e)$a$;
  b_idem constant text := $a$'agentconfirm:' || ap.id::text || ':' || v_vc::text || ':' || md5(e) /* bl_bp_0321 */$a$;
begin
  src := pg_get_functiondef('app_private.broker_parent_confirm_send_p(uuid,boolean)'::regprocedure);
  if position('bl_bp_0321' in src) = 0 then return 'nothing to roll back'; end if;
  execute replace(replace(replace(src, b_decl, a_decl), b_ins, a_ins), b_idem, a_idem);
  return 'rolled back';
end $fn$;
revoke all on function app_private.bl_bp_0321_rollback() from public, anon, authenticated, service_role;

-- ACL re-check: CREATE OR REPLACE with the same signature must not CHANGE the ACL.
-- (This function has proacl = NULL on both envs — Postgres default, i.e. PUBLIC EXECUTE — which is
--  harmless because app_private is not exposed to PostgREST and has no schema USAGE grants for
--  anon/authenticated. So the check is "unchanged", not "no PUBLIC".)
do $chk$
declare acl_now text;
begin
  select coalesce(proacl::text, '<default>') into acl_now from pg_proc where oid = 'app_private.broker_parent_confirm_send_p(uuid,boolean)'::regprocedure;
  if acl_now <> '<default>' and acl_now like '%=X/%' and (acl_now like '%anon=%' or acl_now like '%authenticated=%') then
    raise exception 'bl_bp_0321: unexpected explicit anon/authenticated grant on broker_parent_confirm_send_p: %', acl_now;
  end if;
  raise notice 'bl_bp_0321: proacl = % (unchanged: same-signature replace keeps ACL)', acl_now;
end $chk$;
