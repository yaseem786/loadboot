BEGIN;
SET LOCAL plpgsql.check_asserts = on;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE f06_before AS SELECT p.proname, md5(pg_get_functiondef(p.oid)) hash, p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('cc_outreach_audience','cc_outreach_log_page');
CREATE TEMP TABLE anon_before AS SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute');
DROP FUNCTION public.cc_outreach_audience(integer);
DROP FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer);
ALTER TABLE app_private.outreach_contacts DROP COLUMN opened_at;
-- Prepared locally only. Production execution needs explicit approval.
-- No outreach control, sender, schedule or existing engagement backfill.
DO $guard$
DECLARE r record; actual text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.cc_outreach_audience(integer)','ec52b049ffac878ad22571d8e46bc41c'),
 ('public.cc_outreach_log_page(text,text,integer,text,integer,integer)','e7c8099698133d28de3c9c8601a777a2')) AS x(sig,hash)
 LOOP
  IF to_regprocedure(r.sig) IS NOT NULL THEN
   SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO actual;
   IF actual <> r.hash THEN RAISE EXCEPTION 'Existing report drift: %',r.sig; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND table_name='outreach_contacts' AND column_name='opened_at' AND (data_type<>'timestamp with time zone' OR is_nullable<>'YES')) THEN RAISE EXCEPTION 'opened_at shape drift'; END IF;
END $guard$;
ALTER TABLE app_private.outreach_contacts ADD COLUMN IF NOT EXISTS opened_at timestamptz;
CREATE OR REPLACE FUNCTION public.cc_outreach_audience(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
win as (select (greatest(coalesce(p_days,30),1)||' days')::interval as w),
lists as (
  select kind,
    count(*)                                             as contacts,
    count(*) filter (where status='active')              as active,
    count(*) filter (where emails_sent = 0)              as never_touched,
    count(*) filter (where emails_sent between 1 and 6)  as in_drip,
    count(*) filter (where emails_sent >= 7)             as finished_drip,
    count(*) filter (where status='bounced')             as bounced,
    count(*) filter (where status='unsubscribed')        as unsubscribed,
    count(*) filter (where opened_at  is not null)       as opened,
    count(*) filter (where clicked_at is not null)       as clicked,
    count(*) filter (where replied_at is not null)       as replied,
    count(*) filter (where converted_at is not null)     as converted
  from app_private.outreach_contacts group by kind
),
sends as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
    count(*)                                                          as sent,
    count(*) filter (where d.status='delivered')                      as delivered,
    count(*) filter (where d.status in ('bounced','failed','dead_letter','complained')) as bad,
    count(*) filter (where d.opened_at  is not null)                  as opened,
    count(*) filter (where d.clicked_at is not null)                  as clicked
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%' and d.created_at > now() - win.w
  group by 1
),
-- How fast is the cold list actually moving? Count day-1 sends in the window.
intake as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
         count(*) as new_started
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%-d1' and d.created_at > now() - win.w
  group by 1
),
steps as (
  select kind, emails_sent as step, count(*) as n,
         count(*) filter (where clicked_at is not null) as clicked,
         count(*) filter (where opened_at  is not null) as opened
  from app_private.outreach_contacts where emails_sent > 0 group by 1,2
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'days', greatest(coalesce(p_days,30),1),
  'audiences', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', l.kind,
      'contacts', l.contacts, 'active', l.active,
      'never_touched', l.never_touched, 'in_drip', l.in_drip, 'finished_drip', l.finished_drip,
      'bounced', l.bounced, 'unsubscribed', l.unsubscribed,
      'contacts_opened', l.opened, 'contacts_clicked', l.clicked,
      'replied', l.replied, 'converted', l.converted,
      'sent', coalesce(s.sent,0), 'delivered', coalesce(s.delivered,0), 'bad', coalesce(s.bad,0),
      'opens', coalesce(s.opened,0), 'clicks', coalesce(s.clicked,0),
      'new_started', coalesce(i.new_started,0),
      'intake_per_day', round(coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1), 1),
      'runway_days', case when coalesce(i.new_started,0) = 0 then null
                          else ceil(l.never_touched::numeric
                               / (coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1))) end,
      'steps', coalesce((select jsonb_agg(jsonb_build_object('step',st.step,'n',st.n,'clicked',st.clicked,'opened',st.opened) order by st.step)
                         from steps st where st.kind = l.kind), '[]'::jsonb)
    ) order by l.kind)
    from lists l left join sends s on s.kind = l.kind left join intake i on i.kind = l.kind), '[]'::jsonb))
