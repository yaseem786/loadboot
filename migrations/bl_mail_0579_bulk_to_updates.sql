-- bl_mail_0579 — bulk / promotional mail goes to Updates, not to "Needs reply" (owner, 30 Oct 2026)
-- Newsletters and vendor promotions (Capterra, G2, Veem, AWS marketing, Apple developer news…) were classed 'human' and
-- got a reply deadline. Mail from an UNKNOWN or VENDOR sender is now filed as mail_class 'marketing' in Updates (read,
-- no deadline) when it looks like bulk mail: an ESP sending subdomain (e./em./mail./news.…), a team/marketing mailbox,
-- or an unsubscribe / ESP tracking marker in the raw body. Never for loads@ (load blasts are its job), never for a
-- Re:/Fwd: and never when we have written in that thread. Nothing is deleted; "Move to Primary" still works.

create or replace function app_private.mail_is_bulk(p_from text, p_body text)
returns boolean language sql immutable set search_path to 'app_private', 'public' as $function$
  select lower(split_part(app_private.mail_unwrap_srs(coalesce(p_from,'')), '@', 2)) ~ '^(e|em|email|emails|mail|mailer|mailing|news|newsletter|newsletters|mkt|marketing|info|go|t|engage|comms|campaign|promo|offers|updates|notifications?)\.'
      or lower(split_part(app_private.mail_unwrap_srs(coalesce(p_from,'')), '@', 1)) ~ '^(team[a-z]*|marketing|news|offers|deals|events|community|partners?|promo|sales|growth|insights)$'
      or lower(left(coalesce(p_body, ''), 60000)) ~ '(list-unsubscribe|unsubscribe|opt[- ]out|manage (your )?(email )?(preferences|subscription)|email preferences|view (this email |it )?in (your |a )?browser|awstrack\.me|sendgrid\.net|mailchimp|mcusercontent|hubspotlinks|hs-email|klaviyo|sparkpostmail|mandrillapp|customer\.io|braze|mktomail|pardot|exacttarget|sailthru|constantcontact|createsend|mailgun\.org|rs6\.net)';
$function$;

create or replace function app_private.mail_bulk_applies(m app_private.mail_messages)
returns boolean language sql stable set search_path to 'app_private', 'public' as $function$
  select m.direction = 'in' and m.folder = 'inbox' and m.mail_class = 'human'
     and coalesce(m.sender_role, 'unknown') in ('unknown', 'vendor')
     and lower(coalesce(m.mailbox, '')) <> 'loads@loadboot.com'
     and app_private.mail_decode_words(coalesce(m.subject, '')) !~* '^\s*(re|fwd?|aw)\s*:'
     and not exists (select 1 from app_private.mail_messages o where o.thread_key = m.thread_key and o.direction = 'out')
     and app_private.mail_is_bulk(m.peer_email, coalesce(m.body_text, '') || ' ' || coalesce(m.body_html, ''));
$function$;

create or replace function app_private.trg_mail_bulk()
returns trigger language plpgsql security definer set search_path to 'app_private', 'public' as $function$
begin
  if app_private.mail_bulk_applies(new) then
    new.mail_class := 'marketing'; new.folder := 'system'; new.urgency := 'none';
    new.urgency_reason := 'bulk mail'; new.read_at := coalesce(new.read_at, now());
  end if;
  return new;
end $function$;
drop trigger if exists a1_mail_bulk on app_private.mail_messages;
create trigger a1_mail_bulk before insert on app_private.mail_messages
  for each row execute function app_private.trg_mail_bulk();

-- backfill: today's inbox (two statements: a sibling CTE would not see the moved rows)
update app_private.mail_messages m set mail_class = 'marketing', folder = 'system', urgency = 'none', urgency_reason = 'bulk mail',
       read_at = coalesce(m.read_at, now())
 where app_private.mail_bulk_applies(m);

with closed as (
  update app_private.mail_thread_state s set work_status = 'done', reply_due_at = null, sla_level = 0, follow_up = false, updated_at = now()
   where s.work_status = 'open'
     and exists (select 1 from app_private.mail_messages b where b.thread_key = s.thread_key and b.mail_class = 'marketing')
     and not exists (select 1 from app_private.mail_messages i where i.thread_key = s.thread_key and i.direction = 'in'
                       and i.folder = 'inbox' and coalesce(i.urgency, 'none') in ('urgent','high','normal','low'))
  returning s.thread_key
)
insert into app_private.mail_thread_events (thread_key, kind, detail)
select thread_key, 'status', '{"to":"done","by":"bulk filter"}'::jsonb from closed;
