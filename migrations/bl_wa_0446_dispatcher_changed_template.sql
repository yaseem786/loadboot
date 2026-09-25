-- bl_wa_0446 — WhatsApp utility template `dispatcher_changed`, seeded as a DRAFT (25 Sep 2026)
--
-- Why: a carrier gets `dispatcher_assigned_v2` on WhatsApp when a dispatcher is put on the account, but nothing
-- tells him on WhatsApp when that dispatcher is taken off (bl_disp_0444 only e-mails the dispatcher). David
-- Thompson's GABE and MUNSTER unassign on 25 Sep is the live case: both carriers were told "David is your
-- dispatcher" and have had no correction since.
--
-- Wording follows `dispatcher_assigned_v2`, NOT the first `dispatcher_assigned`: Meta filed the first one under
-- MARKETING ("Hi {{1}}, this is {{2}} from LoadBoot Dispatch...") and approved v2 as UTILITY because v2 reads as
-- an account notice ("LoadBoot account update for {{1}}: ..."). Same opening, same neutral tone, no promotion,
-- no variable at the start or the end, fictitious sample values (never a real carrier in a Meta example).
--
-- One job only: say the old dispatcher is off the account and who handles loads until the next one is confirmed.
-- The new dispatcher is announced by `dispatcher_assigned_v2` as today, so the two never overlap.
--
-- Status 'draft': wa_send_prepare refuses anything not approved, and the sync keeps drafts. Submitting to Meta
-- is the owner's click in CC -> WhatsApp -> Templates -> Submit (telnyx-wa-templates action 'submit').
-- No function created or changed here, so the anon SECURITY DEFINER surface is untouched.

insert into app_private.wa_templates (name, category, language, body, variables, var_labels, example_vars, status, note)
values ('dispatcher_changed', 'utility', 'en_US',
  'LoadBoot account update for {{1}}: {{2}} is no longer the dispatcher assigned to your account, effective {{3}}. Until your new dispatcher is confirmed, LoadBoot handles your load offers, rate confirmations and paperwork on this number. Reply here if you have a load in progress or if this change is not correct.',
  3,
  '["Carrier company name","Previous dispatcher name","Effective date"]'::jsonb,
  '["Sunrise Carriers LLC","Hamza Khan","25 September 2026"]'::jsonb,
  'draft',
  'Drafted 25 Sep 2026 (bl_wa_0446) on the dispatcher_assigned_v2 pattern - not submitted to Meta yet')
on conflict (name) do nothing;
