-- bl_voice_0521 — Riley Outbound: no voicemail on someone else's mailbox; the briefing beats the canned lines · 1 Oct 2026
--
-- WHY. Call 399 (1 Oct, to the FMCSA phone on TQL's active record, 513-495-6760) reached a TQL employee's personal
-- mailbox ("Hi, this is Brad ... please leave a message"). The briefing said "do not leave a voicemail on a general
-- company mailbox" and gave its own voicemail line for Isaac. Riley still left "Hi Brad, it's Riley from LoadBoot
-- following up with you ..." — it took the mailbox owner's name from the greeting, and "following up" from the
-- source "cc" line. Three gaps in the outbound prompt:
--   1. the voicemail rule had one canned line and no "whose mailbox is this?" check;
--   2. the briefing's own OPENER / VOICEMAIL / rules had no stated priority over the canned source lines;
--   3. the default voicemail said "returning your request" for every source, against the prompt's own rule
--      (only website / chat may claim the person asked for the call).
-- Also: a receptionist / phone menu was treated as "wrong person" ("I'll try later"), so a switchboard call ended
-- before it was transferred.
--
-- WHAT. Text-only patch of app_private.riley_prompts['outbound'].general_prompt (three anchors, each asserted —
-- abort if missing) + a history row, same as a CC save. Nothing is live until Riley Outbound is PUBLISHED
-- (CC → Riley → Prompts → Publish to Retell; retell-admin needs a staff JWT). Inbound is untouched.
-- No function / grant change: anon SECURITY DEFINER surface unaffected. Idempotent: skips when already patched.

do $$
declare
  v text;
  a1 text := 'Never claim they requested a call unless the source is website or chat. If they seem confused about why you are calling, say plainly which of the above is true.';
  a2 text := '- Wrong person answers: "Oh, is {{name}} around? ... No worries, I''ll try later. Have a good one." Never discuss business with anyone but {{name}}.';
  a3 text := '- Voicemail or silence: ONE short line. "Hi {{name}}, it''s Riley from LoadBoot returning your request. Find us any time at loadboot dot com, or reply to our email. Talk soon." Then end. Never a second voicemail the same day. For source "account" the line is: "Hi {{name}}, it''s Riley from LoadBoot about your carrier account. Everything is on loadboot dot com, or just reply to our email. Talk soon."';
begin
  select general_prompt into v from app_private.riley_prompts where agent_key = 'outbound';
  if v is null then raise exception 'bl_voice_0521: outbound prompt row missing'; end if;
  if position('BRIEFING BEATS THE CANNED LINES' in v) > 0 then raise notice 'bl_voice_0521: already applied'; return; end if;
  if position(a1 in v) = 0 then raise exception 'bl_voice_0521: anchor 1 (source rule) not found'; end if;
  if position(a2 in v) = 0 then raise exception 'bl_voice_0521: anchor 2 (wrong person) not found'; end if;
  if position(a3 in v) = 0 then raise exception 'bl_voice_0521: anchor 3 (voicemail) not found'; end if;

  v := replace(v, a1, a1 || E'\n\n' ||
    'BRIEFING BEATS THE CANNED LINES: when the briefing gives an OPENER, its own VOICEMAIL line or RULES, follow the briefing over the source lines above and the edge-case lines below. Never say "following up" or imply an earlier conversation unless the briefing says there was one.');

  v := replace(v, a2, a2 || E'\n' ||
    '- A receptionist, switchboard or phone menu answers (a company name, "how may I direct your call", "press 1 for ..."): that is not the wrong person, it is the way in. Ask for {{name}} by name and wait to be transferred; to a menu say "operator" or "representative". If the briefing says what to ask a receptionist, ask exactly that. Share account details only with {{name}}.');

  v := replace(v, a3,
    '- Voicemail or silence: listen to the greeting first. If it names someone who is not {{name}}, or it is a company, department or general mailbox, it is NOT their mailbox: leave no message at all, just end the call. Never address a voicemail to a name you only heard in the greeting. If it is {{name}}''s mailbox, or a plain greeting with no name, leave ONE short line and end: if the briefing has a VOICEMAIL line, say exactly that line. Otherwise, for source "website" or "chat": "Hi {{name}}, it''s Riley from LoadBoot returning your request. Find us any time at loadboot dot com, or reply to our email. Talk soon." For source "account": "Hi {{name}}, it''s Riley from LoadBoot about your carrier account. Everything is on loadboot dot com, or just reply to our email. Talk soon." For any other source: "Hi {{name}}, it''s Riley from LoadBoot. Find us any time at loadboot dot com, or just reply to our email. Talk soon." Never a second voicemail the same day.');

  update app_private.riley_prompts set general_prompt = v, updated_at = now() where agent_key = 'outbound';
  insert into app_private.riley_prompt_history (agent_key, begin_message, general_prompt, saved_by, note)
  select agent_key, begin_message, general_prompt, null,
         'bl_voice_0521: no voicemail on someone else''s mailbox; briefing beats canned lines; switchboard handling'
    from app_private.riley_prompts where agent_key = 'outbound';
end $$;
