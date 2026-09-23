-- ============================================================================
-- bl_inv_0403 — Investor module, round 3: enterprise pieces.
--   • SETTINGS      — payment instructions (where to send money), FX display
--                     rate, owner forecast. Editable in CC, readable by investors.
--   • PROOFS        — private storage bucket 'investor-proofs'; the investor
--                     uploads a bank slip against their own agreement folder,
--                     staff read it. Nothing public.
--   • E-SIGN        — versioned agreement documents (markdown + sha256), signed
--                     inside the portal by the investor, countersigned in CC.
--                     A signature binds to the exact document hash.
--   • GROWTH        — aggregate business progress an investor may see: counts
--                     only, never names or contact details.
--   • PROJECTION    — recovery estimate from actual published months (trailing
--                     average) + the owner's stated forecast, each labelled.
-- Additive only.
-- ============================================================================

create table if not exists app_private.inv_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table app_private.inv_settings enable row level security;
alter table app_private.inv_settings force row level security;
revoke all on app_private.inv_settings from anon, authenticated;

create table if not exists app_private.inv_agreement_docs (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references app_private.inv_agreements(id) on delete cascade,
  version       int  not null,
  lang          text not null default 'en',
  title         text not null,
  body_md       text not null,
  body_hash     text not null,                 -- sha256 hex of body_md
  status        text not null default 'published' check (status in ('draft','published','superseded')),
  published_at  timestamptz not null default now(),
  published_by  uuid,
  unique (agreement_id, version)
);
create index if not exists inv_docs_agr_idx on app_private.inv_agreement_docs(agreement_id, status);
alter table app_private.inv_agreement_docs enable row level security;
alter table app_private.inv_agreement_docs force row level security;
revoke all on app_private.inv_agreement_docs from anon, authenticated;

create table if not exists app_private.inv_signatures (
  id            uuid primary key default gen_random_uuid(),
  doc_id        uuid not null references app_private.inv_agreement_docs(id) on delete cascade,
  party         text not null check (party in ('investor','company')),
  signer_name   text not null,
  signer_title  text,
  user_id       uuid,
  body_hash     text not null,                 -- what they saw, byte-for-byte
  signature_png text,                          -- data URL of the drawn signature (optional)
  consent_text  text not null,
  ip            text,
  user_agent    text,
  signed_at     timestamptz not null default now(),
  unique (doc_id, party)
);
alter table app_private.inv_signatures enable row level security;
alter table app_private.inv_signatures force row level security;
revoke all on app_private.inv_signatures from anon, authenticated;

-- ───────────────────────────────────────── storage: private proofs bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('investor-proofs', 'investor-proofs', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Path convention: <agreement_id>/<anything>. The first folder IS the agreement.
create or replace function app_private.inv_can_touch_path(p_name text)
returns boolean language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare v_agr uuid;
begin
  begin v_agr := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  if app_private.inv_is_staff() then return true; end if;
  return exists (select 1 from app_private.inv_agreements a
                  where a.id = v_agr and a.investor_id = app_private.inv_my_investor());
end $$;

drop policy if exists inv_proofs_select on storage.objects;
drop policy if exists inv_proofs_insert on storage.objects;
create policy inv_proofs_select on storage.objects for select to authenticated
  using (bucket_id = 'investor-proofs' and app_private.inv_can_touch_path(name));
create policy inv_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'investor-proofs' and app_private.inv_can_touch_path(name));
-- No update/delete for anyone through the API: a proof, once uploaded, stays.

-- ───────────────────────────────────────── settings
create or replace function public.cc_inv_settings_get()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_is_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from app_private.inv_settings);
end $$;

