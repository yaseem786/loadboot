-- bl_bp_0314 — SELF-SERVICE identity verification by AUTOMATED VOICE CODE (no LoadBoot staff involved).
--
-- Yaseen, 3 Sep: "asa auto system banao — humein kisi ko call/email na karna pare, agent khud verify karwaye".
-- Industry standard (DAT, Highway, MyCarrierPortal): a one-time code delivered to the phone number FMCSA lists
-- for the company. LoadBoot already runs outbound voice through Retell (app_private.retell_dial), so the code is
-- SPOKEN by a dedicated, script-locked Retell agent "LoadBoot Verify (automated OTP)" — no SMS provider needed
-- (Twilio was never configured) and it works on the landlines most brokerages list with FMCSA.
--
-- Two purposes, both started and finished by the person in the portal:
--   identity  own-MC broker: call the brokerage's FMCSA-listed phone → whoever answers hears the code → the
--             broker types it → broker_identity = verified / method 'phone'.
--   parent    agent: call the PARENT brokerage's FMCSA-listed phone → the call names the agent and says
--             "if you approve, give them this code" → the agent types it → parent_confirmed_at set
--             (parent_confirmed_by = 'FMCSA-listed phone code'). The brokerage stays the decider; LoadBoot staff
--             do nothing. (Email link and in-app approval from 0312/0313 remain as alternatives.)
--
-- Guard rails: the number dialled is ALWAYS the FMCSA-listed phone (never user-supplied); 6-digit code, sha256
-- hashed at rest, 15-minute validity, 5 attempts, 3 calls / 24 h and 2 minutes between calls per org; the code is
-- never left on voicemail/IVR (agent hangs up); calls tagged source='verify' never create CRM leads.
--
-- Retell agent created 3 Sep via API (one account serves both envs): agent_1f87d0c74e873ffc8b17e883f3
-- (llm_acfc661d0ce2a0109c60a7e53853, voice retell-Tamsin, webhook → prod retell_webhook). Staging calls therefore
-- get no status feedback (the webhook validates the prod from_number) — the OTP itself does not depend on it.

-- 1. config + schema -----------------------------------------------------------------------------
alter table app_private.retell_config add column if not exists verify_agent_id text;
update app_private.retell_config set verify_agent_id = 'agent_1f87d0c74e873ffc8b17e883f3' where id = 1 and verify_agent_id is null;

alter table app_private.broker_identity drop constraint if exists broker_identity_method_check;
alter table app_private.broker_identity add constraint broker_identity_method_check check (method in ('domain','email','staff','parent','phone'));

create table if not exists app_private.verify_codes (
  id          bigserial primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  purpose     text not null check (purpose in ('identity','parent')),
  to_number   text not null,
  code_hash   text not null,
  call_id     bigint,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_by  uuid
);
create index if not exists verify_codes_org_idx on app_private.verify_codes(org_id, created_at desc);
alter table app_private.lc_calls add column if not exists org_id uuid;

-- 2. the dial: same pg_net pattern as retell_dial, but on the script-locked verify agent -----------
create or replace function app_private.retell_dial_verify(p_call bigint, p_vars jsonb)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $$
declare cfg app_private.retell_config; r app_private.lc_calls;
begin
  select * into cfg from app_private.retell_config where id = 1;
  select * into r from app_private.lc_calls where id = p_call;
  if cfg.api_key is null or cfg.verify_agent_id is null or r.id is null then return false; end if;
  perform net.http_post(
    url := 'https://api.retellai.com/v2/create-phone-call',
    headers := jsonb_build_object('Authorization', 'Bearer ' || cfg.api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from_number', cfg.from_number, 'to_number', r.to_number,
      'override_agent_id', cfg.verify_agent_id,
      'metadata', jsonb_build_object('source', 'verify', 'lc_call_id', r.id),
      'retell_llm_dynamic_variables', p_vars));
  update app_private.lc_calls set status = 'dialing', updated_at = now() where id = p_call;
  return true;
end $$;