end;
$function$;
CREATE OR REPLACE FUNCTION public.cc_outreach_log_page(p_filter text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_days integer DEFAULT 30, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
p as (
  select least(greatest(coalesce(p_limit,50),1),200) as lim,
         greatest(coalesce(p_offset,0),0)            as off,
         nullif(btrim(coalesce(p_q,'')),'')          as q,
         nullif(btrim(coalesce(p_kind,'')),'')       as kind,
         case when coalesce(p_days,0) <= 0 then null else (p_days||' days')::interval end as win
),
removed as (
  select c.email, c.company, c.kind as audience, c.status, c.emails_sent,
         c.last_sent_at as when_at, null::text as tpl, null::text as reason,
         c.opened_at, c.clicked_at
    from app_private.outreach_contacts c, p
   where p_filter = 'removed'
     and c.status in ('bounced','unsubscribed','suppressed')
     and (p.kind is null or c.kind = p.kind)
     and (p.win is null or c.last_sent_at > now() - p.win)
     and (p.q is null or c.email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
),
sends as (
  select d.recipient_email as email, c.company, c.kind as audience, d.status,
         coalesce(c.emails_sent,0) as emails_sent,
         coalesce(d.sent_at, d.created_at) as when_at,
         d.template_key as tpl, d.failure_reason as reason,
         d.opened_at, d.clicked_at
    from app_private.message_deliveries d
    left join app_private.outreach_contacts c on lower(c.email) = lower(d.recipient_email)
    cross join p
   where p_filter <> 'removed'
     and d.template_key like 'outreach.%'
     and (p.win is null or d.created_at > now() - p.win)
     and (p.kind is null or d.template_key like 'outreach.'||p.kind||'-%')
     and (p.q is null or d.recipient_email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
     and (   p_filter = 'all'
          or (p_filter = 'sent'    and d.status in ('sent','delivered'))
          or (p_filter = 'failed'  and d.status in ('failed','bounced','dead_letter','complained'))
          or (p_filter = 'opened'  and d.opened_at is not null)
          or (p_filter = 'clicked' and d.clicked_at is not null))
),
base as (select * from removed union all select * from sends),
page as (
  select * from base order by when_at desc nulls last limit (select lim from p) offset (select off from p)
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'total',  (select count(*) from base),
  'limit',  (select lim from p),
  'offset', (select off from p),
  'filter', p_filter,
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
             'email', email, 'company', company, 'audience', audience, 'status', status,
             'emails_sent', emails_sent, 'tpl', tpl, 'reason', reason,
             'opened', opened_at is not null, 'clicked', clicked_at is not null,
             'when', when_at) order by when_at desc nulls last) from page), '[]'::jsonb))
end;
$function$;
REVOKE ALL ON FUNCTION public.cc_outreach_audience(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cc_outreach_audience(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer) TO authenticated, service_role;

-- Prepared locally only. Production execution needs explicit approval.
-- No outreach control, sender, schedule or existing engagement backfill.
DO $guard$
DECLARE r record; actual text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.cc_outreach_audience(integer)','ec52b049ffac878ad22571d8e46bc41c'),
 ('public.cc_outreach_log_page(text,text,integer,text,integer,integer)','e7c8099698133d28de3c9c8601a777a2')) AS x(sig,hash)
 LOOP
  IF to_regprocedure(r.sig) IS NOT NULL THEN
   SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO actual;
   IF actual <> r.hash THEN RAISE EXCEPTION 'Existing report drift: %',r.sig; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND table_name='outreach_contacts' AND column_name='opened_at' AND (data_type<>'timestamp with time zone' OR is_nullable<>'YES')) THEN RAISE EXCEPTION 'opened_at shape drift'; END IF;