create or replace function public.cc_inv_settings_set(p_key text, p_value jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_key not in ('payment_instructions','fx','forecast','vendors') then
    raise exception 'unknown setting' using errcode='22023'; end if;
  insert into app_private.inv_settings (key, value, updated_by) values (p_key, coalesce(p_value,'{}'::jsonb), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform app_private.log_audit('investor.setting_saved','investor', p_key, null, 'Investor setting saved', p_value);
  return jsonb_build_object('ok', true);
end $$;

-- What an investor may read from settings: where to pay, FX display, owner forecast.
create or replace function public.inv_settings()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
begin
  if app_private.inv_my_investor() is null and not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'payment_instructions', (select value from app_private.inv_settings where key = 'payment_instructions'),
    'fx',       (select value from app_private.inv_settings where key = 'fx'),
    'forecast', (select value from app_private.inv_settings where key = 'forecast'));
end $$;

-- ───────────────────────────────────────── e-sign
create or replace function public.cc_inv_publish_doc(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare v_agr uuid; v_ver int; v_id uuid; v_hash text; v_body text;
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  v_agr := (p->>'agreement_id')::uuid; v_body := p->>'body_md';
  if coalesce(btrim(v_body),'') = '' then raise exception 'document body is empty' using errcode='22023'; end if;
  v_hash := encode(extensions.digest(convert_to(v_body, 'UTF8'), 'sha256'), 'hex');
  update app_private.inv_agreement_docs set status = 'superseded' where agreement_id = v_agr and status = 'published';
  select coalesce(max(version),0) + 1 into v_ver from app_private.inv_agreement_docs where agreement_id = v_agr;
  insert into app_private.inv_agreement_docs (agreement_id, version, lang, title, body_md, body_hash, published_by)
  values (v_agr, v_ver, coalesce(nullif(p->>'lang',''),'en'), coalesce(nullif(p->>'title',''),'Investment Agreement'), v_body, v_hash, auth.uid())
  returning id into v_id;
  perform app_private.log_audit('investor.doc_published','investor', v_id::text, null,
    'Agreement document published', jsonb_build_object('agreement', v_agr, 'version', v_ver, 'hash', v_hash));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_ver, 'hash', v_hash);
end $$;

-- Current published document + its signatures, for either side.
create or replace function public.inv_current_doc(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare d app_private.inv_agreement_docs; v_sigs jsonb;
begin
  perform app_private.inv_guard(p_agreement);
  select * into d from app_private.inv_agreement_docs where agreement_id = p_agreement and status = 'published'
   order by version desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'doc', null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('party', s.party, 'signer_name', s.signer_name, 'signer_title', s.signer_title,
           'signed_at', s.signed_at, 'has_image', s.signature_png is not null, 'hash_matches', s.body_hash = d.body_hash)
           order by s.signed_at), '[]'::jsonb) into v_sigs from app_private.inv_signatures s where s.doc_id = d.id;
  return jsonb_build_object('ok', true, 'doc', jsonb_build_object('id', d.id, 'version', d.version, 'lang', d.lang,
    'title', d.title, 'body_md', d.body_md, 'hash', d.body_hash, 'published_at', d.published_at, 'signatures', v_sigs,
    'fully_signed', (select count(*) = 2 from app_private.inv_signatures s where s.doc_id = d.id)));
end $$;

create or replace function app_private.inv_sign(p_doc uuid, p_party text, p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare d app_private.inv_agreement_docs; v_id uuid; v_both boolean;
begin
  select * into d from app_private.inv_agreement_docs where id = p_doc;
  if not found or d.status <> 'published' then raise exception 'that document is not the current version' using errcode='22023'; end if;
  if coalesce(btrim(p->>'signer_name'),'') = '' then raise exception 'type your full name to sign' using errcode='22023'; end if;
  if (p->>'hash') is distinct from d.body_hash then
    raise exception 'the document changed while you were reading it — reload and read it again' using errcode='22023'; end if;
  if coalesce((p->>'consent')::boolean, false) is not true then raise exception 'consent box not ticked' using errcode='22023'; end if;
  insert into app_private.inv_signatures (doc_id, party, signer_name, signer_title, user_id, body_hash, signature_png, consent_text, ip, user_agent)
  values (p_doc, p_party, btrim(p->>'signer_name'), nullif(p->>'signer_title',''), auth.uid(), d.body_hash,
          nullif(p->>'signature_png',''), coalesce(nullif(p->>'consent_text',''), 'I have read this agreement and sign it electronically.'),
          nullif(p->>'ip',''), nullif(p->>'user_agent',''))
  on conflict (doc_id, party) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'already signed by this party' using errcode='22023'; end if;
  select count(*) = 2 into v_both from app_private.inv_signatures where doc_id = p_doc;
  if v_both then
    update app_private.inv_agreements set signed_date = coalesce(signed_date, current_date) where id = d.agreement_id;
  end if;
  perform app_private.log_audit('investor.doc_signed','investor', v_id::text, null,
    'Agreement signed (' || p_party || ')', jsonb_build_object('doc', p_doc, 'hash', d.body_hash, 'fully_signed', v_both));
  return jsonb_build_object('ok', true, 'id', v_id, 'fully_signed', v_both);
end $$;

create or replace function public.inv_sign_doc(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
declare d app_private.inv_agreement_docs; a app_private.inv_agreements;
begin
  select * into d from app_private.inv_agreement_docs where id = (p->>'doc_id')::uuid;
  if not found then raise exception 'document not found' using errcode='42704'; end if;
  a := app_private.inv_guard(d.agreement_id);
  if app_private.inv_my_investor() is distinct from a.investor_id then
    raise exception 'only the investor can sign here' using errcode='42501'; end if;
  return app_private.inv_sign(d.id, 'investor', p);
end $$;

create or replace function public.cc_inv_countersign(p jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  return app_private.inv_sign((p->>'doc_id')::uuid, 'company', p);
end $$;

-- ───────────────────────────────────────── growth (aggregates only)
create or replace function public.inv_growth()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare r jsonb := '{}'::jsonb;
begin
  if app_private.inv_my_investor() is null and not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  r := r || jsonb_build_object(
    'carriers_total',    (select count(*) from public.organizations where kind = 'carrier'),
    'carriers_active',   (select count(*) from public.organizations where kind = 'carrier' and status = 'active'),
    'carriers_approved', (select count(*) from app_private.carrier_onboarding where stage = 'approved'),
    'carriers_in_review',(select count(*) from app_private.carrier_onboarding where stage in ('submitted','docs_review','compliance_check')),
    'brokers_total',     (select count(*) from public.organizations where kind = 'broker'),
    'shippers_total',    (select count(*) from public.organizations where kind = 'shipper'),
    'trucks_active',     (select count(*) from app_private.fleet_trucks where status = 'active'),
    'dispatcher_assignments_active', (select count(*) from app_private.dispatcher_assignments where status = 'active'),
    'loads_available',   (select count(*) from public.loads where status = 'available'),
    'loads_booked',      (select count(*) from public.loads where status in ('booked','in_transit')),
    'loads_delivered',   (select count(*) from public.loads where status = 'delivered'),
    'trips_in_transit',  (select count(*) from app_private.trips where status = 'in_transit'),
    'trips_delivered',   (select count(*) from app_private.trips where status in ('delivered','invoiced')),
    'trips_delivered_30d', (select count(*) from app_private.trips where status in ('delivered','invoiced') and delivered_at >= now() - interval '30 days'),
    'fees_collected_total', (select coalesce(sum(fee),0) from app_private.fin_invoices where status = 'paid'),
    'fees_collected_30d',   (select coalesce(sum(fee),0) from app_private.fin_invoices where status = 'paid' and created_at >= now() - interval '30 days'),
    'fees_outstanding',     (select coalesce(sum(fee),0) from app_private.fin_invoices where status = 'sent'),
    'carriers_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m), '[]'::jsonb) from (
        select date_trunc('month', created_at)::date as m, count(*) as n from public.organizations
         where kind = 'carrier' and created_at >= date_trunc('month', now()) - interval '5 months' group by 1) z),
    'trips_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m), '[]'::jsonb) from (
        select date_trunc('month', coalesce(delivered_at, created_at))::date as m, count(*) as n from app_private.trips
         where status in ('delivered','invoiced') and coalesce(delivered_at, created_at) >= date_trunc('month', now()) - interval '5 months' group by 1) z),
    'as_of', now());
  return r;
