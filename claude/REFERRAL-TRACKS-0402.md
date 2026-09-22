# Referral tracks + working links — bl_agent_0402 (22 Sep 2026)

**LIVE on staging AND prod (DB). Frontend committed on `main` — Yaseen pushes from GitHub Desktop.**

## The problem (verified on prod, 22 Sep)
- 131 "Referral Partners" in CC, **0 referral edges ever**. 62 were dispatcher applicants, 51 idle signups,
  14 carrier own-codes. Every agent-portal signup got `role='agent'` → auto referral row.
- `cc_claim_referral` only honoured `status='active'` referrers → 99 pending partners' links did nothing.
- `loadboot.com/?ref=CODE` (the link partners are handed) hit index.html, which had **no ref capture** (3/137 pages did).
- Broker/shipper portal never auto-claimed `?ref=` (manual code box only). No server-side capture at signup.
- Agent portal dashboard = dispatcher application form for everyone, incl. referral partners.

## What changed
DB (`migrations/bl_agent_0402_intent_and_link.sql`):
- `app_private.referrers.opted_in_at` (null = auto-provisioned, never chose the track). Backfilled: 17 opted, 99 hidden.
- `public.profiles.portal_intent` (dispatcher|referral|both) + `profiles.signup_ref` (?ref captured at signup, server-side).
- `app_private.referral_claim_for_org(org, code, by)` = the one claim path (pending+opted-in OK; self/dupe refused).
- `cc_claim_referral` → uses it (now also shippers). `claim_pending_referral(p_code)` = silent post-login claim (both portals).
- `agent_referral_opt_in()`, `agent_set_intent(p)`; `agent_feed` += opted_in/intent/has_dispatcher/referrer_status;
  `cc_agents_list` += kind/opted_in_at/intent/dispatcher_status/last_referral_at/accrued/paid.
- `handle_new_user`: reads `intent` + `ref` metadata; referral row gets `opted_in_at` only when intent=referral;
  carrier signups with a ref are tied immediately (org exists in the trigger).
- `cc_agent_decide` approve → sets opted_in_at + runs `referral_accrue_all()` at once (was: 30-min cron).
- anon-secdef surface: prod 33 / staging 32, names unchanged (new fns authenticated-only).

Frontend:
- `app/carrier/app.js` (agent portal): first-visit chooser "Work as a Dispatcher / Earn 1% as a Referral Partner";
  `?join=dispatcher|referral` pre-selects and opens signup; signup meta carries `intent` + `ref`; tracks decide nav
  (no referral tabs unless opted in), dashboard (dispatcher home / referral home / track chooser), labels; the
  "Activate my referral link" upsell really opts in. Carrier portal also calls `claim_pending_referral`.
- `app/agent/referral-home.js` (new): link + share, live KPIs, per-referral timeline, money pipeline, activity, cross-sell.
- `app/partner/app.js`: silent post-login claim. `app/shared/session.js` + `api.js`: intent/ref + 3 wrappers.
- `app/command-center/views/agents.js`: track filter (default = opted in), badges (dispatcher status, opted-in date, link off).
- `build_site.py`: `REF_GLOBAL_JS` on EVERY page; CTAs → `/app/agent/?join=…`.

## Still open
- Headless render of the full agent portal not done (module rendered standalone at 390px + 1280px: OK).
- Old "Referral (1%)" tab content untouched — the new home sits above it for dual-track users.
- Consider an email on `referral.claimed` to the partner (in-app `agent.joined` already fires).
