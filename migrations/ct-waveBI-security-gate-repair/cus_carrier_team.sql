-- cus_carrier_team.sql
-- Carrier team visibility + owner-only management of EXISTING members (Carrier Portal "Account -> Team").
-- Any active member can VIEW the team; only the org OWNER can change a member's role/status.
-- Guardrails (no privilege escalation): cannot modify self, cannot modify the owner, role limited to
-- manager/driver (never 'staff' or 'owner'), status limited to active/suspended, target must be same org.
-- Email invites for NEW users are deferred (they require an auth signup flow) — tracked in PENDING.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_team()
returns table(user_id uuid, name text, email text, phone text, member_role text, status text, is_owner boolean, is_me boolean)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query
    select om.user_id, p.contact_name, p.email, p.phone, om.member_role, om.status,
           (om.member_role='owner'), (om.user_id=auth.uid())
    from public.organization_memberships om
    left join public.profiles p on p.id=om.user_id
    where om.org_id=v_org
    order by (om.member_role='owner') desc, om.created_at;
end; $$;
revoke execute on function public.cc_pocket_team() from anon, public;
grant  execute on function public.cc_pocket_team() to authenticated;

create or replace function public.cc_pocket_set_member(p_user uuid, p_role text default null, p_status text default null)
returns void
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_is_owner boolean; v_target_role text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select exists(select 1 from public.organization_memberships where org_id=v_org and user_id=auth.uid() and member_role='owner' and status='active') into v_is_owner;
  if not v_is_owner then raise exception 'only the account owner can manage the team' using errcode='42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own membership' using errcode='22023'; end if;
  select member_role into v_target_role from public.organization_memberships where org_id=v_org and user_id=p_user;
  if v_target_role is null then raise exception 'member not found in your account' using errcode='42501'; end if;
  if v_target_role='owner' then raise exception 'the owner cannot be modified' using errcode='22023'; end if;
  if p_role is not null then
    if p_role not in ('manager','driver') then raise exception 'role must be manager or driver' using errcode='22023'; end if;
    update public.organization_memberships set member_role=p_role, updated_at=now() where org_id=v_org and user_id=p_user;
  end if;
  if p_status is not null then
    if p_status not in ('active','suspended') then raise exception 'status must be active or suspended' using errcode='22023'; end if;
    update public.organization_memberships set status=p_status, updated_at=now() where org_id=v_org and user_id=p_user;
  end if;
  perform app_private.log_audit('carrier.team.update','organization_membership',p_user::text,v_org,coalesce(p_role,'-')||'/'||coalesce(p_status,'-'),'{}'::jsonb);
end; $$;
revoke execute on function public.cc_pocket_set_member(uuid,text,text) from anon, public;
grant  execute on function public.cc_pocket_set_member(uuid,text,text) to authenticated;