-- 3. start a verification call (portal) -----------------------------------------------------------
create or replace function public.partner_verify_call(p_purpose text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; s app_private.broker_screenings; t app_private.broker_trust; idn app_private.broker_identity;
        v_phone text; v_code text; v_hash text; v_call bigint; v_company text; v_mc text; v_me text; v_org_name text;
        n_day int; v_last timestamptz; v_script text; v_purpose_txt text; cfg app_private.retell_config;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  if p_purpose not in ('identity','parent') then raise exception 'purpose must be identity or parent' using errcode='22023'; end if;
  select * into cfg from app_private.retell_config where id = 1;
  if cfg.api_key is null or cfg.verify_agent_id is null then return jsonb_build_object('ok', false, 'why', 'Automated calls are not enabled on this environment yet.'); end if;
  select * into s from app_private.broker_screenings where org_id = v_org;
  select * into t from app_private.broker_trust where org_id = v_org;
  select name into v_org_name from public.organizations where id = v_org;
  select lower(u.email) into v_me from auth.users u where u.id = auth.uid();
  if s.org_id is null or s.outcome <> 'pass' then return jsonb_build_object('ok', false, 'why', 'Screen the MC on FMCSA first.'); end if;
  if p_purpose = 'identity' then
    if coalesce(t.is_agent,false) then return jsonb_build_object('ok', false, 'why', 'Agents confirm through their brokerage instead.'); end if;
    select * into idn from app_private.broker_identity where org_id = v_org;
    if idn.status = 'verified' then return jsonb_build_object('ok', true, 'already', true); end if;
    v_phone := coalesce(idn.fmcsa_phone, s.phone);
    v_company := coalesce(s.legal_name, v_org_name); v_mc := s.mc_number;
    v_purpose_txt := 'a new LoadBoot broker account for ' || v_company;
    v_script := 'Someone using the email ' || replace(coalesce(v_me,'an unknown address'),'@',' at ') || ' is setting up a LoadBoot broker account for your company. If that is you or a colleague, I will read you a one-time code to type into the LoadBoot page. If you do not recognise this, simply hang up — without the code that account cannot post loads.';
  else
    if not coalesce(t.is_agent,false) then return jsonb_build_object('ok', false, 'why', 'Only agents confirm through a parent brokerage.'); end if;
    if t.parent_confirmed_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
    v_phone := s.phone;  -- the agent's screening row IS the parent MC's FMCSA record
    v_company := coalesce(t.parent_legal_name, s.legal_name, 'your brokerage'); v_mc := t.parent_mc;
    v_purpose_txt := 'an agent asking to post loads under ' || v_company;
    v_script := coalesce(v_org_name, 'Someone') || ', using the email ' || replace(coalesce(v_me,'an unknown address'),'@',' at ') || ', says they are an agent of your brokerage and wants to post loads under your MC on LoadBoot. If you approve, give them the one-time code I am about to read. If you do not know them, simply hang up — they cannot post without it.';
  end if;
  v_phone := regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g');
  if length(v_phone) = 11 and left(v_phone,1) = '1' then v_phone := substr(v_phone, 2); end if;
  if length(v_phone) <> 10 then return jsonb_build_object('ok', false, 'why', 'FMCSA lists no usable US phone number for ' || v_company || '. Use the email link, or ask our team: hello@loadboot.com'); end if;
  v_phone := '+1' || v_phone;
  -- throttles
  select count(*), max(created_at) into n_day, v_last from app_private.verify_codes where org_id = v_org and created_at > now() - interval '24 hours';
  if v_last is not null and v_last > now() - interval '2 minutes' then return jsonb_build_object('ok', false, 'why', 'A call was placed less than 2 minutes ago — give it a moment to ring.'); end if;
  if n_day >= 3 then return jsonb_build_object('ok', false, 'why', 'Three calls in 24 hours is the limit. Use the email link, or try again tomorrow.'); end if;
  -- code
  declare b bytea := extensions.gen_random_bytes(4); begin
    v_code := lpad(((get_byte(b,0)::bigint * 16777216 + get_byte(b,1) * 65536 + get_byte(b,2) * 256 + get_byte(b,3)) % 1000000)::text, 6, '0');
  end;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  insert into app_private.lc_calls (direction, from_number, to_number, contact_name, topic, contact_role, context, status, requested_by, source, org_id)
  values ('outbound', cfg.from_number, v_phone, v_company, 'verification', 'broker', left('Automated verification code call · ' || v_purpose_txt, 4000), 'requested', auth.uid(), 'verify', v_org)
  returning id into v_call;
  insert into app_private.verify_codes (org_id, purpose, to_number, code_hash, call_id, expires_at, created_by)
  values (v_org, p_purpose, v_phone, v_hash, v_call, now() + interval '15 minutes', auth.uid());
  perform app_private.retell_dial_verify(v_call, jsonb_build_object(
    'company', v_company, 'mc', coalesce(v_mc,''), 'purpose', v_purpose_txt, 'requester', coalesce(v_me,''),
    'code', trim(regexp_replace(v_code, '(.)', '\1 ', 'g')), 'script', v_script));
  perform app_private.log_audit('broker.verify_call', 'org', v_org::text, v_org, p_purpose || ' code call to FMCSA-listed ' || app_private.mask_phone(v_phone), null, null);
  return jsonb_build_object('ok', true, 'to', app_private.mask_phone(v_phone), 'expires_at', now() + interval '15 minutes', 'calls_left', 3 - n_day - 1);
end $$;
revoke all on function public.partner_verify_call(text) from public, anon;
grant execute on function public.partner_verify_call(text) to authenticated;

-- 4. enter the code (portal) ----------------------------------------------------------------------
create or replace function public.partner_verify_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_org uuid; vc app_private.verify_codes; v_code text; v_hash text; t app_private.broker_trust; v_name text; v_parent text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  v_code := regexp_replace(coalesce(p_code,''), '\D', '', 'g');
  if length(v_code) <> 6 then return jsonb_build_object('ok', false, 'why', 'Enter the 6-digit code from the call.'); end if;
  select * into vc from app_private.verify_codes where org_id = v_org and consumed_at is null order by created_at desc limit 1 for update;
  if vc.id is null then return jsonb_build_object('ok', false, 'why', 'No call has been placed yet.'); end if;
  if vc.expires_at < now() then return jsonb_build_object('ok', false, 'why', 'That code expired (15 minutes). Request a new call.'); end if;
  if vc.attempts >= 5 then return jsonb_build_object('ok', false, 'why', 'Too many attempts. Request a new call.'); end if;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  if v_hash <> vc.code_hash then
    update app_private.verify_codes set attempts = attempts + 1 where id = vc.id;
    return jsonb_build_object('ok', false, 'why', 'That code does not match (' || (4 - vc.attempts) || ' attempts left).');
  end if;
  update app_private.verify_codes set consumed_at = now() where id = vc.id;
  select name into v_name from public.organizations where id = v_org;
  select * into t from app_private.broker_trust where org_id = v_org;
  if vc.purpose = 'identity' then
    insert into app_private.broker_identity(org_id, status, method, fmcsa_phone, verified_at, verified_by, note)
    values (v_org, 'verified', 'phone', vc.to_number, now(), 'FMCSA-listed phone (automated code call)', 'code confirmed ' || to_char(now(),'YYYY-MM-DD HH24:MI'))
    on conflict (org_id) do update set status = 'verified', method = 'phone', verified_at = now(), verified_by = 'FMCSA-listed phone (automated code call)', declined_at = null, updated_at = now(),
      note = left(coalesce(app_private.broker_identity.note,'') || ' | code confirmed ' || to_char(now(),'YYYY-MM-DD HH24:MI'), 500);
    perform app_private.notify_partner(v_org, '✅ Identity confirmed — you can post now', 'The code from the call to your FMCSA-listed number matched. Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post');
  else
    if t.org_id is null or not t.is_agent then return jsonb_build_object('ok', false, 'why', 'This account is not an agent account.'); end if;
    v_parent := coalesce(t.parent_legal_name, 'Your brokerage');
    update app_private.broker_trust set parent_confirmed_at = now(), parent_confirmed_by = 'FMCSA-listed phone code (automated call)', parent_declined_at = null,
      hold_reason = case when hold_reason like 'the brokerage you named%' then null else hold_reason end, held_at = case when hold_reason like 'the brokerage you named%' then null else held_at end,
      parent_contact_source = coalesce(parent_contact_source, 'fmcsa'), updated_at = now() where org_id = v_org;
    perform app_private.notify_partner(v_org, '✅ ' || v_parent || ' confirmed you', 'The code from the call to their FMCSA-listed number matched. You can post under their authority now — up to 3 open postings until your first delivery.', 'success', '/app/partner/#post');
    if t.parent_org_id is not null then
      perform app_private.notify_partner(t.parent_org_id, '🤝 Agent confirmed by phone code', coalesce(v_name,'An agent') || ' was confirmed with the code read to your FMCSA-listed phone. You can revoke them any time under Agents & team.', 'info', '/app/partner/#agents');
    end if;
  end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.verified_by_phone', jsonb_build_object('title', '🟢 ' || case vc.purpose when 'identity' then 'Brokerage identity' else 'Agent↔parent' end || ' confirmed by phone code — ' || coalesce(v_name,'?'),
      'body', 'Code read to FMCSA-listed ' || app_private.mask_phone(vc.to_number) || ' matched. No staff action needed.', 'tone','info', 'url','/app/command-center/#/broker-trust', 'org_id', v_org), 'sent', now());
  exception when others then null; end;
  perform app_private.log_audit('broker.verify_code_ok', 'org', v_org::text, v_org, vc.purpose || ' confirmed via code to ' || app_private.mask_phone(vc.to_number), null, null);
  return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(v_org));
