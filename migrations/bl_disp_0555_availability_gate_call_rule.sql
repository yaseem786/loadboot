-- bl_disp_0555 — availability-first dispatching + one-intro-call rule (15 Oct 2026)
--
-- Yaseen 15 Oct: the CARRIER posts availability; the dispatcher calls ONCE (intro: show them where to post it and why —
-- "jo bhi load hoga main availability ke hisaab se hunt karunga"), then never calls for availability again; every carrier
-- call needs a reason from the CC list; only 100% shortlisted loads go on the carrier's board; accept → broker → RC → LoadBoot.
-- Ships in WARN mode (nothing blocked, everything visible and counted); CC flips to ENFORCE later. Design + the step table:
-- docs/AVAILABILITY-GATE-0555.md. (The prompt said 0551 — taken the same day by dispatcher post tracking.)
--
-- What this file does (additive, apply STAGING first, then PROD):
--   1. disp_desk_config keys availability_gate_mode (off|warn|enforce, default warn), availability_fresh_days (7),
--      call_rule_mode (warn|enforce, default warn) + public.cc_disp_desk_config / cc_disp_desk_config_set (staff).
--   2. app_private.carrier_availability_fresh(org) → (fresh, since, trucks, reason): the CARRIER's own truck posting or
--      Trucks-tab line within N days. A dispatcher- or staff-written line never counts. disp_availability_gate(org) wraps it
--      with the mode; disp_availability_check(org) is the one line every dispatcher write RPC calls.
--   3. Gates (anchor-replaced): dispatcher_set_availability (dispatcher: enforce → refused, warn → saved + warning),
--      dispatcher_post_load / post_truck / log_booking / request_book (enforce → refused, warn → availability_warning),
--      cc_pocket_available_loads + cc_carrier_best_loads (enforce → no rows for a gated carrier), carrier_dispatcher_desk,
--      dispatcher_my_status, dispatcher_workspace_feed, cc_dispatcher_360, cc_carrier_360 (gate + intro_call_at + stage).
--   4. Carrier notice carrier.availability.required (catalog row, email_kit body, in-app, once per 24 h per carrier, stops
--      when fresh): at cc_dispatcher_assign and from cron lb-disp-avail-sweep (hourly).
--   5. Calls: app_private.disp_call_reasons (CC-editable), dialer_calls.reason_code/reason_note/policy,
--      dispatcher_assignments.intro_call_at/intro_call_id (trigger on the answered call), dialer_lookup → carrier_call
--      (reason picker data), dialer_call_start rule (reason required for a carrier number; intro once; urgent always; other
--      after the intro: enforce → refused, warn → allowed + counted); thread system lines; staff notices
--      dispatcher.call.urgent / dispatcher.call.offpolicy; cc_disp_call_reasons / cc_disp_call_reason_set.
--   6. Counts: disp_trial_stats.effort waiting_availability / urgent_calls / offpolicy_calls, two tiles in the daily trial
--      e-mail, cc_dispatcher_360.calls.
--   7. app_private.disp_load_stage(load) — step / ball / next action for both sides; 'stage' in dispatcher_my_posts and
--      cc_carrier_360.dispatcher_posts.
--   8. Standing rules text (app_private.disp_standing_rules_text) in the dispatcher's assignment brief e-mail, the thread
--      system line at assignment, and exposed to the UI (dispatcher_workspace_feed.rules).
-- Anchors are replaced in the live definitions (never retyped); the file aborts if any anchor is missing.
-- Rollback: cc_disp_desk_config_set('availability_gate_mode','off') + ('call_rule_mode','warn') neutralises every gate;
--   full rollback = re-apply the previous bodies listed in the doc, drop the two tables, the trigger, the cron job.

-- ---------------------------------------------------------------- 1. config
insert into app_private.disp_desk_config (key, value, note) values
  ('availability_gate_mode', 'warn', 'bl_disp_0555: off | warn | enforce. enforce = a carrier with a dispatcher sees no loads and the dispatcher cannot post/book until the carrier posts availability; warn = everything works, chips + notices + counts only.'),
  ('availability_fresh_days', '7', 'bl_disp_0555: the carrier''s own availability post counts for this many days.'),
  ('call_rule_mode', 'warn', 'bl_disp_0555: warn | enforce. After the intro call a non-urgent carrier call is refused (enforce) or allowed + counted as off-policy (warn). A reason is always required.')
on conflict (key) do nothing;

create or replace function app_private.disp_desk_value(p_key text)
returns text language sql stable security definer set search_path = app_private, public as $$
  select nullif(btrim(value), '') from app_private.disp_desk_config where key = p_key
$$;
revoke all on function app_private.disp_desk_value(text) from public, anon, authenticated;

create or replace function public.cc_disp_desk_config()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_can_view() then jsonb_build_object('error','not authorized')
    else coalesce((select jsonb_agg(jsonb_build_object('key', key, 'value', value, 'note', note, 'updated_at', updated_at) order by key) from app_private.disp_desk_config), '[]'::jsonb) end
$$;
revoke all on function public.cc_disp_desk_config() from public, anon; grant execute on function public.cc_disp_desk_config() to authenticated;

