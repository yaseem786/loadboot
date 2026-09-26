-- bl_wa_0463 — CC WhatsApp list: WHO is on the other end (dispatcher · trial/hired/applicant, carrier owner, driver) and
-- which threads are waiting on us. Additive: wa_thread_json gains 'who', 'needs_reply', 'waiting_min'; nothing else changes.
-- Match = last 10 digits of the number against the numbers LoadBoot already holds (dispatcher profile phone, carrier owner
-- phone / WhatsApp, driver phone). Dispatcher first (a dispatcher's own number must never read as a carrier).
create or replace function app_private.wa_who(p_number text) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  with n as (select right(regexp_replace(coalesce(p_number,''), '\D', '', 'g'), 10) d)
  select coalesce(
    (select jsonb_build_object('kind', 'dispatcher', 'user_id', dp.user_id, 'name', coalesce(nullif(dp.full_name,''), pr.contact_name, pr.email),
              'status', dp.status,
              'label', case when dp.status = 'trial' then 'Trial dispatcher' when dp.status in ('active','verified') then 'Hired dispatcher'
                            when dp.status in ('rejected','offboarded','ended') then 'Former dispatcher' else 'Dispatcher applicant' end)
       from app_private.dispatcher_profiles dp join public.profiles pr on pr.id = dp.user_id, n
      where n.d <> '' and length(n.d) >= 7 and (right(regexp_replace(coalesce(pr.phone,''), '\D', '', 'g'), 10) = n.d or right(regexp_replace(coalesce(pr.whatsapp,''), '\D', '', 'g'), 10) = n.d)
      order by dp.created_at desc limit 1),
    (select jsonb_build_object('kind', 'carrier', 'org_id', o.id, 'name', o.name, 'contact', nullif(pr.contact_name,''), 'label', 'Carrier owner',
              'dispatcher', (select d2.full_name from app_private.dispatcher_assignments a join app_private.dispatcher_profiles d2 on d2.user_id = a.dispatcher_user_id where a.carrier_org_id = o.id and a.status = 'active' limit 1))
       from public.organizations o join public.profiles pr on pr.id = o.owner_user_id, n
      where o.kind = 'carrier' and n.d <> '' and length(n.d) >= 7 and (right(regexp_replace(coalesce(pr.phone,''), '\D', '', 'g'), 10) = n.d or right(regexp_replace(coalesce(pr.whatsapp,''), '\D', '', 'g'), 10) = n.d)
      order by o.created_at limit 1),
    (select jsonb_build_object('kind', 'driver', 'name', fd.name, 'org_id', o.id, 'carrier', o.name, 'label', 'Driver · ' || o.name)
       from app_private.fleet_drivers fd join public.organizations o on o.id = fd.carrier_id, n
      where n.d <> '' and length(n.d) >= 7 and right(regexp_replace(coalesce(fd.phone,''), '\D', '', 'g'), 10) = n.d
      order by fd.created_at limit 1),
    null::jsonb);
$$;

create or replace function app_private.wa_thread_json(t app_private.wa_threads) returns jsonb
language sql stable set search_path = app_private, public, extensions, pg_temp as $$
  select jsonb_build_object('id', t.id, 'number', t.counterparty, 'contact_name', t.contact_name, 'contact_kind', t.contact_kind,
    'owner_user_id', t.owner_user_id,
    'owner', (select coalesce(nullif(d.full_name,''), u.email) from auth.users u left join app_private.dispatcher_profiles d on d.user_id = u.id where u.id = t.owner_user_id),
    'status', t.status, 'unread', t.unread, 'last_at', t.last_at, 'last_body', left(coalesce(t.last_body,''), 140),
    'last_direction', t.last_direction, 'carrier_org_id', t.carrier_org_id, 'note', t.note,
    'window_ends', app_private.wa_window_ends(t.last_inbound_at),
    'window_open', t.last_inbound_at is not null and t.last_inbound_at > now() - interval '24 hours',
    -- bl_wa_0463
    'who', app_private.wa_who(t.counterparty),
    'needs_reply', t.status = 'open' and t.last_direction = 'inbound',
    'waiting_min', case when t.status = 'open' and t.last_direction = 'inbound' and t.last_inbound_at is not null then greatest(0, floor(extract(epoch from (now() - t.last_inbound_at)) / 60))::int end)
$$;
