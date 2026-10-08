-- bl_fill_0534 — "Suggest change" for locked carrier fields (8 Oct 2026)
--
-- The lock rule stays: a dispatcher never overwrites a value the carrier (or LoadBoot) set — dispatcher_carrier_fill
-- refuses with 'locked'. What was missing is the next step. Andrew's 28-min call with SPRINT SHIFT LOGISTICS (8 Oct)
-- found weekend_ok / haul_types / preferred_equipment all wrong on file and he could do nothing but type a note.
--
-- Now a locked field takes a SUGGESTION (new value + reason, e.g. 'Said on call 8 Oct: no weekends'):
--   app_private.carrier_field_suggestions   one row per suggestion; pending → accepted / rejected / superseded
--   public.dispatcher_field_suggest(...)    dispatcher → same assignment checks as dispatcher_carrier_fill
--   public.dispatcher_field_suggestions(a)  dispatcher's view (pending + recent decisions)
--   public.cc_pocket_field_suggestions()    carrier: what is waiting on them (Home card + the field itself)
--   public.cc_pocket_field_suggestion_decide(id, accept)   carrier accepts ("write through the normal path") or keeps theirs
--   public.cc_field_suggestions(org) / public.cc_field_suggestion_decide(id, accept, note)   staff, Carrier 360
--   app_private.cfs_write(...)              the typed write dispatcher_carrier_fill does, factored out so an accepted
--                                           suggestion goes through exactly the same path → cfs_track stamps it, and
--                                           the explicit cfs_stamp after it carries note = 'accepted suggestion #id'.
-- source = 'dispatcher' (typed by hand) or 'call_ai' (bl_fill_0535: extracted from a dialer call; source_call_id set).
-- RLS on, no policies: the table is reachable only through these SECURITY DEFINER RPCs (authenticated, never anon).
-- Additive + reversible: drop the 7 functions and the table; nothing else is touched.

begin;

