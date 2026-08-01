-- bl_lc_0189 — KB answers still described the old magic-link signup.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- lcOnboard.js now creates the account with a real email + password through
-- /auth/v1/signup, so the visitor can sign in at the portal with the same password the
-- portals have always used. Four KB answers still promised "a secure email link — no
-- password typing", and the password-reset answer sent people to the login page when the
-- bot can now email the reset link itself.

update app_private.lc_kb set answer =
  'Easy — and you don''t even have to leave this chat. 🚚 I''ll set your carrier account up right here in about 5 minutes: verify your MC/DOT live on FMCSA, create your login, check your COI and documents on the spot, and get the W-9 and dispatch agreement signed.' || E'\n' ||
  '[[chips:🚀 Start my 5-minute setup=Start my 5-minute setup|❓ What do I need first=What do I need to sign up as a carrier?]]'
where id = 77;

update app_private.lc_kb set answer =
  'You can do the whole thing right here in chat. Pick your role and I''ll take you through it — carrier is about 5 minutes, everyone else about 3. You choose your own password, we email you a verification link, and you sign in at your portal with the same details.' || E'\n' ||
  '[[chips:🚀 Start my 5-minute setup=Start my 5-minute setup|💰 Show pricing first=What does LoadBoot cost?]]'
where id = 78;

update app_private.lc_kb set answer =
  'Brokers are free forever on LoadBoot — no posting fees, ever. I can set your broker account up right here in about 3 minutes: your details, your password, your authority and bond, done.' || E'\n' ||
  '[[chips:🏢 Start my broker setup=Start my 5-minute setup|❓ Why post loads here=Why post loads here?]]'
where id = 79;

update app_private.lc_kb set answer =
  'Direct-to-carrier shipping with live GPS proof — and your account takes about 3 minutes right here in chat.' || E'\n' ||
  '[[chips:📦 Start my shipper setup=Start my 5-minute setup|❓ Shipper benefits=Why ship with LoadBoot?]]'
where id = 80;

-- The bot can now send the reset link itself; the onboarding script opens the reset card
-- on the same phrases, so this answer explains rather than redirects.
update app_private.lc_kb set
  patterns = array['password','reset my password','forgot my password','reset password','locked out','cant login','can''t login','cannot login','forgot','change my password','lost my password'],
  answer = 'No problem — I can sort that out right here. 🔑 Tell me which portal you use, then your email, and I''ll send you a reset link. Open it, choose a new password, and sign in.' || E'\n\n' ||
    'You can also reset from the login page with "Forgot password". Either way the link goes to your account email — check spam if it is slow.'
where id = 27;
