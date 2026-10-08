-- bl_wa_0526 — WhatsApp auto-reply for dispatcher job seekers (8 Oct 2026, owner request)
-- When an UNKNOWN number writes to the LoadBoot WhatsApp about a dispatcher job, LoadBoot replies once by itself
-- (free-form text, inside the 24h window) and sends them to create a dispatcher account + fill the application.
-- NOT sent to: trial/hired/former dispatchers, applicants who signed up or took the skills test (they have a
-- dispatcher_profiles row -> wa_who), any number that matches an account (profiles.phone/whatsapp), carriers,
-- drivers, routed threads, blocked numbers, threads where staff replied in the last 7 days, or a number already
-- auto-replied within cooldown_days. Portal "need help" prefills and referral-partner messages are ignored.
-- Rides on the existing wa_auto_outbox + wa-auto-worker pipe (bl_wa_0447). Toggle/edit: app_private.wa_apply_config.

create table if not exists app_private.wa_apply_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  cooldown_days int not null default 30,
  body text not null,
  updated_at timestamptz not null default now()
);
insert into app_private.wa_apply_config (id, enabled, body) values (1, true,
$b$Hi, thanks for reaching out about a dispatcher role at LoadBoot.

We don't take CVs or applications on WhatsApp. All hiring happens inside our portal:

1. Create your dispatcher account: https://loadboot.com/app/agent/?join=dispatcher
2. Complete the application form in the portal.
3. Our team reviews applications within 1-3 days. The next step is a short skills test.

You will get every update in the portal and by email. Role details: https://loadboot.com/us-truck-dispatcher

- LoadBoot Hiring Team$b$)
on conflict (id) do nothing;
revoke all on app_private.wa_apply_config from public, anon, authenticated;

alter table app_private.wa_auto_outbox add column if not exists thread_id uuid references app_private.wa_threads(id) on delete set null;
create index if not exists wa_auto_outbox_thread_idx on app_private.wa_auto_outbox (thread_id) where thread_id is not null;
alter table app_private.wa_auto_outbox drop constraint if exists wa_auto_outbox_event_check;
alter table app_private.wa_auto_outbox add constraint wa_auto_outbox_event_check
  check (event = any (array['assigned','changed','call_ring','call_missed','dispatcher_apply']));

-- null = send; otherwise the reason it is not sent
create or replace function app_private.wa_apply_skip_reason(p_thread uuid, p_self bigint default null)
returns text language plpgsql stable security definer set search_path to 'app_private','public' as $f$
declare c app_private.wa_apply_config; t app_private.wa_threads; k text; w jsonb;
begin
  select * into c from app_private.wa_apply_config where id = 1;
  if not coalesce(c.enabled, false) then return 'disabled'; end if;
  select * into t from app_private.wa_threads where id = p_thread;
  if t.id is null then return 'no thread'; end if;
  if t.owner_user_id is not null or t.carrier_org_id is not null then return 'routed thread'; end if;
  k := right(regexp_replace(coalesce(t.counterparty,''), '\D', '', 'g'), 10);
  if length(k) < 7 then return 'bad number'; end if;
  if app_private.dial_blocked(t.counterparty, true) is not null then return 'blocked number'; end if;
  w := app_private.wa_who(t.counterparty);
  if w is not null then return 'known: ' || coalesce(w->>'label', w->>'kind'); end if;
  if exists (select 1 from public.profiles p
              where right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10) = k
                 or right(regexp_replace(coalesce(p.whatsapp,''), '\D', '', 'g'), 10) = k) then
    return 'has an account'; end if;
  if exists (select 1 from app_private.wa_auto_outbox o
              where o.event = 'dispatcher_apply' and o.thread_id = t.id and o.id is distinct from p_self
                and o.status not in ('skipped','expired')
                and o.created_at > now() - make_interval(days => c.cooldown_days)) then
    return 'already auto-replied'; end if;
  if exists (select 1 from app_private.wa_messages m
              where m.thread_id = t.id and m.direction = 'outbound' and m.sender_user_id is not null
                and m.created_at > now() - interval '7 days') then
    return 'staff is talking'; end if;
  return null;