END $guard$;
ALTER TABLE app_private.outreach_contacts ADD COLUMN IF NOT EXISTS opened_at timestamptz;
CREATE OR REPLACE FUNCTION public.cc_outreach_audience(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
win as (select (greatest(coalesce(p_days,30),1)||' days')::interval as w),
lists as (
  select kind,
    count(*)                                             as contacts,
    count(*) filter (where status='active')              as active,
    count(*) filter (where emails_sent = 0)              as never_touched,
    count(*) filter (where emails_sent between 1 and 6)  as in_drip,
    count(*) filter (where emails_sent >= 7)             as finished_drip,
    count(*) filter (where status='bounced')             as bounced,
    count(*) filter (where status='unsubscribed')        as unsubscribed,
    count(*) filter (where opened_at  is not null)       as opened,
    count(*) filter (where clicked_at is not null)       as clicked,
    count(*) filter (where replied_at is not null)       as replied,
    count(*) filter (where converted_at is not null)     as converted
  from app_private.outreach_contacts group by kind
),
sends as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
    count(*)                                                          as sent,
    count(*) filter (where d.status='delivered')                      as delivered,
    count(*) filter (where d.status in ('bounced','failed','dead_letter','complained')) as bad,
    count(*) filter (where d.opened_at  is not null)                  as opened,
    count(*) filter (where d.clicked_at is not null)                  as clicked
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%' and d.created_at > now() - win.w
  group by 1
),
-- How fast is the cold list actually moving? Count day-1 sends in the window.
intake as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
         count(*) as new_started
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%-d1' and d.created_at > now() - win.w
  group by 1
),
steps as (
  select kind, emails_sent as step, count(*) as n,
         count(*) filter (where clicked_at is not null) as clicked,
         count(*) filter (where opened_at  is not null) as opened
  from app_private.outreach_contacts where emails_sent > 0 group by 1,2
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'days', greatest(coalesce(p_days,30),1),
  'audiences', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', l.kind,
      'contacts', l.contacts, 'active', l.active,
      'never_touched', l.never_touched, 'in_drip', l.in_drip, 'finished_drip', l.finished_drip,
      'bounced', l.bounced, 'unsubscribed', l.unsubscribed,
      'contacts_opened', l.opened, 'contacts_clicked', l.clicked,
      'replied', l.replied, 'converted', l.converted,
      'sent', coalesce(s.sent,0), 'delivered', coalesce(s.delivered,0), 'bad', coalesce(s.bad,0),
      'opens', coalesce(s.opened,0), 'clicks', coalesce(s.clicked,0),
      'new_started', coalesce(i.new_started,0),
      'intake_per_day', round(coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1), 1),
      'runway_days', case when coalesce(i.new_started,0) = 0 then null
                          else ceil(l.never_touched::numeric
                               / (coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1))) end,
      'steps', coalesce((select jsonb_agg(jsonb_build_object('step',st.step,'n',st.n,'clicked',st.clicked,'opened',st.opened) order by st.step)
                         from steps st where st.kind = l.kind), '[]'::jsonb)
    ) order by l.kind)
    from lists l left join sends s on s.kind = l.kind left join intake i on i.kind = l.kind), '[]'::jsonb))
end;
$function$;
CREATE OR REPLACE FUNCTION public.cc_outreach_log_page(p_filter text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_days integer DEFAULT 30, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
p as (
  select least(greatest(coalesce(p_limit,50),1),200) as lim,
         greatest(coalesce(p_offset,0),0)            as off,
         nullif(btrim(coalesce(p_q,'')),'')          as q,
         nullif(btrim(coalesce(p_kind,'')),'')       as kind,
         case when coalesce(p_days,0) <= 0 then null else (p_days||' days')::interval end as win
),
removed as (
  select c.email, c.company, c.kind as audience, c.status, c.emails_sent,
         c.last_sent_at as when_at, null::text as tpl, null::text as reason,
         c.opened_at, c.clicked_at
    from app_private.outreach_contacts c, p
   where p_filter = 'removed'
     and c.status in ('bounced','unsubscribed','suppressed')
     and (p.kind is null or c.kind = p.kind)
     and (p.win is null or c.last_sent_at > now() - p.win)
     and (p.q is null or c.email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
),
sends as (
  select d.recipient_email as email, c.company, c.kind as audience, d.status,
         coalesce(c.emails_sent,0) as emails_sent,
         coalesce(d.sent_at, d.created_at) as when_at,
         d.template_key as tpl, d.failure_reason as reason,
         d.opened_at, d.clicked_at
    from app_private.message_deliveries d
    left join app_private.outreach_contacts c on lower(c.email) = lower(d.recipient_email)
    cross join p
   where p_filter <> 'removed'
     and d.template_key like 'outreach.%'
     and (p.win is null or d.created_at > now() - p.win)
     and (p.kind is null or d.template_key like 'outreach.'||p.kind||'-%')
     and (p.q is null or d.recipient_email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
     and (   p_filter = 'all'
          or (p_filter = 'sent'    and d.status in ('sent','delivered'))
          or (p_filter = 'failed'  and d.status in ('failed','bounced','dead_letter','complained'))
          or (p_filter = 'opened'  and d.opened_at is not null)
          or (p_filter = 'clicked' and d.clicked_at is not null))
),
base as (select * from removed union all select * from sends),
page as (
  select * from base order by when_at desc nulls last limit (select lim from p) offset (select off from p)
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'total',  (select count(*) from base),
  'limit',  (select lim from p),
  'offset', (select off from p),
  'filter', p_filter,
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
             'email', email, 'company', company, 'audience', audience, 'status', status,
             'emails_sent', emails_sent, 'tpl', tpl, 'reason', reason,
             'opened', opened_at is not null, 'clicked', clicked_at is not null,
             'when', when_at) order by when_at desc nulls last) from page), '[]'::jsonb))
