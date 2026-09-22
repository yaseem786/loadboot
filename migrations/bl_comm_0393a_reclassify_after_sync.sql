-- bl_comm_0393a: 0393 classifies by pattern first and calls email_catalog_sync() last.
-- On staging the catalog was already complete, so the order did not matter. On a database
-- seeing the catalog for the first time (production, 22 Sep 2026) sync discovered 70 keys
-- AFTER the pattern passes had run, and every one of them stayed 'undocumented'
-- (all 14 outreach drips, the mk.* shells, the whole tx.* family, the first-draft keys).
-- This migration re-runs the pattern passes and syncs again. Idempotent on both databases.

-- cold outreach: 14 keys, one rule
update app_private.email_catalog set
  name = 'Cold outreach ' || upper(right(key,2)),
  purpose = 'Cold acquisition drip, day ' || right(key,1) || ', to a ' || split_part(split_part(key,'.',2),'-',1) || ' list',
  class='M', audience_role=split_part(split_part(key,'.',2),'-',1), trigger_type='cron',
  trigger_source='app_private.outreach_run_daily', cadence='13, 15, 17 and 19 UTC daily',
  cap_note='3-day gap per contact; stops on reply, bounce, unsubscribe or conversion',
  preference_group='marketing', unsub_allowed=true, status='live', cc_deep_link='#/crm', updated_at=now()
where key ~ '^outreach\.(carrier|broker)-d[1-7]$';

-- marketing template shells that exist but are not wired to a sender yet
update app_private.email_catalog set class='M', audience_role='any', trigger_type='manual',
  trigger_source='public.cc_campaign_enqueue', cadence='per campaign', preference_group='marketing',
  unsub_allowed=true, status='planned', cc_deep_link='#/crm',
  name=initcap(replace(split_part(key,'.',2),'_',' ')),
  purpose='Campaign template, not yet wired to a live trigger', updated_at=now()
where key like 'mk.%';

-- the tx.* catalog: retire the duplicates of a live sender
update app_private.email_catalog set status='retired', replaced_by=m.live_key, class='T',
  trigger_type='manual', trigger_source='app_private.comm_templates (never wired)',
  preference_group='compliance', unsub_allowed=false, cc_deep_link='#/templates',
  purpose='Superseded by a live sender', updated_at=now()
from (values
  ('tx.welcome_new_account','welcome.account'),('tx.welcome_partner','welcome.broker'),
  ('tx.application_received','welcome.application_received'),('tx.verification_pending','onboarding.in_review'),
  ('tx.changes_requested','onboarding.item_reject'),('tx.account_approved','onboarding.decided'),
  ('tx.account_rejected','onboarding.decided'),('tx.document_missing','onboarding.item_reminder'),
  ('tx.document_rejected','document.reviewed.rejected'),('tx.document_approved','document.reviewed.valid'),
  ('tx.document_expiring','compliance.expiring'),('tx.offer_new','offer.received'),
  ('tx.booking_confirmed','book.approved'),('tx.driver_assignment','driver.invite'),
  ('tx.trip_pickup_reminder','trip.pickup_late'),('tx.signup_recovery','onboarding.reminder'),
  ('tx.signup_nudge','onboarding.reminder'),('tx.onboarding_nudge','onboarding.reminder'),
  ('tx.dispatcher_followup','dispatcher.skills_test.reminder')
) m(k,live_key) where app_private.email_catalog.key = m.k;

-- genuinely missing: keep as planned, these are the gaps worth building
update app_private.email_catalog set status='planned', class='T', audience_role='carrier,broker',
  trigger_type='event', trigger_source='not wired yet', cadence='per event',
  preference_group = case when key ~ '(invoice|settlement|payment)' then 'billing'
                          when key ~ 'security' then 'account_critical' else 'load_ops' end,
  unsub_allowed=false, cc_deep_link='#/templates',
  name=initcap(replace(split_part(key,'.',2),'_',' ')),
  purpose='Published template with no live trigger - real gap, worth wiring', updated_at=now()
where key in ('tx.pod_required','tx.pod_approved','tx.pod_rejected','tx.detention_warning',
  'tx.detention_opened','tx.settlement_ready','tx.invoice_ready','tx.invoice_dispute_update',
  'tx.security_alert','tx.tracking_stale_warning','tx.trip_checkin_reminder','tx.trip_delivery_reminder',
  'tx.support_reply','tx.maintenance_notice','tx.payment_update','tx.offer_counter','tx.offer_accepted',
  'tx.booking_rate_confirmation','tx.load_lumper_request','tx.load_tonu','tx.trip_layover',
  'tx.trip_breakdown','tx.trip_accident','tx.trip_exception_update');

-- drafts from the very first template table, never sent
update app_private.email_catalog set status='retired', class='T', trigger_source='app_private.comm_templates draft',
  purpose='Unfinished draft from the first template table', cc_deep_link='#/templates', updated_at=now()
where key in ('carrier_welcome','rate_con','check_call','invoice_sent');

-- test and scratch keys never belong in the catalog view
update app_private.email_catalog set status='test', class='S', preference_group='staff_internal',
  purpose='Test or scratch send', cc_deep_link='#/delivery', updated_at=now()
where key ~ '^(test\.|tx\.shell_render_test)' or key in ('ops.delivery.test','test.audit');

-- keys captured from string concatenation in code are families, not real keys
update app_private.email_catalog set status='dynamic', class='unclassified',
  purpose='Key prefix built at runtime - see the sibling keys in this family', updated_at=now()
where key ~ '[._]$';

-- the 0394 backfills, repeated for anything sync added since
update app_private.email_catalog
   set name = initcap(replace(replace(regexp_replace(key,'^(tx|mk|ops|test)\.','') ,'.',' '),'_',' '))
 where name is null or btrim(name) = '';
update app_private.email_catalog set preference_group = 'staff_internal'
 where preference_group is null and class = 'S';
update app_private.email_catalog set preference_group = 'account_critical'
 where preference_group is null and status in ('live','legacy');

select app_private.email_catalog_sync();
