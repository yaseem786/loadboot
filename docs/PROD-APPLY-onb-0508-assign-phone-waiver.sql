-- bl_onb_0508 — staff waiver for the "carrier must verify phone before a dispatcher is assigned" gate (bl_onb_0490).
-- The waiver ONLY lets cc_dispatcher_assign proceed. It records NO phone verification: carrier_phone_verified() is
-- untouched, so the carrier's "Verify your phone number" card stays and the carrier still verifies by himself.
create table if not exists app_private.carrier_assign_phone_waivers (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  waived_by  uuid not null,
  reason     text not null,
  waived_at  timestamptz not null default now()
);
revoke all on app_private.carrier_assign_phone_waivers from public, anon, authenticated;

do $mig$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_dispatcher_assign';
  if v_def is null then raise exception 'cc_dispatcher_assign not found'; end if;
  if position('carrier_assign_phone_waivers' in v_def) > 0 then return; end if;
  v_new := replace(v_def,
    'if app_private.carrier_phone_required(v_org) and not app_private.carrier_phone_verified(v_org) then',
    'if app_private.carrier_phone_required(v_org) and not app_private.carrier_phone_verified(v_org)
     and not exists (select 1 from app_private.carrier_assign_phone_waivers w where w.org_id = v_org) then  -- bl_onb_0508');
  if v_new = v_def then raise exception 'phone gate line not found in cc_dispatcher_assign'; end if;
  execute v_new;
end $mig$;
