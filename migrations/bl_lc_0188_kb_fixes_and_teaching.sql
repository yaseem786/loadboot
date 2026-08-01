-- bl_lc_0188 — fixes found by reading a real dispatcher conversation, plus the three
-- questions the bot has failed to answer since launch.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Conversation 5d706b14 (Mirobid Mirsaidov, dispatcher, 1 Aug) surfaced these:
--
-- 1. KB answer 29 was still handing out +1 (737) 306-1175 — the retired Twilio line.
--    Answers now carry a {PHONE} token that lc_bot_answer expands from retell_config,
--    so a KB row can never go stale on the number again.
-- 2. KB answer 70 ("Start my 5-minute setup") asked the visitor to pick from
--    "carrier, broker, shipper or partner". "partner" is not a role lc_ob_save accepts,
--    and dispatcher — which is what this visitor actually was — was missing entirely. It
--    was also plain prose with no chips, so a visitor who did not see the onboarding card
--    had nothing to tap and fell through to the generic role branch. Now the list matches
--    lc_ob_save's real roles and every role is a one-tap chip.
-- 3. lc_identify greeted "Perfect, Mirobid Mirsaidov" — the full name, which no human
--    does — and promised a follow-up with no timeframe and no idea what would be in it.
--    Now: first name, one business day, and a role-specific line about what arrives.
-- 4. All three rows in lc_misses are taught and marked resolved.
--
-- lc_bot_answer is patched in place rather than redefined: only its final SELECT changes,
-- and an in-place rewrite cannot drift from whatever scoring version is live.

