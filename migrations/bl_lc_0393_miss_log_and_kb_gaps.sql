-- bl_lc_0393 — live chat: make the miss log actually log, and close two real KB gaps
--
-- WHY (audit 22 Sep 2026, production):
--   app_private.lc_misses has ZERO rows — ever. app_private.lc_log_miss() exists and is
--   correct, but NOTHING calls it: not lc_bot_step, not lc_escalate, not the watchdog.
--   So cc_lc_misses() / cc_lc_teach() — the whole "teach the bot" screen in Command Center —
--   has been reading an empty table since the day it shipped, and the bot has never had a
--   way to get better from what it failed to answer.
--
--   Two misses found by hand in the open conversations, both of which the bot answered
--   CONFIDENTLY AND WRONG (which is why neither would have been logged even if the log
--   worked — the matcher returned a low-quality hit instead of no hit):
--     · "What about the factory fee?"  (asked twice, 21 + 22 Sep, then the visitor asked
--       for a human) — "factory" is how people misspell "factoring". The factoring row's
--       patterns only had 'factoring'/'factor', so it fell through to the 5%-pricing row.
--     · "Who will pay me first" — the payments row has 'who pays me', which does not match
--       'who will pay me'. Fell through to pricing as well.
--
-- NOT fixed here, deliberately — it needs a decision, not a patch: the matcher prefers a
-- weak wrong answer over admitting a miss. Until that changes, lc_misses only captures the
-- questions that produced NO hit at all, not the ones that produced a bad hit.

-- ── a) the escalation IS the miss ────────────────────────────────────────────────────
do $patch$
declare d text;
begin
  d := pg_get_functiondef('app_private.lc_escalate(uuid,text)'::regprocedure);
  if position('lc_log_miss' in d) = 0 then
    d := replace(d,
      '  update app_private.lc_conversations set bot_misses = 0 where id = p_conv;',
      '  perform app_private.lc_log_miss((select m.body from app_private.lc_messages m
                                    where m.conversation_id = p_conv and m.sender = ''visitor''
                                    order by m.id desc limit 1));
  update app_private.lc_conversations set bot_misses = 0 where id = p_conv;');
    execute d;
  end if;
end $patch$;

-- ── b) the two gaps, as extra patterns on the rows that already hold the right answer ─
update app_private.lc_kb
   set patterns = patterns || array['factory fee','factory charges','factory charge',
                                    'factoring fee','factoring charges','what is the factory fee',
                                    'what about the factory fee']
 where patterns @> array['factoring'] and not (patterns @> array['factoraje'])   -- English row only
   and not (patterns @> array['factory fee']);

update app_private.lc_kb
   set patterns = patterns || array['who will pay me','who will pay me first','who pays first',
                                    'who pay me','who is paying me','who will pay']
 where patterns @> array['who pays me'] and not (patterns @> array['who will pay me']);
