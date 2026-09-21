-- bl_disp_0366 — "carrier not found" when assigning a carrier from Dispatcher 360
--
-- Root cause (20 Sep 2026): the CC carrier picker is filled by cc_list_carriers, whose
-- first column is pr.id from public.profiles — the carrier USER's id, not the organization id.
-- Both dispatcher-360.js and dispatchers.js do  id: c.id || c.org_id || c.carrier_id,
-- so the <option> value is the profile id. cc_dispatcher_assign then looked that id up in
-- public.organizations, found nothing, and returned 'carrier not found'.
-- (GABE LOGISTICS LLC: profile b2903e26… vs organization f89c1bd0… — organizations.owner_user_id
--  equals profiles.id, so the two are always one hop apart.)
--
-- Fix is in the RPC, not the UI, so both CC screens work with no deploy: if p_carrier_org is
-- not an organization id, resolve it as the owner's user id. Everything the function writes
-- (assignment, thread, audit) now uses the RESOLVED organization id. A genuinely unknown id
-- still returns 'carrier not found'. Nothing else in the body changed.

CREATE OR REPLACE FUNCTION public.cc_dispatcher_assign(p_dispatcher uuid, p_carrier_org uuid, p_sop jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare v_id uuid; v_kind text; v_dstatus text; v_dname text; v_cname text; v_owner uuid;
        v_org uuid := p_carrier_org;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select kind, name, owner_user_id into v_kind, v_cname, v_owner from public.organizations where id = v_org;
  if v_kind is null then
    -- bl_disp_0366: the picker passed the carrier USER id (cc_list_carriers returns profiles.id) — resolve it
    select o.id, o.kind, o.name, o.owner_user_id into v_org, v_kind, v_cname, v_owner
      from public.organizations o where o.owner_user_id = p_carrier_org order by o.id limit 1;
  end if;
  if v_kind is null then return jsonb_build_object('error','carrier not found'); end if;
  select status, full_name into v_dstatus, v_dname from app_private.dispatcher_profiles where user_id = p_dispatcher;
  if v_dstatus is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if v_dstatus not in ('trial','verified','active') then return jsonb_build_object('error','dispatcher must be in trial, verified or active before assignment'); end if;
  begin
    insert into app_private.dispatcher_assignments (dispatcher_user_id, carrier_org_id, sop, assigned_by)
    values (p_dispatcher, v_org, coalesce(p_sop,'{}'::jsonb) - 'disp_read_at', auth.uid()) returning id into v_id;
  exception when unique_violation then return jsonb_build_object('error','this carrier already has an active dispatcher'); end;
  update app_private.dispatcher_profiles set status = 'active', updated_at = now() where user_id = p_dispatcher and status = 'verified';
  perform app_private.disp_notify(p_dispatcher, 'dispatcher', 'dispatcher.assigned', 'New carrier assigned: ' || coalesce(v_cname,'carrier'),
    'Open your workspace for the truck, the carrier''s rules (SOP) and the booking tools. First message in the shared thread should be yours.', '/app/agent/#dashboard', false);
  begin perform app_private.disp_assign_brief_email(v_id); exception when others then null; end;
  perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.assigned.carrier', 'Your LoadBoot dispatcher: ' || coalesce(v_dname,'assigned'),
    coalesce(v_dname,'Your dispatcher') || ' now finds and books loads under your MC. They can see your truck specs, driver names and phones, and your approved authority, COI, W-9 and NOA — never your bank details. Every load is approved by LoadBoot before your driver moves. Already assigned — there is nothing for you to confirm.', '/app/carrier/', false);
  begin
    perform app_private.sys_email((select email from auth.users where id = v_owner), 'dispatcher.assigned.carrier',
      'Meet ' || coalesce(v_dname,'your dispatcher') || ' — your LoadBoot dispatcher for ' || coalesce(v_cname,'your trucks'),
      app_private.disp_assign_email_html(v_id),
      coalesce(v_dname,'Your dispatcher') || ' is your dedicated LoadBoot dispatcher. Already assigned - nothing to confirm. Portal: https://loadboot.com/app/carrier/',
      'dispatcher.intro:' || v_id::text);
    update app_private.dispatcher_assignments set carrier_notified_at = now() where id = v_id;
  exception when others then null; end;
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
    values (v_id, v_org, 'system', 'Assignment created. This thread is shared by the dispatcher, the carrier and LoadBoot staff. Nothing moves until LoadBoot approves the rate confirmation.');
  perform app_private.disp_audit('dispatcher.assign', 'assignment', v_id::text, v_org, coalesce(v_dname,'dispatcher') || ' → ' || coalesce(v_cname,'carrier'), jsonb_build_object('sop', p_sop));
  return jsonb_build_object('ok', true, 'assignment', v_id);
end $function$;
