-- bl_mail_0577 — CC Mailbox phase 2: every conversation has an OWNER, a STATUS and a REPLY DEADLINE (owner design, 30 Oct 2026)
-- Amazon-style: no email waits unseen. A carrier/broker/shipper/dispatcher email that lands in a Primary inbox opens the
-- thread (status 'open'), gives it the default owner (CC) and a reply deadline from its urgency:
--   urgent → 1 hour, every hour counts · high → 4 business hours · normal → 1 business day (10 h) · low → 2 business days (20 h)
--   business hours = America/New_York, Mon–Fri 8–18, Sat 9–13, Sunday + US holidays off (mail_settings, editable)
-- Our reply (an outbound message reaching status 'sent') → 'waiting'. No answer from them for 3 business days → back to 'open'
-- as a follow-up. Archive / Trash → 'done'. Another email in a thread that is still unanswered raises urgency one step.
-- A 5-minute sweep sets sla_level: 1 at 75 % of the window (amber), 2 past the deadline (red), 3 at 200 % (escalated).
-- Every change is written to mail_thread_events (who, when) for reporting (phase 4: WBR, first-reply time).
-- Backfill: unanswered mail already in the inbox starts its clock NOW (not instantly red); a thread we answered more than
-- 5 days ago with no reply since is closed as 'done' instead of turning into a follow-up.

