-- bl_disp_0305 — the skills test becomes a real thing.
--
-- Yaseen 12 Sep 2026: pressing "Send skills test" in CC did nothing the candidate could see. It set
-- status = 'skills_test' and wrote an in-app notification whose body was literally "Status:
-- skills_test." — and no e-mail at all, because cc_dispatcher_decide's e-mail flag is
-- `v_new in ('trial','verified','active','rejected','suspended')`, which omits skills_test. There was
-- also no test anywhere in the product: no questions, no link, no attachment. Candidates were left in
-- skills_test forever with nothing to answer.
--
-- This migration: (1) stores the test itself in app_private.system_settings so it is editable in
-- CC → Settings without a deploy; (2) renders it as a branded e-mail; (3) makes decide('skills_test')
-- actually send it. Additive; staging first, then prod.

insert into app_private.system_setting_defs (key, value_type, description, validation, sensitivity, required_permission, default_value, environment)
values
  ('dispatch.skills_test_hours', 'number', 'Hours a dispatcher candidate gets to return the skills test. Shown in the e-mail subject and body.', '{"min":6,"max":168}'::jsonb, 'public', 'settings.manage', '48'::jsonb, 'all'),
  ('dispatch.skills_test_body', 'string', 'The dispatcher skills test, as plain text. Blank lines start a new paragraph. Edit here — no deploy needed.', '{"maxLength":12000}'::jsonb, 'public', 'settings.manage', '""'::jsonb, 'all')
on conflict (key) do nothing;

insert into app_private.system_settings (key, value) values ('dispatch.skills_test_hours', '48'::jsonb) on conflict (key) do nothing;

insert into app_private.system_settings (key, value)
values ('dispatch.skills_test_body', to_jsonb($TEST$SECTION 1 — RATE AND MATH

1. A broker offers $1,850 for 812 loaded miles. The truck deadheads 120 miles to the pickup. What is the rate per mile you report to the carrier, and what is it including deadhead? If the carrier's floor is $2.10/mi all-in, do you take the load?

2. The driver has 4 hours of drive time left on his 11 and 6 hours left on his 14. The pickup is 280 miles away and the appointment is 08:00 tomorrow. What do you tell the broker, and what do you tell the driver?

SECTION 2 — PAPERWORK AND MONEY

3. What is a TONU, when can you claim one, and what do you need in writing before the truck leaves?

4. A rate confirmation reads: detention after 2 hours, $35/hour, maximum 5 hours, must be noted on the BOL. The driver was on the dock 6 hours 30 minutes. How much do you bill, and what do you need from the driver to get it paid?

5. What does a factoring NOA do, and what happens if the broker pays the carrier directly instead of the factoring company?

SECTION 3 — BROKERS AND RISK

6. Name three checks you run on a broker before booking with them for the first time, and say what would make you walk away.

7. On a rate confirmation, what is the difference between the MC number shown for the broker and the MC you book under, and why does that matter to the carrier?

SECTION 4 — MARKET

8. A 53-foot dry van delivers in Joliet, IL at 11:00 on Friday and the driver wants to be home in Georgia by Monday. Name the outbound markets you would work, in the order you would work them, and say why.

SECTION 5 — WRITTEN TASK

9. Write out, in full, the e-mail you would send to a broker you have never worked with to get a carrier set up. Include what you attach.

SECTION 6 — CALL

10. A 15-minute call. I play the broker and you negotiate one load for a real truck. We book the time once your written answers are in.

HOW TO ANSWER

Reply straight to this e-mail. Plain text is fine — we are reading the thinking, not the formatting.

Answer from your own experience. If you do not know something, write "I don't know". An honest gap scores better here than a polished answer you did not write yourself, and the call in Section 6 makes the difference obvious either way.$TEST$::text))
on conflict (key) do nothing;