end $$;
revoke all on function public.partner_verify_code(text) from public, anon;
grant execute on function public.partner_verify_code(text) to authenticated;

-- 5. portal status: last verification call + calls left (surgery on partner_trust_status) ----------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='partner_trust_status';
  if position('verify_call' in v_def) > 0 then raise notice 'partner_trust_status already patched'; return; end if;
  v_old := $q$    'parent_on_loadboot', (t.parent_org_id is not null),$q$;
  v_new := $q$    'verify_call', (select jsonb_build_object('purpose', vc.purpose, 'to_masked', app_private.mask_phone(vc.to_number), 'placed_at', vc.created_at, 'expires_at', vc.expires_at,
                     'consumed', vc.consumed_at is not null, 'attempts', vc.attempts,
                     'call_status', (select lc.status from app_private.lc_calls lc where lc.id = vc.call_id),
                     'calls_left', greatest(0, 3 - (select count(*) from app_private.verify_codes v2 where v2.org_id = v_org and v2.created_at > now() - interval '24 hours')))
                   from app_private.verify_codes vc where vc.org_id = v_org order by vc.created_at desc limit 1),
    'verify_phone_ok', (coalesce(nullif(regexp_replace(coalesce(s.phone,''),'\D','','g'),''), '') ~ '^1?[0-9]{10}$'),
    'parent_on_loadboot', (t.parent_org_id is not null),$q$;
  if position(v_old in v_def) = 0 then raise exception 'partner_trust_status: anchor missing (apply bl_bp_0313 first)'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 6. verification calls never become CRM leads (surgery on retell_webhook) --------------------------
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='retell_webhook';
  if v_def is null then raise notice 'retell_webhook missing — skip'; return; end if;
  if position($q$'verify'$q$ in v_def) > 0 then raise notice 'retell_webhook already patched'; return; end if;
  v_old := $q$    if rec.lead_id is null
       and coalesce(rec.duration_sec,0) >= 20$q$;
  v_new := $q$    if rec.lead_id is null
       and coalesce(rec.source,'') <> 'verify'   -- bl_bp_0314: automated OTP calls are not leads
       and coalesce(rec.duration_sec,0) >= 20$q$;
  if position(v_old in v_def) = 0 then raise exception 'retell_webhook: anchor missing'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 7. ACL re-check ----------------------------------------------------------------------------------
do $$
declare r record; bad text := '';
begin
  for r in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('partner_verify_call','partner_verify_code') and has_function_privilege('anon', p.oid, 'execute')
  loop bad := bad || r.proname || ' '; end loop;
  if bad <> '' then raise exception 'ACL leak: anon can execute %', bad; end if;
end $$;
