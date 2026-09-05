-- bl_bp_0319 — Shippers: request quotes in minutes on an automated BUSINESS check; the packet comes later.
--
-- Yaseen, 4 Sep: "jaise broker se pehle bahut kuch maang rahe the, shipper ka bhi yahi ho raha hai". Before this a
-- shipper had to submit 8 documents and wait for staff before a single quote request. A shipper has no FMCSA
-- authority to read live, so the identity signal is the COMPANY EMAIL DOMAIN — the same thing Uber Freight /
-- Loadsmart / Convoy key on at signup:
--   • signup email on a company domain (free-mail never counts) + that domain receives mail (MX) → business verified
--   • website on the domain (title captured, company-name words matched) → shown to brokers as a bonus signal
--   • signed up with Gmail? enter the company address → we email it a 6-digit code (same verify_codes machinery)
--   • private fleet with a USDOT? screen it on FMCSA (existing pipeline) — optional, adds the legal name
-- Rule: business-verified shippers post SHIPMENT REQUESTS (quotes are non-binding) immediately; the packet is cut to
-- three things the platform cannot read (Shipper Agreement · claims contact · billing instructions); payment terms /
-- credit application become "before your first booking" items (payment rail is a separate decision); cargo profile,
-- facility rules and insurance requirements are captured on every shipment form, not as documents.
-- Edge function `domain-check` (supabase/functions/domain-check) does MX + website; pg_net + the collector cron read it.

-- ---------------------------------------------------------------------------
-- 0. table
-- ---------------------------------------------------------------------------
create table if not exists app_private.shipper_trust (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  domain            text,
  free_mail         boolean,
  company_email     text,
  email_verified_at timestamptz,
  request_id        bigint,
  requested_at      timestamptz,
  check_outcome     text,            -- pending | pass | no_mail | free_mail | error
  check_reason      text,
  mx                boolean,
  site_ok           boolean,
  site_title        text,
  site_url          text,
  name_match        boolean,
  checked_at        timestamptz,
  attempts          int not null default 0,
  dot_number        text,
  verified_at       timestamptz,
  verified_by       text,
  hold_reason       text,
  held_at           timestamptz,
  updated_at        timestamptz not null default now()
);
-- verify_codes.purpose CHECK (0314) gains the shipper purpose
alter table app_private.verify_codes drop constraint if exists verify_codes_purpose_check;
alter table app_private.verify_codes add constraint verify_codes_purpose_check check (purpose in ('identity','parent','shipper_email'));
create index if not exists shipper_trust_pending_idx on app_private.shipper_trust(requested_at) where request_id is not null;

-- packet: three real items; payment items wait for the first booking; profile items live on the shipment form
update app_private.onboarding_packet_templates set status_tag = 'conditional' where org_kind = 'shipper' and item_key in ('payment_terms','credit_application') and status_tag <> 'conditional';
update app_private.onboarding_packet_templates set status_tag = 'optional' where org_kind = 'shipper' and item_key in ('cargo_profile','facility_rules','insurance_requirements') and status_tag <> 'optional';
update app_private.onboarding_packet_templates set label = 'Payment terms (Net 15/30/45) — before your first booking' where org_kind = 'shipper' and item_key = 'payment_terms';
update app_private.onboarding_packet_templates set label = 'Credit application — before your first booking' where org_kind = 'shipper' and item_key = 'credit_application';

-- ---------------------------------------------------------------------------
-- 1. helpers
-- ---------------------------------------------------------------------------
create or replace function app_private.free_mail_domain(p_domain text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_domain,'')) in ('gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','live.com','msn.com','protonmail.com','proton.me','ymail.com','me.com','comcast.net','att.net','sbcglobal.net','verizon.net','mail.com','zoho.com','gmx.com','yandex.com','googlemail.com');
$$;

create or replace function app_private.shipper_tier(p_org uuid)
returns text language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare t app_private.shipper_trust;
begin
  select * into t from app_private.shipper_trust where org_id = p_org;
  if t.org_id is not null and t.hold_reason is not null then return 'hold'; end if;
  if app_private.org_onboarding_complete(p_org) then return 'verified'; end if;
  if t.verified_at is not null then return 'business_verified'; end if;
  return 'new';
end $$;

