-- bl_bp_0321_rollback_test.sql — audit F05. Rollback-txn test for migrations/bl_bp_0321_agent_confirm_resend_idem.sql.
-- PASS = the error message starts with RESULT PASS. Nothing persists — no email leaves the box (sys_email only queues
-- a message_deliveries row inside this transaction, and the transaction is rolled back by the RAISE).
--
-- WHAT IT PROVES: two deliberate sends (a send and a human "Resend") now produce TWO deliveries with TWO DISTINCT
-- idempotency keys — before bl_bp_0321 the second one was swallowed by sys_email's ON CONFLICT (idempotency_key)
-- DO NOTHING, so the carrier/brokerage never received the code that was actually live.
--
-- TWO GOTCHAS (both cost a failed run on prod, 5 Sep):
--   • the 10-minute throttle is on app_private.agent_parents.sent_at, NOT on verify_codes.created_at — back-date
--     sent_at between the two sends or the second call returns {"sent":false,"why":"sent less than 10 minutes ago"}.
--   • verify_codes links to the brokerage row through parent_id (there is no ref_id column), and the emails live on
--     agent_parents.contact_email / .fmcsa_email (there is no parent_emails array).
-- PROD RESULT 2026-09-05 22:5x UTC: RESULT PASS — parent c4fed94c…, 2 new deliveries, 2 new codes, 2 distinct keys, 1 live.
do $$
declare v_ap uuid; n0 int; n1 int; k text[]; c0 int; c1 int; r1 jsonb; r2 jsonb; msg text := '';
begin
  select ap.id into v_ap from app_private.agent_parents ap
   where coalesce(nullif(btrim(ap.contact_email),''), nullif(btrim(ap.fmcsa_email),'')) is not null
   order by ap.created_at desc limit 1;
  if v_ap is null then raise exception 'RESULT FAIL: no agent_parents row with an email'; end if;

  select count(*) into n0 from app_private.message_deliveries where idempotency_key like 'agentconfirm:'||v_ap::text||':%';
  select count(*) into c0 from app_private.verify_codes where parent_id = v_ap and channel='email';

  update app_private.agent_parents set sent_at = null where id = v_ap;                            -- clear the throttle
  r1 := app_private.broker_parent_confirm_send_p(v_ap, false);
  update app_private.agent_parents set sent_at = now() - interval '20 minutes' where id = v_ap;   -- a real human "Resend"
  r2 := app_private.broker_parent_confirm_send_p(v_ap, false);
  if (r1->>'sent') <> 'true' or (r2->>'sent') <> 'true' then
    raise exception 'RESULT FAIL: a send was refused. r1=% r2=%', r1, r2; end if;

  select count(*) into n1 from app_private.message_deliveries where idempotency_key like 'agentconfirm:'||v_ap::text||':%';
  select array_agg(distinct idempotency_key) into k from app_private.message_deliveries
   where idempotency_key like 'agentconfirm:'||v_ap::text||':%' and created_at > now() - interval '2 minutes';
  select count(*) into c1 from app_private.verify_codes where parent_id = v_ap and channel='email';

  if n1 - n0 < 2 then raise exception 'RESULT FAIL: 2 sends produced % new deliveries (new keys: %) — resend still deduped', n1-n0, k; end if;
  if array_length(k,1) < 2 then raise exception 'RESULT FAIL: the 2 new deliveries do not have distinct keys: %', k; end if;
  if c1 - c0 < 2 then raise exception 'RESULT FAIL: expected 2 new codes, got %', c1-c0; end if;
  if (select count(*) from app_private.verify_codes where parent_id = v_ap and channel='email' and consumed_at is null and expires_at > now()) <> 1 then
    raise exception 'RESULT FAIL: live-code count is not 1'; end if;
  msg := format(' parent=%s new_deliveries=%s new_codes=%s distinct_new_keys=%s live=1', v_ap, n1-n0, c1-c0, array_length(k,1));
  raise exception 'RESULT PASS (rolled back — no email left the box):%', msg;
end $$;
