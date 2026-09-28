-- bl_dial_0487 — every dispatcher gets an inbound-call alert on WhatsApp: one when the call comes in, one when it is
-- missed (with Riley's summary when Riley took it). All dispatchers, not one. (owner, 27 Sep 2026)
--
-- Why: a dispatcher who is logged out of the portal never learns a carrier called. The browser alert button
-- (app/shared/dialer.js, web push) stops once they are signed out / the device is off, and "ring my mobile"
-- (bl_dial_0351e) takes US / Canada numbers only, so it does nothing for the dispatchers in India / Pakistan /
-- the Philippines. WhatsApp reaches every one of them.
--
-- HOW (no edge-function change):
--   dialer_hook_event already decides the two moments for the web push (`notify`, bl_dial_0351b): A-leg
--   call.initiated of a new inbound call, and A-leg call.hangup that was never answered. The same condition now also
--   calls app_private.wa_call_alert(call, 'call_ring' | 'call_missed'), which writes ONE row into
--   app_private.wa_auto_outbox (bl_wa_0447). wa-auto-worker sends it exactly like the carrier notices; every rule is
--   in svc_wa_auto_claim, which now asks app_private.wa_call_alert_ready() for these rows:
--     * call_ring   — skipped if the call was answered or ended before it went out, or it is > 2 minutes old
--                     (a late "is calling you now" is noise; the missed-call alert covers it).
--     * call_missed — when Riley took the call (fallback leg answered, status 'forwarded') it waits for Riley's
--                     summary in lc_calls (same caller, same time window as cc_riley_calls / 0458c) for up to 6
--                     minutes after the call ended; a trigger on lc_calls kicks the worker the moment the summary
--                     lands. Voicemail / no message say so. Older than 2 hours = skipped, never sent late.
--   Ring alert goes only while the dispatcher is OFFLINE in the portal (line not seen for 3 minutes) — online, the
--   browser already rings. dialer_config.wa_call_alerts: 'offline' (default) | 'always' | 'off' (both alerts off).
--   The missed-call alert goes online or offline.
--
-- Which number: dispatcher_profiles.wa_alert_number (set by the dispatcher in the dock) or else their profile phone,
-- turned into E.164 with their COUNTRY (wa_staff_e164). A bare number is never guessed as +1 for a non-US
-- dispatcher (dial_e164 would turn a 10-digit Indian/Pakistani mobile into a random US number). No usable number =
-- no alert. dispatcher_profiles.wa_alert_off lets a dispatcher switch it off. Blocked dispatchers never.
--
-- Templates (UTILITY, Meta): `dispatcher_call_incoming` (2 vars) and `dispatcher_call_missed` (3 vars) are seeded as
-- DRAFT. Nothing is queued until Meta approves a template (no pile of held rows while it is at Meta). Owner:
-- CC -> WhatsApp -> Templates -> Submit, same as bl_wa_0446.
--
-- Thread: the first alert opens a WhatsApp thread for the dispatcher's own number, owned by that dispatcher and
-- CLOSED so it does not sit in the staff inbox (a reply reopens it like any thread). Closed threads are not skipped
-- for these rows (the carrier rule "staff closed it, do not write" is about carriers).
--
-- Also fixes a latent dialer_hook_event bug from bl_voice_0458b (section 7a0): a call dialled straight to a
-- dispatcher's own line failed with `record "v_rd" is not assigned yet`.
--
-- Anon SECURITY DEFINER surface: unchanged. New public function dialer_wa_alert_set is authenticated only.
-- Patches dialer_hook_event, svc_wa_auto_claim and dialer_bootstrap in place (anchor replace, raises if an anchor
-- is missing). Idempotent. STAGING first.

-- ---------------------------------------------------------------- 1. columns
alter table app_private.dialer_config add column if not exists wa_call_alerts text not null default 'offline';
do $$ begin
  alter table app_private.dialer_config add constraint dialer_config_wa_call_alerts_chk check (wa_call_alerts in ('off','offline','always'));
exception when duplicate_object then null; end $$;
comment on column app_private.dialer_config.wa_call_alerts is
  'bl_dial_0487 WhatsApp call alerts to dispatchers: offline = ring alert only while the dispatcher is not in the portal (missed alert always); always = ring alert on every call; off = no WhatsApp call alerts.';

alter table app_private.dispatcher_profiles add column if not exists wa_alert_number text;
alter table app_private.dispatcher_profiles add column if not exists wa_alert_off boolean not null default false;
comment on column app_private.dispatcher_profiles.wa_alert_number is 'bl_dial_0487 WhatsApp number (E.164) for call alerts, set by the dispatcher. Null = the profile phone + country.';

alter table app_private.wa_auto_outbox add column if not exists call_id uuid;
alter table app_private.wa_auto_outbox alter column carrier_org_id drop not null;
alter table app_private.wa_auto_outbox drop constraint if exists wa_auto_outbox_event_check;
alter table app_private.wa_auto_outbox add constraint wa_auto_outbox_event_check check (event in ('assigned','changed','call_ring','call_missed'));
create unique index if not exists wa_auto_outbox_call_event on app_private.wa_auto_outbox (call_id, event) where call_id is not null;

-- ---------------------------------------------------------------- 2. templates (DRAFT — the owner submits them to Meta)
-- Neutral account-notice wording (the dispatcher_assigned_v2 lesson), no variable at the start or the end,
-- fictitious sample values, no phone number of ours in the body (CLAUDE.md §7).
insert into app_private.wa_templates (name, category, language, body, variables, var_labels, example_vars, status, note)
values
 ('dispatcher_call_incoming', 'utility', 'en_US',
  'LoadBoot call alert: {{1}} is calling your LoadBoot dispatcher line right now from {{2}}. Open the dispatcher portal at https://loadboot.com/app/agent/ to answer. If the call is not answered it is saved in your Callbacks, and you will get a missed-call note here.',
  2, '["Caller name","Caller number"]'::jsonb, '["Sunrise Carriers LLC","+1 (312) 555-0147"]'::jsonb, 'draft',
  'Drafted 27 Sep 2026 (bl_dial_0487) - dispatcher WhatsApp call alert, sent when a call rings and the dispatcher is not in the portal'),
 ('dispatcher_call_missed', 'utility', 'en_US',
  'LoadBoot missed-call alert: you missed a call from {{1}} ({{2}}) on your LoadBoot dispatcher line. {{3}} The call is saved in your Callbacks at https://loadboot.com/app/agent/ so you can follow up.',
  3, '["Caller name","Caller number","What happened on the call"]'::jsonb,
  '["Sunrise Carriers LLC","+1 (312) 555-0147","Riley answered it. Summary: the driver is loaded in Dallas and needs a reload to Atlanta for Friday."]'::jsonb, 'draft',
  'Drafted 27 Sep 2026 (bl_dial_0487) - dispatcher WhatsApp missed-call alert with Riley''s summary')
on conflict (name) do nothing;

-- ---------------------------------------------------------------- 3. the dispatcher's WhatsApp number
-- Profile phones are stored every way ("+92 3..", "03..", "98765 43210"). A number with + (or 00) is taken as it is;
-- a bare number gets the country code of the dispatcher's country and must then have that country's length.
-- Unknown country + bare number = null (never a guess).
create or replace function app_private.wa_staff_e164(p_phone text, p_country text) returns text
language sql immutable set search_path = app_private, public as $$
  with d as (
    select btrim(coalesce(p_phone,'')) raw, regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g') n,
           regexp_replace(lower(btrim(coalesce(p_country,''))), '[^a-z ]', '', 'g') c),
  k as (
    select raw, n, case
      when c in ('united states','usa','us','united states of america','canada') then '1:10'
      when c = 'india' then '91:10'            when c = 'pakistan' then '92:10'
      when c = 'philippines' then '63:10'      when c = 'bangladesh' then '880:10'
      when c = 'nepal' then '977:10'           when c = 'sri lanka' then '94:9'
      when c = 'nigeria' then '234:10'         when c = 'kenya' then '254:9'
      when c = 'morocco' then '212:9'          when c in ('afghanistan','afganistan') then '93:9'
      when c = 'ukraine' then '380:9'          when c = 'kazakhstan' then '7:10'
      when c = 'jordan' then '962:9'           when c = 'uzbekistan' then '998:9'
      when c in ('united arab emirates','uae') then '971:9'
      when c = 'georgia' then '995:9'          when c = 'egypt' then '20:10'
      when c in ('united kingdom','uk') then '44:10'
      else null end cc_len from d),
  p as (select raw, n, split_part(cc_len, ':', 1) cc, nullif(split_part(cc_len, ':', 2), '')::int len, ltrim(n, '0') nat from k)
  select case
    when n = '' then null
    when left(raw,1) = '+' and length(n) between 8 and 15 then '+' || n
    when left(n,2) = '00' and length(n) - 2 between 8 and 15 and left(n,3) <> '000' then '+' || substr(n, 3)
    when len is null then null
    when cc = '1' then case when length(n) = 10 and substr(n,1,1) between '2' and '9' then '+1' || n
                            when length(n) = 11 and left(n,1) = '1' and substr(n,2,1) between '2' and '9' then '+' || n end
    when length(nat) = len then '+' || cc || nat
    when left(nat, length(cc)) = cc and length(nat) = length(cc) + len then '+' || nat
    else null end
  from p;
$$;

create or replace function app_private.wa_call_alert_number(p_user uuid) returns text
language plpgsql stable security definer set search_path = app_private, public as $$
declare dp app_private.dispatcher_profiles; e text; w text;
begin
  select * into dp from app_private.dispatcher_profiles where user_id = p_user;
  if dp.user_id is null then return null; end if;
  e := coalesce(nullif(dp.wa_alert_number,''), app_private.wa_staff_e164(dp.phone, dp.country));
  if e is null or app_private.dial_blocked(e, true) is not null then return null; end if;
  select app_private.dial_e164(wa_number) into w from app_private.dialer_config where id = 1;
  if e = w or exists (select 1 from app_private.dialer_lines where phone_e164 = e) then return null; end if;
  return e;
end $$;

create or replace function app_private.wa_call_alert_info(p_user uuid) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'on', not coalesce(dp.wa_alert_off, false) and app_private.wa_call_alert_number(p_user) is not null,
    'off', coalesce(dp.wa_alert_off, false),
    'number', app_private.wa_call_alert_number(p_user),
    'own', nullif(dp.wa_alert_number,'') is not null,
    'mode', coalesce((select wa_call_alerts from app_private.dialer_config where id = 1), 'offline'))
  from app_private.dispatcher_profiles dp where dp.user_id = p_user;
