-- bl_comm_0446d — backfill repair: the ledger rows the prod apply skipped (26 Sep 2026)
--
-- Found on the prod apply of bl_comm_0446 (staging had no legacy rows, so it could not show):
-- app_private.email_identify(email) returns ZERO rows for an address nobody signed up with, and
-- §9a / §13b wrote the event as `insert … select … from email_identify(r.email)`. For 52 cold-outreach
-- suppressions and 4 complaint addresses that inserted nothing, so the pref row exists (the gate blocks
-- correctly) but unsub_prefs.last_event_id is null and CC → Unsubscribes shows 5 backfill rows instead
-- of 61. Sends were never at risk; only the history was incomplete.
--
-- This writes the missing events, dated from the pref (= the original suppression row), and links them.
-- Idempotent: only prefs with no event are touched.
do $fix$
declare r record; v_ev bigint;
begin
  for r in select p.email, p.group_code, p.updated_at, p.user_id
             from app_private.unsub_prefs p
            where p.source = 'backfill' and p.last_event_id is null
            order by p.updated_at loop
    insert into app_private.unsub_events(at, email, user_id, org_id, action, scope, groups, source, meta)
    values (r.updated_at, r.email, r.user_id,
            (select org_id from app_private.email_identify(r.email)),
            'unsubscribe',
            case when r.group_code = '*' then 'all' when r.group_code = 'marketing' then 'marketing' else 'group' end,
            array[r.group_code], 'backfill',
            case when r.group_code = '*'
                   and exists (select 1 from app_private.suppressions s where s.channel = 'email' and lower(btrim(s.address)) = r.email and s.reason = 'complained')
                 then jsonb_build_object('from', 'suppressions', 'reason', 'complained', 'repaired', '0446d')
                 when r.group_code = 'marketing'
                   and exists (select 1 from app_private.suppressions s where s.channel = 'email' and lower(btrim(s.address)) = r.email and s.reason = 'unsubscribed')
                 then jsonb_build_object('from', 'suppressions', 'repaired', '0446d')
                 when r.group_code = 'marketing'
                 then jsonb_build_object('from', 'outreach_contacts', 'repaired', '0446d')
                 else jsonb_build_object('from', 'comm_preferences', 'repaired', '0446d') end)
    returning id into v_ev;
    update app_private.unsub_prefs set last_event_id = v_ev where email = r.email and group_code = r.group_code;
  end loop;
end
$fix$;

do $chk$
declare n integer;
begin
  select count(*) into n from app_private.unsub_prefs where last_event_id is null;
  if n > 0 then raise exception 'bl_comm_0446d: % prefs still have no event', n; end if;
end
$chk$;
