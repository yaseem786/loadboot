-- bl_trip_0563 (22 Oct 2026) — owner decision: the internal sandbox (demo orgs, organizations.is_demo, staff-set) can
-- create trips without a licensed fleet driver, so CC can approve the sandbox RC end to end. Same carve-out as
-- carrier_mandatory_ok in bl_trip_0560. Real carriers unchanged.
create or replace function app_private.carrier_has_valid_driver(p_org uuid)
returns boolean language sql stable security definer
set search_path to 'app_private', 'public'
as $function$
  select coalesce((select o.is_demo from public.organizations o where o.id = p_org), false)
  or exists (
    select 1 from app_private.fleet_drivers d
     where d.carrier_id = p_org and coalesce(d.status,'active') = 'active'
       and (d.license_exp is null or d.license_exp >= current_date)
       and (d.medical_exp is null or d.medical_exp >= current_date));
$function$;
