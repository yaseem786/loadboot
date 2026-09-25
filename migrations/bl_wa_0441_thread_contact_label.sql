-- bl_wa_0441 — WhatsApp threads show WHO, not just a number.
-- Applied: staging + prod 2026-09-25.
-- Owner ask (Yaseen, 25 Sep 2026): the dispatcher and CC must see the carrier company name on a
-- conversation, not "(513) 307-0487". Routing (bl_wa_0368) already resolves carrier_org_id from the
-- owner's or a driver's phone; it never filled contact_name / contact_kind, so the UI fell back to
-- the number. This fills them at insert/update time (trigger) and backfills existing threads.
-- Label: "<Contact name> · <COMPANY>" for the owner's number, "<Driver> (driver) · <COMPANY>" for a
-- driver's number, else just "<COMPANY>". A hand-typed contact_name (wa_start p_contact_name) wins.
-- No public function added → anon SECURITY DEFINER surface unchanged. Apply: staging → prod.

create or replace function app_private.wa_thread_label(p_carrier uuid, p_counterparty text)
returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public'
as $$
declare v_d text := right(regexp_replace(coalesce(p_counterparty,''), '\D', '', 'g'), 10);
        v_org text; v_owner uuid; v_owner_name text; v_owner_phone text; v_driver text;
begin
  if p_carrier is null then return null; end if;
  select o.name, o.owner_user_id into v_org, v_owner from public.organizations o where o.id = p_carrier;
  if v_org is null then return null; end if;
  select p.contact_name, right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10) into v_owner_name, v_owner_phone
    from public.profiles p where p.id = v_owner;
  if v_d <> '' then
    select d.name into v_driver from app_private.fleet_drivers d
     where d.carrier_id in (p_carrier, v_owner) and right(regexp_replace(coalesce(d.phone,''), '\D', '', 'g'), 10) = v_d
     order by (d.status = 'active') desc limit 1;
  end if;
  if v_driver is not null and (v_owner_phone is distinct from v_d) then
    return jsonb_build_object('name', v_driver || ' (driver) · ' || v_org, 'kind', 'driver');
  elsif nullif(v_owner_name,'') is not null then
    return jsonb_build_object('name', v_owner_name || ' · ' || v_org, 'kind', 'carrier');
  else
    return jsonb_build_object('name', v_org, 'kind', 'carrier');
  end if;
end $$;
revoke all on function app_private.wa_thread_label(uuid, text) from public, anon;

create or replace function app_private.trg_wa_thread_label()
returns trigger
language plpgsql security definer set search_path to 'app_private', 'public'
as $$
declare l jsonb;
begin
  if new.carrier_org_id is not null and (new.contact_name is null or btrim(new.contact_name) = ''
       or (tg_op = 'UPDATE' and new.carrier_org_id is distinct from old.carrier_org_id and new.contact_name is not distinct from old.contact_name)) then
    l := app_private.wa_thread_label(new.carrier_org_id, new.counterparty);
    if l is not null then
      new.contact_name := l->>'name';
      new.contact_kind := coalesce(new.contact_kind, l->>'kind');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_wa_thread_label on app_private.wa_threads;
create trigger trg_wa_thread_label
  before insert or update of carrier_org_id, contact_name on app_private.wa_threads
  for each row execute function app_private.trg_wa_thread_label();

-- backfill every thread that already knows its carrier but shows a bare number
update app_private.wa_threads t
   set contact_name = (app_private.wa_thread_label(t.carrier_org_id, t.counterparty))->>'name',
       contact_kind = coalesce(t.contact_kind, (app_private.wa_thread_label(t.carrier_org_id, t.counterparty))->>'kind'),
       updated_at = now()
 where t.carrier_org_id is not null and (t.contact_name is null or btrim(t.contact_name) = '');
