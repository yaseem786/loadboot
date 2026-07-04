# Branded auth emails — 10-minute owner setup
Aap ke screenshot wala "Supabase Auth <noreply@mail.app.supabase.io>" DO cheezon se theek hota hai:

## Step 1 — Templates (free, abhi ho sakta hai)
Supabase Dashboard → project `loadboot-staging` → Authentication → Email Templates:
- "Confirm signup" → subject: `Confirm your LoadBoot account` → body = paste `confirm-signup.html`
- "Reset password" → subject: `Reset your LoadBoot password` → body = paste `reset-password.html`
(In templates mn `{{ .ConfirmationURL }}` Supabase khud bharta hai — mat badlein.)

## Step 2 — Sender "LoadBoot <no-reply@loadboot.com>" (custom SMTP)
Dashboard → Project Settings → Authentication → SMTP Settings → Enable custom SMTP:
- Resend (already integrated in our delivery pipeline): resend.com → verify domain loadboot.com
  (2 DNS records Porkbun mn) → SMTP creds: host `smtp.resend.com`, port 465, user `resend`,
  pass = RESEND_API_KEY. Sender: `LoadBoot <no-reply@loadboot.com>`. Free tier: 100 emails/day.
- Yehi RESEND_API_KEY Supabase Edge Function secrets mn bhi dalein (`RESEND_API_KEY`,
  `RESEND_FROM=LoadBoot <no-reply@loadboot.com>`) — is se match-alerts, CC review emails
  aur reminder emails (aaj wire hui automations) LIVE ho jayengi.
Jab tak Step 2 nahi hota: auth emails Supabase sender se jati rahengi (templates phir bhi
branded honge Step 1 ke baad), aur system emails queue mn "not configured" dikhengi
(CC → Delivery health).
