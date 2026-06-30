-- cc_v1_0031 — staging-only Owner provisioning. Idempotent. Promotes ONE real Auth UID
-- (already signed in, so a profile exists) to an active internal-org Owner. HARD-rejects
-- production via migration-ledger identity. Returns a sanitized result; never echoes the
-- UID. Safe to run repeatedly. EXECUTE revoked from all API roles (owner/service runs it).
create or replace function app_private.provision_staging_owner(p_uid uuid)
 returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare io uuid; owner_role uuid; n_owner int;
begin
  -- (1) HARD environment guard: this reviewed series exists ONLY on staging; the
  --     production core migration must be ABSENT. Double-sided assertion.
  if not exists (select 1 from supabase_migrations.schema_migrations where name='cc_v1_0015_organizations_and_rbac') then
    raise exception 'REFUSING: not the LoadBoot staging project (cc_v1 series absent)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where name='quickfreights_portal_core') then
    raise exception 'REFUSING: production marker detected — staging-only provisioning';
  end if;
  -- (2) the user must already have signed in (handle_new_user created their profile)
  if not exists (select 1 from public.profiles where id = p_uid) then
    raise exception 'No profile for that UID yet — sign in to the Command Center once first, then re-run.' using errcode='22023';
  end if;
  -- (3) active internal org
  select id into io from public.organizations where kind='internal' and status='active' limit 1;
  if io is null then raise exception 'no active internal organization'; end if;
  -- (4) idempotent staff membership + staff_members + global Owner role
  insert into public.organization_memberships(org_id,user_id,member_role,status)
    values (io, p_uid, 'staff','active')
    on conflict (org_id,user_id) do update set member_role='staff', status='active';
  insert into app_private.staff_members(user_id,status) values (p_uid,'active')
    on conflict (user_id) do update set status='active';
  select id into owner_role from app_private.roles where key='owner';
  insert into app_private.user_role_assignments(user_id,role_id,scope_type,status,granted_by)
    values (p_uid, owner_role, 'global','active', p_uid)
    on conflict (user_id, role_id, scope_type, org_id, carrier_org_id, load_id)
    do update set status='active', expires_at=null;
  -- (5) last-Owner invariant preserved by construction: this only ADDS an owner.
  n_owner := app_private.effective_owner_count();
  -- (6) sanitized result — NEVER echo the UID
  return jsonb_build_object('ok', true, 'is_staff', true, 'is_owner', app_private.is_effective_owner(p_uid),
                            'effective_owner_count', n_owner, 'environment', 'staging');
end; $function$;
revoke all on function app_private.provision_staging_owner(uuid) from public, anon, authenticated;
