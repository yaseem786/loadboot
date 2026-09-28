-- bl_ship_0491 — Shipper onboarding rebuilt (two-lane marketplace: Direct-to-carrier + Broker tender).
-- Plan: claude/SHIPPER-TWO-LANE-0491.md.  STAGING FIRST — prod only when the owner says "prod pe chalao".
--
-- What this file does
--   1. shipper_config (limits the owner can change) + two kill-switch flags.
--   2. Packet templates get section / purpose / required_for / item_type / condition, and the shipper
--      packet is re-imaged into sections A–G (identity, billing, agreements, cargo, special, facilities, acks).
--   3. org_onboarding_items gets data jsonb (form answers) + file fingerprint columns (duplicate-file guard).
--   4. shipper_facilities (reusable pickup/delivery address book).
--   5. agreement_signatures (built-in e-sign record) + master_agreements kinds shipper_platform / shipper_carrier
--      as UNPUBLISHED, legal_approved=false drafts. Nothing can be signed until the owner approves + publishes.
--   6. Live item status, lane gates, stage, tier — one source of truth (app_private.shipper_lane_gate).
--   7. Shipper RPCs: cc_shipper_onboarding, cc_shipper_item_save, cc_shipper_agreement, cc_shipper_agreement_sign,
--      cc_shipper_facilities, cc_shipper_facility_save, cc_shipper_facility_archive, cc_shipper_phone_code_send,
--      cc_shipper_code_verify.  Staff RPCs: cc_shipper_callback_start, cc_shipper_limits_lift.
--   Every new public function: revoke from public, anon (CLAUDE.md §4 — Supabase's default ACL grants anon).

-- ───────────────────────────── 1. config + flags ─────────────────────────────
create table if not exists app_private.shipper_config (
  id boolean primary key default true check (id),
  new_max_open_loads      int     not null default 3,        -- open direct loads until graduated
  new_max_cargo_value     numeric not null default 100000,   -- per-load cargo value cap until graduated (typical carrier cargo cover)
  graduate_paid_loads     int     not null default 3,        -- carrier-confirmed paid loads needed to lift the limits
  high_value_threshold    numeric          default 100000,   -- above this a load needs the high_value section
  callback_required_for_all boolean not null default true,   -- independent call-back for every shipper (IC3 guidance)
  domain_min_age_days     int     not null default 180,      -- younger company domain = human review
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into app_private.shipper_config(id) values (true) on conflict (id) do nothing;
revoke all on app_private.shipper_config from public;

insert into app_private.feature_flags(key, enabled, description, environment, audience, reason, updated_at)
values ('shipper_direct_lane', true, 'Shippers post loads straight to verified carriers and choose the carrier themselves. Kill switch — off stops new direct posts.', 'all', 'staff', 'bl_ship_0491', now()),
       ('shipper_broker_lane', true, 'Shippers send load tenders to verified brokers. Kill switch — off stops new tenders.', 'all', 'staff', 'bl_ship_0491', now())
on conflict (key) do nothing;

-- ───────────────────────────── 2. templates ─────────────────────────────
alter table app_private.onboarding_packet_templates
  add column if not exists section      text,
  add column if not exists purpose      text,
  add column if not exists required_for text[]  not null default '{}',
  add column if not exists item_type    text    not null default 'upload',
  add column if not exists auto_verify  boolean not null default false,
  add column if not exists condition    text;
do $$ begin
  alter table app_private.onboarding_packet_templates add constraint opt_item_type_check
    check (item_type in ('upload','form','ack','accept','system','staff','legacy'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table app_private.onboarding_packet_templates add constraint opt_condition_check
    check (condition is null or condition in ('hazmat','food','high_value','callback','manual_identity'));
exception when duplicate_object then null; end $$;

alter table app_private.org_onboarding_items
  add column if not exists data        jsonb,
  add column if not exists file_path   text,
  add column if not exists file_md5    text,
  add column if not exists file_size   bigint,
  add column if not exists file_sha256 text;
create index if not exists org_onboarding_items_md5_idx on app_private.org_onboarding_items(file_md5) where file_md5 is not null;

-- status_tag keeps its old meaning: 'required' = needed for the full (Direct-ready) packet, which is what
-- org_onboarding_complete() and the CC review flow read. required_for says which LANE needs the item.
insert into app_private.onboarding_packet_templates
  (org_kind, item_key, label, status_tag, sort, revalidate_days, needs_expiry, section, purpose, required_for, item_type, auto_verify, condition)
values
 -- A · identity (both lanes)
 ('shipper','legal_entity','Legal business entity','required',110,365,false,'identity',
  'Carriers and brokers see exactly which company owes them. We match it to your state''s business registry.','{direct,broker}','form',false,null),
 ('shipper','physical_address','Business address','required',120,365,false,'identity',
  'A real, checkable location. Look-alike fake shippers usually cannot give one.','{direct,broker}','form',false,null),
 ('shipper','authorized_signer','Authorized signer','required',130,365,false,'identity',
  'The person who can bind your company to agreements and rate confirmations.','{direct,broker}','form',false,null),
 ('shipper','email_verify','Company email confirmed','required',140,null,false,'identity',
  'Proves you control the company inbox. Owning an email domain alone is not proof.','{direct,broker}','system',false,null),
 ('shipper','phone_verify','Signer phone confirmed','required',150,null,false,'identity',
  'A second channel: we call the signer''s direct line and read a one-time code.','{direct,broker}','system',false,null),
 ('shipper','independent_callback','Independent call-back','conditional',160,null,false,'identity',
  'We call your company on a number WE find (state registry, your website, public listings) — never the number typed at signup. This is the FBI''s advice against freight fraud.','{direct,broker}','staff',false,'callback'),
 ('shipper','ein_letter','IRS EIN letter (CP 575 or 147C)','conditional',170,null,false,'identity',
  'Needed when your company has no website or company email — it shows the EIN belongs to your company.','{direct,broker}','upload',false,'manual_identity'),
 ('shipper','address_proof','Proof of business address','conditional',180,null,false,'identity',
  'A utility bill, lease or bank statement from the last 90 days in the company name.','{direct,broker}','upload',false,'manual_identity'),
 -- B · billing & credit
 ('shipper','payment_terms','Payment terms','required',210,365,false,'billing',
  'Carriers and brokers decide whether to extend you that credit.','{direct,broker}','form',true,null),
 ('shipper','billing_instructions','Billing instructions','required',220,365,false,'billing',
  'How to invoice you so the invoice is paid the first time (PO number, BOL, POD, rate agreement).','{direct,broker}','form',true,null),
 ('shipper','ap_contact','Accounts-payable contact','required',230,365,false,'billing',
  'Who a carrier or broker calls about a payment.','{direct,broker}','form',true,null),
 ('shipper','credit_application','Credit references','optional',240,365,false,'billing',
  'Brokers run a credit check before they give you terms — trade and bank references speed it up. Carriers only see "credit info provided: yes/no".','{broker}','form',true,null),
 -- C · agreements (built-in e-sign)
 ('shipper','platform_terms','LoadBoot Platform Terms','required',310,null,false,'agreements',
  'Confirms LoadBoot is software and a marketplace — not a broker or carrier, never a party to your shipments, never holds freight money.','{direct,broker}','accept',false,null),
 ('shipper','shipper_carrier_terms','Shipper–Carrier Transportation Terms','required',320,null,false,'agreements',
  'The contract between you and each carrier you book directly: payment, liability, accessorials, claims, no re-brokering.','{direct}','accept',false,null),
 -- D · cargo & liability
 ('shipper','cargo_profile','Cargo profile','required',410,365,false,'cargo',
  'Carriers check that their cargo insurance covers what you ship.','{direct,broker}','form',true,null),
 ('shipper','insurance_requirements','Insurance you require','required',420,365,false,'cargo',
  'Only carriers carrying at least this much cover can see and book your loads.','{direct,broker}','form',true,null),
 ('shipper','declared_value_policy','Declared value (liability)','required',430,365,false,'cargo',
  'Under federal law (Carmack, 49 U.S.C. 14706) a carrier owes actual loss unless a lower value is agreed in writing. Say which you use.','{direct,broker}','form',true,null),
 ('shipper','claims_contact','Claims contact','required',440,365,false,'cargo',
  'Who handles loss and damage claims on your side.','{direct,broker}','form',true,null),
 -- E · special compliance (only when triggered)
 ('shipper','hazmat','Hazmat shipper details','conditional',510,365,false,'special',
  'Federal hazmat rules make the shipper responsible for shipping papers and a 24-hour emergency phone (49 CFR 172).','{direct,broker}','form',true,'hazmat'),
 ('shipper','food_sanitary','Food transport requirements','conditional',520,365,false,'special',
  'FSMA sanitary transportation rule (21 CFR 1.908): the shipper gives the carrier written temperature and cleaning requirements.','{direct,broker}','form',true,'food'),
 ('shipper','high_value','High-value freight','conditional',530,365,false,'special',
  'Loads worth more than typical carrier cargo cover get extra checks and live tracking.','{direct,broker}','form',true,'high_value'),
 -- F · facilities
 ('shipper','facility_rules','Pickup & delivery locations','required',610,365,false,'facilities',
  'Dock hours, appointments and detention rules per location — the carrier plans driver hours and nobody argues about detention.','{direct}','system',false,null),
 -- G · acknowledgements
 ('shipper','ack_non_coercion','No driver coercion','required',710,null,false,'acks',
  'Federal rule (49 CFR 390.6): nobody may pressure a driver to break safety or hours-of-service rules.','{direct,broker}','ack',true,null),
 ('shipper','ack_accurate_declarations','Accurate declarations','required',720,null,false,'acks',
  'Weight, commodity and hazmat facts you give are true — drivers and carriers rely on them.','{direct,broker}','ack',true,null),
 ('shipper','ack_direct_choice','You choose the carrier','required',730,null,false,'acks',
  'LoadBoot shows FMCSA and insurance data. You — not LoadBoot — choose and accept the carrier.','{direct}','ack',true,null)
on conflict (org_kind, item_key) do update set
  label = excluded.label, status_tag = excluded.status_tag, sort = excluded.sort, revalidate_days = excluded.revalidate_days,
  needs_expiry = excluded.needs_expiry, section = excluded.section, purpose = excluded.purpose, required_for = excluded.required_for,
  item_type = excluded.item_type, auto_verify = excluded.auto_verify, condition = excluded.condition;

-- retired shipper items: kept for history, never asked again
update app_private.onboarding_packet_templates
   set item_type = 'legacy', status_tag = 'optional', required_for = '{}', section = 'legacy', sort = 900 + sort % 100,
       purpose = 'Replaced by the sections above (bl_ship_0491).'
 where org_kind = 'shipper' and item_key in ('signed_agreement','special_commodity');

-- ───────────────────────────── 3. facilities + signatures ─────────────────────────────
create table if not exists app_private.shipper_facilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'both' check (kind in ('pickup','delivery','both')),
  street text not null, city text not null, state text not null, zip text not null,
  lat double precision, lng double precision,
  dock_hours text not null,
  appointment text not null check (appointment in ('required','fcfs','either')),
  load_type text not null check (load_type in ('live','drop','either')),
  who_loads text not null check (who_loads in ('shipper_load_count','driver_assist','driver_load')),
  lumper text not null check (lumper in ('none','shipper_pays','carrier_pays_reimbursed','receiver_pays')),
  ppe text,
  detention_free_hours numeric not null check (detention_free_hours >= 0 and detention_free_hours <= 24),
  detention_rate numeric not null check (detention_rate >= 0),
  site_contact_name text not null, site_contact_phone text not null,
  notes text,
  archived_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists shipper_facilities_org_idx on app_private.shipper_facilities(org_id) where archived_at is null;
revoke all on app_private.shipper_facilities from public;

do $$ begin
  alter table app_private.master_agreements drop constraint master_agreements_kind_check;
  alter table app_private.master_agreements add constraint master_agreements_kind_check
    check (kind in ('broker_shipper','broker_carrier','dispatcher_carrier','shipper_platform','shipper_carrier'));
end $$;
-- DRAFT placeholders only. The owner reviews the drafts in claude/agreements/ and publishes; until then
-- legal_approved=false + published=false and nobody can sign (cc_shipper_agreement_sign refuses).
insert into app_private.master_agreements(kind, version, title, body_md, legal_approved, published)
values ('shipper_platform', 1, 'LoadBoot Platform Terms for Shippers', '[DRAFT — not approved. Text lives in claude/agreements/ until the owner approves it.]', false, false),
       ('shipper_carrier', 1, 'Master Shipper–Carrier Transportation Terms', '[DRAFT — not approved. Text lives in claude/agreements/ until the owner approves it.]', false, false)
on conflict (kind, version) do nothing;

create table if not exists app_private.agreement_signatures (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null, version int not null,
  signer_user uuid not null, signer_name text not null, signer_title text not null,
  consent_text text not null,                 -- the exact ESIGN consent sentence the signer ticked
  body_sha256 text not null,                  -- hash of the agreement text that was on screen
  ip text, user_agent text,
  signed_at timestamptz not null default now()
);
create index if not exists agreement_signatures_org_idx on app_private.agreement_signatures(org_id, kind, version);
revoke all on app_private.agreement_signatures from public;

-- verify_codes learns the two shipper phone purposes
do $$ begin
  alter table app_private.verify_codes drop constraint verify_codes_purpose_check;
  alter table app_private.verify_codes add constraint verify_codes_purpose_check
    check (purpose in ('identity','parent','shipper_email','shipper_signer_phone','shipper_callback'));
end $$;

-- ───────────────────────────── 4. trust columns ─────────────────────────────
alter table app_private.shipper_trust
  add column if not exists risk_signals       jsonb,     -- raw domain-check v6 answer (RDAP, DMARC, SPF, MX class, SEC name hits)
  add column if not exists domain_created_at  timestamptz,
  add column if not exists mx_class           text,      -- corporate | budget_host | self_hosted | free | none
  add column if not exists dmarc              text,      -- none | p_none | quarantine | reject
  add column if not exists name_collision     boolean,
  add column if not exists needs_human        boolean not null default false,
  add column if not exists needs_human_reasons text[]  not null default '{}',
  add column if not exists callback_status    text,      -- calling | confirmed | failed
  add column if not exists callback_phone     text,
  add column if not exists callback_source    text,
  add column if not exists callback_source_url text,
  add column if not exists callback_by        uuid,
  add column if not exists callback_at        timestamptz,
  add column if not exists limits_lifted_at   timestamptz,
  add column if not exists limits_lifted_by   uuid,
  add column if not exists shared_doc_orgs    uuid[]  not null default '{}';

-- Risk evaluation runs on every write — the trust row can never hold stale "needs_human".
create or replace function app_private.shipper_trust_risk()
returns trigger language plpgsql set search_path = app_private, public as $$
declare cfg app_private.shipper_config; s jsonb := coalesce(new.risk_signals, '{}'::jsonb); r text[] := '{}'; v_age int;
begin
  select * into cfg from app_private.shipper_config where id;
  if s ? 'rdap_created' then new.domain_created_at := nullif(s->>'rdap_created','')::timestamptz; end if;
  if s ? 'mx_class' then new.mx_class := nullif(s->>'mx_class',''); end if;
  if s ? 'dmarc' then new.dmarc := nullif(s->>'dmarc',''); end if;
  if s ? 'sec_name_hit' then new.name_collision := coalesce((s->>'sec_name_hit')::boolean, false); end if;
  v_age := case when new.domain_created_at is null then null else (current_date - new.domain_created_at::date) end;
  if v_age is not null and v_age < coalesce(cfg.domain_min_age_days, 180) then
    r := r || ('company domain is only ' || v_age || ' days old'); end if;
  if new.mx_class = 'budget_host' and coalesce(new.dmarc, 'none') in ('none','p_none') then
    r := r || 'email runs on a budget mail host with no DMARC protection'::text; end if;
  if coalesce(new.name_collision, false) and (coalesce(v_age, 99999) < 730 or new.mx_class in ('budget_host','free','none') or not coalesce(new.site_ok, false)) then
    r := r || 'company name matches an SEC-registered company, but the domain/email does not look like that company''s'::text; end if;
  if cardinality(new.shared_doc_orgs) > 0 then
    r := r || 'uploaded a document that another LoadBoot account also uploaded'::text; end if;
  new.needs_human := cardinality(r) > 0;
  new.needs_human_reasons := r;
  return new;
end $$;
drop trigger if exists trg_shipper_trust_risk on app_private.shipper_trust;
create trigger trg_shipper_trust_risk before insert or update on app_private.shipper_trust
  for each row execute function app_private.shipper_trust_risk();

-- ───────────────────────────── 5. live status, gates, stage ─────────────────────────────
create or replace function app_private.shipper_is_food(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text,'') ~* '(food|produce|meat|beef|pork|poultry|chicken|turkey|seafood|fish|shrimp|dairy|milk|cheese|egg|frozen|beverage|juice|water|soda|beer|wine|fruit|vegetable|grocery|bakery|bread|candy|snack|cereal|coffee|tea|pet food|animal feed|ice cream)'
$$;

-- which conditional sections are switched on for this shipper
create or replace function app_private.shipper_conditions(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare cfg app_private.shipper_config; t app_private.shipper_trust; cp jsonb; v_food boolean; v_haz boolean; v_hv boolean;
begin
  select * into cfg from app_private.shipper_config where id;
  select * into t from app_private.shipper_trust where org_id = p_org;
  select data into cp from app_private.org_onboarding_items where org_id = p_org and item_key = 'cargo_profile';
  v_haz := coalesce((cp->>'hazmat')::boolean, false) or coalesce(cp->'commodities' ? 'hazmat', false);
  v_food := coalesce((cp->>'food_grade')::boolean, false)
         or exists (select 1 from jsonb_array_elements_text(coalesce(cp->'commodities','[]'::jsonb)) c where c like 'food%' or c in ('produce','meat_poultry_seafood','dairy','beverages','frozen_food'));
  v_hv := cfg.high_value_threshold is not null and coalesce(nullif(cp->>'max_value','')::numeric, 0) > cfg.high_value_threshold;
  return jsonb_build_object(
    'hazmat', v_haz, 'food', v_food, 'high_value', v_hv,
    'callback', coalesce(cfg.callback_required_for_all, true) or coalesce(t.needs_human, false),
    -- no company website or no company email: prove identity with IRS + address documents instead
    'manual_identity', t.org_id is null or coalesce(t.free_mail, true) or not coalesce(t.mx, false) or not coalesce(t.site_ok, false));
end $$;

-- one item's live status (system items are computed, agreements must match the CURRENT published version)
create or replace function app_private.shipper_item_status(p_org uuid, p_key text)
returns text language plpgsql stable security definer set search_path = app_private, public as $$
declare i app_private.org_onboarding_items; t app_private.shipper_trust; v_kind text; v_cur int; v_email text; v_conf timestamptz;
begin
  select * into i from app_private.org_onboarding_items where org_id = p_org and item_key = p_key;
  if i.status = 'waived' then return 'waived'; end if;
  if p_key = 'email_verify' then
    select * into t from app_private.shipper_trust where org_id = p_org;
    if t.email_verified_at is not null then return 'verified'; end if;
    -- signed up on the company domain and confirmed the signup email with Supabase Auth = inbox proven
    select lower(u.email), u.email_confirmed_at into v_email, v_conf
      from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = p_org;
    if v_conf is not null and t.domain is not null and not coalesce(t.free_mail, true)
       and split_part(coalesce(v_email,''),'@',2) = t.domain then return 'verified'; end if;
    return 'pending';
  elsif p_key = 'facility_rules' then
    if exists (select 1 from app_private.shipper_facilities f where f.org_id = p_org and f.archived_at is null) then return 'verified'; end if;
    return 'pending';
  elsif p_key in ('platform_terms','shipper_carrier_terms') then
    v_kind := case p_key when 'platform_terms' then 'shipper_platform' else 'shipper_carrier' end;
    select max(version) into v_cur from app_private.master_agreements where kind = v_kind and published and legal_approved;
    if v_cur is null then return 'unavailable'; end if;   -- nothing approved to sign yet
    if exists (select 1 from app_private.org_agreement_acceptances a where a.org_id = p_org and a.kind = v_kind and a.version = v_cur) then return 'verified'; end if;
    return 'pending';
  end if;
  return coalesce(i.status, 'pending');
end $$;

-- THE gate. p_lane in ('direct','broker','identity'). Returns ok + what is missing, in plain words.
create or replace function app_private.shipper_lane_gate(p_org uuid, p_lane text)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare t app_private.shipper_trust; cond jsonb; miss jsonb := '[]'::jsonb; r record; st text; v_flag boolean := true; v_hold text;
begin
  if p_lane not in ('direct','broker','identity') then raise exception 'lane must be direct, broker or identity' using errcode = '22023'; end if;
  select * into t from app_private.shipper_trust where org_id = p_org;
  cond := app_private.shipper_conditions(p_org);
  v_hold := t.hold_reason;
  if v_hold is null and t.callback_status = 'failed' then v_hold := 'the independent call-back could not confirm the company'; end if;
  if p_lane = 'direct' then v_flag := public.is_flag_enabled('shipper_direct_lane'); end if;
  if p_lane = 'broker' then v_flag := public.is_flag_enabled('shipper_broker_lane'); end if;
  for r in select * from app_private.onboarding_packet_templates
            where org_kind = 'shipper' and item_type <> 'legacy'
              and (case when p_lane = 'identity' then section = 'identity' else p_lane = any(required_for) end)
              and (condition is null or coalesce((cond->>condition)::boolean, false))
            order by sort loop
    st := app_private.shipper_item_status(p_org, r.item_key);
    if st not in ('verified','waived') then
      miss := miss || jsonb_build_object('key', r.item_key, 'label', r.label, 'section', r.section, 'status', st);
    end if;
  end loop;
  return jsonb_build_object('lane', p_lane, 'ok', v_flag and v_hold is null and jsonb_array_length(miss) = 0,
    'flag_on', v_flag, 'hold', v_hold, 'missing', miss, 'conditions', cond);
end $$;

-- graduated = N loads the CARRIER confirmed as paid, or staff lifted the limits by hand
create or replace function app_private.shipper_graduated(p_org uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select limits_lifted_at is not null from app_private.shipper_trust where org_id = p_org), false)
      or (select count(distinct pt.ref_id) from app_private.pay_transfers pt
           where pt.payer_org = p_org and pt.kind = 'freight' and pt.status = 'received')
         >= (select graduate_paid_loads from app_private.shipper_config where id)
$$;

create or replace function app_private.shipper_stage(p_org uuid)
returns text language plpgsql stable security definer set search_path = app_private, public as $$
declare d jsonb; b jsonb; i jsonb;
begin
  d := app_private.shipper_lane_gate(p_org, 'direct');
  if d->>'hold' is not null then return 'hold'; end if;
  b := app_private.shipper_lane_gate(p_org, 'broker');
  if (d->>'ok')::boolean and (b->>'ok')::boolean then return 'both_ready'; end if;
  if (d->>'ok')::boolean then return 'direct_ready'; end if;
  if (b->>'ok')::boolean then return 'broker_ready'; end if;
  i := app_private.shipper_lane_gate(p_org, 'identity');
  if (i->>'ok')::boolean then return 'identity_verified'; end if;
  return 'new';
end $$;

-- tier keeps its old vocabulary for every existing reader (trust label, badge, CC queue):
--   hold → hold · direct lane open → verified · identity or broker lane open → business_verified · else new
create or replace function app_private.shipper_tier(p_org uuid)
returns text language plpgsql stable security definer set search_path = app_private, public as $$
declare s text;
begin
  s := app_private.shipper_stage(p_org);
  return case s when 'hold' then 'hold' when 'direct_ready' then 'verified' when 'both_ready' then 'verified'
                when 'broker_ready' then 'business_verified' when 'identity_verified' then 'business_verified' else 'new' end;
end $$;

-- human sentence for "why can't I post yet" (kept signature: ok, tier, reason — read by CC 360, overview, journey)
create or replace function app_private.shipper_can_post(p_org uuid)
returns table(ok boolean, tier text, reason text) language plpgsql stable security definer set search_path = app_private, public as $$
declare d jsonb; b jsonb; m jsonb;
begin
  tier := app_private.shipper_tier(p_org);
  d := app_private.shipper_lane_gate(p_org, 'direct');
  b := app_private.shipper_lane_gate(p_org, 'broker');
  ok := coalesce((d->>'ok')::boolean, false) or coalesce((b->>'ok')::boolean, false);
  reason := null;
  if d->>'hold' is not null then reason := 'Posting is on hold: ' || (d->>'hold') || '. Contact hello@loadboot.com.';
  elsif not ok then
    m := coalesce(b->'missing', d->'missing');
    if jsonb_array_length(coalesce(d->'missing','[]')) < jsonb_array_length(coalesce(m,'[]')) then m := d->'missing'; end if;
    reason := 'Finish your company verification to post: '
      || (select string_agg(x->>'label', ', ') from (select x from jsonb_array_elements(m) x limit 3) s)
      || case when jsonb_array_length(m) > 3 then ' and ' || (jsonb_array_length(m) - 3) || ' more' else '' end || '.';
  end if;
  return next;
end $$;

-- the posting trigger calls this with the row being inserted (load-specific checks + new-shipper limits)
create or replace function app_private.assert_shipper_lane(p_org uuid, p_lane text, p_row jsonb)
returns void language plpgsql stable security definer set search_path = app_private, public as $$
declare g jsonb; cfg app_private.shipper_config; v_val numeric; v_open int; v_lbl text; st text;
begin
  g := app_private.shipper_lane_gate(p_org, p_lane);
  if not coalesce((g->>'flag_on')::boolean, true) then
    raise exception '%', case p_lane when 'direct' then 'Posting to carriers is paused right now. Please try again later or contact hello@loadboot.com.'
                                      else 'Sending tenders to brokers is paused right now. Please try again later or contact hello@loadboot.com.' end using errcode = '42501'; end if;
  if g->>'hold' is not null then raise exception 'Posting is on hold: %. Contact hello@loadboot.com.', g->>'hold' using errcode = '42501'; end if;
  if jsonb_array_length(g->'missing') > 0 then
    select string_agg(x->>'label', ', ') into v_lbl from (select x from jsonb_array_elements(g->'missing') x limit 4) s;
    raise exception 'Finish your company verification first (Onboarding): %.', v_lbl using errcode = '42501'; end if;
  select * into cfg from app_private.shipper_config where id;
  v_val := coalesce(nullif(p_row->'details'->>'cargo_value','')::numeric, nullif(p_row->>'cargo_value','')::numeric);
  -- load-specific sections: the load itself can trigger them even if the cargo profile did not
  if coalesce((p_row->>'hazmat')::boolean, false) then
    st := app_private.shipper_item_status(p_org, 'hazmat');
    if st not in ('verified','waived') then raise exception 'This is a hazmat load — complete "Hazmat shipper details" under Onboarding first (49 CFR 172 shipping papers + 24-hour emergency phone).' using errcode = '42501'; end if;
  end if;
  if app_private.shipper_is_food(p_row->>'commodity') then
    st := app_private.shipper_item_status(p_org, 'food_sanitary');
    if st not in ('verified','waived') then raise exception 'This is a food load — complete "Food transport requirements" under Onboarding first (FSMA sanitary transportation rule).' using errcode = '42501'; end if;
  end if;
  if cfg.high_value_threshold is not null and coalesce(v_val, 0) > cfg.high_value_threshold then
    st := app_private.shipper_item_status(p_org, 'high_value');
    if st not in ('verified','waived') then raise exception 'This load is worth more than $% — complete "High-value freight" under Onboarding first.', to_char(cfg.high_value_threshold, 'FM999,999,999') using errcode = '42501'; end if;
  end if;
  -- new-shipper limits protect carriers until the shipper has a payment record (direct lane only;
  -- in the broker lane the broker carries the credit risk and runs its own check)
  if p_lane = 'direct' and not app_private.shipper_graduated(p_org) then
    if v_val is not null and v_val > cfg.new_max_cargo_value then
      raise exception 'New shippers can post loads worth up to $% until % loads are confirmed paid by carriers. Contact hello@loadboot.com to raise it sooner.',
        to_char(cfg.new_max_cargo_value, 'FM999,999,999'), cfg.graduate_paid_loads using errcode = '42501'; end if;
    select count(*) into v_open from app_private.partner_loads pl
     where pl.broker_org = p_org and pl.status not in ('delivered','cancelled','canceled','expired','completed','closed');
    if v_open >= cfg.new_max_open_loads then
      raise exception 'New shippers can have % open loads at a time until % loads are confirmed paid by carriers.', cfg.new_max_open_loads, cfg.graduate_paid_loads using errcode = '42501'; end if;
  end if;
end $$;

-- keep the old helper working for every caller, now backed by the lane gates
create or replace function app_private.assert_shipper_can_post(p_org uuid)
returns void language plpgsql stable security definer set search_path = app_private, public as $$
declare r record;
begin
  select * into r from app_private.shipper_can_post(p_org);
  if not r.ok then raise exception '%', coalesce(r.reason, 'posting is not available for this account yet') using errcode = '42501'; end if;
end $$;

-- ───────────────────────────── 6. validation helpers ─────────────────────────────
create or replace function app_private.shipper_digits(p text) returns text language sql immutable as $$
  select regexp_replace(coalesce(p,''), '\D', '', 'g') $$;
create or replace function app_private.shipper_phone_ok(p text) returns boolean language sql immutable as $$
  select length(app_private.shipper_digits(p)) = 10 or (length(app_private.shipper_digits(p)) = 11 and left(app_private.shipper_digits(p),1) = '1') $$;
create or replace function app_private.shipper_email_ok(p text) returns boolean language sql immutable as $$
  select coalesce(p,'') ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' $$;
create or replace function app_private.shipper_state_ok(p text) returns boolean language sql immutable as $$
  select upper(coalesce(p,'')) = any (array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR']) $$;

-- Validates one section's answers. Returns {errors:[], confirm:[], clean:{}}.
-- errors block the save; confirm = "are you sure?" questions the shipper must answer with p_confirm=true.
create or replace function app_private.shipper_validate(p_org uuid, p_key text, d jsonb)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare e text[] := '{}'; c text[] := '{}'; t app_private.shipper_trust; x text; v1 numeric; v2 numeric; arr jsonb;
  eq_ok text[] := array['dry_van','reefer','flatbed','step_deck','double_drop','lowboy','conestoga','power_only','box_truck','hotshot','sprinter_van','tanker','container','auto_carrier','dump','hopper'];
  com_ok text[] := array['general_merchandise','apparel_textiles','electronics','appliances','furniture','building_materials','lumber','steel_metals','machinery','auto_parts','paper_packaging','plastics_rubber','chemicals_nonhaz','household_goods','retail_consumer','beverages','food_dry','food_refrigerated','frozen_food','produce','meat_poultry_seafood','dairy','pharmaceuticals','medical_supplies','agricultural','livestock_feed','hazmat','high_value_goods','other'];
  terms_ok text[] := array['quick_pay','net_15','net_30','net_45','net_60'];
begin
  select * into t from app_private.shipper_trust where org_id = p_org;
  d := coalesce(d, '{}'::jsonb);
  if p_key = 'legal_entity' then
    if length(trim(coalesce(d->>'legal_name',''))) < 3 then e := e || 'Legal company name (exactly as registered with the state)'::text; end if;
    if app_private.shipper_digits(d->>'ein') !~ '^\d{9}$' then e := e || 'EIN — 9 digits (e.g. 12-3456789)'::text; end if;
    if app_private.shipper_digits(d->>'ein') ~ '^(\d)\1{8}$' or app_private.shipper_digits(d->>'ein') in ('123456789','987654321') then e := e || 'That EIN is not a real number'::text; end if;
    if coalesce(d->>'entity_type','') not in ('llc','corporation','s_corp','partnership','sole_proprietor','nonprofit','other') then e := e || 'Entity type'::text; end if;
    if not app_private.shipper_state_ok(d->>'state_of_formation') then e := e || 'State of formation (2-letter code)'::text; end if;
    if length(trim(coalesce(d->>'entity_number',''))) < 3 and coalesce(d->>'entity_type','') <> 'sole_proprietor' then e := e || 'State entity / file number (from the Secretary of State record)'::text; end if;
  elsif p_key = 'physical_address' then
    if length(trim(coalesce(d->>'street',''))) < 4 then e := e || 'Street address'::text; end if;
    if trim(coalesce(d->>'street','')) ~* '^(p\.?\s*o\.?\s*box|pmb|private mail)' then e := e || 'A PO box or mailbox cannot be the business address — give the physical location'::text; end if;
    if length(trim(coalesce(d->>'city',''))) < 2 then e := e || 'City'::text; end if;
    if not app_private.shipper_state_ok(d->>'state') then e := e || 'State (2-letter code)'::text; end if;
    if coalesce(d->>'zip','') !~ '^\d{5}(-\d{4})?$' then e := e || 'ZIP code'::text; end if;
    if not coalesce((d->>'mailing_same')::boolean, true) and length(trim(coalesce(d->>'mailing',''))) < 8 then e := e || 'Mailing address'::text; end if;
  elsif p_key = 'authorized_signer' then
    if length(trim(coalesce(d->>'name',''))) < 4 or trim(coalesce(d->>'name','')) !~ '\s' then e := e || 'Signer''s full name (first and last)'::text; end if;
    if length(trim(coalesce(d->>'title',''))) < 2 then e := e || 'Signer''s title'::text; end if;
    if not app_private.shipper_phone_ok(d->>'phone') then e := e || 'Signer''s direct phone (US, 10 digits)'::text; end if;
    if not app_private.shipper_email_ok(d->>'email') then e := e || 'Signer''s email'::text;
    elsif t.domain is not null and not coalesce(t.free_mail, true) and split_part(lower(d->>'email'),'@',2) <> t.domain then
      c := c || ('The signer''s email is not on your company domain (' || t.domain || '). Carriers trust a company address more — continue anyway?'); end if;
  elsif p_key = 'payment_terms' then
    if coalesce(d->>'terms','') <> all (terms_ok) then e := e || 'Payment terms'::text; end if;
    if coalesce(d->>'terms','') = 'net_60' then c := c || 'Net 60 is long for trucking — many carriers will skip these loads. Keep Net 60?'::text; end if;
  elsif p_key = 'billing_instructions' then
    if not app_private.shipper_email_ok(d->>'invoice_email') then e := e || 'Email where invoices go'::text; end if;
    if jsonb_typeof(d->'required_docs') is distinct from 'array' then e := e || 'Which documents must come with an invoice'::text; end if;
    if t.domain is not null and not coalesce(t.free_mail, true) and app_private.shipper_email_ok(d->>'invoice_email') and split_part(lower(d->>'invoice_email'),'@',2) <> t.domain then
      c := c || 'The invoice email is not on your company domain. Fraudsters often redirect invoices this way — is this address really yours?'::text; end if;
  elsif p_key = 'ap_contact' then
    if length(trim(coalesce(d->>'name',''))) < 3 then e := e || 'AP contact name'::text; end if;
    if not app_private.shipper_phone_ok(d->>'phone') then e := e || 'AP phone (US, 10 digits)'::text; end if;
    if not app_private.shipper_email_ok(d->>'email') then e := e || 'AP email'::text; end if;
  elsif p_key = 'credit_application' then
    arr := coalesce(d->'trade_refs','[]'::jsonb);
    if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) < 2 then e := e || 'At least two trade references (company, contact, phone or email)'::text; end if;
    if coalesce(nullif(d->>'years_in_business','')::numeric, -1) < 0 then e := e || 'Years in business'::text; end if;
  elsif p_key = 'cargo_profile' then
    arr := coalesce(d->'commodities','[]'::jsonb);
    if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) = 0 then e := e || 'What you ship (pick at least one)'::text;
    else for x in select jsonb_array_elements_text(arr) loop if x <> all (com_ok) then e := e || ('Unknown commodity: ' || x); end if; end loop; end if;
    if arr ? 'other' and length(trim(coalesce(d->>'other_commodity',''))) < 3 then e := e || 'Describe "other" commodity'::text; end if;
    arr := coalesce(d->'equipment','[]'::jsonb);
    if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) = 0 then e := e || 'Equipment you need (pick at least one)'::text;
    else for x in select jsonb_array_elements_text(arr) loop if x <> all (eq_ok) then e := e || ('Unknown equipment: ' || x); end if; end loop; end if;
    v1 := nullif(d->>'typical_value','')::numeric; v2 := nullif(d->>'max_value','')::numeric;
    if v1 is null or v1 <= 0 then e := e || 'Typical cargo value per load'::text; end if;
    if v2 is null or v2 <= 0 then e := e || 'Maximum cargo value per load'::text; end if;
    if v1 is not null and v2 is not null and v2 < v1 then e := e || 'Maximum value cannot be lower than the typical value'::text; end if;
    -- consistency: never silently save a contradiction (MII: "Food Grade" on apparel)
    if coalesce((d->>'food_grade')::boolean, false)
       and not exists (select 1 from jsonb_array_elements_text(coalesce(d->'commodities','[]'::jsonb)) z where z like 'food%' or z in ('produce','meat_poultry_seafood','dairy','beverages','frozen_food','pharmaceuticals','agricultural','livestock_feed')) then
      c := c || 'You marked "food grade" but none of your commodities is food. Food-grade trailers cost more and fewer carriers have them — keep food grade?'::text; end if;
    if coalesce((d->>'hazmat')::boolean, false) and not (coalesce(d->'commodities','[]'::jsonb) ? 'hazmat') then
      c := c || 'You marked hazmat — add "hazmat" to your commodities so carriers see it. Continue?'::text; end if;
    if coalesce(d->'equipment','[]'::jsonb) ? 'reefer' and not coalesce((d->>'temp_controlled')::boolean, false) then
      c := c || 'You picked reefer but did not mark temperature-controlled freight. Continue?'::text; end if;
  elsif p_key = 'insurance_requirements' then
    v1 := nullif(d->>'min_cargo','')::numeric; v2 := nullif(d->>'min_auto_liability','')::numeric;
    if v1 is null or v1 < 0 then e := e || 'Minimum cargo insurance you require'::text; end if;
    if v2 is null then e := e || 'Minimum auto liability you require'::text;
    elsif v2 < 750000 then e := e || 'Auto liability cannot be below $750,000 — that is the federal minimum for general freight (49 CFR 387.9)'::text; end if;
    select nullif(data->>'max_value','')::numeric into v2 from app_private.org_onboarding_items where org_id = p_org and item_key = 'cargo_profile';
    if v1 is not null and v2 is not null and v1 < v2 then
      c := c || ('Your maximum load value ($' || to_char(v2,'FM999,999,999') || ') is higher than the cargo cover you require ($' || to_char(v1,'FM999,999,999') || '). A loss above the cover may not be paid — keep it?'); end if;
  elsif p_key = 'declared_value_policy' then
    if coalesce(d->>'policy','') not in ('full_value','released_value') then e := e || 'Full value or released value'::text; end if;
    if d->>'policy' = 'released_value' then
      if coalesce(nullif(d->>'released_amount','')::numeric, 0) <= 0 then e := e || 'Released value amount'::text; end if;
      if coalesce(d->>'released_basis','') not in ('per_lb','per_shipment') then e := e || 'Released value basis (per lb or per shipment)'::text; end if;
    end if;
  elsif p_key = 'claims_contact' then
    if length(trim(coalesce(d->>'name',''))) < 3 then e := e || 'Claims contact name'::text; end if;
    if not app_private.shipper_phone_ok(d->>'phone') then e := e || 'Claims phone (US, 10 digits)'::text; end if;
    if not app_private.shipper_email_ok(d->>'email') then e := e || 'Claims email'::text; end if;
  elsif p_key = 'hazmat' then
    if not app_private.shipper_phone_ok(d->>'emergency_phone') then e := e || '24-hour emergency response phone (49 CFR 172.604)'::text; end if;
    if length(trim(coalesce(d->>'emergency_contact',''))) < 3 then e := e || 'Emergency contact / service name'::text; end if;
    if coalesce(d->>'phmsa_status','') not in ('registered','not_required') then e := e || 'PHMSA registration status'::text; end if;
    if d->>'phmsa_status' = 'registered' and length(trim(coalesce(d->>'phmsa_number',''))) < 5 then e := e || 'PHMSA registration number'::text; end if;
    if not coalesce((d->>'shipping_papers_ack')::boolean, false) then e := e || 'Confirm you provide hazmat shipping papers with every load'::text; end if;
    if not coalesce((d->>'training_ack')::boolean, false) then e := e || 'Confirm your hazmat employees are trained (49 CFR 172.704)'::text; end if;
  elsif p_key = 'food_sanitary' then
    if length(trim(coalesce(d->>'temperature',''))) < 2 then e := e || 'Temperature requirement (or "ambient")'::text; end if;
    if d->>'precool' is null then e := e || 'Must the trailer be pre-cooled?'::text; end if;
    if length(trim(coalesce(d->>'cleaning',''))) < 5 then e := e || 'Trailer cleaning / washout requirement'::text; end if;
    if length(trim(coalesce(d->>'prior_cargo',''))) < 2 then e := e || 'Prior-cargo restrictions (or "none")'::text; end if;
    if not coalesce((d->>'written_ack')::boolean, false) then e := e || 'Confirm these requirements go to the carrier in writing with each load'::text; end if;
  elsif p_key = 'high_value' then
    if not coalesce((d->>'tracking_ack')::boolean, false) then e := e || 'Confirm live tracking is required on high-value loads'::text; end if;
    if coalesce(nullif(d->>'min_cargo_cover','')::numeric, 0) <= 0 then e := e || 'Cargo cover a carrier must carry for these loads'::text; end if;
  elsif p_key in ('ack_non_coercion','ack_accurate_declarations','ack_direct_choice') then
    if not coalesce((d->>'accepted')::boolean, false) then e := e || 'Tick the box to confirm'::text; end if;
  else
    e := e || ('This item is not a form: ' || p_key);
  end if;
  return jsonb_build_object('errors', to_jsonb(e), 'confirm', to_jsonb(c));
end $$;

-- ───────────────────────────── 7. shipper RPCs ─────────────────────────────
create or replace function app_private.my_shipper_org()
returns uuid language sql stable security definer set search_path = app_private, public as $$
  select om.org_id from public.organization_memberships om join public.organizations o on o.id = om.org_id
   where om.user_id = auth.uid() and om.status = 'active' and o.kind = 'shipper' order by om.created_at limit 1
$$;

create or replace function public.cc_shipper_onboarding()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid; t app_private.shipper_trust; cond jsonb; cfg app_private.shipper_config; items jsonb; v_open int;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  select * into t from app_private.shipper_trust where org_id = v_org;
  select * into cfg from app_private.shipper_config where id;
  cond := app_private.shipper_conditions(v_org);
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', tp.item_key, 'label', tp.label, 'section', tp.section, 'purpose', tp.purpose, 'type', tp.item_type,
      'required_for', to_jsonb(tp.required_for), 'condition', tp.condition,
      'active', tp.condition is null or coalesce((cond->>tp.condition)::boolean, false),
      'status', app_private.shipper_item_status(v_org, tp.item_key),
      'data', case when tp.item_type in ('form','ack') then i.data else null end,
      'file', i.file_path is not null, 'note', case when i.status = 'rejected' then i.note else null end,
      'submitted_at', i.submitted_at, 'reviewed_at', i.reviewed_at) order by tp.sort), '[]'::jsonb)
    into items
    from app_private.onboarding_packet_templates tp
    left join app_private.org_onboarding_items i on i.org_id = v_org and i.item_key = tp.item_key
   where tp.org_kind = 'shipper' and tp.item_type <> 'legacy';
  select count(*) into v_open from app_private.partner_loads pl where pl.broker_org = v_org and pl.status not in ('delivered','cancelled','canceled','expired','completed','closed');
  return jsonb_build_object(
    'org', v_org, 'stage', app_private.shipper_stage(v_org), 'items', items, 'conditions', cond,
    'direct', app_private.shipper_lane_gate(v_org, 'direct'), 'broker', app_private.shipper_lane_gate(v_org, 'broker'),
    'identity', app_private.shipper_lane_gate(v_org, 'identity'),
    'limits', jsonb_build_object('graduated', app_private.shipper_graduated(v_org), 'max_open_loads', cfg.new_max_open_loads,
       'max_cargo_value', cfg.new_max_cargo_value, 'graduate_paid_loads', cfg.graduate_paid_loads, 'open_loads', v_open,
       'paid_loads', (select count(distinct ref_id) from app_private.pay_transfers where payer_org = v_org and kind = 'freight' and status = 'received'),
       'high_value_threshold', cfg.high_value_threshold),
    'callback', jsonb_build_object('status', t.callback_status, 'at', t.callback_at),
    'business_check', jsonb_build_object('outcome', t.check_outcome, 'domain', t.domain, 'site_ok', t.site_ok, 'mx', t.mx));
