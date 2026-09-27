-- bl_disp_0485 — the trial daily report (bl_disp_0484) becomes visible and actionable in CC (27 Sep 2026)
--
--   Owner hand-off (27 Sep): "CC dispatcher card pe trial report history aur feedback dikhana, aur zero-activity din
--   ko 'Needs you now' mein daalna."
--   1. disp_trial_daily gains ack_at / ack_by — a red (zero-activity) day stays on the CC home until someone has
--      looked at it. disp_trial_feedback already has handled_at / handled_by.
--   2. public.cc_dispatcher_trial_reports(user, limit) — Dispatcher 360 "Trial daily reports" card: every report sent
--      (day N of M, tone, the window's touches, delivery status/opened from message_deliveries), every help /
--      feedback / mood tap, and a summary. Staff only (disp_is_staff).
--   3. public.cc_dispatcher_trial_ack(kind, id, undo) — "Seen" on a red day (acks that day and any earlier open red
--      days of the same dispatcher), "Handled" on a feedback row. Staff only.
--   4. cc_action_center (CC home "Needs you now"): 'trial_alerts' count + two row kinds, related_id = dispatcher:
--        trial_zero  — one row per trial dispatcher with an un-acked red day in the last 7 days (high)
--        trial_help  — each un-handled help request, feedback note or "Stuck" tap in the last 14 days
--                      (help/stuck high, overdue after 8 h; feedback normal)
--      Both sort ABOVE every automation task (ord -1): prod had 234 open 'urgent' tasks on 27 Sep 2026 and the queue
--      shows 20 rows, so at 'high' a red day would never have been seen.
--      cc_dispatcher_queue (Dispatchers → Needs you now tab): the same two lists as trial_zero / trial_feedback.
--   Both patched by anchor replacement on the live definition (anchors verified on prod and staging 27 Sep 2026).
--   Anon surface (§4): the two new public functions revoke public + anon explicitly; count must stay 36 prod / 35 staging.
begin;

-- ── 1. ack columns ──
alter table app_private.disp_trial_daily add column if not exists ack_at timestamptz;
alter table app_private.disp_trial_daily add column if not exists ack_by uuid;
create index if not exists disp_trial_daily_open_bad on app_private.disp_trial_daily (dispatcher_user_id, report_date desc) where tone = 'bad' and ack_at is null;
create index if not exists disp_trial_feedback_open on app_private.disp_trial_feedback (created_at desc) where handled_at is null;

-- ── 2. 360 card read ──
create or replace function public.cc_dispatcher_trial_reports(p_user uuid, p_limit int default 30) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else jsonb_build_object(
    'reports', coalesce((select jsonb_agg(s.j order by s.report_date desc) from (
        select r.report_date, jsonb_build_object(
          'id', r.id, 'report_date', r.report_date, 'trial_day', r.trial_day, 'trial_days', r.trial_days, 'tone', r.tone,
          'subject', r.subject, 'sent_to', r.sent_to, 'sent_at', r.sent_at,
          'ack_at', r.ack_at, 'ack_by', (select p.email from public.profiles p where p.id = r.ack_by),
          'window', coalesce(r.stats->'window', '{}'::jsonb), 'window_from', r.stats->'window_from', 'window_to', r.stats->'window_to',
          'target', r.stats->'target',
          'pending', (select coalesce(sum(case when jsonb_typeof(x->'items') = 'array' then jsonb_array_length(x->'items') else 0 end), 0)
                        from jsonb_array_elements(case when jsonb_typeof(r.stats->'pending') = 'array' then r.stats->'pending' else '[]'::jsonb end) x),
          'delivery', (select jsonb_build_object('status', m.status, 'sent_at', m.sent_at, 'delivered_at', m.delivered_at,
                                'opened_at', m.opened_at, 'clicked_at', m.clicked_at, 'failure', m.failure_reason)
                         from app_private.message_deliveries m
                        where m.idempotency_key = 'disp.trial.daily:' || r.dispatcher_user_id::text || ':' || to_char(r.report_date, 'YYYYMMDD'))) j
          from app_private.disp_trial_daily r
         where r.dispatcher_user_id = p_user
         order by r.report_date desc
         limit greatest(1, least(coalesce(p_limit, 30), 120))) s), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(s.j order by s.created_at desc) from (
        select f.created_at, jsonb_build_object(
          'id', f.id, 'kind', f.kind, 'mood', f.mood, 'note', f.note, 'report_date', f.report_date, 'created_at', f.created_at,
          'needs_action', (f.kind in ('help','feedback') or f.mood = 'stuck'),
          'handled_at', f.handled_at, 'handled_by', (select p.email from public.profiles p where p.id = f.handled_by)) j
          from app_private.disp_trial_feedback f
         where f.dispatcher_user_id = p_user
         order by f.created_at desc limit 100) s), '[]'::jsonb),
    'summary', (select jsonb_build_object(
          'reports', count(*),
          'bad', count(*) filter (where r.tone = 'bad'),
          'warn', count(*) filter (where r.tone = 'warn'),
          'good', count(*) filter (where r.tone = 'good'),
          'open_bad', count(*) filter (where r.tone = 'bad' and r.ack_at is null),
          'last_sent_at', max(r.sent_at),
          'open_feedback', (select count(*) from app_private.disp_trial_feedback f where f.dispatcher_user_id = p_user
                              and f.handled_at is null and (f.kind in ('help','feedback') or f.mood = 'stuck')),
          'last_mood', (select jsonb_build_object('mood', f.mood, 'at', f.created_at) from app_private.disp_trial_feedback f
                         where f.dispatcher_user_id = p_user and f.kind = 'mood' order by f.created_at desc limit 1))
        from app_private.disp_trial_daily r where r.dispatcher_user_id = p_user)
  ) end
