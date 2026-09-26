-- bl_wa_0447 — the carrier is told on WhatsApp, automatically, when a dispatcher is put on or taken off the account
-- (owner, 25 Sep 2026)
--
-- Before: `dispatcher_assigned_v2` (approved, UTILITY) and `dispatcher_changed` (0446, at Meta) could only be sent by
-- hand from the CC inbox. Every WhatsApp send ran AS THE CALLER through public.wa_send_prepare, so nothing in the
-- database could send one on its own.
--
-- After: a trigger on app_private.dispatcher_assignments writes one row per event into app_private.wa_auto_outbox:
--   * INSERT active, or paused -> active ............ `dispatcher_assigned_v2` (carrier, dispatcher, date)
--   * active -> ended / paused ...................... `dispatcher_changed`     (carrier, old dispatcher, date)
--   * paused -> ended sends nothing (the carrier was already told at the pause); a pause/resume the CARRIER made
--     himself (carrier_dispatcher_pause, auth.uid() is a member of that carrier) sends nothing either.
-- pg_net kicks the edge function `wa-auto-worker` (same pattern as push-worker, bl_inv_0414): it claims due rows
-- through public.svc_wa_auto_claim, posts them to Telnyx, and reports back through public.svc_wa_auto_done.
-- The Telnyx key stays in the edge function; every rule stays here.
--
-- Who receives it — ONE message per event, the first number that works:
--   1. the carrier owner (profiles.whatsapp, then profiles.phone), a number that already wrote to us first;
--   2. the carrier's active drivers (fleet_drivers.phone), again one that already wrote to us first.
--   A number whose thread staff CLOSED is skipped. When Telnyx refuses a number, or Meta reports it failed later
--   (not on WhatsApp = error 131026), the wa_messages trigger moves the row to the next number and kicks again.
--
-- Guards: demo carriers never (organizations.is_demo); WhatsApp switched off in dialer_config -> the row waits;
-- template not approved at Meta -> the row is 'held' and goes out once it is (so `dispatcher_changed` starts working
-- the moment Meta approves it); the hourly cap is shared with the inbox; a row is re-checked against the assignment
-- when it is claimed (a resume before the send cancels the "no longer" message) and expires after 72 hours.
--
-- Thread ownership (the bug this exposed): ending ONE assignment left the carrier's WhatsApp threads owned by the old
-- dispatcher (only disp_offboard released them), so the carrier's reply to "X is no longer your dispatcher" would land
-- in X's inbox. Now: active -> ended/paused releases that carrier's threads owned by the old dispatcher (owner null =
-- staff inbox); a new active assignment takes the carrier's unowned threads. Threads staff gave to someone else are
-- not touched.
--
-- Anon SECURITY DEFINER surface: unchanged. The two new public functions are service_role only.

