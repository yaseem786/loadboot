-- bl_agent_0209_payout_other_review.sql   (applied to production 2026-08-04)
--
-- Alternative ("Other") agent payout methods: a real review path.
--
-- Problem: an agent could pick "Other", type a provider name in a free-text box,
-- and there was NOWHERE to put the receiving-account details. The reviewer saw
-- "Revolut" plus an amber "do NOT pay" warning and only Verify / Reject -- no way
-- to ask for the IBAN, and no way to record that the rail itself was assessed.
-- Verifying blind or rejecting a legitimate agent were the only two options.
--
-- 0209 adds the two review RPCs. 0210 (separate file) makes the agent side able to
-- actually respond: payout_details now MERGES on save instead of being replaced,
-- and the portal gets the agent's own coordinates back so the form prefills.
--
-- Grants: authenticated only. Neither function is anon-executable
-- (anon SECURITY DEFINER count stays at 27).

-- ---------------------------------------------------------------- requester
create or replace function public.cc_agent_payout_request_details(
  p_user uuid, p_fields text[], p_note text default null)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public' as $fn$
declare v_email text; v_name text; v_list text; v_html text; v_f text;
begin
  if not (public.has_global_permission('finance.approve') or public.has_global_permission('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_fields is null or array_length(p_fields,1) is null then
    raise exception 'pick at least one detail to request' using errcode='22023';
  end if;

  select full_name into v_name from app_private.agent_profiles where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  select email into v_email from auth.users where id = p_user;

  update app_private.agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'payout_status', 'info_requested',
      'details_requested', jsonb_build_object(
        'by', auth.uid(), 'at', now(), 'fields', to_jsonb(p_fields), 'note', nullif(trim(coalesce(p_note,'')),''))),
    updated_at = now()
  where user_id = p_user;

  begin
    v_list := array_to_string(p_fields, ', ');
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_details_requested', jsonb_build_object(
      'title', 'We need a few payout details',
      'body', 'To approve your payout method we still need: ' || v_list || '. Add them in your Verification Center.',
      'tone', 'urgent', 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;

  begin
    if v_email is not null then
      v_html := '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ' || coalesce(v_name,'there') || ',</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Thanks for setting up your LoadBoot agent account. You chose a payout method outside our standard list, which is fine &mdash; we just need the full receiving-account details before we can approve it, so your first commission lands without a failed transfer.</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 8px;"><strong>Please add:</strong></p><ul style="font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:22px;">';
      foreach v_f in array p_fields loop
        v_html := v_html || '<li>' || v_f || '</li>';
      end loop;
      v_html := v_html || '</ul>';
      if nullif(trim(coalesce(p_note,'')),'') is not null then
        v_html := v_html || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;background:#f8fafc;border-left:3px solid #1d4ed8;padding:10px 14px;">' || p_note || '</p>';
      end if;
      v_html := v_html
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Everything must be in <strong>your own legal name</strong> &mdash; the same name as the ID you uploaded. Accounts in someone else&rsquo;s name cannot be paid.</p>'
        || '<p style="margin:0 0 16px;"><a href="https://loadboot.com/app/agent/#verify" style="display:inline-block;background:#1d4ed8;border-radius:8px;padding:12px 24px;text-decoration:none;"><span style="color:#ffffff !important;font-size:16px;font-weight:bold;">Add my payout details</span></a></p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Not sure where to find something? Just reply &mdash; a real person answers.</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0;">Riley<br>Agent Support, LoadBoot<br><a href="https://loadboot.com" style="color:#1d4ed8;"><span style="color:#1d4ed8 !important;">loadboot.com</span></a> &middot; +1 (469) 253-7575</p>';
      perform app_private.sys_email(v_email, 'agent.payout_details_requested',
        'A few payout details needed before we can approve your account', v_html, null,
        'agentpayoutreq:' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI'));
    end if;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'requested', to_jsonb(p_fields), 'emailed', v_email is not null);
end $fn$;

revoke all on function public.cc_agent_payout_request_details(uuid, text[], text) from public, anon;
grant execute on function public.cc_agent_payout_request_details(uuid, text[], text) to authenticated;

-- ------------------------------------------------------- method-approval gate
create or replace function public.cc_agent_payout_approve_method(
  p_user uuid, p_note text default null)
returns jsonb language plpgsql security definer
set search_path to 'app_private, public' as $fn$
declare v_method text; v_pd jsonb;
begin
  if not (public.has_global_permission('finance.approve') or public.has_global_permission('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  select payout_method, coalesce(payout_details,'{}'::jsonb) into v_method, v_pd
    from app_private.agent_profiles where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  if coalesce(v_method,'') <> 'other' then
    raise exception 'this agent is not on an alternative payout method' using errcode='22023';
  end if;

  -- Refuse to bless a rail we cannot actually send to. An approved method with
  -- no account number is how a payout run silently fails later.
  if coalesce(nullif(trim(coalesce(v_pd->>'iban','')),''), nullif(trim(coalesce(v_pd->>'account','')),'')) is null then
    raise exception 'add the IBAN / account number before approving this method' using errcode='22023';
  end if;
  if nullif(trim(coalesce(v_pd->>'account_title','')),'') is null then
    raise exception 'account title is required before approving this method' using errcode='22023';
  end if;

  update app_private.agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'other_approved', jsonb_build_object(
        'by', auth.uid(), 'at', now(),
        'label', coalesce(v_pd->>'other','alternative method'),
        'note', nullif(trim(coalesce(p_note,'')),''))),
    updated_at = now()
  where user_id = p_user;

  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_method_approved', jsonb_build_object(
      'title', 'Your payout method was approved',
      'body', coalesce(v_pd->>'other','Your requested method') || ' is approved for LoadBoot commission payouts.',
      'tone', 'success', 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'method', v_pd->>'other');
end $fn$;

revoke all on function public.cc_agent_payout_approve_method(uuid, text) from public, anon;
grant execute on function public.cc_agent_payout_approve_method(uuid, text) to authenticated;
