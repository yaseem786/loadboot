-- bl_lc_0184 — live chat: real contact options after a human is requested,
-- and the phone number stops being hard-coded.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Three problems fixed:
--
-- 1. lc_bot_step had '+1 (737) 306-1175' typed into it. That line is dead - it was the
--    old Twilio number. Anyone asking the chat bot to call them was handed a dead number.
--    Now every mention comes from app_private.retell_config via lc_phone_display(), so
--    changing the number in one row changes it everywhere, forever.
--
-- 2. "I want to talk to a real person" never asked what kind of business the visitor was
--    in - it jumped straight to name + email. The team picked up leads with no idea
--    whether they were talking to a carrier, a broker or a shipper.
--
-- 3. After the handoff the visitor was given, at best, two chips. Now they get every door
--    at once: call us on a tappable number, have Riley call them back right now, book a
--    specific date and time, or email - whichever suits them, in one screen.

-- One source of truth for the display number.
create or replace function app_private.lc_phone_display()
 returns text
 language sql
 stable
 security definer
 set search_path to 'app_private, public'
as $function$
  select case when f ~ '^\+1[0-9]{10}$'
              then '+1 (' || substr(f,3,3) || ') ' || substr(f,6,3) || '-' || substr(f,9,4)
              else coalesce(f,'') end
  from (select from_number as f from app_private.retell_config where id = 1) t;
$function$;

create or replace function app_private.lc_bot_step(p_conv uuid, p_text text)
 returns void
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare
  v_conv app_private.lc_conversations; v_ans text;
  v_text text := lower(coalesce(trim(p_text),''));
  v_role text; v_email text; v_first text; v_num text;
  v_waiting boolean; v_staff_joined boolean;
  v_role_chips constant text := e'\n\n[[chips:🚚 I''m a carrier=I''m a carrier|🏢 I''m a broker=I''m a broker|📦 I''m a shipper=I''m a shipper|🧑‍✈️ Dispatcher=I''m a dispatcher|📣 Referral=I''m interested in the referral program]]';
  v_help_chips constant text := e'\n\n[[chips:✅ Get verified=How do I get verified?|💰 Pricing=What does LoadBoot cost?|🚚 Find loads=How do I find loads for my truck?|🙋 Talk to a person=I want to talk to a real person]]';
  v_contact_form constant text := e'\n\n[[form:name,email]]';
  v_ack constant text := '✓ Our team has been notified and a real person will reply right here. Meanwhile I''m still around — ask me anything (pricing, loads, verification, payments…).';