$$;

-- ---------------------------------------------------------------- 4. enqueue (called from dialer_hook_event)
create or replace function app_private.wa_call_alert(p_call uuid, p_event text) returns bigint
language plpgsql security definer set search_path = app_private, public as $$
declare cfg app_private.dialer_config; c app_private.dialer_calls; ln app_private.dialer_lines; dp app_private.dispatcher_profiles;
        v_tpl text := case p_event when 'call_ring' then 'dispatcher_call_incoming' when 'call_missed' then 'dispatcher_call_missed' end;
        v_e text; v_id bigint;
begin
  if v_tpl is null then return null; end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if coalesce(cfg.wa_call_alerts, 'offline') = 'off' or not (coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false))
     or nullif(cfg.wa_number,'') is null then return null; end if;
  select * into c from app_private.dialer_calls where id = p_call;
  if c.id is null or c.direction <> 'inbound' or c.dispatcher_user_id is null then return null; end if;
  if p_event = 'call_ring' and coalesce(cfg.wa_call_alerts, 'offline') = 'offline' then
    select * into ln from app_private.dialer_lines where id = c.line_id;
    if ln.sip_username is not null and ln.last_seen_at > now() - interval '3 minutes' then return null; end if;  -- in the portal: the browser rings
  end if;
  if not exists (select 1 from app_private.wa_templates where name = v_tpl and status = 'approved') then return null; end if;
  select * into dp from app_private.dispatcher_profiles where user_id = c.dispatcher_user_id;
  if dp.user_id is null or coalesce(dp.wa_alert_off, false) or dp.blocked_at is not null then return null; end if;
  v_e := app_private.wa_call_alert_number(c.dispatcher_user_id);
  if v_e is null then return null; end if;
  insert into app_private.wa_auto_outbox (event, call_id, carrier_org_id, dispatcher_user_id, template_name, vars, candidates, note)
  values (p_event, c.id, null, c.dispatcher_user_id, v_tpl, '[]'::jsonb,
          jsonb_build_array(jsonb_build_object('e164', v_e, 'who', 'dispatcher', 'name', nullif(btrim(coalesce(dp.full_name,'')),''))),
          'call alert')
  on conflict (call_id, event) where call_id is not null do nothing
  returning id into v_id;
  if v_id is not null then perform app_private.wa_auto_kick(); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 5. is the row ready? (called by svc_wa_auto_claim)
