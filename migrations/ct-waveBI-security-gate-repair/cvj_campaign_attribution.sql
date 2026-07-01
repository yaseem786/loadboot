-- cvj_campaign_attribution.sql
-- Attribution link in the delivery chain: connect a campaign's SENDS to the web CONVERSIONS it drove, via the
-- campaign's utm_campaign tag (the same tag the marketing site's first-party beacon + lead forms capture).
-- Closes the loop send → click (utm) → form submission → lead. Staff-gated (can_manage_comms), anon revoked.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_campaign_attribution(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare c record; v_delivered int; v_subs int; v_leads int; v_by_form jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into c from app_private.campaigns where id=p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;

  select count(*) filter (where status in ('delivered','opened','clicked'))
    into v_delivered from app_private.message_deliveries where campaign_id=p_campaign;

  -- web conversions attributed by matching utm_campaign (case-insensitive)
  select count(*), count(*) filter (where lead_id is not null)
    into v_subs, v_leads
  from app_private.form_submissions fs
  where c.utm_campaign is not null and lower(fs.utm_campaign) = lower(c.utm_campaign);

  select coalesce(jsonb_object_agg(form_key, cnt), '{}'::jsonb) into v_by_form
  from (
    select coalesce(fs.form_key,'unknown') form_key, count(*) cnt
    from app_private.form_submissions fs
    where c.utm_campaign is not null and lower(fs.utm_campaign) = lower(c.utm_campaign)
    group by 1
  ) s;

  return jsonb_build_object(
    'campaign', c.name, 'utm_campaign', c.utm_campaign,
    'delivered', coalesce(v_delivered,0),
    'attributed_submissions', coalesce(v_subs,0),
    'attributed_leads', coalesce(v_leads,0),
    'conversion_rate', case when coalesce(v_delivered,0)>0 then round(100.0*coalesce(v_subs,0)/v_delivered,1) else 0 end,
    'by_form', coalesce(v_by_form,'{}'::jsonb));
end; $$;
revoke execute on function public.cc_campaign_attribution(uuid) from anon, public;
grant  execute on function public.cc_campaign_attribution(uuid) to authenticated;
