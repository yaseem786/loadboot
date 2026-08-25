-- bl_sec_0274 + bl_sec_0275 — applied 2026-08-25.
-- 0274: prod + staging.  0275: prod only (function does not exist on staging).
--
-- ---------------------------------------------------------------------------
-- bl_sec_0274 — public_loads view lockdown
-- ---------------------------------------------------------------------------
-- The view filtered on status='available' ONLY: no is_demo, is_public,
-- pickup_date or expires_at guard. It returned 10 rows on prod, every one a
-- demo load from "LoadBoot Demo Brokerage" with a pickup date 2+ weeks past.
-- Not leaking today — the view has no anon/authenticated grant, only postgres
-- and service_role — but any future grant would have put demo freight in front
-- of real carriers, breaking the demo-isolation invariant and putting ghost
-- loads on the board of a product whose whole pitch is that it has none.
--
-- Brought in line with cc_pocket_available_loads. is_demo is applied
-- conditionally because staging never received the bl_demo_02xx series and
-- staging.loads has no is_demo column (same pattern as bl_comm_0261c).

do $mig$
declare
  v_has_demo boolean;
  v_sql text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'loads' and column_name = 'is_demo'
  ) into v_has_demo;

  v_sql := $v$
    create or replace view public.public_loads as
      select id, origin, destination, equipment, commodity, weight, miles, deadhead,
             rate, pickup_date, pickup_time, delivery_date, delivery_time,
             requirements, created_at
        from public.loads
       where status = 'available'
         and coalesce(is_public, false) = true
         and (pickup_date is null or pickup_date >= current_date)
         and (expires_at is null or expires_at > now())
  $v$;

  if v_has_demo then
    v_sql := v_sql || ' and coalesce(is_demo, false) = false';
  end if;

  execute v_sql;
end
$mig$;

revoke all on public.public_loads from anon, authenticated;

comment on view public.public_loads is
  'Public teaser of available freight. Excludes unpublished, past-pickup and expired loads (and demo loads where the column exists). No anon/authenticated grant by design — bl_sec_0274.';


-- ---------------------------------------------------------------------------
-- bl_sec_0275 — revoke anon execute on cc_set_coi_limits
-- ---------------------------------------------------------------------------
-- cc_set_coi_limits is staff-only (it gates internally on
-- has_global_permission('documents.review')) but was anon-executable.
-- bl_sec_0266 revoked it; bl_coi_0270_cargo_coverage then recreated the
-- function, and CREATE OR REPLACE with a changed signature RESETS the ACL to
-- the default PUBLIC EXECUTE — silently undoing the earlier revoke.
--
-- Not exploitable: the internal guard rejects an anon caller. But it broke the
-- anon-executable SECURITY DEFINER invariant and removed a layer of defence.
--
-- NOTE: that invariant is documented as 27 in CLAUDE.md. Measured 29 on
-- 2026-08-25 before any change in this session; this migration takes it to 28.
-- One more still needs reconciling — see the session notes.

do $mig$
begin
  if to_regprocedure('public.cc_set_coi_limits(uuid,numeric,numeric,numeric,text,boolean,text)') is not null then
    revoke all on function public.cc_set_coi_limits(uuid,numeric,numeric,numeric,text,boolean,text) from anon, public;
  end if;
end
$mig$;
