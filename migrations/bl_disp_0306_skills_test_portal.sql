-- bl_disp_0306 — the skills test becomes a real, timed, in-portal assessment.
--
-- Yaseen 12 Sep 2026: "portal mn test design karo jesy real company test leti hain … email mn sirf
-- ye email jay jaha CTA portal mn test screen pe le jay." bl_disp_0305 put the questions in the
-- e-mail body, which is a homework sheet, not a test: no clock, no single attempt, no record of what
-- the candidate actually did. This replaces that with an assessment that lives in the dispatcher
-- portal, with the truth (clock, attempt, answers) on the server.
--
-- Decisions (Yaseen, 12 Sep): 45 minutes once started · 48 hours to start from the invite · one
-- attempt, staff can issue another · numeric answers auto-scored, everything else scored by staff,
-- and NO auto-reject — the score informs the decision, it does not make it.
--
-- Integrity: tab-blur count and time away, paste events per question, seconds per question, IP and
-- user-agent. Recorded and shown to staff as counts; nothing blocks and nothing auto-fails. No webcam,
-- no full-screen lock, no devtools detection — disproportionate here, and the live broker call in the
-- final step exposes borrowed answers anyway. (TestGorilla's own guidance: these signals are not
-- proof of cheating and should not decide a hire on their own.)

