-- bl_rem_0330_reminder_decision_tree
--
-- Carrier reminder engine, part 1: the state it needs and the cadence rules.
-- The decision tree itself is bl_rem_0332, the send is bl_rem_0333_0334, and the
-- six email templates are bl_rem_0331 (+ the helper in bl_rem_0331a).
--
-- Additive and reversible: two new private tables, two new carrier-callable RPCs,
-- one helper. Nothing existing changes.

-- ---------------------------------------------------------------------------
-- Which multi-field forms a carrier OPENED, so "never started" can be told apart
-- from "started and walked away". The localStorage draft only exists on the
-- device they used; this is the server-side half of the same fact.
-- ---------------------------------------------------------------------------
create table if not exists app_private.form_progress (
  carrier_id    uuid        not null,
  form_key      text        not null,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  fields_filled integer     not null default 0,
  primary key (carrier_id, form_key)
);
alter table app_private.form_progress enable row level security;   -- no policies: SECURITY DEFINER only

-- ---------------------------------------------------------------------------
-- Every reminder actually sent. This is what enforces the cadence, and it is the
-- audit trail for "why did this carrier get four emails".
-- ---------------------------------------------------------------------------
create table if not exists app_private.reminder_log (
  id           uuid        primary key default gen_random_uuid(),
  carrier_id   uuid        not null,
  reminder_key text        not null,
  sent_at      timestamptz not null default now(),
  delivery_id  uuid,
  sent_by      uuid
);
alter table app_private.reminder_log enable row level security;
create index if not exists reminder_log_carrier_idx
  on app_private.reminder_log (carrier_id, reminder_key, sent_at desc);

-- ---------------------------------------------------------------------------
-- Cadence. Availability is a daily habit, so it may be nudged once a day.
-- Onboarding is a one-off task, so it stops after four tries — a carrier who has
-- ignored four emails about adding a truck does not need a fifth.
-- ---------------------------------------------------------------------------
create or replace function app_private.reminder_due(p_org uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare v_last timestamptz; v_count int;
begin
  select max(sent_at), count(*) into v_last, v_count
    from app_private.reminder_log where carrier_id = p_org and reminder_key = p_key;
  if v_last is null then return true; end if;
  if p_key in ('avail_confirm','avail_continue') then
    return v_last < now() - interval '20 hours';                  -- at most once a day
  end if;
  return v_count < 4 and v_last < now() - interval '3 days';      -- onboarding: 4 nudges, 3 days apart
end $function$;

revoke execute on function app_private.reminder_due(uuid, text) from anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- Carrier-side telemetry. Deliberately forgiving: an unknown form key or a caller
-- with no carrier org returns quietly instead of raising, because this must never
-- be able to break a form somebody is in the middle of filling in.
-- ---------------------------------------------------------------------------
create or replace function public.cc_form_progress_ping(p_form text, p_fields integer default 0)
returns void
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then return; end if;                        -- never block a form over telemetry
  if p_form not in ('availability','truck','driver') then return; end if;
  insert into app_private.form_progress(carrier_id, form_key, fields_filled)
  values (v_org, p_form, greatest(0, coalesce(p_fields,0)))
  on conflict (carrier_id, form_key) do update
    set updated_at = now(),
        fields_filled = greatest(app_private.form_progress.fields_filled, excluded.fields_filled),
        completed_at = null;                                    -- reopened = in progress again
end $function$;

create or replace function public.cc_form_progress_done(p_form text)
returns void
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then return; end if;
  update app_private.form_progress set completed_at = now(), updated_at = now()
   where carrier_id = v_org and form_key = p_form;
end $function$;

-- Creating a public function applies Supabase's default anon EXECUTE grant. Revoke it.
revoke execute on function public.cc_form_progress_ping(text, integer) from anon, public;
revoke execute on function public.cc_form_progress_done(text)          from anon, public;
grant  execute on function public.cc_form_progress_ping(text, integer) to authenticated;
grant  execute on function public.cc_form_progress_done(text)          to authenticated;
