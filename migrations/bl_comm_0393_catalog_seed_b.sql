-- bl_comm_0393: rest of the catalog. Dispatcher, agent, chat rows are listed;
-- outreach, staff, tx.* and junk are classified by pattern.

insert into app_private.email_catalog as c
 (key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,preference_group,unsub_allowed,status,replaced_by,cc_deep_link)
values
('dispatcher.applied','Application received','Confirms a dispatcher application','T','dispatcher','event','public.dispatcher_apply','once per application','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.skills_test','Skills test invite','Sends the skills test link','T','dispatcher','manual','app_private.disp_test_invite','once per invite','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.skills_test.reminder','Skills test reminder','Chases an unfinished skills test','O','dispatcher','cron','app_private.skills_test_sweep','every 10 min sweep','UNKNOWN - verify','account_critical',true,'live',null,'#/dispatchers'),
('dispatcher.skills_test.submitted','Test submitted','Confirms the test was received','T','dispatcher','event','app_private.skills_test_sweep','once','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.test_score','Your test score','Sends the score breakdown','T','dispatcher','event','app_private.disp_test_score_email','once','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.test_passed','You passed','Tells the candidate they passed','T','dispatcher','event','app_private.disp_test_pass_email','once','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.status.rejected','Application declined','Branded rejection - the CC note is the body','T','dispatcher','manual','app_private.disp_reject_email','once per decision','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.reapply_invite','Reapply invite','Invites a past applicant to apply again','P','dispatcher','manual','app_private.disp_reapply_invite','per campaign','one per invite','marketing',true,'live',null,'#/dispatchers'),
('dispatcher.waitlist','Waitlist notice','Tells an applicant they are on the waitlist','P','dispatcher','manual','August 2026 batch','ad-hoc',null,'marketing',true,'legacy',null,'#/dispatchers'),
('dispatcher.trial.welcome','Trial welcome','Welcomes a dispatcher onto trial','T','dispatcher','manual','app_private.disp_trial_email','once per trial','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.welcome.trial','Trial welcome (old)','Superseded by dispatcher.trial.welcome','T','dispatcher','manual','legacy path','-',null,'account_critical',false,'retired','dispatcher.trial.welcome','#/dispatchers'),
('dispatcher.status.trial','Moved to trial','Status change to trial','T','dispatcher','manual','status path','once','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.status.verified','Verified','Dispatcher verified','T','dispatcher','event','status path','once','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.terms','Terms to sign','Sends the dispatcher terms','T','dispatcher','manual','terms path','once per version','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.assigned.brief','Carrier brief','Gives the dispatcher the carrier brief on assignment','T','dispatcher','event','app_private.disp_assign_brief_email','per assignment','once','account_critical',false,'live',null,'#/dispatchers'),
('dispatcher.assigned.carrier','Your dispatcher','Introduces the dispatcher to the carrier','T','carrier','event','public.cc_dispatcher_assign','per assignment, resendable','once unless resent','account_critical',false,'live',null,'#/carriers'),
('dispatcher.mailbox.assigned','Mailbox assigned','Company mailbox granted','T','dispatcher','event','app_private.dmail_assign_email','per grant','once','account_critical',false,'live',null,'#/dispatcher-mail'),
('dispatcher.mailbox.withdrawn','Mailbox withdrawn','Company mailbox revoked','T','dispatcher','event','app_private.dmail_withdraw_email','per revoke','once','account_critical',false,'live',null,'#/dispatcher-mail'),
('dispatcher.phone.line_ready','Phone line ready','Dialer line provisioned','T','dispatcher','event','app_private.disp_phone_line_email','per grant','once','account_critical',false,'live',null,'#/dialer-live'),
('dispatcher.phone.line_withdrawn','Phone line withdrawn','Dialer line revoked','T','dispatcher','event','app_private.disp_phone_line_withdrawn_email','per revoke','once','account_critical',false,'live',null,'#/dialer-live'),
('dispatcher.phone.line_changed','Phone line changed','Dialer line number changed','T','dispatcher','event','app_private.disp_phone_line_withdrawn_email','per change','once','account_critical',false,'live',null,'#/dialer-live'),
('dispatcher.whatsapp.assigned','WhatsApp assigned','WhatsApp line granted','T','dispatcher','event','app_private.wa_assigned_email','per grant','once','account_critical',false,'live',null,'#/whatsapp-live'),
('carrier_dispatcher_whatsapp_intro','WhatsApp intro','Introduces the dispatcher WhatsApp line to the carrier','T','carrier','manual','WhatsApp assign path','per assignment','once','account_critical',false,'live',null,'#/carriers'),
('agent.invite','Agent invite','Invites someone to join as an agent','P','agent','manual','public.agent_send_invite','per invite','one per invite','marketing',true,'live',null,'#/referrals'),
('agent.submitted','Application submitted','Confirms the agent application','T','agent','event','public.agent_save_onboarding','once','once','account_critical',false,'live',null,'#/dispatchers'),
('agent.decision','Application decision','Agent approved or declined','T','agent','manual','public.cc_agent_decide','once per decision','once','account_critical',false,'live',null,'#/dispatchers'),
('agent.doc_review','Document reviewed','Agent document decision','T','agent','manual','public.cc_agent_doc_review','per document',null,'compliance',false,'live',null,'#/dispatchers'),
('agent.message','Message from staff','Free-text staff message to an agent','T','agent','manual','public.cc_agent_msg_send','per message',null,'account_critical',false,'live',null,'#/dispatchers'),
('agent.staff_notice','Staff notice','Staff notice to an agent','T','agent','manual','public.cc_agent_notify_send','per notice',null,'account_critical',false,'live',null,'#/dispatchers'),
('agent.owner_alert','Agent needs review (owner)','Alerts the owner that an agent needs review','S','staff','event','app_private.agent_profiles_review_alert','per submission',null,'staff_internal',false,'live',null,'#/dispatchers'),
('agent.joined','Agent joined','Tells the upline an agent joined','T','agent','event','app_private.trg_agent_on_join','per join','once','account_critical',false,'live',null,'#/referrals'),
('agent.team_joined','Team member joined','Tells the upline their team grew','T','agent','event','public.agent_claim_upline','per join','once','account_critical',false,'live',null,'#/referrals'),
('agent.load_submitted','Load submitted','Confirms an agent load submission','T','agent','event','app_private.trg_partner_load_submit_notify','per load','once','load_ops',false,'live',null,'#/loads'),
('broker.agent_invite','Broker agent invite','Broker invites a colleague','P','broker','manual','public.partner_agent_invite','per invite','one per invite','marketing',true,'live',null,'#/partners'),
('shipper.company_email','Shipper company email','Company email verification for a shipper','T','shipper','event','public.partner_shipper_company_email','per request','once','account_critical',false,'live',null,'#/partners'),
('driver.invite','Driver invite','Invites a driver to the app','T','driver','manual','public.cc_carrier_invite_driver','per invite, resendable','once unless resent','account_critical',false,'live',null,'#/driver-access'),
('driver.welcome','Driver welcome','Welcomes a driver who joined','T','driver','event','public.cc_accept_driver_invite','once','once','account_critical',false,'live',null,'#/driver-access'),
('driver.joined','Driver joined','Tells the carrier a driver joined','T','carrier','event','public.cc_accept_driver_invite','per join','once','load_ops',false,'live',null,'#/driver-access'),
('chat.sla','Chat SLA breach (staff)','Alerts staff that a chat is waiting','S','staff','cron','app_private.lc_sla_alert','every 2 min','per breach','staff_internal',false,'live',null,'#/live-chat'),
('chat.handoff','Chat handoff (staff)','Visitor asked for a human','S','staff','event','app_private.lc_do_handoff','per handoff',null,'staff_internal',false,'live',null,'#/live-chat'),
('chat.reply','Reply to your chat','Sends a staff reply to the visitor','T','lead','cron','app_private.lc_reply_notify','every 2 min','per reply','account_critical',false,'live',null,'#/live-chat'),
('chat.lead.nudge','Chat nudge','Nudges a chat lead who went quiet','P','lead','cron','app_private.lc_lead_nudge','every 10 min','one nudge only, skips customers and suppressions','marketing',true,'live',null,'#/live-chat'),
('chat.lead.followup','Chat follow-up','Follows up a chat lead','P','lead','cron','app_private.lc_lead_followup','every 10 min','one only, stops on reply or conversion','marketing',true,'live',null,'#/live-chat'),
('call.lead.followup','Call follow-up','Follows up after a missed call','P','lead','cron','app_private.lc_call_followup','every 10 min','one only','marketing',true,'live',null,'#/live-chat'),
('chat.transcript','Chat transcript','Emails the visitor their transcript','T','lead','event','public.lc_rate','once per chat','once','account_critical',false,'live',null,'#/live-chat'),
('lead.form_submitted','Form submitted','Confirms a website form submission','T','lead','event','form path','per submission','once','account_critical',false,'live',null,'#/forms'),
('form.owner_alert','Form submission (owner)','Tells the owner a form came in','S','staff','event','app_private.trg_form_submission_email_owner','per submission',null,'staff_internal',false,'live',null,'#/forms'),
('outreach.killswitch','Outreach killswitch (staff)','Outreach engine stopped itself','S','staff','cron','app_private.outreach_health_check','on trip',null,'staff_internal',false,'live',null,'#/crm'),
('ops.signup.new','New signup (staff)','Tells staff someone signed up','S','staff','event','app_private.send_welcome_email','per signup',null,'staff_internal',false,'live',null,'#/carriers'),
('ops.email_health','Email health (staff)','Hourly deliverability self-check','S','staff','cron','app_private.cron_email_health','hourly at :40',null,'staff_internal',false,'live',null,'#/delivery'),
('ops.delivery.test','Delivery test','Manual delivery test mail','S','staff','manual','delivery test path','ad-hoc',null,'staff_internal',false,'test',null,'#/delivery'),
('mail.reply','Mailbox reply','Human Command Center reply from the shared mailbox','T','any','manual','public.cc_mail_send','per reply',null,'account_critical',false,'live',null,'#/mailbox'),
('dispatch.mail.reply','Dispatch mailbox reply','Human reply from dispatch@','T','any','manual','public.cc_mail_send','per reply',null,'account_critical',false,'live',null,'#/mailbox'),
('billing.mail.reply','Billing mailbox reply','Human reply from billing@','T','any','manual','public.cc_mail_send','per reply',null,'billing',false,'live',null,'#/mailbox'),
('notification.broadcast','Broadcast','Staff broadcast to an audience','P','any','manual','public.cc_notify_broadcast','per broadcast',null,'product_announcements',true,'live',null,'#/announcements'),
('carrier.daily_availability.2026_09','Daily availability push','One-off September availability campaign','P','carrier','manual','campaign 6 Sep 2026','one-off',null,'marketing',true,'legacy',null,'#/crm')
on conflict (key) do update set
  name=excluded.name, purpose=excluded.purpose, class=excluded.class, audience_role=excluded.audience_role,
  trigger_type=excluded.trigger_type, trigger_source=excluded.trigger_source, cadence=excluded.cadence,
  cap_note=excluded.cap_note, preference_group=excluded.preference_group, unsub_allowed=excluded.unsub_allowed,
  status=excluded.status, replaced_by=excluded.replaced_by, cc_deep_link=excluded.cc_deep_link, updated_at=now();

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

-- the tx.* catalog: keep the ones that fill a real gap, retire the duplicates
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

select app_private.email_catalog_sync();