create or replace function public.cc_disp_desk_config_set(p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_old text; v text := nullif(btrim(coalesce(p_value,'')), '');
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_key = 'availability_gate_mode' and v not in ('off','warn','enforce') then return jsonb_build_object('error','mode must be off, warn or enforce'); end if;
  if p_key = 'call_rule_mode' and v not in ('warn','enforce') then return jsonb_build_object('error','mode must be warn or enforce'); end if;
  if p_key = 'availability_fresh_days' and (v !~ '^\d{1,2}$' or v::int < 1 or v::int > 30) then return jsonb_build_object('error','days must be 1..30'); end if;
  if p_key = 'assign_sla_business_days' and (v !~ '^\d{1,2}$') then return jsonb_build_object('error','must be a number of business days'); end if;
  if not exists (select 1 from app_private.disp_desk_config where key = p_key) then return jsonb_build_object('error','unknown key ' || p_key); end if;
  select value into v_old from app_private.disp_desk_config where key = p_key;
  update app_private.disp_desk_config set value = v, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform app_private.disp_audit('dispatcher.desk_config', 'config', p_key, null, 'desk config ' || p_key || ': ' || coalesce(v_old,'∅') || ' → ' || coalesce(v,'∅'), jsonb_build_object('key', p_key, 'old', v_old, 'new', v));
  return jsonb_build_object('ok', true, 'key', p_key, 'value', v);
end $$;
revoke all on function public.cc_disp_desk_config_set(text, text) from public, anon; grant execute on function public.cc_disp_desk_config_set(text, text) to authenticated;

-- ---------------------------------------------------------------- 2. freshness + gate
-- "the carrier" = the org owner or an active member who is neither a dispatcher nor staff
create or replace function app_private.disp_is_carrier_user(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select p_user is not null
     and not exists (select 1 from app_private.dispatcher_profiles dp where dp.user_id = p_user)
     and not app_private.disp_is_staff_user(p_user)
     and (exists (select 1 from public.organizations o where o.id = p_org and o.owner_user_id = p_user)
          or exists (select 1 from public.organization_memberships m where m.org_id = p_org and m.user_id = p_user and coalesce(m.status,'active') = 'active'))
$$;
revoke all on function app_private.disp_is_carrier_user(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.carrier_availability_fresh(p_org uuid, out fresh boolean, out since timestamptz, out trucks int, out reason text)
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_days int := coalesce(nullif(app_private.disp_desk_value('availability_fresh_days'), '')::int, 7);
        v_cut timestamptz := now() - make_interval(days => coalesce(nullif(app_private.disp_desk_value('availability_fresh_days'), '')::int, 7));
        v_post timestamptz; v_av timestamptz; v_any timestamptz; v_ntr int;
begin
  -- the carrier portal "Post your availability" (truck_postings) — their own post, still live
  select max(coalesce(tp.last_confirmed_at, tp.created_at)) into v_post
    from app_private.truck_postings tp
   where tp.carrier_id = p_org and tp.status = 'active' and coalesce(tp.available_to, current_date) >= current_date
     and app_private.disp_is_carrier_user(p_org, tp.created_by);
  -- the Trucks-tab line, written by the carrier (dispatcher_set_availability keeps updated_by)
  select max(av.updated_at) into v_av from app_private.truck_availability av
   where av.carrier_id = p_org and av.status in ('empty','loaded') and app_private.disp_is_carrier_user(p_org, av.updated_by);
  select max(av.updated_at) into v_any from app_private.truck_availability av where av.carrier_id = p_org and av.status in ('empty','loaded');
  select count(*) into v_ntr from app_private.fleet_trucks t where t.carrier_id = p_org and coalesce(t.status,'active') not in ('inactive','retired');
  since := greatest(v_post, v_av);
  fresh := since is not null and since >= v_cut;
  trucks := (select count(distinct x.truck_id) from (
      select tp.truck_id from app_private.truck_postings tp where tp.carrier_id = p_org and tp.status = 'active' and coalesce(tp.available_to, current_date) >= current_date
         and coalesce(tp.last_confirmed_at, tp.created_at) >= v_cut and app_private.disp_is_carrier_user(p_org, tp.created_by)
      union all
      select av.truck_id from app_private.truck_availability av where av.carrier_id = p_org and av.status in ('empty','loaded') and av.updated_at >= v_cut and app_private.disp_is_carrier_user(p_org, av.updated_by)) x where x.truck_id is not null);
  reason := case when fresh then 'ok'
                 when v_ntr = 0 then 'no_trucks'
                 when since is null and v_any is not null then 'dispatcher_only'
                 when since is null then 'never'
                 else 'stale' end;
end $$;
revoke all on function app_private.carrier_availability_fresh(uuid) from public, anon, authenticated;

create or replace function app_private.disp_availability_gate(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_mode text := coalesce(app_private.disp_desk_value('availability_gate_mode'), 'warn'); f record; v_assigned boolean;
begin
  if v_mode not in ('off','warn','enforce') then v_mode := 'warn'; end if;
  if p_org is null then return jsonb_build_object('mode', v_mode, 'assigned', false, 'fresh', true, 'blocked', false, 'warn', false); end if;
  v_assigned := exists (select 1 from app_private.dispatcher_assignments a where a.carrier_org_id = p_org and a.status = 'active');
  select * into f from app_private.carrier_availability_fresh(p_org);
  return jsonb_build_object('mode', v_mode, 'assigned', v_assigned, 'fresh', f.fresh, 'since', f.since, 'trucks', f.trucks, 'reason', f.reason,
    'days', coalesce(nullif(app_private.disp_desk_value('availability_fresh_days'), '')::int, 7),
    'blocked', v_mode = 'enforce' and v_assigned and not f.fresh,
    'warn', v_mode = 'warn' and v_assigned and not f.fresh,
    'last_label', case when f.since is null then 'never' else to_char(f.since at time zone 'America/New_York', 'Mon DD') end,
    'chip', case when not v_assigned or f.fresh then null else 'Waiting for availability · last posted ' || case when f.since is null then 'never' else to_char(f.since at time zone 'America/New_York', 'Mon DD') end end);
end $$;
revoke all on function app_private.disp_availability_gate(uuid) from public, anon, authenticated;

create or replace function app_private.disp_availability_blocked(p_org uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select coalesce((app_private.disp_availability_gate(p_org)->>'blocked')::boolean, false)
$$;
revoke all on function app_private.disp_availability_blocked(uuid) from public, anon, authenticated;

-- the one line every dispatcher write RPC calls: {} · {availability_warning} · {error, gate}
create or replace function app_private.disp_availability_check(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare g jsonb := app_private.disp_availability_gate(p_org);
begin
  if (g->>'blocked')::boolean then return jsonb_build_object('error', 'Carrier has not posted availability — nothing to work until they do.', 'gate', g); end if;
  if (g->>'warn')::boolean then return jsonb_build_object('availability_warning', 'This carrier has not posted availability (last ' || (g->>'last_label') || '). Post only what fits a posted truck — and do not call about it; the portal reminds them.', 'gate', g); end if;
  return '{}'::jsonb;
end $$;
revoke all on function app_private.disp_availability_check(uuid) from public, anon, authenticated;

-- carrier-side read (the portal board + the quick-post card)
create or replace function public.carrier_availability_gate()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select app_private.disp_availability_gate(app_private.my_carrier_org())
$$;
revoke all on function public.carrier_availability_gate() from public, anon; grant execute on function public.carrier_availability_gate() to authenticated;

-- ---------------------------------------------------------------- 3. standing rules (one text, every surface)
create or replace function app_private.disp_standing_rules_text(p_fmt text default 'html')
returns text language plpgsql stable as $$
declare r text[] := array[
  'One intro call. Right after the assignment, call the carrier once on your LoadBoot line. Introduce yourself, walk them to Post your availability in their portal (30 seconds a day), and say it plainly: every load you hunt is matched to that post — no post, nothing to work.',
  'Never call for availability again. If the post goes stale the portal reminds the carrier. You post nothing until it is fresh, and you do not chase it by phone.',
  'Every carrier call has a reason. The phone asks before it dials. After the intro only the urgent reasons are allowed: pickup within 24 hours, an in-transit problem, a broker who needs an answer now, the carrier asked to be called. Everything else goes in the thread.',
  'Post only shortlisted loads. A load goes on the carrier''s board only when it fits the posted availability, the floor rate and the SOP — 100% shortlisted, one look to decide. The carrier accepts or declines in the portal.',
  'Accepted means your move. Call the broker, lock the rate, get the rate confirmation, log it. LoadBoot approves, then the driver moves.'];
  i int; out_t text := '';
begin
  if p_fmt = 'html' then
    for i in 1..array_length(r,1) loop
      out_t := out_t || '<b>' || i || '.</b> <b>' || app_private.h_esc(split_part(r[i], '. ', 1)) || '.</b> ' || app_private.h_esc(substr(r[i], length(split_part(r[i], '. ', 1)) + 3)) || '<br>';
    end loop;
    return out_t;
  elsif p_fmt = 'thread' then
    return 'LoadBoot standing rules — ' || E'\n' || (select string_agg(x.n || '. ' || x.t, E'\n') from unnest(r) with ordinality x(t, n));
  else
    return (select string_agg(x.n || '. ' || x.t, E'\n') from unnest(r) with ordinality x(t, n));
  end if;
end $$;
revoke all on function app_private.disp_standing_rules_text(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. call reasons + columns + trigger
create table if not exists app_private.disp_call_reasons (
  code text primary key check (code ~ '^[a-z0-9_]{2,32}$'),
  label text not null,
  urgent boolean not null default false,
  active boolean not null default true,
  sort int not null default 100,
  hint text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table app_private.disp_call_reasons enable row level security;
insert into app_private.disp_call_reasons (code, label, urgent, sort, hint) values
  ('intro',           'Intro call — first call after the assignment',   false, 10, 'Once per carrier. Show them where to post availability and why; after this, the portal.'),
  ('pickup_24h',      'Pickup within 24 hours',                          true,  20, 'A load the carrier accepted picks up within a day and something needs a live answer.'),
  ('transit_problem', 'In-transit problem',                              true,  30, 'Breakdown, delay, detention, accident, facility issue on a moving load.'),
  ('broker_confirm',  'Broker needs confirmation now',                   true,  40, 'The broker is holding the load and wants a yes/no in minutes.'),
  ('carrier_asked',   'Carrier asked to be called',                      true,  50, 'They wrote "call me" in the thread or texted. Say where.'),
  ('other',           'Other — not urgent',                              false, 90, 'Allowed before the intro. After the intro this is off-policy: use the thread instead.'),
  ('callback',        'Returning the carrier''s call',                   true,  99, 'Automatic — the carrier called in the last 30 minutes.')
on conflict (code) do nothing;

create or replace function app_private.disp_standing_rules()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'availability_gate_mode', coalesce(app_private.disp_desk_value('availability_gate_mode'), 'warn'),
    'availability_fresh_days', coalesce(nullif(app_private.disp_desk_value('availability_fresh_days'), '')::int, 7),
    'call_rule_mode', coalesce(app_private.disp_desk_value('call_rule_mode'), 'warn'),
    'text', app_private.disp_standing_rules_text('text'),
    'html', app_private.disp_standing_rules_text('html'),
    'intro_script', 'I''m your LoadBoot dispatcher. I find loads only for trucks you''ve marked available, so every morning open the portal and post where the truck is, when it''s empty and when you need to be home — thirty seconds. I''ll put only loads that fit on your board; you accept or decline there. After today I won''t call unless it''s urgent — everything else is in our thread.',
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'urgent', urgent, 'hint', hint) order by sort, code) from app_private.disp_call_reasons where active and code <> 'callback'), '[]'::jsonb))
$$;

revoke all on function app_private.disp_standing_rules() from public, anon, authenticated;

alter table app_private.dialer_calls
  add column if not exists reason_code text,
  add column if not exists reason_note text,
  add column if not exists policy text check (policy in ('intro','urgent','callback','offpolicy','other'));
comment on column app_private.dialer_calls.policy is 'bl_disp_0555: how the call-rule classified an outbound call to an assigned carrier (null = not a carrier number).';
alter table app_private.dispatcher_assignments
  add column if not exists intro_call_at timestamptz,
  add column if not exists intro_call_id uuid;
comment on column app_private.dispatcher_assignments.intro_call_at is 'bl_disp_0555: when the dispatcher''s outbound intro call to the carrier was answered. After this, carrier calls need an urgent reason.';

create or replace function app_private.trg_disp_intro_call() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare v_a record;
begin
  if new.answered_at is not null and old.answered_at is null and new.direction = 'outbound' and new.reason_code = 'intro' and new.carrier_org_id is not null then
    update app_private.dispatcher_assignments a set intro_call_at = new.answered_at, intro_call_id = new.id, updated_at = now()
     where a.dispatcher_user_id = new.dispatcher_user_id and a.carrier_org_id = new.carrier_org_id and a.status = 'active' and a.intro_call_at is null
     returning a.id, a.carrier_org_id into v_a;
    if v_a.id is not null then
      insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_role, body)
      values (v_a.id, v_a.carrier_org_id, 'system', '📞 Intro call done. From here: the carrier posts availability in the portal, loads go on the board, and the dispatcher calls only if it is urgent.');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists disp_intro_call on app_private.dialer_calls;
create trigger disp_intro_call after update of answered_at on app_private.dialer_calls for each row execute function app_private.trg_disp_intro_call();

-- the number → "this is one of my carriers" + what the phone must show before dialling
create or replace function app_private.disp_call_context(p_user uuid, p_e164 text)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare k text := app_private.disp_ph10(p_e164); v_a record; v_cb boolean; v_mode text := coalesce(app_private.disp_desk_value('call_rule_mode'), 'warn');
begin
  if p_user is null or k is null or length(k) < 10 then return null; end if;
  select a.id, a.carrier_org_id, a.intro_call_at, o.name into v_a
    from app_private.dispatcher_assignments a join public.organizations o on o.id = a.carrier_org_id
   where a.dispatcher_user_id = p_user and a.status = 'active' and k = any(app_private.disp_carrier_numbers(a.carrier_org_id))
   order by a.assigned_at desc limit 1;
  if v_a.id is null then return null; end if;
  v_cb := exists (select 1 from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.direction = 'inbound'
                   and app_private.disp_ph10(c.counterparty) = k and c.started_at > now() - interval '30 minutes');
  return jsonb_build_object('assignment_id', v_a.id, 'carrier_org_id', v_a.carrier_org_id, 'carrier', v_a.name,
    'intro_call_at', v_a.intro_call_at, 'intro_done', v_a.intro_call_at is not null, 'callback_ok', v_cb, 'mode', v_mode,
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'urgent', urgent, 'hint', hint,
        'allowed', case when code = 'intro' then v_a.intro_call_at is null when urgent then true when v_a.intro_call_at is null then true else v_mode <> 'enforce' end,
        'offpolicy', code <> 'intro' and not urgent and v_a.intro_call_at is not null) order by sort, code)
      from app_private.disp_call_reasons where active and code <> 'callback'), '[]'::jsonb),
    'rule', case when v_a.intro_call_at is null then 'This is the intro call: show them where to post availability and why. After it, the portal — call only if urgent.'
                 else 'After the intro call, work through the portal: post the load, use the thread. Call only if urgent.' end);
