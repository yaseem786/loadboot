-- bl_voice_0522 — Riley Outbound can get through a company phone menu (IVR) · 1 Oct 2026
--
-- WHY. Call 407 (1 Oct, TQL main line (800) 580-3101) hit TQL's recorded menu and Retell hung up after 31 s with
-- disconnection_reason "ivr_reached": the Riley Outbound agent had ivr_option = {action: hangup} and no key-press
-- tool. The same agent also had voicemail_option = {action: prompt} with its own canned line ("Hi {{name}}, it's
-- Riley from LoadBoot following up with you ...") — that, not the CC prompt, is what left "Hi Brad ..." on call 399,
-- so bl_voice_0521's voicemail rule could not take effect while it was set.
--
-- WHAT.
--   1. supabase/functions/retell-admin (publish, outbound only): adds the press_digit tool and clears ivr_option and
--      voicemail_option on every publish, so the CC prompt alone decides menus and voicemail and a dashboard edit
--      cannot quietly bring the canned voicemail back.
--   2. This file: one text rule in app_private.riley_prompts['outbound'] for menus and hold, after the switchboard
--      line from bl_voice_0521 (anchor asserted). History row as a CC save. Live only after Publish Outbound.
-- Inbound untouched. No function / grant change: anon SECURITY DEFINER surface unaffected. Idempotent.

do $$
declare
  v text;
  a1 text := 'If the briefing says what to ask a receptionist, ask exactly that. Share account details only with {{name}}.';
begin
  select general_prompt into v from app_private.riley_prompts where agent_key = 'outbound';
  if v is null then raise exception 'bl_voice_0522: outbound prompt row missing'; end if;
  if position('PHONE MENU (IVR):' in v) > 0 then raise notice 'bl_voice_0522: already applied'; return; end if;
  if position(a1 in v) = 0 then raise exception 'bl_voice_0522: anchor (bl_voice_0521 switchboard line) not found - apply 0521 first'; end if;

  v := replace(v, a1, a1 || E'\n' ||
    '- PHONE MENU (IVR): a recorded menu is not a person - do not talk over it and never leave a message on it. Listen to the whole menu, then use the press_digit tool to pick the option for an operator, "all other calls", or the department the briefing names; if the menu asks you to say something, say "operator" or "representative". If no option fits, press 0 once. Never key in account, payment, PIN or extension numbers you were not given. On hold or during music, stay silent and wait. When a person answers, start again with the briefing''s OPENER. If after about 3 minutes of menus and hold there is still no person, end the call without a message.');

  update app_private.riley_prompts set general_prompt = v, updated_at = now() where agent_key = 'outbound';
  insert into app_private.riley_prompt_history (agent_key, begin_message, general_prompt, saved_by, note)
  select agent_key, begin_message, general_prompt, null, 'bl_voice_0522: phone menu (IVR) and hold handling with press_digit'
    from app_private.riley_prompts where agent_key = 'outbound';
end $$;
