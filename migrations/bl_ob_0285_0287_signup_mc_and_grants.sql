-- bl_sec_0285 + bl_ob_0286 + bl_sec_0287 — applied to PROD 2026-08-25.
--
-- ===========================================================================
-- bl_sec_0285 — revoke anon on three server-only email RPCs
-- ===========================================================================
-- All three are reached ONLY by the load-mail edge function, which calls them
-- with the service-role key (inbound-mail -> load-mail -> RPC). Zero hits in
-- build_site.py and zero in the app tree. The anon grant bought nothing:
--   lb_email_load_ingest           anon could create email_brokers/email_loads
--                                  rows AND make LoadBoot send mail to any
--                                  address it names (sender-reputation abuse)
--   lb_email_reply_merge           keyed on p_from_email, not a token — anon
--                                  could merge fields into someone else's load
--   lb_email_ping_confirm_by_email same shape, confirms/declines a booking hold
--
-- NOT touched: lb_email_claim_get / _sign / lb_email_ping_get / _confirm.
-- Those take an unguessable token and ARE called from the public broker-claim
-- page with the anon key.
--
-- Rollback if inbound mail breaks: grant execute back on the one that broke,
-- then test with a real message to loads@loadboot.com.
do $mig$
declare r text;
begin
  foreach r in array array[
    'public.lb_email_load_ingest(jsonb)',
    'public.lb_email_reply_merge(text,jsonb)',
    'public.lb_email_ping_confirm_by_email(text,jsonb)'
  ] loop
    if to_regprocedure(r) is not null then
      execute format('revoke all on function %s from anon, public', r);
    end if;
  end loop;
end
$mig$;

-- ===========================================================================
-- bl_ob_0286 — capture the broker's MC number at registration
-- ===========================================================================
-- Every broker page promises we verify "broker authority and the federal surety
-- bond" before posting unlocks. The signup never asked for an MC. Result: not
-- one broker or shipper org on prod had mc_number set, and when TAB LLC sat
-- pending 22 days there was nothing to verify them against — no MC, no DOT, no
-- profile. The gate we advertise did not exist.
--
-- p_mc is OPTIONAL at the database level on purpose. The partner portal is a
-- PWA with a service worker, so cached older bundles keep calling the 2-arg form
-- after deploy; hard-requiring it here would break broker signup for anyone on a
-- stale bundle. The UI makes it required. Once the new bundle has rolled out,
-- tighten to: if p_kind = 'broker' and v_mc is null then raise ...
--
-- Format follows bl_ob_0240: 1-8 digits, stored digits-only, so "MC-123456",
-- "mc 123456" and "123456" all normalise to the same value.
create or replace function public.cc_partner_register(p_kind text, p_company text, p_mc text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_org uuid;
  v_mc  text;
begin
  if p_kind not in ('broker','shipper','facility') then
    raise exception 'invalid partner kind' using errcode='22023';
  end if;
  if coalesce(trim(p_company),'') = '' then
    raise exception 'company name is required' using errcode='22023';
  end if;

  v_mc := nullif(regexp_replace(coalesce(p_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is not null and length(v_mc) > 8 then
    raise exception 'MC number looks wrong — it is at most 8 digits (you entered %)', v_mc
      using errcode='22023';
  end if;

  v_org := app_private.my_partner_org(p_kind);
  if v_org is not null then
    if v_mc is not null then
      update public.organizations set mc_number = coalesce(mc_number, v_mc) where id = v_org;
    end if;
    return jsonb_build_object('org', v_org, 'kind', p_kind, 'existing', true);
  end if;

  insert into public.organizations(kind, name, owner_user_id, status, mc_number)
    values (p_kind, trim(p_company), auth.uid(), 'pending', v_mc)
    returning id into v_org;

  insert into public.organization_memberships(org_id, user_id, status, member_role)
    values (v_org, auth.uid(), 'active', 'owner');

  perform app_private.emit_event('partner.registered','organization', v_org::text,
    jsonb_build_object('org', v_org, 'kind', p_kind, 'mc', v_mc), null);
  perform app_private.log_audit('partner.register','organization', v_org::text, v_org,
    p_kind || ' partner registered: ' || trim(p_company)
      || case when v_mc is not null then ' (MC-' || v_mc || ')' else '' end,
    '{}'::jsonb, null);

  perform app_private.notify_partner(v_org,
    '🎉 Welcome to LoadBoot — ' || trim(p_company),
    'Your ' || p_kind || ' account is created. Finish the guided onboarding (about 10 minutes) — once our team verifies your packet, load posting unlocks automatically.',
    'success', '/app/partner/#onboarding');

  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'partner.registered',
      jsonb_build_object(
        'title', 'New ' || p_kind || ' registered — ' || trim(p_company)
                 || case when v_mc is not null then ' · MC-' || v_mc else ' · NO MC GIVEN' end,
        'body', 'Their onboarding packet will land for review as they submit items. Open the 360 to watch it.',
        'tone', 'action', 'url', '/app/command-center/#/broker?id=' || v_org),
      'sent', now());
  exception when others then null; end;

  return jsonb_build_object('org', v_org, 'kind', p_kind, 'existing', false, 'mc', v_mc);
end
$function$;

-- ===========================================================================
-- bl_sec_0287 — fix the overload's grants, collapse the old one onto it
-- ===========================================================================
-- bl_ob_0286 walked straight into the ACL trap documented in bl_sec_0275:
-- creating cc_partner_register(text,text,text) as a NEW signature gave it the
-- default PUBLIC EXECUTE, so it came out ANON-EXECUTABLE while the original
-- 2-arg overload was correctly locked to `authenticated`. An anon caller could
-- have created organizations. Caught by checking grants immediately after the
-- create — which is now the rule after ANY function add or recreate.
revoke all on function public.cc_partner_register(text,text,text) from public, anon;
grant execute on function public.cc_partner_register(text,text,text) to authenticated;

-- 2-arg shim so cached PWA bundles keep working and the two cannot drift.
create or replace function public.cc_partner_register(p_kind text, p_company text)
returns jsonb
language sql
security definer
set search_path to 'app_private, public'
as $function$
  select public.cc_partner_register(p_kind, p_company, null);
$function$;

revoke all on function public.cc_partner_register(text,text) from public, anon;
grant execute on function public.cc_partner_register(text,text) to authenticated;

-- Verified after apply: both overloads anon=false, authenticated=true.
-- Anon-executable SECURITY DEFINER count in public: 29 -> 25 across this session.