do $do$
declare src text;
begin
  src := pg_get_functiondef('app_private.lc_bot_answer(text)'::regprocedure);
  if position('{PHONE}' in src) = 0 then
    src := replace(src,
      'select answer from scored where s > 0 order by s desc, priority desc limit 1',
      'select replace(answer, ''{PHONE}'', coalesce(nullif(app_private.lc_phone_display(),''''), ''our 24/7 line''))
from scored where s > 0 order by s desc, priority desc limit 1');
    execute src;
  end if;
end $do$;

-- Any answer that hard-coded a number now uses the token.
update app_private.lc_kb
set answer = regexp_replace(answer, '\+1 \(\d{3}\) \d{3}-\d{4}', '{PHONE}', 'g')
where answer ~ '\+1 \(\d{3}\) \d{3}-\d{4}';

-- The setup prompt matches the roles the system actually supports, and is tappable.
update app_private.lc_kb
set answer = 'Love it — we can do the whole thing right here in chat. 🚀 About 5 minutes, no forms to hunt for.' || E'\n\n' ||
  'First: which one are you?' || E'\n\n' ||
  '[[chips:🚚 Carrier / Owner-operator=I''m a carrier|🏢 Broker=I''m a broker|📦 Shipper=I''m a shipper|🧑‍✈️ Dispatcher=I''m a dispatcher|📣 Referral partner=I''m interested in the referral program]]'
where id = 70;

-- First name, and a promise with a clock on it.
create or replace function public.lc_identify(p_id uuid, p_visitor_key text, p_name text, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_conv app_private.lc_conversations; v_email text; v_name text; v_first text; v_had_email boolean;
begin
  select * into v_conv from app_private.lc_conversations
    where id = p_id and (visitor_key = p_visitor_key or (auth.uid() is not null and user_id = auth.uid()));
  if v_conv.id is null then return jsonb_build_object('error','not found'); end if;
  v_name := left(nullif(trim(coalesce(p_name,'')),''), 120);
  v_email := (select (regexp_match(coalesce(p_email,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]);
  if p_email is not null and trim(p_email) <> '' and v_email is null then
    return jsonb_build_object('error','That email doesn''t look right — try again?');
  end if;
  if v_name is null and v_email is null then return jsonb_build_object('error','Enter your name or email'); end if;
  v_had_email := v_conv.email is not null;
  update app_private.lc_conversations
    set name = coalesce(v_name, name),
        email = coalesce(email, v_email),
        lead_stage = case when coalesce(email, v_email) is not null then 'done' else 'email' end,
        last_msg_at = now()
    where id = p_id;
  -- People go by their first name. "Perfect, Mirobid Mirsaidov" reads like a form letter.
  v_first := nullif(split_part(trim(coalesce(v_name, v_conv.name, '')), ' ', 1), '');
  insert into app_private.lc_messages (conversation_id, sender, body)
    values (p_id, 'visitor', '📇 ' || concat_ws(' · ', v_name, v_email));
  if v_email is not null and not v_had_email then
    perform app_private.lc_capture_lead(p_id);
  end if;
  if v_conv.pending_human then
    perform app_private.lc_do_handoff(p_id, 'human requested');
  elsif v_email is not null and not v_had_email then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_id, 'bot', 'Perfect' || coalesce(', ' || v_first, '') || ' — saved! ✅ Our team will email you at ' || v_email ||
        ' within one business day' ||
        case coalesce(v_conv.visitor_role,'')
          when 'carrier' then ' with your setup steps and this week''s lane rates.'
          when 'broker'  then ' with how free posting works and a login.'
          when 'shipper' then ' with how to post your first shipment.'
          when 'dispatcher' then ' about both routes — the salaried dispatcher roles and the 1% agent program.'
          when 'referral' then ' with your referral link and how payouts work.'
          else '.' end ||
        E'\n\nMeanwhile I''m right here — ask me anything.');
  else
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_id, 'bot', 'Thanks' || coalesce(', ' || v_first, '') || '! 🤝 Anything else I can help with?');
  end if;
  return jsonb_build_object('ok', true);
end $function$;

-- Teach the three questions the bot has never been able to answer.
insert into app_private.lc_kb (patterns, answer, priority) values
(array['tell me more','tell me more about it','more info','more details','explain more','go on','say more','can you elaborate'],
 'Happy to — what part? 👇' || E'\n\n' ||
 '[[chips:💰 Pricing=What does LoadBoot cost?|🚚 Finding loads=How do I find loads for my truck?|✅ Getting verified=How do I get verified?|💵 Getting paid=When do I get paid?|🙋 Talk to a person=I want to talk to a real person]]', 50),

(array['i have created my profile','i created my profile','i created my account','i already signed up','i made an account','account created','profile created','i registered already','i have signed up','just signed up','i already have an account'],
 'Nice — you''re further along than most. 🎉 Here''s exactly what happens next:' || E'\n' ||
 '1) We pull your FMCSA record from your MC/DOT automatically — nothing for you to do.' || E'\n' ||
 '2) Upload your certificate of insurance (COI) in the portal, and sign the W-9 + dispatch agreement digitally. That''s the only part waiting on you.' || E'\n' ||
 '3) Verification usually finishes within one business day, and then the live board opens up.' || E'\n\n' ||
 'Carrier portal: https://loadboot.com/app/carrier/ · Broker & shipper: https://loadboot.com/app/partner/' || E'\n' ||
 'Stuck on a document, or not sure what''s still missing? Tell me and I''ll get the team to check your file.', 55),

(array['kasa ho','kaisa ho','kaise ho','kese ho','kya haal hai','kya hal hai','app kaise hain','aap kaise hain','salam bhai','kesa hai','sab thik','sab theek'],
 'Haan ji, all good — thanks for asking! 🙌 I''m Riley, LoadBoot''s assistant, and I''m here 24/7.' || E'\n\n' ||
 'What can I do for you today?' || E'\n\n' ||
 '[[chips:🚚 I''m a carrier=I''m a carrier|🏢 I''m a broker=I''m a broker|🧑‍✈️ Dispatcher jobs=I''m a dispatcher|💰 Pricing=What does LoadBoot cost?]]', 45);

update app_private.lc_misses set resolved = true
where lower(question) in ('tell me more','i have created my profile on load boots','kasa ho');
