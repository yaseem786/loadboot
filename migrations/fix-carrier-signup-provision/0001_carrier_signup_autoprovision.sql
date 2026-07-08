-- Fix: self-serve carrier signup did not create a carrier org + owner membership,
-- so app_private.my_carrier_org() returned NULL and the portal showed "No carrier account".
--
-- This extends handle_new_user() so a carrier signup ALSO provisions:
--   1) organizations (kind='carrier', name=company|email-localpart, owner_user_id=user, status='active')
--   2) organization_memberships (org_id, user_id, member_role='owner', status='active')
--
-- SAFETY: the org/membership creation is wrapped in a sub-block that swallows errors,
-- so it can NEVER fail the auth signup transaction (falls back to prior behavior).
-- Idempotent for re-runs of the migration (CREATE OR REPLACE). Verification/onboarding
-- state is still tracked via profiles.status='pending' + the CC verification flow.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  admin_exists boolean;
  v_role text;
  v_company text;
  v_org uuid;
begin
  select exists(select 1 from public.profiles where role='admin') into admin_exists;
  v_role    := case when admin_exists then 'carrier' else 'admin' end;
  v_company := coalesce(new.raw_user_meta_data->>'company','');

  insert into public.profiles (id, email, company, contact_name, role, status)
  values (new.id, new.email, v_company,
          coalesce(new.raw_user_meta_data->>'name',''),
          v_role,
          case when admin_exists then 'pending' else 'active' end);

  -- Self-serve carrier: provision the carrier org + owner membership so the portal loads.
  -- Non-blocking: never fail the signup on provisioning trouble.
  if v_role = 'carrier' then
    begin
      insert into public.organizations (kind, name, owner_user_id, status)
      values ('carrier',
              coalesce(nullif(trim(v_company), ''), split_part(new.email, '@', 1), 'New Carrier'),
              new.id, 'active')
      returning id into v_org;

      insert into public.organization_memberships (org_id, user_id, member_role, status)
      values (v_org, new.id, 'owner', 'active');
    exception when others then
      null; -- provisioning is best-effort; signup must still succeed
    end;
  end if;

  return new;
end;
$function$;

-- Backfill: carrier profiles that have NO active carrier-org membership (e.g. users who
-- signed up before this fix). Creates a carrier org + owner membership for each.
do $backfill$
declare r record; v_org uuid;
begin
  for r in
    select p.id, p.email, coalesce(nullif(trim(p.company), ''), split_part(p.email, '@', 1), 'New Carrier') as nm
    from public.profiles p
    where p.role = 'carrier'
      and not exists (
        select 1 from public.organization_memberships om
        join public.organizations o on o.id = om.org_id
        where om.user_id = p.id and om.status = 'active' and o.kind = 'carrier'
      )
  loop
    insert into public.organizations (kind, name, owner_user_id, status)
    values ('carrier', r.nm, r.id, 'active') returning id into v_org;
    insert into public.organization_memberships (org_id, user_id, member_role, status)
    values (v_org, r.id, 'owner', 'active');
  end loop;
end;
$backfill$;