begin
  select * into v_conv from app_private.lc_conversations where id = p_conv;
  v_waiting := (v_conv.mode = 'human');
  v_staff_joined := exists (select 1 from app_private.lc_messages where conversation_id = p_conv and sender = 'staff');
  v_num := coalesce(nullif(app_private.lc_phone_display(),''), 'our 24/7 line');

  update app_private.lc_conversations
    set last_msg_at = now(), staff_unread = staff_unread + (case when v_waiting then 1 else 0 end)
    where id = p_conv;

  if v_waiting and v_staff_joined then return; end if;

  if v_text ~ '(call me|call back|callback|give me a call|phone call|can you call|call kar|talk on (the )?phone|speak on (the )?phone|by phone|over the phone)' then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot',
        case when coalesce(v_conv.visitor_role,'') in ('carrier','broker','shipper')
          then e'Absolutely — happy to get you on the phone! 📞\n\nYou can call us anytime, 24/7: ' || v_num || e' — answered on the first ring.\n\nOr drop your number below and WE call YOU — right now, or at a time you pick: 👇\n\n[[callform]]'
          else e'Absolutely — happy to get you on the phone! 📞\n\nCall us anytime, 24/7: ' || v_num || e'\n\nOr drop your number below and WE call YOU — right now, or at a time you pick: 👇\n\n[[callform]]'
        end);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  if (not v_waiting) and app_private.lc_is_human_request(p_text) then
    -- Ask what they do first: it decides who on the team picks this up.
    if v_conv.visitor_role is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body)
        values (p_conv, 'bot', e'Of course! 🤝 One quick thing so this reaches the right person — which one are you?' || v_role_chips);
      return;
    end if;
    if v_conv.name is null or v_conv.email is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body)
        values (p_conv, 'bot', e'Of course! Real quick so our team picks this up properly — your name and best email: 👇' || v_contact_form);
      return;
    end if;
    perform app_private.lc_do_handoff(p_conv, 'human requested');
    return;
  end if;

  if v_text ~ '^(hi|hii+|hello|helo|hey|hey there|hi there|hello there|salam|salaam|assalam.*|as-salam.*|good (morning|afternoon|evening)|howdy|yo|sup|whats up|what''s up)[[:punct:] ]*$' then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Hey! 👋 Welcome to LoadBoot — the operating system for trucking.' ||
        case when v_waiting then e'\nOur team is on the way — meanwhile I can answer anything.' else '' end ||
        case when v_conv.visitor_role is null then e'\n\nTo point you to the right things — which one are you?' || v_role_chips
             else e'\n\nWhat can I help you with today?' || v_help_chips end);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  if v_text ~ '^(thanks|thank you|thankyou|thx|ty|great|perfect|awesome|ok|okay|bye|goodbye|see you|good night|email works.*)[[:punct:] ]*$' then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Anytime! 🚚 I''m here whenever you need' || case when v_waiting then ' — and our team will still follow up here.' else '.' || e'\n\n[[chips:🙋 Talk to a person=I want to talk to a real person|💰 Pricing=What does LoadBoot cost?]]' end);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  v_email := (select (regexp_match(coalesce(p_text,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]);
  if v_email is not null and v_conv.email is null then
    update app_private.lc_conversations set email = v_email, lead_stage = 'done' where id = p_conv;
    perform app_private.lc_capture_lead(p_conv);
    if v_conv.pending_human then
      perform app_private.lc_do_handoff(p_conv, 'human requested');
      return;
    end if;
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Perfect — saved! ✅ Our team will follow up at ' || v_email || ' with next steps' ||
        case when v_conv.visitor_role = 'carrier' then ' (and current lane rates)' when v_conv.visitor_role = 'broker' then ' (and how free posting works)' else '' end ||
        '. Meanwhile, keep asking me anything!' || v_help_chips);
    return;
  end if;

  if v_conv.visitor_role is null
     and v_text !~ '(what|how|why|when|where|which|require|onboard|cost|price|fee|need|\?)' then
    v_role := case
      when v_text ~ 'owner[- ]?operator|\mcarrier\M|my truck|my authority|i drive' then 'carrier'
      when v_text ~ '\mbroker' then 'broker'
      when v_text ~ '\mshipper\M|i ship ' then 'shipper'
      when v_text ~ 'dispatcher|dispatching' then 'dispatcher'
      when v_text ~ 'referral|influencer' then 'referral'
      else null end;
    if v_role is not null and (length(v_text) <= 40 or v_text ~ '^(i''?m|i am|im|we are|we''?re)') then
      update app_private.lc_conversations set visitor_role = v_role, lead_stage = 'name', bot_misses = 0 where id = p_conv;
      -- They are mid-handoff: skip the marketing block, keep the thread moving.
      if v_conv.pending_human then
        if v_conv.name is null or v_conv.email is null then
          insert into app_private.lc_messages (conversation_id, sender, body)
            values (p_conv, 'bot', e'Got it 👍 Now your name and best email, so our team can pick this up properly: 👇' || v_contact_form);
        else
          perform app_private.lc_do_handoff(p_conv, 'human requested');
        end if;
        return;
      end if;
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
        (case v_role
          when 'carrier' then e'Awesome — welcome, carrier! 🚚 Here''s your fast lane:\n• Free account → verify (MC/DOT + insurance + W-9, ~1 day) → loads\n• Flat 5%, only on loads you actually get paid for\n• Live board, GPS proof, detention playbook, factoring support\nStart here: https://loadboot.com/create-carrier-account.html'
          when 'broker' then e'Great — brokers post 100% free here. 🏢\n• Verified carriers only (authority + insurance checked at booking)\n• Zero ghost trucks, GPS on every load, geofenced timestamps\nPost your first test load: https://loadboot.com/create-broker-account.html'
          when 'shipper' then e'Welcome! 📦 Shippers post freight directly to verified carriers — no broker needed.\n• Live GPS visibility door to door\n• Clean documents on every shipment (BOL → POD)\nStart: https://loadboot.com/create-shipper-account.html'
          when 'dispatcher' then e'Nice — dispatchers have two great doors here: 🧑‍✈️\n• Work as a LoadBoot dispatcher (salaried roles): https://loadboot.com/careers.html\n• Independent? Join as an Agent and earn 1% of every delivered load your clients move: https://loadboot.com/create-agent-account.html'
          else e'Love it — the referral program pays you from OUR fee, your people never pay extra. 📣\n• 1% of gross on every delivered load you refer\n• One link for carriers, brokers and shippers + live earnings tracking\nJoin: https://loadboot.com/create-agent-account.html'
        end) || e'\n\nWant our team to personally follow up? Drop your details: 👇' ||
        case when v_conv.email is null then v_contact_form else '' end);
      return;
    end if;
  end if;

  v_ans := app_private.lc_bot_answer(p_text);
  if v_ans is not null then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_ans);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  if v_conv.lead_stage = 'name' and length(trim(coalesce(p_text,''))) between 2 and 40 and coalesce(p_text,'') !~ '\?' then
    v_first := initcap(regexp_replace(trim(p_text), '^(my name is|i am|i''?m|im|this is)\s+', '', 'i'));
    update app_private.lc_conversations set name = v_first, lead_stage = 'email' where id = p_conv;
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Great to meet you, ' || v_first || '! 🤝 Drop your best email below — our team will send your setup guide and current rates there. 👇' || e'\n\n[[form:email]]');
    return;
  end if;

  perform app_private.lc_log_miss(p_text);
  if v_waiting then
    if not exists (select 1 from app_private.lc_messages
                   where conversation_id = p_conv and sender = 'bot' and body like '✓ Our team has been notified%') then
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_ack);
    end if;
    return;
  end if;
  if v_conv.bot_misses >= 1 then
    if v_conv.name is null or v_conv.email is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body)
        values (p_conv, 'bot', e'I want you to get an exact answer from our team — real quick, your name and best email so they can pick this up: 👇' || v_contact_form);
      return;
    end if;
    perform app_private.lc_do_handoff(p_conv, 'bot could not answer');
  else
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', e'Hmm, let me make sure I get you the right thing — I''m great with: pricing & the 5% fee · finding/posting loads · verification & documents · payments, factoring & detention · GPS tracking · dispatch & careers · taxes (IFTA, 2290) · fleet tools.\n\nTry one of these, or rephrase your question:' ||
        e'\n\n[[chips:🙋 Talk to a person=I want to talk to a real person|✅ Get verified=How do I get verified?|💰 Pricing=What does LoadBoot cost?|🚚 Find loads=How do I find loads for my truck?|📦 Post a load=How do I post a load?]]');
    update app_private.lc_conversations set bot_misses = bot_misses + 1 where id = p_conv;
  end if;