end;
$function$;
REVOKE ALL ON FUNCTION public.cc_outreach_audience(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cc_outreach_audience(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer) TO authenticated, service_role;

DO $tests$
DECLARE uid uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); result jsonb; other uuid:=gen_random_uuid();
BEGIN
 ASSERT (SELECT count(*) FROM f06_before b JOIN pg_proc p ON p.proname=b.proname JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND b.hash=md5(pg_get_functiondef(p.oid)) AND b.acl=p.proacl::text)=2, 'Source/grant mismatch';
 ASSERT NOT has_function_privilege('anon','public.cc_outreach_audience(integer)','execute'), 'anon audience grant';
 ASSERT NOT has_function_privilege('anon','public.cc_outreach_log_page(text,text,integer,text,integer,integer)','execute'), 'anon log grant';
 ASSERT has_function_privilege('authenticated','public.cc_outreach_audience(integer)','execute'), 'auth grant missing';
 ASSERT has_function_privilege('service_role','public.cc_outreach_log_page(text,text,integer,text,integer,integer)','execute'), 'service grant missing';
 ASSERT NOT EXISTS ((SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute') EXCEPT SELECT * FROM anon_before) UNION ALL (SELECT * FROM anon_before EXCEPT SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'execute'))), 'anon surface changed';
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,'audit-f06-'||uid||'@example.invalid','{"role":"driver"}');
 SELECT id INTO STRICT org FROM public.organizations WHERE kind='internal' AND status='active';
 INSERT INTO app_private.staff_members(user_id,status) VALUES(uid,'active');
 INSERT INTO public.organization_memberships(org_id,user_id,member_role,status) VALUES(org,uid,'staff','active');
 INSERT INTO app_private.user_permission_grants(user_id,permission_key,effect) VALUES(uid,'marketing.view','allow');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 ASSERT public.has_global_permission('marketing.view'), 'synthetic allowed fixture';
 result:=public.cc_outreach_audience(30);
 ASSERT result ? 'audiences' AND NOT(result ? 'error'), 'allowed audience';
 result:=public.cc_outreach_log_page('all',null,30,null,1,0);
 ASSERT result ? 'rows' AND NOT(result ? 'error'), 'allowed log';
 ASSERT jsonb_array_length(result->'rows')<=1, 'pagination limit';
 EXECUTE 'RESET ROLE';
 UPDATE app_private.user_permission_grants SET effect='deny' WHERE user_id=uid;
 EXECUTE 'SET LOCAL ROLE authenticated';
 ASSERT public.cc_outreach_audience(30)->>'error'='not authorized','explicit deny audience';
 ASSERT public.cc_outreach_log_page('all',null,30,null,1,0)->>'error'='not authorized','explicit deny log';
 EXECUTE 'RESET ROLE';
 UPDATE app_private.user_permission_grants SET effect='allow' WHERE user_id=uid;
 UPDATE app_private.staff_members SET status='suspended' WHERE user_id=uid;
 EXECUTE 'SET LOCAL ROLE authenticated';
 ASSERT public.cc_outreach_audience(30)->>'error'='not authorized','suspended refusal';
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',other::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 ASSERT public.cc_outreach_log_page('all',null,30,null,1,0)->>'error'='not authorized','nonstaff refusal';
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN
  PERFORM public.cc_outreach_audience(30);
  RAISE EXCEPTION 'anonymous RPC unexpectedly accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 EXECUTE 'RESET ROLE';
END $tests$;
-- Only for a promotion where BOTH reports and opened_at were absent beforehand.
-- Wrap in BEGIN/COMMIT after explicit approval. Refuses drift and engagement-data loss.
DO $rollback$
BEGIN
 IF md5(pg_get_functiondef('public.cc_outreach_audience(integer)'::regprocedure)) <> 'ec52b049ffac878ad22571d8e46bc41c' OR
    md5(pg_get_functiondef('public.cc_outreach_log_page(text,text,integer,text,integer,integer)'::regprocedure)) <> 'e7c8099698133d28de3c9c8601a777a2' THEN
   RAISE EXCEPTION 'Report definitions changed; refuse rollback';
 END IF;
 IF EXISTS(SELECT 1 FROM app_private.outreach_contacts WHERE opened_at IS NOT NULL) THEN
   RAISE EXCEPTION 'New engagement data exists; preserve opened_at and review rollback';
 END IF;
END $rollback$;
DROP FUNCTION public.cc_outreach_audience(integer);
DROP FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer);
ALTER TABLE app_private.outreach_contacts DROP COLUMN opened_at;

