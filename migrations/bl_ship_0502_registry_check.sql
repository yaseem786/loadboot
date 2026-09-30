-- bl_ship_0502 — Shipper registry check (29 Sep 2026, owner: "hai ye bhi banana"). Plan: claude/REGISTRY-CHECK-PLAN.md.
-- Why: MII Brand Import passed the email and website checks because it controls its own 4-day-old domain. An EIN letter or
-- an address proof proves nothing until staff compare it with a record THEY pulled from the state registry.
--   1. New staff item `registry_check` (identity section, both lanes). Staff fill in what the Secretary of State record says;
--      the server compares it with the shipper's answers (name, entity number, state, address, signer, age, SEC name).
--      Verify is refused while a hard check fails. If the shipper later edits a compared answer, the check drops to pending.
--   2. `ein_letter` / `address_proof` can only be verified after the registry check, through cc_shipper_doc_verify, where
--      staff tick "name and address on this document match the registry record". The tick is stored with the item.
--   3. SEC-name rule: when the company name matches an SEC company, a confirmed email does not count until staff approve
--      that email's domain (cc_shipper_email_domain_approve). A domain younger than domain_min_age_days cannot be approved.
--   4. app_private.sos_registries: per-state Secretary of State search link and, where the state publishes free open data,
--      the Socrata dataset the CC card reads to pre-fill the record (staff still check and save it).
--   5. cc_onboarding_submit_item: a shipper can submit only UPLOAD items (it could submit any template key before,
--      including staff items; the status only ever became 'submitted', so no gate opened, but it could reset them).
-- Anon surface: unchanged. Every new public function is revoked from public, anon; the file raises if a name changes.

drop table if exists pg_temp._bl0502_anon;
create temp table _bl0502_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

create or replace function app_private._bl0502_patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0502 patch: anchor found % times in % — refusing', n, p_fn; end if;
  execute replace(d, p_old, p_new);
end $$;

-- ───────────────────────────── 1. state registry sources ─────────────────────────────
create table if not exists app_private.sos_registries (
  state        char(2) primary key,
  name         text not null,                -- who keeps the record
  search_url   text not null,                -- the public search page (opened by staff)
  deep_link    text,                         -- record page pattern with {number}, only where it was confirmed to answer
  od_domain    text,                         -- Socrata domain with a free business-entity dataset (no key, CORS open)
  od_dataset   text,                         -- dataset id; the CC card (registry-prefill.js) knows each state's columns
  od_active_only boolean,                    -- the dataset lists active entities only: found = active, missing ≠ inactive
  notes        text,
  checked_at   date not null default current_date
);
alter table app_private.sos_registries enable row level security;