$$;
revoke all on function public.cc_dispatcher_trial_reports(uuid, int) from public, anon;
grant execute on function public.cc_dispatcher_trial_reports(uuid, int) to authenticated;

-- ── 3. seen / handled ──
create or replace function public.cc_dispatcher_trial_ack(p_kind text, p_id uuid, p_undo boolean default false) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare r record; n int := 0;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('ok', false, 'error', 'not authorized'); end if;
  if p_kind = 'report' then
    select dispatcher_user_id, report_date into r from app_private.disp_trial_daily where id = p_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'report not found'); end if;
    if coalesce(p_undo, false) then
      update app_private.disp_trial_daily set ack_at = null, ack_by = null where id = p_id;
    else   -- seeing the latest red day covers the earlier ones
      update app_private.disp_trial_daily set ack_at = now(), ack_by = auth.uid()
       where dispatcher_user_id = r.dispatcher_user_id and tone = 'bad' and ack_at is null and report_date <= r.report_date;
    end if;
  elsif p_kind = 'feedback' then
    update app_private.disp_trial_feedback
       set handled_at = case when coalesce(p_undo, false) then null else now() end,
           handled_by = case when coalesce(p_undo, false) then null else auth.uid() end
     where id = p_id and (coalesce(p_undo, false) or handled_at is null);
  else
    return jsonb_build_object('ok', false, 'error', 'unknown kind');
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n);
end $$;
revoke all on function public.cc_dispatcher_trial_ack(text, uuid, boolean) from public, anon;
grant execute on function public.cc_dispatcher_trial_ack(text, uuid, boolean) to authenticated;