-- Prepared locally only. Production execution needs explicit approval.
-- No outreach control, sender, schedule or existing engagement backfill.
DO $guard$
DECLARE r record; actual text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.cc_outreach_audience(integer)','ec52b049ffac878ad22571d8e46bc41c'),
 ('public.cc_outreach_log_page(text,text,integer,text,integer,integer)','e7c8099698133d28de3c9c8601a777a2')) AS x(sig,hash)
 LOOP
  IF to_regprocedure(r.sig) IS NOT NULL THEN
   SELECT md5(pg_get_functiondef(to_regprocedure(r.sig))) INTO actual;
   IF actual <> r.hash THEN RAISE EXCEPTION 'Existing report drift: %',r.sig; END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND table_name='outreach_contacts' AND column_name='opened_at' AND (data_type<>'timestamp with time zone' OR is_nullable<>'YES')) THEN RAISE EXCEPTION 'opened_at shape drift'; END IF;
END $guard$;
ALTER TABLE app_private.outreach_contacts ADD COLUMN IF NOT EXISTS opened_at timestamptz;
CREATE OR REPLACE FUNCTION public.cc_outreach_audience(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
win as (select (greatest(coalesce(p_days,30),1)||' days')::interval as w),
lists as (
  select kind,
    count(*)                                             as contacts,
    count(*) filter (where status='active')              as active,
    count(*) filter (where emails_sent = 0)              as never_touched,
    count(*) filter (where emails_sent between 1 and 6)  as in_drip,
    count(*) filter (where emails_sent >= 7)             as finished_drip,
    count(*) filter (where status='bounced')             as bounced,
    count(*) filter (where status='unsubscribed')        as unsubscribed,
    count(*) filter (where opened_at  is not null)       as opened,
    count(*) filter (where clicked_at is not null)       as clicked,
    count(*) filter (where replied_at is not null)       as replied,
    count(*) filter (where converted_at is not null)     as converted
  from app_private.outreach_contacts group by kind
),
sends as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
    count(*)                                                          as sent,
    count(*) filter (where d.status='delivered')                      as delivered,
    count(*) filter (where d.status in ('bounced','failed','dead_letter','complained')) as bad,
    count(*) filter (where d.opened_at  is not null)                  as opened,
    count(*) filter (where d.clicked_at is not null)                  as clicked
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%' and d.created_at > now() - win.w
  group by 1
),
-- How fast is the cold list actually moving? Count day-1 sends in the window.
intake as (
  select split_part(replace(d.template_key,'outreach.',''),'-',1) as kind,
         count(*) as new_started
  from app_private.message_deliveries d, win
  where d.template_key like 'outreach.%-d1' and d.created_at > now() - win.w
  group by 1
),
steps as (
  select kind, emails_sent as step, count(*) as n,
         count(*) filter (where clicked_at is not null) as clicked,
         count(*) filter (where opened_at  is not null) as opened
  from app_private.outreach_contacts where emails_sent > 0 group by 1,2
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'days', greatest(coalesce(p_days,30),1),
  'audiences', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', l.kind,
      'contacts', l.contacts, 'active', l.active,
      'never_touched', l.never_touched, 'in_drip', l.in_drip, 'finished_drip', l.finished_drip,
      'bounced', l.bounced, 'unsubscribed', l.unsubscribed,
      'contacts_opened', l.opened, 'contacts_clicked', l.clicked,
      'replied', l.replied, 'converted', l.converted,
      'sent', coalesce(s.sent,0), 'delivered', coalesce(s.delivered,0), 'bad', coalesce(s.bad,0),
      'opens', coalesce(s.opened,0), 'clicks', coalesce(s.clicked,0),
      'new_started', coalesce(i.new_started,0),
      'intake_per_day', round(coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1), 1),
      'runway_days', case when coalesce(i.new_started,0) = 0 then null
                          else ceil(l.never_touched::numeric
                               / (coalesce(i.new_started,0)::numeric / greatest(coalesce(p_days,30),1))) end,
      'steps', coalesce((select jsonb_agg(jsonb_build_object('step',st.step,'n',st.n,'clicked',st.clicked,'opened',st.opened) order by st.step)
                         from steps st where st.kind = l.kind), '[]'::jsonb)
    ) order by l.kind)
    from lists l left join sends s on s.kind = l.kind left join intake i on i.kind = l.kind), '[]'::jsonb))
