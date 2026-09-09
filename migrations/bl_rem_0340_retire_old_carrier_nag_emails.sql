-- bl_rem_0340_retire_old_carrier_nag_emails
--
-- Two systems now know how to email a carrier about onboarding. Exactly one should.
--
-- public.cc_run_onboarding_reminders (cron, 14:00 UTC) has been sending carriers:
--   onboarding.confirm_email -> now carrier.reminder.confirm_email
--   onboarding.reminder      -> now carrier.reminder.docs_start / docs_finish / docs_fix
-- Both are replaced by the reminder engine, which has premium templates, a preview,
-- a manual button and one cadence. Left alone, a carrier gets both on the same day.
--
-- What the old cron KEEPS doing, because the engine deliberately does not:
--   * onboarding.in_review — the "your documents are with our compliance team,
--     nothing needed from you" reassurance. Not a nag; the engine is silent there
--     on purpose, because the ball is on our side.
--   * the staff alert when a carrier is fully verified and waiting on activation.
--   * the whole AGENT onboarding loop, which the engine does not cover at all.
--   * the in-app notification bell and the onboarding_reminders_sent bookkeeping.
--
-- METHOD, and why it is this and not a rewrite:
--   The function is ~200 lines and most of it must keep working. So this rewrites it
--   from its OWN source and swaps only the two email calls for a no-op of identical
--   signature. Nothing else can drift by transcription.
--
--   The obvious edit — guarding on 'if not v_confirmed then' — was checked and
--   REJECTED: that string occurs TWICE, once in the carrier loop and once in the
--   agent loop, so a plain replace would have silently killed agent activation
--   emails too. The anchors below are counted before use and the migration aborts
--   rather than guess.
--
-- To revert: swap sys_email_retired back to sys_email at the two call sites.

create or replace function app_private.sys_email_retired(
  p_to text, p_template text, p_subject text, p_html text, p_text text, p_idem text
) returns void
language sql
immutable
as $fn$ select null::void; $fn$;

comment on function app_private.sys_email_retired(text, text, text, text, text, text) is
  'No-op with sys_email''s signature. Marks a send that has been taken over by another system (bl_rem_0340: carrier onboarding email moved to the reminder engine).';

do $$
declare src text; nsrc text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'cc_run_onboarding_reminders';
  if src is null then raise exception 'cc_run_onboarding_reminders not found'; end if;
  nsrc := src;

  select count(*) into n from regexp_matches(nsrc, 'sys_email\(r\.email, ''onboarding\.confirm_email''', 'g');
  if n <> 1 then raise exception 'anchor 1 matched % times, expected 1 - refusing to guess', n; end if;
  nsrc := replace(nsrc,
    'sys_email(r.email, ''onboarding.confirm_email''',
    'sys_email_retired(r.email, ''onboarding.confirm_email''');

  -- 'onboarding.reminder' also appears as a notification template_key, so the
  -- anchor includes the sys_email call itself.
  select count(*) into n from regexp_matches(nsrc, 'sys_email\(r\.email, ''onboarding\.reminder''', 'g');
  if n <> 1 then raise exception 'anchor 2 matched % times, expected 1 - refusing to guess', n; end if;
  nsrc := replace(nsrc,
    'sys_email(r.email, ''onboarding.reminder''',
    'sys_email_retired(r.email, ''onboarding.reminder''');

  -- the reassurance and the agent emails must survive untouched
  select count(*) into n from regexp_matches(nsrc, 'sys_email\(r\.email, ''onboarding\.in_review''', 'g');
  if n <> 1 then raise exception 'in_review email went missing - aborting'; end if;
  select count(*) into n from regexp_matches(nsrc, 'sys_email\(r\.email, ''agent\.', 'g');
  if n <> 2 then raise exception 'agent emails: expected 2, found % - aborting', n; end if;

  execute nsrc;
end $$;
