-- bl_bp_0316b — signing the Master Broker Agreement online must not un-verify it.
--
-- The portal's sign flow calls cc_accept_agreement (→ bl_bp_0315 trigger marks `broker_agreement` VERIFIED) and
-- then cc_onboarding_submit_item('broker_agreement', ref, signer-json) to keep the executed-copy data on the row.
-- The second call reset status to 'submitted' and pinged staff for a document that was already proven.
-- Now: for a broker org that has accepted the current published broker_carrier agreement, submitting the
-- `broker_agreement` item keeps status = verified, stores ref/note, and skips the staff/partner "in review" notices.

create or replace function public.cc_onboarding_submit_item(p_key text, p_ref text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; v_kind text; v_name text; v_label text; v_auto boolean := false;
begin
  v_org := app_private.my_any_org();
  if v_org is null then raise exception 'account required' using errcode='42501'; end if;
  select kind, name into v_kind, v_name from public.organizations where id = v_org;
  if not exists (select 1 from app_private.onboarding_packet_templates where org_kind = v_kind and item_key = p_key) then
    raise exception 'unknown packet item for your account kind' using errcode='22023'; end if;
  if coalesce(trim(p_ref),'') = '' then raise exception 'a document reference / note is required' using errcode='22023'; end if;
  select label into v_label from app_private.onboarding_packet_templates where org_kind = v_kind and item_key = p_key limit 1;

  -- bl_bp_0316b: the one-click acceptance IS the signed agreement — keep it verified, just attach the executed-copy data
  if p_key = 'broker_agreement' and v_kind = 'broker' and exists (
       select 1 from app_private.org_agreement_acceptances x
        where x.org_id = v_org and x.kind = 'broker_carrier'
          and x.version = (select max(version) from app_private.master_agreements where kind = 'broker_carrier' and published)) then
    v_auto := true;
  end if;

  if v_auto then
    insert into app_private.org_onboarding_items(org_id, item_key, status, ref, note, submitted_by, submitted_at, reviewed_at)
      values (v_org, p_key, 'verified', trim(p_ref), p_note, auth.uid(), now(), now())
    on conflict (org_id, item_key) do update set status = 'verified', ref = trim(p_ref), note = p_note,
      submitted_by = auth.uid(), submitted_at = now(), reviewed_at = now(), lapsed_at = null;
    perform app_private.log_audit('onboarding.item_submitted','org',v_org::text,null,p_key || ' (auto-verified: agreement accepted online)',null);
    return jsonb_build_object('ok', true, 'key', p_key, 'status', 'verified');
  end if;

  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, note, submitted_by, submitted_at)
    values (v_org, p_key, 'submitted', trim(p_ref), p_note, auth.uid(), now())
  on conflict (org_id, item_key) do update set status = 'submitted', ref = trim(p_ref), note = p_note,
    submitted_by = auth.uid(), submitted_at = now(), reviewed_by = null, reviewed_at = null;
  insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
  values ('staff', 'in_app', 'onboarding.item_submitted',
    jsonb_build_object('title', 'Onboarding item submitted',
      'body', coalesce(v_name,'An account') || ' submitted: ' || coalesce(v_label, p_key),
      'tone', 'action', 'url', case when (select kind from public.organizations where id = v_org) = 'carrier' then '/app/command-center/#/compliance' else '/app/command-center/#/account-health' end),
    'sent', now());
  perform app_private.emit_event('onboarding.item_submitted', 'org', v_org::text, jsonb_build_object('item', p_key));
  perform app_private.log_audit('onboarding.item_submitted','org',v_org::text,null,p_key,null);
  perform app_private.notify_partner(v_org, '✓ Item received — in review', 'Our team reviews onboarding items within 1 business day. You will be notified of each decision here and by email.', 'info', '/app/partner/#onboarding');
  return jsonb_build_object('ok', true, 'key', p_key, 'status', 'submitted');
end; $$;