end $$;
revoke all on function app_private.disp_call_context(uuid, text) from public, anon, authenticated;

create or replace function app_private.disp_call_stats(p_user uuid, p_days int default 7)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'days', p_days,
    'urgent', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.policy = 'urgent' and c.started_at > now() - make_interval(days => p_days)),
    'offpolicy', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.policy = 'offpolicy' and c.started_at > now() - make_interval(days => p_days)),
    'intro', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.policy = 'intro' and c.started_at > now() - make_interval(days => p_days)),
    'waiting_availability', (select count(*) from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status = 'active' and not (app_private.carrier_availability_fresh(a.carrier_org_id)).fresh),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', c.started_at, 'carrier', (select name from public.organizations where id = c.carrier_org_id), 'policy', c.policy, 'reason', c.reason_code, 'note', c.reason_note, 'answered', c.answered_at is not null, 'duration_sec', c.duration_sec) order by c.started_at desc)
                from (select * from app_private.dialer_calls where dispatcher_user_id = p_user and policy in ('urgent','offpolicy') order by started_at desc limit 20) c), '[]'::jsonb))
$$;
revoke all on function app_private.disp_call_stats(uuid, int) from public, anon, authenticated;

create or replace function public.cc_disp_call_reasons()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_can_view() then jsonb_build_object('error','not authorized')
    else jsonb_build_object('mode', coalesce(app_private.disp_desk_value('call_rule_mode'), 'warn'),
      'reasons', coalesce((select jsonb_agg(to_jsonb(r) - 'updated_by' order by r.sort, r.code) from app_private.disp_call_reasons r), '[]'::jsonb)) end
