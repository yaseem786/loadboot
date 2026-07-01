-- cvt_partner_wizard_checklist.sql
-- Increment 44 — Partner Load Wizard + mandatory-document checklist. Extends the existing partner_loads flow
-- (my_partner_org('broker') → partner_loads → staff review → public.loads) with a richer submission that runs
-- validation + duplicate detection + eligibility, and generates a required-document checklist. Nothing rebuilt.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- ---- additive wizard fields on partner_loads ----
alter table app_private.partner_loads add column if not exists delivery_date date;
alter table app_private.partner_loads add column if not exists pickup_window text;
alter table app_private.partner_loads add column if not exists delivery_window text;
alter table app_private.partner_loads add column if not exists stops jsonb not null default '[]'::jsonb;
alter table app_private.partner_loads add column if not exists appointment_required boolean not null default false;
alter table app_private.partner_loads add column if not exists tracking_required boolean not null default false;
alter table app_private.partner_loads add column if not exists accessorials jsonb not null default '{}'::jsonb;
alter table app_private.partner_loads add column if not exists reference text;
alter table app_private.partner_loads add column if not exists submitted_at timestamptz;

-- ---- document checklist model (shared by partner_loads and loads) ----
create table if not exists app_private.load_document_checklist (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null,           -- partner_load | load
  subject_id   uuid not null,
  doc_key      text not null,
  label        text not null,
  required_from text not null,          -- broker | carrier
  status       text not null default 'required',  -- required|received|verified|rejected|expired|waived
  due_at       timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (subject_type, subject_id, doc_key)
);
create index if not exists ldc_subject_idx on app_private.load_document_checklist(subject_type, subject_id);

-- internal: seed a default checklist for a subject
create or replace function app_private.seed_load_checklist(p_type text, p_id uuid, p_docs jsonb)
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_n int:=0; v_x int; r record;
begin
  for r in select * from jsonb_to_recordset(p_docs) as x(doc_key text, label text, required_from text) loop
    insert into app_private.load_document_checklist(subject_type,subject_id,doc_key,label,required_from)
    values (p_type,p_id,r.doc_key,r.label,coalesce(r.required_from,'broker'))
    on conflict (subject_type,subject_id,doc_key) do nothing;
    get diagnostics v_x = row_count; v_n := v_n + v_x;
  end loop;
  return v_n;
end; $$;

-- ---- richer partner submission (wizard) ----
create or replace function public.cc_partner_submit_load(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_id uuid; v_dup boolean;
begin
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  -- eligibility: broker org must be active
  if not exists (select 1 from public.organizations o where o.id=v_org and o.status='active') then
    raise exception 'broker account is not active — complete onboarding before posting loads' using errcode='42501'; end if;
  if coalesce(trim(p->>'origin'),'')='' or coalesce(trim(p->>'destination'),'')='' then
    raise exception 'origin and destination are required' using errcode='22023'; end if;

  -- duplicate detection (same lane + pickup by same broker within 24h, not rejected)
  select exists (select 1 from app_private.partner_loads pl
    where pl.broker_org=v_org and lower(pl.origin)=lower(p->>'origin') and lower(pl.destination)=lower(p->>'destination')
      and pl.pickup_date is not distinct from nullif(p->>'pickup_date','')::date
      and coalesce(pl.status,'') <> 'rejected' and pl.created_at > now() - interval '24 hours') into v_dup;
  if v_dup and coalesce(p->>'confirm_duplicate','') <> 'true' then
    raise exception 'possible duplicate load in the last 24h — resubmit with confirm_duplicate=true to proceed' using errcode='23505'; end if;

  insert into app_private.partner_loads(broker_org,origin,destination,equipment,rate,miles,pickup_date,delivery_date,
      pickup_window,delivery_window,weight,commodity,notes,stops,appointment_required,tracking_required,accessorials,reference,status,submitted_at)
  values (v_org, trim(p->>'origin'), trim(p->>'destination'), p->>'equipment', nullif(p->>'rate','')::numeric, nullif(p->>'miles','')::numeric,
      nullif(p->>'pickup_date','')::date, nullif(p->>'delivery_date','')::date, p->>'pickup_window', p->>'delivery_window',
      nullif(p->>'weight','')::numeric, p->>'commodity', p->>'notes', coalesce(p->'stops','[]'::jsonb),
      coalesce((p->>'appointment_required')::boolean,false), coalesce((p->>'tracking_required')::boolean,false),
      coalesce(p->'accessorials','{}'::jsonb), p->>'reference', 'submitted', now())
  returning id into v_id;

  -- required-document checklist (broker-side)
  perform app_private.seed_load_checklist('partner_load', v_id, jsonb_build_array(
    jsonb_build_object('doc_key','rate_confirmation','label','Rate confirmation','required_from','broker'),
    jsonb_build_object('doc_key','pickup_number','label','Pickup number','required_from','broker'),
    jsonb_build_object('doc_key','delivery_number','label','Delivery number','required_from','broker'),
    jsonb_build_object('doc_key','appointment_confirmation','label','Appointment confirmation','required_from','broker'),
    jsonb_build_object('doc_key','billing_contact','label','Billing contact','required_from','broker')));

  perform app_private.emit_event('partner.load_submitted','partner_load', v_id::text,
    jsonb_build_object('org',v_org,'load',v_id,'duplicate_confirmed',v_dup));
  return jsonb_build_object('id', v_id, 'status', 'submitted', 'duplicate_flagged', v_dup);
end; $$;
revoke execute on function public.cc_partner_submit_load(jsonb) from anon, public;
grant  execute on function public.cc_partner_submit_load(jsonb) to authenticated;

-- ---- checklist read: staff (all) or the owning broker (their own partner_load) ----
create or replace function public.cc_load_checklist(p_subject_type text, p_subject_id uuid)
returns table(id uuid, doc_key text, label text, required_from text, status text, due_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  if not public.is_active_staff() then
    v_org := app_private.my_partner_org('broker');
    if v_org is null or p_subject_type <> 'partner_load'
       or not exists (select 1 from app_private.partner_loads pl where pl.id=p_subject_id and pl.broker_org=v_org)
      then raise exception 'not authorized' using errcode='42501'; end if;
  end if;
  return query select c.id,c.doc_key,c.label,c.required_from,c.status,c.due_at,c.updated_at
    from app_private.load_document_checklist c
    where c.subject_type=p_subject_type and c.subject_id=p_subject_id order by c.required_from, c.label;
end; $$;
revoke execute on function public.cc_load_checklist(text, uuid) from anon, public;
grant  execute on function public.cc_load_checklist(text, uuid) to authenticated;

-- ---- checklist update: staff only ----
create or replace function public.cc_load_checklist_set(p_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_status <> all (array['required','received','verified','rejected','expired','waived']) then raise exception 'invalid status' using errcode='22023'; end if;
  update app_private.load_document_checklist set status=p_status, updated_at=now() where id=p_id;
  if not found then raise exception 'checklist item not found' using errcode='22023'; end if;
  return true;
end; $$;
revoke execute on function public.cc_load_checklist_set(uuid, text) from anon, public;
grant  execute on function public.cc_load_checklist_set(uuid, text) to authenticated;
