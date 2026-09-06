-- edge_fn_live_checks_2026-09-06.sql — live checks for load-mail v9 (F01 follow-up) and domain-check v4 (F02).
-- These are LIVE calls, not rollback-txn tests: an edge function cannot be exercised inside a transaction.
-- Nothing here writes to the app's own tables except through the normal inbound path in check 5, which is
-- STAGING ONLY unless you accept a real (test-sender) load row on prod.
-- Fire the block, wait ~20 s, then read net._http_response for the returned ids.
--
-- Set the base first:  select set_config('lb.fn_base','https://<ref>.supabase.co/functions/v1', false);
--
-- STAGING RESULTS 2026-09-06 (domain-check slot 5 = v4, load-mail slot 10 = v9):
--   1 anon → load-mail                = 403 {"error":"forbidden","code":"LB403"}   (req 192639)
--   2 domain-check real caller        = 200, full result, shape unchanged (mx/title/name_match all present)
--   3 0--1.sslip.io          (→ ::1)  = "refused: resolves to private address"     (req 192630)
--   4 169.254.169.254.nip.io          = "refused: resolves to private address"     (req 192631)
--   6 fe90--1.sslip.io   (→ fe90::1)  = "refused: resolves to private address"     (req 192632)  ← v3 PASSED this
--   7 febf--1.sslip.io   (→ febf::1)  = "refused: resolves to private address"     (req 192633)  ← v3 PASSED this
--   8 0-0-0-0-0-ffff-7f00-1.sslip.io  = "refused: resolves to private address"     (req 192638)  v4-mapped loopback
--   9 2606-4700--1111.sslip.io        = NOT refused — "error sending request for url (…)" (req 192635).
--     This is the control: a PUBLIC IPv6 host must reach the fetch and fail there, not be classified private.
--   NOTE the label shape: sslip.io writes ':' as '-'. "--ffff-7f00-1" is an INVALID DNS label (starts with '-'),
--   so the v4-mapped case must be spelled out in full as 0-0-0-0-0-ffff-7f00-1.
-- PROD RESULTS 2026-09-06: check 1 only → 403 LB403 (req 192731). domain-check on prod is still v2 — checks
--   2,3,4,6,7,8,9 have NOT been run there and v4 is NOT deployed to prod.
with b as (select current_setting('lb.fn_base', true) u, (select auth_key from app_private.fmcsa_config limit 1) k)
select '1_anon_to_loadmail_must_be_403' k, net.http_post(url:=b.u||'/load-mail',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"from":"spoof@evil.invalid","subject":"loads","text":"Dallas TX to Atlanta GA dry van $2100"}'::jsonb,
  timeout_milliseconds:=20000) id from b
union all select '2_domaincheck_real_caller_must_be_200', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"loadboot.com","company":"LoadBoot LLC"}'::jsonb, timeout_milliseconds:=20000) from b
union all select '3_v6_loopback_must_refuse', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"0--1.sslip.io","company":"x"}'::jsonb, timeout_milliseconds:=20000) from b
union all select '4_v4_metadata_must_refuse', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"169.254.169.254.nip.io","company":"x"}'::jsonb, timeout_milliseconds:=20000) from b
union all select '6_fe90_linklocal_must_refuse', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"fe90--1.sslip.io","company":"x"}'::jsonb, timeout_milliseconds:=20000) from b
union all select '7_febf_linklocal_must_refuse', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"febf--1.sslip.io","company":"x"}'::jsonb, timeout_milliseconds:=20000) from b
union all select '8_mapped_v4_loopback_must_refuse', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"0-0-0-0-0-ffff-7f00-1.sslip.io","company":"x"}'::jsonb, timeout_milliseconds:=20000) from b
union all select '9_public_v6_must_NOT_be_refused', net.http_post(url:=b.u||'/domain-check',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||b.k),
  body:='{"domain":"2606-4700--1111.sslip.io","company":"x"}'::jsonb, timeout_milliseconds:=20000) from b;
-- then:
--   select id, status_code, left(content,300) from net._http_response where id in (...) order by id;
--
-- check 5 (STAGING ONLY unless Yaseen accepts a real row on prod): post a message through inbound-mail so the
-- REAL service-role chain reaches load-mail. It must NOT be LB403 — that is the whole point. The first cut of
-- v9 failed exactly here, because it assumed the service key was a JWT; this project's is an opaque sb_secret_.
--   select net.http_post(url:=current_setting('lb.fn_base',true)||'/inbound-mail',
--     headers:=jsonb_build_object('Content-Type','application/json'),
--     body:='{"from":"chaintest@test.invalid","subject":"loads","text":"Dallas TX to Atlanta GA dry van $2100"}'::jsonb,
--     timeout_milliseconds:=25000);
