-- bl_ob_0233 — "not_started" is a real answer, and the API now gives it.
--
-- app_private.carrier_onboarding gets its first row only when the carrier SUBMITS
-- (stage CHECK = submitted | docs_review | compliance_check | approved | rejected).
-- So for every carrier who has not started, both read RPCs returned onboarding_stage = NULL
-- and each screen fell back to its own guess: the dashboard pill said "Pending", the Account
-- hero said "PENDING VERIFICATION", My Profile said "Under review". All three told a carrier
-- that we were reviewing something they had never sent us.
--
-- cc_pocket_overview already had a coalesce, but it sat INSIDE the sub-select, so it could
-- never fire: the CHECK makes a null stage impossible, and with no row at all the sub-select
-- itself returns NULL. Moving the coalesce outside the sub-select is the whole fix.
--
-- Applied as a surgical rewrite of the LIVE definition rather than a full CREATE OR REPLACE,
-- so anything else in these bodies (including production-only drift) is preserved untouched.
-- Re-runnable: if the fix is already in place the block does nothing.
--
-- Applied: staging snslhvmkjusozgjelghi + production rwscphuhpjoudvljvmdk (2026-08-21).

do $mig$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_pocket_overview';
  if v_src is null then raise exception 'cc_pocket_overview not found'; end if;
  if position('coalesce((select stage from app_private.carrier_onboarding' in v_src) = 0 then
    v_new := replace(v_src,
      '(select coalesce(stage,''not_started'') from app_private.carrier_onboarding where carrier_id=v_org)',
      'coalesce((select stage from app_private.carrier_onboarding where carrier_id=v_org), ''not_started'')');
    if v_new = v_src then raise exception 'cc_pocket_overview: expected onboarding_stage line not found — aborting'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_carrier_dashboard';
  if v_src is null then raise exception 'cc_carrier_dashboard not found'; end if;
  if position('coalesce(v_stage,''not_started'')' in v_src) = 0 then
    v_new := replace(v_src, '''onboarding_stage'', v_stage,', '''onboarding_stage'', coalesce(v_stage,''not_started''),');
    if v_new = v_src then raise exception 'cc_carrier_dashboard: expected onboarding_stage line not found — aborting'; end if;
    execute v_new;
  end if;
end $mig$;
