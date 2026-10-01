-- bl_ship_0510 — partner_review tasks follow the staff decision, and the 4-hourly cron stops duplicating them (1 Oct 2026).
--   Found on Shipper 360 → Health: MII (held 30 Sep) still showed two open review tasks for the same job —
--   "Review new broker/shipper registration" (rule partner_submitted_review, urgent, SLA breached) and
--   "Review pending shipper: MII…" (cron ops.pending_partner).
--   1. automation_task_close_candidates (anchor-patched): a partner_review task now also closes when the partner is
--      still 'pending' but staff decided AFTER the task was opened — a shipper hold (shipper_trust.held_at, incl. a failed
--      call-back), a broker/agent hold (broker_trust.held_at), or a park (cc_partner_set_status 'park' → audit
--      partner.park). The existing branch already closes it when the org leaves 'pending' (approve → active).
--      The every-minute reconcile closes it as 'done' and notes "[auto-closed <date>: shipper put on hold]" in the
--      description + automation_task_autoclose_log. A task opened after the decision stays open.
--   2. cron_pending_partner_alert (full definition — it lived only on prod, never in the repo):
--      - one open review task per org, whichever rule made it (it only looked at its own source_rule before);
--      - skips a held shipper / broker and a parked partner (latest decision = park): staff already decided, the
--        "approve, reject or ask" nag and the daily staff bell are noise. A resubmission still opens a fresh task via
--        the rule engine (run_rules_for_event, which already dedupes per task_type + org).
--   Schedule unchanged on prod (lb-pending-partner-alert, 35 */4 * * *); staging gets the function only, no schedule.
-- No public function created or changed; raises if the anon SECURITY DEFINER names move.

drop table if exists pg_temp._bl0510_anon;
create temp table _bl0510_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

-- 1. close candidates -----------------------------------------------------------------------------------------------
do $mig$
declare d text; a text; n int;
begin
  d := pg_get_functiondef('app_private.automation_task_close_candidates()'::regprocedure);
  if position('bl_ship_0510' in d) = 0 then
    a := $a$       and (coalesce(p.status, o.status) is null or coalesce(p.status, o.status) <> 'pending')
$a$;
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    if n <> 1 then raise exception 'bl_ship_0510: anchor found % times — refusing', n; end if;
    d := replace(d, a, a || $b$    union all
    -- bl_ship_0510: still 'pending', but staff decided after the task was opened (hold / failed call-back / park)
    select t.id, 'done',
           case when st.held_at >= t.created_at then 'shipper put on hold'
                when bt.held_at >= t.created_at then 'account put on hold'
                else 'parked by staff' end
      from app_private.automation_tasks t
      join public.organizations o on o.id::text = t.related_id and o.status = 'pending'
      left join app_private.shipper_trust st on st.org_id = o.id and st.hold_reason is not null
      left join app_private.broker_trust bt on bt.org_id = o.id and bt.hold_reason is not null
     where t.status in ('open','in_progress') and t.task_type = 'partner_review'
       and (st.held_at >= t.created_at or bt.held_at >= t.created_at
            or exists (select 1 from app_private.audit_logs al
                        where al.target_type = 'org' and al.target_id = o.id::text
                          and al.action = 'partner.park' and al.occurred_at >= t.created_at))
$b$);
    execute d;
  end if;
end $mig$;

-- 2. the pending-partner cron ----------------------------------------------------------------------------------------
create or replace function app_private.cron_pending_partner_alert()
returns integer language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare
  r         record;
  v_hours   integer := 4;    -- SLA: a pending partner older than this is late
  v_made    integer := 0;
begin
  for r in
    select o.id, o.name, o.kind, o.created_at,
           round(extract(epoch from (now() - o.created_at)) / 3600)::int as hrs
      from public.organizations o
     where o.status = 'pending'
       and o.kind in ('broker', 'shipper')
       and coalesce(o.is_demo, false) = false
       and o.created_at < now() - make_interval(hours => v_hours)
       -- bl_ship_0510: staff already decided — held, or parked (latest decision is a park)
       and not exists (select 1 from app_private.shipper_trust st where st.org_id = o.id and st.hold_reason is not null)
       and not exists (select 1 from app_private.broker_trust bt where bt.org_id = o.id and bt.hold_reason is not null)
       and coalesce((select al.action from app_private.audit_logs al
                      where al.target_type = 'org' and al.target_id = o.id::text and al.action in ('partner.park', 'partner.approve')
                      order by al.occurred_at desc limit 1), '') <> 'partner.park'
     order by o.created_at
  loop
    -- One open review task per org, whichever rule opened it (bl_ship_0510; was: only this cron's own tasks).
    if not exists (
      select 1 from app_private.automation_tasks t
       where t.task_type = 'partner_review'
         and t.related_id = r.id::text
         and t.status in ('open', 'in_progress')
    ) then
      insert into app_private.automation_tasks
        (task_type, title, description, status, priority, assignee_role,
         related_type, related_id, due_at, source_rule)
      values (
        'partner_review',
        case when r.hrs >= 72
             then 'OVERDUE: ' || r.name || ' (' || r.kind || ') waiting ' || (r.hrs / 24) || ' days'
             else 'Review pending ' || r.kind || ': ' || r.name
        end,
        r.name || ' signed up as a ' || r.kind || ' on ' ||
        to_char(r.created_at, 'Mon DD') || ' and is still pending after ' || r.hrs ||
        ' hours. The site promises a reply within one business day. Approve, reject, or ask them for what is missing.',
        'open',
        case when r.hrs >= 72 then 'high' else 'normal' end,
        'staff',
        'organization', r.id::text,
        now() + interval '2 hours',
        'ops.pending_partner'
      );
      v_made := v_made + 1;
    end if;

    -- Staff bell, at most once per org per day.
    if not exists (
      select 1 from app_private.notifications n
       where n.template_key = 'partner.pending_overdue'
         and n.payload->>'org' = r.id::text
         and n.created_at > now() - interval '24 hours'
    ) then
      insert into app_private.notifications
        (recipient_role, channel, template_key, payload, status, sent_at)
      values (
        'staff', 'in_app', 'partner.pending_overdue',
        jsonb_build_object(
          'org', r.id::text,
          'name', r.name,
          'kind', r.kind,
          'hours_waiting', r.hrs,
          'url', '/app/command-center/#partners'
        ),
        'sent', now()
      );
    end if;
  end loop;

  return v_made;
end
$function$;
revoke execute on function app_private.cron_pending_partner_alert() from public, anon, authenticated;

-- checks ------------------------------------------------------------------------------------------------------------
do $$
declare v_added text; v_gone text;
begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from pg_temp._bl0510_anon) a;
  select string_agg(n, ', ') into v_gone from (
    select n from pg_temp._bl0510_anon
    except select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0510: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
