-- bl_mail_0178 — make the outreach killswitch able to actually fire.
--
-- Symptom: 861 message_deliveries ever recorded, statuses only 'sent' (859) and
-- 'dead_letter' (2). Not a single 'bounced' or 'complained' in the system, and
-- app_private.suppressions was completely empty. outreach_health_check() pauses
-- the engine above a 10% failure rate — measuring a number that was always zero.
-- A dead address would have received all 7 emails in the drip.
--
-- Cause: supabase/functions/delivery-webhook was written but never deployed. Its
-- import of jsr:@standard-webhooks/standard-webhooks does not resolve — that
-- package does not exist — so the bundle always failed. Resend had nowhere to
-- deliver events. (Fixed in the function source, same commit.)
--
-- This migration covers the two database-side gaps.

-- 1. cc_delivery_worker_mark does `insert ... on conflict do nothing` on
--    suppressions, but the table had no unique constraint, so that clause could
--    never match and duplicates would accumulate.
create unique index if not exists suppressions_channel_address_uidx
  on app_private.suppressions (channel, address);

-- 2. cc_delivery_worker_mark writes 'complained' for spam complaints, and turns
--    'failed' into a requeue ('queued', or 'dead_letter' after 5 attempts) — so
--    the health check was watching for statuses that never persist. Count what is
--    actually written, and treat a complaint as at least as serious as a bounce.
CREATE OR REPLACE FUNCTION app_private.outreach_health_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_total int; v_fail int; v_rate numeric;
begin
  select count(*), count(*) filter (where status in ('failed','bounced','complained','dead_letter'))
    into v_total, v_fail
  from app_private.message_deliveries
  where template_key like 'outreach.%' and created_at > now() - interval '2 days';
  if v_total >= 50 then
    v_rate := round(100.0 * v_fail / v_total, 1);
    if v_rate > 10 then
      update app_private.outreach_state set enabled = false where id = 1;
      begin
        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','outreach.killswitch',
          jsonb_build_object('title','🛑 Outreach engine AUTO-PAUSED — high bounce rate',
            'body','Bounce/complaint rate hit '||v_rate||'% over the last 2 days ('||v_fail||'/'||v_total||'). Engine disabled to protect the domain. Clean the list, then re-enable.',
            'tone','urgent','url','/analytics-web'), 'sent', now());
      exception when others then null; end;
      begin
        perform app_private.sys_email('hello@loadboot.com','outreach.killswitch',
          '🛑 LoadBoot outreach auto-paused — failure rate '||v_rate||'%',
          '<p>The outreach engine paused itself: <b>'||v_rate||'% bounces/complaints</b> ('||v_fail||'/'||v_total||') in 2 days. This protects loadboot.com from blacklisting. Review the list, then re-enable from CC.</p>',
          null, 'outkill:'||to_char(now(),'YYYYMMDD'));
      exception when others then null; end;
      return jsonb_build_object('paused', true, 'rate', v_rate);
    end if;
    return jsonb_build_object('ok', true, 'rate', v_rate);
  end if;
  return jsonb_build_object('ok', true, 'rate', null);
end $function$;
