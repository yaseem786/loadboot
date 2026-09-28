-- bl_ops_0489 — live tasks. Yaseen 28 Sep: "task wo auto track ho, live ho, zinda — jis kaam ke liye
-- task bana tha agar kisi ne wo kar diya to task khud close ho, deep linking ke saath."
--
-- 0486 closed tasks every 10 minutes, but three things were wrong:
--   1. dispatcher_review closed as soon as the dispatcher reached skills_test. The owner makes the
--      trial/reject call himself after the test, so 12 candidates dropped out of every queue.
--      Now the task stays open until the dispatcher leaves applied/screening/skills_test.
--   2. Only 'open' tasks were looked at; a task someone pressed ▶ Start on never closed itself.
--   3. sales_followup, hot-lead call-backs and email incidents had no close rule at all.
-- Plus: every run built a temp table (catalog churn once a minute is not free), so the candidates
-- are now one STABLE function and the close is one data-modifying statement.
--
-- Live: app_private.automation_task_live(...) says where the underlying work stands right now and
-- whose move it is ('you' / 'them' / 'done'). cc_list_tasks returns it as live_text/live_turn and
-- cc_action_center puts it on every task row in "Needs you now". Cron goes from 10 min to 1 min.

-- 1. what can be closed, and why ------------------------------------------------------------------
create or replace function app_private.automation_task_close_candidates()
returns table (id uuid, new_status text, reason text)
language sql stable set search_path = app_private, public as $fn$
  select distinct on (id) id, new_status, reason from (
    select t.id, case when a.status in ('approved','rejected') then 'done' else 'cancelled' end new_status,
           case when a.user_id is null then 'agent profile no longer exists'
                when a.status in ('approved','rejected') then 'agent ' || a.status
                else 'agent never submitted (draft, agreement unsigned)' end reason
      from app_private.automation_tasks t left join app_private.agent_profiles a on a.user_id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'agent_review'
       and (a.user_id is null or a.status in ('approved','rejected') or (a.status = 'draft' and a.agreement_signed_at is null))
    union all
    -- bl_ops_0489: skills_test is NOT the end — the owner still has to start the trial or reject
    select t.id, case when d.user_id is null then 'cancelled' else 'done' end,
           case when d.user_id is null then 'dispatcher profile no longer exists' else 'dispatcher moved to ' || d.status end
      from app_private.automation_tasks t left join app_private.dispatcher_profiles d on d.user_id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'dispatcher_review'
       and (d.user_id is null or d.status not in ('applied','screening','skills_test'))
    union all
    select t.id, 'done', 'enquiry ' || f.status
      from app_private.automation_tasks t join app_private.form_submissions f on f.id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'form_followup' and f.status in ('closed','converted')
    union all
    select t.id, 'done', 'ticket ' || s.status
      from app_private.automation_tasks t join app_private.support_tickets s on s.id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'ticket_followup' and s.status in ('resolved','closed')
    union all
    select t.id, 'done', 'carrier already active'
      from app_private.automation_tasks t join public.organizations o on o.id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type in ('onboarding_review','onboarding_approval') and o.status = 'active'
    union all
    select t.id, case when coalesce(p.status, o.status) is null then 'cancelled' else 'done' end,
           case when coalesce(p.status, o.status) is null then 'registration no longer exists' else 'registration already ' || coalesce(p.status, o.status) end
      from app_private.automation_tasks t
      left join app_private.partners p on p.id::text = t.related_id
      left join public.organizations o on o.id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'partner_review'
       and (coalesce(p.status, o.status) is null or coalesce(p.status, o.status) <> 'pending')
    union all
    select t.id, 'done', 'bank details verified ' || to_char(pp.verified_at, 'YYYY-MM-DD')
      from app_private.automation_tasks t join app_private.org_payment_profiles pp on pp.org_id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'bank_details_verify' and pp.verified and pp.verified_at >= t.created_at
    union all
    select t.id, 'done', 'NOA ' || pp.noa_status
      from app_private.automation_tasks t join app_private.org_payment_profiles pp on pp.org_id::text = t.related_id
     where t.status in ('open','in_progress') and t.task_type = 'noa_verify' and pp.noa_status in ('verified','rejected')
    union all
    -- bl_ops_0489: lead follow-up is done once someone logged a CRM activity or actually spoke to them
    select t.id,
           case when l.id is null then 'cancelled' else 'done' end,
           case when l.id is null then 'lead no longer exists'
                when l.status = 'lost' then 'lead marked lost'
                when act.at is not null then 'follow-up logged in CRM ' || to_char(act.at, 'YYYY-MM-DD')
                else 'spoke to the lead on a call ' || to_char(cl.at, 'YYYY-MM-DD') end
      from app_private.automation_tasks t
      left join app_private.crm_leads l on l.id::text = t.related_id
      left join lateral (select min(a.created_at) at from app_private.crm_activities a where a.lead_id = l.id and a.created_at > t.created_at) act on true
      left join lateral (select min(c.created_at) at from app_private.lc_calls c where c.lead_id = l.id and c.created_at > t.created_at and c.duration_sec > 0) cl on true
     where t.status in ('open','in_progress') and t.task_type = 'sales_followup' and t.related_type = 'lead'
       and (l.id is null or l.status = 'lost' or act.at is not null or cl.at is not null)
    union all
    -- bl_ops_0489: "call back the hot lead" is done when an outbound call to that number connected
    select t.id, 'done', 'called back ' || to_char(cb.at, 'YYYY-MM-DD')
      from app_private.automation_tasks t
      join app_private.lc_calls o on o.call_id = t.related_id
      join lateral (select min(c.created_at) at from app_private.lc_calls c
                     where c.direction = 'outbound' and c.to_number = o.from_number
                       and c.created_at > t.created_at and c.duration_sec > 0) cb on cb.at is not null
     where t.status in ('open','in_progress') and t.task_type = 'followup' and t.related_type = 'lc_call'
    union all
    -- bl_ops_0489: "email delivery has stopped" is over when mail has flowed for an hour since and nothing is stuck
    select t.id, 'done', 'email delivery recovered'
      from app_private.automation_tasks t
     where t.status in ('open','in_progress') and t.task_type = 'incident' and t.related_id = 'email_health'
       and exists (select 1 from app_private.message_deliveries m where m.channel = 'email'
                    and m.status in ('sent','delivered','opened','clicked') and m.sent_at > t.created_at + interval '1 hour')
       and not exists (select 1 from app_private.message_deliveries m where m.channel = 'email'
                        and m.status in ('queued','scheduled') and coalesce(m.scheduled_at, m.created_at) < now() - interval '1 hour')
  ) c order by id;
