-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  STAGING ONLY (snslhvmkjusozgjelghi) — bl_train_0548 follow-up. Paste into the staging SQL Editor and Run.
--  The Supabase tool asks for confirmation on any DELETE/DROP text and times out, so this one is by hand.
--  ① creates app_private.training_wipe (training_reset calls it; it was never created on staging)
--  ② drops app_private.patch_fn — an inert helper left by bl_ops_0547 (its body only raises).
--  Body copied verbatim from migrations/bl_train_0548_carrier_training_sandbox.sql (§7). Never run on prod
--  by itself — prod gets training_wipe from the full 0548 migration.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function app_private.training_wipe(p_world uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare w app_private.training_worlds; v_loads uuid[]; v_trips uuid[]; n_l int; n_t int;
begin
  select * into w from app_private.training_worlds where id = p_world;
  if w.id is null then raise exception 'training: world % not found', p_world; end if;
  perform set_config('lb.training_ctx', 'on', true);
  select coalesce(array_agg(id), '{}') into v_loads from public.loads where broker_org = w.broker_org or shipper_org = w.broker_org;
  select coalesce(array_agg(id), '{}') into v_trips from app_private.trips where carrier_id = w.carrier_org or load_id = any(v_loads);
  delete from app_private.document_files where owner_type = 'trip' and owner_id = any(select unnest(v_trips)::text);
  delete from app_private.rate_confirmations where trip_id = any(v_trips);
  delete from app_private.fin_invoices where carrier_id = w.carrier_org or trip_id = any(v_trips) or load_id = any(v_loads);
  delete from app_private.fin_settlements where carrier_id = w.carrier_org;
  delete from public.settlements where load_id = any(v_loads);
  delete from app_private.dispatcher_bookings where carrier_org_id = w.carrier_org;
  delete from app_private.load_offers where carrier_id = w.carrier_org or load_id = any(v_loads);
  delete from app_private.load_book_requests where carrier_org = w.carrier_org or load_id = any(v_loads);
  delete from app_private.load_document_checklist where subject_id = any(v_loads) or subject_id = any(v_trips);
  delete from app_private.load_rate_agreements where subject_id = any(v_loads) or subject_id = any(v_trips);
  delete from app_private.trips where id = any(v_trips);
  get diagnostics n_t = row_count;
  delete from public.loads where id = any(v_loads);
  get diagnostics n_l = row_count;
  delete from app_private.notifications where recipient_user = w.carrier_user;
  -- the dispatcher thread restarts from the seeded messages (assignment itself is kept)
  delete from app_private.dispatcher_messages where carrier_org_id = w.carrier_org and sender_role <> 'system';
  return jsonb_build_object('loads_removed', n_l, 'trips_removed', n_t);
end $fn$;
revoke all on function app_private.training_wipe(uuid) from public, anon, authenticated;
drop function if exists app_private.patch_fn(text,text,text,text);

-- Check (expect: training_wipe present, patch_fn gone, anon surface still 35):
-- select (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--          where n.nspname='app_private' and p.proname in ('training_wipe','patch_fn')) as fns,
--        (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--          where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')) as anon_secdef;