end $function$;

-- The handoff now ends on a menu of real doors, not a dead end.
create or replace function app_private.lc_do_handoff(p_conv uuid, p_reason text default 'requested'::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare c app_private.lc_conversations; pr app_private.lc_presence;
        v_msg text; v_num text; v_opts text; v_phone_ok boolean;
begin
  select * into c from app_private.lc_conversations where id = p_conv;
  select * into pr from app_private.lc_presence where id = 1;
  v_num := coalesce(nullif(app_private.lc_phone_display(),''), '');
  v_phone_ok := coalesce(c.visitor_role,'') in ('carrier','broker','shipper') or c.visitor_role is null;

  if pr.available then
    v_msg := 'You''re in luck — ' || coalesce(pr.staff_name,'our teammate') ||
      case when pr.designation is not null then ', our ' || pr.designation else '' end ||
      ', is online right now. 🤝 Connecting you — they''ll reply right here in a moment.';
  else
    v_msg := 'Our team is away from the desk right now — but your question is saved word-for-word' ||
      case when c.email is not null then ', and they''ll email you a detailed answer at ' || c.email || ' shortly.' else ' and they''ll follow up shortly.' end;
  end if;

  -- Every door, on one screen: call us, we call you (now or booked), or email.
  v_opts := e'\n\nWhatever is easiest for you right now:' ||
    case when v_num <> '' then e'\n\n📞  Call us 24/7 — ' || v_num || ' (answered on the first ring)' else '' end ||
    e'\n📧  Email — hello@loadboot.com, or just keep typing here';
  if v_phone_ok then
    v_opts := v_opts || e'\n📲  Or we call you — right now, or at a date and time you pick 👇\n\n[[callform]]';
  else
    v_opts := v_opts || e'\n\nDispatcher and referral questions are handled in writing, so you''ll get a proper written answer.';
  end if;

  insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_msg || v_opts);
  update app_private.lc_conversations set mode='human', pending_human=false, staff_unread = staff_unread + 1, last_msg_at = now() where id = p_conv;
  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','livechat.handoff',
      jsonb_build_object('title', case when pr.available then '🙋 Live chat handed to ' || coalesce(pr.staff_name,'you') || ' — reply NOW' else '🙋 Live chat needs follow-up (team offline)' end,
        'body', coalesce(c.name,'Visitor') || coalesce(' <'||c.email||'>','') || ' · ' || coalesce(c.visitor_role,'unknown role') || ' · ' || p_reason,
        'tone','urgent','url','/live-chat'), 'sent', now());
  exception when others then null; end;
end $function$;