create or replace function app_private.shipper_can_post(p_org uuid)
returns table(ok boolean, tier text, reason text) language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare t app_private.shipper_trust; v_tier text;
begin
  v_tier := app_private.shipper_tier(p_org);
  select * into t from app_private.shipper_trust where org_id = p_org;
  tier := v_tier; ok := false; reason := null;
  if v_tier in ('verified','business_verified') then ok := true;
  elsif v_tier = 'hold' then reason := 'Posting is on hold: ' || coalesce(t.hold_reason, 'contact support');
  elsif t.org_id is null or t.check_outcome is null then reason := 'We are confirming your business from your company email — usually under a minute.';
  elsif t.check_outcome = 'pending' then reason := 'Business check running — usually under a minute.';
  elsif t.check_outcome = 'free_mail' then reason := 'Add your company email address (not Gmail/Yahoo) — we send it a 6-digit code and you are verified the moment it matches.';
  elsif t.check_outcome = 'no_mail' then reason := 'The domain ' || coalesce(t.domain,'?') || ' does not receive email, so we could not confirm the business. Use an address on your company''s real domain.';
  else reason := coalesce(t.check_reason, 'Business check did not complete — try again or contact hello@loadboot.com.');
  end if;
  return next;
end $$;

create or replace function app_private.assert_shipper_can_post(p_org uuid)
returns void language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare r record;
begin
  select * into r from app_private.shipper_can_post(p_org);
  if not r.ok then raise exception '%', coalesce(r.reason, 'posting is not available for this account yet') using errcode = '42501'; end if;
end $$;

create or replace function app_private.shipper_badge(p_org uuid)
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select jsonb_build_object('tier', app_private.shipper_tier(p_org), 'domain', t.domain, 'site_title', t.site_title, 'site_url', t.site_url, 'site_ok', t.site_ok,
                            'verified_at', t.verified_at, 'verified_by', t.verified_by, 'company', o.name)
    from public.organizations o left join app_private.shipper_trust t on t.org_id = o.id where o.id = p_org;
$$;

-- ---------------------------------------------------------------------------
-- 2. the check: request (pg_net → domain-check) and collect (cron)
-- ---------------------------------------------------------------------------
create or replace function app_private.shipper_business_start(p_org uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare cfg record; t app_private.shipper_trust; v_email text; v_domain text; v_req bigint; v_company text; v_url text;
begin
  select * into t from app_private.shipper_trust where org_id = p_org;
  select o.name, lower(u.email) into v_company, v_email from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = p_org;
  if t.email_verified_at is not null and t.company_email is not null then v_email := t.company_email; end if;
  v_domain := lower(split_part(coalesce(v_email,''), '@', 2));
  insert into app_private.shipper_trust(org_id, domain, free_mail) values (p_org, nullif(v_domain,''), app_private.free_mail_domain(v_domain))
  on conflict (org_id) do update set domain = nullif(v_domain,''), free_mail = app_private.free_mail_domain(v_domain), updated_at = now()
  returning * into t;
  if t.verified_at is not null then return jsonb_build_object('queued', false, 'outcome', 'pass', 'already', true); end if;
  if t.request_id is not null and t.requested_at > now() - interval '2 minutes' then return jsonb_build_object('queued', false, 'outcome', 'pending'); end if;
  if v_domain = '' or app_private.free_mail_domain(v_domain) then
    update app_private.shipper_trust set check_outcome = 'free_mail', check_reason = 'signed up with a personal email address', checked_at = now(), request_id = null, updated_at = now() where org_id = p_org;
    return jsonb_build_object('queued', false, 'outcome', 'free_mail');
  end if;
  select * into cfg from app_private.fmcsa_config where id;
  if not found or not cfg.enabled then
    update app_private.shipper_trust set check_outcome = 'error', check_reason = 'business check is not configured on this environment', checked_at = now(), updated_at = now() where org_id = p_org;
    return jsonb_build_object('queued', false, 'outcome', 'error');
  end if;
  v_url := replace(cfg.function_url, 'fmcsa-verify', 'domain-check');
  select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || cfg.auth_key),
                       body := jsonb_build_object('domain', v_domain, 'company', v_company), timeout_milliseconds := 30000) into v_req;
  update app_private.shipper_trust set request_id = v_req, requested_at = now(), check_outcome = 'pending', check_reason = null, attempts = attempts + 1, updated_at = now() where org_id = p_org;
  return jsonb_build_object('queued', true, 'outcome', 'pending');
end $$;

