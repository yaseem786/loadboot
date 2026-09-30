-- bl_ship_0507 — "Re-check domain" really re-checks, and a re-check never messages the shipper (30 Sep 2026).
--   Found while preparing the domain-check v6 re-run for MII / SoftBank / Sourcing Advisory:
--   1. shipper_business_start returned 'already' as soon as verified_at was set, so CC → Shipper 360 → "↻ Re-check domain"
--      (cc_shipper_trust_set 'recheck') did nothing for any verified shipper — the v6 signals could never be stored for them.
--      Now a staff re-check sets a transaction-local flag (app.shipper_recheck = org id) and business_start runs the check
--      even when verified. Every other caller (signup, portal) is unchanged: verified → 'already'.
--   2. shipper_check_collect sent the shipper a bell notice on every result ("✅ Company email checked — next, verify your
--      company", "We could not run the business check yet", "We could not confirm your business yet"). On a re-check of an
--      already-verified shipper that is a repeat, and on a HELD shipper (e.g. suspected impersonation) it tells them they
--      passed. Now those notices go only when verified_at was null AND there is no hold. The staff notice always goes, and
--      on a re-check / held shipper its title reads "🔁 Shipper re-check: <outcome> — <name>" instead of
--      "🟢 Shipper business confirmed", so staff never read a re-check as a confirmation.
--      business_start's free-mail notice follows the same rule.
--   verified_at is untouched (the collector already uses coalesce), so no shipper loses its tier on a re-check.
-- Anchor-patched: each anchor must be found exactly once or the file refuses. Idempotent (skips a function that already
-- carries the bl_ship_0507 marker). No new public function; the file raises if the anon SECURITY DEFINER names change.

drop table if exists pg_temp._bl0507_anon;
create temp table _bl0507_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

create or replace function pg_temp._bl0507_sub(d text, p_old text, p_new text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0507: anchor found % times — refusing: %', n, left(p_old, 80); end if;
  return replace(d, p_old, p_new);
end $$;

do $mig$
declare d text;
begin
  -- 1a. staff re-check flag
  d := pg_get_functiondef('public.cc_shipper_trust_set(uuid,text,text)'::regprocedure);
  if position('bl_ship_0507' in d) = 0 then
    d := pg_temp._bl0507_sub(d,
      $a$    perform app_private.shipper_business_start(p_org);$a$,
      $a$    perform set_config('app.shipper_recheck', p_org::text, true);  -- bl_ship_0507: staff re-check runs even when verified
    perform app_private.shipper_business_start(p_org);$a$);
    execute d;
  end if;

  -- 1b. business_start honours the flag; free-mail notice only for an unverified, unheld shipper
  d := pg_get_functiondef('app_private.shipper_business_start(uuid)'::regprocedure);
  if position('bl_ship_0507' in d) = 0 then
    d := pg_temp._bl0507_sub(d,
      $a$  if t.verified_at is not null then return jsonb_build_object('queued', false, 'outcome', 'pass', 'already', true); end if;$a$,
      $a$  if t.verified_at is not null and current_setting('app.shipper_recheck', true) is distinct from p_org::text then  -- bl_ship_0507
    return jsonb_build_object('queued', false, 'outcome', 'pass', 'already', true); end if;$a$);
    d := pg_temp._bl0507_sub(d,
      $a$    if t.check_outcome is distinct from 'free_mail' then$a$,
      $a$    if t.check_outcome is distinct from 'free_mail' and t.verified_at is null and t.hold_reason is null then$a$);
    execute d;
  end if;

  -- 2. collector: shipper notices only on a first check of an unheld shipper; staff title says "re-check"
  d := pg_get_functiondef('app_private.shipper_check_collect()'::regprocedure);
  if position('bl_ship_0507' in d) = 0 then
    d := pg_temp._bl0507_sub(d,
      $a$v_name text; v_by text;$a$,
      $a$v_name text; v_by text; v_tell boolean;  -- bl_ship_0507$a$);
    d := pg_temp._bl0507_sub(d,
      $a$    select name into v_name from public.organizations where id = r.org_id;$a$,
      $a$    select name into v_name from public.organizations where id = r.org_id;
    v_tell := r.verified_at is null and r.hold_reason is null;  -- bl_ship_0507: re-check / held shipper → staff only$a$);
    -- error notice
    d := pg_temp._bl0507_sub(d,
      $a$      perform app_private.notify_partner(r.org_id, 'We could not run the business check yet',$a$,
      $a$      if v_tell then perform app_private.notify_partner(r.org_id, 'We could not run the business check yet',$a$);
    d := pg_temp._bl0507_sub(d,
      $a$or our team confirms it by hand.', 'warning', '/app/partner/#onboarding');$a$,
      $a$or our team confirms it by hand.', 'warning', '/app/partner/#onboarding'); end if;$a$);
    -- pass notice
    d := pg_temp._bl0507_sub(d,
      $a$      perform app_private.notify_partner(r.org_id, '✅ Company email checked — next, verify your company',$a$,
      $a$      if v_tell then perform app_private.notify_partner(r.org_id, '✅ Company email checked — next, verify your company',$a$);
    d := pg_temp._bl0507_sub(d,
      $a$'success', '/app/partner/');$a$,
      $a$'success', '/app/partner/'); end if;$a$);
    -- no-mail notice
    d := pg_temp._bl0507_sub(d,
      $a$      perform app_private.notify_partner(r.org_id, 'We could not confirm your business yet',$a$,
      $a$      if v_tell then perform app_private.notify_partner(r.org_id, 'We could not confirm your business yet',$a$);
    d := pg_temp._bl0507_sub(d,
      $a$we will send it a code there.', 'warning', '/app/partner/#onboarding');$a$,
      $a$we will send it a code there.', 'warning', '/app/partner/#onboarding'); end if;$a$);
    -- staff title
    d := pg_temp._bl0507_sub(d,
      $a$case v_out when 'pass' then '🟢 Shipper business confirmed — ' else$a$,
      $a$case when not v_tell then '🔁 Shipper re-check: ' || v_out || ' — ' when v_out = 'pass' then '🟢 Shipper business confirmed — ' else$a$);
    execute d;
  end if;
end $mig$;

-- anon SECURITY DEFINER names must not move
do $$
declare v_added text; v_gone text;
begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from pg_temp._bl0507_anon) a;
  select string_agg(n, ', ') into v_gone from (
    select n from pg_temp._bl0507_anon
    except select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0507: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
