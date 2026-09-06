-- bl_camp_0325_manual_list_audience.sql
-- Adds a 'manual_list' audience type so a campaign can be sent to an explicitly
-- curated set of email addresses (e.g. "the 30 real carriers", not "every row where
-- profiles.status='active'"). Additive and reversible:
--   * new 2-arg overload of resolve_audience_emails; the existing 1-arg function is
--     untouched and still works, so nothing that calls it today changes behaviour.
--   * cc_campaign_audience_preview / cc_campaign_enqueue now pass the audience's
--     filters through. For every existing audience type filters are ignored, so the
--     resolved recipient set for those is byte-for-byte what it was before.
--   * cc_audience_estimate learns 'manual_list' instead of raising 'unknown audience
--     type' (which would have made the Estimate button error out in the UI).
-- Consent: an explicit opt-out ALWAYS wins. A manual list cannot resurrect someone who
-- set marketing_email=false or unsubscribed_all=true, and the callers still subtract
-- the suppression list on top of that.

begin;

-- 1) Resolution ---------------------------------------------------------------
create or replace function app_private.resolve_audience_emails(p_type text, p_filters jsonb)
returns table(recipient_user uuid, email text, opted_in boolean)
language plpgsql stable security definer
set search_path to 'app_private, public'
as $function$
begin
  if p_type = 'manual_list' then
    return query
    with raw as (
      select distinct lower(btrim(e)) as email
      from jsonb_array_elements_text(coalesce(p_filters->'emails', '[]'::jsonb)) as e
      where btrim(e) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
    select p.id,
           raw.email,
           (coalesce(cp.marketing_email, true) and not coalesce(cp.unsubscribed_all, false))
    from raw
    left join public.profiles p on lower(p.email) = raw.email
    left join app_private.comm_preferences cp on cp.user_id = p.id;
    return;
  end if;
  return query select r.recipient_user, r.email, r.opted_in
               from app_private.resolve_audience_emails(p_type) r;
end; $function$;

revoke all on function app_private.resolve_audience_emails(text, jsonb) from public;

-- 2) Preview ------------------------------------------------------------------
create or replace function public.cc_campaign_audience_preview(p_campaign uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private, public'
as $function$
declare c record; v_aud int; v_opt int; v_supp int; v_final int; v_sample jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select camp.*, a.type as audience_type, a.filters as audience_filters into c
    from app_private.campaigns camp
    left join app_private.audiences a on a.id = camp.audience_id
   where camp.id = p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  with aud as (select recipient_user, lower(email) email, opted_in
                 from app_private.resolve_audience_emails(coalesce(c.audience_type,''), coalesce(c.audience_filters,'{}'::jsonb))),
       supp as (select lower(address) a from app_private.suppressions where channel='email')
  select (select count(*) from aud),
         (select count(*) from aud where opted_in),
         (select count(*) from aud where opted_in and email in (select a from supp)),
         (select count(distinct email) from aud where opted_in and email not in (select a from supp)),
         (select coalesce(jsonb_agg(email),'[]'::jsonb) from (select distinct email from aud where opted_in and email not in (select a from supp) limit 5) s)
    into v_aud, v_opt, v_supp, v_final, v_sample;
  return jsonb_build_object('campaign',c.name,'channel','email','audience_total',v_aud,'after_consent',v_opt,
    'suppressed',v_supp,'final_recipients',v_final,'sample',v_sample,'excluded_no_consent',v_aud-v_opt);
end; $function$;

-- 3) Enqueue ------------------------------------------------------------------
create or replace function public.cc_campaign_enqueue(p_campaign uuid, p_confirm_count integer)
returns jsonb
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare c record; v_final int; v_ins int; v_sched timestamptz; v_subj text; v_html text; v_text text; v_nvar int;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select camp.*, a.type as audience_type, a.filters as audience_filters into c
    from app_private.campaigns camp
    left join app_private.audiences a on a.id = camp.audience_id
   where camp.id = p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  if c.approved_by is null then raise exception 'campaign is not approved — an approver must approve it before sending' using errcode='42501'; end if;
  if not ('email' = any(coalesce(c.channels, array[]::text[]))) then raise exception 'campaign has no email channel' using errcode='22023'; end if;
  select coalesce(t.subject, c.subject), coalesce(t.body, c.body), coalesce(t.body_text, t.body, c.body)
    into v_subj, v_html, v_text
    from (select 1) _ left join app_private.comm_templates t on t.key = c.template_key;
  select count(*) into v_nvar from app_private.campaign_variants where campaign_id = c.id;
  v_sched := coalesce(c.scheduled_at, now());

  with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
      select lower(email) email, recipient_user
        from app_private.resolve_audience_emails(coalesce(c.audience_type,''), coalesce(c.audience_filters,'{}'::jsonb))
       where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email)
  select count(*) into v_final from rcpt;
  if p_confirm_count is null or p_confirm_count <> v_final then
    raise exception 'recipient count changed (expected %, now %) — re-preview and confirm', p_confirm_count, v_final using errcode='22023'; end if;

  if v_nvar = 0 then
    with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
        select lower(email) email, recipient_user
          from app_private.resolve_audience_emails(coalesce(c.audience_type,''), coalesce(c.audience_filters,'{}'::jsonb))
         where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email),
    ins as (insert into app_private.message_deliveries(org_id,source,campaign_id,template_key,channel,provider,recipient_user,recipient_email,idempotency_key,status,scheduled_at,meta)
        select null,'campaign',c.id,c.template_key,'email','resend',r.recipient_user,r.email,c.id::text||':email:'||r.email,
          case when v_sched>now() then 'scheduled' else 'queued' end, v_sched,
          jsonb_build_object('subject',v_subj,'utm_campaign',c.utm_campaign,'body_html',v_html,'body_text',v_text)
        from rcpt r on conflict (idempotency_key) do nothing returning 1)
    select count(*) into v_ins from ins;
  else
    with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
        select lower(email) email, recipient_user
          from app_private.resolve_audience_emails(coalesce(c.audience_type,''), coalesce(c.audience_filters,'{}'::jsonb))
         where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email),
    vs as (select label,
        coalesce(nullif(subject,''), v_subj) subject,
        coalesce(nullif(body_html,''), v_html) body_html,
        coalesce(nullif(body_text,''), v_text) body_text,
        (sum(weight) over (order by created_at, id) - weight) lo,
        sum(weight) over (order by created_at, id) hi
      from app_private.campaign_variants where campaign_id=c.id),
    tot as (select sum(weight) w from app_private.campaign_variants where campaign_id=c.id),
    ins as (insert into app_private.message_deliveries(org_id,source,campaign_id,template_key,channel,provider,recipient_user,recipient_email,idempotency_key,status,scheduled_at,meta)
        select null,'campaign',c.id,c.template_key,'email','resend',r.recipient_user,r.email,c.id::text||':email:'||r.email,
          case when v_sched>now() then 'scheduled' else 'queued' end, v_sched,
          jsonb_build_object('subject',v.subject,'utm_campaign',c.utm_campaign,'body_html',v.body_html,'body_text',v.body_text,'variant',v.label)
        from rcpt r cross join tot
        join vs v on ((hashtextextended(r.email,0) % tot.w) + tot.w) % tot.w >= v.lo
                 and ((hashtextextended(r.email,0) % tot.w) + tot.w) % tot.w <  v.hi
        on conflict (idempotency_key) do nothing returning 1)
    select count(*) into v_ins from ins;
  end if;

  update app_private.campaigns set status = case when v_sched>now() then 'scheduled' else 'sending' end, updated_at = now() where id = c.id;
  perform app_private.emit_event('campaign.enqueued','campaign',c.id::text, jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'channel','email','variants',v_nvar));
  perform app_private.log_audit('campaign.enqueue','campaign',c.id::text,null,format('enqueued %s email recipients (%s variants)',v_final,v_nvar), jsonb_build_object('newly_queued',v_ins));
  return jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'variants',v_nvar,'status',case when v_sched>now() then 'scheduled' else 'sending' end);
