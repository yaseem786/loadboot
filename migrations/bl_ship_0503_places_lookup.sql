-- bl_ship_0503 — Google Places phone suggestion for the independent call-back (29 Sep 2026, owner: "ye agar ban sakta zyada behtar hai").
-- Staff click "Find phone on Google" on Shipper 360; the edge function `places-lookup` asks Google Places (Text Search, the
-- Enterprise SKU, because the phone field is Enterprise: 1,000 free a month, then $35 per 1,000) for the REGISTRY name +
-- address (or the shipper's answers when no registry record is saved yet, marked as weaker). Staff still choose the number.
--   * the Google key lives only in the edge function secret GOOGLE_PLACES_KEY — never in the browser, never in the DB;
--   * cc_places_lookup_start refuses non-staff, a monthly cap (shipper_config.places_monthly_cap, default 500 — half the
--     free 1,000, so it cannot bill) and more than 3 lookups per shipper per day; it logs who looked up what;
--   * only Google's place ids are stored (Maps Platform terms allow caching place ids; phone/name/address are shown, not kept).
--     The number staff actually call is recorded by cc_shipper_callback_start as before (source "google_business").
-- Anon surface: unchanged (both functions revoked from public, anon; the file raises if a name changes).

drop table if exists pg_temp._bl0503_anon;
create temp table _bl0503_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

alter table app_private.shipper_config add column if not exists places_monthly_cap int not null default 500;

create table if not exists app_private.places_lookups (
  id         bigserial primary key,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  looked_by  uuid,
  looked_at  timestamptz not null default now(),
  basis      text not null check (basis in ('registry','shipper_answers')),
  query      text not null,
  place_ids  text[],
  ok         boolean,
  error      text
);
create index if not exists places_lookups_month_idx on app_private.places_lookups(looked_at);
create index if not exists places_lookups_org_idx on app_private.places_lookups(org_id, looked_at);
alter table app_private.places_lookups enable row level security;

create or replace function public.cc_places_lookup_start(p_org uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare reg jsonb; le jsonb; pa jsonb; v_q text; v_basis text; v_cap int; v_used int; v_id bigint;
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'shipper') then raise exception 'not a shipper' using errcode = '22023'; end if;
  select coalesce(places_monthly_cap, 500) into v_cap from app_private.shipper_config where id;
  select count(*) into v_used from app_private.places_lookups where looked_at >= date_trunc('month', now());
  if v_used >= v_cap then
    raise exception 'Google lookups this month: % of %. The cap keeps us inside Google''s free tier — find the number by hand.', v_used, v_cap using errcode = '22023'; end if;
  if (select count(*) from app_private.places_lookups where org_id = p_org and looked_at > now() - interval '1 day') >= 3 then
    raise exception 'Already looked up 3 times for this shipper today' using errcode = '22023'; end if;
  select data into reg from app_private.org_onboarding_items where org_id = p_org and item_key = 'registry_check';
  select data into le from app_private.org_onboarding_items where org_id = p_org and item_key = 'legal_entity';
  select data into pa from app_private.org_onboarding_items where org_id = p_org and item_key = 'physical_address';
  if coalesce(reg->>'legal_name','') <> '' and coalesce(reg->>'principal_address','') <> '' then
    v_q := (reg->>'legal_name') || ', ' || (reg->>'principal_address'); v_basis := 'registry';
  elsif coalesce(le->>'legal_name','') <> '' and coalesce(pa->>'street','') <> '' then
    v_q := concat_ws(', ', le->>'legal_name', pa->>'street', pa->>'city', pa->>'state', pa->>'zip'); v_basis := 'shipper_answers';
  else
    raise exception 'Nothing to search yet: save the registry record, or wait for the shipper''s legal entity and address' using errcode = '22023';
  end if;
  insert into app_private.places_lookups(org_id, looked_by, basis, query) values (p_org, auth.uid(), v_basis, left(v_q, 300)) returning id into v_id;
  return jsonb_build_object('id', v_id, 'query', left(v_q, 300), 'basis', v_basis, 'used', v_used + 1, 'cap', v_cap);
end $$;

create or replace function public.cc_places_lookup_done(p_id bigint, p_place_ids text[], p_ok boolean, p_error text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  update app_private.places_lookups set place_ids = p_place_ids[1:5], ok = coalesce(p_ok, false), error = left(p_error, 300)
   where id = p_id and looked_by = auth.uid() and ok is null;
  if not found then raise exception 'lookup not found' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.cc_places_lookup_start(uuid)', 'public.cc_places_lookup_done(bigint,text[],boolean,text)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

do $$ declare v_added text; v_gone text; begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from _bl0503_anon) a;
  select string_agg(n, ', ') into v_gone from (select n from _bl0503_anon except
    select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0503: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
drop table pg_temp._bl0503_anon;
