-- bl_agent_0404 — referral_program flag ON (22 Sep 2026, Yaseen's decision after bl_agent_0402/0403).
-- The engine, partner links and 1% accrual were already live; the flag only hid the broker-portal card
-- (which told brokers "coming soon") and the CC payouts screen. Additive; reversible with enabled=false.
update app_private.feature_flags
   set enabled = true, environment = 'all', reason = 'Referral program live: tracks + links (0402), activity timeline (0403). Owner decision 22 Sep 2026.',
       updated_at = now()
 where key = 'referral_program';
insert into app_private.feature_flags (key, enabled, environment, audience, reason)
select 'referral_program', true, 'all', 'staff', 'Referral program live (0402/0403). Owner decision 22 Sep 2026.'
 where not exists (select 1 from app_private.feature_flags where key = 'referral_program');