end $$;

create or replace function public.cc_shipper_item_save(p_key text, p_data jsonb, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; tp app_private.onboarding_packet_templates; v jsonb; v_status text; v_name text;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  select * into tp from app_private.onboarding_packet_templates where org_kind = 'shipper' and item_key = p_key;
  if tp.item_key is null or tp.item_type not in ('form','ack') then raise exception 'this item cannot be saved as a form' using errcode = '22023'; end if;
  if (select status from app_private.org_onboarding_items where org_id = v_org and item_key = p_key) = 'verified' and not tp.auto_verify then
    raise exception '"%" is already verified. Contact hello@loadboot.com to change it — a change needs a fresh review.', tp.label using errcode = '22023'; end if;
  v := app_private.shipper_validate(v_org, p_key, p_data);
  if jsonb_array_length(v->'errors') > 0 then
    return jsonb_build_object('ok', false, 'errors', v->'errors');
  end if;
  if jsonb_array_length(v->'confirm') > 0 and not coalesce(p_confirm, false) then
    return jsonb_build_object('ok', false, 'confirm', v->'confirm');
  end if;
  v_status := case when tp.auto_verify then 'verified' else 'submitted' end;
  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, data, submitted_by, submitted_at, reviewed_at, reviewed_by)
  values (v_org, p_key, v_status, left(tp.label || ' — saved in portal', 200), p_data || jsonb_build_object('confirmed', coalesce(v->'confirm','[]'::jsonb)),
          auth.uid(), now(), case when tp.auto_verify then now() end, null)
  on conflict (org_id, item_key) do update set status = excluded.status, ref = excluded.ref, data = excluded.data,
    submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at, reviewed_at = excluded.reviewed_at,
    reviewed_by = null, note = null, lapsed_at = null;
  -- the entity name on the record wins over the signup name once staff verify it; keep the org name in step
  if p_key = 'legal_entity' then
    select name into v_name from public.organizations where id = v_org;
    if lower(trim(v_name)) is distinct from lower(trim(p_data->>'legal_name')) then
      perform app_private.log_audit('shipper.legal_name_differs', 'org', v_org::text, v_org, 'signup name "' || coalesce(v_name,'') || '" vs legal name "' || (p_data->>'legal_name') || '"', null);
    end if;
  end if;
  if v_status = 'submitted' then
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'onboarding.item_submitted', jsonb_build_object('title', 'Shipper verification item to review',
      'body', coalesce((select name from public.organizations where id = v_org),'A shipper') || ' submitted: ' || tp.label,
      'tone', 'action', 'url', '/app/command-center/#/shipper?id=' || v_org), 'sent', now());
  end if;
  perform app_private.log_audit('onboarding.item_saved', 'org', v_org::text, v_org, p_key || ' → ' || v_status, null);
  return jsonb_build_object('ok', true, 'status', v_status, 'stage', app_private.shipper_stage(v_org));