end;
$function$;
CREATE OR REPLACE FUNCTION public.cc_outreach_log_page(p_filter text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_days integer DEFAULT 30, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
with guard as (
  select (public.has_global_permission('marketing.view')
       or public.has_global_permission('carriers.approve')
       or public.has_global_permission('dispatch.manage')) as ok
),
p as (
  select least(greatest(coalesce(p_limit,50),1),200) as lim,
         greatest(coalesce(p_offset,0),0)            as off,
         nullif(btrim(coalesce(p_q,'')),'')          as q,
         nullif(btrim(coalesce(p_kind,'')),'')       as kind,
         case when coalesce(p_days,0) <= 0 then null else (p_days||' days')::interval end as win
),
removed as (
  select c.email, c.company, c.kind as audience, c.status, c.emails_sent,
         c.last_sent_at as when_at, null::text as tpl, null::text as reason,
         c.opened_at, c.clicked_at
    from app_private.outreach_contacts c, p
   where p_filter = 'removed'
     and c.status in ('bounced','unsubscribed','suppressed')
     and (p.kind is null or c.kind = p.kind)
     and (p.win is null or c.last_sent_at > now() - p.win)
     and (p.q is null or c.email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
),
sends as (
  select d.recipient_email as email, c.company, c.kind as audience, d.status,
         coalesce(c.emails_sent,0) as emails_sent,
         coalesce(d.sent_at, d.created_at) as when_at,
         d.template_key as tpl, d.failure_reason as reason,
         d.opened_at, d.clicked_at
    from app_private.message_deliveries d
    left join app_private.outreach_contacts c on lower(c.email) = lower(d.recipient_email)
    cross join p
   where p_filter <> 'removed'
     and d.template_key like 'outreach.%'
     and (p.win is null or d.created_at > now() - p.win)
     and (p.kind is null or d.template_key like 'outreach.'||p.kind||'-%')
     and (p.q is null or d.recipient_email ilike '%'||p.q||'%' or coalesce(c.company,'') ilike '%'||p.q||'%')
     and (   p_filter = 'all'
          or (p_filter = 'sent'    and d.status in ('sent','delivered'))
          or (p_filter = 'failed'  and d.status in ('failed','bounced','dead_letter','complained'))
          or (p_filter = 'opened'  and d.opened_at is not null)
          or (p_filter = 'clicked' and d.clicked_at is not null))
),
base as (select * from removed union all select * from sends),
page as (
  select * from base order by when_at desc nulls last limit (select lim from p) offset (select off from p)
)
select case when not (select ok from guard) then jsonb_build_object('error','not authorized')
else jsonb_build_object(
  'total',  (select count(*) from base),
  'limit',  (select lim from p),
  'offset', (select off from p),
  'filter', p_filter,
  'rows', coalesce((select jsonb_agg(jsonb_build_object(
             'email', email, 'company', company, 'audience', audience, 'status', status,
             'emails_sent', emails_sent, 'tpl', tpl, 'reason', reason,
             'opened', opened_at is not null, 'clicked', clicked_at is not null,
             'when', when_at) order by when_at desc nulls last) from page), '[]'::jsonb))
end;
$function$;
REVOKE ALL ON FUNCTION public.cc_outreach_audience(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cc_outreach_audience(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cc_outreach_log_page(text,text,integer,text,integer,integer) TO authenticated, service_role;

SELECT 'PASS: guarded rollback/reapply plus report creation from absent functions/column, reapply, exact source/grants, permission matrix, pagination and unchanged anon surface; all fixture writes rolled back' result;
ROLLBACK;

