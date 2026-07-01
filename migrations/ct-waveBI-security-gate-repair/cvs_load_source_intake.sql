-- cvs_load_source_intake.sql
-- Increment 43 — Load-source normalization + Load Intake. Extends public.loads (additively) with normalized
-- source attribution + verification/confidence provenance, and adds staff RPCs for a Command Center Load Intake
-- workspace. Reuses the existing loads/organizations/trips model — nothing is rebuilt. Existing cc_create_load
-- keeps working; this adds a richer, source-attributed creation path.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- ---- additive columns (normalized source model) ----
alter table public.loads add column if not exists source_type text;
alter table public.loads add column if not exists source_provider text;
alter table public.loads add column if not exists source_reference text;
alter table public.loads add column if not exists verification_state text not null default 'unverified';
alter table public.loads add column if not exists confidence text not null default 'medium';
alter table public.loads add column if not exists source_updated_at timestamptz;
alter table public.loads add column if not exists created_by uuid;
alter table public.loads add column if not exists broker_org uuid;
alter table public.loads add column if not exists shipper_org uuid;
alter table public.loads add column if not exists version integer not null default 1;
alter table public.loads add column if not exists field_meta jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='loads_source_type_check') then
    alter table public.loads add constraint loads_source_type_check check (source_type is null or source_type = any (array[
      'partner_portal','staff_entered','licensed_integration','official_api','uploaded_document',
      'imported','unverified_external','quote_converted','recurring_lane','duplicated','api_client']));
  end if;
  if not exists (select 1 from pg_constraint where conname='loads_verification_check') then
    alter table public.loads add constraint loads_verification_check check (verification_state = any (array['unverified','partial','verified']));
  end if;
  if not exists (select 1 from pg_constraint where conname='loads_confidence_check') then
    alter table public.loads add constraint loads_confidence_check check (confidence = any (array['low','medium','high']));
  end if;
end $$;
create index if not exists loads_source_type_idx on public.loads(source_type);
create index if not exists loads_status_created_idx on public.loads(status, created_at desc);

-- ---- source-attributed load creation (staff) ----
create or replace function public.cc_create_load_sourced(p jsonb)
returns uuid language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_id uuid; v_src text; v_ver text; v_conf text;
begin
  if not public.has_global_permission('loads.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(p->>'origin','')='' or coalesce(p->>'destination','')='' then raise exception 'origin and destination are required' using errcode='22023'; end if;
  v_src := p->>'source_type';
  if v_src is null then raise exception 'source_type is required (staff must attribute the load source)' using errcode='22023'; end if;
  if v_src <> all (array['partner_portal','staff_entered','licensed_integration','official_api','uploaded_document','imported','unverified_external','quote_converted','recurring_lane','duplicated','api_client'])
    then raise exception 'invalid source_type' using errcode='22023'; end if;
  v_ver  := coalesce(p->>'verification_state','unverified');
  v_conf := coalesce(p->>'confidence','medium');
  insert into public.loads(origin,destination,equipment,rate,miles,commodity,weight,pickup_date,delivery_date,broker,notes,requirements,status,
      source_type,source_provider,source_reference,verification_state,confidence,source_updated_at,created_by,broker_org,shipper_org,field_meta)
  values (p->>'origin', p->>'destination', p->>'equipment', nullif(p->>'rate','')::numeric, nullif(p->>'miles','')::int,
      p->>'commodity', p->>'weight', nullif(p->>'pickup_date','')::date, nullif(p->>'delivery_date','')::date, p->>'broker', p->>'notes', p->>'requirements',
      'available', v_src, p->>'source_provider', p->>'source_reference', v_ver, v_conf, now(), auth.uid(),
      nullif(p->>'broker_org','')::uuid, nullif(p->>'shipper_org','')::uuid, coalesce(p->'field_meta','{}'::jsonb))
  returning id into v_id;
  perform app_private.emit_event('load.created','load',v_id::text, jsonb_build_object('source',v_src,'origin',p->>'origin','destination',p->>'destination'));
  perform app_private.log_audit('load.create.sourced','load',v_id::text,null,format('load created from %s: %s -> %s', v_src, p->>'origin', p->>'destination'),
    jsonb_build_object('source_type',v_src,'verification',v_ver,'confidence',v_conf));
  return v_id;
end; $$;
revoke execute on function public.cc_create_load_sourced(jsonb) from anon, public;
grant  execute on function public.cc_create_load_sourced(jsonb) to authenticated;

-- ---- Load Intake list (staff) ----
create or replace function public.cc_load_intake_list(p_source text default null, p_verification text default null, p_status text default null, p_limit integer default 200)
returns table(id uuid, origin text, destination text, equipment text, rate numeric, miles integer, status text,
  source_type text, source_provider text, verification_state text, confidence text, pickup_date date,
  source_updated_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select l.id,l.origin,l.destination,l.equipment,l.rate,l.miles,l.status,
      l.source_type,l.source_provider,l.verification_state,l.confidence,l.pickup_date,l.source_updated_at,l.created_at
    from public.loads l
    where (p_source is null or l.source_type=p_source)
      and (p_verification is null or l.verification_state=p_verification)
      and (p_status is null or l.status=p_status)
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit,200),1),500);
end; $$;
revoke execute on function public.cc_load_intake_list(text, text, text, integer) from anon, public;
grant  execute on function public.cc_load_intake_list(text, text, text, integer) to authenticated;

-- ---- set verification / confidence on a load (staff; audited) ----
create or replace function public.cc_load_set_verification(p_load uuid, p_verification text, p_confidence text default null)
returns boolean language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('loads.create') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_verification <> all (array['unverified','partial','verified']) then raise exception 'invalid verification_state' using errcode='22023'; end if;
  update public.loads set verification_state=p_verification,
    confidence=coalesce(p_confidence, confidence), source_updated_at=now(), version=version+1
    where id=p_load;
  if not found then raise exception 'load not found' using errcode='22023'; end if;
  perform app_private.log_audit('load.verify','load',p_load::text,null,'verification set to '||p_verification,jsonb_build_object('confidence',p_confidence));
  return true;
end; $$;
revoke execute on function public.cc_load_set_verification(uuid, text, text) from anon, public;
grant  execute on function public.cc_load_set_verification(uuid, text, text) to authenticated;