end $$;

create or replace function public.cc_shipper_agreement(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid; a app_private.master_agreements; s app_private.agreement_signatures;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  if p_kind not in ('shipper_platform','shipper_carrier') then raise exception 'unknown agreement' using errcode = '22023'; end if;
  select * into a from app_private.master_agreements where kind = p_kind and published and legal_approved order by version desc limit 1;
  if a.kind is null then
    return jsonb_build_object('available', false, 'message', 'This agreement is being finalised. It will appear here to sign as soon as it is published — we will let you know.');
  end if;
  select * into s from app_private.agreement_signatures where org_id = v_org and kind = p_kind and version = a.version order by signed_at desc limit 1;
  return jsonb_build_object('available', true, 'kind', a.kind, 'version', a.version, 'title', a.title, 'body_md', a.body_md,
    'body_sha256', encode(extensions.digest(a.body_md, 'sha256'), 'hex'),
    'signed', s.id is not null, 'signed_at', s.signed_at, 'signer_name', s.signer_name, 'signer_title', s.signer_title);
end $$;

create or replace function public.cc_shipper_agreement_sign(p_kind text, p_version int, p_body_sha256 text,
  p_signer_name text, p_signer_title text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; a app_private.master_agreements; v_hash text; v_hdr jsonb; v_key text; v_consent text;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  select * into a from app_private.master_agreements where kind = p_kind and version = p_version and published and legal_approved;
  if a.kind is null then raise exception 'This agreement version is not open for signing.' using errcode = '22023'; end if;
  if exists (select 1 from app_private.master_agreements where kind = p_kind and published and legal_approved and version > p_version) then
    raise exception 'A newer version was published — reload and sign that one.' using errcode = '22023'; end if;
  v_hash := encode(extensions.digest(a.body_md, 'sha256'), 'hex');
  if p_body_sha256 is distinct from v_hash then raise exception 'The agreement text changed while you were reading it — reload and sign again.' using errcode = '22023'; end if;
  if not coalesce(p_consent, false) then raise exception 'Tick the box to agree to sign electronically.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_signer_name,''))) < 4 or trim(p_signer_name) !~ '\s' then raise exception 'Type your full name (first and last) to sign.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_signer_title,''))) < 2 then raise exception 'Enter your title.' using errcode = '22023'; end if;
  v_consent := 'I agree to sign electronically, I have authority to bind ' || coalesce((select name from public.organizations where id = v_org),'the company')
            || ', and my typed name is my signature (ESIGN Act, 15 U.S.C. 7001).';
  begin v_hdr := current_setting('request.headers', true)::jsonb; exception when others then v_hdr := null; end;
  insert into app_private.agreement_signatures(org_id, kind, version, signer_user, signer_name, signer_title, consent_text, body_sha256, ip, user_agent)
  values (v_org, p_kind, p_version, auth.uid(), trim(p_signer_name), trim(p_signer_title), v_consent, v_hash,
          left(split_part(coalesce(v_hdr->>'x-forwarded-for', v_hdr->>'x-real-ip', ''), ',', 1), 64), left(v_hdr->>'user-agent', 300));
  insert into app_private.org_agreement_acceptances(org_id, kind, version, accepted_by, accepted_at)
  values (v_org, p_kind, p_version, auth.uid(), now()) on conflict (org_id, kind, version) do nothing;
  v_key := case p_kind when 'shipper_platform' then 'platform_terms' else 'shipper_carrier_terms' end;
  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, data, submitted_by, submitted_at, reviewed_at)
  values (v_org, v_key, 'verified', 'Signed online v' || p_version || ' by ' || trim(p_signer_name) || ', ' || trim(p_signer_title),
          jsonb_build_object('version', p_version, 'body_sha256', v_hash), auth.uid(), now(), now())
  on conflict (org_id, item_key) do update set status = 'verified', ref = excluded.ref, data = excluded.data,
    submitted_by = excluded.submitted_by, submitted_at = now(), reviewed_at = now(), note = null;
  perform app_private.log_audit('agreement.signed', 'org', v_org::text, v_org, p_kind || ' v' || p_version || ' signed by ' || trim(p_signer_name), null);
  return jsonb_build_object('ok', true, 'stage', app_private.shipper_stage(v_org));