create table if not exists app_private.skills_test_questions (
  id uuid primary key default gen_random_uuid(),
  seq int not null,
  section text not null,
  kind text not null check (kind in ('number','short','long')),
  prompt text not null,
  hint text,
  max_points int not null default 10,
  expect jsonb not null default '{}'::jsonb,   -- number kind: {"values":[2.28,1.99],"tol":0.03}
  answer_key text,                              -- STAFF ONLY. never leaves the server for a candidate.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists app_private.skills_test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_no int not null default 1,
  status text not null default 'invited' check (status in ('invited','in_progress','submitted','scored','expired')),
  minutes int not null default 45,
  invited_at timestamptz not null default now(),
  start_by timestamptz not null,
  started_at timestamptz,
  ends_at timestamptz,
  submitted_at timestamptz,
  auto_score numeric,
  staff_score numeric,
  max_score numeric,
  decision text check (decision in ('pass','fail')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  integrity jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists skills_test_attempts_user_idx on app_private.skills_test_attempts(user_id, created_at desc);

create table if not exists app_private.skills_test_answers (
  attempt_id uuid not null references app_private.skills_test_attempts(id) on delete cascade,
  question_id uuid not null references app_private.skills_test_questions(id),
  answer text,
  seconds int not null default 0,
  paste_count int not null default 0,
  auto_points numeric,
  staff_points numeric,
  staff_note text,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

-- app_private is not exposed through PostgREST: every path in and out of these tables is one of the
-- security-definer RPCs below, so a candidate can never read answer_key or another attempt.

insert into app_private.skills_test_questions (seq, section, kind, prompt, hint, max_points, expect, answer_key)
select * from (values
 (1, 'Rate and math', 'number',
  'A broker offers $1,850 for 812 loaded miles. The truck deadheads 120 miles to the pickup. What is the rate per mile loaded, and what is it all-in including deadhead? The carrier''s floor is $2.10/mi all-in — do you take the load?',
  'Give both numbers, then your decision.', 12,
  '{"values":[2.28,1.99],"tol":0.03}'::jsonb,
  '1850/812 = $2.28/mi loaded. 1850/932 = $1.99/mi all-in. The floor is all-in, so this is BELOW the floor — counter at about $1,960 (932 x 2.10) or pass. Full marks need both numbers and the understanding that the floor applies to the all-in figure, not the loaded one.'),
 (2, 'Rate and math', 'long',
  'The driver has 4 hours of drive time left on his 11 and 6 hours left on his 14. The pickup is 280 miles away and the appointment is 08:00 tomorrow. What do you tell the broker, and what do you tell the driver?',
  NULL, 12, '{}'::jsonb,
  '280 miles is roughly 5 hours of driving; he has 4. He cannot legally reach it tonight. Driver: run the 4 hours, park, take the 10-hour break, arrive on a fresh clock. Broker: confirm the 08:00 appointment and do not accept an earlier one. A wrong answer moves the truck anyway or asks the driver to "make it work".'),
 (3, 'Paperwork and money', 'short',
  'What is a TONU, when can you claim one, and what has to be in writing before the truck rolls?',
  NULL, 8, '{}'::jsonb,
  'Truck Ordered Not Used. Claimable when the truck was dispatched or arrived and the load was cancelled. The rate confirmation must already carry a TONU clause and amount BEFORE the truck rolls, and the cancellation itself must come in writing with a time on it.'),
 (4, 'Paperwork and money', 'number',
  'A rate confirmation reads: detention after 2 hours, $35/hour, maximum 5 hours, must be noted on the BOL. The driver was on the dock 6 hours 30 minutes. How much do you bill, and what do you need from the driver to get it paid?',
  'Give the dollar figure and the documents.', 10,
  '{"values":[175],"tol":0.5}'::jsonb,
  '$175 — the cap is 5 hours x $35, not 4.5 hours. Needs the signed BOL with in and out times noted, plus the driver''s own check-in/check-out timestamps or photos. Anyone answering $157.50 read the clause but missed the cap.'),
 (5, 'Paperwork and money', 'short',
  'What does a factoring NOA do, and what happens if the broker pays the carrier directly instead of the factoring company?',
  NULL, 10, '{}'::jsonb,
  'The Notice of Assignment redirects payment on that invoice to the factor. If the broker pays the carrier direct, the debt to the factor still stands — the broker can be made to pay twice and the carrier has to forward the funds. It damages the factoring relationship and can breach the factoring agreement.'),
 (6, 'Brokers and risk', 'short',
  'Name three checks you run on a broker before booking with them for the first time, and say what would make you walk away.',
  NULL, 10, '{}'::jsonb,
  'Expect: FMCSA authority active, credit score / days-to-pay (Ansonia, RMIS, broker credit reports), surety bond (BMC-84) and whether there are claims against it, plus carrier reviews. Walk away on: inactive authority, claims on the bond, 60+ day pay, or a rate con with blanks in it.'),
 (7, 'Brokers and risk', 'short',
  'On a rate confirmation, what is the difference between the MC number shown for the broker and the MC you book under, and why does that matter to the carrier?',
  NULL, 10, '{}'::jsonb,
  'The broker''s MC identifies who is paying; the carrier MC on the rate con must be the carrier''s own. If the rate con names a different carrier, the load is being double-brokered — the carrier may never get paid, and the insurance may not answer on a claim.'),
 (8, 'Market', 'long',
  'A 53-foot dry van delivers in Joliet, IL at 11:00 on Friday and the driver wants to be home in Georgia by Monday. Name the outbound markets you would work, in the order you would work them, and say why.',
  NULL, 10, '{}'::jsonb,
  'Chicago/Joliet is a strong outbound market. Sensible order: Atlanta, Nashville or Memphis, Birmingham, Charlotte — all move the truck toward home. Good answers mention checking the rate before committing and avoiding Florida on a home-time run because the backhaul is weak.'),
 (9, 'Written task', 'long',
  'Write out, in full, the e-mail you would send to a broker you have never worked with to get a carrier set up. Include what you attach.',
  'Write the whole e-mail, exactly as you would send it.', 18, '{}'::jsonb,
  'Looking for: a subject line that identifies the carrier, the carrier name with MC and DOT, what equipment and lanes they run, a clear ask (send the setup packet / add us to your carrier list), professional tone, and the attachments named — W-9, certificate of insurance, authority letter (MC-certificate), factoring NOA, and the signed carrier packet. Vague one-liners score low however polite they are.')
) as v(seq, section, kind, prompt, hint, max_points, expect, answer_key)
where not exists (select 1 from app_private.skills_test_questions);

-- ============================================================ helpers

-- lazy expiry: an invite that was never started, or a running clock that ran out.
create or replace function app_private.disp_test_expire(p_attempt uuid)
returns void language plpgsql security definer set search_path = app_private, public as $fn$
begin
  update app_private.skills_test_attempts
     set status = 'expired'
   where id = p_attempt
     and ((status = 'invited'     and now() > start_by)
       or (status = 'in_progress' and now() > ends_at + interval '30 seconds'));
end $fn$;

-- the candidate's current attempt: newest row that is still live, else newest row at all.
create or replace function app_private.disp_test_current(p_user uuid)
returns app_private.skills_test_attempts language sql stable security definer set search_path = app_private, public as $fn$
  select a.* from app_private.skills_test_attempts a
   where a.user_id = p_user
   order by a.created_at desc limit 1;
$fn$;

-- auto-scoring for 'number' questions: pull every number out of the free text the candidate wrote and
-- award pro-rata for each expected value matched within tolerance. Text answers are never guessed at.
create or replace function app_private.disp_test_auto_points(p_answer text, p_expect jsonb, p_max int)
returns numeric language plpgsql immutable as $fn$
declare want numeric[]; tol numeric; got numeric[]; hits int := 0; v numeric; g numeric; ok boolean;
begin
  if p_expect is null or p_expect->'values' is null then return null; end if;
  select array_agg((x)::numeric) into want from jsonb_array_elements_text(p_expect->'values') x;
  tol := coalesce((p_expect->>'tol')::numeric, 0.02);
  if coalesce(p_answer,'') = '' then return 0; end if;
  select array_agg(replace(m[1], ',', '')::numeric) into got
    from regexp_matches(p_answer, '([0-9][0-9,]*\.?[0-9]*)', 'g') m;
  if got is null then return 0; end if;
  foreach v in array want loop
    ok := false;
    foreach g in array got loop if abs(g - v) <= tol then ok := true; end if; end loop;
    if ok then hits := hits + 1; end if;
  end loop;
  return round(p_max::numeric * hits / greatest(array_length(want,1),1), 1);
end $fn$;

-- create an attempt and send the short invite e-mail (the e-mail carries no questions, only a button).
create or replace function app_private.disp_test_invite(p_user uuid, p_minutes int default 45, p_start_hours int default 48)
returns uuid language plpgsql security definer set search_path = app_private, public as $fn$
declare v_id uuid; v_no int; v_mail text; v_name text; v_qs int; v_pts int; v_html text; v_start timestamptz;
begin
  select coalesce(max(attempt_no),0) + 1 into v_no from app_private.skills_test_attempts where user_id = p_user;
  v_start := now() + make_interval(hours => greatest(p_start_hours,1));
  insert into app_private.skills_test_attempts (user_id, attempt_no, minutes, start_by)
  values (p_user, v_no, greatest(p_minutes,5), v_start)
  returning id into v_id;

  select count(*), coalesce(sum(max_points),0) into v_qs, v_pts from app_private.skills_test_questions where active;
  select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name
    from app_private.dispatcher_profiles where user_id = p_user;
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return v_id; end if;

  v_html :=
       '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#0883F7;text-transform:uppercase">Next step</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">Your dispatcher skills test is ready</h2>'
    || '<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6">Hi ' || v_name || ' — your application passed screening. The test is in your LoadBoot portal. It is the last step before a paid trial on a live carrier account.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px;color:#334155">'
    || '<tr><td style="padding:14px 16px;background:#f1f5f9;border-radius:10px;line-height:1.9">'
    || '<b style="color:#10223B">' || v_qs || ' questions</b> · real dispatch situations, not trivia<br>'
    || '<b style="color:#10223B">' || greatest(p_minutes,5) || ' minutes</b> once you press Start — the clock runs on our side, so closing the tab does not pause it<br>'
    || '<b style="color:#10223B">Start within ' || greatest(p_start_hours,1) || ' hours</b> · one attempt · your answers save as you type'
    || '</td></tr></table>'
    || '<p style="margin:22px 0 8px"><a href="https://loadboot.com/app/agent/" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800;display:inline-block">Open my skills test</a></p>'
    || '<p style="margin:0 0 16px;color:#64748b;font-size:13px">Sign in and the test is the first thing on your dashboard. Read the briefing page first — the clock only starts when you press Start.</p>'
    || '<p style="margin:0;color:#334155;font-size:14px;line-height:1.7">After the written test there is one 15-minute call where you negotiate a real load with me. Answer in your own words — that call makes borrowed answers obvious, and an honest "I don''t know" costs you far less than a polished answer you cannot defend.</p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent because you applied to dispatch for LoadBoot. This is a transactional notice about your application, not a marketing e-mail.</p>';

  begin
    perform app_private.sys_email(v_mail, 'dispatcher.skills_test',
      'LoadBoot Dispatcher — your skills test is ready (' || greatest(p_minutes,5) || ' minutes)',
      v_html, null, 'dispskills:' || v_id::text);
  exception when others then null; end;
  return v_id;
end $fn$;

-- ============================================================ candidate RPCs

create or replace function public.dispatcher_test_my()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $fn$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts; v_live boolean;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('state','none'); end if;
  if (a.status = 'invited' and now() > a.start_by) or (a.status = 'in_progress' and now() > a.ends_at + interval '30 seconds') then
    a.status := 'expired';
  end if;
  v_live := a.status = 'in_progress';
  return jsonb_build_object(
    'state', a.status,
    'attempt', a.id,
    'attempt_no', a.attempt_no,
    'minutes', a.minutes,
    'start_by', a.start_by,
    'started_at', a.started_at,
    'ends_at', a.ends_at,
    'submitted_at', a.submitted_at,
    'remaining', case when v_live then greatest(0, floor(extract(epoch from (a.ends_at - now())))::int) else null end,
    'question_count', (select count(*) from app_private.skills_test_questions where active),
    'sections', (select coalesce(jsonb_agg(s order by s), '[]'::jsonb) from (select distinct section s from app_private.skills_test_questions where active) x),
    'questions', case when v_live then (
       select coalesce(jsonb_agg(jsonb_build_object(
         'id', q.id, 'seq', q.seq, 'section', q.section, 'kind', q.kind,
         'prompt', q.prompt, 'hint', q.hint, 'max_points', q.max_points,
         'answer', (select ans.answer from app_private.skills_test_answers ans where ans.attempt_id = a.id and ans.question_id = q.id)
       ) order by q.seq), '[]'::jsonb) from app_private.skills_test_questions q where q.active)
       else '[]'::jsonb end);
end $fn$;

create or replace function public.dispatcher_test_start()
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('error','no test has been assigned to you'); end if;
  perform app_private.disp_test_expire(a.id);
  select * into a from app_private.skills_test_attempts where id = a.id;
  if a.status = 'in_progress' then return public.dispatcher_test_my(); end if;
  if a.status <> 'invited' then return jsonb_build_object('error','this test is ' || a.status); end if;
  update app_private.skills_test_attempts
     set status = 'in_progress', started_at = now(), ends_at = now() + make_interval(mins => a.minutes)
   where id = a.id;
  return public.dispatcher_test_my();
end $fn$;

create or replace function public.dispatcher_test_save(p_question uuid, p_answer text, p_seconds int default 0, p_paste int default 0)
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('error','no test'); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('error','this test is ' || a.status, 'state', a.status); end if;
  if now() > a.ends_at + interval '30 seconds' then
    perform app_private.disp_test_expire(a.id);
    return jsonb_build_object('error','time is up', 'state','expired');
  end if;
  if not exists (select 1 from app_private.skills_test_questions where id = p_question and active) then
    return jsonb_build_object('error','unknown question');
  end if;
  insert into app_private.skills_test_answers (attempt_id, question_id, answer, seconds, paste_count, updated_at)
  values (a.id, p_question, p_answer, greatest(coalesce(p_seconds,0),0), greatest(coalesce(p_paste,0),0), now())
  on conflict (attempt_id, question_id) do update
    set answer = excluded.answer,
        seconds = greatest(app_private.skills_test_answers.seconds, excluded.seconds),
        paste_count = greatest(app_private.skills_test_answers.paste_count, excluded.paste_count),
        updated_at = now();
  return jsonb_build_object('ok', true, 'remaining', greatest(0, floor(extract(epoch from (a.ends_at - now())))::int));
end $fn$;

create or replace function public.dispatcher_test_submit(p_integrity jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare v_uid uuid := auth.uid(); a app_private.skills_test_attempts; v_auto numeric; v_max numeric; v_name text; v_answered int;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  a := app_private.disp_test_current(v_uid);
  if a.id is null then return jsonb_build_object('error','no test'); end if;
  if a.status = 'submitted' or a.status = 'scored' then return jsonb_build_object('ok', true, 'state', a.status); end if;
  if a.status <> 'in_progress' then return jsonb_build_object('error','this test is ' || a.status, 'state', a.status); end if;

  update app_private.skills_test_answers ans
     set auto_points = app_private.disp_test_auto_points(ans.answer, q.expect, q.max_points)
    from app_private.skills_test_questions q
   where ans.question_id = q.id and ans.attempt_id = a.id and q.kind = 'number';

  select coalesce(sum(ans.auto_points),0) into v_auto from app_private.skills_test_answers ans where ans.attempt_id = a.id;
  select coalesce(sum(max_points),0) into v_max from app_private.skills_test_questions where active;
  select count(*) into v_answered from app_private.skills_test_answers where attempt_id = a.id and coalesce(trim(answer),'') <> '';

  update app_private.skills_test_attempts
     set status = 'submitted', submitted_at = now(), auto_score = v_auto, max_score = v_max,
         integrity = coalesce(p_integrity,'{}'::jsonb) || jsonb_build_object('answered', v_answered,
                       'used_minutes', round(extract(epoch from (now() - started_at))/60.0, 1))
   where id = a.id;

  select coalesce(full_name,'A candidate') into v_name from app_private.dispatcher_profiles where user_id = v_uid;
  begin
    perform app_private.disp_notify(null, 'staff', 'dispatcher.skills_test.submitted',
      '📝 Skills test submitted',
      v_name || ' finished the dispatcher skills test (' || v_answered || ' of ' ||
      (select count(*) from app_private.skills_test_questions where active) || ' answered). Open Dispatchers to score it.',
      '/app/command-center/#/dispatchers?user=' || v_uid::text, true);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'state','submitted');
end $fn$;

grant execute on function public.dispatcher_test_my() to authenticated;
grant execute on function public.dispatcher_test_start() to authenticated;
grant execute on function public.dispatcher_test_save(uuid, text, int, int) to authenticated;
grant execute on function public.dispatcher_test_submit(jsonb) to authenticated;

-- ============================================================ staff RPCs

create or replace function public.cc_dispatcher_test_invite(p_user uuid, p_minutes int default 45, p_start_hours int default 48)
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare v_id uuid; v_open int;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if not exists (select 1 from app_private.dispatcher_profiles where user_id = p_user) then
    return jsonb_build_object('error','not a dispatcher');
  end if;
  select count(*) into v_open from app_private.skills_test_attempts
   where user_id = p_user and status in ('invited','in_progress');
  if v_open > 0 then return jsonb_build_object('error','this candidate already has a live test — expire or wait for it first'); end if;
  v_id := app_private.disp_test_invite(p_user, p_minutes, p_start_hours);
  update app_private.dispatcher_profiles set status = 'skills_test', updated_at = now()
   where user_id = p_user and status in ('applied','screening','skills_test');
  perform app_private.disp_audit('dispatcher.test.invite', 'dispatcher', p_user::text, null,
    'skills test invited (' || p_minutes || ' min, start within ' || p_start_hours || 'h)', jsonb_build_object('attempt', v_id));
  return jsonb_build_object('ok', true, 'attempt', v_id);
end $fn$;

create or replace function public.cc_dispatcher_test_review(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $fn$
declare a app_private.skills_test_attempts;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  a := app_private.disp_test_current(p_user);
  if a.id is null then return jsonb_build_object('state','none'); end if;
  return jsonb_build_object(
    'state', a.status, 'attempt', a.id, 'attempt_no', a.attempt_no, 'minutes', a.minutes,
    'invited_at', a.invited_at, 'start_by', a.start_by, 'started_at', a.started_at,
    'ends_at', a.ends_at, 'submitted_at', a.submitted_at,
    'auto_score', a.auto_score, 'staff_score', a.staff_score, 'max_score', a.max_score,
    'decision', a.decision, 'review_note', a.review_note, 'reviewed_at', a.reviewed_at,
    'integrity', a.integrity,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('no', h.attempt_no, 'status', h.status, 'submitted_at', h.submitted_at,
                        'score', coalesce(h.staff_score, h.auto_score), 'decision', h.decision) order by h.attempt_no desc), '[]'::jsonb)
                  from app_private.skills_test_attempts h where h.user_id = p_user),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'seq', q.seq, 'section', q.section, 'kind', q.kind, 'prompt', q.prompt,
        'max_points', q.max_points, 'answer_key', q.answer_key,
        'answer', ans.answer, 'seconds', coalesce(ans.seconds,0), 'paste_count', coalesce(ans.paste_count,0),
        'auto_points', ans.auto_points, 'staff_points', ans.staff_points, 'staff_note', ans.staff_note
      ) order by q.seq), '[]'::jsonb)
      from app_private.skills_test_questions q
      left join app_private.skills_test_answers ans on ans.question_id = q.id and ans.attempt_id = a.id
      where q.active));
