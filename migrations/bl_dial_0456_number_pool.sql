-- bl_dial_0456 — Number pool: every Telnyx number LoadBoot buys is registered ONCE in CC (Phones → Numbers),
-- then assigned to a dispatcher from the pool. One number = one dispatcher stays (dialer_lines unchanged).
-- Additive: new table + trigger + 3 RPCs. cc_dialer_line_upsert / cc_dialer_overview are NOT touched.

create table if not exists app_private.dialer_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  label text,
  telnyx_number_id text,
  note text,
  sms_ready boolean not null default false,          -- attached to the 10DLC campaign + messaging profile in Telnyx
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
alter table app_private.dialer_numbers enable row level security;  -- same as every other dialer table; only the SECURITY DEFINER RPCs read it

-- backfill: every number that ever had a line is in the pool
insert into app_private.dialer_numbers (phone_e164, label, telnyx_number_id, created_by)
select distinct on (phone_e164) phone_e164, label, telnyx_number_id, created_by
  from app_private.dialer_lines order by phone_e164, (status = 'active') desc, updated_at desc
on conflict (phone_e164) do nothing;

-- any line created by the old path (assign drawer typing a fresh number) registers the number too
create or replace function app_private.dialer_numbers_register() returns trigger language plpgsql as $$
begin
  insert into app_private.dialer_numbers (phone_e164, label, telnyx_number_id, created_by)
  values (new.phone_e164, new.label, new.telnyx_number_id, new.created_by)
  on conflict (phone_e164) do update set
    label = coalesce(app_private.dialer_numbers.label, excluded.label),
    telnyx_number_id = coalesce(app_private.dialer_numbers.telnyx_number_id, excluded.telnyx_number_id),
    status = 'active', updated_at = now();
  return new;
end $$;
drop trigger if exists dialer_numbers_register on app_private.dialer_lines;
create trigger dialer_numbers_register after insert on app_private.dialer_lines
  for each row execute function app_private.dialer_numbers_register();

-- list: pool + who holds each number now
create or replace function public.cc_dialer_numbers() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('rows', coalesce((select jsonb_agg(x order by (x->>'line_id') is null desc, x->>'number') from (
    select jsonb_build_object('id', n.id, 'number', n.phone_e164, 'label', n.label, 'telnyx_number_id', n.telnyx_number_id, 'note', n.note,
      'sms_ready', n.sms_ready, 'status', n.status, 'created_at', n.created_at,
      'line_id', l.id, 'assigned_user_id', l.dispatcher_user_id, 'assigned_to', d.full_name, 'assigned_status', d.status,
      'online', l.last_seen_at > now() - interval '3 minutes',
      'calls_total', (select count(*) from app_private.dialer_calls k join app_private.dialer_lines kl on kl.id = k.line_id where kl.phone_e164 = n.phone_e164),
      'last_holder', (select d2.full_name from app_private.dialer_lines l2 join app_private.dispatcher_profiles d2 on d2.user_id = l2.dispatcher_user_id
                        where l2.phone_e164 = n.phone_e164 and l2.status = 'released' order by l2.updated_at desc limit 1)) x
      from app_private.dialer_numbers n
      left join app_private.dialer_lines l on l.phone_e164 = n.phone_e164 and l.status = 'active'
      left join app_private.dispatcher_profiles d on d.user_id = l.dispatcher_user_id) q), '[]'::jsonb));
end $$;

-- add / edit a number in the pool (does NOT assign it)
create or replace function public.cc_dialer_number_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare e text := app_private.dial_e164(p->>'number'); v_id uuid := nullif(p->>'id','')::uuid; v_new boolean := false;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if e is null then return jsonb_build_object('error','enter a valid number with country code, e.g. +1 469 457 9556'); end if;
  if e not like '+1%' then return jsonb_build_object('error','dispatcher lines must be US numbers (+1)'); end if;
  if v_id is null then select id into v_id from app_private.dialer_numbers where phone_e164 = e; end if;
  if v_id is null then
    insert into app_private.dialer_numbers (phone_e164, label, telnyx_number_id, note, sms_ready, created_by)
    values (e, nullif(btrim(p->>'label'),''), nullif(btrim(p->>'telnyx_number_id'),''), nullif(btrim(p->>'note'),''), coalesce((p->>'sms_ready')::boolean, false), auth.uid())
    returning id into v_id; v_new := true;
  else
    if exists (select 1 from app_private.dialer_numbers where phone_e164 = e and id <> v_id) then return jsonb_build_object('error','that number is already in the pool'); end if;
    update app_private.dialer_numbers set phone_e164 = e,
      label = case when p ? 'label' then nullif(btrim(p->>'label'),'') else label end,
      telnyx_number_id = case when p ? 'telnyx_number_id' then nullif(btrim(p->>'telnyx_number_id'),'') else telnyx_number_id end,
      note = case when p ? 'note' then nullif(btrim(p->>'note'),'') else note end,
      sms_ready = coalesce((p->>'sms_ready')::boolean, sms_ready), status = 'active', updated_at = now() where id = v_id;
  end if;
  perform app_private.disp_audit('dialer.number_' || case when v_new then 'add' else 'edit' end, 'dialer_number', v_id::text, null, 'number ' || e, p - 'id');
  return jsonb_build_object('ok', true, 'id', v_id, 'number', e, 'new', v_new);
end $$;

-- remove from the pool — only a number nobody holds. History (calls, released lines) stays.
create or replace function public.cc_dialer_number_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare n app_private.dialer_numbers;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into n from app_private.dialer_numbers where id = p_id;
  if n.id is null then return jsonb_build_object('error','number not found'); end if;
  if exists (select 1 from app_private.dialer_lines where phone_e164 = n.phone_e164 and status = 'active') then
    return jsonb_build_object('error','release the line from its dispatcher first'); end if;
  delete from app_private.dialer_numbers where id = p_id;
  perform app_private.disp_audit('dialer.number_remove', 'dialer_number', p_id::text, null, 'number ' || n.phone_e164 || ' removed from pool', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.cc_dialer_numbers()','public.cc_dialer_number_add(jsonb)','public.cc_dialer_number_remove(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
