-- bl_onb_0541 — item Q: carrier auto-activation reads the compliance truth, not documents rows (owner, 12 Oct 2026)
--
-- Problem (prod, read-only 12 Oct): refresh_carrier_status counted approved public.documents of type
-- insurance/w9/authority. An e-signed W-9 lives only in app_private.carrier_compliance (no documents row), so:
--   * 4 carriers staff had APPROVED in onboarding stayed profiles.status='pending' (T Strick, MEDO, The Way Home,
--     Blessed Road Runner) — they got the "approved" email but the portal still treats them as pending;
--   * 5 ACTIVE carriers (Warren's, Munster, Sprint Shift, EZHaul, Pick N Nett) have no approved W-9 document, so
--     the next document insert/update for them (trg_document_change → refresh) would have DEMOTED them to pending.
--
-- New rule (owner approved 12 Oct):
--   ACTIVATE  when profiles.status='pending' AND the carrier org has VALID, unexpired carrier_compliance rows for
--             mc_authority + insurance_coi + w9 + dispatch_agreement AND staff approved onboarding
--             (carrier_onboarding.stage='approved' — every real active carrier on prod has it; a carrier staff has
--             not approved is never activated by the system).
--   NEVER DEMOTE. This function only promotes pending → active. 'paused' and 'active' are never touched.
--             Expiry is handled by its own warning ladder / gates, not by flipping the account status.
-- Re-checked whenever documents change (existing trg_document_change on prod), a compliance row's status/expiry
-- changes, or onboarding is decided.
--
-- Notifications: none. Status activation never sent anything (no trigger on profiles.status; the approval email
-- 'onboarding.decided' is sent by cc_decide_onboarding and is untouched). The backfill below therefore sends nothing
-- and nothing is doubled.
-- Security: refresh_carrier_status keeps its ACL (postgres + service_role only); the new trigger function lives in
-- app_private and is revoked from public/anon/authenticated. anon SECDEF surface unchanged (36 prod / 35 staging).
-- Staging 12 Oct: applied in 4 parts (bl_onb_0541a..d); 7 rollback tests passed (w9 pending→stays pending,
-- w9 valid→trigger activates, onboarding not approved→stays pending, approve→trigger activates, active carrier with
-- 1 of 4 not demoted, paused untouched, expired COI blocks). Backfill activated the one staging case.

create or replace function public.refresh_carrier_status(p_carrier uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
-- p_carrier = the carrier's profile id (= organizations.owner_user_id, = documents.carrier_id).
-- Promote-only since bl_onb_0541: never demotes.
begin
  update public.profiles p set status = 'active'
   where p.id = p_carrier
     and p.role = 'carrier'
     and p.status = 'pending'
     and exists (
       select 1
         from public.organizations o
         join app_private.carrier_onboarding ob on ob.carrier_id = o.id and ob.stage = 'approved'
        where o.owner_user_id = p.id
          and o.kind::text = 'carrier'
          and (select count(distinct cc.requirement_key)
                 from app_private.carrier_compliance cc
                where cc.carrier_id = o.id
                  and cc.requirement_key in ('mc_authority','insurance_coi','w9','dispatch_agreement')
                  and cc.status = 'valid'
                  and (cc.expiry_date is null or cc.expiry_date >= current_date)) = 4);
end; $function$;

-- One trigger function for both org-keyed tables (carrier_compliance.carrier_id and carrier_onboarding.carrier_id
-- are organization ids).
create or replace function app_private.tg_refresh_carrier_status_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_owner uuid;
begin
  select o.owner_user_id into v_owner from public.organizations o where o.id = new.carrier_id;
  if v_owner is not null then
    perform public.refresh_carrier_status(v_owner);
  end if;
  return null;
end; $function$;

revoke execute on function app_private.tg_refresh_carrier_status_org() from public, anon, authenticated;

-- Guarded create instead of a drop-if-exists: the Supabase MCP hangs 60 s on the literal drop-trigger statement
-- text (same quirk as the delete-from one, see bl_fill_0535c). Re-running this file is a no-op.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_compliance_refresh_status'
                  and tgrelid = 'app_private.carrier_compliance'::regclass) then
    create trigger trg_compliance_refresh_status
      after insert or update of status, expiry_date on app_private.carrier_compliance
      for each row when (new.status = 'valid')
      execute function app_private.tg_refresh_carrier_status_org();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_onboarding_refresh_status'
                  and tgrelid = 'app_private.carrier_onboarding'::regclass) then
    create trigger trg_onboarding_refresh_status
      after insert or update of stage on app_private.carrier_onboarding
      for each row when (new.stage = 'approved')
      execute function app_private.tg_refresh_carrier_status_org();
  end if;
end $$;

-- Backfill: every pending carrier goes through the same function (only those meeting the rule move).
do $$
declare r record;
begin
  for r in select id from public.profiles where role = 'carrier' and status = 'pending' loop
    perform public.refresh_carrier_status(r.id);
  end loop;
end $$;