create or replace function app_private.shipper_check_collect()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare r record; resp record; body jsonb; v_read int := 0; v_pass int := 0; v_out text; v_reason text; v_name text; v_by text;
begin
  for r in select * from app_private.shipper_trust where request_id is not null and requested_at < now() - interval '5 seconds' loop
    select id, status_code, content into resp from net._http_response where id = r.request_id;
    if not found then
      if r.requested_at < now() - interval '10 minutes' then
        update app_private.shipper_trust set request_id = null, checked_at = now(), check_outcome = 'error', check_reason = 'No answer from the business check within 10 minutes.', updated_at = now() where org_id = r.org_id;
      end if;
      continue;
    end if;
    v_read := v_read + 1;
    begin body := resp.content::jsonb; exception when others then body := null; end;
    select name into v_name from public.organizations where id = r.org_id;
    if resp.status_code is null or resp.status_code >= 400 or body is null or coalesce(body->>'ok','') <> 'true' then
      v_out := 'error'; v_reason := left(coalesce(body->>'error', 'HTTP ' || coalesce(resp.status_code::text,'?')), 300);
      update app_private.shipper_trust set request_id = null, checked_at = now(), check_outcome = v_out, check_reason = v_reason, updated_at = now() where org_id = r.org_id;
      continue;
    end if;
    if coalesce((body->>'free_mail')::boolean, false) then v_out := 'free_mail'; v_reason := 'personal email domain';
    elsif not coalesce((body->>'mx')::boolean, false) then v_out := 'no_mail'; v_reason := 'domain ' || coalesce(body->>'domain','?') || ' has no mail (MX) records';
    else v_out := 'pass'; v_reason := null; end if;
    update app_private.shipper_trust
       set request_id = null, checked_at = now(), check_outcome = v_out, check_reason = v_reason,
           mx = coalesce((body->>'mx')::boolean, false), site_ok = coalesce((body->'site'->>'ok')::boolean, false),
           site_title = nullif(body->'site'->>'title',''), site_url = nullif(body->'site'->>'final_url',''),
           name_match = nullif(body->>'name_match','')::boolean, free_mail = coalesce((body->>'free_mail')::boolean, false),
           updated_at = now()
     where org_id = r.org_id;
    if v_out = 'pass' then
      v_pass := v_pass + 1;
      v_by := 'company-domain email ' || coalesce(body->>'domain','?') || ' (receives mail)'
              || case when coalesce((body->'site'->>'ok')::boolean,false) then ' · website live' || case when coalesce((body->>'name_match')::boolean,false) then ', company name on site' else '' end else ' · no website found' end
              || case when r.email_verified_at is not null then ' · address confirmed by code' else ' · signup address' end;
      update app_private.shipper_trust set verified_at = coalesce(verified_at, now()), verified_by = v_by, updated_at = now() where org_id = r.org_id;
      perform app_private.notify_partner(r.org_id, '✅ Business confirmed — request your first quote',
        'We confirmed ' || coalesce(v_name,'your company') || ' from your company email' || case when coalesce((body->'site'->>'ok')::boolean,false) then ' and website' else '' end || '. Post a shipment now — brokers quote it within the hour. Payment terms and the rest of the packet come before your first booking.', 'success', '/app/partner/');
    elsif v_out = 'no_mail' then
      perform app_private.notify_partner(r.org_id, 'We could not confirm your business yet', v_reason || '. Enter an address on your company''s real domain under Onboarding — we send it a code.', 'warning', '/app/partner/#onboarding');
    end if;
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','shipper.checked', jsonb_build_object('title', case v_out when 'pass' then '🟢 Shipper business confirmed — ' else '🟡 Shipper check: ' || v_out || ' — ' end || coalesce(v_name,'?'),
        'body', coalesce(body->>'domain','?') || ' · mx=' || coalesce(body->>'mx','?') || ' · site=' || coalesce(body->'site'->>'ok','?') || coalesce(' "' || (body->'site'->>'title') || '"','') || ' · name match=' || coalesce(body->>'name_match','n/a'),
        'tone', case v_out when 'pass' then 'info' else 'action' end, 'url', '/app/command-center/#/broker-trust', 'org_id', r.org_id), 'sent', now());
    exception when others then null; end;
    perform app_private.log_audit('shipper.checked', 'org', r.org_id::text, r.org_id, 'business check: ' || v_out || coalesce(' — ' || v_reason,''), body - 'company_tokens' - 'matched_tokens', null);
  end loop;
  return jsonb_build_object('read', v_read, 'passed', v_pass, 'ran_at', now());
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'lb-shipper-check-collect') then
    perform cron.schedule('lb-shipper-check-collect', '* * * * *', 'select app_private.shipper_check_collect();');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. posting gate: shippers get the tiered rule (facilities unchanged)
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='app_private' and p.proname='enforce_partner_onboarded';
  if v_def is null then raise exception 'enforce_partner_onboarded missing'; end if;
  if position('assert_shipper_can_post' in v_def) > 0 then raise notice 'already patched'; return; end if;
  v_old := $q$  if not app_private.org_onboarding_complete(v_org) then$q$;
  v_new := $q$  -- bl_bp_0319: shippers post quote requests on the automated business check
  if exists (select 1 from public.organizations o where o.id = v_org and o.kind = 'shipper') then
    perform app_private.assert_shipper_can_post(v_org);
    return NEW;
  end if;
  if not app_private.org_onboarding_complete(v_org) then$q$;
  if position(v_old in v_def) = 0 then raise exception 'enforce_partner_onboarded: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 4. portal RPCs