-- ---------------------------------------------------------------- 1. outbox + worker config
create table if not exists app_private.wa_auto_outbox (
  id              bigserial primary key,
  event           text not null check (event in ('assigned','changed')),
  assignment_id   uuid,                         -- null = a hand-made row (test / backfill): not re-checked
  carrier_org_id  uuid not null,
  dispatcher_user_id uuid,
  template_name   text not null,
  vars            jsonb not null,
  status          text not null default 'pending'
                  check (status in ('pending','held','sending','sent','delivered','failed','skipped','expired')),
  candidates      jsonb,                        -- [{e164, who, name}] fixed at the first claim
  cand_idx        int not null default 0,
  message_id      uuid,                         -- the wa_messages row now in flight
  sent_to         text,
  note            text,
  attempts        int not null default 0,
  next_try_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists wa_auto_outbox_due on app_private.wa_auto_outbox (id) where status in ('pending','held');
create index if not exists wa_auto_outbox_msg on app_private.wa_auto_outbox (message_id) where message_id is not null;
revoke all on app_private.wa_auto_outbox from public, anon, authenticated;

create table if not exists app_private.wa_auto_config (
  id int primary key default 1 check (id = 1), fn_url text not null, secret text not null, enabled boolean not null default true);
insert into app_private.wa_auto_config (id, fn_url, secret)
select 1, fn_base || '/functions/v1/wa-auto-worker', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
from app_private.dmail_config where id = 1
on conflict (id) do nothing;
revoke all on app_private.wa_auto_config from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. kick + enqueue
create or replace function app_private.wa_auto_kick() returns void language plpgsql security definer set search_path = app_private, public as $$
declare c record;
begin
  select * into c from app_private.wa_auto_config where id = 1;
  if not found or not c.enabled then return; end if;
  perform net.http_post(url := c.fn_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-wa-auto-secret', c.secret), body := '{}'::jsonb);
exception when others then null;
end $$;

create or replace function app_private.wa_auto_enqueue(p_event text, p_assignment uuid, p_org uuid, p_dispatcher uuid, p_note text default null)
returns bigint language plpgsql security definer set search_path = app_private, public as $$
declare v_id bigint; v_org text; v_demo boolean; v_disp text;
begin
  select name, coalesce(is_demo, false) into v_org, v_demo from public.organizations where id = p_org;
  if v_demo is null or v_demo then return null; end if;            -- unknown or demo carrier: never
  -- the same event for the same assignment twice within 2 minutes is one status flip written twice, not two events
  if p_assignment is not null and exists (select 1 from app_private.wa_auto_outbox where assignment_id = p_assignment and event = p_event
       and created_at > now() - interval '2 minutes') then return null; end if;
  select nullif(btrim(full_name), '') into v_disp from app_private.dispatcher_profiles where user_id = p_dispatcher;
  insert into app_private.wa_auto_outbox (event, assignment_id, carrier_org_id, dispatcher_user_id, template_name, vars, note)
  values (p_event, p_assignment, p_org, p_dispatcher,
          case p_event when 'assigned' then 'dispatcher_assigned_v2' else 'dispatcher_changed' end,
          jsonb_build_array(coalesce(nullif(btrim(v_org), ''), 'your company'),
                            coalesce(v_disp, case p_event when 'assigned' then 'A LoadBoot dispatcher' else 'Your previous dispatcher' end),
                            to_char(now() at time zone 'America/Chicago', 'FMDD FMMonth YYYY')),
          p_note)
  returning id into v_id;
  perform app_private.wa_auto_kick();
  return v_id;
end $$;

-- ---------------------------------------------------------------- 3. the trigger on assignments
create or replace function app_private.wa_auto_on_assignment() returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_by_carrier boolean := auth.uid() is not null and app_private.disp_is_carrier_member(new.carrier_org_id);
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      update app_private.wa_threads set owner_user_id = new.dispatcher_user_id, updated_at = now()
       where carrier_org_id = new.carrier_org_id and owner_user_id is null;
      begin perform app_private.wa_auto_enqueue('assigned', new.id, new.carrier_org_id, new.dispatcher_user_id); exception when others then null; end;
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;

  if old.status = 'active' and new.status in ('ended','paused') then
    update app_private.wa_threads set owner_user_id = null, updated_at = now()
     where carrier_org_id = new.carrier_org_id and owner_user_id = new.dispatcher_user_id;
    if not v_by_carrier then
      begin perform app_private.wa_auto_enqueue('changed', new.id, new.carrier_org_id, new.dispatcher_user_id, new.status); exception when others then null; end;
    end if;
  elsif old.status = 'paused' and new.status = 'active' then
    update app_private.wa_threads set owner_user_id = new.dispatcher_user_id, updated_at = now()
     where carrier_org_id = new.carrier_org_id and owner_user_id is null;
    if not v_by_carrier then
      begin perform app_private.wa_auto_enqueue('assigned', new.id, new.carrier_org_id, new.dispatcher_user_id, 'resumed'); exception when others then null; end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wa_auto_on_assignment on app_private.dispatcher_assignments;
create trigger wa_auto_on_assignment after insert or update of status on app_private.dispatcher_assignments
  for each row execute function app_private.wa_auto_on_assignment();

-- ---------------------------------------------------------------- 4. who can receive it
-- Ordered: carrier owner before drivers; within each, a number that already wrote to us (proven on WhatsApp) first.
create or replace function app_private.wa_auto_candidates(p_org uuid) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  with cfg as (select wa_number from app_private.dialer_config where id = 1),
  raw as (
    select app_private.dial_e164(p.whatsapp) e, 'carrier' who, coalesce(nullif(btrim(p.contact_name),''), o.name) nm, 1 src
      from public.organizations o join public.profiles p on p.id = o.owner_user_id where o.id = p_org
    union all
    select app_private.dial_e164(p.phone), 'carrier', coalesce(nullif(btrim(p.contact_name),''), o.name), 2
      from public.organizations o join public.profiles p on p.id = o.owner_user_id where o.id = p_org
    union all
    select app_private.dial_e164(d.phone), 'driver', d.name, 3
      from app_private.fleet_drivers d where d.carrier_id = p_org and coalesce(d.status,'active') <> 'inactive'
  ),
  c as (
    select distinct on (r.e) r.e, r.who, r.nm, r.src,
           exists (select 1 from app_private.wa_threads t, cfg where t.wa_number = cfg.wa_number and t.counterparty = r.e and t.last_inbound_at is not null) proven
      from raw r, cfg
     where r.e is not null and r.e <> coalesce(cfg.wa_number,'') and app_private.dial_blocked(r.e, true) is null
     order by r.e, r.src
  )
  select coalesce(jsonb_agg(jsonb_build_object('e164', e, 'who', who, 'name', nm)
           order by (who = 'carrier') desc, proven desc, src), '[]'::jsonb)
    from (select * from c order by (who = 'carrier') desc, proven desc, src limit 6) x;
$$;

-- ---------------------------------------------------------------- 5. claim (service_role only)
create or replace function public.svc_wa_auto_claim(p_secret text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare cfg app_private.dialer_config; o app_private.wa_auto_outbox; tpl app_private.wa_templates; a record;
        t app_private.wa_threads; m app_private.wa_messages; cand jsonb; v_e text; n int; v_body text; v_out jsonb := '[]'::jsonb;
        v_owner uuid; v_payload jsonb;
begin
  if p_secret is null or p_secret is distinct from (select secret from app_private.wa_auto_config where id = 1) then
    raise exception 'forbidden' using errcode = '42501'; end if;

  update app_private.wa_auto_outbox set status = 'expired', note = coalesce(note || ' | ', '') || 'not sent within 72 hours', updated_at = now()
   where status in ('pending','held') and created_at < now() - interval '72 hours';
  -- a row stuck in 'sending' (worker died between claim and done) is NOT sent again: Telnyx may already have
  -- delivered it, and the same notice twice to a carrier is worse than one we check by hand
  update app_private.wa_auto_outbox set status = 'failed', note = coalesce(note || ' | ', '') || 'worker did not report back - check the thread', updated_at = now()
   where status = 'sending' and updated_at < now() - interval '10 minutes';

  select * into cfg from app_private.dialer_config where id = 1;
  if not (coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false)) or cfg.wa_number is null then return v_out; end if;

  for o in select * from app_private.wa_auto_outbox
            where status in ('pending','held') and (next_try_at is null or next_try_at <= now())
            order by id limit 20 for update skip locked loop

    -- still true? (hand-made rows have no assignment and are not re-checked)
    if o.assignment_id is not null then
      select status, dispatcher_user_id into a from app_private.dispatcher_assignments where id = o.assignment_id;
      if a.status is null
         or (o.event = 'assigned' and a.status <> 'active')
         or (o.event = 'changed'  and a.status not in ('ended','paused')) then
        update app_private.wa_auto_outbox set status = 'skipped', note = coalesce(note || ' | ', '') || 'assignment is ' || coalesce(a.status,'gone') || ' now', updated_at = now() where id = o.id;
        continue;
      end if;
    end if;

    select * into tpl from app_private.wa_templates where name = o.template_name;
    if tpl.name is null or tpl.status <> 'approved' or coalesce(tpl.category,'') = 'marketing' or tpl.variables <> jsonb_array_length(o.vars) then
      update app_private.wa_auto_outbox set status = 'held', next_try_at = now() + interval '10 minutes',
             note = 'template ' || o.template_name || ' is ' || coalesce(tpl.status, 'missing'), updated_at = now() where id = o.id;
      continue;
    end if;

    select count(*) into n from app_private.wa_messages x where x.direction = 'outbound' and x.created_at > now() - interval '1 hour';
    if n >= coalesce(cfg.max_wa_per_hour, 120) then
      update app_private.wa_auto_outbox set status = 'pending', next_try_at = now() + interval '5 minutes', updated_at = now() where id = o.id;
      continue;
    end if;

    if o.candidates is null then
      o.candidates := app_private.wa_auto_candidates(o.carrier_org_id);
      update app_private.wa_auto_outbox set candidates = o.candidates where id = o.id;
    end if;

    -- the next number that is not a conversation staff closed
    t := null;
    while o.cand_idx < jsonb_array_length(o.candidates) loop
      cand := o.candidates->o.cand_idx;
      v_e := cand->>'e164';
      select * into t from app_private.wa_threads where wa_number = cfg.wa_number and counterparty = v_e;
      exit when t.id is null or t.status = 'open';
      t := null; o.cand_idx := o.cand_idx + 1;
    end loop;
    if o.cand_idx >= jsonb_array_length(o.candidates) then
      update app_private.wa_auto_outbox set status = 'failed', cand_idx = o.cand_idx, message_id = null,
             note = coalesce(note || ' | ', '') || case when jsonb_array_length(o.candidates) = 0 then 'carrier has no phone on file' else 'no number took the message' end,
             updated_at = now() where id = o.id;
      continue;
    end if;

    if t.id is null then
      select a2.dispatcher_user_id into v_owner from app_private.dispatcher_assignments a2
       where a2.carrier_org_id = o.carrier_org_id and a2.status = 'active' order by a2.assigned_at desc nulls last limit 1;
      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at)
      values (cfg.wa_number, v_e, v_owner, nullif(btrim(coalesce(cand->>'name','')),''), cand->>'who', o.carrier_org_id, now())
      on conflict (wa_number, counterparty) do nothing
      returning * into t;
      if t.id is null then select * into t from app_private.wa_threads where wa_number = cfg.wa_number and counterparty = v_e; end if;
    end if;

    v_body := app_private.wa_fill(tpl.body, o.vars);
    insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, template_name, template_vars, status)
    values (t.id, 'outbound', null, 'template', v_body, tpl.name, o.vars, 'queued') returning * into m;
    update app_private.wa_threads set last_at = now(), last_body = left(v_body, 300), last_direction = 'outbound',
           last_outbound_at = now(), updated_at = now() where id = t.id;
    update app_private.wa_auto_outbox set status = 'sending', cand_idx = o.cand_idx, message_id = m.id, sent_to = v_e,
           attempts = attempts + 1, next_try_at = null, updated_at = now() where id = o.id;

    v_payload := jsonb_build_object('type','template','template',
      jsonb_build_object('name', tpl.name,
        'language', jsonb_build_object('policy','deterministic','code', tpl.language),
        'components', jsonb_build_array(jsonb_build_object('type','body','parameters',
          (select jsonb_agg(jsonb_build_object('type','text','text', x)) from jsonb_array_elements_text(o.vars) x)))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('outbox_id', o.id, 'message_id', m.id, 'from', cfg.wa_number, 'to', v_e,
      'whatsapp_message', v_payload));
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- 6. done (service_role only)
-- [{outbox_id, message_id, ok, telnyx_id, error}] — a refusal marks the message failed, and the trigger below moves
-- the row to the next number.
create or replace function public.svc_wa_auto_done(p_secret text, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare r jsonb; n int := 0;
begin
  if p_secret is null or p_secret is distinct from (select secret from app_private.wa_auto_config where id = 1) then
    raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    if coalesce((r->>'ok')::boolean, false) and nullif(r->>'telnyx_id','') is not null then
      update app_private.wa_messages set status = case when status = 'queued' then 'sent' else status end,
             telnyx_message_id = r->>'telnyx_id', updated_at = now() where id = (r->>'message_id')::uuid;
      update app_private.wa_auto_outbox set status = 'sent', updated_at = now()
       where id = (r->>'outbox_id')::bigint and status = 'sending';
    else
      update app_private.wa_messages set status = 'failed', error = left(coalesce(r->>'error', 'refused'), 300), updated_at = now()
       where id = (r->>'message_id')::uuid;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

revoke all on function public.svc_wa_auto_claim(text) from public, anon, authenticated;
revoke all on function public.svc_wa_auto_done(text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_wa_auto_claim(text) to service_role;
grant execute on function public.svc_wa_auto_done(text, jsonb) to service_role;

-- ---------------------------------------------------------------- 7. delivery receipts move the row on
create or replace function app_private.wa_auto_on_message() returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'failed' then
    update app_private.wa_auto_outbox set status = 'pending', cand_idx = cand_idx + 1, message_id = null, next_try_at = null,
           note = left(coalesce(note || ' | ', '') || coalesce(sent_to, '?') || ': ' || coalesce(new.error, 'failed'), 1000), updated_at = now()
     where message_id = new.id and status in ('sending','sent','delivered') and created_at > now() - interval '72 hours';
    if found then perform app_private.wa_auto_kick(); end if;
  elsif new.status in ('delivered','read') then
    update app_private.wa_auto_outbox set status = 'delivered', updated_at = now() where message_id = new.id and status in ('sending','sent');
  end if;
  return new;
end $$;

drop trigger if exists wa_auto_on_message on app_private.wa_messages;
create trigger wa_auto_on_message after update of status on app_private.wa_messages
  for each row when (new.direction = 'outbound' and new.template_name is not null)
  execute function app_private.wa_auto_on_message();

-- ---------------------------------------------------------------- 8. sweep: held rows go out once Meta approves
create or replace function app_private.wa_auto_sweep() returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  if exists (select 1 from app_private.wa_auto_outbox where status in ('pending','held') and (next_try_at is null or next_try_at <= now()))
     or exists (select 1 from app_private.wa_auto_outbox where status = 'sending' and updated_at < now() - interval '10 minutes') then
    perform app_private.wa_auto_kick();
  end if;
end $$;

do $$ begin perform cron.unschedule('wa-auto-sweep'); exception when others then null; end $$;
select cron.schedule('wa-auto-sweep', '*/5 * * * *', $c$select app_private.wa_auto_sweep()$c$);

revoke all on function app_private.wa_auto_kick() from public, anon, authenticated;
revoke all on function app_private.wa_auto_enqueue(text, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_private.wa_auto_candidates(uuid) from public, anon, authenticated;
revoke all on function app_private.wa_auto_sweep() from public, anon, authenticated;
