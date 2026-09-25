-- bl_lc_0394 — live chat alerts: ONE reminder, and only for a carrier or a broker
--
-- WHY (owner instruction + prod numbers, 22 Sep 2026):
--   hello@loadboot.com received 186 'chat.sla' emails in 13 days. One single conversation
--   (d4e7439e — no name, no email, no role, a visitor who left) generated 46 of them on its
--   own; another 30; another 26. The inbox was being buried by a reminder that re-fired every
--   30 minutes, forever, for every visitor regardless of who they were.
--
--   Two causes, both fixed here:
--     1. REPEAT — lc_sla_alert and lc_do_handoff both re-alerted every 30 minutes for as long
--        as the conversation stayed unanswered. The owner's rule: the reminder goes ONCE.
--     2. EVERYONE — a dispatcher job applicant, a careers question and an anonymous website
--        visitor all raised the same alarm as a real carrier. The owner's rule: alert only
--        when the visitor is a CARRIER or a BROKER. Those are the two that are worth
--        interrupting him for; everything else waits in the Command Center list.
--
--   "Once" means once per WAITING EPISODE, not once per lifetime: cc_lc_reply already clears
--   sla_alerted_at when a human actually answers, and now clears handoff_alert_at too — so if
--   the visitor comes back after a real reply and is left waiting again, that earns one new
--   reminder. Without that reset, answering a chat would have muted it permanently.
--
--   In-app Command Center notifications are NOT touched. They cost nothing and they are the
--   right place for the roles that no longer send mail (dispatcher applicants, agents,
--   visitors who have not said what they are yet).
--
--   NOTE: 'shipper' and 'partner' are NOT in the list — the instruction said carrier and
--   broker. One word from the owner adds them.
--
-- Rollback: re-apply the previous definitions from bl_lc_0392 / bl_lc history. No data change.

do $patch$
declare d text;
begin
  -- 1. lc_do_handoff — the FIRST "needs a human" alert: carrier/broker only, once.
  d := pg_get_functiondef('app_private.lc_do_handoff(uuid,text)'::regprocedure);
  d := replace(d,
    'v_alert_ok := (c.handoff_alert_at is null or c.handoff_alert_at < now() - interval ''30 minutes'');',
    'v_alert_ok := (c.handoff_alert_at is null
                 and coalesce(c.visitor_role,'''') in (''carrier'',''broker''));');
  execute d;

  -- 2. lc_sla_alert — the 10-minute reminder: carrier/broker only, once.
  d := pg_get_functiondef('app_private.lc_sla_alert()'::regprocedure);
  d := replace(d,
    'where c.status = ''open'' and c.mode = ''human''',
    'where c.status = ''open'' and c.mode = ''human''
       and coalesce(c.visitor_role,'''') in (''carrier'',''broker'')');
  d := replace(d,
    'and (c.sla_alerted_at is null or c.sla_alerted_at < now() - interval ''30 minutes'')',
    'and c.sla_alerted_at is null');
  execute d;

  -- 3. lc_unanswered_alert (bl_lc_0392) — same two rules.
  d := pg_get_functiondef('app_private.lc_unanswered_alert(integer)'::regprocedure);
  d := replace(d,
    'and (c.mode = ''human'' or c.handoff_at is not null)',
    'and (c.mode = ''human'' or c.handoff_at is not null)
       and coalesce(c.visitor_role,'''') in (''carrier'',''broker'')');
  d := replace(d,
    'and (c.sla_alerted_at is null or c.sla_alerted_at < now() - interval ''6 hours'')',
    'and c.sla_alerted_at is null');
  execute d;

  -- 4. cc_lc_reply — a real reply ends the episode, so the next one can alert once again.
  d := pg_get_functiondef('public.cc_lc_reply(uuid,text)'::regprocedure);
  d := replace(d,
    'staff_unread = 0, staff_typing_at = null, sla_alerted_at = null,',
    'staff_unread = 0, staff_typing_at = null, sla_alerted_at = null, handoff_alert_at = null,');
  execute d;
end $patch$;