-- ---------------------------------------------------------------------------
create or replace function public.partner_shipper_status()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_org uuid; t app_private.shipper_trust; c record; o record; v_packet jsonb; a record;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('shipper');
  if v_org is null then return jsonb_build_object('has_org', false); end if;
  select * into o from public.organizations where id = v_org;
  select * into t from app_private.shipper_trust where org_id = v_org;
  select * into c from app_private.shipper_can_post(v_org);
  select * into a from app_private.master_agreements where kind = 'broker_shipper' and published order by version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('key', tp.item_key, 'label', tp.label, 'tag', tp.status_tag, 'status', coalesce(i.status,'pending')) order by tp.sort), '[]'::jsonb)
    into v_packet from app_private.onboarding_packet_templates tp left join app_private.org_onboarding_items i on i.org_id = v_org and i.item_key = tp.item_key where tp.org_kind = 'shipper';
  return jsonb_build_object('has_org', true, 'org', v_org, 'company', o.name, 'org_status', o.status,
    'tier', c.tier, 'can_post', c.ok, 'reason', c.reason,
    'signup_email_masked', (select app_private.mask_email(u.email) from auth.users u where u.id = auth.uid()),
    'domain', t.domain, 'free_mail', t.free_mail, 'company_email_masked', app_private.mask_email(t.company_email), 'email_verified_at', t.email_verified_at,
    'check', case when t.org_id is null then null else jsonb_build_object('outcome', t.check_outcome, 'reason', t.check_reason, 'pending', t.request_id is not null, 'requested_at', t.requested_at, 'checked_at', t.checked_at,
        'mx', t.mx, 'site_ok', t.site_ok, 'site_title', t.site_title, 'site_url', t.site_url, 'name_match', t.name_match, 'attempts', t.attempts) end,
    'verified_at', t.verified_at, 'verified_by', t.verified_by, 'hold_reason', t.hold_reason,
    'code_live', exists (select 1 from app_private.verify_codes v where v.org_id = v_org and v.purpose = 'shipper_email' and v.consumed_at is null and v.expires_at > now()),
    'agreement', jsonb_build_object('available', a.kind is not null, 'version', a.version, 'accepted', exists (select 1 from app_private.org_agreement_acceptances x where x.org_id = v_org and x.kind = 'broker_shipper')),
    'packet', v_packet,
    'packet_required_total', (select count(*) from jsonb_array_elements(v_packet) e where e->>'tag' in ('legal','required')),
    'packet_required_done', (select count(*) from jsonb_array_elements(v_packet) e where e->>'tag' in ('legal','required') and e->>'status' in ('verified','waived')),
    'shipments', (select count(*) from app_private.partner_shipments s where s.shipper_org = v_org),
    'booked', (select count(*) from app_private.partner_shipments s where s.shipper_org = v_org and s.status in ('booked','tendered','accepted')));
end $$;
revoke all on function public.partner_shipper_status() from public, anon;
grant execute on function public.partner_shipper_status() to authenticated;

create or replace function public.partner_shipper_verify()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid;
begin
  v_org := app_private.my_partner_org('shipper');
  if v_org is null then raise exception 'not a shipper account' using errcode='42501'; end if;
  if (select attempts from app_private.shipper_trust where org_id = v_org) >= 20 then return jsonb_build_object('queued', false, 'outcome', 'error', 'note', 'too many checks today — contact hello@loadboot.com'); end if;
  return app_private.shipper_business_start(v_org);
