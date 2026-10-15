-- bl_disp_0553 — the skills test re-invites itself, up to 3 times (15 Oct 2026)
--
-- Yaseen 15 Oct: "haan auto re-invite bana do, 3 dafa tak … us k baad phr dobara CC k paas phr bhe option ho
-- invite karny ka". Until now an invite that lapsed unstarted (48 h) simply sat at 'expired' until someone in
-- CC pressed "Send another". 7 of 9 expired attempts on prod were never started and nobody re-sent them.
--
-- What changes (additive, apply STAGING first, then PROD):
--   1. skills_test_attempts.auto_reinvite smallint (1..3): null = an invite a person sent (CC / decide), n = the
--      n-th automatic re-invite after it.
--   2. app_private.disp_test_reinvite(prev): a fresh attempt (75 min, 48 h to start — same as a CC invite) plus the
--      premium e-mail (email_kit body, catalog key dispatcher.skills_test.reinvite). Round 3 says it is the last
--      automatic one.
--   3. skills_test_sweep (every 10 min) re-invites when the candidate's LATEST attempt lapsed UNSTARTED within the
--      last day, the dispatcher is still 'screening' / 'skills_test', and the chain has < 3 automatic rounds.
--      Each lapse is handled once (integrity.auto_reinvite_checked). Not re-invited, with an audit line, when:
--        * the 3 automatic rounds are used up  -> staff in-app notice "send another from CC if you still want them";
--        * the address is hard-suppressed (bounce/complaint) or opted out of every optional e-mail.
--      Started-but-blank attempts are NOT re-invited: the candidate accepted the test, the clock ran out.
--      The 1-day window means nothing old is re-invited on deploy (the 7 lapsed ones stay as they are).
--   4. A CC "Send another" is a person's invite (auto_reinvite null), so it starts a fresh chain of up to 3.
--   5. The 12-hour reminder goes on person-sent invites only (an auto re-invite IS the nudge), and its copy no
--      longer claims "the only reminder we will send".
--   6. Bug: cc_dispatcher_decide('skills_test') still invited at 45 minutes (v1 budget). It now uses the default (75).
--   7. CC reads: cc_dispatcher_test_review (+history), cc_dispatchers_page, cc_dispatchers_board expose auto_reinvite.
-- Anchors are replaced in the live definitions (never retyped); the file aborts if any anchor is missing.
-- Anon-executable SECURITY DEFINER surface in public: UNCHANGED (no new public function; asserted at the end).
--
-- Rollback: update app_private.email_catalog set status = 'retired' where key = 'dispatcher.skills_test.reinvite';
--           re-apply bl_disp_0308 sweep body (or replace the three anchors back); drop function app_private.disp_test_reinvite(uuid);
--           alter table app_private.skills_test_attempts drop column auto_reinvite;

-- ---------------------------------------------------------------- 1. schema
alter table app_private.skills_test_attempts
  add column if not exists auto_reinvite smallint check (auto_reinvite between 1 and 3);
comment on column app_private.skills_test_attempts.auto_reinvite is
  'bl_disp_0553: null = invite sent by a person (CC / decide); 1..3 = automatic re-invite round after an unstarted lapse.';

-- ---------------------------------------------------------------- 2. catalog row (§6: the email exists in the catalog before it is sent)
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
                                       preference_group, unsub_allowed, status, cc_deep_link)
values ('dispatcher.skills_test.reinvite', 'Skills test re-invite (automatic)',
  'A dispatcher applicant''s skills-test invitation closed (48 h) without the test being started, so LoadBoot opens a fresh one: new attempt, 75 minutes once started, 48 hours to start. Round 3 says it is the last automatic invitation; after that only CC can send another.',
  'O', 'dispatcher', 'cron', 'app_private.skills_test_sweep (cron lb-skills-test-sweep, every 10 min) → app_private.disp_test_reinvite',
  'per lapsed invitation', 'max 3 per person-sent invite (auto_reinvite 1..3); not sent to suppressed or opted-out-of-everything addresses',
  'candidate starts the test, the application leaves screening/skills_test, or 3 automatic rounds are used',
  'account_critical', false, 'live', '#/dispatchers')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = excluded.status, cc_deep_link = excluded.cc_deep_link;

