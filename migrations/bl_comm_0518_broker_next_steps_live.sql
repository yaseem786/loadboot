-- bl_comm_0518 — onboarding.broker_next_steps is a live, hand-sent key again.
-- Owner, 1 Oct 2026: send TQL (Isaac, iclark@tql.com) a premium follow-up with its exact next step. The catalog
-- already had the right key — 'onboarding.broker_next_steps' ("Broker next steps", hand-sent, O, compliance,
-- opt-out-able), parked as legacy since its one Aug 2026 send. CLAUDE.md §6: reuse the key, do not invent one.
-- Each send uses idempotency 'broker-next-steps:<org>:<stage>' so a broker gets one follow-up per stage.
-- The TQL send itself is a one-off sys_email call (not in this file, so a replay never re-sends);
-- unsub gate checked first (email_gate -> allowed, compliance group on).

update app_private.email_catalog
   set status         = 'live',
       purpose        = 'Hand-sent follow-up to a broker: what LoadBoot has already verified and the one next step (sign the Master Broker Agreement / post the first load / finish the packet). Built from the account''s live state at send time.',
       trigger_source = 'hand-sent by staff (owner request) via app_private.sys_email',
       cadence        = 'ad-hoc',
       cap_note       = 'once per org per stage (idempotency broker-next-steps:<org>:<stage>)',
       stop_condition = 'the step it names is done',
       owner_note     = 'Revived 1 Oct 2026 (bl_comm_0518) for the TQL follow-up.',
       updated_at     = now()
 where key = 'onboarding.broker_next_steps';
