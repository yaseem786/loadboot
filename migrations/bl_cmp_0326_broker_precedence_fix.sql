-- bl_cmp_0326 — FIX a regression bl_cmp_0324 introduced: the verified-verdict precedence must apply to CARRIERS ONLY
-- 2026-09-06 · Claude · found by Codex during the Sprint 1+2 verification pass · staging first, prod on Yaseen's word
--
-- THE BUG (mine, introduced in bl_cmp_0324)
--   bl_cmp_0324 added this to fmcsa_authority_collect():
--       when (car->>'authorityVerified') = 'true' and car->>'authority' = 'inactive' then 'inactive'
--       when (car->>'authorityVerified') = 'true' and car->>'authority' = 'active'   then 'active'
--   applied to EVERY org kind. But `authority` from fmcsa-verify is CARRIER authority only:
--       fromLI():  carrierAuthority = common || contract ;  brokerAuthority = broker
--       caller:    result.authority = L.carrierAuthority ? "active" : "inactive" ; authorityVerified = true
--   A BROKER-ONLY docket (broker=true, common=false, contract=false) therefore returns
--       { authority: "inactive", authorityVerified: true, brokerOnly: true }
--   while operating perfectly legally. The collector's broker branch would then expire its
--   mc_authority/operating_authority onboarding item, set organizations.status='pending' (posting paused) and
--   send the owner the "Load posting paused — FMCSA shows your authority as not active" email. A false accusation
--   against a paying brokerage.
--
-- BLAST RADIUS: none. Verified on prod 6 Sep — the only two brokers the 06:10 UTC dispatch reached
--   (Vertex Web Systems 2, M Usman Farooq (Agent)) both returned no_docket; 0 items expired, 0 emails,
--   0 notifications, org statuses unchanged. No broker with a real docket has passed through the new collector.
--   The next dispatch run is 06:10 UTC daily, which is the deadline this migration is racing.
--
-- THE FIX (surgical, anchor-guarded, same signature → ACL preserved)
--   1. Move `select o.owner_user_id, o.name, o.kind into ...` ABOVE the v_status computation (it currently runs
--      after, which is why the precedence could not be kind-aware in the first place).
--   2. Gate both precedence branches on `v_kind = 'carrier'`.
--   Brokers fall through to the four original branches (allowedToOperate / mcActive), i.e. byte-for-byte the
--   pre-0324 classification. Carriers keep the improvement.
--   Nothing else changes: the carrier_safety / carrier_verifications writes, the carrier-safe lapse handling and
--   the whole broker branch are untouched.
--
-- TEST: docs/audit-2026-09/tests/bl_cmp_0326_rollback_test.sql — covers the case bl_cmp_0324's test missed:
--   a BROKER with authorityVerified=true + authority='inactive' + brokerOnly=true + allowedToOperate='Y'
--   must classify ACTIVE, must not be paused, must not be emailed.
-- ROLLBACK: select app_private.bl_cmp_0326_rollback();

do $mig$
declare
  src text; n1 int; n2 int;
  lookup constant text := E'    select o.owner_user_id, o.name, o.kind into v_owner, v_orgname, v_kind from public.organizations o where o.id = r.org_id;\n';
  head_a constant text := E'    v_status := case\n      when (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''inactive'' then ''inactive''\n      when (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''active''   then ''active''\n';
  head_b constant text := E'    -- bl_cmp_0326: the org kind must be known BEFORE the verdict is classified.\n    select o.owner_user_id, o.name, o.kind into v_owner, v_orgname, v_kind from public.organizations o where o.id = r.org_id;\n    v_status := case\n      -- bl_cmp_0326: fmcsa-verify''s `authority` is CARRIER authority only (authority = carrierAuthority =\n      -- common || contract). A broker-ONLY docket returns authority=''inactive'' with authorityVerified=true while\n      -- operating legally, so applying that verdict to a broker would expire its onboarding item, pause the org and\n      -- email the owner. Brokers therefore fall through to the four pre-0324 branches below, unchanged.\n      when v_kind = ''carrier'' and (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''inactive'' then ''inactive''\n      when v_kind = ''carrier'' and (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''active''   then ''active''\n';
begin
  src := pg_get_functiondef('app_private.fmcsa_authority_collect()'::regprocedure);
  if position('bl_cmp_0326' in src) > 0 then raise notice 'bl_cmp_0326: already applied — skip'; return; end if;

  n1 := (length(src) - length(replace(src, lookup, ''))) / length(lookup);
  n2 := (length(src) - length(replace(src, head_a, ''))) / length(head_a);
  if n1 <> 1 or n2 <> 1 then
    raise exception 'bl_cmp_0326: anchors not unique (kind lookup=%, precedence head=%) — collector differs from bl_cmp_0324; inspect before applying', n1, n2;
  end if;
  -- order matters: drop the late lookup first, then re-insert it in front of the case
  src := replace(src, lookup, '');
  src := replace(src, head_a, head_b);
  execute src;
  raise notice 'bl_cmp_0326: verified-verdict precedence is now carrier-only; brokers restored to pre-0324 classification';
end $mig$;

create or replace function app_private.bl_cmp_0326_rollback()
returns text language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare src text;
  lookup constant text := E'    select o.owner_user_id, o.name, o.kind into v_owner, v_orgname, v_kind from public.organizations o where o.id = r.org_id;\n';
  head_a constant text := E'    v_status := case\n      when (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''inactive'' then ''inactive''\n      when (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''active''   then ''active''\n';
  head_b constant text := E'    -- bl_cmp_0326: the org kind must be known BEFORE the verdict is classified.\n    select o.owner_user_id, o.name, o.kind into v_owner, v_orgname, v_kind from public.organizations o where o.id = r.org_id;\n    v_status := case\n      -- bl_cmp_0326: fmcsa-verify''s `authority` is CARRIER authority only (authority = carrierAuthority =\n      -- common || contract). A broker-ONLY docket returns authority=''inactive'' with authorityVerified=true while\n      -- operating legally, so applying that verdict to a broker would expire its onboarding item, pause the org and\n      -- email the owner. Brokers therefore fall through to the four pre-0324 branches below, unchanged.\n      when v_kind = ''carrier'' and (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''inactive'' then ''inactive''\n      when v_kind = ''carrier'' and (car->>''authorityVerified'') = ''true'' and car->>''authority'' = ''active''   then ''active''\n';
  tail constant text := E'    update app_private.authority_checks\n       set request_id = null, checked_at = now(), authority_status = v_status,\n';
begin
  src := pg_get_functiondef('app_private.fmcsa_authority_collect()'::regprocedure);
  if position('bl_cmp_0326' in src) = 0 then return 'nothing to roll back'; end if;
  src := replace(src, head_b, head_a);           -- carrier gate off, lookup removed from the front
  src := replace(src, tail, lookup || tail);      -- lookup back to its pre-0326 position
  execute src;
  return 'bl_cmp_0326 rolled back: precedence applies to every kind again (this REINSTATES the broker regression — only use to bisect)';
end $fn$;
revoke all on function app_private.bl_cmp_0326_rollback() from public, anon, authenticated, service_role;