update app_private.email_catalog
   set cap_note = 'one per person-sent invitation, ~12 h before it closes; not sent on automatic re-invites (bl_disp_0553)',
       stop_condition = 'test started or invitation closed'
 where key = 'dispatcher.skills_test.reminder';

-- ---------------------------------------------------------------- 3. the re-invite itself
create or replace function app_private.disp_test_reinvite(p_prev uuid)
returns uuid language plpgsql security definer set search_path = app_private, public as $$
declare prev app_private.skills_test_attempts; v_id uuid; v_no int; v_round int; v_mail text; v_name text; v_qs int;
        v_minutes constant int := 75;   -- same as a CC invite (disp_test_invite default since bl_disp_0319)
        v_hours   constant int := 48;
        v_last boolean; v_html text; v_txt text; v_sub text;
begin
  select * into prev from app_private.skills_test_attempts where id = p_prev;
  if not found then return null; end if;
  v_round := coalesce(prev.auto_reinvite, 0) + 1;
  if v_round > 3 then return null; end if;
  v_last := v_round = 3;

  select coalesce(max(attempt_no),0) + 1 into v_no from app_private.skills_test_attempts where user_id = prev.user_id;
  insert into app_private.skills_test_attempts (user_id, attempt_no, minutes, start_by, auto_reinvite)
  values (prev.user_id, v_no, v_minutes, now() + make_interval(hours => v_hours), v_round)
  returning id into v_id;

  perform app_private.disp_audit('dispatcher.test.auto_reinvite', 'dispatcher', prev.user_id::text, null,
    'skills test re-invited automatically (' || v_round || ' of 3) — attempt ' || prev.attempt_no || ' closed unstarted',
    jsonb_build_object('attempt', v_id, 'previous', prev.id, 'round', v_round));

  select count(*) into v_qs from (select 1 from app_private.skills_test_questions where active
     and bank_version = (select max(bank_version) from app_private.skills_test_questions where active)
     group by coalesce(bank_group, id::text)) g;
  select coalesce(nullif(initcap(split_part(trim(full_name), ' ', 1)), ''), 'there') into v_name
    from app_private.dispatcher_profiles where user_id = prev.user_id;
  select u.email into v_mail from auth.users u where u.id = prev.user_id;
  if v_mail is null then return v_id; end if;

  v_sub := case when v_last then 'LoadBoot Dispatcher — last invitation for your skills test'
                else 'LoadBoot Dispatcher — your skills test is open again' end;
  v_html := app_private.email_kit(jsonb_build_object(
    'eyebrow', jsonb_build_object('text', case when v_last then 'Last invitation' else 'Fresh invitation' end,
                                  'tone', case when v_last then 'warning' else 'info' end),
    'title', 'Your skills test is open again',
    'intro_html', 'Hi ' || app_private.h_esc(v_name) || ' — your last invitation closed before the test was started, so we have opened a new one. '
                  || 'Your application is still with us, and this test is the last step before a paid trial on a live carrier account.',
    'facts', jsonb_build_array(
      jsonb_build_object('k', 'Questions', 'v', v_qs || ' · real dispatch situations'),
      jsonb_build_object('k', 'Time', 'v', v_minutes || ' minutes once you press Start'),
      jsonb_build_object('k', 'Start within', 'v', v_hours || ' hours of this e-mail')),
    'step', jsonb_build_object('label', 'Your next step', 'title', 'Open it when you have a clear ' || v_minutes || ' minutes',
              'text', 'Read the briefing page first. The clock only starts when you press Start, and your answers save as you type.'),
    'cta', jsonb_build_object('label', 'Open my skills test', 'url', 'https://loadboot.com/app/agent/'),
    'note', case when v_last
      then 'This is the last invitation we send automatically. If it closes too, your application stays on file and our team can still send you one by hand — reply to this e-mail if the timing is the problem.'
      else 'If the timing does not work, reply to this e-mail and tell us — we would rather reschedule than lose you to a deadline.' end));
  v_txt := 'Hi ' || v_name || E',\n\nYour last skills-test invitation closed before the test was started, so we have opened a new one. '
        || v_qs || ' questions, ' || v_minutes || ' minutes once you press Start, start within ' || v_hours || E' hours.\n\nOpen it: https://loadboot.com/app/agent/'
        || case when v_last then E'\n\nThis is the last invitation we send automatically.' else '' end;
  begin
    perform app_private.sys_email(v_mail, 'dispatcher.skills_test.reinvite', v_sub, v_html, v_txt, 'dispskillsre:' || v_id::text);
  exception when others then null; end;
  return v_id;
