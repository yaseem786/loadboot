-- bl_voice_0524 — Riley Outbound: silent on menus and hold, picks the right menu option · 1 Oct 2026
--
-- WHY. Call 412 (1 Oct, TQL main line, 475 s, after bl_voice_0522 was published) reached the menu and the hold queue:
--   * Riley talked over the recording 7 times ("I'm trying to reach Isaac Clark. Can you connect me ...",
--     "Operator, please") - the receptionist line told her to ask a "menu" for the person and say "operator";
--   * she first took "driver or dispatcher, press 1" (TQL's carrier line), then the menu again, then 2 (client service);
--   * on hold she answered the recordings ("Thanks. I'll hold", "No problem, I'll hold") and asked "Are you still
--     there? No rush" - the warm-check line plus Retell's own silence reminder (cleared in retell-admin, this change).
--
-- WHAT. Text-only patch of app_private.riley_prompts['outbound'].general_prompt, three anchors, each asserted:
--   1. receptionist line: a live person only; a recording goes to the PHONE MENU rule;
--   2. PHONE MENU line (bl_voice_0522) replaced: silence on any recording, option order, options never to pick,
--      hold handling, when to give up;
--   3. "Still there? No rush." only with a live person who asked her to hold.
-- History row as a CC save. Nothing is live until Riley Outbound is PUBLISHED (CC -> Riley -> Prompts -> Publish).
-- Inbound untouched. No function / grant change: anon SECURITY DEFINER surface unaffected. Idempotent.

do $$
declare
  v text;
  a1 text := 'Ask for {{name}} by name and wait to be transferred; to a menu say "operator" or "representative".';
  a2 text := '- PHONE MENU (IVR): a recorded menu is not a person - do not talk over it and never leave a message on it. Listen to the whole menu, then use the press_digit tool to pick the option for an operator, "all other calls", or the department the briefing names; if the menu asks you to say something, say "operator" or "representative". If no option fits, press 0 once. Never key in account, payment, PIN or extension numbers you were not given. On hold or during music, stay silent and wait. When a person answers, start again with the briefing''s OPENER. If after about 3 minutes of menus and hold there is still no person, end the call without a message.';
  a3 text := 'One warm check at most: "Still there? No rush."';
begin
  select general_prompt into v from app_private.riley_prompts where agent_key = 'outbound';
  if v is null then raise exception 'bl_voice_0524: outbound prompt row missing'; end if;
  if position('PHONE MENU AND HOLD' in v) > 0 then raise notice 'bl_voice_0524: already applied'; return; end if;
  if position(a1 in v) = 0 then raise exception 'bl_voice_0524: anchor 1 (receptionist line, bl_voice_0521) not found'; end if;
  if position(a2 in v) = 0 then raise exception 'bl_voice_0524: anchor 2 (PHONE MENU line, bl_voice_0522) not found'; end if;
  if position(a3 in v) = 0 then raise exception 'bl_voice_0524: anchor 3 (warm check) not found'; end if;

  v := replace(v, a1,
    'If a live person answers, ask for {{name}} by name and wait to be transferred. A recording is never a receptionist: follow PHONE MENU AND HOLD below.');

  v := replace(v, a2,
    '- PHONE MENU AND HOLD: a recording is not a person. It is a recording when you hear "thank you for calling", "your call may be recorded", "press 1 for", "if you know your party''s extension", "please hold", "your call is important to us", "a representative will be with you", an advert, or music. While a recording plays, say NOTHING at all: no greeting, no "I''m trying to reach", no "operator", no "thanks", no "I''ll hold", no "are you still there". Your only action on a recording is the press_digit tool; otherwise give an empty reply and keep listening. Never leave a message on a menu or hold line.' || E'\n' ||
    '  Pick the key with press_digit as soon as you hear the right option. Choose in this order: 1) a key the briefing names for this company''s menu; 2) operator, receptionist, "all other calls", customer service, client service, or "becoming a customer"; 3) the department the briefing names; 4) if nothing fits once the menu has played through, press 0 once. You are not their driver, dispatcher or carrier on a load: never pick options for drivers or dispatchers, check calls, carriers, available freight, load postings or post IDs, accounting or payments, or "currently on a load" emergencies, unless the briefing names that option. Never dial an extension, account, PO, PIN or payment number you were not given. Say "operator" or "representative" out loud only when the menu itself says you can speak your choice.' || E'\n' ||
    '  After "you are being transferred" or "please hold", stay silent through every hold message and all music. Speak only when a live person greets you (their name, "how can I help you", a question to you), then start with the briefing''s OPENER. If the same menu plays a third time, press 0 once. If there is still no live person after about 8 minutes, end the call without a message.');

  v := replace(v, a3, a3 || ' - only with a live person who asked you to wait; never on a recording, a menu or hold music.');

  update app_private.riley_prompts set general_prompt = v, updated_at = now() where agent_key = 'outbound';
  insert into app_private.riley_prompt_history (agent_key, begin_message, general_prompt, saved_by, note)
  select agent_key, begin_message, general_prompt, null, 'bl_voice_0524: silent on phone menus and hold; menu option order; warm check only with a person'
    from app_private.riley_prompts where agent_key = 'outbound';
end $$;