-- {vars:[...]} = send now · {wait:secs} = try again later · {skip:'why'} = never send
create or replace function app_private.wa_call_alert_ready(p_id bigint) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare o app_private.wa_auto_outbox; c app_private.dialer_calls; r record; v_who text; v_num text; v_note text; v_sum text; e text;
begin
  select * into o from app_private.wa_auto_outbox where id = p_id;
  select * into c from app_private.dialer_calls where id = o.call_id;
  if c.id is null then return jsonb_build_object('skip', 'call row is gone'); end if;
  v_who := nullif(btrim(regexp_replace(coalesce(c.contact_name,''), '\s+', ' ', 'g')), '');
  e := app_private.dial_e164(c.counterparty);
  v_num := case when e ~ '^\+1[0-9]{10}$' then '+1 (' || substr(e,3,3) || ') ' || substr(e,6,3) || '-' || substr(e,9,4)
                else coalesce(e, nullif(btrim(c.counterparty),''), 'no caller ID') end;

  if o.event = 'call_ring' then
    if o.created_at < now() - interval '2 minutes' then return jsonb_build_object('skip', 'ring alert older than 2 minutes'); end if;
    if c.answered_at is not null then return jsonb_build_object('skip', 'answered before the alert went out'); end if;
    if c.ended_at is not null then return jsonb_build_object('skip', 'call ended before the alert went out - the missed-call alert covers it'); end if;
    return jsonb_build_object('vars', jsonb_build_array(left(coalesce(v_who, 'A caller'), 80), v_num));
  end if;

  if o.created_at < now() - interval '2 hours' then return jsonb_build_object('skip', 'not sent within 2 hours - too late to be useful'); end if;
  if c.fallback_tried and c.status = 'forwarded' then          -- Riley answered the fallback leg
    select l.summary, l.contact_name into r from app_private.lc_calls l
     where l.direction = 'inbound'
       and right(regexp_replace(coalesce(l.from_number,''), '[^0-9]', '', 'g'), 10) = right(regexp_replace(coalesce(c.counterparty,''), '[^0-9]', '', 'g'), 10)
       and l.created_at between c.started_at - interval '20 seconds' and coalesce(c.ended_at, now()) + interval '30 seconds'
     order by l.created_at desc limit 1;
    v_sum := nullif(btrim(regexp_replace(coalesce(r.summary,''), '\s+', ' ', 'g')), '');
    if v_sum is null and now() < coalesce(c.ended_at, o.created_at) + interval '6 minutes' then
      return jsonb_build_object('wait', 45);
    end if;
    v_who := coalesce(v_who, nullif(btrim(regexp_replace(coalesce(r.contact_name,''), '\s+', ' ', 'g')), ''));
    if v_sum is not null then
      if length(v_sum) > 560 then v_sum := rtrim(left(v_sum, 557)) || '...'; end if;
      if v_sum !~ '[.!?]$' then v_sum := v_sum || '.'; end if;
      v_note := 'Riley answered it. Summary: ' || v_sum;
    else
      v_note := 'Riley answered it; her summary is not ready yet - open the call in LoadBoot.';
    end if;
  elsif c.status = 'voicemail' then
    v_note := 'The caller was sent to voicemail - listen to it in LoadBoot.';
  else
    v_note := 'No message was left.';
  end if;
  return jsonb_build_object('vars', jsonb_build_array(left(coalesce(v_who, 'a caller'), 80), v_num, v_note));
