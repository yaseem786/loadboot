-- bl_dev_0511 — API use terms api-v1.1 (30 Sep 2026, owner: "dono").
-- The two hardening lines from the bl_dev_0506 A1-A9 review, added to /terms.html#api (terms_module.py):
--   A5  now opens with the grant: "a limited, non-exclusive, non-transferable, revocable licence to use the API and
--       API data for the product you described when you applied".
--   A7  now says Clause 16 (Indemnification) also covers claims arising from the developer's application or its use
--       of API data. Clauses 1-19 stay untouched.
-- This file only bumps the version (api-v1-2026-09-30 -> api-v1.1-2026-09-30) and adds one summary point, so every
-- developer is asked to accept the new wording in the portal. When applied, 0 of 5 developer accounts had accepted
-- api-v1, so nobody loses an acceptance. app/developer/app.js API_TERMS_VERSION is bumped in the same commit
-- (signup stamps terms_version only when it equals this version).
-- Security: app_private function, no grant change; anon SECURITY DEFINER surface does not move.

create or replace function app_private.dev_api_terms() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'version', 'api-v1.1-2026-09-30',
    'url', '/terms.html#api',
    'title', 'LoadBoot API use terms',
    'points', jsonb_build_array(
      'Your API keys are secret. Never share them or put them in an app, web page or public code; you are responsible for every call made with them.',
      'Every load you show from the API says "via LoadBoot" and links back to LoadBoot with the load''s url.',
      'No reselling, bulk copying or re-hosting LoadBoot load data, and no using it to take a load, broker or shipper around LoadBoot.',
      'You get a limited, revocable licence to use API data in the product you described, and claims arising from your application are yours to cover (Clause 16).',
      'Sandbox data is test data. Production access needs LoadBoot approval, and rate limits apply to every key.',
      'LoadBoot logs every API call and may limit, suspend or revoke keys that break these terms.'))
$$;
revoke all on function app_private.dev_api_terms() from public, anon;
