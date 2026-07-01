-- cuy_audience_form_leads.sql
-- Add 'newsletter' and 'form_submitters' audience types to cc_audience_estimate so Marketing Studio campaigns
-- can target website form leads (careers / partner / newsletter / carrier-application / referral). Purely
-- additive — existing audience branches are unchanged; still staff-gated (is_active_staff). Distinct valid
-- emails, spam excluded.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_audience_estimate(p_type text)
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $BODY$
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
  else
    raise exception 'unknown audience type' using errcode='22023';
  end if;
  return jsonb_build_object('type', p_type, 'count', v_count, 'sample', coalesce(v_sample, '[]'::jsonb));
end; $BODY$;