end $$;
revoke all on function public.partner_shipper_verify() from public, anon;
grant execute on function public.partner_shipper_verify() to authenticated;

-- signed up with Gmail? give the company address — a code goes there
create or replace function public.partner_shipper_company_email(p_email text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; v_email text; v_domain text; v_code text; v_hash text; n int; v_company text;
begin
  v_org := app_private.my_partner_org('shipper');
  if v_org is null then raise exception 'not a shipper account' using errcode='42501'; end if;
  v_email := lower(trim(coalesce(p_email,'')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email' using errcode='22023'; end if;
  v_domain := split_part(v_email, '@', 2);
  if app_private.free_mail_domain(v_domain) then raise exception 'that is a personal email domain — use your company address (name@yourcompany.com)' using errcode='22023'; end if;
  select count(*) into n from app_private.verify_codes where org_id = v_org and purpose = 'shipper_email' and created_at > now() - interval '24 hours';
  if n >= 5 then return jsonb_build_object('sent', false, 'why', 'Five codes in 24 hours is the limit — check spam, or try tomorrow.'); end if;
  select name into v_company from public.organizations where id = v_org;
  insert into app_private.shipper_trust(org_id, company_email) values (v_org, v_email)
  on conflict (org_id) do update set company_email = v_email, email_verified_at = null, updated_at = now();
  update app_private.verify_codes set expires_at = now() where org_id = v_org and purpose = 'shipper_email' and consumed_at is null and expires_at > now();
  declare b bytea := extensions.gen_random_bytes(4); begin
    v_code := lpad(((get_byte(b,0)::bigint * 16777216 + get_byte(b,1) * 65536 + get_byte(b,2) * 256 + get_byte(b,3)) % 1000000)::text, 6, '0');
  end;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  insert into app_private.verify_codes(org_id, purpose, channel, to_email, code_hash, expires_at, created_by)
  values (v_org, 'shipper_email', 'email', v_email, v_hash, now() + interval '24 hours', auth.uid());
  perform app_private.sys_email(v_email, 'shipper.company_email', 'Your LoadBoot verification code — ' || coalesce(v_company,''),
    '<h2 style="margin:0 0 10px;font-size:22px">Confirm your company email</h2>'
    || '<p style="font-size:15px;color:#334155">Someone is setting up a LoadBoot shipper account for <b>' || coalesce(v_company,'your company') || '</b> and named this address as the company contact. If that is you, type this code in the LoadBoot dashboard:</p>'
    || '<p style="margin:14px 0;font-size:34px;letter-spacing:.35em;font-weight:900;color:#10223B;font-family:ui-monospace,Menlo,monospace">' || v_code || '</p>'
    || '<p style="font-size:13px;color:#64748b">Valid 24 hours. If you did not expect this, ignore it — nothing happens without the code.</p>',
    null, 'shipperemail:' || v_org::text || ':' || extract(epoch from now())::bigint::text);
  perform app_private.log_audit('shipper.company_email_sent', 'org', v_org::text, v_org, 'code sent to ' || app_private.mask_email(v_email), null, null);
  return jsonb_build_object('sent', true, 'to', app_private.mask_email(v_email));
end $$;
revoke all on function public.partner_shipper_company_email(text) from public, anon;
grant execute on function public.partner_shipper_company_email(text) to authenticated;

-- the code box: shipper_email codes confirm the address, then the business check runs on that domain
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='partner_verify_code';
  if v_def is null then raise exception 'partner_verify_code missing'; end if;
  if position('shipper_email' in v_def) > 0 then raise notice 'partner_verify_code already patched'; return; end if;
  v_old := $q$  if vc.purpose = 'identity' then$q$;
  v_new := $q$  if vc.purpose = 'shipper_email' then  -- bl_bp_0319
    update app_private.shipper_trust set company_email = vc.to_email, email_verified_at = now(), updated_at = now() where org_id = v_org;
    perform app_private.log_audit('shipper.company_email_ok', 'org', v_org::text, v_org, 'company address confirmed: ' || app_private.mask_email(vc.to_email), null, null);
    return jsonb_build_object('ok', true, 'purpose', 'shipper_email') || app_private.shipper_business_start(v_org);
  end if;
  if vc.purpose = 'identity' then$q$;
  if position(v_old in v_def) = 0 then raise exception 'partner_verify_code: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 5. registration kicks the check off; the welcome copy stops promising a 10-minute packet
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_partner_register' and pg_get_function_identity_arguments(p.oid) like '%p_mc%';
  if v_def is null then raise exception 'cc_partner_register(3) missing'; end if;
  if position('shipper_business_start' in v_def) > 0 then raise notice 'cc_partner_register already patched'; return; end if;
  v_old := $q$      else 'Your ' || p_kind || ' account is created. Finish the guided onboarding (about 10 minutes) — once our team verifies your packet, load posting unlocks automatically.' end,$q$;
  v_new := $q$      when p_kind = 'shipper'
      then 'Your shipper account is created. We are confirming your business from your company email — usually under a minute — then you can request quotes right away. Payment terms and the short packet come before your first booking.'
      else 'Your ' || p_kind || ' account is created. Finish the guided onboarding (about 10 minutes) — once our team verifies your packet, load posting unlocks automatically.' end,$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_partner_register: welcome anchor missing'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $q$  return jsonb_build_object('org', v_org, 'kind', p_kind, 'existing', false, 'mc', v_mc);$q$;
  v_new := $q$  if p_kind = 'shipper' then perform app_private.shipper_business_start(v_org); end if;  -- bl_bp_0319
  return jsonb_build_object('org', v_org, 'kind', p_kind, 'existing', false, 'mc', v_mc);$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_partner_register: return anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- overview: the shipper dashboard unfolds the request form on can_post, not on the packet
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_partner_overview';
  if v_def is null then raise exception 'cc_partner_overview missing'; end if;
  if position('shipper_can_post' in v_def) > 0 then raise notice 'cc_partner_overview already patched'; return; end if;
  v_old := $q$    'onboarded', v_pending = 0, 'onboarding_pending', v_pending);$q$;
  v_new := $q$    'onboarded', v_pending = 0, 'onboarding_pending', v_pending)
    || case when r.kind = 'shipper' then jsonb_build_object('can_post', (select ok from app_private.shipper_can_post(r.org_id)), 'trust_tier', app_private.shipper_tier(r.org_id)) else '{}'::jsonb end;  -- bl_bp_0319$q$;
  if position(v_old in v_def) = 0 then raise exception 'cc_partner_overview: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- brokers see who they are quoting
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='cc_broker_shipment_inbox';
  if v_def is null then raise exception 'cc_broker_shipment_inbox missing'; end if;
  if position('shipper_badge' in v_def) > 0 then raise notice 'inbox already patched'; return; end if;
  v_old := $q$      'open_pool', (s.assigned_broker is null))$q$;
  v_new := $q$      'open_pool', (s.assigned_broker is null), 'shipper_trust', app_private.shipper_badge(s.shipper_org))$q$;
  if position(v_old in v_def) = 0 then raise exception 'inbox: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- the Shipper Agreement, once published, fills its packet item on acceptance (mirrors the broker trigger)
