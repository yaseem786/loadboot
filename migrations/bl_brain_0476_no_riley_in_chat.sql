-- bl_brain_0476 — no "Riley" in live chat (owner, 27 Sep 2026).
--
-- Owner: "chat mein koi naam Riley nahi hona chahiye". Riley is the phone line's persona (Retell). The chat's
-- general desk is now plain "LoadBoot Support" with no personal name. Widget v6 → bl_lc_0476 in the same commit
-- (header, avatar, welcome, who-line). This file fixes the two places the MODEL is told it is Riley:
--   1. app_private.brain_user_text — the 'chat' renderer's persona line (bl_brain_0473 / 0474)
--   2. rule.chat_specialists      — the desk list in brain_permissions (bl_brain_0475)
-- Both are patched by anchor on the live definition, so staging and prod take the same file whatever else
-- changed around them. enabled/mode/status of the rule row are NOT touched (prod keeps it parked OFF until the
-- v6 widget is on the live site — claude/LIVECHAT-V6-0475.md).
-- No public function is created or changed → the anon-executable SECURITY DEFINER surface stays 36/35.

begin;

-- ── 1. persona line in the chat prompt renderer ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('app_private.brain_user_text(text,text,text,jsonb)'::regprocedure);
  v_old text := 'You are answering as Riley, LoadBoot''''s live-chat assistant, inside the website / portal chat widget.';
  v_new text := 'You are answering as the LoadBoot assistant ("LoadBoot Support") inside the website / portal chat widget. '
             || 'You have no personal name — never call yourself Riley (Riley is the phone line, not the chat).';
  v_n   int;
begin
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then
    raise exception 'bl_brain_0476: expected the Riley persona anchor exactly once in brain_user_text, found %', v_n;
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ── 2. the desk list the model follows (rule row; text only, flags untouched) ──────────────────────────────
update app_private.brain_permissions
   set description = replace(replace(description,
         '[[as:general]] Riley — greetings, general questions, anything that fits no desk; ',
         '[[as:general]] LoadBoot Support — no personal name, never "Riley" — greetings, general questions, anything that fits no desk; '),
         'Sign off as that name only, never as "the AI".',
         'Sign off as that desk''s name only (the general desk signs as "LoadBoot Support"), never as "the AI" and never as "Riley".'),
       note = replace(note, 'Switch off to go back to a single "Riley" voice.', 'Switch off to go back to the single "LoadBoot Support" voice.'),
       updated_at = now()
 where key = 'rule.chat_specialists';

do $$
declare v_desc text;
begin
  select description into v_desc from app_private.brain_permissions where key = 'rule.chat_specialists';
  if v_desc is null or v_desc ilike '%Riley — greetings%' then
    raise exception 'bl_brain_0476: rule.chat_specialists still names Riley as the general desk';
  end if;
  perform app_private.brain_log('rule.chat_specialists', 'set', '{"general_desk":"Riley"}'::jsonb,
    '{"general_desk":"LoadBoot Support"}'::jsonb, 'bl_brain_0476: no "Riley" in chat — general desk is LoadBoot Support (owner, 27 Sep 2026)');
end $$;

-- ── 3. proof ────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare v_def text := pg_get_functiondef('app_private.brain_user_text(text,text,text,jsonb)'::regprocedure);
begin
  if v_def ilike '%answering as Riley%' then raise exception 'bl_brain_0476: brain_user_text still says Riley'; end if;
end $$;

commit;