end $$;
revoke all on function app_private.disp_test_reinvite(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. sweep: re-invite after an unstarted lapse; reminder only on person-sent invites
do $$
declare d text; n text; miss constant text := 'bl_disp_0553: anchor not found in skills_test_sweep: ';
  a_decl constant text := 'n_sub int := 0; n_exp int := 0; n_rem int := 0; n_lapsed int := 0;';
  a_lapse constant text := 'get diagnostics n_lapsed = row_count;';
  a_rem constant text := 'where status = ''invited'' and reminded_at is null';
  a_copy constant text := 'this is the only reminder we will send.';
  a_ret constant text := '''reminded'', n_rem);';
begin
  d := pg_get_functiondef('app_private.skills_test_sweep()'::regprocedure);
  if position(a_decl in d) = 0 then raise exception '%decl', miss; end if;
  if position(a_lapse in d) = 0 then raise exception '%lapse', miss; end if;
  if position(a_rem in d) = 0 then raise exception '%reminder', miss; end if;
  if position(a_copy in d) = 0 then raise exception '%copy', miss; end if;
  if position(a_ret in d) = 0 then raise exception '%return', miss; end if;
  n := replace(d, a_decl, a_decl || ' n_re int := 0; n_done int := 0; n_skip int := 0; v_out boolean; v_full text;');
  n := replace(n, a_rem, a_rem || ' and auto_reinvite is null');
  n := replace(n, a_copy, 'this is the only reminder we will send for this invitation.');
  n := replace(n, a_ret, '''reminded'', n_rem, ''reinvited'', n_re, ''reinvite_done'', n_done, ''reinvite_skipped'', n_skip);');
  n := replace(n, a_lapse, a_lapse || $ins$

  -- bl_disp_0553: an invitation that closed UNSTARTED is re-sent automatically, up to 3 rounds per person-sent invite.
  -- Only the candidate's latest attempt, only lapses from the last day (nothing old is resurrected), each lapse once.
  for r in select a.* from app_private.skills_test_attempts a
             join app_private.dispatcher_profiles dp on dp.user_id = a.user_id
            where a.status = 'expired' and a.started_at is null
              and a.start_by <= now() and a.start_by > now() - interval '1 day'
              and dp.status in ('screening','skills_test')
              and not coalesce((a.integrity->>'auto_reinvite_checked')::boolean, false)
              and a.attempt_no = (select max(b.attempt_no) from app_private.skills_test_attempts b where b.user_id = a.user_id)
  loop
    update app_private.skills_test_attempts
       set integrity = coalesce(integrity,'{}'::jsonb) || jsonb_build_object('auto_reinvite_checked', true)
     where id = r.id;
    select coalesce(full_name,'A candidate'), u.email into v_full, v_mail
      from app_private.dispatcher_profiles dp left join auth.users u on u.id = dp.user_id where dp.user_id = r.user_id;

    if coalesce(r.auto_reinvite, 0) >= 3 then
      perform app_private.disp_audit('dispatcher.test.auto_reinvite_done', 'dispatcher', r.user_id::text, null,
        'skills test: 3 automatic re-invites used, none started — only a CC invite from here', jsonb_build_object('attempt', r.id));
      begin
        perform app_private.disp_notify(null, 'staff', 'dispatcher.skills_test.reinvite_done',
          'Skills test: automatic re-invites used up',
          v_full || ' let 4 invitations close without starting the test (the original + 3 automatic). Nothing more goes out on its own — send another from the Test tab if you still want them.',
          '/app/command-center/#/dispatcher?id=' || r.user_id::text || '&tab=test', false);
      exception when others then null; end;
      n_done := n_done + 1;
      continue;
    end if;

    -- a bounced/complained address, or someone who stopped every optional e-mail, is not chased
    v_out := v_mail is null
      or exists (select 1 from app_private.suppressions s where s.channel = 'email' and lower(btrim(s.address)) = lower(btrim(v_mail))
                   and s.reason is distinct from 'unsubscribed')   -- hard suppression only, as in email_gate step 1
      or exists (select 1 from app_private.unsub_prefs p where p.email = lower(btrim(v_mail)) and p.group_code = '*' and p.opted_out)
      or exists (select 1 from app_private.comm_preferences c where c.user_id = r.user_id and coalesce(c.unsubscribed_all, false));
    if v_out then
      perform app_private.disp_audit('dispatcher.test.auto_reinvite_skipped', 'dispatcher', r.user_id::text, null,
        'skills test not re-invited automatically: address is suppressed or opted out of optional e-mail', jsonb_build_object('attempt', r.id));
      n_skip := n_skip + 1;
      continue;
    end if;

    perform app_private.disp_test_reinvite(r.id);
    n_re := n_re + 1;
  end loop;$ins$);
  execute n;
