-- bl_ops_0508 — the owner's test dispatcher (Asim Latif) gets his trial window back so the trial daily
-- report (bl_disp_0485, cron lb-disp-trial-daily, jobid 66) reaches the test inbox again. Owner 30 Sep: "item 1 chala do".
--
-- Trial was 10 Sep → 24 Sep; status still 'trial'. disp_trial_daily_run only picks rows with
-- trial_end >= today (ET), so nothing has gone out since 25 Sep (no disp_trial_daily row ever existed).
-- New trial_end = 9 Oct 2026. First report: next weekday 08:00 ET.
--
-- Mirrors cc_dispatcher_set_terms (which needs a staff JWT): profile update + terms log + audit.
-- Its disp_notify ("Your terms were updated") is left out on purpose — nothing about the terms changed.
-- Checked before applying: the only trigger on dispatcher_profiles (trg_dispatcher_applied_email) fires on
-- status 'screening' only; nothing else reads trial_end to send mail except the daily report.
-- email_gate('dispatcher.trial.daily', asimmr749@gmail.com) = allowed (account_critical).
-- Side effect: a day with no activity turns the report red, and a red report also sends
-- 'dispatcher.trial.alert' to disp_trial_staff_to() (dispatch@). Prod only — staging has no such profile.
update app_private.dispatcher_profiles
   set trial_end = date '2026-10-09', updated_at = now()
 where user_id = '2f5ef591-2f1a-41dc-84df-de79f3438661' and full_name = 'Asim Latif' and status = 'trial'
   and trial_end = date '2026-09-24';

insert into app_private.dispatcher_terms_log (dispatcher_user_id, commission_pct, trial_start, trial_end, set_by, note)
select user_id, commission_pct, trial_start, trial_end, null, 'bl_ops_0508: test dispatcher trial extended to 9 Oct (owner)'
  from app_private.dispatcher_profiles
 where user_id = '2f5ef591-2f1a-41dc-84df-de79f3438661' and trial_end = date '2026-10-09'
   and not exists (select 1 from app_private.dispatcher_terms_log l
                    where l.dispatcher_user_id = '2f5ef591-2f1a-41dc-84df-de79f3438661' and l.note like 'bl_ops_0508:%');

select app_private.disp_audit('dispatcher.terms', 'dispatcher', '2f5ef591-2f1a-41dc-84df-de79f3438661', null,
  'trial_end 2026-09-24 → 2026-10-09 (owner test dispatcher; daily report back on)', jsonb_build_object('migration', 'bl_ops_0508'));