end $fn$;

-- p_scores: {"<question uuid>": {"points": 8, "note": "..."}, ...}
create or replace function public.cc_dispatcher_test_score(p_attempt uuid, p_scores jsonb, p_decision text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $fn$
declare k text; v jsonb; v_total numeric; v_max numeric; v_user uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select user_id into v_user from app_private.skills_test_attempts where id = p_attempt;
  if v_user is null then return jsonb_build_object('error','no such attempt'); end if;
  if p_decision is not null and p_decision not in ('pass','fail') then return jsonb_build_object('error','decision must be pass or fail'); end if;

  for k, v in select * from jsonb_each(coalesce(p_scores,'{}'::jsonb)) loop
    insert into app_private.skills_test_answers (attempt_id, question_id, staff_points, staff_note, updated_at)
    values (p_attempt, k::uuid, nullif(v->>'points','')::numeric, nullif(v->>'note',''), now())
    on conflict (attempt_id, question_id) do update
      set staff_points = nullif(v->>'points','')::numeric,
          staff_note = coalesce(nullif(v->>'note',''), app_private.skills_test_answers.staff_note),
          updated_at = now();
  end loop;

  select coalesce(sum(coalesce(ans.staff_points, ans.auto_points, 0)), 0) into v_total
    from app_private.skills_test_answers ans where ans.attempt_id = p_attempt;
  select coalesce(sum(max_points),0) into v_max from app_private.skills_test_questions where active;

  update app_private.skills_test_attempts
     set staff_score = v_total, max_score = v_max,
         decision = coalesce(p_decision, decision),
         review_note = coalesce(p_note, review_note),
         reviewed_by = auth.uid(), reviewed_at = now(),
         status = case when p_decision is not null then 'scored' else status end
   where id = p_attempt;

  perform app_private.disp_audit('dispatcher.test.score', 'dispatcher', v_user::text, null,
    'skills test scored ' || v_total || '/' || v_max || coalesce(' — ' || p_decision, ''), jsonb_build_object('attempt', p_attempt));
  return jsonb_build_object('ok', true, 'score', v_total, 'max', v_max);
end $fn$;

grant execute on function public.cc_dispatcher_test_invite(uuid, int, int) to authenticated;
grant execute on function public.cc_dispatcher_test_review(uuid) to authenticated;
grant execute on function public.cc_dispatcher_test_score(uuid, jsonb, text, text) to authenticated;

-- ============================================================ decide('skills_test') now invites

-- bl_disp_0305 sent the questions in the e-mail body; from here the same button creates a timed
-- attempt and sends the short CTA invite instead. Everything else in decide is unchanged.
do $patch$
declare src text; v_old text; v_new text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_decide(uuid,text,text)'::regprocedure);
  v_old := 'perform app_private.sys_email(v_mail, ''dispatcher.skills_test'',
          ''LoadBoot Dispatcher — skills test (please reply within '' || v_hours || '' hours)'',
          app_private.disp_skills_test_html(p_user), null,
          ''dispskills:'' || p_user::text || '':'' || to_char(now(),''YYYYMMDDHH24MI''));';
  if position(v_old in src) = 0 then raise exception 'cc_dispatcher_decide: 0305 skills-test e-mail block not found'; end if;
  v_new := 'if not exists (select 1 from app_private.skills_test_attempts t where t.user_id = p_user and t.status in (''invited'',''in_progress'')) then
          perform app_private.disp_test_invite(p_user, 45, 48);
        end if;';
  src := replace(src, v_old, v_new);
  execute src;
end $patch$;