create or replace function app_private.trg_agreement_fills_packet()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_key text; v_kind text;
begin
  select kind into v_kind from public.organizations where id = NEW.org_id;
  v_key := case when NEW.kind = 'broker_carrier' and v_kind = 'broker' then 'broker_agreement'
                when NEW.kind = 'broker_shipper' and v_kind = 'shipper' then 'signed_agreement' end;
  if v_key is not null then
    insert into app_private.org_onboarding_items(org_id, item_key, status, note, reviewed_at, submitted_at, submitted_by)
    values (NEW.org_id, v_key, 'verified', case when v_key = 'broker_agreement' then 'Master Broker Agreement' else 'Shipper Agreement' end || ' v' || coalesce(NEW.version::text,'?') || ' accepted online ' || to_char(coalesce(NEW.accepted_at, now()),'YYYY-MM-DD HH24:MI') || ' (recorded with server timestamp)', now(), now(), NEW.accepted_by)
    on conflict (org_id, item_key) do update
      set status = 'verified', note = excluded.note, reviewed_at = now(), lapsed_at = null
      where app_private.org_onboarding_items.status not in ('verified','waived');
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Command Center
-- ---------------------------------------------------------------------------
create or replace function public.cc_shipper_trust_queue()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
begin
  if not (public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.sort_key, x.created_at desc) from (
    select o.id as org_id, o.name, o.status as org_status, o.created_at, (select u.email from auth.users u where u.id = o.owner_user_id) as owner_email,
           app_private.shipper_tier(o.id) as tier, c.ok as can_post, c.reason,
           t.domain, t.free_mail, t.company_email, t.email_verified_at, t.check_outcome, t.check_reason, t.mx, t.site_ok, t.site_title, t.site_url, t.name_match, t.checked_at, t.attempts,
           t.verified_at, t.verified_by, t.hold_reason,
           (select count(*) from app_private.partner_shipments s where s.shipper_org = o.id) as shipments,
           (select count(*) from app_private.onboarding_packet_templates tp left join app_private.org_onboarding_items i on i.org_id = o.id and i.item_key = tp.item_key
             where tp.org_kind = 'shipper' and tp.status_tag in ('legal','required') and coalesce(i.status,'pending') in ('verified','waived')) as packet_done,
           (select count(*) from app_private.onboarding_packet_templates tp where tp.org_kind = 'shipper' and tp.status_tag in ('legal','required')) as packet_total,
           case app_private.shipper_tier(o.id) when 'new' then 0 when 'hold' then 1 when 'business_verified' then 2 else 3 end as sort_key
      from public.organizations o
      left join app_private.shipper_trust t on t.org_id = o.id
      left join lateral app_private.shipper_can_post(o.id) c on true
     where o.kind = 'shipper' and coalesce(o.status,'') <> 'archived' and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.cc_shipper_trust_queue() from public, anon;
grant execute on function public.cc_shipper_trust_queue() to authenticated;

create or replace function public.cc_shipper_trust_set(p_org uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_name text;
begin
  if not (public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'shipper') then raise exception 'shipper not found' using errcode='22023'; end if;
  insert into app_private.shipper_trust(org_id) values (p_org) on conflict do nothing;
  select name into v_name from public.organizations where id = p_org;
  if p_action = 'hold' then
    if coalesce(trim(p_note),'') = '' then raise exception 'a written reason is required to hold' using errcode='22023'; end if;
    update app_private.shipper_trust set hold_reason = left(trim(p_note),300), held_at = now(), updated_at = now() where org_id = p_org;
    perform app_private.notify_partner(p_org, '⛔ Posting paused', p_note || '  Contact support to resolve it.', 'urgent', '/app/partner/#onboarding');
  elsif p_action = 'release' then
    update app_private.shipper_trust set hold_reason = null, held_at = null, updated_at = now() where org_id = p_org;
    perform app_private.notify_partner(p_org, '✅ Posting restored', coalesce(nullif(trim(p_note),''), 'The hold on your account was lifted.'), 'success', '/app/partner/');
  elsif p_action = 'verify' then
    if coalesce(trim(p_note),'') = '' then raise exception 'write how the business was verified (called them, D&B, website…)' using errcode='22023'; end if;
    update app_private.shipper_trust set verified_at = now(), verified_by = 'staff: ' || left(trim(p_note),200), check_outcome = 'pass', check_reason = null, hold_reason = null, held_at = null, updated_at = now() where org_id = p_org;
    perform app_private.notify_partner(p_org, '✅ Business confirmed — request your first quote', 'Our team confirmed ' || coalesce(v_name,'your company') || '. Post a shipment now.', 'success', '/app/partner/');
  elsif p_action = 'recheck' then
    update app_private.shipper_trust set request_id = null, updated_at = now() where org_id = p_org;
    perform app_private.shipper_business_start(p_org);
  else raise exception 'unknown action' using errcode='22023'; end if;
  perform app_private.log_audit('shipper.trust.' || p_action, 'org', p_org::text, p_org, coalesce(p_note, p_action), null, null);
  return jsonb_build_object('ok', true, 'tier', app_private.shipper_tier(p_org));
end $$;
revoke all on function public.cc_shipper_trust_set(uuid, text, text) from public, anon;
grant execute on function public.cc_shipper_trust_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. backfill: existing shippers get their check queued now
-- ---------------------------------------------------------------------------
select app_private.shipper_business_start(o.id) from public.organizations o where o.kind = 'shipper' and coalesce(o.status,'') <> 'archived'
  and not exists (select 1 from app_private.shipper_trust t where t.org_id = o.id and t.verified_at is not null);

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('partner_shipper_status','partner_shipper_verify','partner_shipper_company_email','cc_shipper_trust_queue','cc_shipper_trust_set')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;
end $$;
