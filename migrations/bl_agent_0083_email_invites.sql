-- bl_agent_0083 — one-tap EMAIL INVITES from the agent portal (premium branded template).
-- agent_send_invite(side, email, name): per-side hero pitch (broker/shipper/carrier),
-- agent's name as personal inviter, referral link on the CTA. 25/day per agent,
-- idempotent per (agent,email,day) via sys_email key. Applied to staging 2026-07-13.
-- (Function body identical to the applied version — see supabase migration
--  bl_agent_0083_email_invites for the canonical SQL.)

-- NOTE: canonical definition lives in the applied migration on the Supabase project;
-- re-apply from there when promoting to production.
