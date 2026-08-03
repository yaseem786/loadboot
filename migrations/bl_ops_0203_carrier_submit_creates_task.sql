-- bl_ops_0203 — carrier onboarding submissions never created a review task.
-- Applied to production 2026-08-03.
--
-- The carrier-side submit (cc_pocket_submit_onboarding) emits 'carrier.onboarding_submitted'.
-- Nothing listened to it: the rule wired for carrier self-submission listened to
-- 'carrier.submitted' (an event no code emits) AND was disabled; the enabled rule
-- 'onboarding_started_review' listens to 'carrier.onboarding_started', which only the
-- STAFF-side cc_start_onboarding emits. Net effect: staff got a bell notification and a
-- dispatch@ email, but the Task queue — the thing with SLA and escalation — stayed empty
-- for every self-service carrier submission ever made.

update app_private.automation_rules
   set trigger_event = 'carrier.onboarding_submitted',
       enabled = true,
       name = 'Carrier submitted onboarding -> compliance review task'
 where key = 'carrier_submitted_onboarding_task';