end $f$;
revoke all on function app_private.wa_apply_skip_reason(uuid, bigint) from public, anon, authenticated;

create or replace function app_private.wa_apply_on_inbound()
returns trigger language plpgsql security definer set search_path to 'app_private','public' as $f$
declare b text := coalesce(new.body, '');
begin
  begin
    if b !~* '(dispatch|hiring|\mhire\M|\mjobs?\M|vacanc|position|resume|\mcv\M|career|\mapply|applicat|fresher|trainee|training|work from home|remote work|opportunit)' then return new; end if;
    if b ~* '^\s*hi loadboot\s*\S\s*i need help in the' or b ~* '(referral|partner program|affiliate)' then return new; end if;
    if app_private.wa_apply_skip_reason(new.thread_id) is not null then return new; end if;
    insert into app_private.wa_auto_outbox (event, thread_id, template_name, vars, note)
    values ('dispatcher_apply', new.thread_id, 'text:dispatcher_apply', '[]'::jsonb, 'auto-reply: dispatcher applicant');
    perform app_private.wa_auto_kick();
  exception when others then
    raise warning 'wa_apply_on_inbound: %', sqlerrm;   -- never break an inbound WhatsApp
  end;
  return new;
end $f$;
revoke all on function app_private.wa_apply_on_inbound() from public, anon, authenticated;

drop trigger if exists wa_apply_on_inbound on app_private.wa_messages;
create trigger wa_apply_on_inbound after insert on app_private.wa_messages
  for each row when (new.direction = 'inbound') execute function app_private.wa_apply_on_inbound();

-- teach the worker's claim step to send the free-form text (anchor patch; idempotent)
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.svc_wa_auto_claim'::regproc);
  if position('bl_wa_0526' in d) > 0 then return; end if;
  d := replace(d, E'    if o.assignment_id is not null then', $ins$    -- bl_wa_0526: dispatcher-applicant auto-reply (free-form text inside the 24h window)
    if o.event = 'dispatcher_apply' then
      select * into t from app_private.wa_threads where id = o.thread_id;
      v_body := app_private.wa_apply_skip_reason(o.thread_id, o.id);
      if v_body is null and (t.last_inbound_at is null or t.last_inbound_at < now() - interval '23 hours') then v_body := '24h window closed'; end if;
      if v_body is not null then
        update app_private.wa_auto_outbox set status = 'skipped', note = coalesce(note || ' | ', '') || v_body, updated_at = now() where id = o.id;
        continue;
      end if;
      select count(*) into n from app_private.wa_messages x where x.direction = 'outbound' and x.created_at > now() - interval '1 hour';
      if n >= coalesce(cfg.max_wa_per_hour, 120) then
        update app_private.wa_auto_outbox set status = 'pending', next_try_at = now() + interval '5 minutes', updated_at = now() where id = o.id;
        continue;
      end if;
      select body into v_body from app_private.wa_apply_config where id = 1;
      insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, status)
      values (t.id, 'outbound', null, 'text', v_body, 'queued') returning * into m;
      update app_private.wa_threads set last_at = now(), last_body = left(v_body, 300), last_direction = 'outbound',
             last_outbound_at = now(), updated_at = now() where id = t.id;
      update app_private.wa_auto_outbox set status = 'sending', message_id = m.id, sent_to = t.counterparty,
             attempts = attempts + 1, next_try_at = null, updated_at = now() where id = o.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('outbox_id', o.id, 'message_id', m.id, 'from', cfg.wa_number, 'to', t.counterparty,
        'whatsapp_message', jsonb_build_object('type','text','text', jsonb_build_object('body', v_body, 'preview_url', false))));
      continue;
    end if;

    if o.assignment_id is not null then$ins$);
  if position('bl_wa_0526' in d) = 0 then raise exception 'bl_wa_0526: anchor not found in svc_wa_auto_claim'; end if;
  execute d;
end $do$;
