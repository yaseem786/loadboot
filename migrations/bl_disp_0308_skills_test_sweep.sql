-- bl_disp_0308 — the sweeper the skills test was missing.
--
-- Two holes found on review (Yaseen, 12 Sep: "mazeed polish ki zarurat to nahi?"). Both only appear
-- when the candidate does nothing — which is exactly when nobody is watching.
--
--  1. ABANDONED ATTEMPT. disp_test_expire only ran when the candidate called start or save, which an
--     absent candidate never does. Someone who started, answered seven questions and closed the laptop
--     left the attempt at 'in_progress' forever: answers saved, never 'submitted', never in the queue,
--     never read. Real work, permanently invisible. Now an expired in-progress attempt WITH answers is
--     auto-submitted and scored (integrity.abandoned = true, submitted_at = ends_at so the reviewer
--     sees why it is short); one with nothing typed becomes 'expired'.
--
--  2. STALE INVITE. An invite past start_by still read as 'invited' in the CC drawer, so a lapsed
--     candidate looked like one who might still start.
--
-- Plus one addition: exactly one reminder e-mail ~12 hours before an unstarted invite closes.
-- Candidates are not ignoring us, they are busy; one nudge is fair and costs nothing.
--
-- Staging first, then prod. Cron: lb-skills-test-sweep, every 10 minutes.

alter table app_private.skills_test_attempts add column if not exists reminded_at timestamptz;

create or replace function app_private.skills_test_sweep()
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare r record; v_auto numeric; v_max numeric; v_answered int; v_name text; v_mail text;
        n_sub int := 0; n_exp int := 0; n_rem int := 0; n_lapsed int := 0;
begin
  select coalesce(sum(max_points),0) into v_max from app_private.skills_test_questions where active;

  -- 1. clocks that have run out
  for r in select * from app_private.skills_test_attempts
            where status = 'in_progress' and now() > ends_at + interval '2 minutes'
  loop
    select count(*) into v_answered from app_private.skills_test_answers
     where attempt_id = r.id and coalesce(trim(answer),'') <> '';

    if v_answered = 0 then
      update app_private.skills_test_attempts set status = 'expired' where id = r.id;
      n_exp := n_exp + 1;
      continue;
    end if;

    update app_private.skills_test_answers ans
       set auto_points = app_private.disp_test_auto_points(ans.answer, q.expect, q.max_points)
      from app_private.skills_test_questions q
     where ans.question_id = q.id and ans.attempt_id = r.id and q.kind = 'number';
    select coalesce(sum(auto_points),0) into v_auto from app_private.skills_test_answers where attempt_id = r.id;

    update app_private.skills_test_attempts
       set status = 'submitted', submitted_at = ends_at, auto_score = v_auto, max_score = v_max,
           integrity = coalesce(integrity,'{}'::jsonb) || jsonb_build_object(
             'answered', v_answered, 'auto_submitted', true, 'abandoned', true,
             'used_minutes', round((extract(epoch from (ends_at - started_at))/60.0)::numeric, 1))
     where id = r.id;
    n_sub := n_sub + 1;

    select coalesce(full_name,'A candidate') into v_name from app_private.dispatcher_profiles where user_id = r.user_id;
    begin
      perform app_private.disp_notify(null, 'staff', 'dispatcher.skills_test.submitted',
        'Skills test closed on time',
        v_name || ' ran out of time with ' || v_answered || ' answer(s) saved. It has been scored as far as it goes — open Dispatchers to read it.',
        '/app/command-center/#/dispatchers?user=' || r.user_id::text, true);
    exception when others then null; end;
  end loop;

  -- 2. invites that lapsed without being started
  update app_private.skills_test_attempts
     set status = 'expired'
   where status = 'invited' and now() > start_by;
  get diagnostics n_lapsed = row_count;

  -- 3. one reminder, ~12 hours before the invite closes
  for r in select * from app_private.skills_test_attempts
            where status = 'invited' and reminded_at is null
              and now() > start_by - interval '12 hours' and now() < start_by
  loop
    select u.email into v_mail from auth.users u where u.id = r.user_id;
    select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name
      from app_private.dispatcher_profiles where user_id = r.user_id;
    if v_mail is not null then
      begin
        perform app_private.sys_email(v_mail, 'dispatcher.skills_test.reminder',
          'LoadBoot Dispatcher — your skills test closes soon',
          '<h2 style="margin:0 0 10px;color:#10223B;font-size:22px">Your skills test is still waiting</h2>'
          || '<p style="margin:0 0 14px;color:#475569;font-size:15px;line-height:1.6">Hi ' || v_name ||
             ' — this is the only reminder we will send. Your test has not been started yet and the invitation closes in about 12 hours.</p>'
          || '<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.7">It takes ' || r.minutes ||
             ' minutes once you press Start, and the clock only begins then — so open it when you have a clear run at it, not before.</p>'
          || '<p style="margin:18px 0 8px"><a href="https://loadboot.com/app/agent/" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800;display:inline-block">Open my skills test</a></p>'
          || '<p style="margin:0;color:#64748b;font-size:13px">If the timing does not work, reply and tell us — we would rather reschedule than lose you to a deadline.</p>',
          null, 'dispskillsrem:' || r.id::text);
      exception when others then null; end;
    end if;
    update app_private.skills_test_attempts set reminded_at = now() where id = r.id;
    n_rem := n_rem + 1;
  end loop;

  return jsonb_build_object('auto_submitted', n_sub, 'expired', n_exp + n_lapsed, 'reminded', n_rem);
end $fn$;

select cron.schedule('lb-skills-test-sweep', '*/10 * * * *', $cron$select app_private.skills_test_sweep();$cron$);
