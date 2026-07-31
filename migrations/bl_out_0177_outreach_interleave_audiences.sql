-- bl_out_0177 — outreach: interleave audiences so brokers actually get sent to.
--
-- Symptom: 42,082 broker contacts, every one eligible, and zero emails ever sent
-- to a broker since the engine started on 2026-07-24.
--
-- Cause: the daily selection ordered by `emails_sent desc` ("finish sequences
-- already in flight first"). The ~400 carriers mid-sequence consumed the entire
-- daily cap every single day, so anyone at emails_sent = 0 never surfaced.
--
-- Fix: rank within each audience, then interleave. The daily cap, the 3-day gap,
-- the 7-email limit and template selection are all unchanged, so total send
-- volume does not increase — only the mix does.
--
-- Verified by dry run before applying: 100 carriers / 0 brokers -> 50 / 50 at a
-- cap of 100, and 100 / 100 once the ramp reaches 200.

CREATE OR REPLACE FUNCTION app_private.outreach_run_daily()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare st app_private.outreach_state; v_cap int; v_sent int := 0; c record; t record; v_html text; v_unsub text; v_health jsonb;
begin
  v_health := app_private.outreach_health_check();
  if coalesce((v_health->>'paused')::boolean, false) then return jsonb_build_object('skipped','killswitch', 'health', v_health); end if;
  select * into st from app_private.outreach_state where id=1;
  if not st.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if st.started_on is null then update app_private.outreach_state set started_on=current_date where id=1; st.started_on := current_date; end if;
  if st.last_run is distinct from current_date then update app_private.outreach_state set last_run=current_date, sent_today=0 where id=1; st.sent_today := 0; end if;
  v_cap := least(st.max_cap, st.base_cap * (2 ^ floor((current_date - st.started_on) / 7.0))::int) - st.sent_today;
  if v_cap <= 0 then return jsonb_build_object('skipped','cap reached'); end if;
  for c in
    select r.* from (
      select oc.*,
             row_number() over (partition by oc.kind
               order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc) as _rn
      from app_private.outreach_contacts oc
      where oc.status='active' and oc.emails_sent < 7
        and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
        and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
    ) r
    order by r._rn, r.kind
    limit v_cap
  loop
    select * into t from app_private.outreach_templates where audience=c.kind and day=c.emails_sent+1 and active;
    v_unsub := 'https://loadboot.com/unsub.html?e=' || replace(lower(trim(c.email)),'+','%2B') || '&t=' || app_private.outreach_unsub_token(c.email);
    v_html := coalesce(case when t.parts is not null then app_private.outreach_render(t.parts) else t.html end, '');
    if v_html = '' then continue; end if;
    v_html := replace(replace(v_html, '{NAME}', coalesce(nullif(trim(c.company),''),'there')), '{UNSUB}', v_unsub);
    begin
      perform app_private.sys_email(c.email, 'outreach.'||c.kind||'-d'||t.day, t.subject, v_html, null,
        'outr:'||c.id::text||':d'||t.day);
      update app_private.outreach_contacts
        set emails_sent = emails_sent + 1, last_sent_at = now(),
            status = case when emails_sent + 1 >= 7 then 'completed' else status end
        where id = c.id;
      v_sent := v_sent + 1;
    exception when others then null; end;
  end loop;
  update app_private.outreach_state set sent_today = sent_today + v_sent where id=1;
  return jsonb_build_object('ok', true, 'sent', v_sent, 'cap', v_cap, 'health', v_health);
end $function$;

-- The Command Center preview used the old global ordering, so it showed a
-- carriers-only batch while the sender sent carriers + brokers. Same ranking now.
CREATE OR REPLACE FUNCTION public.cc_outreach_today()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
  select case when not (public.has_global_permission('marketing.view') or public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized') else (
  with st as (select * from app_private.outreach_state where id = 1),
  cap as (select greatest(0, least(st.max_cap, st.base_cap * (2 ^ floor((current_date - coalesce(st.started_on, current_date)) / 7.0))::int)
            - case when st.last_run is distinct from current_date then 0 else st.sent_today end) as n, st.enabled from st),
  due0 as (
    select oc.kind, oc.emails_sent + 1 as day, oc.email, oc.company,
           row_number() over (partition by oc.kind
             order by oc.emails_sent desc, oc.last_sent_at asc nulls last, oc.created_at asc) as krn
    from app_private.outreach_contacts oc
    where oc.status = 'active' and oc.emails_sent < 7
      and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
      and exists (select 1 from app_private.outreach_templates tt where tt.audience = oc.kind and tt.day = oc.emails_sent + 1 and tt.active)
  ),
  due as (
    select d.*, row_number() over (order by d.krn, d.kind) as rn from due0 d
  )
  select jsonb_build_object(
    'enabled', (select enabled from cap),
    'cap_remaining', (select n from cap),
    'total_due', (select count(*) from due),
    'batch', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('audience', d.kind, 'day', d.day, 'subject',
          (select subject from app_private.outreach_templates where audience = d.kind and day = d.day and active),
          'n', count(*)) as x
        from due d where d.rn <= (select n from cap) group by d.kind, d.day order by d.kind, d.day) q), '[]'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('email', d.email, 'company', d.company, 'audience', d.kind, 'day', d.day) order by d.rn)
        from due d where d.rn <= 10), '[]'::jsonb)
  )) end;
$function$;