create or replace function app_private.disp_skills_test_html(p_user uuid)
returns text language plpgsql stable security definer set search_path = app_private, public as $fn$
declare v_name text; v_body text; v_hours int; v_html text;
begin
  -- first name only, capitalised: applicants type their own name and half of them lower-case the surname.
  select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_hours := coalesce((select (value #>> '{}')::int from app_private.system_settings where key = 'dispatch.skills_test_hours'), 48);
  v_body  := coalesce(nullif((select value #>> '{}' from app_private.system_settings where key = 'dispatch.skills_test_body'), ''),
                      'Your skills test is being prepared — we will send it shortly.');

  v_html := '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#0883F7;text-transform:uppercase">Next step</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">Your dispatcher skills test</h2>'
    || '<p style="margin:0 0 14px;color:#475569;font-size:15px;line-height:1.6">Hi ' || v_name || ' — your application passed screening. This is the skills test, and it is the last step before a paid trial on a live carrier account.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;font-size:14px;color:#9a3412;line-height:1.6">'
    || '<b>Reply within ' || v_hours || ' hours.</b> Answers come back as a reply to this e-mail. There is no form to fill in and nothing to download.</td></tr></table>'
    || '<div style="margin:16px 0 0;padding:18px 20px;background:#f1f5f9;border-radius:12px;color:#334155;font-size:14px;line-height:1.8">'
    -- section headings read as headings: any line that is "SECTION n — ..." or "HOW TO ANSWER"
    || replace(replace(regexp_replace(v_body, '^(SECTION [0-9]+ [^' || E'\n' || ']*|HOW TO ANSWER)$', '<b style="color:#10223B;letter-spacing:.04em">\1</b>', 'gn'), E'\n\n', '<div style="height:14px"></div>'), E'\n', '<br>')
    || '</div>'
    || '<p style="margin:20px 0 0;color:#334155;font-size:14px;line-height:1.7">Questions about the test itself: reply here. <b>LoadBoot Dispatch</b></p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent because you applied to dispatch for LoadBoot. This is a transactional notice about your application, not a marketing e-mail.</p>';
  return v_html;
end $fn$;

-- decide('skills_test') now actually sends the test. Everything else in the function is unchanged.
create or replace function public.cc_dispatcher_decide(p_user uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare v_new text; v_old text; v_pct numeric; v_ts date; v_te date; v_warn text; v_name text; v_mail text; v_hours int;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select status, commission_pct, trial_start, trial_end, full_name into v_old, v_pct, v_ts, v_te, v_name from app_private.dispatcher_profiles where user_id = p_user;
  if v_old is null then return jsonb_build_object('error','not a dispatcher'); end if;
  v_new := case p_action
    when 'screening' then 'screening' when 'skills_test' then 'skills_test' when 'trial' then 'trial'
    when 'verify' then 'verified' when 'activate' then 'active' when 'reject' then 'rejected' when 'suspend' then 'suspended'
    when 'reinstate' then case when v_te is not null and v_te >= current_date then 'trial' else 'verified' end
    else null end;
  if v_new is null then return jsonb_build_object('error','bad action'); end if;
  update app_private.dispatcher_profiles
     set status = v_new, review_note = coalesce(p_note, review_note), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(),
         trial_start = case when v_new = 'trial' and trial_start is null then current_date else trial_start end,
         trial_end   = case when v_new = 'trial' and trial_end is null then app_private.add_working_days(current_date, 10) else trial_end end
   where user_id = p_user;
  if v_new = 'trial' and coalesce(v_pct, 0) = 0 then v_warn := 'commission_pct is 0 — set the trial terms now or every delivered load pays the dispatcher nothing'; end if;
  -- revocation: suspended / rejected dispatchers lose every active assignment (feed, docs, thread, bookings)
  if v_new in ('suspended','rejected') then
    update app_private.dispatcher_assignments set status = case when v_new = 'suspended' then 'paused' else 'ended' end,
           ended_at = case when v_new = 'rejected' then now() else ended_at end, end_reason = coalesce(p_note, 'dispatcher ' || v_new), updated_at = now()
     where dispatcher_user_id = p_user and status = 'active';
    insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body)
      select a.id, a.carrier_org_id, 'system', 'LoadBoot has ' || (case when v_new = 'suspended' then 'paused' else 'ended' end) || ' this dispatcher assignment. LoadBoot dispatch covers your truck until a replacement is assigned.'
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status in ('paused','ended') and a.updated_at > now() - interval '5 seconds';
  elsif v_new = 'trial' and v_old = 'suspended' then
    update app_private.dispatcher_assignments set status = 'active', updated_at = now() where dispatcher_user_id = p_user and status = 'paused';
  end if;
  perform app_private.disp_notify(p_user, 'dispatcher', 'dispatcher.status.' || v_new,
    case v_new when 'trial' then 'Your trial starts — open your workspace' when 'verified' then 'You are verified' when 'active' then 'You are active' when 'rejected' then 'Application closed' when 'suspended' then 'Access paused' when 'skills_test' then 'Next step: skills test — check your e-mail' else 'Application update' end,
    coalesce(p_note, 'Status: ' || v_new || '.'), '/app/agent/#dashboard', v_new in ('trial','verified','active','rejected','suspended'));

  -- bl_disp_0305: the skills test is an e-mail with the actual questions in it, not a status flip.
  if v_new = 'skills_test' then
    begin
      select u.email into v_mail from auth.users u where u.id = p_user;
      v_hours := coalesce((select (value #>> '{}')::int from app_private.system_settings where key = 'dispatch.skills_test_hours'), 48);
      if v_mail is not null then
        perform app_private.sys_email(v_mail, 'dispatcher.skills_test',
          'LoadBoot Dispatcher — skills test (please reply within ' || v_hours || ' hours)',
          app_private.disp_skills_test_html(p_user), null,
          'dispskills:' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI'));
      end if;
    exception when others then null; end;
  end if;

  perform app_private.disp_audit('dispatcher.decide.' || p_action, 'dispatcher', p_user::text, null, coalesce(v_name,'dispatcher') || ': ' || v_old || ' → ' || v_new, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'status', v_new, 'warning', v_warn);
end $fn$;

grant execute on function public.cc_dispatcher_decide(uuid, text, text) to authenticated;