end $$;

-- ---------------------------------------------------------------- 5. bug: decide('skills_test') invited at the v1 budget of 45 minutes
do $$
declare d text; a constant text := 'perform app_private.disp_test_invite(p_user, 45, 48);';
begin
  d := pg_get_functiondef('public.cc_dispatcher_decide(uuid,text,text)'::regprocedure);
  if position(a in d) = 0 then raise exception 'bl_disp_0553: anchor not found in cc_dispatcher_decide'; end if;
  execute replace(d, a, 'perform app_private.disp_test_invite(p_user);   -- bl_disp_0553: defaults (75 min, 48 h), not the v1 45');
end $$;

-- ---------------------------------------------------------------- 6. CC reads expose the automatic round
do $$
declare d text; miss constant text := 'bl_disp_0553: anchor not found in ';
  a1 constant text := '''state'', a.status, ''attempt'', a.id, ''attempt_no'', a.attempt_no, ''minutes'', a.minutes,';
  a2 constant text := 'jsonb_build_object(''no'', h.attempt_no, ''status'', h.status,';
  a3 constant text := '''submitted_at'', t.submitted_at, ''start_by'', t.start_by)';
  a4 constant text := '''attempt_no'',t.attempt_no,';
begin
  d := pg_get_functiondef('public.cc_dispatcher_test_review(uuid)'::regprocedure);
  if position(a1 in d) = 0 then raise exception '%cc_dispatcher_test_review (state)', miss; end if;
  if position(a2 in d) = 0 then raise exception '%cc_dispatcher_test_review (history)', miss; end if;
  d := replace(d, a1, a1 || ' ''auto_reinvite'', a.auto_reinvite,');
  d := replace(d, a2, 'jsonb_build_object(''no'', h.attempt_no, ''auto'', h.auto_reinvite, ''status'', h.status,');
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cc_dispatchers_page';
  if position(a3 in d) = 0 then raise exception '%cc_dispatchers_page', miss; end if;
  execute replace(d, a3, '''submitted_at'', t.submitted_at, ''start_by'', t.start_by, ''auto_reinvite'', t.auto_reinvite)');

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cc_dispatchers_board';
  if position(a4 in d) = 0 then raise exception '%cc_dispatchers_board', miss; end if;
  execute replace(d, a4, a4 || '''auto_reinvite'',t.auto_reinvite,');
end $$;

-- ---------------------------------------------------------------- 7. assertion: no public function became anon-executable here
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname in ('cc_dispatcher_decide','cc_dispatcher_test_review','cc_dispatchers_page','cc_dispatchers_board');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;
end $$;