-- ── settings ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app_private.mail_settings (
  id int primary key default 1 check (id = 1),
  default_owner uuid,
  tz text not null default 'America/New_York',
  hours jsonb not null default '{"1":[8,18],"2":[8,18],"3":[8,18],"4":[8,18],"5":[8,18],"6":[9,13]}',
  holidays date[] not null default '{}',
  sla_minutes jsonb not null default '{"urgent":60,"high":240,"normal":600,"low":1200}',
  follow_up_minutes int not null default 1800,
  alert_whatsapp text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table app_private.mail_settings enable row level security;
insert into app_private.mail_settings (id, default_owner, holidays, alert_whatsapp)
values (1, 'b7b28e16-608a-4ff7-9197-f763b80857e8',
  array['2026-11-26','2026-12-25','2027-01-01','2027-05-31','2027-07-05','2027-09-06','2027-11-25','2027-12-24']::date[],
  '+923075960550')
on conflict (id) do nothing;

-- ── thread state ─────────────────────────────────────────────────────────────────────────────────────
alter table app_private.mail_thread_state
  add column if not exists owner_user_id uuid,
  add column if not exists work_status text,
  add column if not exists urgency text,
  add column if not exists urgency_reason text,
  add column if not exists last_in_at timestamptz,
  add column if not exists last_out_at timestamptz,
  add column if not exists first_reply_at timestamptz,
  add column if not exists sla_start_at timestamptz,
  add column if not exists reply_due_at timestamptz,
  add column if not exists sla_level smallint not null default 0,
  add column if not exists follow_up boolean not null default false,
  add column if not exists viewing_by uuid,
  add column if not exists viewing_at timestamptz;
alter table app_private.mail_thread_state drop constraint if exists mail_thread_state_work_status_check;
alter table app_private.mail_thread_state add constraint mail_thread_state_work_status_check check (work_status in ('open','waiting','done'));
create index if not exists mail_thread_state_due on app_private.mail_thread_state (reply_due_at) where work_status = 'open';

create table if not exists app_private.mail_thread_events (
  id bigserial primary key,
  thread_key text not null,
  kind text not null,            -- opened · replied · waiting_expired · assigned · status · escalated · urgency_up
  actor uuid,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists mail_thread_events_thread on app_private.mail_thread_events (thread_key, at);
alter table app_private.mail_thread_events enable row level security;

-- ── business-hours clock ─────────────────────────────────────────────────────────────────────────────
create or replace function app_private.mail_add_business_minutes(p_from timestamptz, p_minutes int)
returns timestamptz language plpgsql stable set search_path to 'app_private', 'public' as $function$
declare cfg app_private.mail_settings; t timestamp; d date; w jsonb; ws timestamp; we timestamp; avail numeric; left_m numeric := greatest(p_minutes, 0); i int := 0;
begin
  select * into cfg from app_private.mail_settings where id = 1;
  t := p_from at time zone cfg.tz;
  while i < 60 loop
    d := t::date;
    w := cfg.hours -> extract(isodow from d)::int::text;
    if w is not null and not (d = any(cfg.holidays)) then
      ws := d + make_interval(hours => (w->>0)::int); we := d + make_interval(hours => (w->>1)::int);
      if t < ws then t := ws; end if;
      if t < we then
        avail := extract(epoch from (we - t)) / 60;
        if left_m <= avail then return (t + make_interval(mins => left_m::int)) at time zone cfg.tz; end if;
        left_m := left_m - avail;
      end if;
    end if;
    t := (d + 1)::timestamp; i := i + 1;
  end loop;
  return (t at time zone cfg.tz);
end $function$;

create or replace function app_private.mail_due_at(p_from timestamptz, p_urgency text)
returns timestamptz language sql stable set search_path to 'app_private', 'public' as $function$
  select case
    when p_urgency is null or p_urgency not in ('urgent','high','normal','low') then null
    when p_urgency = 'urgent' then p_from + make_interval(mins => coalesce((s.sla_minutes->>'urgent')::int, 60))
    else app_private.mail_add_business_minutes(p_from, coalesce((s.sla_minutes->>p_urgency)::int, 600)) end
  from app_private.mail_settings s where s.id = 1;
$function$;

create or replace function app_private.mail_urgency_up(p text) returns text language sql immutable as $$
  select case p when 'low' then 'normal' when 'normal' then 'high' when 'high' then 'urgent' else p end $$;

-- ── keep the state in step with the mail ─────────────────────────────────────────────────────────────
create or replace function app_private.trg_mail_work_state()
returns trigger language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare s app_private.mail_thread_state; v_urg text; v_reason text; v_owner uuid; v_due timestamptz;
begin
  if new.thread_key is null then return new; end if;
  -- inbound mail from a person, in a Primary inbox
  if tg_op = 'INSERT' and new.direction = 'in' and new.folder = 'inbox'
     and coalesce(new.urgency, 'none') in ('urgent','high','normal','low') then
    select default_owner into v_owner from app_private.mail_settings where id = 1;
    insert into app_private.mail_thread_state (thread_key, updated_at) values (new.thread_key, now()) on conflict (thread_key) do nothing;
    select * into s from app_private.mail_thread_state where thread_key = new.thread_key for update;
    if s.work_status = 'open' and s.reply_due_at is not null then
      -- still unanswered and they wrote again → one step more urgent, never a later deadline
      v_urg := app_private.mail_urgency_up(app_private.greatest_urgency(s.urgency, new.urgency));
      v_reason := 'wrote again before we replied';
      v_due := least(s.reply_due_at, app_private.mail_due_at(new.created_at, v_urg));
      update app_private.mail_thread_state set urgency = v_urg, urgency_reason = v_reason, reply_due_at = v_due,
             last_in_at = new.created_at, owner_user_id = coalesce(owner_user_id, v_owner), updated_at = now()
       where thread_key = new.thread_key;
      if v_urg is distinct from s.urgency then
        insert into app_private.mail_thread_events (thread_key, kind, detail) values (new.thread_key, 'urgency_up', jsonb_build_object('from', s.urgency, 'to', v_urg));
      end if;
    else
      v_due := app_private.mail_due_at(new.created_at, new.urgency);
      update app_private.mail_thread_state set work_status = 'open', urgency = new.urgency, urgency_reason = new.urgency_reason,
             last_in_at = new.created_at, sla_start_at = new.created_at, reply_due_at = v_due, sla_level = 0, follow_up = false,
             archived_at = null, owner_user_id = coalesce(owner_user_id, v_owner), updated_at = now()
       where thread_key = new.thread_key;
      insert into app_private.mail_thread_events (thread_key, kind, detail)
      values (new.thread_key, 'opened', jsonb_build_object('urgency', new.urgency, 'due', v_due, 'role', new.sender_role));
    end if;
  -- our reply left
  elsif new.direction = 'out' and new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    insert into app_private.mail_thread_state (thread_key, updated_at) values (new.thread_key, now()) on conflict (thread_key) do nothing;
    select * into s from app_private.mail_thread_state where thread_key = new.thread_key for update;
    update app_private.mail_thread_state set work_status = 'waiting', last_out_at = coalesce(new.sent_at, now()),
           first_reply_at = coalesce(first_reply_at, case when last_in_at is not null then coalesce(new.sent_at, now()) end),
           sla_start_at = coalesce(new.sent_at, now()), reply_due_at = null, sla_level = 0, follow_up = false, updated_at = now()
     where thread_key = new.thread_key;
    insert into app_private.mail_thread_events (thread_key, kind, actor, detail)
    values (new.thread_key, 'replied', coalesce(new.sent_by, new.created_by), jsonb_build_object(
      'late', s.reply_due_at is not null and now() > s.reply_due_at,
      'seconds', case when s.work_status = 'open' and s.sla_start_at is not null then extract(epoch from (coalesce(new.sent_at, now()) - s.sla_start_at))::int end));
  end if;
  return new;
end $function$;

create or replace function app_private.greatest_urgency(a text, b text) returns text language sql immutable as $$
  select case greatest(array_position(array['low','normal','high','urgent'], a), array_position(array['low','normal','high','urgent'], b))
    when 4 then 'urgent' when 3 then 'high' when 2 then 'normal' when 1 then 'low' else coalesce(a, b) end $$;

drop trigger if exists z_mail_work_state on app_private.mail_messages;
create trigger z_mail_work_state after insert or update of status on app_private.mail_messages
  for each row execute function app_private.trg_mail_work_state();

-- archive / trash = handled
create or replace function app_private.trg_mail_state_done()
returns trigger language plpgsql security definer set search_path to 'app_private', 'public' as $function$
begin
  if (new.archived_at is not null and old.archived_at is null) or (new.trashed_at is not null and old.trashed_at is null) then
    if new.work_status is distinct from 'done' then
      new.work_status := 'done'; new.reply_due_at := null; new.sla_level := 0; new.follow_up := false;
      insert into app_private.mail_thread_events (thread_key, kind, actor, detail)
      values (new.thread_key, 'status', auth.uid(), jsonb_build_object('to', 'done', 'by', case when new.trashed_at is not null then 'trash' else 'archive' end));
    end if;
  end if;
  return new;
end $function$;
drop trigger if exists mail_state_done on app_private.mail_thread_state;
create trigger mail_state_done before update of archived_at, trashed_at on app_private.mail_thread_state
  for each row execute function app_private.trg_mail_state_done();

-- ── sweep: follow-ups and escalation (every 5 minutes) ───────────────────────────────────────────────
create or replace function app_private.mail_sla_sweep()
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare n_follow int := 0; n_esc int := 0; r record; v_lvl smallint; cfg app_private.mail_settings;
begin
  select * into cfg from app_private.mail_settings where id = 1;
  -- we replied, they went quiet for 3 business days → back on our list as a follow-up
  for r in select * from app_private.mail_thread_state
            where work_status = 'waiting' and last_out_at is not null and trashed_at is null
              and app_private.mail_add_business_minutes(last_out_at, cfg.follow_up_minutes) < now() loop
    update app_private.mail_thread_state set work_status = 'open', follow_up = true, urgency = 'normal', urgency_reason = 'no reply from them in 3 business days',
           sla_start_at = now(), reply_due_at = app_private.mail_due_at(now(), 'normal'), sla_level = 0, archived_at = null, updated_at = now()
     where thread_key = r.thread_key;
    insert into app_private.mail_thread_events (thread_key, kind) values (r.thread_key, 'waiting_expired');
    n_follow := n_follow + 1;
  end loop;
  -- escalation level from how much of the window is used (snoozed threads are paused)
  for r in select * from app_private.mail_thread_state
            where work_status = 'open' and reply_due_at is not null and sla_start_at is not null
              and (snoozed_until is null or snoozed_until <= now()) loop
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

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'mail-sla-sweep';
  perform cron.schedule('mail-sla-sweep', '*/5 * * * *', 'select app_private.mail_sla_sweep()');
end $$;

-- ── staff actions ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.cc_mail_owners()
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $function$
  select case when not public.has_global_permission('comm.view') then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'name', coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email), 'me', u.id = auth.uid()) order by u.email)
      from auth.users u
     where u.id in (select a.user_id from app_private.user_role_assignments a
                      join app_private.role_permissions rp on rp.role_id = a.role_id
                      join app_private.permissions p on p.id = rp.permission_id
                     where a.status = 'active' and (a.expires_at is null or a.expires_at > now()) and a.scope_type = 'global' and p.key = 'comm.send')
  ), '[]'::jsonb) end;
