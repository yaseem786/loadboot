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
