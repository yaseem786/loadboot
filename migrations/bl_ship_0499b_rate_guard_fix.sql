-- bl_ship_0499b — fixes found by the 0499 rollback test on staging (29 Sep 2026). Run right after 0499.
-- 1. trg_no_shipper_rate_talk read NEW.sender on every table (PL/pgSQL does not short-circuit record fields),
--    so mail/comm inserts to a shipper failed with 'record "new" has no field "sender"'. The bot branch is now nested.
-- 2. rate_talk_reason missed a bare number next to rate wording ("we can do 1800 all in"); "rate confirmation"
--    (the document) is ignored so "pickup 0800, rate confirmation attached" is not flagged.

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
  b := regexp_replace(b, '\mrate[- ]?con(firmation)?s?\M', ' ', 'gi');  -- the document name is not rate talk
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
  if b ~* '(\m(rates?|all[- ]?in|flat|quote|quoted|offer|offered|budget|target|bid|pay|price)\M.{0,30}\m\d[\d,]{2,6}(\.\d{1,2})?\M|\m\d[\d,]{2,6}(\.\d{1,2})?\M.{0,20}\m(all[- ]?in|flat|rate)\M)' then
    return 'a number next to rate wording';
  end if;
  return null;
end $$;

create or replace function app_private.trg_no_shipper_rate_talk()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_reason text; v_body text; v_rel text; v_type text; c record; v_bot boolean := false;
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
    v_bot := NEW.sender = 'bot';
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
  if v_bot then  -- the AI brain never errors out mid-chat: its reply is replaced by the neutral line
    NEW.body := 'The rate for a load is set by the shipper and agreed only between the shipper and the carrier or broker it chooses. LoadBoot does not discuss or negotiate rates. I can help with anything else about using LoadBoot.';
    return NEW;
  end if;
  raise exception '%', app_private.shipper_rate_block_msg(nullif(v_org, '00000000-0000-0000-0000-000000000000'::uuid), v_reason) using errcode = '42501';
end $$;

revoke execute on function app_private.rate_talk_reason(text, boolean) from public, anon;
revoke execute on function app_private.trg_no_shipper_rate_talk() from public, anon;
