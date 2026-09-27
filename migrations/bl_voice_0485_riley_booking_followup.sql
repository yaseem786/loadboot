-- bl_voice_0485_riley_booking_followup.sql
-- Riley call plans, slice 2 (27 Sep 2026): BOOK the call, then let the brain decide the NEXT STEP.
--
--   ready plan ──Book with Riley──► lc_calls (source 'account', status scheduled, inside calling hours)
--        │                           └─ voice_run_scheduled (cron */5) re-checks every guardrail, then retell_dial()
--        ▼
--   retell_webhook call_ended / call_analyzed ──► plan called / no_answer + outcome
--        ▼
--   answered  → brain job (source voice, route voice_followup): OUTCOME · NEXT ACTION (second_call | email | staff_task | none)
--               · WHEN · WHY · CALL NOTE · EMAIL SUBJECT/BODY · STAFF TASK · DO NOT CALL
--   no answer → rule: second call next business day at the other time of day (attempts 1–2), email after the third
--        ▼
--   CC → Riley → Call plans → Next step: staff approve (Plan 2nd call · Send email · Create task · Dismiss · Do-not-call).
--   tool.schedule_riley_call in AUTO mode: the brain's second call is planned AND booked by itself; emails always wait for a person.
--
-- GUARDRAILS, checked when booking AND again right before dialling (riley_dial_gate):
--   tool.schedule_riley_call enabled + live (mode deny = never; auto-booking needs mode auto) · brain master switch on ·
--   real carrier (never demo/store-review, never a dispatcher — §14.2) · consent basis on the plan · valid US number ·
--   not on the Riley do-not-call list (app_private.voice_dnc) · no SMS STOP on the number · Retell configured ·
--   Riley Outbound prompt knows "account" calls AND is published · one call per carrier per 20 h, three per 7 days,
--   three attempts per topic, tool.max_per_day overall · calling hours Mon–Fri 09:00–18:30 carrier local time
--   (home_base state; unknown = 11:00–18:30 ET, which is inside 8–21 local everywhere in the lower 48).
--   "Not interested" / "wrong number" from Riley's analysis, or the brain reading "don't call me" in the transcript,
--   puts the number on voice_dnc and cancels anything booked. Riley's prompt already says "I will not call again".
--
-- COST FIX (owner question 27 Sep: first plan cost $0.10 against a $0.02 estimate): the whole 54k-char KB was the
-- cached system block; with ~1 voice job a day every job paid the 1-hour cache WRITE (23 120 tokens × $4/M = $0.093).
-- brain_config.lean_routes = {voice_plan, voice_followup}: those routes get rules + facts + permissions only, and call
-- kb_search when they need a policy. Expected ≈ $0.015 per plan.
--
-- Staging first, then prod. Additive. Anon SECURITY DEFINER surface unchanged (36 prod / 35 staging): every new public
-- function revokes public + anon explicitly (CLAUDE.md §4). Live functions (retell_webhook, voice_run_scheduled,
-- brain_sink, brain_user_text, cc_riley_plan_set) are patched by ANCHOR on their current definition — retell_webhook
-- differs between prod and staging, so it is never retyped.
--
-- ROLLBACK: flip tool.schedule_riley_call off (nothing books or dials). Code rollback: re-apply the pre-0485 definitions
-- of the five patched functions (pg_get_functiondef before applying), riley_plan_json / cc_riley_plan_create /
-- brain_system from bl_voice_0483 / bl_brain_0470; drop the new functions and app_private.voice_dnc.

