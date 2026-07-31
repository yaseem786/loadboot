-- bl_mail_0179 — make suppression real end-to-end, and back the one-click unsubscribe endpoint.
-- Applied to production 2026-07-31 (this file is the repo record of that change).
--
-- Found in production on 2026-07-31:
--   * Every outgoing email's footer + List-Unsubscribe headers point at /functions/v1/unsubscribe,
--     which was NEVER deployed (404). Recipients had no working way out except "report spam" —
--     and today one of them used it.
--   * suppressions was written on bounce/complaint (cc_delivery_worker_mark) but NOTHING read it:
--     neither outreach_run_daily (enqueue) nor cc_delivery_worker_claim (send) filtered on it,
--     so a complained/bounced address would still receive the rest of the 7-email drip.
--
-- This migration:
--   1. cc_delivery_worker_unsubscribe: also flips outreach_contacts.status -> 'unsubscribed'.
--   2. cc_delivery_worker_claim: suppressed recipients are never claimed; their queued rows are
--      closed out as 'unsubscribed' so the queue does not clog.
--   3. outreach_run_daily: candidate query now excludes suppressed addresses.
--   4. Data fix: contacts already in suppressions flip to 'unsubscribed' now.
-- No new grants to anon/authenticated anywhere (invariant: 26 anon-executable definers).

create or replace function public.cc_delivery_worker_unsubscribe(p_token uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare d record;
begin
  select * into d from app_private.message_deliveries where correlation_id = p_token limit 1;
  if d.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown token'); end if;
  if d.channel = 'email' and d.recipient_email is not null then
    insert into app_private.suppressions(channel,address,reason) values ('email', lower(d.recipient_email), 'unsubscribed') on conflict do nothing;
    update app_private.outreach_contacts set status='unsubscribed' where lower(email)=lower(d.recipient_email) and status <> 'unsubscribed';
  elsif d.channel = 'sms' and d.recipient_phone is not null then
    insert into app_private.suppressions(channel,address,reason) values ('sms', d.recipient_phone, 'unsubscribed') on conflict do nothing;
  end if;
  update app_private.message_deliveries set status='unsubscribed', updated_at=now() where id=d.id;
  perform app_private.log_audit('comm.unsubscribe','delivery',d.id::text,null,'recipient unsubscribed via one-click link',
    jsonb_build_object('channel',d.channel));
  return jsonb_build_object('ok', true, 'channel', d.channel);
end; $function$;

create or replace function public.cc_delivery_worker_claim(p_limit integer default 50, p_channel text default 'email')
returns setof app_private.message_deliveries language plpgsql security definer set search_path to 'app_private, public'
as $function$
begin
  -- Close out queued deliveries whose recipient has since been suppressed (bounce/complaint/unsubscribe).
  update app_private.message_deliveries m
    set status='unsubscribed', failure_reason='recipient suppressed', updated_at=now()
    where m.status='queued' and m.channel=p_channel
      and exists (select 1 from app_private.suppressions s
                  where s.channel=m.channel
                    and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end);
  return query with claimed as (select id from app_private.message_deliveries m
      where m.status='queued' and m.channel=p_channel and coalesce(m.scheduled_at,now())<=now()
        and not exists (select 1 from app_private.suppressions s
                        where s.channel=m.channel
                          and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end)
      order by m.scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$;

create or replace function app_private.outreach_run_daily()
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare st app_private.outreach_state; v_cap int; v_sent int := 0; c record; t record; v_html text; v_unsub text; v_health jsonb;
begin
  v_health := app_private.outreach_health_check();
  if coalesce((v_health->>'paused')::boolean, false) then return jsonb_build_object('skipped','killswitch', 'health', v_health); end if;
  select * into st from app_private.outreach_state where id=1;
  if not st.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if st.started_on is null then update app_private.outreach_state set started_on=current_date where id=1; st.started_on := current_date; end if;
  if st.last_run is distinct from current_date then update app_private.outreach_state set last_run=current_date, sent_today=0 where id=1; st.sent_today := 0; end if;
  v_cap := least(st.max_cap, st.base_cap * (2 ^ floor((current_date - st.started_on) / 7.0))::int) - st.sent_today;
  if v_cap <= 0 then return jsonb_build_object('skipped','cap reached'); end if;
  for c in
    select r.* from (
      select oc.*,
             row_number() over (partition by oc.kind
               order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc) as _rn
      from app_private.outreach_contacts oc
      where oc.status='active' and oc.emails_sent < 7
        and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
        and not exists (select 1 from app_private.suppressions s
                        where s.channel='email' and s.address=lower(trim(oc.email)))
        and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
    ) r
    order by r._rn, r.kind
    limit v_cap
  loop
    select * into t from app_private.outreach_templates where audience=c.kind and day=c.emails_sent+1 and active;
    v_unsub := 'https://loadboot.com/unsub.html?e=' || replace(lower(trim(c.email)),'+','%2B') || '&t=' || app_private.outreach_unsub_token(c.email);
    v_html := coalesce(case when t.parts is not null then app_private.outreach_render(t.parts) else t.html end, '');
    if v_html = '' then continue; end if;
    v_html := replace(replace(v_html, '{NAME}', coalesce(nullif(trim(c.company),''),'there')), '{UNSUB}', v_unsub);
    begin
      perform app_private.sys_email(c.email, 'outreach.'||c.kind||'-d'||t.day, t.subject, v_html, null,
        'outr:'||c.id::text||':d'||t.day);
      update app_private.outreach_contacts
        set emails_sent = emails_sent + 1, last_sent_at = now(),
            status = case when emails_sent + 1 >= 7 then 'completed' else status end
        where id = c.id;
      v_sent := v_sent + 1;
    exception when others then null; end;
  end loop;
  update app_private.outreach_state set sent_today = sent_today + v_sent where id=1;
  return jsonb_build_object('ok', true, 'sent', v_sent, 'cap', v_cap, 'health', v_health);
end $function$;

-- Data fix: anyone already suppressed is no longer an 'active' outreach contact.
update app_private.outreach_contacts oc set status='unsubscribed'
where oc.status='active'
  and exists (select 1 from app_private.suppressions s where s.channel='email' and s.address=lower(trim(oc.email)));
