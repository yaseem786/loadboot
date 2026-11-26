-- Keep operational documents and action notices visible despite bulk sender signals.
create or replace function app_private.mail_is_operational_subject(p_subject text)
returns boolean
language sql immutable
set search_path to 'app_private', 'public'
as $function$
  select app_private.mail_decode_words(coalesce(p_subject, '')) ~* $pattern$\m(certificate of (liability |commercial )?insurance|proof of insurance|insurance certificate|acord (25|form)|coi|notice of assignment|noa|remittance instructions|remit.to (instructions|change)|rate confirmation|proof of delivery|bill of lading)\M|^\s*(\[[^]]{1,30}\]\s*)?(action required|payment (failed|unsuccessful|overdue)|service (disruption|outage)|security alert)\M$pattern$;
$function$;

revoke execute on function app_private.mail_is_operational_subject(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.mail_bulk_applies(m app_private.mail_messages)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'app_private', 'public'
AS $function$
  select m.direction = 'in' and m.folder = 'inbox' and m.mail_class = 'human'
     and coalesce(m.sender_role, 'unknown') in ('unknown', 'vendor')
     and lower(coalesce(m.mailbox, '')) <> 'loads@loadboot.com'
     and app_private.mail_decode_words(coalesce(m.subject, '')) !~* '^\s*(re|fwd?|aw)\s*:'
     and not exists (select 1 from app_private.mail_messages o where o.thread_key = m.thread_key and o.direction = 'out')
     and not app_private.mail_is_operational_subject(m.subject)
     and app_private.mail_is_bulk(m.peer_email, coalesce(m.body_text, '') || ' ' || coalesce(m.body_html, ''));
$function$;

-- Restore only rows explicitly routed by the bulk heuristic. Leave manually moved,
-- archived, trashed, and system-only delivery or opt-out events in their existing folders.
with restored as (
  update app_private.mail_messages m
     set folder = 'inbox',
         mail_class = 'human',
         urgency = u.urgency,
         urgency_reason = 'operational mail recovered from Updates',
         read_at = null
    from app_private.mail_messages source
    cross join lateral app_private.mail_urgency(
      coalesce(source.sender_role, 'unknown'), source.direction, source.subject, source.body_text
    ) u
   where m.id = source.id
     and m.direction = 'in'
     and m.folder = 'system'
     and m.mail_class = 'marketing'
     and m.urgency_reason = 'bulk mail'
     and app_private.mail_is_operational_subject(m.subject)
     and not exists (
       select 1 from app_private.mail_thread_state s
       where s.thread_key = m.thread_key and (s.trashed_at is not null or s.archived_at >= m.created_at)
     )
  returning m.thread_key, m.created_at, m.urgency
), newest as (
  select distinct on (thread_key) thread_key, created_at, urgency
  from restored
  where thread_key is not null
  order by thread_key, created_at desc
), reopened as (
  insert into app_private.mail_thread_state as s (
    thread_key, work_status, owner_user_id, urgency, urgency_reason,
    last_in_at, sla_start_at, reply_due_at, sla_level, follow_up, updated_at
  )
  select n.thread_key, 'open', settings.default_owner, n.urgency,
         'operational mail recovered from Updates', n.created_at, n.created_at,
         app_private.mail_due_at(n.created_at, n.urgency), 0, false, now()
  from newest n
  cross join app_private.mail_settings settings
  where settings.id = 1
    and n.urgency in ('urgent', 'high', 'normal', 'low')
    and not exists (
      select 1 from app_private.mail_messages o
      where o.thread_key = n.thread_key and o.direction = 'out'
        and o.status in ('sent', 'queued', 'sending')
        and coalesce(o.sent_at, o.created_at) >= n.created_at
    )
  on conflict (thread_key) do update
    set work_status = 'open',
        owner_user_id = coalesce(s.owner_user_id, excluded.owner_user_id),
        urgency = excluded.urgency,
        urgency_reason = excluded.urgency_reason,
        last_in_at = excluded.last_in_at,
        sla_start_at = excluded.sla_start_at,
        reply_due_at = excluded.reply_due_at,
        sla_level = 0,
        follow_up = false,
        updated_at = excluded.updated_at
  where s.work_status is distinct from 'open'
    and s.trashed_at is null
    and (s.archived_at is null or s.archived_at < excluded.last_in_at)
    and (s.last_out_at is null or s.last_out_at < excluded.last_in_at)
    and (s.last_in_at is null or s.last_in_at <= excluded.last_in_at)
  returning thread_key
)
insert into app_private.mail_thread_events (thread_key, kind, detail)
select thread_key, 'opened', '{"source":"operational mail recovery"}'::jsonb from reopened;
