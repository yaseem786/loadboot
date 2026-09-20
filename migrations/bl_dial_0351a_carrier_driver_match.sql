-- bl_dial_0351a — the dialer recognises the dispatcher's ASSIGNED carriers and their drivers, not only brokers.
-- Calling a carrier owner or a driver (click-to-call from the Trucks tab / trip panel, or typed on the keypad)
-- and being called BY them now shows who it is, and the call row carries carrier_org_id + contact_kind so the
-- Command Center can tell broker calls from carrier / driver calls. Scope is assignment-bound server-side:
-- only carriers with an ACTIVE assignment to that dispatcher are matched. Additive; STAGING first.

alter table app_private.dialer_calls add column if not exists contact_kind text;   -- broker | carrier | driver | null

create or replace function app_private.dial_match(p_user uuid, p_e164 text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare k text := right(regexp_replace(coalesce(p_e164,''),'[^0-9]','','g'), 10); r jsonb;
begin
  if length(k) < 10 then return '{}'::jsonb; end if;
  -- 1) the dispatcher's own broker book
  select jsonb_build_object('kind','broker','broker_contact_id', id, 'contact_name', broker || coalesce(' · ' || nullif(rep,''), ''), 'broker', broker, 'rep', rep, 'mc', mc, 'new_authority_ok', new_authority_ok, 'last_outcome', last_outcome)
    into r from app_private.broker_contacts
   where dispatcher_user_id = p_user and right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10) = k
   order by updated_at desc limit 1;
  if r is not null then return r; end if;
  -- 2) a driver of an assigned carrier
  select jsonb_build_object('kind','driver','carrier_org_id', a.carrier_org_id, 'contact_name', coalesce(nullif(d.name,''),'Driver') || ' · driver, ' || o.name, 'carrier', o.name)
    into r from app_private.dispatcher_assignments a
    join app_private.fleet_drivers d on d.carrier_id = a.carrier_org_id
    join public.organizations o on o.id = a.carrier_org_id
   where a.dispatcher_user_id = p_user and a.status = 'active' and coalesce(d.status,'active') <> 'inactive'
     and right(regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),10) = k
   limit 1;
  if r is not null then return r; end if;
  -- 3) the owner / contact of an assigned carrier (phone or WhatsApp number)
  select jsonb_build_object('kind','carrier','carrier_org_id', a.carrier_org_id, 'contact_name', case when nullif(p.contact_name,'') is null then o.name || ' · carrier' else p.contact_name || ' · carrier, ' || o.name end, 'carrier', o.name, 'mc', p.mc)
    into r from app_private.dispatcher_assignments a
    join public.organizations o on o.id = a.carrier_org_id
    join public.profiles p on p.id = o.owner_user_id
   where a.dispatcher_user_id = p_user and a.status = 'active'
     and k in (right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10), right(regexp_replace(coalesce(p.whatsapp,''),'[^0-9]','','g'),10))
   limit 1;
  if r is not null then return r; end if;
  -- 4) a broker seen on one of the dispatcher's bookings
  select jsonb_build_object('kind','broker','booking_id', id, 'contact_name', broker || coalesce(' · ' || nullif(broker_rep,''), ''), 'broker', broker, 'rep', broker_rep, 'mc', broker_mc, 'lane', origin || ' → ' || destination)
    into r from app_private.dispatcher_bookings
   where dispatcher_user_id = p_user and right(regexp_replace(coalesce(broker_phone,''),'[^0-9]','','g'),10) = k
   order by created_at desc limit 1;
  return coalesce(r, '{}'::jsonb);
end $$;

-- every new call row (outbound or inbound) gets its kind / carrier / name filled from the match when the caller did not supply them
create or replace function app_private.dial_calls_fill() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare m jsonb;
begin
  if new.contact_kind is null or new.carrier_org_id is null or new.contact_name is null then
    m := app_private.dial_match(new.dispatcher_user_id, new.counterparty);
    new.contact_kind   := coalesce(new.contact_kind, m->>'kind');
    new.carrier_org_id := coalesce(new.carrier_org_id, (m->>'carrier_org_id')::uuid);
    new.contact_name   := coalesce(new.contact_name, m->>'contact_name');
  end if;
  return new;
end $$;
drop trigger if exists dial_calls_fill on app_private.dialer_calls;
create trigger dial_calls_fill before insert on app_private.dialer_calls for each row execute function app_private.dial_calls_fill();

create or replace function app_private.dial_call_json(c app_private.dialer_calls) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', c.id, 'direction', c.direction, 'number', c.counterparty, 'status', c.status,
    'started_at', c.started_at, 'answered_at', c.answered_at, 'ended_at', c.ended_at, 'duration_sec', c.duration_sec,
    'contact_name', c.contact_name, 'contact_kind', c.contact_kind, 'carrier_org_id', c.carrier_org_id,
    'broker_contact_id', c.broker_contact_id, 'booking_id', c.booking_id, 'load_id', c.load_id,
    'outcome', c.outcome, 'note', c.note, 'source', c.source, 'has_recording', c.recording is not null, 'hangup_cause', c.hangup_cause);
$$;

revoke all on function app_private.dial_calls_fill() from public, anon, authenticated;