-- ── 4a. CC home "Needs you now" ──
do $patch$
declare src text; a1 text; a2 text;
begin
  src := pg_get_functiondef('public.cc_action_center()'::regprocedure);
  a1 := $a$'choices_pending',(select count(*) from app_private.dispatcher_carrier_choices where status='pending'),$a$;
  a2 := $a$         where c.status='pending'
      ) a order by ord, t desc limit 20) b)$a$;
  if position(a1 in src) = 0 or position(a2 in src) = 0 then raise exception 'cc_action_center: bl_disp_0481 anchors not found'; end if;
  src := replace(src, a1, a1 || $n$
    'trial_alerts',(select count(distinct r.dispatcher_user_id) from app_private.disp_trial_daily r join app_private.dispatcher_profiles dp on dp.user_id = r.dispatcher_user_id
                     where r.tone='bad' and r.ack_at is null and dp.status='trial' and r.report_date >= current_date - 7)
                  +(select count(*) from app_private.disp_trial_feedback f where f.handled_at is null and (f.kind in ('help','feedback') or f.mood='stuck') and f.created_at > now() - interval '14 days'),   -- bl_disp_0485$n$);
  src := replace(src, a2, $n$         where c.status='pending'
        union all   -- bl_disp_0485: a trial dispatcher had a zero-activity day (red daily report) — one row per dispatcher until Seen
        select jsonb_build_object('kind','trial_zero',
                 'title', coalesce(dp.full_name,'A trial dispatcher') || ' had no activity — trial day ' || z.trial_day || ' of ' || z.trial_days
                          || case when z.n > 1 then ' (' || z.n || ' red days)' else '' end,
                 'priority','high','when',z.sent_at,'overdue',(z.sent_at < now() - interval '24 hours'),
                 'related_type','dispatcher','related_id',z.dispatcher_user_id::text),
               -1, z.sent_at   -- ord -1: above the automation tasks (prod has 200+ open 'urgent' tasks filling the 20 slots)
          from (select distinct on (r.dispatcher_user_id) r.dispatcher_user_id, r.trial_day, r.trial_days, r.sent_at,
                       count(*) over (partition by r.dispatcher_user_id) n
                  from app_private.disp_trial_daily r
                 where r.tone='bad' and r.ack_at is null and r.report_date >= current_date - 7
                 order by r.dispatcher_user_id, r.report_date desc) z
          join app_private.dispatcher_profiles dp on dp.user_id = z.dispatcher_user_id and dp.status = 'trial'
        union all   -- bl_disp_0485: help / feedback / "Stuck" from the daily report's buttons
        select jsonb_build_object('kind','trial_help',
                 'title', coalesce(dp.full_name,'A trial dispatcher')
                          || case when f.kind='help' then ' asked for help' when f.kind='feedback' then ' sent feedback' else ' tapped Stuck' end
                          || coalesce(': “' || left(regexp_replace(f.note, '\s+', ' ', 'g'), 90) || case when length(f.note) > 90 then '…' else '' end || '”', ''),
                 'priority', case when f.kind='feedback' then 'normal' else 'high' end,'when',f.created_at,
                 'overdue',(f.kind <> 'feedback' and f.created_at < now() - interval '8 hours'),
                 'related_type','dispatcher','related_id',f.dispatcher_user_id::text),
               -1, f.created_at
          from app_private.disp_trial_feedback f
          left join app_private.dispatcher_profiles dp on dp.user_id = f.dispatcher_user_id
         where f.handled_at is null and (f.kind in ('help','feedback') or f.mood='stuck') and f.created_at > now() - interval '14 days'
      ) a order by ord, t desc limit 20) b)$n$);
  execute src;
end $patch$;

-- ── 4b. Dispatchers → Needs you now tab ──
do $patch$
declare src text; a text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_queue()'::regprocedure);
  a := $a$      from app_private.skills_test_attempts t where t.status = 'submitted'), '[]'::jsonb)) end;$a$;
  if position(a in src) = 0 then raise exception 'cc_dispatcher_queue: tests_to_score tail not found'; end if;
  src := replace(src, a, $n$      from app_private.skills_test_attempts t where t.status = 'submitted'), '[]'::jsonb),
    'trial_zero', coalesce((select jsonb_agg(jsonb_build_object(   -- bl_disp_0485
        'id', z.id, 'user_id', z.dispatcher_user_id, 'name', dp.full_name, 'report_date', z.report_date,
        'trial_day', z.trial_day, 'trial_days', z.trial_days, 'sent_at', z.sent_at, 'red_days', z.n) order by z.sent_at)
      from (select distinct on (r.dispatcher_user_id) r.id, r.dispatcher_user_id, r.report_date, r.trial_day, r.trial_days, r.sent_at,
                   count(*) over (partition by r.dispatcher_user_id) n
              from app_private.disp_trial_daily r
             where r.tone = 'bad' and r.ack_at is null and r.report_date >= current_date - 7
             order by r.dispatcher_user_id, r.report_date desc) z
      join app_private.dispatcher_profiles dp on dp.user_id = z.dispatcher_user_id and dp.status = 'trial'), '[]'::jsonb),
    'trial_feedback', coalesce((select jsonb_agg(jsonb_build_object(   -- bl_disp_0485
        'id', f.id, 'user_id', f.dispatcher_user_id, 'name', dp.full_name, 'kind', f.kind, 'mood', f.mood,
        'note', left(f.note, 300), 'created_at', f.created_at,
        'age_hours', round(extract(epoch from (now() - f.created_at))/3600, 1)) order by f.created_at)
      from app_private.disp_trial_feedback f left join app_private.dispatcher_profiles dp on dp.user_id = f.dispatcher_user_id
     where f.handled_at is null and (f.kind in ('help','feedback') or f.mood = 'stuck') and f.created_at > now() - interval '14 days'), '[]'::jsonb)) end;$n$);
  execute src;
end $patch$;

commit;
