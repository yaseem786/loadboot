-- bl_disp_0314 — Yaseen 13 Sep 2026: "jab score save kare usay score ki e-mail jaye, jab Pass dabaye pass wali".
-- Save scores now e-mails the number automatically — but only once EVERY active question carries a
-- staff mark (a half-marked save sends nothing), and only once (score_email_at stamp, same as before).
-- ✓ Passed still sends the pass e-mail; E-mail score stays as a manual re-send. In-place patch.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_test_score(uuid,jsonb,text,text)'::regprocedure);
  if position('bl_disp_0314' in src) > 0 then return; end if;
  if position('      if found then perform app_private.disp_test_pass_email(p_attempt); end if;
    exception when others then null; end;
  end if;
' in src) = 0 then raise exception 'anchor missing'; end if;
  src := replace(src, '      if found then perform app_private.disp_test_pass_email(p_attempt); end if;
    exception when others then null; end;
  end if;
', '      if found then perform app_private.disp_test_pass_email(p_attempt); end if;
    exception when others then null; end;
  end if;

  -- bl_disp_0314: the score goes out on save, once, and only when every active question is marked
  if not exists (select 1 from app_private.skills_test_questions q where q.active
                   and not exists (select 1 from app_private.skills_test_answers ans
                                    where ans.attempt_id = p_attempt and ans.question_id = q.id and ans.staff_points is not null)) then
    begin
      update app_private.skills_test_attempts set score_email_at = now()
       where id = p_attempt and score_email_at is null;
      if found then perform app_private.disp_test_score_email(p_attempt); end if;
    exception when others then null; end;
  end if;
');
  execute src;
end $$;
