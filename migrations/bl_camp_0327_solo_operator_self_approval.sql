-- bl_camp_0327_solo_operator_self_approval.sql
-- Applied: staging 6 Sep 2026, production 6 Sep 2026.
--
-- cc_campaign_approve refused self-approval (separation of duties), and production has exactly
-- ONE active staff member with comms permission — so no campaign could ever be approved, and
-- nothing could ever be sent. Yaseen chose to scope the control rather than delete it.
--
-- Maker-checker is unchanged whenever a second approver exists. The only change: when there is
-- exactly one active staff member who can manage comms, there is no second pair of eyes to ask
-- for, so that lone operator may approve their own campaign — and the approval is recorded as a
-- DIFFERENT audit action ('campaign.approve.solo') carrying an explicit note that nobody else
-- reviewed the send. The strict two-person rule returns BY ITSELF the moment a second approver is
-- granted content.manage or settings.manage; there is nothing to remember to undo.
--
-- Staging-verified both branches: with 4 approvers self-approval was still refused; with 1 it
-- succeeded, returned solo_self_approval:true and wrote campaign.approve.solo to audit_logs.

create or replace function app_private.user_can_manage_comms(p_user uuid)
returns boolean
language sql stable security definer
set search_path to 'app_private, public'
as $function$
  -- Mirrors public.has_global_permission() for an arbitrary user instead of auth.uid():
  -- active staff, an explicit deny beats everything, otherwise a global role grant or a
  -- direct allow grant on either comms permission.
  select exists (select 1 from app_private.staff_members s where s.user_id = p_user and s.status = 'active')
     and exists (
       select 1 from unnest(array['content.manage','settings.manage']) k(perm)
        where not exists (select 1 from app_private.user_permission_grants g
                           where g.user_id = p_user and g.permission_key = k.perm and g.effect = 'deny')
          and (exists (select 1 from app_private.user_role_assignments a
                        join app_private.role_permissions rp on rp.role_id = a.role_id
                        join app_private.permissions pm on pm.id = rp.permission_id
                       where a.user_id = p_user and a.status = 'active'
                         and (a.expires_at is null or a.expires_at > now())
                         and a.scope_type = 'global' and pm.key = k.perm)
            or exists (select 1 from app_private.user_permission_grants g
                        where g.user_id = p_user and g.permission_key = k.perm and g.effect = 'allow'))
     );
$function$;

revoke all on function app_private.user_can_manage_comms(uuid) from public;

create or replace function app_private.comms_approver_count()
returns int
language sql stable security definer
set search_path to 'app_private, public'
as $function$
  select count(*)::int from app_private.staff_members s
   where s.status = 'active' and app_private.user_can_manage_comms(s.user_id);
$function$;

revoke all on function app_private.comms_approver_count() from public;

create or replace function public.cc_campaign_approve(p_campaign uuid, p_approve boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare c record; v_uid uuid; v_approvers int; v_solo boolean := false;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  v_uid := auth.uid();
  select * into c from app_private.campaigns where id = p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  if p_approve then
    if c.created_by is not null and c.created_by = v_uid then
      v_approvers := app_private.comms_approver_count();
      if v_approvers > 1 then
        raise exception 'maker-checker: the campaign creator cannot approve their own campaign' using errcode='42501';
      end if;
      v_solo := true;
    end if;
    update app_private.campaigns set approved_by = v_uid, approved_at = now(), updated_at = now() where id = p_campaign;
    if v_solo then
      perform app_private.log_audit('campaign.approve.solo','campaign',p_campaign::text,null,
        'SOLO SELF-APPROVAL — this account is the only active staff member who can manage comms, so no second person reviewed this send',
        jsonb_build_object('approver', v_uid, 'comms_approvers', v_approvers, 'campaign_name', c.name));
    else
      perform app_private.log_audit('campaign.approve','campaign',p_campaign::text,null,'campaign approved for send',null);
    end if;
  else
    update app_private.campaigns set approved_by = null, approved_at = null, updated_at = now() where id = p_campaign;
    perform app_private.log_audit('campaign.unapprove','campaign',p_campaign::text,null,'campaign approval revoked',null);
  end if;
  return jsonb_build_object('approved', p_approve, 'approved_by', case when p_approve then v_uid else null end, 'solo_self_approval', v_solo);
end; $function$;