-- Checked 29 Sep 2026 from this session: every search_url answered 200, except NY and PA, whose search pages refuse
-- automated requests (open them by hand). Datasets: each one was queried (columns read from /api/views/<id>.json).
insert into app_private.sos_registries(state, name, search_url, deep_link, od_domain, od_dataset, od_active_only, notes) values
 ('NY','New York Department of State — Division of Corporations','https://apps.dos.ny.gov/publicInquiry/',null,'data.ny.gov','n9v6-gdp6',true,
  'Open data: "Active Corporations: Beginning 1800" (dos_id). Active entities only. Has chairman, registered agent and service-of-process address; no LLC members.'),
 ('CO','Colorado Secretary of State — Business','https://www.coloradosos.gov/biz/BusinessEntityCriteriaExt.do',
  'https://www.coloradosos.gov/biz/BusinessEntityDetail.do?masterFileId={number}','data.colorado.gov','4ykn-tg5h',false,
  'Open data: "Business Entities in Colorado" (entityid). All statuses, principal address, registered agent, formation date. No officers.'),
 ('CT','Connecticut Secretary of the State — Business Registry','https://service.ct.gov/business/s/onlinebusinesssearch',null,'data.ct.gov','n7gp-d28j',false,
  'Open data: Business Master (accountnumber) + Principals (ka36-64k6, by business_id). All statuses.'),
 ('OR','Oregon Secretary of State — Corporation Division','https://egov.sos.state.or.us/br/pkg_web_name_srch_inq.login',
  'http://egov.sos.state.or.us/br/pkg_web_name_srch_inq.do_name_srch?p_name=&p_regist_nbr={number}&p_srch=PHASE1&p_print=FALSE&p_entity_status=ACTINA','data.oregon.gov','tckn-sxa6',true,
  'Open data: "Active Businesses - ALL" (registry_number), one row per associated name (principal place, agent, members). Active only.'),
 ('PA','Pennsylvania Department of State — Business Filing','https://file.dos.pa.gov/search/business',null,'data.pa.gov','xvd7-5r2c',true,
  'Open data: "Registered Businesses in PA Current" (filing_number, 10 digits), one row per officer (party_type + name). Current entities only.'),
 ('DE','Delaware Division of Corporations','https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx',null,null,null,null,
  'No free data. The free search shows name, file number, formation date and registered agent only; status and officers are paid. Ask the shipper for a Certificate of Good Standing.'),
 ('CA','California Secretary of State — bizfile Online','https://bizfileonline.sos.ca.gov/search/business',null,null,null,null,null),
 ('TX','Texas Comptroller — Taxable Entity Search','https://mycpa.cpa.state.tx.us/coa/',null,null,null,null,
  'Free: status, SOS file number, registered agent and officers/managers from the franchise tax Public Information Report.'),
 ('MA','Massachusetts Secretary of the Commonwealth — Corporations','https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx',null,null,null,null,null),
 ('VA','Virginia State Corporation Commission — Clerk''s Information System','https://cis.scc.virginia.gov/EntitySearch/Index',null,null,null,null,null),
 ('NV','Nevada Secretary of State — SilverFlume','https://esos.nv.gov/EntitySearch/OnlineEntitySearch',null,null,null,null,null),
 ('WY','Wyoming Secretary of State — Business','https://wyobiz.wyo.gov/Business/FilingSearch.aspx',null,null,null,null,null),
 ('WA','Washington Secretary of State — Corporations (CCFS)','https://ccfs.sos.wa.gov/',null,null,null,null,null),
 ('NJ','New Jersey Division of Revenue — Business Name Search','https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName',null,null,null,null,null)
on conflict (state) do update set name = excluded.name, search_url = excluded.search_url, deep_link = excluded.deep_link,
  od_domain = excluded.od_domain, od_dataset = excluded.od_dataset, od_active_only = excluded.od_active_only, notes = excluded.notes,
  checked_at = excluded.checked_at;
