-- bl_camp_0328_analytics_count_engagement_by_timestamp.sql
-- Applied: staging 6 Sep 2026, production 6 Sep 2026.
--
-- cc_campaign_analytics counted opens/clicks as `status in ('opened','clicked')`, but
-- cc_delivery_worker_mark never sets those statuses — by design it stamps opened_at /
-- clicked_at and leaves the row at 'delivered', so an engagement event cannot downgrade a
-- terminal status. The Stats panel therefore reported 0 opens and 0 clicks even when the
-- provider was reporting them. Count by the timestamp columns the worker actually writes.
--
-- Separate finding, NOT fixed here (needs a Resend dashboard change, or deploying the
-- first-party mail-open pixel that already exists in supabase/functions/mail-open):
-- across 18,382 emails, provider_events holds zero 'opened' and zero 'clicked' rows.
-- Resend has never sent one — its open/click tracking is off, or the webhook endpoint is
-- not subscribed to those event types. sent/delivered/bounced/complained all arrive fine.
create or replace function public.cc_campaign_analytics(p_campaign uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private, public'
as $function$
declare v jsonb; v_total int; v_sent int; v_delivered int; v_opened int; v_clicked int; v_bounced int; v_failed int; v_dead int; v_pending int;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select count(*),
    count(*) filter (where status in ('sent','delivered','opened','clicked')),
    count(*) filter (where status in ('delivered','opened','clicked')),
    count(*) filter (where opened_at is not null),
    count(*) filter (where clicked_at is not null),
    count(*) filter (where status in ('bounced','complained')),
    count(*) filter (where status='failed'),
    count(*) filter (where status='dead_letter'),
    count(*) filter (where status in ('queued','scheduled','claimed'))
  into v_total,v_sent,v_delivered,v_opened,v_clicked,v_bounced,v_failed,v_dead,v_pending
  from app_private.message_deliveries where campaign_id=p_campaign;
  v := jsonb_build_object(
    'total',v_total,'sent',v_sent,'delivered',v_delivered,'opened',v_opened,'clicked',v_clicked,
    'bounced',v_bounced,'failed',v_failed,'dead_letter',v_dead,'pending',v_pending,
    'delivery_rate', case when v_sent>0 then round(100.0*v_delivered/v_sent,1) else 0 end,
    'open_rate',     case when v_delivered>0 then round(100.0*v_opened/v_delivered,1) else 0 end,
    'click_rate',    case when v_opened>0 then round(100.0*v_clicked/v_opened,1) else 0 end,
    'bounce_rate',   case when v_total>0 then round(100.0*v_bounced/v_total,1) else 0 end);
  return v;
end; $function$;