$fn$;
revoke all on function app_private.automation_task_close_candidates() from public, anon, authenticated;

-- 2. close them (and log it) ---------------------------------------------------------------------
create or replace function app_private.automation_tasks_reconcile(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = app_private, public as $fn$
declare v jsonb;
begin
  -- once a minute from cron: never let two runs log the same close twice
  if not p_dry_run and not pg_try_advisory_xact_lock(hashtext('app_private.automation_tasks_reconcile')) then
    return jsonb_build_object('skipped', 'another reconcile is running');
  end if;

  select jsonb_build_object('dry_run', p_dry_run, 'total', coalesce(sum(n), 0),
           'by_reason', coalesce(jsonb_object_agg(k, n), '{}'::jsonb))
    into v
    from (select t.task_type || ' · ' || c.reason k, count(*) n
            from app_private.automation_task_close_candidates() c join app_private.automation_tasks t on t.id = c.id
           group by 1) s;
  if p_dry_run or (v->>'total')::int = 0 then return v; end if;

  with c as materialized (select * from app_private.automation_task_close_candidates()),
  pre as materialized (select t.id, t.status from app_private.automation_tasks t join c on c.id = t.id
                        where t.status in ('open','in_progress')),
  up as (
    update app_private.automation_tasks t
       set status = c.new_status, completed_at = now(),
           description = concat_ws(E'\n', nullif(t.description, ''), '[auto-closed ' || to_char(now(), 'YYYY-MM-DD') || ': ' || c.reason || ']')
      from c where t.id = c.id and t.status in ('open','in_progress')
    returning t.id, t.task_type, t.related_type, t.related_id, t.priority, c.new_status, c.reason)
  insert into app_private.automation_task_autoclose_log (task_id, task_type, related_type, related_id, prev_status, prev_priority, new_status, reason)
  select up.id, up.task_type, up.related_type, up.related_id, pre.status, up.priority, up.new_status, up.reason
    from up join pre on pre.id = up.id;
  return v;
end $fn$;
revoke all on function app_private.automation_tasks_reconcile(boolean) from public, anon, authenticated;

-- 3. where the work stands right now, and whose move it is ----------------------------------------
create or replace function app_private.automation_task_live(p_task_type text, p_related_type text, p_related_id text, p_created_at timestamptz)
returns jsonb language plpgsql stable set search_path = app_private, public as $fn$
declare
  s text; s2 text; d date; n int; sc text;
  a record;
  you  constant text := 'you';
  them constant text := 'them';
begin
  if p_related_id is null then return null; end if;

  if p_task_type = 'dispatcher_review' then
    select dp.status into s from app_private.dispatcher_profiles dp where dp.user_id::text = p_related_id;
    if not found then return jsonb_build_object('text', 'Dispatcher profile no longer exists', 'turn', 'done'); end if;
    if s = 'applied'   then return jsonb_build_object('text', 'New application — screen it, then send the skills test', 'turn', you); end if;
    if s = 'screening' then return jsonb_build_object('text', 'In screening — send the skills test or reject', 'turn', you); end if;
    if s <> 'skills_test' then return jsonb_build_object('text', 'Dispatcher is now ' || s, 'turn', 'done'); end if;
    select * into a from app_private.skills_test_attempts x where x.user_id::text = p_related_id order by x.attempt_no desc limit 1;
    if not found then return jsonb_build_object('text', 'Skills-test stage, but no test has been sent yet', 'turn', you); end if;
    sc := coalesce(round(coalesce(a.staff_score, a.auto_score))::text, '?') || '/' || coalesce(round(a.max_score)::text, '?');
    if a.status = 'invited' then
      return jsonb_build_object('text', 'Test sent ' || to_char(a.invited_at, 'Mon DD') || ' — waiting for the candidate to take it', 'turn', them);
    elsif a.status = 'submitted' then
      return jsonb_build_object('text', 'Test submitted ' || to_char(a.submitted_at, 'Mon DD') || ' — score it', 'turn', you);
    elsif a.status = 'expired' then
      return jsonb_build_object('text', 'Test expired unanswered — send it again or reject', 'turn', you);
    elsif a.status = 'scored' and a.decision = 'pass' then
      if exists (select 1 from app_private.dispatcher_carrier_choices ch where ch.dispatcher_user_id::text = p_related_id and ch.status = 'pending') then
        return jsonb_build_object('text', 'Passed ' || sc || ' and picked a carrier — accept or decline the choice', 'turn', you);
      end if;
      return jsonb_build_object('text', 'Passed ' || sc || ' — start the trial or reject', 'turn', you);
    elsif a.status = 'scored' then
      return jsonb_build_object('text', 'Failed ' || sc || ' — reject, or allow a re-test', 'turn', you);
    end if;
    return jsonb_build_object('text', 'Skills test: ' || a.status, 'turn', you);

  elsif p_task_type = 'agent_review' then
    select ap.status into s from app_private.agent_profiles ap where ap.user_id::text = p_related_id;
    if not found then return jsonb_build_object('text', 'Agent profile no longer exists', 'turn', 'done'); end if;
    if s = 'draft' then return jsonb_build_object('text', 'Still a draft — waiting for the agent to finish and submit', 'turn', them); end if;
    if s in ('approved','rejected') then return jsonb_build_object('text', 'Agent ' || s, 'turn', 'done'); end if;
    return jsonb_build_object('text', 'Submitted — check ID, payout proof and W-9, then approve or reject', 'turn', you);

  elsif p_task_type = 'form_followup' then
    select f.status into s from app_private.form_submissions f where f.id::text = p_related_id;
    if not found then return null; end if;
    if s in ('closed','converted') then return jsonb_build_object('text', 'Enquiry ' || s, 'turn', 'done'); end if;
    if s = 'new' then return jsonb_build_object('text', 'Nobody has answered this enquiry yet', 'turn', you); end if;
    return jsonb_build_object('text', 'Enquiry is ' || s || ' — close it or convert it when finished', 'turn', you);

  elsif p_task_type = 'ticket_followup' then
    select st.status into s from app_private.support_tickets st where st.id::text = p_related_id;
    if not found then return null; end if;
    if s in ('resolved','closed') then return jsonb_build_object('text', 'Ticket ' || s, 'turn', 'done'); end if;
    return jsonb_build_object('text', 'Ticket is ' || s, 'turn', case when s = 'pending' then them else you end);

  elsif p_task_type = 'sales_followup' and p_related_type = 'lead' then
    select l.status into s from app_private.crm_leads l where l.id::text = p_related_id;
    if not found then return jsonb_build_object('text', 'Lead no longer exists', 'turn', 'done'); end if;
    select count(*) into n from app_private.lc_calls c where c.lead_id::text = p_related_id and c.created_at > p_created_at;
    if n > 0 then return jsonb_build_object('text', 'Called ' || n || '× since — nobody picked up yet', 'turn', you); end if;
    return jsonb_build_object('text', 'No follow-up logged yet — call or email, then log it in CRM', 'turn', you);

  elsif p_task_type = 'followup' and p_related_type = 'lc_call' then
    select count(*) into n from app_private.lc_calls o join app_private.lc_calls c
      on c.direction = 'outbound' and c.to_number = o.from_number and c.created_at > p_created_at
     where o.call_id = p_related_id;
    if n > 0 then return jsonb_build_object('text', 'Called back ' || n || '× — no answer yet', 'turn', you); end if;
    return jsonb_build_object('text', 'Not called back yet', 'turn', you);

  elsif p_task_type = 'bank_details_verify' then
    select pp.verified_at::date into d from app_private.org_payment_profiles pp where pp.org_id::text = p_related_id;
    return jsonb_build_object('text', 'New bank details are not verified yet' || coalesce(' (last verified ' || to_char(d, 'Mon DD') || ')', ''), 'turn', you);

  elsif p_task_type = 'noa_verify' then
    select pp.noa_status into s from app_private.org_payment_profiles pp where pp.org_id::text = p_related_id;
    return jsonb_build_object('text', 'NOA is ' || coalesce(s, 'missing'), 'turn', you);

  elsif p_task_type = 'partner_review' then
    select coalesce(p.status, o.status) into s2
      from (select 1) x
      left join app_private.partners p on p.id::text = p_related_id
      left join public.organizations o on o.id::text = p_related_id;
    return jsonb_build_object('text', 'Registration is ' || coalesce(s2, 'missing') || ' — verify authority and activate', 'turn', you);

  elsif p_task_type in ('onboarding_review','onboarding_approval') then
    select o.status into s from public.organizations o where o.id::text = p_related_id;
    return jsonb_build_object('text', 'Carrier is ' || coalesce(s, 'missing'), 'turn', you);
  end if;
  return null;
end $fn$;
revoke all on function app_private.automation_task_live(text, text, text, timestamptz) from public, anon, authenticated;

-- 4. the task list carries the live line (+ labels for dispatchers, leads and calls) ------------------
drop function if exists public.cc_list_tasks(text, integer);
create function public.cc_list_tasks(p_status text default 'open', p_limit integer default 100)
returns table(id uuid, task_type text, title text, description text, status text, priority text, assignee_role text,
              assignee_user uuid, assignee_name text, started_at timestamptz, related_type text, related_id text,
              related_label text, requires_approval boolean, due_at timestamptz, sla_at timestamptz, created_at timestamptz,
              live_text text, live_turn text)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select q.*, q2.live->>'text', q2.live->>'turn' from (
    select t.id, t.task_type, t.title, t.description, t.status, t.priority,
    t.assignee_role, t.assignee_user,
    (select coalesce(p2.contact_name, p2.email) from public.profiles p2 where p2.id = t.assignee_user),
    t.started_at, t.related_type, t.related_id,
    case t.related_type
      when 'trip' then (select l.origin || ' → ' || l.destination || ' · $' || l.rate from app_private.trips tr join public.loads l on l.id=tr.load_id where tr.id::text=t.related_id)
      when 'load' then coalesce((select l.origin || ' → ' || l.destination || ' · $' || l.rate from public.loads l where l.id::text=t.related_id),
                                (select pl.origin || ' → ' || pl.destination || ' · $' || pl.rate from app_private.partner_loads pl where pl.id::text=t.related_id))
      when 'carrier' then (select o.name from public.organizations o where o.id::text=t.related_id)
      when 'partner' then (select o.name || ' (' || o.kind || ')' from public.organizations o where o.id::text=t.related_id)
      when 'organization' then (select o.name || ' (' || o.kind || ')' from public.organizations o where o.id::text=t.related_id)
      when 'agent' then coalesce((select o.name from public.organizations o where o.id::text=t.related_id),
                                 (select ap.full_name from app_private.agent_profiles ap where ap.user_id::text=t.related_id))
      when 'dispatcher' then (select dp.full_name from app_private.dispatcher_profiles dp where dp.user_id::text=t.related_id)
      when 'lead' then (select cl.title from app_private.crm_leads cl where cl.id::text=t.related_id)
      when 'lc_call' then (select coalesce(c.contact_name || ' · ', '') || coalesce(c.from_number, '') from app_private.lc_calls c where c.call_id=t.related_id limit 1)
      when 'form_submission' then (select coalesce(fs.name,'') || ' · ' || coalesce(fs.email, fs.phone, '') from app_private.form_submissions fs where fs.id::text=t.related_id)
      when 'support_ticket' then (select st.subject from app_private.support_tickets st where st.id::text=t.related_id)
      when 'invoice' then (select 'Invoice ' || coalesce(fi.invoice_no,'') || ' · $' || fi.net from app_private.fin_invoices fi where fi.id::text=t.related_id)
      when 'settlement' then (select 'Settlement ' || coalesce(fs2.settlement_no,'') || ' · $' || fs2.net from app_private.fin_settlements fs2 where fs2.id::text=t.related_id)
      else null end,
    t.requires_approval, t.due_at, t.sla_at, t.created_at
    from app_private.automation_tasks t where (p_status is null or t.status=p_status)
    order by t.priority desc, t.created_at desc limit v_limit) q
  cross join lateral (select case when q.status in ('open','in_progress')
                                  then app_private.automation_task_live(q.task_type, q.related_type, q.related_id, q.created_at) end live) q2;
end $function$;
revoke all on function public.cc_list_tasks(text, integer) from public, anon;
grant execute on function public.cc_list_tasks(text, integer) to authenticated, service_role;

-- 5. "Needs you now" gets the same live line on each task row ---------------------------------------
do $patch$
declare src text; a text;
begin
  src := pg_get_functiondef('public.cc_action_center()'::regprocedure);
  a := $a$'related_type',related_type,'related_id',related_id) q,$a$;
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'cc_action_center: task row anchor not found exactly once'; end if;
  src := replace(src, a, $a$'related_type',related_type,'related_id',related_id,'live',app_private.automation_task_live(task_type,related_type,related_id,created_at)) q,   -- bl_ops_0489$a$);
  execute src;
