-- bl_bp_0315 — The verification packet stops asking for what FMCSA (or the broker's own click) already proved.
--
-- Yaseen, 4 Sep: "onboarding mein to abhi bhi 11–13 doc maang raha hai". Posting no longer waits on the packet
-- (bl_bp_0312), but the Documents tab still listed 10 broker items, four of which are exactly what the live FMCSA
-- screen already answered. Industry practice (DAT/Truckstop/Highway): never ask a broker to upload proof of a public
-- federal record you just read. After this migration the packet a broker actually has to touch is:
--   W-9 · bank/payment instructions · claims-handling contact   (+ COI when conditional, references optional)
-- and these fill themselves:
--   mc_authority  → verified by the FMCSA screening pass (L&I / SAFER, recheck 30 d)
--   bmc84_bond    → FMCSA keeps broker authority ACTIVE only while a BMC-84/85 is on file → same pass
--   boc3          → an authority cannot be granted without a BOC-3 on file → same pass
--   broker_agreement → the one-click Master Broker Agreement acceptance IS the signed agreement
--   ucr           → optional for brokers (no load board asks brokers for it; cannot be read from FMCSA)
-- Agents (no own MC) get the authority items filled on the PARENT's pass the same way — the packet is about the
-- authority they post under.

-- 0. staging never received bl_rev_0223 (packet revalidation); prod has these columns
alter table app_private.org_onboarding_items add column if not exists recheck_due date;
alter table app_private.org_onboarding_items add column if not exists lapsed_at timestamptz;

-- 1. UCR becomes optional for brokers (no longer gates 'verified')
update app_private.onboarding_packet_templates set status_tag = 'optional'
 where org_kind = 'broker' and item_key = 'ucr' and status_tag <> 'optional';

-- 2. autofill from an FMCSA pass
create or replace function app_private.packet_autofill_from_fmcsa(p_org uuid)
returns int language plpgsql security definer set search_path to 'app_private, public' as $$
declare s app_private.broker_screenings; v_n int := 0; v_note text; k text;
begin
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null or s.outcome <> 'pass' then return 0; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'broker') then return 0; end if;
  v_note := 'Verified live on FMCSA ' || to_char(coalesce(s.checked_at, now()), 'YYYY-MM-DD') || ' — MC-' || coalesce(s.mc_number,'?')
            || coalesce(' ' || s.legal_name, '') || ' · broker authority ACTIVE (' || coalesce(s.authority_source,'fmcsa') || ')'
            || case when s.authority_source = 'staff' then ' · confirmed by staff' else '' end;
  foreach k in array array['mc_authority','bmc84_bond','boc3'] loop
    insert into app_private.org_onboarding_items(org_id, item_key, status, note, reviewed_at, submitted_at, recheck_due)
    values (p_org, k, 'verified', v_note, now(), now(), current_date + 30)
    on conflict (org_id, item_key) do update
      set status = 'verified', note = v_note, reviewed_at = now(), recheck_due = current_date + 30, lapsed_at = null
      where app_private.org_onboarding_items.status not in ('verified','waived');
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- 3. the one-click Master Broker Agreement satisfies the "Signed Broker Agreement" item
create or replace function app_private.trg_agreement_fills_packet()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if NEW.kind = 'broker_carrier' and exists (select 1 from public.organizations where id = NEW.org_id and kind = 'broker') then
    insert into app_private.org_onboarding_items(org_id, item_key, status, note, reviewed_at, submitted_at, submitted_by)
    values (NEW.org_id, 'broker_agreement', 'verified', 'Master Broker Agreement v' || coalesce(NEW.version::text,'?') || ' accepted online ' || to_char(coalesce(NEW.accepted_at, now()),'YYYY-MM-DD HH24:MI') || ' (recorded with server timestamp)', now(), now(), NEW.accepted_by)
    on conflict (org_id, item_key) do update
      set status = 'verified', note = excluded.note, reviewed_at = now(), lapsed_at = null
      where app_private.org_onboarding_items.status not in ('verified','waived');
  end if;
  return NEW;
end $$;
drop trigger if exists trg_agreement_fills_packet on app_private.org_agreement_acceptances;
create trigger trg_agreement_fills_packet after insert on app_private.org_agreement_acceptances
  for each row execute function app_private.trg_agreement_fills_packet();

-- 4. hook the autofill into the collector (every PASS) and the CC pass-by-hand
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='broker_screen_collect';
  if v_def is null then raise exception 'broker_screen_collect missing'; end if;
  if position('packet_autofill_from_fmcsa' in v_def) > 0 then raise notice 'collector already patched'; return; end if;
  v_old := $q$    if v_out = 'pass' then
      v_pass := v_pass + 1;$q$;
  v_new := $q$    if v_out = 'pass' then
      v_pass := v_pass + 1;
      perform app_private.packet_autofill_from_fmcsa(r.org_id);  -- bl_bp_0315$q$;
  if position(v_old in v_def) = 0 then raise exception 'broker_screen_collect: pass anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_broker_trust_set';
  if v_def is null then raise exception 'cc_broker_trust_set missing'; end if;
  if position('packet_autofill_from_fmcsa' in v_def) > 0 then raise notice 'cc_broker_trust_set already patched'; return; end if;
  v_old := $q$    select * into t from app_private.broker_trust where org_id = p_org;
    if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then perform app_private.broker_parent_confirm_send(p_org);$q$;
  v_new := $q$    perform app_private.packet_autofill_from_fmcsa(p_org);  -- bl_bp_0315
    select * into t from app_private.broker_trust where org_id = p_org;
    if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then perform app_private.broker_parent_confirm_send(p_org);$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_broker_trust_set: pass anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 5. backfill: anyone already screened / already agreed
select app_private.packet_autofill_from_fmcsa(org_id) from app_private.broker_screenings where outcome = 'pass';
insert into app_private.org_onboarding_items(org_id, item_key, status, note, reviewed_at, submitted_at, submitted_by)
select a.org_id, 'broker_agreement', 'verified', 'Master Broker Agreement v' || a.version || ' accepted online ' || to_char(a.accepted_at,'YYYY-MM-DD HH24:MI'), now(), a.accepted_at, a.accepted_by
  from app_private.org_agreement_acceptances a join public.organizations o on o.id = a.org_id
 where a.kind = 'broker_carrier' and o.kind = 'broker'
on conflict (org_id, item_key) do update set status = 'verified', note = excluded.note, reviewed_at = now(), lapsed_at = null
 where app_private.org_onboarding_items.status not in ('verified','waived');
