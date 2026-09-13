-- bl_disp_0311_score_email.sql
-- A SEPARATE score e-mail, sent only when staff deliberately send it.
-- Saving scores stays private; this is its own button and its own RPC.
-- The internal review note is never included.

alter table app_private.skills_test_attempts
  add column if not exists score_email_at timestamptz;

create or replace function app_private.disp_test_score_email(p_attempt uuid)
returns void language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare a app_private.skills_test_attempts; v_mail text; v_name text; v_html text; v_pct int;
begin
  select * into a from app_private.skills_test_attempts where id = p_attempt;
  if a.id is null or a.staff_score is null or coalesce(a.max_score,0) = 0 then return; end if;
  select u.email into v_mail from auth.users u where u.id = a.user_id;
  if v_mail is null then return; end if;
  select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name
    from app_private.dispatcher_profiles where user_id = a.user_id;
  v_pct := round(a.staff_score * 100.0 / a.max_score);

  v_html :=
       '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#0883F7;text-transform:uppercase">Skills test</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">Your result</h2>'
    || '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hi ' || v_name
    || ' — your dispatcher skills test has been marked.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">'
    || '<tr><td align="center" style="padding:20px 16px;background:#f1f5f9;border-radius:10px">'
    || '<div style="font-size:34px;font-weight:800;color:#10223B;line-height:1.1">'
    || trim(to_char(a.staff_score, 'FM999990.99')) || ' <span style="color:#94a3b8;font-size:20px">/ '
    || trim(to_char(a.max_score, 'FM999990.99')) || '</span></div>'
    || '<div style="margin-top:6px;font-size:13px;color:#64748b">' || v_pct || '%</div>'
    || '</td></tr></table>'
    || '<p style="margin:18px 0 0;color:#334155;font-size:14px;line-height:1.7">The test was marked by hand, question by question. If you would like to talk any answer through, just reply to this e-mail.</p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent because you applied to dispatch for LoadBoot. This is a transactional notice about your application, not a marketing e-mail.</p>';

  begin
    perform app_private.sys_email(v_mail, 'dispatcher.test_score',
      'LoadBoot Dispatcher — your skills test result',
      v_html, null, 'dispscore:' || p_attempt::text || ':' || a.staff_score::text);
  exception when others then null; end;
end $fn$;

create or replace function public.cc_dispatcher_test_send_score(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare a app_private.skills_test_attempts;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from app_private.skills_test_attempts where id = p_attempt;
  if a.id is null then return jsonb_build_object('error','no such attempt'); end if;
  if a.staff_score is null then return jsonb_build_object('error','score the test first — nothing to send'); end if;
  perform app_private.disp_test_score_email(p_attempt);
  update app_private.skills_test_attempts set score_email_at = now() where id = p_attempt;
  perform app_private.disp_audit('dispatcher.test.score_email', 'dispatcher', a.user_id::text, null,
    'score e-mailed to candidate: ' || a.staff_score || '/' || a.max_score, jsonb_build_object('attempt', p_attempt));
  return jsonb_build_object('ok', true, 'score', a.staff_score, 'max', a.max_score);
end $fn$;

revoke all on function public.cc_dispatcher_test_send_score(uuid) from public, anon;
grant execute on function public.cc_dispatcher_test_send_score(uuid) to authenticated;
