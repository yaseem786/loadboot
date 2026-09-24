-- bl_ux_0437 — cc_web_referrers: "column reference referrer_host is ambiguous" on every call (24 Sep 2026, UX audit CC5)
--
-- What was wrong: the function RETURNS TABLE(referrer_host, source_class, …) and its body did
--   select coalesce(referrer_host,'(direct)'), source_class … from app_private.web_sessions
-- In plpgsql the OUT columns are variables, so `referrer_host` matched both the variable and the
-- table column → 42702 on prod and staging alike (both md5 7f481f68…). Command Center → Website &
-- marketing → "Top referrers" card errored since the function was created; the other cc_web_* siblings
-- (cc_web_overview / cc_web_pages / cc_web_live / cc_web_ai_referrals) were called the same way on
-- staging and return rows. Same shape of bug as bl_ux_0433 (cc_pocket_*).
--
-- Fix: alias the table (`web_sessions s`) and qualify every column. Signature, RETURNS, STABLE,
-- SECURITY DEFINER, search_path and the analytics.view guard are unchanged. ACL unchanged
-- ({postgres, authenticated, service_role}; anon never had EXECUTE). Prod anon-SECDEF count after: 33.
--
-- Applied 24 Sep 2026: staging (rollback-tested as owner@lb.test, then committed; returns
-- "(direct) · direct · 1 · 0"), then prod (md5 now a88c830a…).

CREATE OR REPLACE FUNCTION public.cc_web_referrers(p_days integer DEFAULT 7, p_limit integer DEFAULT 25)
 RETURNS TABLE(referrer_host text, source_class text, sessions bigint, conversions bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_d int := least(greatest(coalesce(p_days,7),1),90); v_l int := least(greatest(coalesce(p_limit,25),1),200); begin if not public.has_global_permission('analytics.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select coalesce(s.referrer_host,'(direct)'), s.source_class, count(*), count(*) filter (where s.converted) from app_private.web_sessions s where s.first_seen > now()-(v_d||' days')::interval and not s.is_bot and not s.is_internal group by 1,2 order by 3 desc limit v_l; end; $function$;