end $$;

create or replace function public.cc_shipper_facilities()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(f) - 'org_id' - 'created_by' order by f.created_at)
                     from app_private.shipper_facilities f where f.org_id = v_org and f.archived_at is null), '[]'::jsonb);
end $$;

create or replace function public.cc_shipper_facility_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_id uuid; e text[] := '{}';
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  if length(trim(coalesce(p->>'name',''))) < 2 then e := e || 'Location name'::text; end if;
  if length(trim(coalesce(p->>'street',''))) < 4 then e := e || 'Street'::text; end if;
  if length(trim(coalesce(p->>'city',''))) < 2 then e := e || 'City'::text; end if;
  if not app_private.shipper_state_ok(p->>'state') then e := e || 'State'::text; end if;
  if coalesce(p->>'zip','') !~ '^\d{5}(-\d{4})?$' then e := e || 'ZIP'::text; end if;
  if length(trim(coalesce(p->>'dock_hours',''))) < 3 then e := e || 'Dock hours'::text; end if;
  if coalesce(p->>'appointment','') not in ('required','fcfs','either') then e := e || 'Appointment or first-come'::text; end if;
  if coalesce(p->>'load_type','') not in ('live','drop','either') then e := e || 'Live load or drop trailer'::text; end if;
  if coalesce(p->>'who_loads','') not in ('shipper_load_count','driver_assist','driver_load') then e := e || 'Who loads the freight'::text; end if;
  if coalesce(p->>'lumper','') not in ('none','shipper_pays','carrier_pays_reimbursed','receiver_pays') then e := e || 'Lumper policy'::text; end if;
  if nullif(p->>'detention_free_hours','') is null then e := e || 'Detention free time (hours)'::text; end if;
  if nullif(p->>'detention_rate','') is null then e := e || 'Detention rate ($/hour)'::text; end if;
  if length(trim(coalesce(p->>'site_contact_name',''))) < 2 then e := e || 'Site contact name'::text; end if;
  if not app_private.shipper_phone_ok(p->>'site_contact_phone') then e := e || 'Site contact phone'::text; end if;
  if cardinality(e) > 0 then return jsonb_build_object('ok', false, 'errors', to_jsonb(e)); end if;
  if nullif(p->>'id','') is not null then
    update app_private.shipper_facilities set name = trim(p->>'name'), kind = coalesce(nullif(p->>'kind',''),'both'),
      street = trim(p->>'street'), city = trim(p->>'city'), state = upper(p->>'state'), zip = p->>'zip',
      lat = nullif(p->>'lat','')::float8, lng = nullif(p->>'lng','')::float8, dock_hours = trim(p->>'dock_hours'),
      appointment = p->>'appointment', load_type = p->>'load_type', who_loads = p->>'who_loads', lumper = p->>'lumper',
      ppe = nullif(trim(coalesce(p->>'ppe','')),''), detention_free_hours = (p->>'detention_free_hours')::numeric,
      detention_rate = (p->>'detention_rate')::numeric, site_contact_name = trim(p->>'site_contact_name'),
      site_contact_phone = trim(p->>'site_contact_phone'), notes = nullif(trim(coalesce(p->>'notes','')),''), updated_at = now()
     where id = (p->>'id')::uuid and org_id = v_org and archived_at is null returning id into v_id;
    if v_id is null then raise exception 'location not found' using errcode = '42704'; end if;
  else
    insert into app_private.shipper_facilities(org_id, name, kind, street, city, state, zip, lat, lng, dock_hours, appointment, load_type,
      who_loads, lumper, ppe, detention_free_hours, detention_rate, site_contact_name, site_contact_phone, notes, created_by)
    values (v_org, trim(p->>'name'), coalesce(nullif(p->>'kind',''),'both'), trim(p->>'street'), trim(p->>'city'), upper(p->>'state'), p->>'zip',
      nullif(p->>'lat','')::float8, nullif(p->>'lng','')::float8, trim(p->>'dock_hours'), p->>'appointment', p->>'load_type', p->>'who_loads',
      p->>'lumper', nullif(trim(coalesce(p->>'ppe','')),''), (p->>'detention_free_hours')::numeric, (p->>'detention_rate')::numeric,
      trim(p->>'site_contact_name'), trim(p->>'site_contact_phone'), nullif(trim(coalesce(p->>'notes','')),''), auth.uid())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'stage', app_private.shipper_stage(v_org));