-- any other state: the CC card links the NASS directory of every state's business registry
-- (https://www.nass.org/business-services/corporate-registration, checked 29 Sep 2026).

-- ───────────────────────────── 2. template + trust columns ─────────────────────────────
insert into app_private.onboarding_packet_templates
  (org_kind, item_key, label, status_tag, sort, revalidate_days, needs_expiry, section, purpose, required_for, item_type, auto_verify, condition)
values ('shipper','registry_check','State registry check','required',115,365,false,'identity',
  'Our team pulls your company''s record from your state''s Secretary of State registry and compares it with your answers. Nothing for you to upload.',
  '{direct,broker}','staff',false,null)
on conflict (org_kind, item_key) do update set
  label = excluded.label, status_tag = excluded.status_tag, sort = excluded.sort, revalidate_days = excluded.revalidate_days,
  section = excluded.section, purpose = excluded.purpose, required_for = excluded.required_for, item_type = excluded.item_type,
  auto_verify = excluded.auto_verify, condition = excluded.condition;

alter table app_private.shipper_trust
  add column if not exists email_domain_approved     text,
  add column if not exists email_domain_approved_by  uuid,
  add column if not exists email_domain_approved_at  timestamptz,
  add column if not exists email_domain_approved_src text,
  add column if not exists email_domain_approved_url text,
  add column if not exists email_domain_approved_note text;

-- ───────────────────────────── 3. comparison helpers ─────────────────────────────
-- company name without punctuation and legal suffixes: "Acme Foods, L.L.C." = "ACME FOODS LLC" = "acme foods"
create or replace function app_private.reg_norm_name(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(' ' || lower(replace(coalesce(p,''), '&', ' and ')) || ' ', '[^a-z0-9 ]', '', 'g'),
             '\m(the|llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|lllp|pllc|pc|pa|plc)\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- entity / file number: letters and digits only, upper case, leading zeros ignored
create or replace function app_private.reg_norm_id(p text)
returns text language sql immutable as $$
  select nullif(ltrim(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '0'), '')
$$;

-- the answers a verified registry check was made against; any change re-opens the check
create or replace function app_private.shipper_registry_snapshot(p_org uuid)
returns text language sql stable security definer set search_path = app_private, public as $$
  select md5(concat_ws('|',
    app_private.reg_norm_name(le.data->>'legal_name'), app_private.reg_norm_id(le.data->>'entity_number'), upper(le.data->>'state_of_formation'),
    lower(regexp_replace(coalesce(pa.data->>'street',''), '\s+', ' ', 'g')), lower(pa.data->>'city'), upper(pa.data->>'state'), left(coalesce(pa.data->>'zip',''), 5),
    lower(regexp_replace(coalesce(sg.data->>'name',''), '\s+', ' ', 'g'))))
  from (select 1) x
  left join app_private.org_onboarding_items le on le.org_id = p_org and le.item_key = 'legal_entity'
  left join app_private.org_onboarding_items pa on pa.org_id = p_org and pa.item_key = 'physical_address'
  left join app_private.org_onboarding_items sg on sg.org_id = p_org and sg.item_key = 'authorized_signer'
$$;

-- compare a registry record (p_reg, as staff typed it) with the shipper's current answers
create or replace function app_private.shipper_registry_eval(p_org uuid, p_reg jsonb)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare le jsonb; pa jsonb; sg jsonb; t app_private.shipper_trust; cfg app_private.shipper_config;
        v_addr text; v_house text; v_zip text; v_first text; v_last text; v_people text[]; v_formed date; v_age int;
        c jsonb; b text[] := '{}'; w text[] := '{}'; v_sec text; v_via text; v_signer_ok boolean;
begin
  select data into le from app_private.org_onboarding_items where org_id = p_org and item_key = 'legal_entity';
  select data into pa from app_private.org_onboarding_items where org_id = p_org and item_key = 'physical_address';
  select data into sg from app_private.org_onboarding_items where org_id = p_org and item_key = 'authorized_signer';
  select * into t from app_private.shipper_trust where org_id = p_org;
  select * into cfg from app_private.shipper_config where id;
  p_reg := coalesce(p_reg, '{}'::jsonb);

  -- address: the house number, the city and the 5-digit ZIP of the shipper's address must all appear in the registry address
  v_addr := ' ' || lower(regexp_replace(coalesce(p_reg->>'principal_address',''), '[^A-Za-z0-9]+', ' ', 'g')) || ' ';
  v_house := substring(btrim(coalesce(pa->>'street','')) from '^\d+[A-Za-z]?');
  v_zip := left(coalesce(pa->>'zip',''), 5);
  -- signer: first and last name of the authorized signer inside ONE registry person line
  v_first := lower(regexp_replace(split_part(btrim(coalesce(sg->>'name','')), ' ', 1), '[^A-Za-z]', '', 'g'));
  v_last := lower(regexp_replace(regexp_replace(btrim(coalesce(sg->>'name','')), '^.*\s', ''), '[^A-Za-z]', '', 'g'));
  select coalesce(array_agg(' ' || lower(regexp_replace(x, '[^A-Za-z]+', ' ', 'g')) || ' '), '{}') into v_people
    from jsonb_array_elements_text(case when jsonb_typeof(p_reg->'people') = 'array' then p_reg->'people' else '[]'::jsonb end) x;
  v_signer_ok := length(v_first) >= 2 and length(v_last) >= 2
    and exists (select 1 from unnest(v_people) p where p like '% ' || v_first || ' %' and p like '% ' || v_last || ' %');
  begin v_formed := nullif(p_reg->>'formation_date','')::date; exception when others then v_formed := null; end;
  v_age := case when v_formed is null then null else current_date - v_formed end;

  c := jsonb_build_object(
    'state_ok',  upper(coalesce(p_reg->>'state','')) = upper(coalesce(le->>'state_of_formation','')) and coalesce(p_reg->>'state','') <> '',
    'number_ok', app_private.reg_norm_id(p_reg->>'entity_number') is not null
                 and app_private.reg_norm_id(p_reg->>'entity_number') = app_private.reg_norm_id(le->>'entity_number'),
    'name_ok',   app_private.reg_norm_name(p_reg->>'legal_name') <> ''
                 and app_private.reg_norm_name(p_reg->>'legal_name') = app_private.reg_norm_name(le->>'legal_name'),
    'address_ok', v_house is not null and v_zip ~ '^\d{5}$' and v_addr like '% ' || lower(v_house) || ' %' and v_addr like '% ' || v_zip || ' %'
                 and v_addr like '% ' || lower(regexp_replace(coalesce(pa->>'city',''), '[^A-Za-z0-9]+', ' ', 'g')) || ' %',
    'signer_ok', v_signer_ok,
    'active',    coalesce(p_reg->>'status','') = 'active',
    'age_days',  v_age,
    'young',     v_age is not null and v_age < coalesce(cfg.domain_min_age_days, 180),
    'sec_hit',   coalesce(t.name_collision, false),
    'sec_names', t.risk_signals->'sec_names',
    'sec_same',  case when coalesce(t.name_collision, false) and app_private.reg_norm_id(p_reg->>'sec_entity_number') is not null
                      then app_private.reg_norm_id(p_reg->>'sec_entity_number') = app_private.reg_norm_id(p_reg->>'entity_number') end);

  -- hard blockers (verify refused)
  if coalesce(p_reg->>'status','') = '' then b := b || 'Registry status is missing'::text;
  elsif not (c->>'active')::boolean then b := b || ('The registry shows the company as "' || (p_reg->>'status') || '", not active')::text; end if;
  if coalesce(p_reg->>'registry_url','') !~ '^https?://' then b := b || 'Link to the registry record'::text; end if;
  if coalesce(p_reg->>'screenshot_path','') = '' then b := b || 'Screenshot of the registry record'::text; end if;
  if v_formed is null then b := b || 'Formation date from the registry'::text; end if;
  if not (c->>'state_ok')::boolean then b := b || 'The registry state is not the state of formation the shipper gave'::text; end if;
  if not (c->>'number_ok')::boolean then b := b || 'The registry entity number does not match the number the shipper gave'::text; end if;
  if not (c->>'name_ok')::boolean and length(btrim(coalesce(p_reg->>'override_name',''))) < 15 then
    b := b || 'The registry name does not match the legal name — reject, or explain the difference (15+ characters)'::text; end if;
  if not (c->>'address_ok')::boolean and length(btrim(coalesce(p_reg->>'override_address',''))) < 15 then
    b := b || 'The business address is not the registry address — explain why (15+ characters), e.g. the registry lists only the registered agent'::text; end if;
  if not v_signer_ok then
    v_via := coalesce(p_reg->'signer_auth'->>'via', '');
    if v_via not in ('callback','registry_domain_email','postal_code') or coalesce(p_reg->'signer_auth'->>'file_path','') = ''
       or length(btrim(coalesce(p_reg->'signer_auth'->>'note',''))) < 15 then
      b := b || 'The signer is not among the registry''s managers/officers: attach the company''s written authorization and say how it was confirmed independently'::text;
    elsif v_via = 'callback' and coalesce(t.callback_status,'') <> 'confirmed' then
      b := b || 'The authorization is to be confirmed by the independent call-back, which is not confirmed yet'::text;
    end if;
  end if;
  if coalesce(t.name_collision, false) then
    v_sec := coalesce(t.risk_signals->'sec_names'->>0, 'an SEC-registered company');
    if app_private.reg_norm_id(p_reg->>'sec_entity_number') is null then
      b := b || ('Name matches ' || v_sec || ': record that company''s state entity number from its SEC filing, to compare')::text;
    elsif not (c->>'sec_same')::boolean and (length(btrim(coalesce(p_reg->>'override_sec',''))) < 20 or coalesce(t.callback_status,'') <> 'confirmed') then
      b := b || ('Name matches ' || v_sec || ' but this entity number is NOT that company''s — likely a look-alike. Reject or hold; verify only after a confirmed call-back and a written reason (20+ characters)')::text;
    end if;
  end if;
  -- warnings (shown, recorded, not blocking)
  if (c->>'young')::boolean then w := w || ('Formed ' || v_age || ' days ago')::text; end if;
  if coalesce((c->>'sec_same')::boolean, false) then w := w || 'Claims to be the SEC company itself: its email domain needs staff approval'::text; end if;
  if not (c->>'name_ok')::boolean then w := w || 'Name differs from the registry (staff explained)'::text; end if;
  if not (c->>'address_ok')::boolean then w := w || 'Address differs from the registry (staff explained)'::text; end if;
  if not v_signer_ok then w := w || 'Signer not in the registry — written authorization on file'::text;
  elsif not exists (select 1 from unnest(v_people) p where p like '% ' || v_first || ' %' and p like '% ' || v_last || ' %' and p not like '% agent %') then
    w := w || 'Signer appears only as the registered agent, not as a manager or officer'::text; end if;
  return c || jsonb_build_object('blockers', to_jsonb(b), 'warnings', to_jsonb(w), 'snapshot', app_private.shipper_registry_snapshot(p_org));
end $$;

-- the domain whose inbox the shipper proved (company email code, or signup on the company domain) — null if none yet
create or replace function app_private.shipper_confirmed_email_domain(p_org uuid)
returns text language plpgsql stable security definer set search_path = app_private, public as $$
declare t app_private.shipper_trust; v_email text; v_conf timestamptz;
begin
  select * into t from app_private.shipper_trust where org_id = p_org;
  if t.email_verified_at is not null and t.company_email is not null then return lower(split_part(t.company_email, '@', 2)); end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_conf
    from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = p_org;
  if v_conf is not null and t.domain is not null and not coalesce(t.free_mail, true)
     and split_part(coalesce(v_email,''),'@',2) = t.domain then return t.domain; end if;
  return null;
end $$;

-- ───────────────────────────── 4. live status: registry snapshot + SEC email rule ─────────────────────────────
select app_private._bl0502_patch('app_private.shipper_item_status(uuid,text)'::regprocedure,
$a$  if p_key = 'email_verify' then
    select * into t from app_private.shipper_trust where org_id = p_org;
    if t.email_verified_at is not null then return 'verified'; end if;$a$,
$b$  if p_key = 'registry_check' then  -- bl_ship_0502: a verified check only holds for the answers it was compared with
    if i.status = 'verified' and i.data->>'snapshot' is distinct from app_private.shipper_registry_snapshot(p_org) then return 'pending'; end if;
    return coalesce(i.status, 'pending');
  end if;
  if p_key = 'email_verify' then
    select * into t from app_private.shipper_trust where org_id = p_org;
    -- bl_ship_0502: name matches an SEC company → a confirmed inbox counts only once staff approve that domain
    if coalesce(t.name_collision, false) then
      v_email := app_private.shipper_confirmed_email_domain(p_org);
      if v_email is null then return 'pending'; end if;
      if t.email_domain_approved is distinct from v_email then return 'submitted'; end if;
      return 'verified';
    end if;
    if t.email_verified_at is not null then return 'verified'; end if;$b$);

-- ───────────────────────────── 5. review gate ─────────────────────────────
-- registry_check is verified only through cc_shipper_registry_check; ein_letter / address_proof only after the registry
-- check, with the staff tick stored by cc_shipper_doc_verify after the latest upload.
select app_private._bl0502_patch('public.cc_onboarding_review_item(uuid,text,text,text)'::regprocedure,
$a$    raise exception 'a written reason is required to % this item', p_action using errcode='22023'; end if;$a$,
$b$    raise exception 'a written reason is required to % this item', p_action using errcode='22023'; end if;
  if p_action = 'verify' and (select kind from public.organizations where id = p_org) = 'shipper' then  -- bl_ship_0502
    if p_key = 'registry_check' then
      if coalesce(current_setting('lb.registry_verify', true), '') <> p_org::text then
        raise exception 'Verify the registry check from its card: the record is compared with the shipper''s answers first' using errcode = '22023'; end if;
    elsif p_key in ('ein_letter','address_proof') then
      if app_private.shipper_item_status(p_org, 'registry_check') not in ('verified','waived') then
        raise exception 'Verify the state registry check first — this document is compared with the registry record' using errcode = '22023'; end if;
      if not exists (select 1 from app_private.org_onboarding_items x where x.org_id = p_org and x.item_key = p_key
                      and (x.data->'registry_match'->>'at')::timestamptz >= coalesce(x.submitted_at, '-infinity')
                      and (x.data->'registry_match'->>'name')::boolean and (x.data->'registry_match'->>'address')::boolean) then
        raise exception 'Tick that the name and address on this document match the registry record (Verify from the card)' using errcode = '22023'; end if;
    end if;
  end if;$b$);

-- ───────────────────────────── 6. shipper can submit upload items only ─────────────────────────────
select app_private._bl0502_patch('public.cc_onboarding_submit_item(text,text,text)'::regprocedure,
$a$  if coalesce(trim(p_ref),'') = '' then raise exception 'a document reference / note is required' using errcode='22023'; end if;$a$,
$b$  if coalesce(trim(p_ref),'') = '' then raise exception 'a document reference / note is required' using errcode='22023'; end if;
  if v_kind = 'shipper' and (select item_type from app_private.onboarding_packet_templates where org_kind = 'shipper' and item_key = p_key) <> 'upload' then
    raise exception 'this item is not an upload' using errcode = '22023'; end if;  -- bl_ship_0502$b$);

-- ───────────────────────────── 7. staff RPCs ─────────────────────────────
-- Save what the registry says; p_verify = true also verifies it when no hard check fails.
create or replace function public.cc_shipper_registry_check(p_org uuid, p_data jsonb, p_verify boolean default false)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare d jsonb; ev jsonb; v_path text; r jsonb;
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'shipper') then raise exception 'not a shipper' using errcode = '22023'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'registry record required' using errcode = '22023'; end if;
  d := jsonb_strip_nulls(jsonb_build_object(
    'state', upper(nullif(btrim(p_data->>'state'),'')), 'legal_name', nullif(btrim(p_data->>'legal_name'),''),
    'entity_number', nullif(btrim(p_data->>'entity_number'),''), 'status', nullif(lower(btrim(p_data->>'status')),''),
    'formation_date', nullif(btrim(p_data->>'formation_date'),''), 'principal_address', nullif(btrim(p_data->>'principal_address'),''),
    'people', case when jsonb_typeof(p_data->'people') = 'array' then (select coalesce(jsonb_agg(btrim(x)), '[]'::jsonb) from jsonb_array_elements_text(p_data->'people') x where btrim(x) <> '') end,
    'registry_url', nullif(btrim(p_data->>'registry_url'),''), 'screenshot_path', nullif(btrim(p_data->>'screenshot_path'),''),
    'source', coalesce(nullif(btrim(p_data->>'source'),''), 'manual'),
    'sec_entity_number', nullif(btrim(p_data->>'sec_entity_number'),''),
    'override_name', nullif(btrim(p_data->>'override_name'),''), 'override_address', nullif(btrim(p_data->>'override_address'),''),
    'override_sec', nullif(btrim(p_data->>'override_sec'),''),
    'signer_auth', case when jsonb_typeof(p_data->'signer_auth') = 'object' then jsonb_strip_nulls(jsonb_build_object(
        'via', nullif(p_data->'signer_auth'->>'via',''), 'file_path', nullif(btrim(p_data->'signer_auth'->>'file_path'),''),
        'note', nullif(btrim(p_data->'signer_auth'->>'note'),''))) end));
  if coalesce(d->>'status','active') not in ('active','inactive','dissolved','revoked','suspended','not_found') then
    raise exception 'status must be active, inactive, dissolved, revoked, suspended or not_found' using errcode = '22023'; end if;
  if d ? 'formation_date' then
    begin perform (d->>'formation_date')::date; exception when others then raise exception 'formation date must be YYYY-MM-DD' using errcode = '22023'; end;
  end if;
  if d->>'source' not in ('manual','open_data') then raise exception 'source must be manual or open_data' using errcode = '22023'; end if;
  -- evidence files must be real objects in the documents bucket
  foreach v_path in array array[d->>'screenshot_path', d->'signer_auth'->>'file_path'] loop
    if v_path is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = v_path) then
      raise exception 'uploaded file not found: %', v_path using errcode = '22023'; end if;
  end loop;
  ev := app_private.shipper_registry_eval(p_org, d);
  if p_verify and jsonb_array_length(ev->'blockers') > 0 then
    raise exception 'Cannot verify yet: %', (select string_agg(x, '; ') from jsonb_array_elements_text(ev->'blockers') x) using errcode = '22023'; end if;
  d := d || jsonb_build_object('checks', ev - 'snapshot', 'snapshot', ev->>'snapshot', 'saved_by', auth.uid(), 'saved_at', now());
  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, data, submitted_by, submitted_at)
  values (p_org, 'registry_check', 'submitted', 'Registry record entered by staff', d, auth.uid(), now())
  on conflict (org_id, item_key) do update set data = excluded.data, submitted_by = excluded.submitted_by, submitted_at = now(),
    status = 'submitted', ref = excluded.ref, reviewed_by = null, reviewed_at = null;
  perform app_private.log_audit('shipper.registry_saved', 'org', p_org::text, p_org,
    concat_ws(' · ', d->>'state', d->>'entity_number', d->>'status', 'blockers ' || jsonb_array_length(ev->'blockers')), null);
  if p_verify then
    perform set_config('lb.registry_verify', p_org::text, true);
    r := public.cc_onboarding_review_item(p_org, 'registry_check', 'verify',
           nullif(concat_ws(' · ', d->>'override_name', d->>'override_address', d->>'override_sec'), ''));
    perform set_config('lb.registry_verify', '', true);
  end if;
  return jsonb_build_object('ok', true, 'status', app_private.shipper_item_status(p_org, 'registry_check'), 'checks', ev);
