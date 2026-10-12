-- PROD — bl_dial_0540 (item N: document decision SMS) — DO NOT RUN until the owner says "laga do"
-- Project: rwscphuhpjoudvljvmdk. Apply through a Claude session with the Supabase MCP (apply_migration) — not the
-- browser SQL editor (it mis-splits long plpgsql).
--
-- Checked read-only on prod 12 Oct: the compliance_decision_notify anchor is present, every dependency exists
-- (sms_compose, riley_plan_tz, dial_blocked, dial_e164, carrier_onboarding_state, carrier_mandatory_ok), sms_threads
-- has the columns the claim writes. SMS is OFF on prod (dialer_config.sms_enabled=false, no messaging profile) and this
-- file keeps it off: doc_sms_config.enabled=false, test mode on. Nothing can text a carrier until step 4.
--
-- ORDER:
--   1. apply_migration name 'bl_dial_0540_doc_decision_sms' = the WHOLE of migrations/bl_dial_0540_doc_decision_sms.sql
--      (env-neutral; it already carries the sms_clean fix staging got as bl_dial_0540_sms_clean_fix).
--   2. deploy edge function doc-sms-worker from supabase/functions/doc-sms-worker/index.ts, verify_jwt = FALSE
--      (pinged by pg_net like delivery-worker; takes no input). Needs TELNYX_API_KEY (already set for telnyx-sms).
--   3. the config block below (worker URL only — still OFF).
--   4. OWNER DECISIONS before switching on (one line each, below, commented out):
--      a) which LoadBoot line sends (must be on campaign CS3VIAJ's messaging profile) → line_id
--      b) dialer_config.sms_enabled = true + telnyx_messaging_profile_id (or doc_sms_config.messaging_profile_id)
--      c) first test on the owner's own number (test_numbers), then allow_all = true
--      d) optional: '—' → '-' in dialer_config.sms_first_msg_suffix. Same words; the em dash makes EVERY first text
--         UCS-2, so a first document text is 4 segments (detail dropped) instead of 2 (full detail). Affects the
--         first text of dispatcher SMS too (cheaper there as well).
--   5. merge to main (Netlify deploys CC: "SMS sent 10:42" line under each document on the carrier page).
-- AFTER: anon SECDEF must still read 36 with the baseline names (cc_doc_sms_status = authenticated only;
--   doc_sms_worker_claim / doc_sms_worker_done = service_role only).
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
-- ROLLBACK: select cron.unschedule('doc_sms_sweep'); update app_private.doc_sms_config set enabled=false;
--   (the hook only queues rows; with the cron gone nothing is sent. The tables can stay.)

-- ===================================================================== step 3 (execute_sql)
update app_private.doc_sms_config
   set worker_url = 'https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/doc-sms-worker', updated_at = now()
 where id = 1;

-- ===================================================================== step 4 — owner decides, one at a time
-- update app_private.doc_sms_config set line_id = '<dialer_lines.id on campaign CS3VIAJ>' where id = 1;
-- update app_private.dialer_config set sms_enabled = true, telnyx_messaging_profile_id = '<profile id>' where id = 1;
-- update app_private.doc_sms_config set enabled = true, allow_all = false, test_numbers = array['+1XXXXXXXXXX'] where id = 1;
-- update app_private.dialer_config set sms_first_msg_suffix = replace(sms_first_msg_suffix, '—', '-') where id = 1;
-- update app_private.doc_sms_config set allow_all = true where id = 1;   -- after the test text arrived
