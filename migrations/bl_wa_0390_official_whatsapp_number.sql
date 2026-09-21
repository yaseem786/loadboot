-- bl_wa_0390 — one official WhatsApp number everywhere: +1 (815) 365-1168.
--
-- WHY: every public surface still carried +1 (928) 393-6198, which is the OWNER'S PERSONAL number, kept from
-- before LoadBoot had a WhatsApp Business number. The WABA number bought from Telnyx (+1 815 365 1168) is the
-- one that is actually connected to the portal: a message sent there lands in wa_threads and is routed to the
-- carrier's own dispatcher. The personal number reaches nobody but Yaseen and belongs on no LoadBoot surface.
--
-- WHAT IS CHANGED (published content only)
--   * app_private.contact_channel        — the number the marketing site shows when the channel switch is on WhatsApp
--   * app_private.comm_templates         — carrier reminder / onboarding e-mails that go out automatically
--   * app_private.outreach_templates     — the outreach drip
--
-- WHAT IS DELIBERATELY NOT TOUCHED (these are RECORDS, not content — rewriting them would falsify history)
--   * app_private.message_deliveries     — ~9,700 e-mails ALREADY SENT. What is in someone's inbox cannot be
--                                          changed by an UPDATE here, and the row is the evidence of what was sent.
--   * dialer_calls / lc_calls / dialer_webhook_log / wa_webhook_log / notifications / crm_activities
--   * wa_threads.counterparty            — a real conversation with that number
--   * crm_contacts                       — the number is a genuine contact record ("Yaseen")
--   * automation_tasks                   — a real call-back task about a caller on that number
--   * outreach_templates_bak_20260913    — a backup table
--
-- Rollback: re-run with the two numbers swapped.

update app_private.contact_channel
   set whatsapp_number  = '18153651168',
       whatsapp_display = '+1 (815) 365-1168',
       updated_at       = now()
 where id = 1
   and (whatsapp_number <> '18153651168' or whatsapp_display <> '+1 (815) 365-1168');

update app_private.comm_templates
   set body      = replace(replace(replace(coalesce(body,''),
                     'wa.me/19283936198', 'wa.me/18153651168'),
                     '+1 (928) 393-6198', '+1 (815) 365-1168'),
                     '(928) 393-6198',    '(815) 365-1168'),
       body_text = replace(replace(replace(coalesce(body_text,''),
                     'wa.me/19283936198', 'wa.me/18153651168'),
                     '+1 (928) 393-6198', '+1 (815) 365-1168'),
                     '(928) 393-6198',    '(815) 365-1168')
 where coalesce(body,'') ~ '9283936198|928[^0-9]{0,3}393[^0-9]{0,3}6198'
    or coalesce(body_text,'') ~ '9283936198|928[^0-9]{0,3}393[^0-9]{0,3}6198';

update app_private.outreach_templates
   set html = replace(replace(replace(coalesce(html,''),
                'wa.me/19283936198', 'wa.me/18153651168'),
                '+1 (928) 393-6198', '+1 (815) 365-1168'),
                '(928) 393-6198',    '(815) 365-1168')
 where coalesce(html,'') ~ '9283936198|928[^0-9]{0,3}393[^0-9]{0,3}6198';