$$;
revoke all on function public.cc_disp_call_reasons() from public, anon; grant execute on function public.cc_disp_call_reasons() to authenticated;

create or replace function public.cc_disp_call_reason_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_code text := lower(btrim(coalesce(p->>'code',''))); v_label text := btrim(coalesce(p->>'label','')); r app_private.disp_call_reasons;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if v_code !~ '^[a-z0-9_]{2,32}$' then return jsonb_build_object('error','code: 2–32 lower-case letters, digits or _'); end if;
  if v_label = '' or length(v_label) > 80 then return jsonb_build_object('error','label is required (max 80 characters)'); end if;
  select * into r from app_private.disp_call_reasons where code = v_code;
  if v_code in ('intro','callback') and p ? 'active' and not coalesce((p->>'active')::boolean, true) then return jsonb_build_object('error', v_code || ' cannot be switched off — the rule needs it'); end if;
  if v_code in ('intro','callback') and p ? 'urgent' and coalesce((p->>'urgent')::boolean, r.urgent) is distinct from r.urgent then return jsonb_build_object('error', v_code || ' keeps its urgency'); end if;
  insert into app_private.disp_call_reasons as x (code, label, urgent, active, sort, hint, updated_at, updated_by)
  values (v_code, v_label, coalesce((p->>'urgent')::boolean, false), coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 100), nullif(btrim(coalesce(p->>'hint','')), ''), now(), auth.uid())
  on conflict (code) do update set label = excluded.label,
    urgent = case when x.code in ('intro','callback') then x.urgent else coalesce((p->>'urgent')::boolean, x.urgent) end,
    active = case when x.code in ('intro','callback') then true else coalesce((p->>'active')::boolean, x.active) end,
    sort = coalesce((p->>'sort')::int, x.sort), hint = case when p ? 'hint' then nullif(btrim(coalesce(p->>'hint','')), '') else x.hint end,
    updated_at = now(), updated_by = auth.uid();
  perform app_private.disp_audit('dispatcher.call_reason', 'config', v_code, null, 'call reason ' || v_code || ' — ' || v_label, p);
  return jsonb_build_object('ok', true) || public.cc_disp_call_reasons();
end $$;
revoke all on function public.cc_disp_call_reason_set(jsonb) from public, anon; grant execute on function public.cc_disp_call_reason_set(jsonb) to authenticated;

-- catalog rows for the two staff notices (in-app only — registered so the key is never 'undocumented')
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition, preference_group, unsub_allowed, status, cc_deep_link)
values
  ('dispatcher.call.urgent', 'Dispatcher called a carrier — urgent', 'Staff in-app notice: a dispatcher placed an outbound call to an assigned carrier after the intro call with an urgent reason (pickup within 24 h, in-transit problem, broker needs confirmation, carrier asked). Shows who uses it and how often.',
   'S', 'staff', 'event', 'public.dialer_call_start (bl_disp_0555)', 'per call', 'none — one line per urgent call', 'n/a', 'staff_internal', false, 'live', '#/dispatchers'),
  ('dispatcher.call.offpolicy', 'Dispatcher called a carrier — outside the rule', 'Staff in-app notice (call_rule_mode = warn): a dispatcher placed a non-urgent carrier call after the intro call. In enforce mode the call is refused instead.',
   'S', 'staff', 'event', 'public.dialer_call_start (bl_disp_0555)', 'per call', 'none', 'call_rule_mode = enforce', 'staff_internal', false, 'live', '#/dispatchers')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, trigger_source = excluded.trigger_source, status = excluded.status;

-- ---------------------------------------------------------------- 5. carrier notice carrier.availability.required
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition, preference_group, unsub_allowed, status, cc_deep_link)
values ('carrier.availability.required', 'Post your availability — your dispatcher is waiting',
  'A carrier with an active LoadBoot dispatcher has no fresh availability post of their own (truck posting or Trucks-tab line within availability_fresh_days). Tells them the dispatcher hunts loads only for trucks they marked available; in enforce mode, that the board stays hidden until they post. In-app + e-mail with one button to the quick post.',
  'T', 'carrier', 'event', 'public.cc_dispatcher_assign (new assignment) and app_private.disp_avail_sweep (cron lb-disp-avail-sweep, hourly) → app_private.disp_avail_notice',
  'at assignment, then while stale', 'max once per 24 h per carrier (app_private.disp_avail_notices); never when availability_gate_mode = off; demo orgs in-app only',
  'the carrier posts availability (fresh), the assignment ends, or the mode is off', 'load_ops', true, 'live', '#/carriers')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed, status = excluded.status, cc_deep_link = excluded.cc_deep_link;

create table if not exists app_private.disp_avail_notices (
  id bigserial primary key,
  carrier_org_id uuid not null,
  assignment_id uuid,
  kind text not null,
  reason text,
  sent_at timestamptz not null default now(),
  emailed boolean not null default false
);
create index if not exists disp_avail_notices_org_idx on app_private.disp_avail_notices (carrier_org_id, sent_at desc);
alter table app_private.disp_avail_notices enable row level security;

