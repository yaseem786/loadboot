-- An outbound follow-up reminder does not start a new inbound reply SLA.
CREATE OR REPLACE FUNCTION app_private.mail_sla_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare n_follow int := 0; n_esc int := 0; r record; v_lvl smallint; cfg app_private.mail_settings;
begin
  select * into cfg from app_private.mail_settings where id = 1;
  -- Keep elapsed follow-ups in Waiting on them, without starting a reply SLA.
  with due as (
    update app_private.mail_thread_state
       set follow_up = true, updated_at = now()
     where work_status = 'waiting' and not follow_up
       and last_out_at is not null and trashed_at is null
       and (snoozed_until is null or snoozed_until <= now())
       and app_private.mail_add_business_minutes(last_out_at, cfg.follow_up_minutes) < now()
    returning thread_key
  )
  insert into app_private.mail_thread_events (thread_key, kind)
  select thread_key, 'follow_up_due' from due;
  get diagnostics n_follow = row_count;

  for r in select * from app_private.mail_thread_state
            where work_status = 'open' and reply_due_at is not null and sla_start_at is not null
              and (snoozed_until is null or snoozed_until <= now())
            for update skip locked loop
    v_lvl := case
      when now() >= r.sla_start_at + 2 * (r.reply_due_at - r.sla_start_at) then 3
      when now() >= r.reply_due_at then 2
      when now() >= r.sla_start_at + 0.75 * (r.reply_due_at - r.sla_start_at) then 1
      else 0 end;
    if v_lvl > r.sla_level then
      update app_private.mail_thread_state set sla_level = v_lvl where thread_key = r.thread_key;
      insert into app_private.mail_thread_events (thread_key, kind, detail) values (r.thread_key, 'escalated', jsonb_build_object('level', v_lvl, 'due', r.reply_due_at));
      n_esc := n_esc + 1;
    end if;
  end loop;
  return jsonb_build_object('follow_ups', n_follow, 'escalated', n_esc);
end $function$;

-- Repair threads reopened only by the old no-response sweep.
with repaired as (
  update app_private.mail_thread_state s
     set work_status = 'waiting', urgency = null, urgency_reason = null,
         sla_start_at = null, reply_due_at = null, sla_level = 0, updated_at = now()
   where s.work_status = 'open' and s.follow_up and s.trashed_at is null
   and s.last_out_at is not null
   and (s.last_in_at is null or s.last_in_at <= s.last_out_at)
   and exists (
     select 1 from app_private.mail_messages m
     where m.thread_key = s.thread_key and m.direction = 'out' and m.status = 'sent'
   )
   and not exists (
     select 1 from app_private.mail_messages m
     where m.thread_key = s.thread_key and m.direction = 'in' and m.folder = 'inbox'
       and m.urgency in ('urgent', 'high', 'normal', 'low') and m.created_at > s.last_out_at
   )
  returning s.thread_key
)
insert into app_private.mail_thread_events (thread_key, kind, detail)
select thread_key, 'status', '{"to":"waiting","by":"follow-up queue correction"}'::jsonb
from repaired;