end $$;

-- ---------------------------------------------------------------- 6. Riley's summary lands -> send the waiting missed-call alert now
create or replace function app_private.wa_call_alert_on_summary() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
begin
  if coalesce(new.direction,'') <> 'inbound' or nullif(btrim(coalesce(new.summary,'')),'') is null
     or (tg_op = 'UPDATE' and new.summary is not distinct from old.summary) then return new; end if;
  update app_private.wa_auto_outbox set next_try_at = null, updated_at = now()
   where event = 'call_missed' and status = 'pending' and next_try_at is not null and created_at > now() - interval '30 minutes';
  if found then perform app_private.wa_auto_kick(); end if;
  return new;
exception when others then return new;       -- never break the Retell webhook
end $$;

drop trigger if exists wa_call_alert_on_summary on app_private.lc_calls;
create trigger wa_call_alert_on_summary after insert or update of summary on app_private.lc_calls
  for each row execute function app_private.wa_call_alert_on_summary();

-- ---------------------------------------------------------------- 7. in-place patches
do $$
declare s text; miss constant text := 'bl_dial_0487: expected text not found in ';
begin
  -- 7a0. dialer_hook_event BUG FIX (found by this migration's staging test, latent on prod since bl_voice_0458b,
  -- 26 Sep): the record v_rd is only filled in the WhatsApp-line (Riley) branch, but the dispatcher-line insert reads
  -- v_rd.carrier_name. A call dialled straight to a dispatcher's own LoadBoot number therefore raised
  -- `record "v_rd" is not assigned yet` and the whole webhook failed (no call row, no ring, no Riley). Prod had had
  -- no such call since 0458b, so nothing was lost yet. Fill v_rd with the empty row first (0 rows, no lookup cost).
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('riley_caller_dispatcher(null)' in s) = 0 then
    if position($o$  if c.id is null and ev = 'call.initiated' and v_to is not null then$o$ in s) = 0 then raise exception '%', miss || 'dialer_hook_event/v_rd'; end if;
    s := replace(s, $o$  if c.id is null and ev = 'call.initiated' and v_to is not null then$o$, $n$  if c.id is null and ev = 'call.initiated' and v_to is not null then
    if ln.id is null then select * into v_rd from app_private.riley_caller_dispatcher(null); end if;  -- bl_dial_0487: v_rd must be assigned$n$);
    execute s;
  end if;

  -- 7a. dialer_hook_event: the `notify` moments also go to WhatsApp
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('wa_call_alert' in s) = 0 then
    if position($o$  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act, 'notify',$o$ in s) = 0 then raise exception '%', miss || 'dialer_hook_event'; end if;
    s := replace(s, $o$  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act, 'notify',$o$, $n$  -- bl_dial_0487: the same two moments as `notify` below also go to the dispatcher on WhatsApp (never breaks the call)
  if c.id is not null and c.direction = 'inbound' and v_leg = 'a' and c.dispatcher_user_id is not null
     and ((ev = 'call.initiated' and v_cc = c.telnyx_call_control_id) or (ev = 'call.hangup' and c.answered_at is null)) then
    begin perform app_private.wa_call_alert(c.id, case when ev = 'call.initiated' then 'call_ring' else 'call_missed' end);
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act, 'notify',$n$);
    execute s;
  end if;

  -- 7b. svc_wa_auto_claim: call rows get their vars from wa_call_alert_ready; closed dispatcher threads are fine
  s := pg_get_functiondef('public.svc_wa_auto_claim(text)'::regprocedure);
  if position('wa_call_alert_ready' in s) = 0 then
    if position($o$v_owner uuid; v_payload jsonb;$o$ in s) = 0 then raise exception '%', miss || 'claim/declare'; end if;
    if position($o$    select * into tpl from app_private.wa_templates where name = o.template_name;$o$ in s) = 0 then raise exception '%', miss || 'claim/tpl'; end if;
    if position($o$exit when t.id is null or t.status = 'open';$o$ in s) = 0 then raise exception '%', miss || 'claim/exit'; end if;
    if position($o$      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at)
      values (cfg.wa_number, v_e, v_owner, nullif(btrim(coalesce(cand->>'name','')),''), cand->>'who', o.carrier_org_id, now())$o$ in s) = 0 then raise exception '%', miss || 'claim/thread'; end if;

    s := replace(s, $o$v_owner uuid; v_payload jsonb;$o$, $n$v_owner uuid; v_payload jsonb; v_ready jsonb;$n$);
    s := replace(s, $o$    select * into tpl from app_private.wa_templates where name = o.template_name;$o$, $n$    -- bl_dial_0487: dispatcher call alerts
    if o.call_id is not null then
      v_ready := app_private.wa_call_alert_ready(o.id);
      if v_ready ? 'skip' then
        update app_private.wa_auto_outbox set status = 'skipped', note = coalesce(note || ' | ', '') || (v_ready->>'skip'), updated_at = now() where id = o.id;
        continue;
      elsif v_ready ? 'wait' then
        update app_private.wa_auto_outbox set status = 'pending', next_try_at = now() + make_interval(secs => (v_ready->>'wait')::int), updated_at = now() where id = o.id;
        continue;
      end if;
      o.vars := v_ready->'vars';
      update app_private.wa_auto_outbox set vars = o.vars where id = o.id;
    end if;

    select * into tpl from app_private.wa_templates where name = o.template_name;$n$);
    s := replace(s, $o$exit when t.id is null or t.status = 'open';$o$, $n$exit when t.id is null or t.status = 'open' or o.call_id is not null;$n$);
    s := replace(s, $o$      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at)
      values (cfg.wa_number, v_e, v_owner, nullif(btrim(coalesce(cand->>'name','')),''), cand->>'who', o.carrier_org_id, now())$o$, $n$      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at, status)
      values (cfg.wa_number, v_e, case when o.call_id is not null then o.dispatcher_user_id else v_owner end,
              nullif(btrim(coalesce(cand->>'name','')),''), cand->>'who', o.carrier_org_id, now(),
              case when o.call_id is not null then 'closed' else 'open' end)$n$);
    execute s;
  end if;

  -- 7c. dialer_bootstrap: the dock shows the WhatsApp alert number
  s := pg_get_functiondef('public.dialer_bootstrap()'::regprocedure);
  if position('wa_alert' in s) = 0 then
    if position($o$'forward_number', ln.forward_number)$o$ in s) = 0 then raise exception '%', miss || 'dialer_bootstrap'; end if;
    s := replace(s, $o$'forward_number', ln.forward_number)$o$, $n$'forward_number', ln.forward_number, 'wa_alert', app_private.wa_call_alert_info(ln.dispatcher_user_id))$n$);
    execute s;
  end if;