$function$;

create or replace function public.cc_mail_assign(p_threads text[], p_owner uuid)
returns integer language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare v_keys text[] := array(select distinct k from unnest(coalesce(p_threads,'{}')) k where coalesce(btrim(k),'') <> ''); n int;
begin
  if not public.has_global_permission('comm.send') then raise exception 'not authorized' using errcode = '42501'; end if;
  if cardinality(v_keys) = 0 then return 0; end if;
  if exists (select 1 from unnest(v_keys) k where app_private.mail_thread_hidden(k, app_private.mail_visible_boxes())) then
    raise exception 'not authorized for this mailbox' using errcode = '42501'; end if;
  if p_owner is not null and not exists (select 1 from auth.users where id = p_owner) then raise exception 'unknown person' using errcode = '22023'; end if;
  insert into app_private.mail_thread_state (thread_key, updated_at) select k, now() from unnest(v_keys) k on conflict (thread_key) do nothing;
  update app_private.mail_thread_state set owner_user_id = p_owner, updated_by = auth.uid(), updated_at = now()
   where thread_key = any(v_keys) and owner_user_id is distinct from p_owner;
  get diagnostics n = row_count;
  insert into app_private.mail_thread_events (thread_key, kind, actor, detail) select k, 'assigned', auth.uid(), jsonb_build_object('owner', p_owner) from unnest(v_keys) k;
  return n;
