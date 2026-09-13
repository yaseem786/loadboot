-- bl_disp_0310_pass_email.sql
-- Pressing "Passed" on the skills-test card e-mails the candidate exactly once.
-- The e-mail says only: you passed, a coordinator will reach you with the truck
-- details, and the 10 working day trial starts once they agree. Fail sends nothing.

alter table app_private.skills_test_attempts
  add column if not exists passed_email_at timestamptz;

create or replace function app_private.disp_test_pass_email(p_attempt uuid)
returns void language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_user uuid; v_mail text; v_name text; v_html text;
begin
  select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;
  if v_user is null then return; end if;
  select u.email into v_mail from auth.users u where u.id = v_user;
  if v_mail is null then return; end if;
  select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name
    from app_private.dispatcher_profiles where user_id = v_user;

  v_html :=
       '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#16a34a;text-transform:uppercase">Result</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">You passed the skills test</h2>'
    || '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hi ' || v_name
    || ' — thank you for taking the time. You passed, and we would like to move ahead with you.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px;color:#334155">'
    || '<tr><td style="padding:14px 16px;background:#f1f5f9;border-radius:10px;line-height:1.9">'
    || '<b style="color:#10223B">What happens next</b><br>'
    || 'One of our coordinators will reach out to you with the carrier and truck details.<br>'
    || 'Once you have looked them over and you are happy to go ahead, your 10 working day paid trial begins.'
    || '</td></tr></table>'
    || '<p style="margin:18px 0 0;color:#334155;font-size:14px;line-height:1.7">There is nothing for you to do right now — just watch for that message.</p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent because you applied to dispatch for LoadBoot. This is a transactional notice about your application, not a marketing e-mail.</p>';

  begin
    perform app_private.sys_email(v_mail, 'dispatcher.test_passed',
      'LoadBoot Dispatcher — you passed the skills test',
      v_html, null, 'disppass:' || p_attempt::text);
  exception when others then null; end;
end $fn$;

-- Patch cc_dispatcher_test_score in place: send once, only on the move to 'pass'.
do $mig$
declare src text; anchor text; ins text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_test_score(uuid,jsonb,text,text)'::regprocedure);
  anchor := '  perform app_private.disp_audit(''dispatcher.test.score''';
  if position(anchor in src) = 0 then
    raise exception 'bl_disp_0310: anchor not found in cc_dispatcher_test_score';
  end if;
  if position('disp_test_pass_email' in src) > 0 then
    raise notice 'bl_disp_0310: already patched, skipping';
    return;
  end if;
  ins :=
    '  if p_decision = ''pass'' then' || E'\n' ||
    '    begin' || E'\n' ||
    '      update app_private.skills_test_attempts set passed_email_at = now()' || E'\n' ||
    '       where id = p_attempt and passed_email_at is null;' || E'\n' ||
    '      if found then perform app_private.disp_test_pass_email(p_attempt); end if;' || E'\n' ||
    '    exception when others then null; end;' || E'\n' ||
    '  end if;' || E'\n\n' || anchor;
  src := replace(src, anchor, ins);
  execute src;
end $mig$;
