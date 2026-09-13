-- bl_disp_0312 — the candidate sees the result and the score in the portal, and gets an in-app
-- notification — but ONLY after staff has actually sent the pass / score e-mail (gated on
-- passed_email_at / score_email_at, the same once-only stamps). Nothing leaks before staff decides.
-- Additive: three in-place patches, no schema change. Yaseen 13 Sep 2026.
do $$
declare src text; pos int;
begin
  -- 1. dispatcher_test_my: expose result/score only once told
  src := pg_get_functiondef('public.dispatcher_test_my()'::regprocedure);
  if position('''result'',' in src) = 0 then
    pos := position('''submitted_at'', a.submitted_at,' in src);
    if pos = 0 then raise exception 'anchor 1 missing'; end if;
    src := replace(src, '''submitted_at'', a.submitted_at,',
      '''submitted_at'', a.submitted_at,
    ''result'', case when a.passed_email_at is not null then a.decision::text end,
    ''result_at'', a.passed_email_at,
    ''score'', case when a.score_email_at is not null then a.staff_score end,
    ''max_score'', case when a.score_email_at is not null then a.max_score end,');
    execute src;
  end if;

  -- 2. pass e-mail helper: also drop an in-app notification
  src := pg_get_functiondef('app_private.disp_test_pass_email(uuid)'::regprocedure);
  if position('dispatcher.test_passed_inapp' in src) = 0 then
    pos := position('select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;' in src);
    if pos = 0 then raise exception 'anchor 2 missing'; end if;
    src := replace(src, 'select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;',
      'select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (v_user, ''in_app'', ''dispatcher.test_passed_inapp'',
      jsonb_build_object(''title'', ''You passed the skills test'', ''body'', ''Your written test is approved. Open your dashboard for what happens next.'', ''tone'', ''success'', ''url'', ''/app/agent/''),
      ''sent'', now());
  exception when others then null; end;');
    execute src;
  end if;

  -- 3. score e-mail helper: same, with the number
  src := pg_get_functiondef('app_private.disp_test_score_email(uuid)'::regprocedure);
  if position('dispatcher.test_score_inapp' in src) = 0 then
    pos := position('select u.email into v_mail from auth.users u where u.id = a.user_id;' in src);
    if pos = 0 then raise exception 'anchor 3 missing'; end if;
    src := replace(src, 'select u.email into v_mail from auth.users u where u.id = a.user_id;',
      'select u.email into v_mail from auth.users u where u.id = a.user_id;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (a.user_id, ''in_app'', ''dispatcher.test_score_inapp'',
      jsonb_build_object(''title'', ''Your skills test score: '' || a.staff_score || '' / '' || coalesce(a.max_score, 100), ''body'', ''The full breakdown is in your dashboard.'', ''tone'', ''info'', ''url'', ''/app/agent/''),
      ''sent'', now());
  exception when others then null; end;');
    execute src;
  end if;
end $$;