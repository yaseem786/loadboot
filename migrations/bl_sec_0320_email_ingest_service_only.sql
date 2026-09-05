-- bl_sec_0320 — lb_email_* ingestion RPCs: service-role only (audit F01, Sprint 1)
-- 2026-09-05 · staging first, prod on Yaseen's "apply to prod"
--
-- WHY
--   public.lb_email_load_ingest(jsonb), lb_email_reply_merge(text,jsonb) and
--   lb_email_ping_confirm_by_email(text,jsonb) are SECURITY DEFINER, were granted
--   EXECUTE to `authenticated` (prod) and to `anon`+`authenticated` (staging; 0285 was
--   never applied there), and contain NO caller check. Any signed-in user could spoof a
--   broker sender, create email_brokers/email_loads rows and make LoadBoot queue mail.
--
-- CALLER INVENTORY (5 Sep 2026, repo b44fbab + prod catalog)
--   • edge fn `load-mail` (prod v7, deployed; source NOT in repo until this sprint) —
--     the ONLY caller. Chain: Resend/Cloudflare → inbound-mail (service key) → load-mail
--     (verify_jwt=true) → these RPCs. load-mail v7 sends `apikey: SVC` WITHOUT an
--     `Authorization: Bearer` header → load-mail v8 (this sprint) adds the Bearer.
--   • SQL functions referencing them: none.  cron jobs: none.  app/ code: none.
--     build_site.py: none.
--
-- WHAT THIS DOES (idempotent, additive)
--   1. app_private.lb_service_caller(): true only for service_role JWTs or direct
--      SQL/cron (no PostgREST claims). anon/authenticated → false.
--   2. Inserts ONE guard line after the single `begin` of each function, WITHOUT
--      re-typing the body (bodies differ between staging and prod), so each env keeps
--      its own logic. Marker `-- bl_sec_0320 guard` makes re-runs a no-op.
--   3. Grants: revoke from public/anon/authenticated; grant to service_role.
--
-- ORDER OF OPERATIONS ON PROD
--   deploy load-mail v8 (Bearer SVC) FIRST, then apply this migration. Reversed order
--   would refuse apikey-only calls until v8 lands.
--
-- ROLLBACK
--   Prior grants (prod): postgres, authenticated, service_role EXECUTE on all three.
--   Prior grants (staging): postgres, anon, authenticated, service_role.
--   To roll back the guard: `select app_private.bl_sec_0320_rollback();` (defined below,
--   removes the guard line from each function; then re-grant as above if needed).

-- 1. helper -------------------------------------------------------------------
create or replace function app_private.lb_service_caller()
returns boolean
language sql
stable
set search_path to 'app_private, public'
as $fn$
  select
    -- direct SQL / cron / owner context: PostgREST claims are absent
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
    or
    -- PostgREST call carrying the service-role JWT
    coalesce((nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'role', '') = 'service_role'
$fn$;
revoke all on function app_private.lb_service_caller() from public, anon, authenticated;
grant execute on function app_private.lb_service_caller() to service_role;

-- 2. guard insert (anchor = the one `\nbegin\n` in each body) -------------------
do $mig$
declare
  r record;
  src text;
  hdr text;
  anchor constant text := E'\nbegin\n';
  guard constant text := E'\nbegin\n  if not app_private.lb_service_caller() then return jsonb_build_object(''error'',''forbidden'',''code'',''LB403''); end if; -- bl_sec_0320 guard\n';
  n int;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('lb_email_load_ingest','lb_email_reply_merge','lb_email_ping_confirm_by_email')
  loop
    src := pg_get_functiondef(r.oid);
    if position('bl_sec_0320 guard' in src) > 0 then
      raise notice 'bl_sec_0320: % already guarded — skip', r.proname;
      continue;
    end if;
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    if n <> 1 then
      raise exception 'bl_sec_0320: expected exactly 1 begin anchor in %, found %', r.proname, n;
    end if;
    execute replace(src, anchor, guard);
    raise notice 'bl_sec_0320: guard inserted into %', r.proname;
  end loop;
end
$mig$;

-- 3. grants (explicit, even though CREATE OR REPLACE with same signature keeps ACLs)
do $mig$
declare f text;
begin
  foreach f in array array[
    'public.lb_email_load_ingest(jsonb)',
    'public.lb_email_reply_merge(text,jsonb)',
    'public.lb_email_ping_confirm_by_email(text,jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end
$mig$;

-- 4. rollback helper (removes the guard line; does NOT re-grant) ----------------
create or replace function app_private.bl_sec_0320_rollback()
returns text
language plpgsql
security definer
set search_path to 'app_private, public'
as $fn$
declare r record; src text; done text := '';
        guard constant text := E'  if not app_private.lb_service_caller() then return jsonb_build_object(''error'',''forbidden'',''code'',''LB403''); end if; -- bl_sec_0320 guard\n';
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('lb_email_load_ingest','lb_email_reply_merge','lb_email_ping_confirm_by_email') loop
    src := pg_get_functiondef(r.oid);
    if position(guard in src) > 0 then
      execute replace(src, guard, '');
      done := done || r.proname || ' ';
    end if;
  end loop;
  return coalesce(nullif(done,''), 'nothing to roll back');
end $fn$;
revoke all on function app_private.bl_sec_0320_rollback() from public, anon, authenticated, service_role;

-- 5. ACL re-check (per house rule: every migration ends with one) ---------------
do $chk$
declare bad text;
begin
  select string_agg(routine_name||'←'||grantee, ', ') into bad
  from information_schema.routine_privileges
  where specific_schema='public'
    and routine_name in ('lb_email_load_ingest','lb_email_reply_merge','lb_email_ping_confirm_by_email')
    and grantee in ('anon','authenticated','PUBLIC');
  if bad is not null then raise exception 'bl_sec_0320: unexpected grants remain: %', bad; end if;
  raise notice 'bl_sec_0320: ACL ok — service_role only';
end
$chk$;