create table if not exists app_private.carrier_field_suggestions (
  id              bigserial primary key,
  carrier_org_id  uuid not null references public.organizations(id) on delete cascade,
  tbl             text not null check (tbl in ('profile','prefs','truck')),
  field           text not null,
  truck_id        uuid references app_private.fleet_trucks(id) on delete cascade,
  old_value       jsonb,
  new_value       jsonb not null,
  reason          text,
  source          text not null check (source in ('dispatcher','call_ai')),
  source_call_id  uuid,
  quote           text,
  suggested_by    uuid,
  status          text not null default 'pending' check (status in ('pending','accepted','rejected','superseded')),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create index if not exists cfsg_org_status_idx on app_private.carrier_field_suggestions (carrier_org_id, status, created_at desc);
create index if not exists cfsg_call_idx       on app_private.carrier_field_suggestions (source_call_id) where source_call_id is not null;
alter table app_private.carrier_field_suggestions enable row level security;
revoke all on table app_private.carrier_field_suggestions from public, anon, authenticated;

-- ── the typed write (what dispatcher_carrier_fill did inline) ──────────────────────────────────────────────────────
create or replace function app_private.cfs_write(p_org uuid, p_tbl text, p_field text, p_truck uuid, p_value jsonb,
                                                 p_uid uuid, p_role text, p_note text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare f app_private.carrier_fill_fields; v_owner uuid; v_schema text; v_table text; v_where text;
        v_udt text; v_set text; v_val jsonb := p_value;
begin
  select * into f from app_private.carrier_fill_fields where tbl = p_tbl and field = p_field;
  if f.field is null then return jsonb_build_object('error', 'not a fillable field'); end if;
  if p_tbl = 'profile' then
    select owner_user_id into v_owner from public.organizations where id = p_org;
    if v_owner is null then return jsonb_build_object('error', 'carrier has no owner profile'); end if;
    v_schema := 'public'; v_table := 'profiles'; v_where := format('id = %L', v_owner);
  elsif p_tbl = 'prefs' then
    insert into app_private.carrier_dispatch_prefs (carrier_id) values (p_org) on conflict (carrier_id) do nothing;
    v_schema := 'app_private'; v_table := 'carrier_dispatch_prefs'; v_where := format('carrier_id = %L', p_org);
  else
    if p_truck is null then return jsonb_build_object('error', 'truck required'); end if;
    if not exists (select 1 from app_private.fleet_trucks where id = p_truck and carrier_id = p_org) then
      return jsonb_build_object('error', 'not this carrier''s truck');
    end if;
    v_schema := 'app_private'; v_table := 'fleet_trucks'; v_where := format('id = %L', p_truck);
  end if;
  -- normalise + type the value from the column's real type (same rules as dispatcher_carrier_fill)
  if f.kind = 'list' and v_val is not null and jsonb_typeof(v_val) = 'string' then
    v_val := to_jsonb(array(select btrim(x) from unnest(string_to_array(v_val #>> '{}', ',')) x where btrim(x) <> ''));
  end if;
  if f.kind = 'bool' and v_val is not null and jsonb_typeof(v_val) = 'string' then
    v_val := case when lower(btrim(v_val #>> '{}')) in ('true','yes','y','1') then 'true'::jsonb
                  when lower(btrim(v_val #>> '{}')) in ('false','no','n','0') then 'false'::jsonb else null end;
  end if;
  if app_private.cfs_is_empty(v_val) then v_val := null; end if;
  select udt_name into v_udt from information_schema.columns where table_schema = v_schema and table_name = v_table and column_name = p_field;
  if v_udt is null then return jsonb_build_object('error', 'column missing'); end if;
  if v_val is null then v_set := 'null';
  elsif v_udt like '\_%' then v_set := format('(select coalesce(array_agg(x::%s), ''{}'')::%s[] from jsonb_array_elements_text($1) x)', substr(v_udt, 2), substr(v_udt, 2));
  elsif v_udt in ('jsonb','json') then v_set := '$1';
  else v_set := format('nullif($1 #>> ''{}'', '''')::%s', v_udt);
  end if;
  begin
    execute format('update %I.%I set %I = %s where %s', v_schema, v_table, p_field, v_set, v_where) using v_val;
  exception when others then
    return jsonb_build_object('error', 'bad value', 'message', 'That value does not fit "' || f.label || '": ' || sqlerrm);
  end;
  perform app_private.cfs_stamp(p_org, p_tbl, p_field, case when p_tbl = 'truck' then p_truck end, v_val, p_uid, p_role, p_note);
  return jsonb_build_object('ok', true, 'value', v_val);
end $$;
revoke execute on function app_private.cfs_write(uuid, text, text, uuid, jsonb, uuid, text, text) from public, anon, authenticated;

-- current value of a field (jsonb) — null when there is none
create or replace function app_private.cfs_current(p_org uuid, p_tbl text, p_field text, p_truck uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v jsonb; v_owner uuid;
begin
  if p_tbl = 'profile' then
    select owner_user_id into v_owner from public.organizations where id = p_org;
    select to_jsonb(p) -> p_field into v from public.profiles p where p.id = v_owner;
  elsif p_tbl = 'prefs' then
    select to_jsonb(p) -> p_field into v from app_private.carrier_dispatch_prefs p where p.carrier_id = p_org;
  else
    select to_jsonb(t) -> p_field into v from app_private.fleet_trucks t where t.id = p_truck and t.carrier_id = p_org;
  end if;
  return v;
end $$;
revoke execute on function app_private.cfs_current(uuid, text, text, uuid) from public, anon, authenticated;

-- one suggestion row as the UIs see it
create or replace function app_private.cfs_suggestion_json(s app_private.carrier_field_suggestions)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'id', s.id, 'carrier_org_id', s.carrier_org_id, 'tbl', s.tbl, 'field', s.field, 'truck_id', s.truck_id,
    'unit_no', (select unit_no from app_private.fleet_trucks where id = s.truck_id),
    'label', (select label from app_private.carrier_fill_fields where tbl = s.tbl and field = s.field),
    'kind',  (select kind  from app_private.carrier_fill_fields where tbl = s.tbl and field = s.field),
    'old_value', s.old_value, 'new_value', s.new_value,
    'old_text', coalesce(nullif(app_private.cfs_value_text(s.old_value), ''), '—'),
    'new_text', coalesce(nullif(app_private.cfs_value_text(s.new_value), ''), '—'),
    'reason', s.reason, 'quote', s.quote, 'source', s.source, 'source_call_id', s.source_call_id,
    'suggested_by', s.suggested_by, 'suggested_by_name', app_private.cfs_name_of(s.suggested_by),
    'status', s.status, 'decided_by', s.decided_by, 'decided_by_name', app_private.cfs_name_of(s.decided_by),
    'decided_at', s.decided_at, 'decision_note', s.decision_note, 'created_at', s.created_at);
$$;
revoke execute on function app_private.cfs_suggestion_json(app_private.carrier_field_suggestions) from public, anon, authenticated;

-- insert (validates, normalises, supersedes an older pending one for the same field, tells the carrier)
create or replace function app_private.cfs_suggest(p_org uuid, p_tbl text, p_field text, p_truck uuid, p_value jsonb,
                                                   p_reason text, p_source text, p_call uuid, p_quote text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare f app_private.carrier_fill_fields; v_val jsonb := p_value; v_old jsonb; s app_private.carrier_field_suggestions;
        v_owner uuid; v_unit text;
begin
  select * into f from app_private.carrier_fill_fields where tbl = p_tbl and field = p_field;
  if f.field is null then return jsonb_build_object('error', 'this field cannot be suggested'); end if;
  if p_tbl = 'truck' then
    if p_truck is null then return jsonb_build_object('error', 'truck required'); end if;
    select unit_no into v_unit from app_private.fleet_trucks where id = p_truck and carrier_id = p_org;
    if not found then return jsonb_build_object('error', 'not this carrier''s truck'); end if;
  else
    p_truck := null;
  end if;
  if f.kind = 'list' and v_val is not null and jsonb_typeof(v_val) = 'string' then
    v_val := to_jsonb(array(select btrim(x) from unnest(string_to_array(v_val #>> '{}', ',')) x where btrim(x) <> ''));
  end if;
  if f.kind = 'bool' and v_val is not null and jsonb_typeof(v_val) = 'string' then
    v_val := case when lower(btrim(v_val #>> '{}')) in ('true','yes','y','1') then 'true'::jsonb
                  when lower(btrim(v_val #>> '{}')) in ('false','no','n','0') then 'false'::jsonb else null end;
  end if;
  if app_private.cfs_is_empty(v_val) then return jsonb_build_object('error', 'type the suggested value first'); end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then return jsonb_build_object('error', 'say why (e.g. "Said on call 8 Oct: no weekends")'); end if;
  v_old := app_private.cfs_current(p_org, p_tbl, p_field, p_truck);
  if v_old is not distinct from v_val then return jsonb_build_object('error', 'that is already the value on file'); end if;

  update app_private.carrier_field_suggestions set status = 'superseded', decided_at = now(), decision_note = 'replaced by a newer suggestion'
   where carrier_org_id = p_org and tbl = p_tbl and field = p_field and status = 'pending'
     and coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_truck, '00000000-0000-0000-0000-000000000000'::uuid);

  insert into app_private.carrier_field_suggestions (carrier_org_id, tbl, field, truck_id, old_value, new_value, reason, source, source_call_id, quote, suggested_by)
  values (p_org, p_tbl, p_field, p_truck, v_old, v_val, left(btrim(p_reason), 600), p_source, p_call, left(p_quote, 600), p_by)
  returning * into s;

  -- tell the carrier (in-app only; no e-mail — nothing leaves the system)
  select owner_user_id into v_owner from public.organizations where id = p_org;
  if v_owner is not null then
    perform app_private.notify_user(v_owner, 'dispatch.field_suggestion',
      'Your dispatcher suggests a change: ' || f.label || case when v_unit is not null then ' (unit ' || v_unit || ')' else '' end,
      coalesce(nullif(app_private.cfs_value_text(v_old), ''), '—') || ' → ' || app_private.cfs_value_text(v_val) || ' — ' || left(btrim(p_reason), 160)
        || '. Accept it or keep yours on your Home screen.',
      '#dashboard', 'action', 'dispatch.field_suggestion:' || s.id::text);
  end if;
  perform app_private.disp_audit('dispatcher.field_suggest', 'carrier', p_org::text, p_org,
    f.label || case when v_unit is not null then ' (unit ' || v_unit || ')' else '' end || ': ' || coalesce(nullif(app_private.cfs_value_text(v_old), ''), '—') || ' → ' || app_private.cfs_value_text(v_val) || ' — suggested (' || p_source || ')',
    jsonb_build_object('suggestion_id', s.id, 'tbl', p_tbl, 'field', p_field, 'truck_id', p_truck, 'reason', p_reason, 'call_id', p_call));
  return jsonb_build_object('ok', true, 'suggestion', app_private.cfs_suggestion_json(s));
end $$;
revoke execute on function app_private.cfs_suggest(uuid, text, text, uuid, jsonb, text, text, uuid, text, uuid) from public, anon, authenticated;

-- decide (carrier or staff). Accept = the normal write path, stamped with the decider's role + the note.
create or replace function app_private.cfs_suggestion_decide(p_id bigint, p_accept boolean, p_uid uuid, p_role text, p_note text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare s app_private.carrier_field_suggestions; w jsonb; f app_private.carrier_fill_fields;
begin
  select * into s from app_private.carrier_field_suggestions where id = p_id for update;
  if s.id is null then return jsonb_build_object('error', 'not found'); end if;
  if s.status <> 'pending' then return jsonb_build_object('error', 'already ' || s.status); end if;
  select * into f from app_private.carrier_fill_fields where tbl = s.tbl and field = s.field;
  if p_accept then
    w := app_private.cfs_write(s.carrier_org_id, s.tbl, s.field, s.truck_id, s.new_value, p_uid, p_role, 'accepted suggestion #' || s.id::text);
    if w ? 'error' then return w; end if;
  end if;
  update app_private.carrier_field_suggestions
     set status = case when p_accept then 'accepted' else 'rejected' end, decided_by = p_uid, decided_at = now(), decision_note = left(p_note, 400)
   where id = s.id returning * into s;
  perform app_private.disp_audit('dispatcher.field_suggestion.' || s.status, 'carrier', s.carrier_org_id::text, s.carrier_org_id,
    coalesce(f.label, s.field) || ': ' || coalesce(nullif(app_private.cfs_value_text(s.old_value), ''), '—') || ' → ' || app_private.cfs_value_text(s.new_value) || ' — ' || s.status || ' by ' || p_role,
    jsonb_build_object('suggestion_id', s.id, 'tbl', s.tbl, 'field', s.field, 'truck_id', s.truck_id, 'note', p_note));
  if s.suggested_by is not null and s.suggested_by <> p_uid then
    perform app_private.notify_user(s.suggested_by, 'dispatch.field_suggestion.decided',
      (case when p_role = 'carrier' then 'The carrier ' else 'LoadBoot ' end) || (case when p_accept then 'accepted' else 'kept their own value for' end) || ' ' || coalesce(f.label, s.field),
      coalesce(nullif(app_private.cfs_value_text(s.old_value), ''), '—') || ' → ' || app_private.cfs_value_text(s.new_value) || coalesce(' — ' || nullif(p_note, ''), ''),
      null, case when p_accept then 'success' else 'info' end, 'dispatch.field_suggestion.decided:' || s.id::text);
  end if;
  return jsonb_build_object('ok', true, 'suggestion', app_private.cfs_suggestion_json(s));
end $$;
revoke execute on function app_private.cfs_suggestion_decide(bigint, boolean, uuid, text, text) from public, anon, authenticated;

-- ── dispatcher RPCs (same assignment checks as dispatcher_carrier_fill) ────────────────────────────────────────────
create or replace function public.dispatcher_field_suggest(p_assignment uuid, p_tbl text, p_field text, p_value jsonb, p_reason text, p_truck uuid default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); a app_private.dispatcher_assignments;
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null or a.dispatcher_user_id <> v_uid or a.status <> 'active' or not app_private.disp_is_assigned(a.carrier_org_id) then
    return jsonb_build_object('error', 'not your active assignment');
  end if;
  return app_private.cfs_suggest(a.carrier_org_id, p_tbl, p_field, p_truck, p_value, p_reason, 'dispatcher', null, null, v_uid);
end $$;

create or replace function public.dispatcher_field_suggestions(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); a app_private.dispatcher_assignments;
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null or a.dispatcher_user_id <> v_uid or a.status <> 'active' or not app_private.disp_is_assigned(a.carrier_org_id) then
    return jsonb_build_object('error', 'not your active assignment');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(app_private.cfs_suggestion_json(s) order by s.created_at desc)
    from app_private.carrier_field_suggestions s
    where s.carrier_org_id = a.carrier_org_id and (s.status = 'pending' or s.created_at > now() - interval '30 days')), '[]'::jsonb));
end $$;

-- ── carrier RPCs ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.cc_pocket_field_suggestions()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid := app_private.my_carrier_org();
begin
  if v_org is null then raise exception 'not a carrier account' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(app_private.cfs_suggestion_json(s) order by s.created_at desc)
    from app_private.carrier_field_suggestions s where s.carrier_org_id = v_org and s.status = 'pending'), '[]'::jsonb));
end $$;

create or replace function public.cc_pocket_field_suggestion_decide(p_id bigint, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid := app_private.my_carrier_org(); s app_private.carrier_field_suggestions;
begin
  if v_org is null then raise exception 'not a carrier account' using errcode = '42501'; end if;
  select * into s from app_private.carrier_field_suggestions where id = p_id;
  if s.id is null or s.carrier_org_id <> v_org then return jsonb_build_object('error', 'not found'); end if;
  return app_private.cfs_suggestion_decide(p_id, p_accept, auth.uid(), 'carrier', case when p_accept then 'accepted by the carrier' else 'carrier kept their own value' end);
end $$;

-- ── staff RPCs (CC → Carrier 360 / dispatcher 360) ─────────────────────────────────────────────────────────────────
create or replace function public.cc_field_suggestions(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'staff only'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(app_private.cfs_suggestion_json(s) order by (s.status = 'pending') desc, s.created_at desc)
    from app_private.carrier_field_suggestions s where s.carrier_org_id = p_org and (s.status = 'pending' or s.created_at > now() - interval '90 days')), '[]'::jsonb));
end $$;

create or replace function public.cc_field_suggestion_decide(p_id bigint, p_accept boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'staff only'); end if;
  return app_private.cfs_suggestion_decide(p_id, p_accept, auth.uid(), 'staff', coalesce(nullif(p_note, ''), case when p_accept then 'accepted by LoadBoot' else 'rejected by LoadBoot' end));
end $$;

-- grants: authenticated only. Every new public function gets anon=X from the default ACL — revoke it explicitly (CLAUDE.md §4)
revoke execute on function public.dispatcher_field_suggest(uuid, text, text, jsonb, text, uuid) from public, anon;
revoke execute on function public.dispatcher_field_suggestions(uuid) from public, anon;
revoke execute on function public.cc_pocket_field_suggestions() from public, anon;
revoke execute on function public.cc_pocket_field_suggestion_decide(bigint, boolean) from public, anon;
revoke execute on function public.cc_field_suggestions(uuid) from public, anon;
revoke execute on function public.cc_field_suggestion_decide(bigint, boolean, text) from public, anon;
grant execute on function public.dispatcher_field_suggest(uuid, text, text, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.dispatcher_field_suggestions(uuid) to authenticated, service_role;
grant execute on function public.cc_pocket_field_suggestions() to authenticated, service_role;
grant execute on function public.cc_pocket_field_suggestion_decide(bigint, boolean) to authenticated, service_role;
grant execute on function public.cc_field_suggestions(uuid) to authenticated, service_role;
grant execute on function public.cc_field_suggestion_decide(bigint, boolean, text) to authenticated, service_role;

do $$
declare n int; bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('dispatcher_field_suggest','dispatcher_field_suggestions','cc_pocket_field_suggestions',
         'cc_pocket_field_suggestion_decide','cc_field_suggestions','cc_field_suggestion_decide')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'bl_fill_0534: anon can execute %', bad; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_fill_0534: anon SECURITY DEFINER surface in public = % (expect 36 prod / 35 staging)', n;
end $$;

commit;