end $$;

create or replace function public.cc_shipper_facility_archive(p_id uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  update app_private.shipper_facilities set archived_at = now() where id = p_id and org_id = v_org and archived_at is null;
  return jsonb_build_object('ok', found);
end $$;

-- Signer phone: automated code call (same Retell verify agent brokers use), to the signer's direct line.
create or replace function public.cc_shipper_phone_code_send()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; d jsonb; v_phone text; v_code text; v_hash text; v_call bigint; n_day int; v_last timestamptz; cfg app_private.retell_config; v_company text;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  if app_private.shipper_item_status(v_org, 'phone_verify') = 'verified' then return jsonb_build_object('ok', true, 'already', true); end if;
  select data into d from app_private.org_onboarding_items where org_id = v_org and item_key = 'authorized_signer';
  if d is null then return jsonb_build_object('ok', false, 'why', 'Add the authorized signer first — we call the signer''s direct phone.'); end if;
  select * into cfg from app_private.retell_config where id = 1;
  if cfg.api_key is null or cfg.verify_agent_id is null then return jsonb_build_object('ok', false, 'why', 'Automated calls are not enabled on this environment yet — our team will confirm the phone by hand.'); end if;
  v_phone := app_private.shipper_digits(d->>'phone');
  if length(v_phone) = 11 and left(v_phone,1) = '1' then v_phone := substr(v_phone, 2); end if;
  if length(v_phone) <> 10 then return jsonb_build_object('ok', false, 'why', 'The signer phone is not a 10-digit US number.'); end if;
  v_phone := '+1' || v_phone;
  select count(*), max(created_at) into n_day, v_last from app_private.verify_codes where org_id = v_org and purpose = 'shipper_signer_phone' and created_at > now() - interval '24 hours';
  if v_last is not null and v_last > now() - interval '2 minutes' then return jsonb_build_object('ok', false, 'why', 'A call was placed less than 2 minutes ago — give it a moment to ring.'); end if;
  if n_day >= 3 then return jsonb_build_object('ok', false, 'why', 'Three calls in 24 hours is the limit. Try again tomorrow or contact hello@loadboot.com.'); end if;
  declare b bytea := extensions.gen_random_bytes(4); begin
    v_code := lpad(((get_byte(b,0)::bigint * 16777216 + get_byte(b,1) * 65536 + get_byte(b,2) * 256 + get_byte(b,3)) % 1000000)::text, 6, '0');
  end;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  select name into v_company from public.organizations where id = v_org;
  insert into app_private.lc_calls (direction, from_number, to_number, contact_name, topic, contact_role, context, status, requested_by, source, org_id)
  values ('outbound', cfg.from_number, v_phone, coalesce(d->>'name', v_company), 'verification', 'shipper',
          'Automated verification code call · shipper signer phone · ' || coalesce(v_company,''), 'requested', auth.uid(), 'verify', v_org)
  returning id into v_call;
  insert into app_private.verify_codes (org_id, purpose, channel, to_number, code_hash, call_id, expires_at, created_by)
  values (v_org, 'shipper_signer_phone', 'call', v_phone, v_hash, v_call, now() + interval '15 minutes', auth.uid());
  perform app_private.retell_dial_verify(v_call, jsonb_build_object('company', coalesce(v_company,''), 'mc', '',
    'purpose', 'the signer phone on a new LoadBoot shipper account for ' || coalesce(v_company,'your company'),
    'requester', coalesce(d->>'name',''), 'code', trim(regexp_replace(v_code, '(.)', '\1 ', 'g')),
    'script', 'This is LoadBoot. Someone is setting up a LoadBoot shipper account for ' || coalesce(v_company,'your company') || ' and gave this number as the signer''s direct line. If that is you, I will read a one-time code to type into the LoadBoot page. If you do not recognise this, simply hang up.'));
  perform app_private.log_audit('shipper.phone_code_call', 'org', v_org::text, v_org, 'signer code call to ' || app_private.mask_phone(v_phone), null);
  return jsonb_build_object('ok', true, 'to', app_private.mask_phone(v_phone), 'expires_at', now() + interval '15 minutes', 'calls_left', 3 - n_day - 1);
end $$;

-- One code box for both shipper phone purposes (signer line + independent call-back).
create or replace function public.cc_shipper_code_verify(p_code text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; vc app_private.verify_codes; v_code text; v_hash text; v_n int := 0; v_hit boolean := false; v_key text;
begin
  v_org := app_private.my_shipper_org();
  if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
  v_code := app_private.shipper_digits(p_code);
  if length(v_code) <> 6 then return jsonb_build_object('ok', false, 'why', 'Enter the 6-digit code.'); end if;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  for vc in select * from app_private.verify_codes where org_id = v_org and purpose in ('shipper_signer_phone','shipper_callback')
             and consumed_at is null and expires_at > now() and attempts < 5 order by created_at desc for update loop
    v_n := v_n + 1;
    if vc.code_hash = v_hash then v_hit := true; exit; end if;
  end loop;
  if v_n = 0 then return jsonb_build_object('ok', false, 'why', 'No live code for this account — ask for a new call. Codes last 15 minutes (call-back codes 24 hours).'); end if;
  if not v_hit then
    update app_private.verify_codes set attempts = attempts + 1 where org_id = v_org and purpose in ('shipper_signer_phone','shipper_callback')
       and consumed_at is null and expires_at > now() and attempts < 5;
    return jsonb_build_object('ok', false, 'why', 'That code does not match.');
  end if;
  update app_private.verify_codes set consumed_at = now() where id = vc.id;
  v_key := case vc.purpose when 'shipper_signer_phone' then 'phone_verify' else 'independent_callback' end;
  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, data, submitted_by, submitted_at, reviewed_at)
  values (v_org, v_key, 'verified', 'Code read by automated call to ' || app_private.mask_phone(vc.to_number) || ' matched',
          jsonb_build_object('to', app_private.mask_phone(vc.to_number), 'purpose', vc.purpose), auth.uid(), now(), now())
  on conflict (org_id, item_key) do update set status = 'verified', ref = excluded.ref, data = excluded.data, submitted_at = now(), reviewed_at = now(), note = null;
  if vc.purpose = 'shipper_callback' then
    update app_private.shipper_trust set callback_status = 'confirmed', callback_at = now(), updated_at = now() where org_id = v_org;
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','shipper.callback_confirmed', jsonb_build_object('title', '🟢 Shipper call-back confirmed — ' || coalesce((select name from public.organizations where id = v_org),'?'),
      'body', 'The code read to the independently sourced number ' || app_private.mask_phone(vc.to_number) || ' matched.', 'tone', 'info',
      'url', '/app/command-center/#/shipper?id=' || v_org, 'org_id', v_org), 'sent', now());
  end if;
  perform app_private.log_audit('shipper.code_ok', 'org', v_org::text, v_org, vc.purpose || ' confirmed via ' || app_private.mask_phone(vc.to_number), null);
  return jsonb_build_object('ok', true, 'item', v_key, 'stage', app_private.shipper_stage(v_org));