end; $function$;

-- 4) Estimate: teach it the new type so the UI's Estimate button does not error ----
create or replace function public.cc_audience_estimate(p_type text)
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private, public'
as $function$
declare v_count bigint := 0; v_sample jsonb := '[]'::jsonb;
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_type = 'all_carriers' then
    select count(*) into v_count from public.organizations where kind='carrier';
    select jsonb_agg(name) into v_sample from (select name from public.organizations where kind='carrier' order by created_at desc limit 5) s;
  elsif p_type = 'active_carriers' then
    select count(*) into v_count from public.organizations where kind='carrier' and status='active';
    select jsonb_agg(name) into v_sample from (select name from public.organizations where kind='carrier' and status='active' order by created_at desc limit 5) s;
  elsif p_type = 'pending_carriers' then
    select count(*) into v_count from public.organizations where kind='carrier' and status <> 'active';
  elsif p_type = 'onboarding_pending' then
    select count(*) into v_count from app_private.carrier_onboarding where stage='submitted';
  elsif p_type = 'carrier_owners' then
    select count(*) into v_count from public.profiles where role='carrier';
  elsif p_type = 'drivers' then
    select count(*) into v_count from app_private.fleet_drivers;
  elsif p_type = 'leads' then
    select count(*) into v_count from app_private.crm_leads;
  elsif p_type = 'newsletter' then
    select count(distinct email) into v_count from app_private.form_submissions
      where form_key='newsletter' and coalesce(spam_score,0) < 80 and email ~ '^[^@]+@[^@]+\.[^@]+$';
  elsif p_type = 'form_submitters' then
    select count(distinct email) into v_count from app_private.form_submissions
      where coalesce(spam_score,0) < 80 and email ~ '^[^@]+@[^@]+\.[^@]+$';
  elsif p_type = 'all_staff' then
    select count(*) into v_count from app_private.staff_members where status='active';
  elsif p_type = 'manual_list' then
    -- The count lives in the saved audience's own filters, not in a global segment.
    return jsonb_build_object('type', p_type, 'count', 0, 'sample', '[]'::jsonb,
      'note', 'Paste the addresses when you save the audience — the exact recipient count is shown on the campaign preview before you confirm.');
  else
    raise exception 'unknown audience type' using errcode='22023';
  end if;
  return jsonb_build_object('type', p_type, 'count', v_count, 'sample', coalesce(v_sample, '[]'::jsonb));
