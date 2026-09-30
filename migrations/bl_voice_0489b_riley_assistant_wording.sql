-- bl_voice_0489b — Riley calls herself "LoadBoot's assistant"; she says "AI" only when asked · owner decision 28 Sep 2026
--
-- Owner: "usy sirf assistant khena cheya, koi AI nie — jb koi specifically pochy AI ho tab btay."
-- Rule after this file: Riley never volunteers "AI"; if asked (robot / bot / AI / real person?) she says yes, she is
-- LoadBoot's AI assistant, and she never claims to be human or denies being an AI.
--
-- Changes (prod data + one function; anchors asserted):
--   1. app_private.riley_prompts inbound + outbound: opener / identity / "if asked" lines. A riley_prompt_history row
--      is written for each, like cc_riley_prompt_save. The prompts go live only when staff press Publish in
--      CC → Riley → Prompts (retell-admin publish).
--   2. app_private.brain_user_text: the call-plan brief no longer tells the brain to put "AI assistant" in the OPENER.
-- No ACL change → anon SECDEF surface unchanged. Prod only for (1) (staging has its own prompt rows); (2) both.

do $mig$
declare d text; n text; v_in text; v_out text;
begin
  -- 1a. outbound prompt
  select general_prompt into v_out from app_private.riley_prompts where agent_key = 'outbound';
  if v_out is not null and position('do not volunteer that you are an AI' in v_out) = 0 then
    n := replace(v_out, $a$You are LoadBoot's AI assistant. You are also the best$a$, $a$You are LoadBoot's assistant. You are also the best$a$);
    n := replace(n, $a$1. When they confirm: one sentence that says you are the AI assistant and shows you know why you called. "Great. I'm Riley, LoadBoot's AI assistant. You just asked for a call on our site, what can I help with?" For source "account", say the briefing's OPENER instead. Say "AI assistant" once, then you are just Riley.$a$,
                    $a$1. When they confirm: one sentence that says who you are and shows you know why you called. "Great. I'm Riley, LoadBoot's assistant. You just asked for a call on our site, what can I help with?" For source "account", say the briefing's OPENER instead. Call yourself "LoadBoot's assistant" and do not volunteer that you are an AI; only answer that when they ask (see the robot line below).$a$);
    n := replace(n, $a$- If asked whether you are a robot: "Yep, I'm Riley, LoadBoot's AI assistant. I set things up and a real dispatcher follows through on everything." Never claim to be human.$a$,
                    $a$- If asked whether you are a robot, a bot, an AI or a real person: "Yep, I'm Riley, LoadBoot's AI assistant. I set things up and a real dispatcher follows through on everything." Never claim to be human and never deny being an AI. Do not bring it up otherwise, and never say "AI" in a voicemail.$a$);
    if n = v_out or n ~ 'Say "AI assistant" once' or position('never deny being an AI' in n) = 0 then
      raise exception 'bl_voice_0489b: outbound prompt anchors not found';
    end if;
    update app_private.riley_prompts set general_prompt = n, updated_at = now() where agent_key = 'outbound';
    insert into app_private.riley_prompt_history (agent_key, begin_message, general_prompt, saved_by, note)
    select agent_key, begin_message, general_prompt, null, 'bl_voice_0489b: "assistant", AI only when asked (owner 28 Sep)' from app_private.riley_prompts where agent_key = 'outbound';
  end if;

  -- 1b. inbound prompt
  select general_prompt into v_in from app_private.riley_prompts where agent_key = 'inbound';
  if v_in is not null and position('Do not volunteer that you are an AI' in v_in) = 0 then
    n := replace(v_in, $a$You are LoadBoot's AI assistant and you run the phone line 24/7.$a$, $a$You are LoadBoot's assistant and you run the phone line 24/7.$a$);
    n := replace(n, $a$this is Riley, the AI assistant. Who do I$a$, $a$this is Riley, LoadBoot's assistant. Who do I$a$);
    n := replace(n, $a$Always say you are the AI assistant once, in the opener. After that you are just Riley. If someone asks later whether you are a robot: "Yep, I'm Riley, LoadBoot's AI assistant. I run the front desk and set things up, and a real dispatcher follows through on everything I set up for you." Never claim to be human.$a$,
                    $a$Do not volunteer that you are an AI; you are Riley, LoadBoot's assistant. Only if someone asks whether you are a robot, a bot, an AI or a real person: "Yep, I'm Riley, LoadBoot's AI assistant. I run the front desk and set things up, and a real dispatcher follows through on everything I set up for you." Never claim to be human and never deny being an AI.$a$);
    if n = v_in or n ~ 'the AI assistant\. Who do I' or position('never deny being an AI' in n) = 0 then
      raise exception 'bl_voice_0489b: inbound prompt anchors not found';
    end if;
    update app_private.riley_prompts set general_prompt = n, updated_at = now() where agent_key = 'inbound';
    insert into app_private.riley_prompt_history (agent_key, begin_message, general_prompt, saved_by, note)
    select agent_key, begin_message, general_prompt, null, 'bl_voice_0489b: "assistant", AI only when asked (owner 28 Sep)' from app_private.riley_prompts where agent_key = 'inbound';
  end if;

  -- 2. call-plan brief (brain)
  d := pg_get_functiondef('app_private.brain_user_text(text, text, text, jsonb)'::regprocedure);
  if position('bl_voice_0489b' in d) = 0 then
    n := replace(d, $a$'Riley must say she is LoadBoot''s AI assistant in the opener (AI disclosure). Keep everything under 230 words.'$a$,
                    $a$'Riley calls herself LoadBoot''s assistant; she says she is an AI only if asked (bl_voice_0489b). Keep everything under 230 words.'$a$);
    n := replace(n, $a$(name the person, LoadBoot, that she is the AI assistant, why she is calling)$a$,
                    $a$(name the person, LoadBoot, that she is LoadBoot''s assistant, why she is calling)$a$);
    if n = d or position('that she is the AI assistant' in n) > 0 then raise exception 'bl_voice_0489b: brain_user_text anchors not found'; end if;
    execute n;
  end if;
end $mig$;