end $$;

-- ───────────────────────────── 8. staff RPCs ─────────────────────────────
-- Independent call-back: staff paste a number THEY found and where they found it; the system calls it and
-- reads a code the shipper must type. The number typed at signup is refused.
create or replace function public.cc_shipper_callback_start(p_org uuid, p_phone text, p_source text, p_source_url text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_phone text; v_code text; v_hash text; v_call bigint; cfg app_private.retell_config; v_company text; d jsonb; v_signup text;
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'shipper') then raise exception 'not a shipper' using errcode = '22023'; end if;
  if coalesce(p_source,'') not in ('secretary_of_state','company_website','google_business','sec_edgar','bbb','dnb','other_public') then
    raise exception 'say where the number came from (secretary_of_state, company_website, google_business, sec_edgar, bbb, dnb, other_public)' using errcode = '22023'; end if;
  if p_source = 'other_public' and coalesce(trim(p_source_url),'') = '' then raise exception 'give the link where you found the number' using errcode = '22023'; end if;
  v_phone := app_private.shipper_digits(p_phone);
  if length(v_phone) = 11 and left(v_phone,1) = '1' then v_phone := substr(v_phone, 2); end if;
  if length(v_phone) <> 10 then raise exception 'use a 10-digit US number' using errcode = '22023'; end if;
  -- refuse any number the shipper itself typed anywhere in onboarding or profile
  for d in select data from app_private.org_onboarding_items where org_id = p_org and data is not null loop
    if v_phone in (right(app_private.shipper_digits(d->>'phone'),10), right(app_private.shipper_digits(d->>'emergency_phone'),10)) then
      raise exception 'That number was typed by the shipper during signup. An independent call-back must use a number you found yourself.' using errcode = '22023'; end if;
  end loop;
  select right(app_private.shipper_digits(phone),10) into v_signup from app_private.partner_profiles where org_id = p_org;
  if v_signup = v_phone then raise exception 'That number is the one on the shipper''s profile. Find the company''s number yourself (registry, website, listing).' using errcode = '22023'; end if;
  select * into cfg from app_private.retell_config where id = 1;
  if cfg.api_key is null or cfg.verify_agent_id is null then raise exception 'Automated calls are not enabled on this environment.' using errcode = '22023'; end if;
  v_phone := '+1' || v_phone;
  declare b bytea := extensions.gen_random_bytes(4); begin
    v_code := lpad(((get_byte(b,0)::bigint * 16777216 + get_byte(b,1) * 65536 + get_byte(b,2) * 256 + get_byte(b,3)) % 1000000)::text, 6, '0');
  end;
  v_hash := encode(extensions.digest(v_code || ':' || p_org::text, 'sha256'), 'hex');
  select name into v_company from public.organizations where id = p_org;
  update app_private.verify_codes set expires_at = now() where org_id = p_org and purpose = 'shipper_callback' and consumed_at is null and expires_at > now();
  insert into app_private.lc_calls (direction, from_number, to_number, contact_name, topic, contact_role, context, status, requested_by, source, org_id)
  values ('outbound', cfg.from_number, v_phone, v_company, 'verification', 'shipper',
          'Independent call-back · number from ' || p_source || coalesce(' · ' || p_source_url, ''), 'requested', auth.uid(), 'verify', p_org)
  returning id into v_call;
  insert into app_private.verify_codes (org_id, purpose, channel, to_number, code_hash, call_id, expires_at, created_by)
  values (p_org, 'shipper_callback', 'call', v_phone, v_hash, v_call, now() + interval '24 hours', auth.uid());
  perform app_private.retell_dial_verify(v_call, jsonb_build_object('company', coalesce(v_company,''), 'mc', '',
    'purpose', 'a new LoadBoot shipper account in the name of ' || coalesce(v_company,'your company'),
    'requester', '', 'code', trim(regexp_replace(v_code, '(.)', '\1 ', 'g')),
    'script', 'This is LoadBoot, a freight software company. Someone opened a shipper account in the name of ' || coalesce(v_company,'your company')
      || '. We are calling the company''s publicly listed number to confirm it is genuine. If your company opened this account, please pass this one-time code to the person who set it up. If you do not know about it, please hang up — without the code the account cannot send freight to carriers.'));
  update app_private.shipper_trust set callback_status = 'calling', callback_phone = v_phone, callback_source = p_source,
    callback_source_url = nullif(trim(coalesce(p_source_url,'')),''), callback_by = auth.uid(), callback_at = now(), updated_at = now()
   where org_id = p_org;
  perform app_private.notify_partner(p_org, 'We are calling your company to confirm the account',
    'As a fraud check we call your company on its publicly listed number (not the one typed at signup). Whoever answers gets a one-time code — enter it under Onboarding → Identity. The code works for 24 hours.', 'info', '/app/partner/#onboarding');
  perform app_private.log_audit('shipper.callback_started', 'org', p_org::text, p_org, 'call-back to ' || app_private.mask_phone(v_phone) || ' (source: ' || p_source || ')', null);
  return jsonb_build_object('ok', true, 'to', app_private.mask_phone(v_phone));