end; $function$;

commit;

-- 5) PRODUCTION BUG FIX --------------------------------------------------------
-- app_private.campaigns.utm_campaign is NOT NULL *and* UNIQUE, with no default, but
-- cc_cmp_save never set it. Every "New campaign" save therefore failed with
--   23502 null value in column "utm_campaign" ... violates not-null constraint
-- which is why app_private.campaigns has 0 rows on production: the Campaign manager
-- has never been able to create a campaign. Fix: derive a slug from the name and
-- append the new row's own id fragment so the UNIQUE index can never collide.
-- On update utm_campaign is deliberately left alone, so links already in the wild
-- keep resolving to the same UTM value.
begin;

create or replace function public.cc_cmp_save(p_id uuid, p_name text, p_objective text, p_audience uuid, p_template text, p_channels text[], p_subject text, p_body text, p_scheduled_at timestamp with time zone, p_status text)
returns uuid
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare v_id uuid; v_slug text;
begin
  if not (public.has_global_permission('campaigns.view') or public.has_global_permission('content.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'campaign name is required' using errcode='22023'; end if;
  if p_status not in ('draft','scheduled','sent','paused') then raise exception 'invalid status' using errcode='22023'; end if;
  if p_id is null then
    v_id := gen_random_uuid();
    v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-');
    v_slug := left(coalesce(nullif(v_slug,''), 'campaign'), 48) || '-' || left(v_id::text, 8);
    insert into app_private.campaigns(id, name, utm_campaign, objective, audience_id, template_key, channels, subject, body, scheduled_at, status, created_by)
    values (v_id, p_name, v_slug, p_objective, p_audience, p_template, coalesce(p_channels,'{push}'), p_subject, p_body, p_scheduled_at, coalesce(p_status,'draft'), auth.uid())
    returning id into v_id;
  else
    update app_private.campaigns set name=p_name, objective=p_objective, audience_id=p_audience, template_key=p_template,
      channels=coalesce(p_channels,'{push}'), subject=p_subject, body=p_body, scheduled_at=p_scheduled_at, status=coalesce(p_status,'draft'), updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  perform app_private.log_audit('campaign.save','campaign', v_id::text, null, coalesce(p_status,'draft'), jsonb_build_object('name',p_name));
  return v_id;
end; $function$;

commit;

-- ---------------------------------------------------------------------------
-- FOLLOW-UP: bl_camp_0326_cmp_save_empty_string_coercion.sql — see that file.
-- Leaving Schedule blank in the New-campaign form sent '' (not null), which
-- PostgREST cast to timestamptz and failed with 22007 before the function ran.
-- Same for an unselected Audience ('' -> uuid, 22P02). p_audience and
-- p_scheduled_at are now text and coerced with nullif() inside the function.
-- ---------------------------------------------------------------------------
