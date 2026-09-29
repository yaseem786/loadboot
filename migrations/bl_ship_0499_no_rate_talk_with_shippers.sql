-- bl_ship_0499 — LoadBoot never talks rates with a shipper (owner decision, 29 Sep 2026).
-- "Hum shipper se rate ki baat nahi karenge. Rate counter sirf carrier ya broker karega, jis ko shipper load offer karega."
-- The shipper sets its rate; only the carrier or broker the shipper offered the load to may counter (0498 already
-- lets only the carrier's own users counter an offer). FMCSA 88 FR 39368 (16 Jun 2023), IV.F: a dispatch service
-- that negotiates freight directly with the shipper is an indicator that broker authority is needed.
--
-- 1. cc_offer_send (staff offers at a staff-chosen rate) refuses a shipper's own load.
-- 2. Every human/AI outbound channel refuses rate talk to a shipper contact:
--    mail_messages (CC mail), dialer_messages (SMS), wa_messages (WhatsApp), comm_messages (CC threads on a
--    shipper load), lc_messages (live chat: staff are refused; the AI brain's reply is replaced by a neutral line).
--    The dmail edge function (hello@/dispatch@/billing@/loads@ mailboxes) calls svc_shipper_rate_guard before SMTP.
--    A "shipper contact" = a member's email/phone, the verified company email, the call-back phone, a facility
--    site phone, or an email/phone given in the shipper's onboarding answers; live chat also uses visitor_role.
-- 3. The detector is a pattern filter, not a proof: money + rate words, per-mile/rpm, counter-offers,
--    "raise/lower the rate". Quoted earlier messages in mail replies are ignored.
-- 4. Brain rule row rule.no_shipper_rate_talk (CLAUDE.md §9) and conduct terms v2 for dispatchers.

-- ───────────── who is a shipper contact ─────────────
create or replace function app_private.shipper_org_for_contact(p_email text, p_phone text)
returns uuid language sql stable security definer set search_path = app_private, public as $$
  with k as (select nullif(lower(btrim(coalesce(p_email,''))), '') em,
                    nullif(right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10), '') ph)
  select o.id from public.organizations o, k
   where o.kind = 'shipper' and (
     (k.em is not null and (
        exists (select 1 from public.organization_memberships om join public.profiles pr on pr.id = om.user_id
                 where om.org_id = o.id and lower(pr.email) = k.em)
     or exists (select 1 from app_private.shipper_trust t where t.org_id = o.id and lower(t.company_email) = k.em)
     or exists (select 1 from app_private.org_onboarding_items i, jsonb_each_text(case when jsonb_typeof(i.data) = 'object' then i.data else '{}'::jsonb end) kv
                 where i.org_id = o.id and lower(btrim(kv.value)) = k.em)))
     or (length(k.ph) = 10 and (
        exists (select 1 from public.organization_memberships om join public.profiles pr on pr.id = om.user_id
                 where om.org_id = o.id and right(regexp_replace(coalesce(pr.phone,''), '\D', '', 'g'), 10) = k.ph)
     or exists (select 1 from app_private.shipper_trust t where t.org_id = o.id and right(regexp_replace(coalesce(t.callback_phone,''), '\D', '', 'g'), 10) = k.ph)
     or exists (select 1 from app_private.shipper_facilities f where f.org_id = o.id and right(regexp_replace(coalesce(f.site_contact_phone,''), '\D', '', 'g'), 10) = k.ph)
     or exists (select 1 from app_private.org_onboarding_items i, jsonb_each_text(case when jsonb_typeof(i.data) = 'object' then i.data else '{}'::jsonb end) kv
                 where i.org_id = o.id and right(regexp_replace(kv.value, '\D', '', 'g'), 10) = k.ph)))
   )
   limit 1
$$;

-- ───────────── does this text talk rates? (null = clean, else the reason) ─────────────
create or replace function app_private.rate_talk_reason(p_body text, p_mail boolean default false)
returns text language plpgsql immutable set search_path = app_private, public as $$
declare b text;
begin
  b := coalesce(p_body, '');
  if p_mail then  -- ignore the other side's quoted text in a mail reply
    b := regexp_replace(b, '<blockquote.*?</blockquote>', ' ', 'gi');
    b := regexp_replace(b, '\n\s*(On [^\n]{0,200}wrote:|-{2,}\s*Original Message).*$', '', 'i');
  end if;
  b := regexp_replace(b, '<[^>]+>', ' ', 'g');
  b := regexp_replace(b, '&nbsp;|&#160;', ' ', 'gi');
  if b ~* '(\mrpm\M|\mper[- ]?mile\M|\ma mile\M|\$\s*\d+(\.\d+)?\s*/\s*mi|\mcounter[- ]?offer|\mnegotiat|\mline[- ]?haul\M)' then
    return 'per-mile, counter-offer or negotiation wording';
  end if;
  if b ~* '\mcounter(ed|ing)?\M.{0,30}(\$|\d)' then return 'a counter with a number'; end if;
  if b ~* '(\mrates?\M.{0,40}\m(raise|increase|lower|reduce|higher|better|bump|drop|match|beat|go up|come down)\M|\m(raise|increase|lower|reduce|bump|drop|match|beat)\M.{0,40}\mrates?\M)' then
    return 'asking to move the rate';
  end if;
  if b ~* '(\$\s*\d|\m\d[\d,]*(\.\d+)?\s*(usd|dollars?|bucks)\M|\m\d+(\.\d+)?\s*k\M)'
     and b ~* '\m(rates?|rpm|pay|paying|paid|price|pricing|quote|quoted|offer|offered|offering|budget|target|bid|all[- ]?in|flat|per load)\M' then
    return 'a money amount with rate/price wording';
  end if;
  return null;
end $$;

create or replace function app_private.shipper_rate_block_msg(p_org uuid, p_reason text)
returns text language sql stable security definer set search_path = app_private, public as $$
  select 'LoadBoot never talks rates with a shipper (' || coalesce((select name from public.organizations where id = p_org), 'shipper')
      || '). The shipper sets its rate, and only the carrier or broker it offers the load to can counter. Remove the rate/price part of this message ('
      || coalesce(p_reason, 'rate wording') || ') and send again.'
$$;

-- ───────────── table guards ─────────────
create or replace function app_private.trg_no_shipper_rate_talk()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_reason text; v_body text; v_rel text; v_type text; c record;
begin
  if TG_TABLE_NAME = 'mail_messages' then
    if NEW.direction = 'in' then return NEW; end if;
    v_body := coalesce(NEW.subject, '') || E'\n' || coalesce(NEW.body_html, NEW.body_text, '');
    v_org := app_private.shipper_org_for_contact(NEW.peer_email, null);
  elsif TG_TABLE_NAME = 'dialer_messages' then
    if NEW.direction <> 'outbound' then return NEW; end if;
    v_body := NEW.body; v_org := app_private.shipper_org_for_contact(null, NEW.counterparty);
  elsif TG_TABLE_NAME = 'wa_messages' then
    if NEW.direction <> 'outbound' then return NEW; end if;
    v_body := NEW.body; v_org := app_private.shipper_org_for_contact(null, (select counterparty from app_private.wa_threads where id = NEW.thread_id));
  elsif TG_TABLE_NAME = 'comm_messages' then
    if NEW.direction = 'inbound' then return NEW; end if;
    select related_type, related_id into v_type, v_rel from app_private.comm_threads where id = NEW.thread_id;
    if v_type = 'load' and v_rel ~* '^[0-9a-f-]{36}$' and app_private.is_shipper_load(v_rel::uuid) then
      v_org := (select broker_org from public.loads where id = v_rel::uuid);
    end if;
    v_body := NEW.body;
  elsif TG_TABLE_NAME = 'lc_messages' then
    if NEW.sender not in ('staff', 'bot') then return NEW; end if;
    select * into c from app_private.lc_conversations where id = NEW.conversation_id;
    v_org := coalesce(
      (select om.org_id from public.organization_memberships om join public.organizations o on o.id = om.org_id
        where om.user_id = c.user_id and om.status = 'active' and o.kind = 'shipper' limit 1),
      app_private.shipper_org_for_contact(c.email, null));
    if v_org is null and c.visitor_role = 'shipper' then v_org := '00000000-0000-0000-0000-000000000000'::uuid; end if;  -- prospect shipper
    v_body := NEW.body;
  else
    return NEW;
  end if;
  if v_org is null then return NEW; end if;
  v_reason := app_private.rate_talk_reason(v_body, TG_TABLE_NAME = 'mail_messages');
  if v_reason is null then return NEW; end if;
  if TG_TABLE_NAME = 'lc_messages' and NEW.sender = 'bot' then
    NEW.body := 'The rate for a load is set by the shipper and agreed only between the shipper and the carrier or broker it chooses. LoadBoot does not discuss or negotiate rates. I can help with anything else about using LoadBoot.';
    return NEW;
  end if;
  raise exception '%', app_private.shipper_rate_block_msg(nullif(v_org, '00000000-0000-0000-0000-000000000000'::uuid), v_reason) using errcode = '42501';
end $$;

drop trigger if exists no_shipper_rate_talk on app_private.mail_messages;
create trigger no_shipper_rate_talk before insert or update of body_html, body_text, subject, peer_email, status on app_private.mail_messages
  for each row execute function app_private.trg_no_shipper_rate_talk();
drop trigger if exists no_shipper_rate_talk on app_private.dialer_messages;
create trigger no_shipper_rate_talk before insert on app_private.dialer_messages
  for each row execute function app_private.trg_no_shipper_rate_talk();
drop trigger if exists no_shipper_rate_talk on app_private.wa_messages;
create trigger no_shipper_rate_talk before insert on app_private.wa_messages
  for each row execute function app_private.trg_no_shipper_rate_talk();
drop trigger if exists no_shipper_rate_talk on app_private.comm_messages;
create trigger no_shipper_rate_talk before insert on app_private.comm_messages
  for each row execute function app_private.trg_no_shipper_rate_talk();
drop trigger if exists no_shipper_rate_talk on app_private.lc_messages;
create trigger no_shipper_rate_talk before insert on app_private.lc_messages
  for each row execute function app_private.trg_no_shipper_rate_talk();

-- ───────────── dmail edge function guard (service role only) ─────────────
create or replace function public.svc_shipper_rate_guard(p_to text[], p_body text)
returns text language plpgsql stable security definer set search_path = app_private, public as $$
declare e text; v_org uuid; v_reason text;
begin
  v_reason := app_private.rate_talk_reason(p_body, true);
  if v_reason is null then return null; end if;
  foreach e in array coalesce(p_to, '{}'::text[]) loop
    v_org := app_private.shipper_org_for_contact(e, null);
    if v_org is not null then return app_private.shipper_rate_block_msg(v_org, v_reason); end if;
  end loop;
  return null;
end $$;

-- ───────────── staff offers never on a shipper's load ─────────────
do $do$
declare d text; a text := $a$  select version into v_ver from public.loads where id=p_load;$a$;
begin
  d := pg_get_functiondef('public.cc_offer_send(uuid,uuid[],numeric,integer)'::regprocedure);
  if position('bl_ship_0499' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_ship_0499: cc_offer_send anchor not found'; end if;
  execute replace(d, a, $b$  if app_private.is_shipper_load(p_load) then  -- bl_ship_0499
    raise exception 'This is a shipper''s own load. Only the shipper sends offers and sets the rate — LoadBoot staff cannot.' using errcode = '42501';
  end if;
$b$ || a);
end $do$;

-- ───────────── AI brain rule (CLAUDE.md §9) ─────────────
insert into app_private.brain_permissions(key, kind, name, label, description, enabled, mode, risk, status, builtin, note)
values ('rule.no_shipper_rate_talk', 'rule', 'no_shipper_rate_talk', 'Never talk rates with a shipper',
        'Never quote, suggest, discuss, counter or negotiate a freight rate or price with a shipper or a prospective shipper. The shipper sets its own rate; only the carrier or broker it offers the load to may counter. If asked, say LoadBoot does not discuss rates and the shipper agrees them directly with the carrier or broker it chooses. (Owner decision 29 Sep 2026, bl_ship_0499; FMCSA 2023 dispatch guidance.)',
        true, 'deny', 'high', 'live', true, 'bl_ship_0499')
on conflict (key) do nothing;
select app_private.brain_log('rule.no_shipper_rate_talk', 'add', null,
  (select to_jsonb(b) from app_private.brain_permissions b where key = 'rule.no_shipper_rate_talk'), 'bl_ship_0499: owner decision, no rate talk with shippers');

-- ───────────── dispatcher conduct terms v2 (re-accepted at the next carrier choice) ─────────────
create or replace function app_private.disp_conduct_terms() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'version', 'v2-2026-09-29',
    'title', 'Contact rules — accepted before you choose',
    'rules', jsonb_build_array(
      'Every contact with a carrier goes through LoadBoot channels only: the carrier''s LoadBoot WhatsApp dispatch group, your LoadBoot line and your LoadBoot mailbox. Never a personal phone, personal WhatsApp, personal e-mail, or social media — yours or theirs.',
      'Never ask a carrier for a personal number and never give yours. Never move a carrier, a driver, a broker or a load off LoadBoot, during the assignment or after it ends.',
      'Carriers are told to report any contact that does not come from your LoadBoot line or the LoadBoot group. A report is investigated by LoadBoot. A confirmed report means your account is suspended the same day and blocked permanently: every assignment ends, your LoadBoot line and mailbox are released, and you cannot be reinstated or re-apply.',
      'Names, phones, dockets and documents you see after an assignment are confidential to that assignment. The carrier approves every load — you never book, commit or promise without their OK.',
      'Never talk rates with a shipper. On a shipper''s own load you may only request it at the rate the shipper posted — never counter, negotiate, quote or discuss the rate with the shipper, on any channel. Only the carrier itself, or a broker the shipper chose, may counter. LoadBoot''s systems block rate talk to shippers.'),
    'consequence', 'Confirmed off-platform contact = same-day suspension, permanent block, no re-application.')
$$;

-- ───────────── grants (CLAUDE.md §4) ─────────────
revoke execute on function app_private.shipper_org_for_contact(text, text) from public, anon;
revoke execute on function app_private.rate_talk_reason(text, boolean) from public, anon;
revoke execute on function app_private.shipper_rate_block_msg(uuid, text) from public, anon;
revoke execute on function app_private.trg_no_shipper_rate_talk() from public, anon;
revoke execute on function public.svc_shipper_rate_guard(text[], text) from public, anon, authenticated;
grant execute on function public.svc_shipper_rate_guard(text[], text) to service_role;
revoke all on function app_private.disp_conduct_terms() from public, anon;