create or replace function app_private.disp_avail_notice(p_org uuid, p_kind text default 'stale')
returns boolean language plpgsql security definer set search_path = app_private, public as $$
declare g jsonb; v_a record; v_owner uuid; v_mail text; v_cname text; v_first text; v_html text; v_txt text; v_sub text; v_demo boolean; v_enf boolean; v_body text;
begin
  g := app_private.disp_availability_gate(p_org);
  if (g->>'mode') = 'off' or not (g->>'assigned')::boolean or (g->>'fresh')::boolean then return false; end if;
  if exists (select 1 from app_private.disp_avail_notices n where n.carrier_org_id = p_org and n.sent_at > now() - interval '24 hours') then return false; end if;
  select a.id, a.dispatcher_user_id into v_a from app_private.dispatcher_assignments a where a.carrier_org_id = p_org and a.status = 'active' order by a.assigned_at desc limit 1;
  select o.owner_user_id, o.name into v_owner, v_cname from public.organizations o where o.id = p_org;
  if v_owner is null then return false; end if;
  v_demo := app_private.is_demo_org(p_org);
  v_enf := (g->>'mode') = 'enforce';
  v_first := split_part(app_private.disp_display_name(v_a.dispatcher_user_id), ' ', 1);
  v_body := 'Your dispatcher ' || v_first || ' can only work loads for trucks you''ve marked available. Post today''s availability (30 seconds) — '
         || case when v_enf then 'until then the board stays hidden.' else 'that post is what every load is matched to.' end;
  perform app_private.disp_notify(v_owner, 'carrier', 'carrier.availability.required', 'Post your availability — ' || v_first || ' is waiting', v_body, '/app/carrier/#availability', false);
  insert into app_private.disp_avail_notices (carrier_org_id, assignment_id, kind, reason, emailed) values (p_org, v_a.id, p_kind, g->>'reason', false);
  if v_demo then return true; end if;
  select u.email into v_mail from auth.users u where u.id = v_owner;
  if v_mail is null then return true; end if;
  v_sub := 'Post your availability — ' || v_first || ' can only work trucks you mark available';
  v_html := app_private.email_kit(jsonb_build_object(
    'eyebrow', jsonb_build_object('text', case when v_enf then 'Board hidden' else 'Dispatcher waiting' end, 'tone', 'warning'),
    'title', 'Post today''s availability',
    'intro_html', 'Your dispatcher <b>' || app_private.h_esc(v_first) || '</b> hunts loads only for trucks you have marked available. '
      || case when (g->>'reason') = 'never' then 'We have not seen a post from you yet.' when (g->>'reason') = 'dispatcher_only' then 'The last line was entered by your dispatcher — it has to come from you.' else 'Your last post was ' || (g->>'last_label') || ' and is older than ' || (g->>'days') || ' days.' end
      || case when v_enf then ' Until you post, the load board stays hidden.' else ' Every load ' || app_private.h_esc(v_first) || ' puts on your board is matched to that post.' end,
    'card', jsonb_build_object('tone', 'info', 'title', 'What to post — 30 seconds', 'items', jsonb_build_array(
      'Where the truck is (or where it delivers) and when it is empty', 'Where you want to go, and when you need to be home', 'Hours left if the driver is tight')),
    'step', jsonb_build_object('label', 'Your next step', 'title', 'Open the portal and tap Post availability', 'text', 'Do it every morning the truck is open. ' || app_private.h_esc(v_first) || ' sees it the moment you post and starts hunting.'),
    'cta', jsonb_build_object('label', 'Post availability', 'url', 'https://loadboot.com/app/carrier/#availability'),
    'note', 'After the intro call your dispatcher will not phone you about availability — this reminder comes from the portal, at most once a day, and stops as soon as you post.'));
  v_txt := 'Post today''s availability. ' || v_body || E'\n\nhttps://loadboot.com/app/carrier/#availability';
  begin
    perform app_private.sys_email(v_mail, 'carrier.availability.required', v_sub, v_html, v_txt, 'availreq:' || p_org::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
    update app_private.disp_avail_notices set emailed = true where id = (select max(id) from app_private.disp_avail_notices where carrier_org_id = p_org);
  exception when others then null; end;
  return true;
end $$;
revoke all on function app_private.disp_avail_notice(uuid, text) from public, anon, authenticated;

create or replace function app_private.disp_avail_sweep()
returns int language plpgsql security definer set search_path = app_private, public as $$
declare a record; n int := 0;
begin
  if coalesce(app_private.disp_desk_value('availability_gate_mode'), 'warn') = 'off' then return 0; end if;
  for a in select distinct x.carrier_org_id from app_private.dispatcher_assignments x
             join app_private.dispatcher_profiles dp on dp.user_id = x.dispatcher_user_id
            where x.status = 'active' and dp.status in ('trial','verified','active') loop
    begin
      if app_private.disp_avail_notice(a.carrier_org_id, 'stale') then n := n + 1; end if;
    exception when others then null; end;
  end loop;
  return n;
end $$;
revoke all on function app_private.disp_avail_sweep() from public, anon, authenticated;
do $$ begin perform cron.unschedule(jobid) from cron.job where jobname = 'lb-disp-avail-sweep'; exception when others then null; end $$;
select cron.schedule('lb-disp-avail-sweep', '41 * * * *', $c$select app_private.disp_avail_sweep()$c$);

-- ---------------------------------------------------------------- 6. where is the load (one line both sides read)
create or replace function app_private.disp_load_stage(p_load uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare l record; b record; v jsonb;
begin
  select id, status, expires_at, created_at, (details->'decision'->>'at')::timestamptz dec_at into l from public.loads where id = p_load;
  if l.id is null then return null; end if;
  select id, status, created_at, updated_at, rc_received_at, approved_at into b from app_private.dispatcher_bookings where load_id = p_load order by created_at desc limit 1;
  if l.status = 'available' and (l.expires_at is null or l.expires_at > now()) then
    v := jsonb_build_object('step', 1, 'stage', 'posted', 'ball', 'carrier', 'label', 'On the carrier''s board — waiting for Accept / Decline',
      'carrier_next', 'Open it, check lane and rate, then Accept or Decline.', 'dispatcher_next', 'Nothing — do not call. Post the next shortlisted load if you have one.', 'since', l.created_at);
  elsif l.status in ('expired','declined','withdrawn') or (l.status = 'available' and l.expires_at <= now()) then
    v := jsonb_build_object('step', 0, 'stage', case when l.status = 'available' then 'expired' else l.status end, 'ball', 'closed',
      'label', case when l.status = 'declined' then 'Declined by the carrier' when l.status = 'withdrawn' then 'Withdrawn' else 'Expired — no decision in time' end,
      'carrier_next', null, 'dispatcher_next', case when l.status = 'declined' then 'Read the reason, fix the shortlist, post again.' else 'Post a fresh shortlisted load; ask in the thread what did not fit.' end, 'since', coalesce(l.dec_at, l.expires_at, l.created_at));
  elsif b.id is null or b.status in ('cancelled','rejected') then
    v := case when b.status in ('cancelled','rejected')
         then jsonb_build_object('step', 0, 'stage', b.status, 'ball', 'closed', 'label', case b.status when 'cancelled' then 'Booking cancelled' else 'Booking rejected by LoadBoot' end, 'carrier_next', null, 'dispatcher_next', 'Note the reason in the thread.', 'since', b.updated_at)
         else jsonb_build_object('step', 2, 'stage', 'accepted', 'ball', 'dispatcher', 'label', 'Accepted — dispatcher is getting the rate confirmation', 'carrier_next', 'Nothing yet — your dispatcher is locking the rate with the broker.', 'dispatcher_next', 'Call the broker, lock the rate, get the rate confirmation, attach it.', 'since', coalesce(l.dec_at, l.created_at)) end;
  else
    v := case b.status
      when 'pending_rc' then jsonb_build_object('step', 2, 'stage', 'accepted', 'ball', 'dispatcher', 'label', 'Accepted — dispatcher is getting the rate confirmation', 'carrier_next', 'Nothing yet — your dispatcher is locking the rate with the broker.', 'dispatcher_next', 'Call the broker, lock the rate, get the rate confirmation, attach it.', 'since', b.created_at)
      when 'rc_received' then jsonb_build_object('step', 3, 'stage', 'rc_check', 'ball', 'loadboot', 'label', 'Rate confirmation in — LoadBoot is checking it', 'carrier_next', 'Nothing — LoadBoot checks the RC against what was negotiated.', 'dispatcher_next', 'Wait for LoadBoot''s approval; answer any question in the thread.', 'since', coalesce(b.rc_received_at, b.updated_at))
      when 'approved' then jsonb_build_object('step', 4, 'stage', 'approved', 'ball', 'dispatcher', 'label', 'Approved — send driver + truck to the broker', 'carrier_next', 'Make sure the driver has the pickup details.', 'dispatcher_next', 'Send driver + truck details to the broker, then mark Dispatched.', 'since', coalesce(b.approved_at, b.updated_at))
      when 'dispatched' then jsonb_build_object('step', 5, 'stage', 'dispatched', 'ball', 'driver', 'label', 'Dispatched — driver heading to pickup', 'carrier_next', 'Driver heads to pickup; keep them reachable.', 'dispatcher_next', 'Check call before pickup; confirm the appointment with the broker.', 'since', b.updated_at)
      when 'picked_up' then jsonb_build_object('step', 6, 'stage', 'in_transit', 'ball', 'driver', 'label', 'In transit', 'carrier_next', 'Keep the driver reachable; report problems in the thread.', 'dispatcher_next', 'Check calls mid-route and before delivery; update the broker.', 'since', b.updated_at)
      when 'delivered' then jsonb_build_object('step', 7, 'stage', 'delivered', 'ball', 'carrier', 'label', 'Delivered — POD / invoice next', 'carrier_next', 'Upload the POD and invoice.', 'dispatcher_next', 'Confirm delivery with the broker; close the booking.', 'since', b.updated_at)
      when 'invoiced' then jsonb_build_object('step', 8, 'stage', 'invoiced', 'ball', 'done', 'label', 'Invoiced', 'carrier_next', null, 'dispatcher_next', null, 'since', b.updated_at)
      when 'paid' then jsonb_build_object('step', 8, 'stage', 'paid', 'ball', 'done', 'label', 'Paid', 'carrier_next', null, 'dispatcher_next', null, 'since', b.updated_at)
      else jsonb_build_object('step', 2, 'stage', b.status, 'ball', 'dispatcher', 'label', 'Booking ' || b.status, 'carrier_next', null, 'dispatcher_next', null, 'since', b.updated_at) end;
  end if;
  return v || jsonb_build_object('booking_id', b.id, 'booking_status', b.status, 'load_status', l.status);
end $$;
revoke all on function app_private.disp_load_stage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 7. anchor patches on live definitions
do $$
declare d text; miss constant text := 'bl_disp_0555: anchor not found in ';
  -- dispatcher_set_availability
  s1 constant text := 'if v_role is null then return jsonb_build_object(''error'',''not authorized''); end if;';
  s2 constant text := 'return jsonb_build_object(''ok'', true, ''role'', v_role);';
  -- dispatcher_post_load
  p1 constant text := 'if not v_open.ok then return jsonb_build_object(''error'', v_open.why); end if;';
  p2 constant text := 'return jsonb_build_object(''ok'', true, ''id'', v_id, ''status'', ''available'', ''rpm'', n->''rpm'', ''min_rpm'', n->''min_rpm'', ''below_min'', n->''below_min'', ''expires_at'', v_exp, ''notify'', v_note);';
  -- dispatcher_post_truck / dispatcher_request_book
  t1 constant text := 'begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object(''error'', sqlerrm); end;';
  t2 constant text := 'return v;' || E'\n' || 'end';
  r2 constant text := 'return v || jsonb_build_object(''booking'', v_bid);';
  -- dispatcher_log_booking
  b1 constant text := 'if not app_private.disp_is_assigned(v_org) then return jsonb_build_object(''error'',''you are not assigned to this carrier''); end if;';
  b2 constant text := 'return jsonb_build_object(''ok'', true, ''id'', v_id, ''status'', v_status, ''below_min'', v_below, ''warnings'', to_jsonb(v_warn));';
  -- boards
  k1 constant text := 'where l.status=''available''';
  k2 constant text := 'where status in (''available'',''offered'',''matching'',''approved_for_matching'') and (target_carrier_org is null or target_carrier_org = v_target)';
  -- reads
  c1 constant text := '''readiness'', v_ready,';
  m1 constant text := '''trucks'', (select count(*) from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id)';
  w1 constant text := '''id'', a.id, ''carrier_org_id'', a.carrier_org_id, ''status'', a.status, ''sop'', coalesce(a.sop,''{}''::jsonb) - ''disp_read_at'', ''assigned_at'', a.assigned_at,';
  w2 constant text := 'return v_out;';
  d1 constant text := '''carrier_ack_at'', a.carrier_ack_at, ''carrier_notified_at'', a.carrier_notified_at, ''contact_released_at'', a.contact_released_at,';
  d2 constant text := '''terms_log'', coalesce(';
  o1 constant text := '''dispatcher_posts'', coalesce(';
  o2 constant text := '''booking'', (select jsonb_build_object(''id'', b.id, ''status'', b.status) from app_private.dispatcher_bookings b where b.load_id = l.id order by b.created_at desc limit 1)) order by l.created_at desc)';
  y1 constant text := '''seen'', app_private.disp_post_seen(l.id),';
  -- assign
  a1 constant text := 'perform app_private.disp_audit(''dispatcher.assign'', ''assignment'', v_id::text, v_org,';
  -- dialer
  l1 constant text := '''count'', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = v_uid and c.counterparty = e));';
  e0 constant text := 'declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; ln app_private.dialer_lines; v_status text;';
  e1 constant text := 'm := app_private.dial_match(v_uid, e);';
  e2 constant text := 'contact_name, broker_contact_id, booking_id, load_id, carrier_org_id)';
  e3 constant text := 'nullif(p->>''load_id'','''')::uuid, nullif(p->>''carrier_org_id'','''')::uuid)';
  e4 constant text := 'returning id into v_id;';
  -- stats / daily mail / brief
  f1 constant text := '''flagged_since'', (select min(a.flagged_at) from app_live.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status = ''active'' and a.flagged_at is not null)';
  g1 constant text := '|| app_private.disp_tdr_kpi(''Availability posts'', coalesce(ef->>''availability_posts'',''0''), ''trucks updated'')';
  h1 constant text := '|| app_private.disp_box(''Every load &mdash; the standard'',';
begin
  -- 7a dispatcher_set_availability: dispatcher may not write the carrier's line (enforce) / is told it never counts (warn)
  d := pg_get_functiondef('public.dispatcher_set_availability(uuid, jsonb)'::regprocedure);
  if position(s1 in d) = 0 or position(s2 in d) = 0 then raise exception '%dispatcher_set_availability', miss; end if;
  d := replace(d, s1, s1 || E'\n' || '  if v_role = ''dispatcher'' and coalesce(app_private.disp_desk_value(''availability_gate_mode''), ''warn'') = ''enforce'' then return jsonb_build_object(''error'',''The carrier posts their own availability. Ask in the thread.''); end if;   -- bl_disp_0555');
  d := replace(d, s2, 'return jsonb_build_object(''ok'', true, ''role'', v_role) || case when v_role = ''dispatcher'' then jsonb_build_object(''warning'', ''The carrier posts their own availability. Ask in the thread — a line you enter never counts as the carrier''''s post.'') else ''{}''::jsonb end;   -- bl_disp_0555');
  execute d;

  -- 7b dispatcher_post_load
  d := pg_get_functiondef('public.dispatcher_post_load(uuid, jsonb)'::regprocedure);
  if position(p1 in d) = 0 or position(p2 in d) = 0 then raise exception '%dispatcher_post_load', miss; end if;
  d := replace(d, p1, p1 || E'\n' || '  if app_private.disp_availability_check(p_org) ? ''error'' then return app_private.disp_availability_check(p_org); end if;   -- bl_disp_0555');
  d := replace(d, p2, 'return jsonb_build_object(''ok'', true, ''id'', v_id, ''status'', ''available'', ''rpm'', n->''rpm'', ''min_rpm'', n->''min_rpm'', ''below_min'', n->''below_min'', ''expires_at'', v_exp, ''notify'', v_note) || (app_private.disp_availability_check(p_org) - ''gate'');');
  execute d;

  -- 7c dispatcher_post_truck
  d := pg_get_functiondef('public.dispatcher_post_truck(uuid, jsonb)'::regprocedure);
  if position(t1 in d) = 0 or position(t2 in d) = 0 then raise exception '%dispatcher_post_truck', miss; end if;
  d := replace(d, t1, t1 || E'\n' || '  if app_private.disp_availability_check(p_org) ? ''error'' then return app_private.disp_availability_check(p_org); end if;   -- bl_disp_0555');
  d := replace(d, t2, 'return v || (app_private.disp_availability_check(p_org) - ''gate'');' || E'\n' || 'end');
  execute d;

  -- 7d dispatcher_request_book
  d := pg_get_functiondef('public.dispatcher_request_book(uuid, uuid, text)'::regprocedure);
  if position(t1 in d) = 0 or position(r2 in d) = 0 then raise exception '%dispatcher_request_book', miss; end if;
  d := replace(d, t1, t1 || E'\n' || '  if app_private.disp_availability_check(p_org) ? ''error'' then return app_private.disp_availability_check(p_org); end if;   -- bl_disp_0555');
  d := replace(d, r2, 'return v || jsonb_build_object(''booking'', v_bid) || (app_private.disp_availability_check(p_org) - ''gate'');');
  execute d;

  -- 7e dispatcher_log_booking
  d := pg_get_functiondef('public.dispatcher_log_booking(jsonb)'::regprocedure);
  if position(b1 in d) = 0 or position(b2 in d) = 0 then raise exception '%dispatcher_log_booking', miss; end if;
  d := replace(d, b1, b1 || E'\n' || '  if app_private.disp_availability_check(v_org) ? ''error'' then return app_private.disp_availability_check(v_org); end if;   -- bl_disp_0555');
  d := replace(d, b2, 'return jsonb_build_object(''ok'', true, ''id'', v_id, ''status'', v_status, ''below_min'', v_below, ''warnings'', to_jsonb(v_warn)) || (app_private.disp_availability_check(v_org) - ''gate'');');
  execute d;

  -- 7f carrier board (enforce only: a gated carrier sees no loads; staff untouched)
  d := pg_get_functiondef('public.cc_pocket_available_loads(integer, integer)'::regprocedure);
  if position(k1 in d) = 0 then raise exception '%cc_pocket_available_loads', miss; end if;
  d := replace(d, k1, k1 || ' and not app_private.disp_availability_blocked(v_me)   -- bl_disp_0555' || E'\n' || '      ');
  execute d;
  d := pg_get_functiondef('public.cc_carrier_best_loads(uuid, integer)'::regprocedure);
  if position(k2 in d) = 0 then raise exception '%cc_carrier_best_loads', miss; end if;
  d := replace(d, k2, k2 || E'\n' || '      and (v_my is null or not app_private.disp_availability_blocked(v_target))   -- bl_disp_0555');
  execute d;

  -- 7g carrier_dispatcher_desk: the carrier's own tab reads the gate
  d := pg_get_functiondef('public.carrier_dispatcher_desk()'::regprocedure);
  if position(c1 in d) = 0 then raise exception '%carrier_dispatcher_desk', miss; end if;
  d := replace(d, c1, c1 || ' ''availability_gate'', app_private.disp_availability_gate(v_org),');
  execute d;

  -- 7h dispatcher_my_status / dispatcher_workspace_feed: per-assignment gate + intro state + the rules
  d := pg_get_functiondef('public.dispatcher_my_status()'::regprocedure);
  if position(m1 in d) = 0 then raise exception '%dispatcher_my_status', miss; end if;
  d := replace(d, m1, m1 || ', ''availability'', app_private.disp_availability_gate(a.carrier_org_id), ''intro_call_at'', a.intro_call_at');
  execute d;
  d := pg_get_functiondef('public.dispatcher_workspace_feed()'::regprocedure);
  if position(w1 in d) = 0 or position(w2 in d) = 0 then raise exception '%dispatcher_workspace_feed', miss; end if;
  d := replace(d, w1, w1 || ' ''availability'', app_private.disp_availability_gate(a.carrier_org_id), ''intro_call_at'', a.intro_call_at,');
  d := replace(d, w2, 'return v_out || jsonb_build_object(''rules'', app_private.disp_standing_rules());   -- bl_disp_0555');
  execute d;

  -- 7i cc_dispatcher_360 / cc_carrier_360
  d := pg_get_functiondef('public.cc_dispatcher_360(uuid)'::regprocedure);
  if position(d1 in d) = 0 or position(d2 in d) = 0 then raise exception '%cc_dispatcher_360', miss; end if;
  d := replace(d, d1, d1 || ' ''intro_call_at'', a.intro_call_at, ''availability'', app_private.disp_availability_gate(a.carrier_org_id),');
  d := replace(d, d2, '''calls'', app_private.disp_call_stats(p_user, 7), ''rules'', app_private.disp_standing_rules(),' || E'\n' || '      ' || d2);
  execute d;
  d := pg_get_functiondef('public.cc_carrier_360(uuid)'::regprocedure);
  if position(o1 in d) = 0 or position(o2 in d) = 0 then raise exception '%cc_carrier_360', miss; end if;
  d := replace(d, o1, '''availability_gate'', app_private.disp_availability_gate(v_org),' || E'\n' || '    ''dispatcher_assignment'', (select jsonb_build_object(''id'', a.id, ''status'', a.status, ''dispatcher'', app_private.disp_display_name(a.dispatcher_user_id), ''dispatcher_user'', a.dispatcher_user_id, ''assigned_at'', a.assigned_at, ''intro_call_at'', a.intro_call_at) from app_private.dispatcher_assignments a where a.carrier_org_id = v_org and a.status in (''active'',''paused'') order by a.assigned_at desc limit 1),' || E'\n' || '    ' || o1);
  d := replace(d, o2, '''stage'', app_private.disp_load_stage(l.id), ' || o2);
  execute d;
  d := pg_get_functiondef('public.dispatcher_my_posts(uuid, integer)'::regprocedure);
  if position(y1 in d) = 0 then raise exception '%dispatcher_my_posts', miss; end if;
  d := replace(d, y1, y1 || ' ''stage'', app_private.disp_load_stage(l.id),');
  execute d;

  -- 7j cc_dispatcher_assign: standing rules in the thread + the carrier notice right away
  d := pg_get_functiondef('public.cc_dispatcher_assign(uuid, uuid, jsonb)'::regprocedure);
  if position(a1 in d) = 0 then raise exception '%cc_dispatcher_assign', miss; end if;
  d := replace(d, a1, 'insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body) values (v_id, v_org, ''system'', app_private.disp_standing_rules_text(''thread''));   -- bl_disp_0555' || E'\n'
    || '  begin perform app_private.disp_avail_notice(v_org, ''assigned''); exception when others then null; end;' || E'\n' || '  ' || a1);
  execute d;

  -- 7k dialer_lookup: the phone learns it is a carrier number + the reason list
  d := pg_get_functiondef('public.dialer_lookup(text)'::regprocedure);
  if position(l1 in d) = 0 then raise exception '%dialer_lookup', miss; end if;
  d := replace(d, l1, replace(l1, '));', '),' || E'\n' || '    ''carrier_call'', app_private.disp_call_context(v_uid, e));   -- bl_disp_0555'));
  execute d;

  -- 7l dialer_call_start: the rule
  d := pg_get_functiondef('public.dialer_call_start(jsonb)'::regprocedure);
  if position(e0 in d) = 0 or position(e1 in d) = 0 or position(e2 in d) = 0 or position(e3 in d) = 0 or position(e4 in d) = 0 then raise exception '%dialer_call_start', miss; end if;
  d := replace(d, e0, e0 || ' v_cc jsonb; v_reason text; v_rnote text; v_pol text; v_rlabel text; v_rurgent boolean; v_cmode text;');
  d := replace(d, e1, e1 || E'\n'
    || '  -- bl_disp_0555: a call to one of MY carriers needs a reason; one intro; after it urgent only (enforce) / counted (warn)' || E'\n'
    || '  v_cc := app_private.disp_call_context(v_uid, e);' || E'\n'
    || '  if v_cc is not null then' || E'\n'
    || '    v_cmode := coalesce(v_cc->>''mode'', ''warn''); v_reason := nullif(btrim(coalesce(p->>''reason'','''')), ''''); v_rnote := left(nullif(btrim(coalesce(p->>''reason_note'','''')), ''''), 300);' || E'\n'
    || '    if (v_cc->>''callback_ok'')::boolean and v_reason is null then v_reason := ''callback''; end if;' || E'\n'
    || '    if v_reason is null then return jsonb_build_object(''error'', ''Pick a reason for this call.'', ''code'', ''reason_required'', ''carrier_call'', v_cc); end if;' || E'\n'
    || '    select label, urgent into v_rlabel, v_rurgent from app_private.disp_call_reasons where code = v_reason and active;' || E'\n'
    || '    if v_rlabel is null then return jsonb_build_object(''error'', ''That reason is not on the list.'', ''code'', ''reason_required'', ''carrier_call'', v_cc); end if;' || E'\n'
    || '    if v_reason = ''callback'' then v_pol := ''callback'';' || E'\n'
    || '    elsif v_reason = ''intro'' then' || E'\n'
    || '      if (v_cc->>''intro_done'')::boolean then return jsonb_build_object(''error'', ''The intro call with '' || (v_cc->>''carrier'') || '' was done on '' || to_char((v_cc->>''intro_call_at'')::timestamptz at time zone ''America/New_York'', ''Mon DD'') || ''. Pick an urgent reason, or use the thread.'', ''code'', ''intro_done'', ''carrier_call'', v_cc); end if;' || E'\n'
    || '      v_pol := ''intro'';' || E'\n'
    || '    elsif v_rurgent then v_pol := ''urgent'';' || E'\n'
    || '    elsif not (v_cc->>''intro_done'')::boolean then v_pol := ''other'';' || E'\n'
    || '    elsif v_cmode = ''enforce'' then return jsonb_build_object(''error'', ''After the intro call, work through the portal: post the load, use the thread. Call only if urgent.'', ''code'', ''portal_only'', ''carrier_call'', v_cc);' || E'\n'
    || '    else v_pol := ''offpolicy''; end if;' || E'\n'
    || '  end if;');
  d := replace(d, e2, 'contact_name, broker_contact_id, booking_id, load_id, carrier_org_id, reason_code, reason_note, policy)');
  d := replace(d, e3, 'nullif(p->>''load_id'','''')::uuid, coalesce(nullif(p->>''carrier_org_id'','''')::uuid, (v_cc->>''carrier_org_id'')::uuid), v_reason, v_rnote, v_pol)');
  d := replace(d, e4, e4 || E'\n'
    || '  if v_cc is not null and v_pol in (''intro'',''urgent'',''offpolicy'') then begin   -- bl_disp_0555: thread line + staff notice' || E'\n'
    || '    insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_role, body) values ((v_cc->>''assignment_id'')::uuid, (v_cc->>''carrier_org_id'')::uuid, ''system'',' || E'\n'
    || '      case v_pol when ''intro'' then ''📞 Intro call placed by '' || app_private.disp_display_name(v_uid) || ''.''' || E'\n'
    || '                 when ''urgent'' then ''📞 Dispatcher called — urgent: '' || v_rlabel || coalesce('' — '' || v_rnote, '''') || ''.''' || E'\n'
    || '                 else ''📞 Dispatcher called — '' || v_rlabel || coalesce('' — '' || v_rnote, '''') || ''. (After the intro call, calls are for urgent matters; everything else belongs in this thread.)'' end);' || E'\n'
    || '    if v_pol in (''urgent'',''offpolicy'') then' || E'\n'
    || '      perform app_private.disp_notify(null, ''staff'', case v_pol when ''urgent'' then ''dispatcher.call.urgent'' else ''dispatcher.call.offpolicy'' end,' || E'\n'
    || '        case v_pol when ''urgent'' then ''Urgent carrier call: '' else ''Carrier call outside the rule: '' end || app_private.disp_display_name(v_uid) || '' → '' || (v_cc->>''carrier''),' || E'\n'
    || '        v_rlabel || coalesce('' — '' || v_rnote, ''''), ''/app/command-center/#dispatchers?assignment='' || (v_cc->>''assignment_id''), false);' || E'\n'
    || '    end if;' || E'\n'
    || '  exception when others then null; end; end if;');
  execute d;

  -- 7m disp_trial_stats + the daily e-mail tiles
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname = 'disp_trial_stats';
  if position(f1 in d) = 0 then raise exception '%disp_trial_stats', miss; end if;
  d := replace(d, f1, f1 || ',' || E'\n'
    || '    ''waiting_availability'', (select count(*) from app_live.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status = ''active'' and not (app_private.carrier_availability_fresh(a.carrier_org_id)).fresh),' || E'\n'
    || '    ''urgent_calls'', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.policy = ''urgent'' and c.started_at >= p_from and c.started_at < p_to),' || E'\n'
    || '    ''offpolicy_calls'', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.policy = ''offpolicy'' and c.started_at >= p_from and c.started_at < p_to)');
  execute d;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname = 'disp_trial_daily_build';
  if position(g1 in d) = 0 then raise exception '%disp_trial_daily_build', miss; end if;
  d := replace(d, g1, g1 || E'\n'
    || '      || ''</tr><tr>'' || app_private.disp_tdr_kpi(''Waiting for availability'', coalesce(ef->>''waiting_availability'',''0''), ''carriers &mdash; post nothing, do not call'')' || E'\n'
    || '      || app_private.disp_tdr_kpi(''Urgent calls'', coalesce(ef->>''urgent_calls'',''0''), case when coalesce((ef->>''offpolicy_calls'')::int,0) > 0 then ''<span style="color:#b86e00">+ '' || (ef->>''offpolicy_calls'') || '' outside the rule</span>'' else ''after the intro, urgent only'' end)');
  execute d;

  -- 7n the dispatcher's assignment brief: standing rules box above "Every load — the standard"
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname = 'disp_assign_brief_html';
  if position(h1 in d) = 0 then raise exception '%disp_assign_brief_html', miss; end if;
  d := replace(d, h1, '|| app_private.disp_box(''LoadBoot standing rules &mdash; every carrier'', app_private.disp_standing_rules_text(''html''), ''stop'')' || E'\n' || '    ' || h1);
  execute d;
end $$;

-- ---------------------------------------------------------------- 8. assertion: no public function became anon-executable here
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname in ('cc_disp_desk_config','cc_disp_desk_config_set','carrier_availability_gate','cc_disp_call_reasons','cc_disp_call_reason_set',
                       'dispatcher_set_availability','dispatcher_post_load','dispatcher_post_truck','dispatcher_request_book','dispatcher_log_booking',
                       'cc_pocket_available_loads','cc_carrier_best_loads','carrier_dispatcher_desk','dispatcher_my_status','dispatcher_workspace_feed',
                       'cc_dispatcher_360','cc_carrier_360','dispatcher_my_posts','cc_dispatcher_assign','dialer_lookup','dialer_call_start');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;
end $$;
