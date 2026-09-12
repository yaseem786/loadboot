-- bl_disp_0307 — a submitted skills test has to appear in the dispatch queue, not only inside the
-- candidate's drawer. Yaseen 12 Sep: "wo jb submit kary ga to CC mn submitted result dikhy ga?" — it
-- did, but only if you happened to open that dispatcher. A test nobody opens is a candidate waiting,
-- and 48 hours of goodwill lost. Staging first, then prod.
do $patch$
declare src text; v_old text; v_new text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_queue()'::regprocedure);
  v_old := 'where p.status = ''trial'' and p.trial_end is not null and p.trial_end <= current_date + 3), ''[]''::jsonb)) end;';
  if position(v_old in src) = 0 then raise exception 'cc_dispatcher_queue: trials_ending tail not found'; end if;
  v_new := 'where p.status = ''trial'' and p.trial_end is not null and p.trial_end <= current_date + 3), ''[]''::jsonb),
    ''tests_to_score'', coalesce((select jsonb_agg(jsonb_build_object(
        ''user_id'', t.user_id,
        ''name'', (select dp.full_name from app_private.dispatcher_profiles dp where dp.user_id = t.user_id),
        ''attempt_no'', t.attempt_no,
        ''submitted_at'', t.submitted_at,
        ''auto_score'', t.auto_score,
        ''max_score'', t.max_score,
        ''waiting_hours'', round(extract(epoch from (now() - t.submitted_at))/3600, 1)) order by t.submitted_at)
      from app_private.skills_test_attempts t where t.status = ''submitted''), ''[]''::jsonb)) end;';
  src := replace(src, v_old, v_new);
  execute src;
end $patch$;