end $$;

-- A call-back that proved the company did NOT open the account → hold (carriers and brokers never see it).
create or replace function public.cc_shipper_callback_fail(p_org uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'write what the company said' using errcode = '22023'; end if;
  update app_private.shipper_trust set callback_status = 'failed', hold_reason = coalesce(hold_reason, 'independent call-back: ' || trim(p_note)),
    held_at = coalesce(held_at, now()), callback_by = auth.uid(), callback_at = now(), updated_at = now() where org_id = p_org;
  if not found then raise exception 'no trust record for this shipper' using errcode = '42704'; end if;
  perform app_private.log_audit('shipper.callback_failed', 'org', p_org::text, p_org, trim(p_note), null);
  return jsonb_build_object('ok', true, 'tier', app_private.shipper_tier(p_org));
end $$;

create or replace function public.cc_shipper_limits_lift(p_org uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('partners.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'a written reason is required' using errcode = '22023'; end if;
  insert into app_private.shipper_trust(org_id, limits_lifted_at, limits_lifted_by) values (p_org, now(), auth.uid())
  on conflict (org_id) do update set limits_lifted_at = now(), limits_lifted_by = auth.uid(), updated_at = now();
  perform app_private.log_audit('shipper.limits_lifted', 'org', p_org::text, p_org, trim(p_reason), null);
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────── 9. ACL ─────────────────────────────
do $$ declare f text; begin
  foreach f in array array[
    'public.cc_shipper_onboarding()', 'public.cc_shipper_item_save(text,jsonb,boolean)', 'public.cc_shipper_agreement(text)',
    'public.cc_shipper_agreement_sign(text,int,text,text,text,boolean)', 'public.cc_shipper_facilities()',
    'public.cc_shipper_facility_save(jsonb)', 'public.cc_shipper_facility_archive(uuid)', 'public.cc_shipper_phone_code_send()',
    'public.cc_shipper_code_verify(text)', 'public.cc_shipper_callback_start(uuid,text,text,text)',
    'public.cc_shipper_callback_fail(uuid,text)', 'public.cc_shipper_limits_lift(uuid,text)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array[
    'app_private.shipper_conditions(uuid)', 'app_private.shipper_item_status(uuid,text)', 'app_private.shipper_lane_gate(uuid,text)',
    'app_private.shipper_graduated(uuid)', 'app_private.shipper_stage(uuid)', 'app_private.assert_shipper_lane(uuid,text,jsonb)',
    'app_private.shipper_validate(uuid,text,jsonb)', 'app_private.my_shipper_org()', 'app_private.shipper_trust_risk()'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
  end loop;
end $$;