end $$;

-- Verify an EIN letter / address proof against the registry record: staff tick both boxes, the tick is kept with the item.
create or replace function public.cc_shipper_doc_verify(p_org uuid, p_key text, p_name_matches boolean, p_address_matches boolean)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_key not in ('ein_letter','address_proof') then raise exception 'only the EIN letter or the address proof' using errcode = '22023'; end if;
  if not (coalesce(p_name_matches, false) and coalesce(p_address_matches, false)) then
    raise exception 'Both must match the registry record. If they do not, reject the document instead.' using errcode = '22023'; end if;
  if app_private.shipper_item_status(p_org, 'registry_check') not in ('verified','waived') then
    raise exception 'Verify the state registry check first — this document is compared with the registry record' using errcode = '22023'; end if;
  update app_private.org_onboarding_items
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('registry_match', jsonb_build_object('name', true, 'address', true, 'by', auth.uid(), 'at', now()))
   where org_id = p_org and item_key = p_key and status = 'submitted';
  if not found then raise exception 'nothing submitted to verify' using errcode = '22023'; end if;
  return public.cc_onboarding_review_item(p_org, p_key, 'verify', null);
end $$;

-- SEC-name rule: approve (or clear, p_domain null) the domain of the shipper's confirmed company email.
create or replace function public.cc_shipper_email_domain_approve(p_org uuid, p_domain text, p_source text, p_source_url text, p_note text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare t app_private.shipper_trust; v_dom text; v_min int;
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into t from app_private.shipper_trust where org_id = p_org;
  if t.org_id is null then raise exception 'no trust record for this shipper' using errcode = '22023'; end if;
  if p_domain is null then
    update app_private.shipper_trust set email_domain_approved = null, email_domain_approved_by = auth.uid(), email_domain_approved_at = now(),
      email_domain_approved_src = null, email_domain_approved_url = null, email_domain_approved_note = p_note, updated_at = now() where org_id = p_org;
    perform app_private.log_audit('shipper.email_domain_cleared', 'org', p_org::text, p_org, coalesce(p_note, ''), null);
    return jsonb_build_object('ok', true, 'approved', null);
  end if;
  v_dom := app_private.shipper_confirmed_email_domain(p_org);
  if v_dom is null then raise exception 'The shipper has not confirmed a company inbox yet' using errcode = '22023'; end if;
  if lower(btrim(p_domain)) <> v_dom then raise exception 'The confirmed inbox is on %, not %', v_dom, lower(btrim(p_domain)) using errcode = '22023'; end if;
  if coalesce(p_source,'') not in ('registry','official_site','sec_filing') then
    raise exception 'Say where the company itself lists this domain: registry, official_site or sec_filing' using errcode = '22023'; end if;
  if coalesce(btrim(p_source_url),'') !~ '^https://' then raise exception 'Link to that source (https://…)' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note,''))) < 10 then raise exception 'A short note is required (10+ characters)' using errcode = '22023'; end if;
  select coalesce(domain_min_age_days, 180) into v_min from app_private.shipper_config where id;
  if t.domain_created_at is not null and t.domain_created_at > now() - make_interval(days => v_min) and v_dom = t.domain then
    raise exception 'This domain was registered % — too new to be the company''s established domain', t.domain_created_at::date using errcode = '22023'; end if;
  update app_private.shipper_trust set email_domain_approved = v_dom, email_domain_approved_by = auth.uid(), email_domain_approved_at = now(),
    email_domain_approved_src = p_source, email_domain_approved_url = btrim(p_source_url), email_domain_approved_note = btrim(p_note), updated_at = now()
   where org_id = p_org;
  perform app_private.log_audit('shipper.email_domain_approved', 'org', p_org::text, p_org, v_dom || ' · ' || p_source || ' · ' || btrim(p_source_url), null);
  return jsonb_build_object('ok', true, 'approved', v_dom);