end $function$;

create or replace function public.cc_mail_set_status(p_threads text[], p_status text)
returns integer language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare v_keys text[] := array(select distinct k from unnest(coalesce(p_threads,'{}')) k where coalesce(btrim(k),'') <> ''); n int;
begin
  if not public.has_global_permission('comm.send') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_status not in ('open','waiting','done') then raise exception 'unknown status' using errcode = '22023'; end if;
  if cardinality(v_keys) = 0 then return 0; end if;
  if exists (select 1 from unnest(v_keys) k where app_private.mail_thread_hidden(k, app_private.mail_visible_boxes())) then
    raise exception 'not authorized for this mailbox' using errcode = '42501'; end if;
  insert into app_private.mail_thread_state (thread_key, updated_at) select k, now() from unnest(v_keys) k on conflict (thread_key) do nothing;
  update app_private.mail_thread_state set work_status = p_status, follow_up = false, sla_level = 0,
         sla_start_at = case when p_status = 'open' then now() else sla_start_at end,
         reply_due_at = case when p_status = 'open' then app_private.mail_due_at(now(), coalesce(urgency, 'normal')) else null end,
         updated_by = auth.uid(), updated_at = now()
   where thread_key = any(v_keys);
  get diagnostics n = row_count;
  insert into app_private.mail_thread_events (thread_key, kind, actor, detail) select k, 'status', auth.uid(), jsonb_build_object('to', p_status) from unnest(v_keys) k;
  return n;
end $function$;