end $patch$;

-- 6. put back the dispatcher tasks 0486 closed too early ----------------------------------------------
with r as (
  select distinct on (l.related_id) l.task_id
    from app_private.automation_task_autoclose_log l
    join app_private.dispatcher_profiles d on d.user_id::text = l.related_id and d.status = 'skills_test'
   where l.task_type = 'dispatcher_review' and l.new_status in ('done','cancelled')
   order by l.related_id, l.closed_at desc),
up as (
  update app_private.automation_tasks t
     set status = 'open', completed_at = null,
         description = concat_ws(E'\n', nullif(t.description, ''), '[reopened ' || to_char(now(), 'YYYY-MM-DD') || ': still in the skills test — closes itself when you start the trial or reject]')
    from r
   where t.id = r.task_id and t.status in ('done','cancelled')
     and not exists (select 1 from app_private.automation_tasks t2 where t2.task_type = 'dispatcher_review'
                      and t2.related_id = t.related_id and t2.status in ('open','in_progress'))
  returning t.id, t.task_type, t.related_type, t.related_id, t.priority)
insert into app_private.automation_task_autoclose_log (task_id, task_type, related_type, related_id, prev_status, prev_priority, new_status, reason)
select up.id, up.task_type, up.related_type, up.related_id, 'done', up.priority, 'open', 'reopened by bl_ops_0489: dispatcher still in skills_test'
  from up;

-- 7. once a minute ------------------------------------------------------------------------------
select cron.unschedule('lb-automation-reconcile') where exists (select 1 from cron.job where jobname = 'lb-automation-reconcile');
select cron.schedule('lb-automation-reconcile', '* * * * *', $c$select app_private.automation_tasks_reconcile()$c$);
