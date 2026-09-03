-- bl_bp_0312c — partner signup was treated as a CARRIER signup (found 2 Sep by Yaseen's own test).
--
-- Symptoms: a broker who signs up gets the "let's get you loaded" CARRIER welcome email, a
-- phantom CARRIER organization is created for them, and app_private.my_any_org() then prefers
-- that phantom org — so cc_accept_agreement / cc_my_onboarding_packet / cc_onboarding_submit_item
-- for a broker land on the wrong org. On prod 5 broker/shipper owners carry such a phantom org.
-- This is also the likeliest reason our own agents' packets never counted as verified.
--
-- Fix (additive, no data deleted):
--   1. handle_new_user: no carrier org when raw_user_meta_data.partner_kind is broker/shipper/facility
--   2. send_welcome_email: skip the carrier welcome + carrier-signup notices for partner signups
--      (the correct partner welcome is sent by trg_partner_org_welcome when the org is registered)
--   3. my_any_org(): partner-first for partner_kind users; carrier-first for everyone else
-- Phantom carrier orgs already created are left in place (never delete accounts); with (3) they
-- no longer shadow the partner org.

create or replace function app_private.is_partner_signup(p_user uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $$
  select coalesce((select raw_user_meta_data->>'partner_kind' from auth.users where id = p_user) in ('broker','shipper','facility'), false);
$$;
revoke all on function app_private.is_partner_signup(uuid) from public, anon;

-- 1. handle_new_user — string surgery on the live definition (exact anchor or abort)
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'handle_new_user';
  if v_def is null then raise exception 'handle_new_user missing'; end if;
  if position('partner_kind' in v_def) > 0 then raise notice 'handle_new_user already patched'; return; end if;
  v_old := $q$  if v_role = 'carrier' and coalesce(new.raw_user_meta_data->>'role','') not in ('driver','agent') then$q$;
  v_new := $q$  -- bl_bp_0312c: a broker/shipper/facility signup must NOT get a carrier organization
  if v_role = 'carrier' and coalesce(new.raw_user_meta_data->>'role','') not in ('driver','agent')
     and coalesce(new.raw_user_meta_data->>'partner_kind','') not in ('broker','shipper','facility') then$q$;
  if position(v_old in v_def) = 0 then raise exception 'handle_new_user: anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 2. send_welcome_email — early return for partner signups
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname = 'send_welcome_email';
  if v_def is null then raise exception 'send_welcome_email missing'; end if;
  if position('is_partner_signup' in v_def) > 0 then raise notice 'send_welcome_email already patched'; return; end if;
  v_old := $q$  if new.role is distinct from 'carrier' or coalesce(new.email,'') = '' then return new; end if;$q$;
  v_new := $q$  if new.role is distinct from 'carrier' or coalesce(new.email,'') = '' then return new; end if;
  -- bl_bp_0312c: brokers/shippers/facilities get their welcome from trg_partner_org_welcome, not the carrier one
  if app_private.is_partner_signup(new.id) then return new; end if;$q$;
  if position(v_old in v_def) = 0 then raise exception 'send_welcome_email: anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 3. my_any_org — partner-first for partner signups
create or replace function app_private.my_any_org()
returns uuid language sql stable security definer set search_path to 'app_private, public' as $$
  select case when app_private.is_partner_signup(auth.uid())
    then coalesce(app_private.my_partner_org('broker'), app_private.my_partner_org('shipper'), app_private.my_carrier_org())
    else coalesce(app_private.my_carrier_org(), app_private.my_partner_org('broker'), app_private.my_partner_org('shipper')) end;
$$;