end $$;

-- ---------------------------------------------------------------- 8. the dispatcher sets / switches off their own alert number
create or replace function public.dialer_wa_alert_set(p_number text default null, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); dp app_private.dispatcher_profiles; e text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Sign in first.'); end if;
  select * into dp from app_private.dispatcher_profiles where user_id = v_uid;
  if dp.user_id is null then return jsonb_build_object('ok', false, 'error', 'Only dispatchers have call alerts.'); end if;
  if not coalesce(p_on, true) then
    update app_private.dispatcher_profiles set wa_alert_off = true, updated_at = now() where user_id = v_uid;
    return jsonb_build_object('ok', true, 'wa_alert', app_private.wa_call_alert_info(v_uid));
  end if;
  if nullif(btrim(coalesce(p_number,'')), '') is null then
    update app_private.dispatcher_profiles set wa_alert_number = null, wa_alert_off = false, updated_at = now() where user_id = v_uid;
  else
    e := app_private.wa_staff_e164(p_number, dp.country);
    if e is null then
      return jsonb_build_object('ok', false, 'error', 'Write your WhatsApp number with the country code, e.g. +91 98765 43210.');
    end if;
    if app_private.dial_blocked(e, true) is not null
       or exists (select 1 from app_private.dialer_lines where phone_e164 = e)
       or e = (select app_private.dial_e164(wa_number) from app_private.dialer_config where id = 1) then
      return jsonb_build_object('ok', false, 'error', 'That is not your own WhatsApp number.');
    end if;
    update app_private.dispatcher_profiles set wa_alert_number = e, wa_alert_off = false, updated_at = now() where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true, 'wa_alert', app_private.wa_call_alert_info(v_uid));
end $$;

revoke all on function public.dialer_wa_alert_set(text, boolean) from public, anon;
grant execute on function public.dialer_wa_alert_set(text, boolean) to authenticated;

revoke all on function app_private.wa_staff_e164(text, text) from public, anon, authenticated;
revoke all on function app_private.wa_call_alert_number(uuid) from public, anon, authenticated;
revoke all on function app_private.wa_call_alert_info(uuid) from public, anon, authenticated;
revoke all on function app_private.wa_call_alert(uuid, text) from public, anon, authenticated;
revoke all on function app_private.wa_call_alert_ready(bigint) from public, anon, authenticated;
revoke all on function app_private.wa_call_alert_on_summary() from public, anon, authenticated;
