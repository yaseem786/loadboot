-- bl_agent_0144 — Agents are referral partners only (no freight posting), so approving an
-- agent must NOT create an own_broker_org. Removes the broker-org creation +
-- agent_org_waive_packet call from cc_agent_decide, and drops the "you can POST LOADS
-- yourself" line from the approval email. Existing agent orgs are left as-is (harmless;
-- bl_fix_0143 already stops them creating partner-review tasks). Additive & reversible.
-- Applied to STAGING then PROD.
create or replace function public.cc_agent_decide(p_user uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_email text; v_name text;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_action not in ('approve','reject','info') then raise exception 'action must be approve, reject or info' using errcode='22023'; end if;
  update app_private.agent_profiles set
    status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'info_needed' end,
    review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  update app_private.referrers set status = case when p_action = 'approve' then 'active' else 'pending' end
   where user_id = p_user;
  select u.email, coalesce(ap.full_name, split_part(u.email,'@',1)) into v_email, v_name
    from auth.users u left join app_private.agent_profiles ap on ap.user_id = u.id where u.id = p_user;
  -- Agents are referral partners only — no broker org, no packet waiver.
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.decision', jsonb_build_object(
      'title', case p_action when 'approve' then '🎉 You are APPROVED — start earning 1%' when 'reject' then 'Your referral application was not approved' else 'We need more info on your application' end,
      'body', coalesce(p_note,''), 'tone', case p_action when 'approve' then 'success' else 'warning' end, 'url', '/app/agent/'), 'sent', now());
  exception when others then null; end;
  begin
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.decision',
        case p_action when 'approve' then '🎉 LoadBoot Referral Partner: APPROVED' when 'reject' then 'LoadBoot referral application update' else 'LoadBoot: one more thing needed' end,
        '<div style="font-family:Inter,Arial,sans-serif"><h2>' ||
        case p_action when 'approve' then 'Welcome aboard, ' || v_name || ' — you earn 1% from today'
          when 'reject' then 'Application not approved' else 'We need a bit more information' end || '</h2><p>' || coalesce(p_note,'') || '</p>'
        || case when p_action='approve' then '<p><a href="https://loadboot.com/app/agent/" style="background:#16a34a;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open your dashboard &rarr;</a></p>' else '' end
        || '</div>', null, 'agentdecision:' || p_user::text || ':' || p_action);
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'action', p_action);
end; $function$;