end $$;

-- ───────────────────────────── 8. staff view carries the registry card ─────────────────────────────
select app_private._bl0502_patch('public.cc_shipper_verification(uuid)'::regprocedure,
$a$    'callback', jsonb_build_object('status', t.callback_status,$a$,
$b$    'registry', (select jsonb_build_object(  -- bl_ship_0502
        'status', app_private.shipper_item_status(p_org, 'registry_check'),
        'record', i.data - 'checks',
        'checks', app_private.shipper_registry_eval(p_org, coalesce(i.data, '{}'::jsonb)) - 'snapshot',
        'stale', i.status = 'verified' and i.data->>'snapshot' is distinct from app_private.shipper_registry_snapshot(p_org),
        'reviewed_at', i.reviewed_at,
        'source', (select to_jsonb(s) from app_private.sos_registries s
                    where s.state = upper((select data->>'state_of_formation' from app_private.org_onboarding_items
                                            where org_id = p_org and item_key = 'legal_entity'))))
      from (select 1) x left join app_private.org_onboarding_items i on i.org_id = p_org and i.item_key = 'registry_check'),
    'email_domain', jsonb_build_object('confirmed', app_private.shipper_confirmed_email_domain(p_org), 'sec_rule', coalesce(t.name_collision, false),
       'approved', t.email_domain_approved, 'approved_at', t.email_domain_approved_at, 'source', t.email_domain_approved_src,
       'source_url', t.email_domain_approved_url, 'note', t.email_domain_approved_note),
    'callback', jsonb_build_object('status', t.callback_status,$b$);

-- ───────────────────────────── 9. ACL + anon check ─────────────────────────────
do $$ declare f text; begin
  foreach f in array array['public.cc_shipper_registry_check(uuid,jsonb,boolean)', 'public.cc_shipper_doc_verify(uuid,text,boolean,boolean)',
                           'public.cc_shipper_email_domain_approve(uuid,text,text,text,text)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['app_private.reg_norm_name(text)', 'app_private.reg_norm_id(text)', 'app_private.shipper_registry_snapshot(uuid)',
                           'app_private.shipper_registry_eval(uuid,jsonb)', 'app_private.shipper_confirmed_email_domain(uuid)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;
drop function app_private._bl0502_patch(regprocedure, text, text);

do $$ declare v_added text; v_gone text; begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from _bl0502_anon) a;
  select string_agg(n, ', ') into v_gone from (select n from _bl0502_anon except
    select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0502: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
drop table pg_temp._bl0502_anon;
