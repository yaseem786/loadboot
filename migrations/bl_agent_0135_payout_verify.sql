-- bl_agent_0135 — Agent payout/bank verification (parity with carrier cc_verify_payment_profile).
-- Adds cc_agent_payout_verify(user, ok, reason): finance/carriers approver sets the agent's
-- payout method as verified/rejected (stored in agent_profiles.payout_details.payout_status),
-- notifies the agent in-app, and emails them on rejection so they can correct & resubmit.
-- Applied to STAGING (snslhvmkjusozgjelghi). PROD after owner confirmation.
create or replace function public.cc_agent_payout_verify(p_user uuid, p_ok boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_email text;
begin
  if not (public.has_global_permission('finance.approve') or public.has_global_permission('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if not p_ok and coalesce(trim(p_reason),'') = '' then
    raise exception 'rejection reason required' using errcode='22023';
  end if;
  update app_private.agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'payout_status', case when p_ok then 'verified' else 'rejected' end,
      'payout_reason', p_reason, 'payout_reviewed_at', now()),
    updated_at = now()
  where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_review', jsonb_build_object(
      'title', case when p_ok then 'Payout details verified' else 'Payout details need a fix' end,
      'body', coalesce(p_reason, case when p_ok then 'Your payout method is verified.' else 'Please correct your payout details.' end),
      'tone', case when p_ok then 'success' else 'urgent' end, 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;
  if not p_ok then
    begin
      select email into v_email from auth.users where id = p_user;
      if v_email is not null then
        perform app_private.sys_email(v_email, 'agent.payout_review', 'Payout details need a correction',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>Your payout details need a correction</h2><p><b>Reason:</b> ' || p_reason || '</p><p>Open your Verification Center and update your payout method.</p></div>',
          null, 'agentpayout:' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI'));
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'verified', p_ok);
end $$;
grant execute on function public.cc_agent_payout_verify(uuid, boolean, text) to authenticated;