end $$;

-- ───────────────────────────────────────── projection
create or replace function public.inv_projection(p_agreement uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
declare a app_private.inv_agreements; pos jsonb; v_avg numeric; v_n int; v_pay numeric; v_months numeric; f jsonb;
begin
  a := app_private.inv_guard(p_agreement);
  pos := app_private.inv_position(p_agreement);
  select avg(profit), count(*) into v_avg, v_n from (
    select profit from app_private.inv_statements where status = 'published'
       and period_month >= date_trunc('month', a.created_at)::date order by period_month desc limit 3) z;
  f := (select value from app_private.inv_settings where key = 'forecast');
  if coalesce(v_n,0) >= 2 and coalesce(v_avg,0) > 0 then
    v_pay := round(v_avg * a.payback_rate_pct / 100, 2);
    v_months := case when v_pay > 0 then ceil((pos->>'outstanding')::numeric / v_pay) else null end;
    return jsonb_build_object('source', 'actual', 'months_used', v_n, 'avg_monthly_profit', round(v_avg,2),
      'est_monthly_payback', v_pay, 'est_monthly_share', round(v_avg * (pos->>'effective_share_pct')::numeric / 100, 2),
      'months_to_recovery', v_months, 'forecast', f);
  end if;
  return jsonb_build_object('source', 'owner_forecast', 'months_used', coalesce(v_n,0), 'forecast', f,
    'est_monthly_payback', case when f ? 'expected_monthly_profit' then round((f->>'expected_monthly_profit')::numeric * a.payback_rate_pct / 100, 2) end,
    'months_to_recovery', case when f ? 'expected_monthly_profit' and (f->>'expected_monthly_profit')::numeric > 0
      then ceil((pos->>'outstanding')::numeric / ((f->>'expected_monthly_profit')::numeric * a.payback_rate_pct / 100)) end);
end $$;

-- signed_document is no longer an open question once both parties have signed the current doc
create or replace function app_private.inv_doc_signed(p_agreement uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $$
  select exists (select 1 from app_private.inv_agreement_docs d
                  where d.agreement_id = p_agreement and d.status = 'published'
                    and (select count(*) from app_private.inv_signatures s where s.doc_id = d.id) = 2);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.cc_inv_settings_get()', 'public.cc_inv_settings_set(text,jsonb)', 'public.inv_settings()',
    'public.cc_inv_publish_doc(jsonb)', 'public.inv_current_doc(uuid)', 'public.inv_sign_doc(jsonb)',
    'public.cc_inv_countersign(jsonb)', 'public.inv_growth()', 'public.inv_projection(uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