-- "someone else is on this" — the reader pings every 30 s while a conversation is open
create or replace function public.cc_mail_viewing(p_thread text)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare s app_private.mail_thread_state;
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into s from app_private.mail_thread_state where thread_key = p_thread;
  if s.viewing_by is null or s.viewing_by = auth.uid() or s.viewing_at < now() - interval '90 seconds' then
    insert into app_private.mail_thread_state (thread_key, viewing_by, viewing_at, updated_at) values (p_thread, auth.uid(), now(), now())
    on conflict (thread_key) do update set viewing_by = auth.uid(), viewing_at = now();
    return jsonb_build_object('other', null);
  end if;
  return jsonb_build_object('other', (select coalesce(nullif(raw_user_meta_data->>'full_name',''), email) from auth.users where id = s.viewing_by), 'since', s.viewing_at);
end $function$;

-- counts for the work views
create or replace function public.cc_mail_work_counts()
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $function$
  with v as (select app_private.mail_visible_boxes() b),
  t as (select s.* from app_private.mail_thread_state s, v
         where s.trashed_at is null and not app_private.mail_thread_hidden(s.thread_key, v.b)
           and (s.snoozed_until is null or s.snoozed_until <= now()))
  select case when not public.has_global_permission('comm.view') then '{}'::jsonb else jsonb_build_object(
    'needs_reply', (select count(*) from t where work_status = 'open'),
    'mine',        (select count(*) from t where work_status = 'open' and owner_user_id = auth.uid()),
    'late',        (select count(*) from t where work_status = 'open' and sla_level >= 2),
    'due_soon',    (select count(*) from t where work_status = 'open' and sla_level = 1),
    'waiting',     (select count(*) from t where work_status = 'waiting'),
    'oldest_due',  (select min(reply_due_at) from t where work_status = 'open')) end;
$function$;

-- ── backfill: today's open mail starts its clock now ─────────────────────────────────────────────────
with th as (
  select m.thread_key,
         max(m.created_at) filter (where m.direction = 'in' and m.folder = 'inbox' and coalesce(m.urgency,'none') <> 'none') as last_in,
         max(coalesce(m.sent_at, m.created_at)) filter (where m.direction = 'out' and m.status = 'sent') as last_out,
         (array_agg(m.urgency order by m.created_at desc) filter (where m.direction = 'in' and coalesce(m.urgency,'none') <> 'none'))[1] as urg,
         (array_agg(m.urgency_reason order by m.created_at desc) filter (where m.direction = 'in' and coalesce(m.urgency,'none') <> 'none'))[1] as reason
    from app_private.mail_messages m group by 1
)
insert into app_private.mail_thread_state as s (thread_key, owner_user_id, work_status, urgency, urgency_reason, last_in_at, last_out_at, sla_start_at, reply_due_at, updated_at)
select th.thread_key, (select default_owner from app_private.mail_settings where id = 1),
       case when th.last_out is not null and (th.last_in is null or th.last_out >= th.last_in)
            then case when th.last_out < now() - interval '5 days' then 'done' else 'waiting' end else 'open' end,
       th.urg, th.reason, th.last_in, th.last_out,
       case when th.last_out is not null and (th.last_in is null or th.last_out >= th.last_in) then th.last_out else now() end,
       case when th.last_out is not null and (th.last_in is null or th.last_out >= th.last_in) then null else app_private.mail_due_at(now(), th.urg) end,
       now()
  from th where th.last_in is not null or th.last_out is not null
on conflict (thread_key) do update set owner_user_id = coalesce(s.owner_user_id, excluded.owner_user_id),
  work_status = case when s.archived_at is not null and (excluded.last_in_at is null or excluded.last_in_at <= s.archived_at) or s.trashed_at is not null then 'done' else excluded.work_status end,
  urgency = excluded.urgency, urgency_reason = excluded.urgency_reason, last_in_at = excluded.last_in_at, last_out_at = excluded.last_out_at,
  sla_start_at = excluded.sla_start_at,
  reply_due_at = case when s.archived_at is not null and (excluded.last_in_at is null or excluded.last_in_at <= s.archived_at) or s.trashed_at is not null then null else excluded.reply_due_at end;