-- ---------------------------------------------------------------- 0. anchor patch helper (dropped at the end)
create or replace function app_private._p485(p_fn regprocedure, p_anchor text, p_new text, p_marker text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn); n int;
begin
  if position(p_marker in d) > 0 then return; end if;                -- already patched: idempotent
  n := (length(d) - length(replace(d, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if n <> 1 then raise exception 'bl_voice_0485: anchor found % times in % (need exactly 1): %', n, p_fn, left(p_anchor, 80); end if;
  execute replace(d, p_anchor, p_new);
end $$;

-- ---------------------------------------------------------------- 1. schema
alter table app_private.brain_config add column if not exists lean_routes text[] not null default '{}';

alter table app_private.riley_call_plans
  add column if not exists parent_id       bigint references app_private.riley_call_plans(id) on delete set null,
  add column if not exists attempt         integer not null default 1,
  add column if not exists auto_book       boolean not null default false,   -- book by itself once ready (tool in auto mode)
  add column if not exists scheduled_for   timestamptz,
  add column if not exists booked_by       uuid,
  add column if not exists booked_at       timestamptz,
  add column if not exists called_at       timestamptz,
  add column if not exists outcome         jsonb,                            -- call facts copied from lc_calls
  add column if not exists followup_status text,
  add column if not exists followup_job_id bigint,
  add column if not exists followup_text   text,                             -- the brain's answer, verbatim
  add column if not exists followup        jsonb,                            -- parsed next step (brain or rule)
  add column if not exists followup_usd    numeric(10,6) not null default 0,
  add column if not exists followup_done   jsonb;                            -- what a person (or auto mode) did with it

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'app_private.riley_call_plans'::regclass and contype = 'c'
            and (pg_get_constraintdef(oid) like '%reason%' or pg_get_constraintdef(oid) like '%status%')
  loop execute format('alter table app_private.riley_call_plans drop constraint %I', c.conname); end loop;
end $$;
alter table app_private.riley_call_plans
  add constraint riley_call_plans_reason_check check (reason in ('welcome','onboarding_gap','document_missing','choice_pending','no_reply','custom','follow_up')),
  add constraint riley_call_plans_status_check check (status in ('planning','ready','failed','scheduled','dialing','called','no_answer','cancelled')),
  add constraint riley_call_plans_followup_check check (followup_status is null or followup_status in ('pending','thinking','proposed','done','dismissed','failed'));
create index if not exists riley_call_plans_call_idx     on app_private.riley_call_plans (call_id);
create index if not exists riley_call_plans_fjob_idx     on app_private.riley_call_plans (followup_job_id);
create index if not exists riley_call_plans_parent_idx   on app_private.riley_call_plans (parent_id);

-- Riley's own do-not-call list (voice only; email opt-outs stay in the unsubscribe engine, CLAUDE.md §6.5).
create table if not exists app_private.voice_dnc (
  last10     text primary key check (last10 ~ '^[0-9]{10}$'),
  reason     text not null,
  source     text not null check (source in ('call','brain','staff','sms_stop')),
  plan_id    bigint,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table app_private.voice_dnc enable row level security;
comment on table app_private.voice_dnc is 'bl_voice_0485: numbers Riley never dials (caller asked, wrong number, not interested, staff). Checked by riley_dial_gate at booking and again before every dial.';

-- ---------------------------------------------------------------- 2. time zone + calling window + DNC helpers
create or replace function app_private.us_state_tz(p_place text)
returns text language sql immutable as $$
  select case
    when s = any('{CT,DE,DC,FL,GA,IN,KY,ME,MD,MA,MI,NH,NJ,NY,NC,OH,PA,RI,SC,VT,VA,WV}') then 'America/New_York'
    when s = any('{AL,AR,IL,IA,KS,LA,MN,MS,MO,NE,ND,OK,SD,TN,TX,WI}')                   then 'America/Chicago'
    when s = 'AZ'                                                                        then 'America/Phoenix'
    when s = any('{CO,ID,MT,NM,UT,WY}')                                                  then 'America/Denver'
    when s = any('{CA,NV,OR,WA}')                                                        then 'America/Los_Angeles'
    when s = 'AK' then 'America/Anchorage'
    when s = 'HI' then 'Pacific/Honolulu' end
  from (select upper(substring(coalesce(p_place, '') from '(?:^|[\s,])([A-Za-z]{2})\.?\s*(?:[0-9]{5}(?:-[0-9]{4})?)?\s*$')) s) x;
$$;

create or replace function app_private.riley_plan_tz(p_org uuid)
returns text language sql stable security definer set search_path = app_private, public as $$
  select app_private.us_state_tz(pr.home_base) from public.organizations o join public.profiles pr on pr.id = o.owner_user_id where o.id = p_org;
$$;

-- First allowed moment >= p_from: Mon–Fri 09:00–18:30 in the carrier's zone; unknown zone = 11:00–18:30 Eastern.
create or replace function app_private.riley_call_window(p_tz text, p_from timestamptz)
returns timestamptz language plpgsql stable as $$
declare tz text := coalesce(p_tz, 'America/New_York');
        s time := case when p_tz is null then time '11:00' else time '09:00' end;
        e time := time '18:30';
        loc timestamp := coalesce(p_from, now()) at time zone tz; d date := loc::date; i int;
begin
  for i in 0..10 loop
    if extract(isodow from d) between 1 and 5 then
      if i = 0 and loc::time >= s and loc::time <= e then return coalesce(p_from, now()); end if;
      if i > 0 or loc::time < s then return (d + s) at time zone tz; end if;
    end if;
    d := d + 1;
  end loop;
  return null;
end $$;

create or replace function app_private.voice_dnc_add(p_number text, p_reason text, p_source text, p_plan bigint, p_actor uuid)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare v10 text := right(regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g'), 10);
begin
  if length(v10) <> 10 then return; end if;
  insert into app_private.voice_dnc (last10, reason, source, plan_id, created_by)
  values (v10, left(coalesce(nullif(btrim(p_reason), ''), 'do not call'), 300), p_source, p_plan, p_actor)
  on conflict (last10) do nothing;
  -- nothing already booked to this number may still ring
  update app_private.lc_calls set status = 'cancelled', updated_at = now()
   where source = 'account' and status = 'scheduled' and right(regexp_replace(coalesce(to_number, ''), '[^0-9]', '', 'g'), 10) = v10;
  update app_private.riley_call_plans
     set status = case when status in ('scheduled', 'ready', 'planning') then 'cancelled' else status end,
         auto_book = false,
         closed_at = case when status in ('scheduled', 'ready', 'planning') then now() else closed_at end,
         error = case when status in ('scheduled', 'ready', 'planning') then 'Number put on the Riley do-not-call list: ' || left(coalesce(p_reason, ''), 200) else error end,
         updated_at = now()
   where right(regexp_replace(coalesce(to_number, ''), '[^0-9]', '', 'g'), 10) = v10 and status in ('scheduled', 'ready', 'planning');
end $$;

-- ---------------------------------------------------------------- 3. the gate (booking AND pre-dial)
create or replace function app_private.riley_dial_gate(p app_private.riley_call_plans, p_auto boolean default false, p_slot timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare t app_private.brain_permissions; o public.organizations; cfg app_private.retell_config; pr app_private.riley_prompts;
        v10 text; n int; v_slot timestamptz := coalesce(p_slot, now()); v_dnc app_private.voice_dnc; v_last timestamptz;
begin
  select * into t from app_private.brain_permissions where key = 'tool.schedule_riley_call';
  if t.key is null or not t.enabled or t.status <> 'live' or t.mode = 'deny' then
    return jsonb_build_object('ok', false, 'code', 'tool_off', 'reason',
      'Riley booking is off: tool.schedule_riley_call is ' || case when t.key is null then 'missing' when t.status <> 'live' then t.status
        when t.mode = 'deny' then 'set to deny' else 'switched off' end || ' (CC → AI Brain → Permissions).');
  end if;
  if p_auto and t.mode <> 'auto' then
    return jsonb_build_object('ok', false, 'code', 'auto_off', 'reason', 'Automatic booking needs tool.schedule_riley_call in auto mode (it is in ' || t.mode || ' mode, so a person books).');
  end if;
  if not coalesce((select c.enabled from app_private.brain_config c where c.id), false) then
    return jsonb_build_object('ok', false, 'code', 'brain_off', 'reason', 'The AI Brain master switch is off.');
  end if;
  select * into o from public.organizations where id = p.org_id;
  if o.id is null or o.kind <> 'carrier' or coalesce(o.is_demo, false) then
    return jsonb_build_object('ok', false, 'code', 'not_carrier', 'reason', 'Only real carrier accounts are called — never demo / store-review accounts, never dispatchers.');
  end if;
  if coalesce((p.consent ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'no_consent', 'reason', 'No consent basis is recorded for this number.');
  end if;
  if coalesce(p.to_number, '') !~ '^\+1[2-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_number', 'reason', 'The number on the plan is not a valid US number.');
  end if;
  v10 := right(p.to_number, 10);
  select * into v_dnc from app_private.voice_dnc where last10 = v10;
  if v_dnc.last10 is not null then
    return jsonb_build_object('ok', false, 'code', 'dnc', 'reason', 'On the Riley do-not-call list since ' || to_char(v_dnc.created_at at time zone 'America/New_York', 'Mon DD') || ': ' || v_dnc.reason);
  end if;
  if (select max(s.revoked_at) from app_private.sms_consent s where right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v10)
     > coalesce((select max(s.consented_at) from app_private.sms_consent s where right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v10 and s.revoked_at is null), '-infinity'::timestamptz) then
    return jsonb_build_object('ok', false, 'code', 'sms_stop', 'reason', 'The carrier texted STOP to our SMS line — we treat that as "do not call" too.');
  end if;
  select * into cfg from app_private.retell_config where id = 1;
  if cfg.api_key is null or cfg.outbound_agent_id is null or nullif(cfg.from_number, '') is null then
    return jsonb_build_object('ok', false, 'code', 'retell_off', 'reason', 'Retell is not configured on this environment.');
  end if;
  select * into pr from app_private.riley_prompts where agent_key = 'outbound';
  if pr.general_prompt is null or position('"account"' in pr.general_prompt) = 0 then
    return jsonb_build_object('ok', false, 'code', 'prompt_old', 'reason', 'Riley Outbound''s prompt does not know account calls yet.');
  end if;
  if pr.published_at is null or pr.published_at < pr.updated_at then
    return jsonb_build_object('ok', false, 'code', 'prompt_unpublished', 'reason', 'Riley Outbound has an unpublished prompt change — CC → Riley → Prompts → Publish Outbound first, so Riley uses the account-call opener.');
  end if;
  -- caps: around the slot we would dial at, not around now (a follow-up booked for tomorrow is fine)
  select max(coalesce(x.called_at, x.scheduled_for, x.booked_at)) into v_last from app_private.riley_call_plans x
   where x.id <> p.id and x.status in ('scheduled', 'dialing', 'called', 'no_answer') and (x.org_id = p.org_id or right(x.to_number, 10) = v10)
     and coalesce(x.called_at, x.scheduled_for, x.booked_at) between v_slot - interval '20 hours' and v_slot + interval '20 hours';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'code', 'cap_day', 'last', v_last, 'reason', 'One Riley call per carrier per day — another call to this carrier is at ' || to_char(v_last at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM') || ' ET.');
  end if;
  select count(*) into n from app_private.riley_call_plans x
   where x.id <> p.id and x.status in ('scheduled', 'dialing', 'called', 'no_answer') and (x.org_id = p.org_id or right(x.to_number, 10) = v10)
     and coalesce(x.called_at, x.scheduled_for, x.booked_at) between v_slot - interval '7 days' and v_slot;
  if n >= 3 then
    return jsonb_build_object('ok', false, 'code', 'cap_week', 'reason', 'Three Riley calls to this carrier in 7 days is the limit.');
  end if;
  if p.attempt > 3 then
    return jsonb_build_object('ok', false, 'code', 'cap_attempts', 'reason', 'Three attempts on one topic is the limit — send an email or hand it to a person.');
  end if;
  select count(*) into n from app_private.riley_call_plans x where x.id <> p.id and x.booked_at >= date_trunc('day', now()) and x.status in ('scheduled', 'dialing', 'called', 'no_answer');
  if n >= coalesce(t.max_per_day, 100) then
    return jsonb_build_object('ok', false, 'code', 'cap_global', 'reason', 'The daily limit for Riley bookings (' || t.max_per_day || ') is reached.');
  end if;
  return jsonb_build_object('ok', true, 'mode', t.mode);
end $$;

-- ---------------------------------------------------------------- 4. plan creation (shared by staff + follow-ups)
create or replace function app_private.riley_plan_new(p_org uuid, p_reason text, p_note text, p_lang text, p_actor uuid, p_parent bigint default null, p_auto_book boolean default false)
returns jsonb language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_org public.organizations; v_prof public.profiles; v_p app_private.riley_call_plans; v_par app_private.riley_call_plans;
        v_num text; v_digits text; v_consent jsonb; v_open bigint; v_ctx jsonb; v_q jsonb; v_sms app_private.sms_consent;
begin
  if p_reason is null or p_reason not in ('welcome','onboarding_gap','document_missing','choice_pending','no_reply','custom','follow_up') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = p_org;
  if v_org.id is null then raise exception 'carrier not found' using errcode = 'P0002'; end if;
  if v_org.kind <> 'carrier' then return jsonb_build_object('error', 'Call plans are for carriers only (owner rule: no calls to dispatchers — plan §14.2).'); end if;
  if coalesce(v_org.is_demo, false) then return jsonb_build_object('error', 'Demo / store-review accounts are never called.'); end if;
  select * into v_prof from public.profiles where id = v_org.owner_user_id;

  v_digits := regexp_replace(coalesce(v_prof.phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := right(v_digits, 10); end if;
  if length(v_digits) <> 10 then
    return jsonb_build_object('error', 'No usable US phone number on this carrier''s profile — nothing to plan a call to.');
  end if;
  v_num := '+1' || v_digits;

  if p_parent is not null then
    select * into v_par from app_private.riley_call_plans where id = p_parent;
    if v_par.id is null or v_par.org_id <> v_org.id then return jsonb_build_object('error', 'follow-up parent not found for this carrier'); end if;
    if v_par.attempt >= 3 then return jsonb_build_object('error', 'Three attempts on one topic is the limit — send an email or hand it to a person.'); end if;
  else
    -- One open planning job per carrier: return it instead of paying twice.
    select id into v_open from app_private.riley_call_plans where org_id = v_org.id and status = 'planning' and created_at > now() - interval '5 minutes' order by id desc limit 1;
    if v_open is not null then
      select * into v_p from app_private.riley_call_plans where id = v_open;
      return app_private.riley_plan_json(v_p) || jsonb_build_object('reused', true);
    end if;
  end if;

  -- TCPA basis, recorded on the plan: the signup phone of an existing account (service call about their own account);
  -- an sms_consent row on the number adds the explicit-consent method when there is one.
  select * into v_sms from app_private.sms_consent s where s.revoked_at is null
     and right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v_digits limit 1;
  v_consent := jsonb_build_object(
    'ok',     true,
    'basis',  'existing account — number given at signup; service call about their own account',
    'method', coalesce(v_sms.method, 'signup_phone'),
    'at',     coalesce(v_sms.consented_at, v_prof.created_at),
    'sms_consent', v_sms.number is not null);

  insert into app_private.riley_call_plans (org_id, contact_name, to_number, contact_role, consent, reason, note, lang, created_by, parent_id, attempt, auto_book)
  values (v_org.id, coalesce(nullif(v_prof.contact_name, ''), nullif(v_prof.legal_owner_name, '')), v_num, 'carrier', v_consent, p_reason,
          nullif(left(btrim(coalesce(p_note, '')), 1500), ''), case when p_lang = 'es' then 'es' else 'en' end, p_actor,
          p_parent, coalesce(v_par.attempt, 0) + 1, coalesce(p_auto_book, false))
  returning * into v_p;

  v_ctx := app_private.riley_plan_context(v_p.id);
  v_q := app_private.brain_enqueue('voice', v_p.id::text, 'voice_plan',
           'Write the call plan for ' || coalesce(v_org.name, 'this carrier') || ' (reason: ' || p_reason || case when p_parent is not null then ', attempt ' || v_p.attempt || ' of 3' else '' end || ').',
           v_ctx, null, array['get_facts', 'kb_search', 'account_lookup'], v_p.lang);

  update app_private.riley_call_plans
     set job_id = (v_q ->> 'job_id')::bigint,
         status = case when v_q ->> 'status' = 'queued' then 'planning' else 'failed' end,
         error  = case when v_q ->> 'status' = 'queued' then null else coalesce(v_q ->> 'error', 'brain refused the job') end,
         updated_at = now()
   where id = v_p.id
   returning * into v_p;
  return app_private.riley_plan_json(v_p);
end $$;

create or replace function public.cc_riley_plan_create(p_org uuid, p_reason text, p_note text default null, p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $function$
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return app_private.riley_plan_new(p_org, p_reason, p_note, p_lang, auth.uid(), null, false);
end $function$;

-- ---------------------------------------------------------------- 5. booking = the tool.schedule_riley_call executor
create or replace function app_private.riley_plan_book(p_plan bigint, p_when timestamptz, p_actor uuid, p_force boolean, p_auto boolean)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare p app_private.riley_call_plans; g jsonb; tz text; v_slot timestamptz; v_call bigint;
begin
  select * into p from app_private.riley_call_plans where id = p_plan for update;
  if p.id is null then return jsonb_build_object('error', 'plan not found'); end if;
  if p.status <> 'ready' then return jsonb_build_object('error', 'Only a ready plan can be booked (this one is ' || p.status || ').'); end if;
  if nullif(btrim(coalesce(p.plan_text, '')), '') is null then return jsonb_build_object('error', 'The plan has no briefing text.'); end if;
  if coalesce(p.confidence, 1) < 0.6 or p.review_note is not null then
    if p_auto then return jsonb_build_object('error', 'Auto-booking skipped: the brain flagged this plan for a person to check first.'); end if;
    if not coalesce(p_force, false) then
      return jsonb_build_object('error', 'The brain flagged this plan (' || coalesce(p.review_note, 'low confidence') || '). Read it, then confirm to book anyway.', 'needs_confirm', true);
    end if;
  end if;
  tz := app_private.riley_plan_tz(p.org_id);
  v_slot := app_private.riley_call_window(tz, greatest(coalesce(p_when, now()), now()));
  g := app_private.riley_dial_gate(p, p_auto, v_slot);
  if not coalesce((g ->> 'ok')::boolean, false) and g ->> 'code' = 'cap_day' and (p_when is null or p_auto) then
    -- "next allowed time" means the next slot after the other call, not a refusal
    v_slot := app_private.riley_call_window(tz, (g ->> 'last')::timestamptz + interval '20 hours 5 minutes');
    g := app_private.riley_dial_gate(p, p_auto, v_slot);
  end if;
  if not coalesce((g ->> 'ok')::boolean, false) then
    if p.job_id is not null then
      insert into app_private.brain_actions (job_id, tool, payload, result, ok, outcome)
      values (p.job_id, 'schedule_riley_call', jsonb_build_object('plan_id', p.id, 'auto', p_auto, 'by', p_actor), g, false, 'denied');
    end if;
    return jsonb_build_object('error', g ->> 'reason', 'gate', g);
  end if;
  if v_slot is null or v_slot > now() + interval '14 days' then return jsonb_build_object('error', 'No calling window in the next 14 days.'); end if;

  insert into app_private.lc_calls (direction, to_number, contact_name, contact_role, topic, context, source, org_id, requested_by, status, scheduled_at)
  values ('outbound', p.to_number, p.contact_name, 'carrier', 'your LoadBoot carrier account', p.plan_text, 'account', p.org_id, p_actor, 'scheduled', v_slot)
  returning id into v_call;

  update app_private.riley_call_plans
     set status = 'scheduled', call_id = v_call, scheduled_for = v_slot, booked_by = p_actor, booked_at = now(), auto_book = false, error = null, updated_at = now()
   where id = p.id returning * into p;
  if p.job_id is not null then
    insert into app_private.brain_actions (job_id, tool, payload, result, ok, outcome)
    values (p.job_id, 'schedule_riley_call', jsonb_build_object('plan_id', p.id, 'auto', p_auto, 'by', p_actor, 'forced', coalesce(p_force, false)),
            jsonb_build_object('lc_call_id', v_call, 'scheduled_for', v_slot, 'tz', coalesce(tz, 'unknown → Eastern window')), true, 'executed');
  end if;
  return app_private.riley_plan_json(p) || jsonb_build_object('booked', true);
end $$;

create or replace function public.cc_riley_plan_book(p_id bigint, p_when timestamptz default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $function$
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return app_private.riley_plan_book(p_id, p_when, auth.uid(), p_force, false);
end $function$;

-- What the CC card shows: the gate at the slot "Next allowed time" would pick (same shift as riley_plan_book).
create or replace function app_private.riley_plan_gate_view(p app_private.riley_call_plans)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare tz text := app_private.riley_plan_tz(p.org_id); v_slot timestamptz; g jsonb;
begin
  v_slot := app_private.riley_call_window(tz, now());
  g := app_private.riley_dial_gate(p, false, v_slot);
  if not coalesce((g ->> 'ok')::boolean, false) and g ->> 'code' = 'cap_day' then
    v_slot := app_private.riley_call_window(tz, (g ->> 'last')::timestamptz + interval '20 hours 5 minutes');
    g := app_private.riley_dial_gate(p, false, v_slot);
  end if;
  return g || jsonb_build_object('next_slot', v_slot);
end $$;

-- ---------------------------------------------------------------- 6. pre-dial re-check + sweep (voice_run_scheduled)
create or replace function app_private.riley_plan_predial(p_call bigint)
returns text language plpgsql security definer set search_path = app_private, public as $$
declare c app_private.lc_calls; p app_private.riley_call_plans; g jsonb; tz text; v_slot timestamptz;
begin
  select * into c from app_private.lc_calls where id = p_call;
  if c.id is null or coalesce(c.source, '') <> 'account' then return 'dial'; end if;   -- every other callback: unchanged
  begin
    select * into p from app_private.riley_call_plans where call_id = c.id for update;
    if p.id is null or p.status <> 'scheduled' then
      update app_private.lc_calls set status = 'cancelled', updated_at = now() where id = c.id;
      return 'cancel';
    end if;
    tz := app_private.riley_plan_tz(p.org_id);
    v_slot := app_private.riley_call_window(tz, now());
    if v_slot is null or v_slot > now() + interval '2 minutes' then
      update app_private.lc_calls set scheduled_at = v_slot, updated_at = now() where id = c.id;
      update app_private.riley_call_plans set scheduled_for = v_slot, updated_at = now() where id = p.id;
      return 'later';
    end if;
    -- auto-booked plans must still be in auto mode at dial time; staff-booked ones need the tool on
    g := app_private.riley_dial_gate(p, coalesce(p.booked_by is null, false), now());
    if not coalesce((g ->> 'ok')::boolean, false) then
      update app_private.lc_calls set status = 'cancelled', updated_at = now() where id = c.id;
      update app_private.riley_call_plans set status = 'ready', call_id = null, scheduled_for = null,
             error = 'Not dialled ' || to_char(now() at time zone 'America/New_York', 'Mon DD HH12:MI AM') || ' ET: ' || (g ->> 'reason'), updated_at = now()
       where id = p.id;
      if p.job_id is not null then
        insert into app_private.brain_actions (job_id, tool, payload, result, ok, outcome)
        values (p.job_id, 'schedule_riley_call', jsonb_build_object('plan_id', p.id, 'stage', 'predial'), g, false, 'denied');
      end if;
      return 'cancel';
    end if;
    update app_private.riley_call_plans set status = 'dialing', updated_at = now() where id = p.id;
    return 'dial';
  exception when others then
    raise warning 'riley_plan_predial %: %', p_call, sqlerrm;
    return 'hold';                                                         -- fail closed: a plan call never dials on an error
  end;
end $$;

create or replace function app_private.riley_followup_default_time(p app_private.riley_call_plans)
returns timestamptz language plpgsql stable security definer set search_path = app_private, public as $$
declare tz text := app_private.riley_plan_tz(p.org_id); z text; h int; d date; v timestamptz; v_min timestamptz;
begin
  z := coalesce(tz, 'America/New_York');
  h := extract(hour from (coalesce(p.called_at, p.scheduled_for, now()) at time zone z))::int;
  d := (coalesce(p.called_at, p.scheduled_for, now()) at time zone z)::date + 1;
  v := app_private.riley_call_window(tz, (d + case when h < 13 then time '14:00' else time '10:00' end) at time zone z);
  -- never earlier than the one-call-per-day cap allows (riley_dial_gate cap_day)
  v_min := coalesce(p.called_at, p.scheduled_for, now()) + interval '20 hours 5 minutes';
  if v is null or v < v_min then v := app_private.riley_call_window(tz, v_min); end if;
  return v;
end $$;

create or replace function app_private.riley_plan_sweep()
returns void language plpgsql security definer set search_path = app_private, public as $$
declare r record; v_when timestamptz; v jsonb;
begin
  -- a) the dialer cancelled a booked plan call (another call to the number was live): back to ready, say why
  for r in select p.id from app_private.riley_call_plans p join app_private.lc_calls c on c.id = p.call_id
            where p.status in ('scheduled', 'dialing') and c.status = 'cancelled' loop
    update app_private.riley_call_plans set status = 'ready', call_id = null, scheduled_for = null,
           error = 'The dialer cancelled this booking (another call to the number was in progress). Book again.', updated_at = now()
     where id = r.id;
  end loop;
  -- b) dialled but Retell never reported back: we do not know, so it counts as not reached
  for r in select p.id from app_private.riley_call_plans p join app_private.lc_calls c on c.id = p.call_id
            where p.status = 'dialing' and c.status = 'no-result' loop
    update app_private.riley_call_plans set status = 'no_answer', called_at = now(), closed_at = now(),
           outcome = jsonb_build_object('lc_status', 'no-result', 'duration_sec', 0, 'event', 'sweep'), updated_at = now()
     where id = r.id;
    perform app_private.riley_followup_rule_noanswer(r.id);
  end loop;
  -- c) answered but call_analyzed never came (a third of calls): think from the transcript after 10 minutes
  for r in select id from app_private.riley_call_plans where status = 'called' and followup_status = 'pending' and called_at < now() - interval '10 minutes' loop
    perform app_private.riley_followup_enqueue(r.id);
  end loop;
  -- d) auto mode: follow-up plans the brain wrote book themselves at the time the follow-up suggested
  for r in select p.id, p.parent_id from app_private.riley_call_plans p where p.auto_book and p.status = 'ready' and p.booked_at is null limit 10 loop
    select (x.followup ->> 'suggested_at')::timestamptz into v_when from app_private.riley_call_plans x where x.id = r.parent_id;
    v := app_private.riley_plan_book(r.id, v_when, null, false, true);
    if nullif(v ->> 'error', '') is not null then
      update app_private.riley_call_plans set auto_book = false, error = 'Auto-booking stopped: ' || (v ->> 'error'), updated_at = now() where id = r.id;
    end if;
  end loop;
end $$;

select app_private._p485('app_private.voice_run_scheduled()'::regprocedure,
  $a$   where status='dialing' and updated_at < now() - interval '3 minutes';$a$,
  $a$   where status='dialing' and updated_at < now() - interval '3 minutes';
  -- bl_voice_0485: Riley call plans (cancelled / no-result / late analysis / auto-booking). Never blocks callbacks.
  begin perform app_private.riley_plan_sweep(); exception when others then raise warning 'riley_plan_sweep: %', sqlerrm; end;$a$,
  'bl_voice_0485: Riley call plans (cancelled');
select app_private._p485('app_private.voice_run_scheduled()'::regprocedure,
  $a$    perform app_private.retell_dial(r.id);$a$,
  $a$    if app_private.riley_plan_predial(r.id) <> 'dial' then continue; end if;   -- bl_voice_0485 predial: plan calls re-checked
    perform app_private.retell_dial(r.id);$a$,
  'bl_voice_0485 predial');

-- ---------------------------------------------------------------- 7. after the call
create or replace function app_private.riley_plan_notify(p app_private.riley_call_plans, p_title text, p_body text)
returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
  values ('staff', 'in_app', 'voice.plan_followup',
          jsonb_build_object('title', p_title, 'body', left(coalesce(p_body, ''), 300), 'tone', 'info', 'url', '/riley?tab=plans&id=' || p.id), 'sent', now());
exception when others then null;
end $$;

create or replace function app_private.riley_followup_rule_noanswer(p_plan bigint)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare p app_private.riley_call_plans; f jsonb; v_first text; v_when timestamptz;
begin
  select * into p from app_private.riley_call_plans where id = p_plan for update;
  if p.id is null or p.status <> 'no_answer' or p.followup_status is not null then return; end if;
  v_first := coalesce(nullif(split_part(btrim(coalesce(p.contact_name, '')), ' ', 1), ''), 'there');
  if p.attempt < 3 then
    v_when := app_private.riley_followup_default_time(p);
    f := jsonb_build_object('source', 'rule', 'action', 'second_call', 'outcome', 'No answer (attempt ' || p.attempt || ' of 3).',
           'when', 'next business day, the other time of day', 'suggested_at', v_when,
           'why', 'Nobody picked up. A second try at a different time of day reaches most owner-operators.',
           'call_note', 'Attempt ' || (p.attempt + 1) || ' of 3 — we could not reach them on ' || to_char(coalesce(p.called_at, now()) at time zone 'America/New_York', 'Dy Mon DD') ||
                        '. Same goal as before: ' || coalesce(p.plan ->> 'goal', 'see the earlier plan') || ' Keep it short; if voicemail again, leave the one-line account voicemail.');
  else
    f := jsonb_build_object('source', 'rule', 'action', 'email', 'outcome', 'No answer after three attempts.',
           'when', 'now', 'why', 'Three calls without an answer — an email is the better next step.',
           'email_subject', 'We tried to reach you about your LoadBoot account',
           'email_body', 'Hi ' || v_first || ',' || E'\n\n' ||
             'Our assistant Riley tried to reach you by phone a few times about your LoadBoot carrier account. Nothing is wrong — we just wanted to go over the next step with you.' || E'\n\n' ||
             'You can pick up where you left off any time: log in at loadboot.com and open your dashboard. Or simply reply to this email with a good time to talk and we will fit around you.' || E'\n\n' ||
             'Thanks,');
  end if;
  update app_private.riley_call_plans set followup = f, followup_status = 'proposed', updated_at = now() where id = p.id returning * into p;
  perform app_private.riley_plan_notify(p, '📵 Riley could not reach ' || coalesce((select name from public.organizations where id = p.org_id), 'a carrier'),
                                        case when f ->> 'action' = 'second_call' then 'Suggested: second try ' || coalesce(to_char((f ->> 'suggested_at')::timestamptz at time zone 'America/New_York', 'Dy HH12:MI AM') || ' ET', 'tomorrow') else 'Suggested: follow-up email' end);
  perform app_private.riley_followup_auto(p.id);
end $$;

create or replace function app_private.riley_followup_enqueue(p_plan bigint)
returns void language plpgsql security definer set search_path = app_private, public, extensions as $$
declare p app_private.riley_call_plans; c app_private.lc_calls; v_ctx jsonb; v_q jsonb; v_email boolean;
begin
  select * into p from app_private.riley_call_plans where id = p_plan for update;
  if p.id is null or p.status <> 'called' or p.followup_job_id is not null or p.followup_status not in ('pending', 'failed') then return; end if;
  select * into c from app_private.lc_calls where id = p.call_id;
  select pr.email is not null into v_email from public.organizations o join public.profiles pr on pr.id = o.owner_user_id where o.id = p.org_id;
  v_ctx := app_private.riley_plan_context(p.id);
  if v_ctx is null then
    update app_private.riley_call_plans set followup_status = 'failed', followup = jsonb_build_object('error', 'no carrier file (demo or deleted account)'), updated_at = now() where id = p.id;
    return;
  end if;
  v_ctx := v_ctx || jsonb_build_object('attempt', p.attempt, 'plan_text', left(coalesce(p.plan_text, ''), 3000), 'email_on_file', coalesce(v_email, false),
    'call', jsonb_strip_nulls(jsonb_build_object('called_at', p.called_at, 'status', c.status, 'duration_sec', c.duration_sec, 'summary', left(c.summary, 1500),
                                                 'sentiment', c.sentiment, 'analysis', c.analysis, 'transcript', left(c.transcript, 8000))));
  v_q := app_private.brain_enqueue('voice', p.id::text, 'voice_followup',
           'Decide and draft the next step after Riley''s call to ' || coalesce((select name from public.organizations where id = p.org_id), 'this carrier') || '.',
           v_ctx, null, array['get_facts', 'kb_search', 'account_lookup'], p.lang);
  update app_private.riley_call_plans
     set followup_job_id = (v_q ->> 'job_id')::bigint,
         followup_status = case when v_q ->> 'status' = 'queued' then 'thinking' else 'failed' end,
         followup = case when v_q ->> 'status' = 'queued' then followup else jsonb_build_object('error', coalesce(v_q ->> 'error', 'brain refused the job')) end,
         updated_at = now()
   where id = p.id;
end $$;

-- called by retell_webhook on call_ended / call_analyzed (wrapped there so it can never break the webhook)
create or replace function app_private.riley_plan_on_call(p_call_id text, p_event text)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare c app_private.lc_calls; p app_private.riley_call_plans; v_dur int; v_int text;
begin
  select * into c from app_private.lc_calls where call_id = p_call_id;
  if c.id is null or coalesce(c.source, '') <> 'account' then return; end if;
  select * into p from app_private.riley_call_plans where call_id = c.id for update;
  if p.id is null then return; end if;
  v_dur := coalesce(c.duration_sec, 0);
  v_int := coalesce(c.analysis ->> 'interest_level', '');
  update app_private.riley_call_plans
     set outcome = jsonb_strip_nulls(jsonb_build_object('lc_status', c.status, 'duration_sec', v_dur, 'summary', left(c.summary, 2000), 'sentiment', c.sentiment,
                                                        'interest', nullif(v_int, ''), 'next_step', c.analysis ->> 'next_step', 'needs_human', c.analysis ->> 'needs_human',
                                                        'recording', c.recording_url is not null, 'event', p_event)),
         updated_at = now()
   where id = p.id returning * into p;
  if p.status not in ('scheduled', 'dialing', 'called', 'no_answer') then return; end if;

  if v_dur = 0 then
    if p.status in ('scheduled', 'dialing') then
      update app_private.riley_call_plans set status = 'no_answer', called_at = now(), closed_at = now(), updated_at = now() where id = p.id;
      perform app_private.riley_followup_rule_noanswer(p.id);
    end if;
    return;
  end if;

  if p.status in ('scheduled', 'dialing', 'no_answer') then
    update app_private.riley_call_plans set status = 'called', called_at = coalesce(called_at, now()), closed_at = now(),
           followup_status = case when followup_status is null or followup_status = 'proposed' and followup ->> 'source' = 'rule' then 'pending' else followup_status end,
           followup = case when followup ->> 'source' = 'rule' then null else followup end,
           updated_at = now()
     where id = p.id;
  end if;
  if v_int in ('wrong_number', 'not_interested') then
    perform app_private.voice_dnc_add(p.to_number, 'Riley''s call analysis: ' || replace(v_int, '_', ' '), 'call', p.id, null);
  end if;
  if p_event = 'call_analyzed' then perform app_private.riley_followup_enqueue(p.id); end if;
end $$;

select app_private._p485('public.retell_webhook(jsonb)'::regprocedure,
  $a$       and coalesce(rec.source,'') <> 'verify'   -- bl_bp_0314: automated OTP calls are not leads$a$,
  $a$       and coalesce(rec.source,'') <> 'verify'   -- bl_bp_0314: automated OTP calls are not leads
       and coalesce(rec.source,'') <> 'account'  -- bl_voice_0485: Riley plan calls go to an existing carrier, never a new lead$a$,
  'bl_voice_0485: Riley plan calls go');
select app_private._p485('public.retell_webhook(jsonb)'::regprocedure,
  $a$  return jsonb_build_object('ok', true);
end$a$,
  $a$  -- bl_voice_0485: a booked call plan learns what happened and asks for the next step
  if event in ('call_ended','call_analyzed') then
    begin perform app_private.riley_plan_on_call(v_id, event); exception when others then raise warning 'riley_plan_on_call: %', sqlerrm; end;
  end if;
  return jsonb_build_object('ok', true);
end$a$,
  'bl_voice_0485: a booked call plan');

-- ---------------------------------------------------------------- 8. the brain's follow-up: prompt, parse, sink, auto mode
create or replace function app_private.riley_followup_prompt(p_context jsonb)
returns text language sql stable as $$
  select
       'You are the LoadBoot Ops Brain. Riley, LoadBoot''s AI phone assistant, just finished a call to this carrier. Decide the ONE best next step for our team and draft it. '
    || 'This is a service follow-up about the carrier''s own account — never marketing, never a sales push. Use only the call record, the carrier file, the facts and the knowledge base: '
    || 'never invent a document status, a rate, a date or a promise. Money, payouts, refunds, legal or factoring questions always go to a person (NEXT ACTION: staff_task). '
    || 'If the person asked not to be called again, said it is the wrong number, or was annoyed about being called: DO NOT CALL: yes, and never propose a second call. '
    || 'Voicemail or a call with no real conversation means they were not reached: propose second_call at the other time of day unless this was attempt 3 — then email. '
    || 'If they agreed to do something themselves (upload, sign, reply), prefer email with the exact steps, or none if nothing is needed from us.' || E'\n\n'
    || 'CALL ATTEMPT: ' || coalesce(p_context ->> 'attempt', '1') || ' of 3' || E'\n'
    || 'EMAIL ON FILE: ' || case when coalesce((p_context ->> 'email_on_file')::boolean, false) then 'yes' else 'no (do not choose email)' end || E'\n'
    || 'CALL LANGUAGE: ' || case when coalesce(p_context ->> 'lang', 'en') = 'es' then 'Spanish (write the email in Spanish)' else 'English' end || E'\n\n'
    || 'THE BRIEFING RILEY HAD:' || E'\n' || coalesce(nullif(p_context ->> 'plan_text', ''), '(none)') || E'\n\n'
    || 'THE CALL (json, transcript may be cut):' || E'\n' || left(jsonb_pretty(coalesce(p_context -> 'call', '{}'::jsonb)), 9500) || E'\n\n'
    || 'CARRIER FILE (json):' || E'\n'
    || left(jsonb_pretty(coalesce(p_context - 'user_id' - 'plan_id' - 'reason' - 'staff_note' - 'lang' - 'call' - 'plan_text' - 'attempt' - 'email_on_file', '{}'::jsonb)), 7000) || E'\n\n'
    || 'Put your answer in "reply" as plain text with EXACTLY these nine headers, each on its own line, in this order, nothing before the first:' || E'\n'
    || 'OUTCOME: one or two sentences — what happened on the call, in plain words.' || E'\n'
    || 'NEXT ACTION: exactly one of second_call, email, staff_task, none.' || E'\n'
    || 'WHEN: when to do it (now / tomorrow afternoon / in 3 days …) and why that timing.' || E'\n'
    || 'WHY: one sentence.' || E'\n'
    || 'CALL NOTE: for second_call — what the next call must cover, written as a staff note; otherwise -' || E'\n'
    || 'EMAIL SUBJECT: for email — under 70 characters; otherwise -' || E'\n'
    || 'EMAIL BODY: for email — plain text under 140 words: first-name greeting, what we talked about or tried, the ONE thing we need from them and exactly where to do it (log in at loadboot.com → the page). '
    || 'No phone numbers, no prices, no promises, no sign-off name — "Thanks," as the last line; the signature is added automatically. Otherwise -' || E'\n'
    || 'STAFF TASK: for staff_task — one line a person can act on; otherwise -' || E'\n'
    || 'DO NOT CALL: yes or no.' || E'\n\n'
    || 'Set "confidence" to how sure you are about the next step. Respond with the single JSON object described in your rules.';
$$;

create or replace function app_private.riley_followup_parse(p_text text)
returns jsonb language plpgsql immutable as $$
declare t text := coalesce(p_text, '');
        stop_ text := '(?=\n\s*(?:OUTCOME|NEXT ACTION|WHEN|WHY|CALL NOTE|EMAIL SUBJECT|EMAIL BODY|STAFF TASK|DO NOT CALL)\s*:|$)';
        g jsonb := '{}'::jsonb; k text; h text; v text; a text;
begin
  if btrim(t) = '' then return null; end if;
  foreach h in array array['OUTCOME','NEXT ACTION','WHEN','WHY','CALL NOTE','EMAIL SUBJECT','EMAIL BODY','STAFF TASK','DO NOT CALL'] loop
    -- ARE: the leading \s*? makes the whole match shortest (same gotcha as riley_plan_parse)
    v := nullif(btrim(substring(t from '(?i)' || h || '\s*?:\s*?(.*?)' || stop_)), '');
    if v in ('-', '—', 'n/a', 'N/A', 'none') and h <> 'NEXT ACTION' then v := null; end if;
    k := lower(replace(h, ' ', '_'));
    g := g || jsonb_build_object(k, v);
  end loop;
  a := lower(coalesce(g ->> 'next_action', ''));
  a := case when a ~ 'second' then 'second_call' when a ~ 'email' then 'email' when a ~ 'staff|task|person' then 'staff_task' else 'none' end;
  return jsonb_strip_nulls(jsonb_build_object(
    'outcome', g ->> 'outcome', 'action', a, 'when', g ->> 'when', 'why', g ->> 'why', 'call_note', g ->> 'call_note',
    'email_subject', left(g ->> 'email_subject', 140), 'email_body', left(g ->> 'email_body', 2500), 'staff_task', left(g ->> 'staff_task', 300),
    'do_not_call', lower(coalesce(g ->> 'do_not_call', 'no')) ~ '^\s*(yes|y|true)',
    'parsed', (g ->> 'outcome') is not null and (g ->> 'next_action') is not null));
end $$;

create or replace function app_private.riley_followup_auto(p_plan bigint)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare t app_private.brain_permissions; p app_private.riley_call_plans; r jsonb; v_task uuid;
begin
  select * into t from app_private.brain_permissions where key = 'tool.schedule_riley_call';
  if t.key is null or not t.enabled or t.status <> 'live' or t.mode <> 'auto' then return; end if;   -- prep: a person decides
  select * into p from app_private.riley_call_plans where id = p_plan for update;
  if p.id is null or p.followup_status <> 'proposed' then return; end if;
  if p.followup ->> 'action' = 'second_call' and p.attempt < 3
     and not exists (select 1 from app_private.voice_dnc d where d.last10 = right(p.to_number, 10)) then
    r := app_private.riley_plan_new(p.org_id, 'follow_up',
           coalesce(p.followup ->> 'call_note', 'Follow-up to the earlier Riley call.') || coalesce(E'\nEarlier call: ' || coalesce(p.followup ->> 'outcome', p.outcome ->> 'summary'), ''),
           p.lang, null, p.id, true);
    if nullif(r ->> 'error', '') is null then
      update app_private.riley_call_plans set followup_status = 'done',
             followup_done = jsonb_build_object('kind', 'second_call', 'plan_id', r -> 'id', 'auto', true, 'at', now()), updated_at = now()
       where id = p.id;
    end if;
  elsif p.followup ->> 'action' = 'staff_task' then
    insert into app_private.automation_tasks (task_type, title, description, status, priority, assignee_role, related_type, related_id, due_at, source_rule)
    values ('followup', left('📞 ' || coalesce(p.followup ->> 'staff_task', 'Follow up after the Riley call'), 200),
            coalesce(p.followup ->> 'outcome', '') || coalesce(E'\nWhy: ' || (p.followup ->> 'why'), ''), 'open', 'normal', 'staff', 'riley_plan', p.id::text, now() + interval '1 day', 'voice.plan_followup')
    returning id into v_task;
    update app_private.riley_call_plans set followup_status = 'done',
           followup_done = jsonb_build_object('kind', 'staff_task', 'task_id', v_task, 'auto', true, 'at', now()), updated_at = now()
     where id = p.id;
  end if;
  -- email / none: always a person (emails leave the building — CLAUDE.md §6)
end $$;

create or replace function app_private.riley_followup_sink(p_job app_private.brain_jobs)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare v_job app_private.brain_jobs; p app_private.riley_call_plans; f jsonb; v_reply text;
begin
  select * into v_job from app_private.brain_jobs where id = p_job.id;
  select * into p from app_private.riley_call_plans where followup_job_id = p_job.id for update;
  if p.id is null then return; end if;
  v_reply := nullif(btrim(coalesce(p_job.result ->> 'reply', '')), '');
  if p_job.status = 'done' and v_reply is not null then
    f := coalesce(app_private.riley_followup_parse(v_reply), '{}'::jsonb) || jsonb_build_object('source', 'brain', 'confidence', nullif(p_job.result ->> 'confidence', '')::numeric);
    if coalesce((f ->> 'do_not_call')::boolean, false) then
      perform app_private.voice_dnc_add(p.to_number, 'Asked not to be called again (read from the call by the brain)', 'brain', p.id, null);
      if f ->> 'action' = 'second_call' then f := f || jsonb_build_object('action', case when f ? 'email_body' then 'email' else 'none' end, 'overridden', 'second call blocked: do-not-call'); end if;
    end if;
    if f ->> 'action' = 'second_call' then
      if p.attempt >= 3 then f := f || jsonb_build_object('action', case when f ? 'email_body' then 'email' else 'staff_task' end, 'overridden', 'third attempt reached');
      else f := f || jsonb_build_object('suggested_at', app_private.riley_followup_default_time(p)); end if;
    end if;
    update app_private.riley_call_plans set followup_text = v_reply, followup = f, followup_status = 'proposed', followup_usd = coalesce(v_job.usd, 0), updated_at = now()
     where id = p.id returning * into p;
    perform app_private.riley_plan_notify(p, '📞 Riley called ' || coalesce((select name from public.organizations where id = p.org_id), 'a carrier') || ' — next step ready',
                                          coalesce(f ->> 'outcome', '') || ' → ' || replace(coalesce(f ->> 'action', 'none'), '_', ' '));
    perform app_private.riley_followup_auto(p.id);
  else
    update app_private.riley_call_plans
       set followup_status = 'failed', followup_usd = coalesce(v_job.usd, 0),
           followup = jsonb_build_object('error', coalesce(nullif(p_job.error, ''), nullif(p_job.result ->> 'escalate_reason', ''), 'the brain returned no next step')),
           updated_at = now()
     where id = p.id;
  end if;
end $$;

select app_private._p485('app_private.brain_sink(app_private.brain_jobs)'::regprocedure,
  $a$      if p_job.route <> 'voice_plan' then return; end if;$a$,
  $a$      if p_job.route = 'voice_followup' then perform app_private.riley_followup_sink(p_job); return; end if;   -- bl_voice_0485
      if p_job.route <> 'voice_plan' then return; end if;$a$,
  'bl_voice_0485');

select app_private._p485('app_private.brain_user_text(text,text,text,jsonb)'::regprocedure,
  $a$  when p_route = 'voice_plan' then$a$,
  $a$  when p_route = 'voice_followup' then app_private.riley_followup_prompt(p_context)   -- bl_voice_0485
  when p_route = 'voice_plan' then$a$,
  'bl_voice_0485');
select app_private._p485('app_private.brain_user_text(text,text,text,jsonb)'::regprocedure,
  $a$         when 'no_reply'         then$a$,
  $a$         when 'follow_up'        then ' — follow-up to an earlier Riley call: the staff note and recent_riley_calls say what happened; pick up where it left off, never repeat the first call word for word.'   -- bl_voice_0485b
         when 'no_reply'         then$a$,
  'bl_voice_0485b');

-- ---------------------------------------------------------------- 9. staff actions on the next step
create or replace function public.cc_riley_followup_act(p_id bigint, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $function$
declare p app_private.riley_call_plans; f jsonb; r jsonb; v_email text; v_subj text; v_body text; v_html text; g jsonb; v_task uuid; v_note text;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into p from app_private.riley_call_plans where id = p_id for update;
  if p.id is null then return jsonb_build_object('error', 'plan not found'); end if;
  f := coalesce(p.followup, '{}'::jsonb); p_payload := coalesce(p_payload, '{}'::jsonb);

  case p_action
    when 'second_call' then
      if p.attempt >= 3 then return jsonb_build_object('error', 'Three attempts on one topic is the limit — send an email or hand it to a person.'); end if;
      if exists (select 1 from app_private.voice_dnc d where d.last10 = right(p.to_number, 10)) then return jsonb_build_object('error', 'This number is on the Riley do-not-call list.'); end if;
      if exists (select 1 from app_private.riley_call_plans c where c.parent_id = p.id and c.status not in ('cancelled', 'failed')) then return jsonb_build_object('error', 'A follow-up plan already exists for this call.'); end if;
      v_note := coalesce(nullif(btrim(p_payload ->> 'note'), ''), f ->> 'call_note', 'Follow-up to the earlier Riley call.')
                || coalesce(E'\nEarlier call (' || to_char(coalesce(p.called_at, p.updated_at) at time zone 'America/New_York', 'Mon DD') || '): ' || coalesce(f ->> 'outcome', p.outcome ->> 'summary'), '');
      r := app_private.riley_plan_new(p.org_id, 'follow_up', v_note, p.lang, auth.uid(), p.id, false);
      if nullif(r ->> 'error', '') is not null then return r; end if;
      update app_private.riley_call_plans set followup_status = 'done',
             followup_done = jsonb_build_object('kind', 'second_call', 'plan_id', r -> 'id', 'by', auth.uid(), 'at', now()), updated_at = now()
       where id = p.id;
      return r || jsonb_build_object('parent_id', p.id);
    when 'email' then
      if p.followup_done ->> 'kind' = 'email' then return jsonb_build_object('error', 'The follow-up email for this call was already sent.'); end if;
      select pr.email into v_email from public.organizations o join public.profiles pr on pr.id = o.owner_user_id where o.id = p.org_id;
      if v_email is null then return jsonb_build_object('error', 'No email address on this carrier''s profile.'); end if;
      v_subj := left(btrim(coalesce(nullif(p_payload ->> 'subject', ''), f ->> 'email_subject', '')), 140);
      v_body := left(btrim(coalesce(nullif(p_payload ->> 'body', ''), f ->> 'email_body', '')), 4000);
      if v_subj = '' or length(v_body) < 20 then return jsonb_build_object('error', 'Subject and body are both needed.'); end if;
      if (v_subj || v_body) ~ '253\D{0,3}7575' then return jsonb_build_object('error', 'Remove the Riley phone number — emails use the contact switch (CLAUDE.md §7).'); end if;
      g := app_private.email_gate(v_email, 'riley.followup', null);
      if not coalesce((g ->> 'allowed')::boolean, false) then return jsonb_build_object('error', coalesce(g ->> 'reason', 'This address cannot receive this email.'), 'gate', g); end if;
      v_html := '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">'
             || (select string_agg('<p style="margin:0 0 14px">' || replace(replace(replace(replace(btrim(para), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>') || '</p>', '')
                   from regexp_split_to_table(v_body, E'\n\\s*\n') para where btrim(para) <> '')
             || '<p style="margin:18px 0 0">The LoadBoot team</p><div style="margin-top:6px">{{contact_sig}}</div></div>';
      perform app_private.sys_email(v_email, 'riley.followup', v_subj, v_html, v_body || E'\n\nThe LoadBoot team\n{{contact_sig}}', 'riley.followup:' || p.id);
      update app_private.riley_call_plans set followup_status = 'done',
             followup_done = jsonb_build_object('kind', 'email', 'to', v_email, 'subject', v_subj, 'by', auth.uid(), 'at', now()), updated_at = now()
       where id = p.id;
    when 'staff_task' then
      insert into app_private.automation_tasks (task_type, title, description, status, priority, assignee_role, related_type, related_id, due_at, source_rule)
      values ('followup', left('📞 ' || coalesce(nullif(btrim(p_payload ->> 'title'), ''), f ->> 'staff_task', 'Follow up after the Riley call to ' || coalesce((select name from public.organizations where id = p.org_id), 'the carrier')), 200),
              coalesce(f ->> 'outcome', p.outcome ->> 'summary', '') || coalesce(E'\nWhy: ' || (f ->> 'why'), '') || E'\nCC → Riley → Call plans #' || p.id,
              'open', 'normal', 'staff', 'riley_plan', p.id::text, now() + interval '1 day', 'voice.plan_followup')
      returning id into v_task;
      update app_private.riley_call_plans set followup_status = 'done',
             followup_done = jsonb_build_object('kind', 'staff_task', 'task_id', v_task, 'by', auth.uid(), 'at', now()), updated_at = now()
       where id = p.id;
    when 'dismiss' then
      update app_private.riley_call_plans set followup_status = 'dismissed',
             followup_done = jsonb_build_object('kind', 'dismissed', 'note', nullif(btrim(p_payload ->> 'note'), ''), 'by', auth.uid(), 'at', now()), updated_at = now()
       where id = p.id;
    when 'dnc' then
      perform app_private.voice_dnc_add(p.to_number, coalesce(nullif(btrim(p_payload ->> 'reason'), ''), 'Staff: do not call'), 'staff', p.id, auth.uid());
    when 'dnc_clear' then
      if not (public.has_global_permission('comm.manage') or public.has_global_permission('settings.manage')) then raise exception 'not authorized' using errcode = '42501'; end if;
      delete from app_private.voice_dnc where last10 = right(p.to_number, 10);
      update app_private.riley_call_plans set note = coalesce(note || E'\n', '') || 'Removed from Riley do-not-call on ' || to_char(now() at time zone 'America/New_York', 'Mon DD') || coalesce(': ' || nullif(btrim(p_payload ->> 'reason'), ''), ''), updated_at = now() where id = p.id;
    else
      return jsonb_build_object('error', 'unknown action');
  end case;
  select * into p from app_private.riley_call_plans where id = p_id;
  return app_private.riley_plan_json(p);
end $function$;

-- ---------------------------------------------------------------- 10. read model + existing staff actions
create or replace function app_private.riley_plan_json(p app_private.riley_call_plans)
returns jsonb language sql stable set search_path to 'app_private', 'public' as $function$
  select jsonb_build_object(
    'id', p.id, 'org_id', p.org_id, 'org_name', (select o.name from public.organizations o where o.id = p.org_id),
    'contact_name', p.contact_name, 'to_number', p.to_number, 'contact_role', p.contact_role, 'consent', p.consent,
    'reason', p.reason, 'note', p.note, 'lang', p.lang, 'status', p.status, 'job_id', p.job_id,
    'plan_text', p.plan_text, 'plan', p.plan, 'confidence', p.confidence, 'review_note', p.review_note, 'error', p.error,
    'call_id', p.call_id, 'created_by', p.created_by,
    'created_by_name', (select coalesce(nullif(pr.contact_name, ''), pr.email) from public.profiles pr where pr.id = p.created_by),
    'created_at', p.created_at, 'updated_at', p.updated_at, 'closed_at', p.closed_at,
    -- bl_voice_0485: booking, outcome, next step
    'parent_id', p.parent_id, 'attempt', p.attempt, 'auto_book', p.auto_book,
    'scheduled_for', p.scheduled_for, 'booked_at', p.booked_at,
    'booked_by_name', case when p.booked_at is null then null when p.booked_by is null then 'auto (brain)' else (select coalesce(nullif(pr.contact_name, ''), pr.email) from public.profiles pr where pr.id = p.booked_by) end,
    'tz', app_private.riley_plan_tz(p.org_id),
    'scheduled_local', case when p.scheduled_for is null then null
                            else to_char(p.scheduled_for at time zone coalesce(app_private.riley_plan_tz(p.org_id), 'America/New_York'), 'Dy Mon DD, HH12:MI AM')
                                 || ' ' || coalesce(replace(split_part(app_private.riley_plan_tz(p.org_id), '/', 2), '_', ' ') || ' time', 'Eastern') end,
    'called_at', p.called_at, 'outcome', p.outcome,
    'followup_status', p.followup_status, 'followup', p.followup, 'followup_text', p.followup_text, 'followup_done', p.followup_done,
    'children', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'attempt', c.attempt) order by c.id), '[]'::jsonb) from app_private.riley_call_plans c where c.parent_id = p.id),
    'dnc', (select jsonb_build_object('reason', d.reason, 'source', d.source, 'at', d.created_at) from app_private.voice_dnc d where d.last10 = right(coalesce(p.to_number, ''), 10)),
    'email_on_file', (select pr.email is not null from public.organizations o join public.profiles pr on pr.id = o.owner_user_id where o.id = p.org_id),
    'gate', case when p.status = 'ready' then app_private.riley_plan_gate_view(p) end,
    'call', (select jsonb_build_object('status', c.status, 'duration_sec', c.duration_sec, 'scheduled_at', c.scheduled_at, 'has_recording', c.recording_url is not null, 'retell_call_id', c.call_id)
               from app_private.lc_calls c where c.id = p.call_id),
    -- plan §9 cost line: Retell ≈ $0.13/min all-in + the brain jobs. The estimate is shown, never billed.
    'cost', jsonb_build_object('retell_per_min', 0.13, 'est_minutes', p.est_minutes, 'brain_usd', round(p.brain_usd + p.followup_usd, 4),
                               'est_total', round(coalesce(round(nullif(p.outcome ->> 'duration_sec', '')::numeric / 60.0, 1), p.est_minutes) * 0.13 + p.brain_usd + p.followup_usd, 2)),
    'job', (select jsonb_build_object('status', j.status, 'model', j.model, 'effort', j.effort, 'usd', round(j.usd, 4), 'tool_calls', j.tool_calls,
                                      'error', j.error, 'created_at', j.created_at,
                                      'secs', round(extract(epoch from (coalesce(j.done_at, now()) - j.created_at))::numeric, 1))
              from app_private.brain_jobs j where j.id = p.job_id),
    'dial_tool', (select jsonb_build_object('enabled', t.enabled, 'mode', t.mode, 'status', t.status)
                    from app_private.brain_permissions t where t.key = 'tool.schedule_riley_call'));
$function$;

select app_private._p485('public.cc_riley_plan_set(bigint,text,text)'::regprocedure,
  $a$      if v_p.status in ('called', 'cancelled') then return jsonb_build_object('error', 'already closed'); end if;$a$,
  $a$      if v_p.status in ('called', 'cancelled') then return jsonb_build_object('error', 'already closed'); end if;
      -- bl_voice_0485: a booked call is cancelled with its plan; one already ringing cannot be
      if v_p.status = 'dialing' then return jsonb_build_object('error', 'Riley is dialling this call right now — it cannot be cancelled.'); end if;
      if v_p.status = 'scheduled' and v_p.call_id is not null then
        update app_private.lc_calls set status = 'cancelled', updated_at = now() where id = v_p.call_id and status = 'scheduled';
      end if;$a$,
  'bl_voice_0485: a booked call');
select app_private._p485('public.cc_riley_plan_set(bigint,text,text)'::regprocedure,
  $a$      if v_p.status in ('called', 'cancelled', 'scheduled') then return jsonb_build_object('error', 'plan is closed or already booked'); end if;$a$,
  $a$      if v_p.status in ('called', 'cancelled', 'scheduled', 'dialing', 'no_answer') then return jsonb_build_object('error', 'plan is closed or already booked'); end if;   -- bl_voice_0485b$a$,
  'bl_voice_0485b');

-- ---------------------------------------------------------------- 11. brain: lean system block for rare routes (cost), follow-up route
create or replace function app_private.brain_system(p_route text, p_lang text default 'en')
returns jsonb language sql stable set search_path = app_private, public as $$
  select case when p_route = any(coalesce((select c.lean_routes from app_private.brain_config c where c.id), '{}'::text[]))
    -- bl_voice_0485: low-volume routes skip the 54k-char KB; a 1-hour cache write per job cost more than it saved
    then jsonb_build_array(
      jsonb_build_object('text', app_private.brain_rules()),
      jsonb_build_object('text', app_private.brain_facts_block() || E'\n\nKNOWLEDGE BASE: not inlined for this job. Call kb_search whenever you need a policy, a price, a document rule or a how-to — never guess one.' || app_private.brain_perm_block()))
    else jsonb_build_array(
      jsonb_build_object('text', app_private.brain_rules()),
      jsonb_build_object('text', app_private.brain_facts_block() || E'\n\n' || app_private.brain_kb_block(p_lang) || app_private.brain_perm_block(), 'cache', true)) end;
$$;

do $$
declare v_before app_private.brain_config; v_after app_private.brain_config;
begin
  select * into v_before from app_private.brain_config where id;
  update app_private.brain_config
     set model_by_route = model_by_route || jsonb_build_object('voice_followup', coalesce(model_by_route ->> 'voice_followup', 'claude-sonnet-5')),
         effort         = effort         || jsonb_build_object('voice_followup', coalesce(effort ->> 'voice_followup', 'medium')),
         max_tokens     = max_tokens     || jsonb_build_object('voice_followup', coalesce((max_tokens ->> 'voice_followup')::int, 2000)),
         lean_routes    = (select array_agg(distinct r order by r) from unnest(lean_routes || array['voice_plan', 'voice_followup']) r)
   where id
   returning * into v_after;
  perform app_private.brain_log('config', 'config',
    jsonb_build_object('model_by_route', v_before.model_by_route, 'effort', v_before.effort, 'max_tokens', v_before.max_tokens, 'lean_routes', v_before.lean_routes),
    jsonb_build_object('model_by_route', v_after.model_by_route,  'effort', v_after.effort,  'max_tokens', v_after.max_tokens,  'lean_routes', v_after.lean_routes),
    'bl_voice_0485: voice_followup route (Sonnet 5, medium, 2000); lean system block for voice_plan + voice_followup — the KB-in-cache write cost $0.09 per rare job');
end $$;

-- the executor ships: status planned → live. It stays SWITCHED OFF — the owner flips it (CC → AI Brain → Permissions).
do $$
declare v_before app_private.brain_permissions; v_after app_private.brain_permissions;
begin
  select * into v_before from app_private.brain_permissions where key = 'tool.schedule_riley_call';
  update app_private.brain_permissions
     set status = 'live',
         label = 'Book Riley calls',
         description = 'Books an outbound Riley call from a ready call plan (bl_voice_0485). OFF = nobody can book. prep = a staff member presses “Book with Riley”. auto = the brain may also book its own follow-up second calls. Always gated: consent on file, Riley do-not-call list, SMS STOP, calling hours Mon–Fri 09:00–18:30 carrier time, one call per carrier per day, three per week, three attempts per topic, max_per_day overall.',
         updated_at = now()
   where key = 'tool.schedule_riley_call'
   returning * into v_after;
  if v_after.key is not null then
    perform app_private.brain_log('tool.schedule_riley_call', 'set', to_jsonb(v_before) - 'created_by' - 'updated_by', to_jsonb(v_after) - 'created_by' - 'updated_by',
                                  'bl_voice_0485: executor shipped — status live, still switched off until the owner flips it');
  end if;
end $$;

-- ---------------------------------------------------------------- 12. the follow-up email lives in the catalog (CLAUDE.md §6)
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
                                       preference_group, unsub_allowed, cc_deep_link, status, send_mode, discovered_in, owner_note)
values ('riley.followup', 'Riley call follow-up',
        'After a Riley call (or three unanswered tries) the Ops Brain drafts the next-step email about the carrier''s own account; a staff member reads, edits and sends it from CC → Riley → Call plans.',
        'O', 'carrier', 'manual', 'public.cc_riley_followup_act', 'only when a staff member approves a follow-up',
        'one per call plan (idempotency key riley.followup:<plan id>)', 'unsubscribe from the compliance group, or from all mail',
        'compliance', true, '#/riley?tab=plans', 'live', 'live', '{migration}', 'bl_voice_0485')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 13. Riley Outbound learns "account" calls (draft — publish from CC)
do $$
declare v app_private.riley_prompts; g text;
begin
  select * into v from app_private.riley_prompts where agent_key = 'outbound';
  if v.agent_key is null or position('"account"' in v.general_prompt) > 0 then return; end if;
  g := v.general_prompt;
  if (length(g) - length(replace(g, 'to sort it out live."', ''))) / length('to sort it out live."') <> 1
     or (length(g) - length(replace(g, 'what can I help with?"', ''))) / length('what can I help with?"') <> 1
     or (length(g) - length(replace(g, 'Never a second voicemail the same day.', ''))) / length('Never a second voicemail the same day.') <> 1 then
    raise exception 'bl_voice_0485: Riley Outbound prompt anchors not found exactly once — patch the prompt by hand in CC → Riley → Prompts';
  end if;
  g := replace(g, 'to sort it out live."',
       'to sort it out live."' || E'\n' || '- "account": LoadBoot is calling about their OWN carrier account (setup, a document, a dispatcher, a question we had). Use the OPENER from the briefing, then its talking points. They did NOT ask for this call: never say they did, never say "returning your request". If they ask why you are calling, say it plainly: "It''s about your LoadBoot carrier account."');
  g := replace(g, 'what can I help with?"', 'what can I help with?" For source "account", say the briefing''s OPENER instead.');
  g := replace(g, 'Never a second voicemail the same day.',
       'Never a second voicemail the same day. For source "account" the line is: "Hi {{name}}, it''s Riley from LoadBoot about your carrier account. Everything is on loadboot dot com, or just reply to our email. Talk soon."');
  update app_private.riley_prompts set general_prompt = g, updated_at = now(), updated_by = null where agent_key = 'outbound';
  insert into app_private.riley_prompt_history (agent_key, begin_message, general_prompt, saved_by, note)
  values ('outbound', v.begin_message, g, null, 'bl_voice_0485: "account" source (Riley call plans) — opener, no "returning your request", account voicemail line');
end $$;

-- ---------------------------------------------------------------- 14. grants
revoke all on function app_private.us_state_tz(text) from public, anon, authenticated;
revoke all on function app_private.riley_plan_tz(uuid) from public, anon, authenticated;
revoke all on function app_private.riley_call_window(text, timestamptz) from public, anon, authenticated;
revoke all on function app_private.voice_dnc_add(text, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function app_private.riley_dial_gate(app_private.riley_call_plans, boolean, timestamptz) from public, anon, authenticated;
revoke all on function app_private.riley_plan_new(uuid, text, text, text, uuid, bigint, boolean) from public, anon, authenticated;
revoke all on function app_private.riley_plan_book(bigint, timestamptz, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function app_private.riley_plan_gate_view(app_private.riley_call_plans) from public, anon, authenticated;
revoke all on function app_private.riley_plan_predial(bigint) from public, anon, authenticated;
revoke all on function app_private.riley_followup_default_time(app_private.riley_call_plans) from public, anon, authenticated;
revoke all on function app_private.riley_plan_sweep() from public, anon, authenticated;
revoke all on function app_private.riley_plan_notify(app_private.riley_call_plans, text, text) from public, anon, authenticated;
revoke all on function app_private.riley_followup_rule_noanswer(bigint) from public, anon, authenticated;
revoke all on function app_private.riley_followup_enqueue(bigint) from public, anon, authenticated;
revoke all on function app_private.riley_plan_on_call(text, text) from public, anon, authenticated;
revoke all on function app_private.riley_followup_prompt(jsonb) from public, anon, authenticated;
revoke all on function app_private.riley_followup_parse(text) from public, anon, authenticated;
revoke all on function app_private.riley_followup_auto(bigint) from public, anon, authenticated;
revoke all on function app_private.riley_followup_sink(app_private.brain_jobs) from public, anon, authenticated;
revoke all on function app_private.riley_plan_json(app_private.riley_call_plans) from public, anon, authenticated;
revoke all on function app_private.brain_system(text, text) from public, anon, authenticated;

revoke execute on function public.cc_riley_plan_create(uuid, text, text, text) from public, anon;
grant  execute on function public.cc_riley_plan_create(uuid, text, text, text) to authenticated, service_role;
revoke execute on function public.cc_riley_plan_book(bigint, timestamptz, boolean) from public, anon;
grant  execute on function public.cc_riley_plan_book(bigint, timestamptz, boolean) to authenticated, service_role;
revoke execute on function public.cc_riley_followup_act(bigint, text, jsonb) from public, anon;
grant  execute on function public.cc_riley_followup_act(bigint, text, jsonb) to authenticated, service_role;
comment on function public.cc_riley_plan_book(bigint, timestamptz, boolean) is
  'bl_voice_0485: staff book a ready Riley call plan (tool.schedule_riley_call executor). Gated by riley_dial_gate; lands in calling hours; the cron dials after a second check.';
comment on function public.cc_riley_followup_act(bigint, text, jsonb) is
  'bl_voice_0485: staff act on the next step after a Riley call — second_call · email (riley.followup, unsubscribe-checked) · staff_task · dismiss · dnc · dnc_clear.';

drop function app_private._p485(regprocedure, text, text, text);

-- ---------------------------------------------------------------- 15. proof
-- select key, enabled, status, mode from app_private.brain_permissions where key = 'tool.schedule_riley_call';   -- live, false, prep
-- select lean_routes, model_by_route ->> 'voice_followup' from app_private.brain_config;
-- select position('bl_voice_0485' in pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure)) > 0;
-- select app_private.riley_call_window('America/Chicago', '2026-09-27 12:00+00');   -- Sunday → Mon 09:00 CT
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');   -- 36 prod / 35 staging, names per the baseline
