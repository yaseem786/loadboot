-- bl_disp_0602 — skills test: 5-day window, expired candidates return to Screening, duplicate applications held (11 Nov 2026)
--
-- Yaseen 11 Nov ("Skill Test System – Required Changes"):
--   2. "Skill Test bhejne ke baad candidate ko 5 din ka time milna chahiye" — the invitation window was 48 h.
--   3. "expired test walay candidates ... screening process mein nahi aati ... dobara invite nahi bheja ja sakta" —
--      a candidate whose test expired stayed at status 'skills_test' with an 'expired' attempt. The CC board has no
--      column for that pair and the roster's "Send test" button only shows on 'screening', so they vanished.
--   4. A candidate rejected after the trial re-applies from a second Gmail and lands in Screening as a fresh
--      application. Identity must not hang on the e-mail alone; a second chance is management's decision.
--
-- What changes (additive; apply STAGING first, then PROD):
--   A. Window 48 h -> 120 h (5 days): disp_test_invite + cc_dispatcher_test_invite defaults, disp_test_reinvite,
--      e-mail copy ("5 days", via app_private.disp_window_label), system_settings, catalog wording. The 75-minute
--      clock once Start is pressed is unchanged. Invitations that are live right now are extended to 5 days from
--      their invite time.
--   B. skills_test_sweep: when a test lapses for good (started and nothing answered / 3 automatic re-invites used /
--      address cannot be e-mailed), the application goes back to 'screening' (app_private.disp_test_back_to_screening,
--      audit dispatcher.test.expired_to_screening). While automatic re-invites are still running it stays 'skills_test'.
--      lb_dispatcher_applied_email no longer fires on skills_test -> screening (it would have re-sent "Application
--      received"). Backfill: every 'skills_test' application whose latest attempt is 'expired' moves to 'screening'.
--   C. Duplicates: app_private.dispatcher_dup_holds + disp_phone_key / disp_email_key / disp_identity_matches.
--      dispatcher_apply(submit): if the phone (last 10 digits) or the canonical e-mail (Gmail dots / +tags folded)
--      matches another application that was ever submitted, the new one is saved but NOT moved to screening; staff
--      get an in-app notice; the applicant sees a plain message. cc_dispatcher_decide / cc_dispatcher_test_invite
--      refuse to advance a held application.
--      public.cc_dispatcher_identity(user)            — staff: the hold + every matching record with its history.
--      public.cc_dispatcher_duplicate_resolve(user, 'allow' | 'reactivate_original', note) — management's decision.
--      cc_dispatchers_board / cc_dispatchers_page expose dup_held.
-- No new e-mail (staff notice is in-app only), so no catalog row. Anchors are replaced in the live definitions
-- (never retyped); the file aborts if any anchor is missing.
-- Anon-executable SECURITY DEFINER surface in public: UNCHANGED (the two new public functions are revoked from
-- public + anon; asserted at the end).
--
-- Rollback: defaults/copy — replace the anchors back (120 -> 48); drop function public.cc_dispatcher_duplicate_resolve(uuid,text,text),
--   public.cc_dispatcher_identity(uuid), app_private.disp_identity_matches(uuid,text), app_private.disp_test_back_to_screening(uuid,text);
--   drop table app_private.dispatcher_dup_holds; re-apply dispatcher_apply / cc_dispatcher_decide / skills_test_sweep from bl_disp_0553.

-- ================================================================ A. 5-day window
create or replace function app_private.disp_window_label(p_hours int)
returns text language sql immutable set search_path = app_private, public as $$
  select case when p_hours >= 48 and p_hours % 24 = 0 then (p_hours / 24) || ' days' else p_hours || ' hours' end
$$;
revoke all on function app_private.disp_window_label(int) from public, anon, authenticated;

do $$
declare d text; miss constant text := 'bl_disp_0602: anchor not found: ';
  a_def  constant text := 'p_start_hours integer DEFAULT 48';
  a_copy constant text := 'Start within '' || greatest(p_start_hours,1) || '' hours</b>';
  a_rh   constant text := 'v_hours   constant int := 48;';
  a_rf   constant text := '''v'', v_hours || '' hours of this e-mail''';
  a_rt   constant text := 'start within '' || v_hours || E'' hours.';
begin
  -- the invitation itself
  d := pg_get_functiondef('app_private.disp_test_invite(uuid,integer,integer)'::regprocedure);
  if position(a_def in d) = 0 then raise exception '%disp_test_invite default', miss; end if;
  if position(a_copy in d) = 0 then raise exception '%disp_test_invite copy', miss; end if;
  d := replace(d, a_def, 'p_start_hours integer DEFAULT 120');
  d := replace(d, a_copy, ''' || app_private.disp_window_label(greatest(p_start_hours,1)) || '' to take it</b> — any day inside that window, no need to wait');
  execute d;

  d := pg_get_functiondef('public.cc_dispatcher_test_invite(uuid,integer,integer)'::regprocedure);
  if position(a_def in d) = 0 then raise exception '%cc_dispatcher_test_invite default', miss; end if;
  execute replace(d, a_def, 'p_start_hours integer DEFAULT 120');

  -- the automatic re-invite
  d := pg_get_functiondef('app_private.disp_test_reinvite(uuid)'::regprocedure);
  if position(a_rh in d) = 0 then raise exception '%disp_test_reinvite hours', miss; end if;
  if position(a_rf in d) = 0 then raise exception '%disp_test_reinvite fact', miss; end if;
  if position(a_rt in d) = 0 then raise exception '%disp_test_reinvite text', miss; end if;
  d := replace(d, a_rh, 'v_hours   constant int := 120;   -- bl_disp_0602: 5 days');
  d := replace(d, a_rf, '''v'', app_private.disp_window_label(v_hours) || '' of this e-mail''');
  d := replace(d, a_rt, 'start within '' || app_private.disp_window_label(v_hours) || E''.');
  execute d;
end $$;

update app_private.system_settings set value = to_jsonb(120) where key = 'dispatch.skills_test_hours';

update app_private.email_catalog
   set purpose = replace(replace(purpose, '48 hours to start', '5 days to start'), '(48 h)', '(5 days)')
 where key = 'dispatcher.skills_test.reinvite';

-- invitations that are open right now get the same 5 days, counted from when they were sent
update app_private.skills_test_attempts
   set start_by = coalesce(invited_at, created_at) + interval '5 days'
 where status = 'invited' and start_by > now()
   and start_by < coalesce(invited_at, created_at) + interval '5 days';

-- ================================================================ B. a test that lapsed for good goes back to Screening
create or replace function app_private.disp_test_back_to_screening(p_user uuid, p_why text)
returns boolean language plpgsql security definer set search_path = app_private, public as $$
begin
  update app_private.dispatcher_profiles set status = 'screening', updated_at = now()
   where user_id = p_user and status = 'skills_test';
  if not found then return false; end if;
  perform app_private.disp_audit('dispatcher.test.expired_to_screening', 'dispatcher', p_user::text, null,
    'skills test expired (' || coalesce(p_why, 'lapsed') || ') — application back in Screening so the test can be sent again',
    jsonb_build_object('why', p_why));
  return true;
end $$;
revoke all on function app_private.disp_test_back_to_screening(uuid, text) from public, anon, authenticated;

do $$
declare d text; miss constant text := 'bl_disp_0602: anchor not found: ';
  a_trg   constant text := 'if tg_op = ''UPDATE'' and old.status = ''screening'' then return new; end if;';
  a_blank constant text := 'update app_private.skills_test_attempts set status = ''expired'' where id = r.id;';
  a_done  constant text := 'n_done := n_done + 1;';
  a_skip  constant text := 'n_skip := n_skip + 1;';
begin
  -- "Application received" is for a new application, not for a test that expired
  d := pg_get_functiondef('app_private.lb_dispatcher_applied_email()'::regprocedure);
  if position(a_trg in d) = 0 then raise exception '%lb_dispatcher_applied_email', miss; end if;
  execute replace(d, a_trg, a_trg || E'\n  if tg_op = ''UPDATE'' and old.status = ''skills_test'' then return new; end if;   -- bl_disp_0602: expired test back to screening');

  d := pg_get_functiondef('app_private.skills_test_sweep()'::regprocedure);
  if position(a_blank in d) = 0 then raise exception '%sweep blank', miss; end if;
  if position(a_done in d) = 0 then raise exception '%sweep done', miss; end if;
  if position(a_skip in d) = 0 then raise exception '%sweep skip', miss; end if;
  d := replace(d, a_blank, a_blank || E'\n      perform app_private.disp_test_back_to_screening(r.user_id, ''started, nothing answered'');   -- bl_disp_0602');
  d := replace(d, a_done, E'perform app_private.disp_test_back_to_screening(r.user_id, ''3 automatic re-invites used'');   -- bl_disp_0602\n      ' || a_done);
  d := replace(d, a_skip, E'perform app_private.disp_test_back_to_screening(r.user_id, ''address cannot be e-mailed'');   -- bl_disp_0602\n      ' || a_skip);
  execute d;
end $$;

-- backfill: the ones that are stuck today
do $$
declare r record;
begin
  for r in select dp.user_id from app_private.dispatcher_profiles dp
            where dp.status = 'skills_test'
              and (select t.status from app_private.skills_test_attempts t where t.user_id = dp.user_id order by t.attempt_no desc limit 1) = 'expired'
  loop
    perform app_private.disp_test_back_to_screening(r.user_id, 'backfill bl_disp_0602');
  end loop;
end $$;

-- ================================================================ C. duplicate applications
create table if not exists app_private.dispatcher_dup_holds (
  user_id         uuid primary key references auth.users(id) on delete cascade,   -- the NEW application
  dup_of          uuid references auth.users(id) on delete set null,              -- the earlier record it matches
  via             text not null check (via in ('phone','email')),
  held_at         timestamptz not null default now(),
  attempts        int not null default 1,
  last_attempt_at timestamptz not null default now(),
  cleared_at      timestamptz,          -- set = management allowed this application to go forward
  resolved_at     timestamptz,          -- set = management decided (allowed, or reactivated the original instead)
  resolved_by     uuid,
  action          text check (action in ('allowed','original_reactivated')),
  note            text
);
alter table app_private.dispatcher_dup_holds enable row level security;
revoke all on app_private.dispatcher_dup_holds from public, anon, authenticated;
comment on table app_private.dispatcher_dup_holds is
  'bl_disp_0602: a dispatcher application whose phone / canonical e-mail matches an earlier application. Held out of screening until management decides (cc_dispatcher_duplicate_resolve).';

create or replace function app_private.disp_phone_key(p text)
returns text language sql immutable set search_path = app_private, public as $$
  select case when length(x.d) >= 8 then right(x.d, 10) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x
$$;

create or replace function app_private.disp_email_key(p text)
returns text language sql immutable set search_path = app_private, public as $$
  select case when x.e = '' or position('@' in x.e) = 0 then null
              when split_part(x.e, '@', 2) in ('gmail.com', 'googlemail.com')
                then replace(split_part(split_part(x.e, '@', 1), '+', 1), '.', '') || '@gmail.com'
              else split_part(split_part(x.e, '@', 1), '+', 1) || '@' || split_part(x.e, '@', 2) end
    from (select lower(btrim(coalesce(p, ''))) e) x
$$;

-- every OTHER dispatcher application that shares this one's phone (last 10 digits) or canonical e-mail
create or replace function app_private.disp_identity_matches(p_user uuid, p_phone text default null)
returns table (user_id uuid, via text)
language sql stable security definer set search_path = app_private, public as $$
  with me as (
    select app_private.disp_phone_key(coalesce(nullif(btrim(p_phone), ''),
             (select dp.phone from app_private.dispatcher_profiles dp where dp.user_id = p_user))) pk,
           app_private.disp_email_key((select u.email from auth.users u where u.id = p_user)) ek)
  select d.user_id,
         case when app_private.disp_phone_key(d.phone) = me.pk then 'phone' else 'email' end
    from app_private.dispatcher_profiles d
    left join auth.users u on u.id = d.user_id
   cross join me
   where d.user_id <> p_user
     and (app_private.disp_phone_key(d.phone) = me.pk or app_private.disp_email_key(u.email) = me.ek)
$$;
revoke all on function app_private.disp_phone_key(text) from public, anon, authenticated;
revoke all on function app_private.disp_email_key(text) from public, anon, authenticated;
revoke all on function app_private.disp_identity_matches(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- the gate, at submit
do $$
declare d text; miss constant text := 'bl_disp_0602: anchor not found in dispatcher_apply: ';
  a_decl constant text := 'declare v_uid uuid := auth.uid(); v_status text; v_name text;';
  a_ins  constant text := '  insert into app_private.dispatcher_profiles as d (user_id,';
  a_new  constant text := 'case when p_submit then ''screening'' else ''applied'' end, now())';
  a_upd  constant text := 'status = case when p_submit and d.status in';
  a_ret  constant text := 'returning status, full_name into v_status, v_name;';
begin
  d := pg_get_functiondef('public.dispatcher_apply(jsonb,boolean)'::regprocedure);
  if position(a_decl in d) = 0 then raise exception '%decl', miss; end if;
  if position(a_ins in d) = 0 then raise exception '%insert', miss; end if;
  if position(a_new in d) = 0 then raise exception '%new status', miss; end if;
  if position(a_upd in d) = 0 then raise exception '%update status', miss; end if;
  if position(a_ret in d) = 0 then raise exception '%returning', miss; end if;
  d := replace(d, a_decl, a_decl || ' v_go boolean := p_submit; v_dup uuid; v_via text; v_first boolean;');
  d := replace(d, a_ins, $ins$  -- bl_disp_0602: one person, one application. A submit whose phone / canonical e-mail matches an earlier
  -- application (any account) is saved but held out of screening until management decides.
  if p_submit
     and coalesce((select dp.status from app_private.dispatcher_profiles dp where dp.user_id = v_uid), 'applied') in ('applied','withdrawn')
     and not exists (select 1 from app_private.dispatcher_dup_holds h where h.user_id = v_uid and h.cleared_at is not null) then
    select m.user_id, m.via into v_dup, v_via
      from app_private.disp_identity_matches(v_uid, p->>'phone') m
      join app_private.dispatcher_profiles o on o.user_id = m.user_id
     where o.status not in ('applied','withdrawn') or o.reviewed_at is not null or coalesce(o.reapply_count, 0) > 0
     order by (o.status = 'rejected' or o.blocked_at is not null) desc, o.created_at
     limit 1;
    v_go := v_dup is null;
  end if;
$ins$ || a_ins);
  d := replace(d, a_new, 'case when v_go then ''screening'' else ''applied'' end, now())');
  d := replace(d, a_upd, 'status = case when v_go and d.status in');
  d := replace(d, a_ret, a_ret || $ret$
  if p_submit and v_dup is not null then
    insert into app_private.dispatcher_dup_holds as h (user_id, dup_of, via) values (v_uid, v_dup, v_via)
    on conflict (user_id) do update set dup_of = excluded.dup_of, via = excluded.via, attempts = h.attempts + 1, last_attempt_at = now()
    returning (h.attempts = 1) into v_first;
    if v_first then
      perform app_private.disp_audit('dispatcher.duplicate.held', 'dispatcher', v_uid::text, null,
        coalesce(v_name,'A candidate') || ': application held — same ' || v_via || ' as an earlier application',
        jsonb_build_object('dup_of', v_dup, 'via', v_via));
      begin
        perform app_private.disp_notify(null, 'staff', 'dispatcher.duplicate.held',
          'Duplicate dispatcher application held',
          coalesce(v_name,'A candidate') || ' applied from a new account, but the ' || v_via || ' matches an earlier application ('
          || coalesce((select o.full_name from app_private.dispatcher_profiles o where o.user_id = v_dup), 'on file') || ', '
          || coalesce((select o.status from app_private.dispatcher_profiles o where o.user_id = v_dup), '?')
          || '). It is NOT in screening. Open it to allow the application or reactivate the original.',
          '/app/command-center/#/dispatcher?id=' || v_uid::text || '&tab=documents', false);
      exception when others then null; end;
    end if;
    return jsonb_build_object('error', 'We already have an application on file that matches your details, so this one cannot go forward on its own. If you applied before, sign in with the e-mail address you used then. Our team has been notified and will review it — you do not need to submit again.',
                              'held', 'duplicate');
  end if;$ret$);
  execute d;
end $$;

-- ---------------------------------------------------------------- a held application cannot be advanced around the decision
do $$
declare d text; miss constant text := 'bl_disp_0602: anchor not found: ';
  a_dec constant text := 'then return jsonb_build_object(''error'',''permanently blocked — a carrier report was upheld; no reinstate''); end if;';
  a_inv constant text := 'return jsonb_build_object(''error'',''not a dispatcher'');
  end if;';
  held constant text := 'this application is held as a duplicate of an earlier one — open Identity & previous record and allow it, or reactivate the original';
begin
  d := pg_get_functiondef('public.cc_dispatcher_decide(uuid,text,text)'::regprocedure);
  if position(a_dec in d) = 0 then raise exception '%cc_dispatcher_decide', miss; end if;
  execute replace(d, a_dec, a_dec || E'\n  if p_action in (''screening'',''skills_test'',''trial'',''verify'',''activate'') and exists (select 1 from app_private.dispatcher_dup_holds h where h.user_id = p_user and h.cleared_at is null)\n    then return jsonb_build_object(''error'',''' || held || '''); end if;   -- bl_disp_0602');

  d := pg_get_functiondef('public.cc_dispatcher_test_invite(uuid,integer,integer)'::regprocedure);
  if position(a_inv in d) = 0 then raise exception '%cc_dispatcher_test_invite', miss; end if;
  execute replace(d, a_inv, a_inv || E'\n  if exists (select 1 from app_private.dispatcher_dup_holds h where h.user_id = p_user and h.cleared_at is null) then\n    return jsonb_build_object(''error'',''' || held || E''');\n  end if;   -- bl_disp_0602');
end $$;

-- ---------------------------------------------------------------- CC: the record behind an application
create or replace function public.cc_dispatcher_identity(p_user uuid)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else jsonb_build_object(
    'hold', (select jsonb_build_object('dup_of', h.dup_of, 'via', h.via, 'held_at', h.held_at, 'attempts', h.attempts,
                      'cleared_at', h.cleared_at, 'resolved_at', h.resolved_at, 'action', h.action, 'note', h.note,
                      'open', h.resolved_at is null)
               from app_private.dispatcher_dup_holds h where h.user_id = p_user),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', d.user_id, 'via', m.via, 'name', d.full_name, 'email', u.email, 'phone', d.phone, 'country', d.country,
        'status', d.status, 'applied_at', d.created_at, 'reviewed_at', d.reviewed_at, 'review_note', d.review_note,
        'reject_reasons', d.reject_reasons, 'blocked', d.blocked_at is not null, 'blocked_reason', d.blocked_reason,
        'trial_start', d.trial_start, 'trial_end', d.trial_end, 'reapply_count', d.reapply_count,
        'held', exists (select 1 from app_private.dispatcher_dup_holds h2 where h2.user_id = d.user_id and h2.cleared_at is null),
        'attempts', (select count(*) from app_private.skills_test_attempts t where t.user_id = d.user_id),
        'test', (select jsonb_build_object('status', t.status, 'decision', t.decision, 'score', t.staff_score, 'auto', t.auto_score,
                                           'max', t.max_score, 'submitted_at', t.submitted_at, 'attempt_no', t.attempt_no)
                   from app_private.skills_test_attempts t where t.user_id = d.user_id
                  order by (t.status = 'scored') desc, t.attempt_no desc limit 1),
        'delivered', (select count(*) from app_private.dispatcher_bookings b where b.dispatcher_user_id = d.user_id and b.status = 'delivered'),
        'carriers', (select count(distinct a.carrier_org_id) from app_private.dispatcher_assignments a where a.dispatcher_user_id = d.user_id)
      ) order by (m.via = 'name'), d.created_at)
      from (select im.user_id, im.via from app_private.disp_identity_matches(p_user) im
            union all
            -- same name + country is only a hint: shown as "possible", never held on
            select d2.user_id, 'name' from app_private.dispatcher_profiles d2, app_private.dispatcher_profiles me
             where me.user_id = p_user and d2.user_id <> p_user
               and length(btrim(coalesce(me.full_name, ''))) >= 6
               and lower(btrim(d2.full_name)) = lower(btrim(me.full_name))
               and lower(btrim(coalesce(d2.country, ''))) = lower(btrim(coalesce(me.country, '')))
               and d2.user_id not in (select x.user_id from app_private.disp_identity_matches(p_user) x)) m
      join app_private.dispatcher_profiles d on d.user_id = m.user_id
      left join auth.users u on u.id = d.user_id), '[]'::jsonb)) end
$$;
revoke execute on function public.cc_dispatcher_identity(uuid) from public, anon;
grant execute on function public.cc_dispatcher_identity(uuid) to authenticated;

-- ---------------------------------------------------------------- CC: management's decision on a held application
create or replace function public.cc_dispatcher_duplicate_resolve(p_user uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare h app_private.dispatcher_dup_holds; o app_private.dispatcher_profiles; v_name text; v_note text := nullif(btrim(coalesce(p_note, '')), ''); r jsonb;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_action not in ('allow','reactivate_original') then return jsonb_build_object('error','bad action'); end if;
  select * into h from app_private.dispatcher_dup_holds where user_id = p_user for update;
  if not found then return jsonb_build_object('error','this application is not held as a duplicate'); end if;
  if h.cleared_at is not null then return jsonb_build_object('error','this application was already allowed'); end if;
  select * into o from app_private.dispatcher_profiles where user_id = h.dup_of;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;

  -- an upheld carrier report is a permanent block (bl_disp_0443); a new e-mail does not lift it
  if o.blocked_at is not null then
    return jsonb_build_object('error','the earlier record is permanently blocked — a carrier report was upheld; no second application');
  end if;

  if p_action = 'allow' then
    update app_private.dispatcher_dup_holds
       set cleared_at = now(), resolved_at = now(), resolved_by = auth.uid(), action = 'allowed', note = v_note
     where user_id = p_user;
    update app_private.dispatcher_profiles set status = 'screening', updated_at = now()
     where user_id = p_user and status in ('applied','withdrawn');
    perform app_private.disp_audit('dispatcher.duplicate.allowed', 'dispatcher', p_user::text, null,
      coalesce(v_name,'candidate') || ': re-application allowed by management — now in screening (earlier record: '
      || coalesce(o.full_name, '?') || ', ' || coalesce(o.status, '?') || ')',
      jsonb_build_object('dup_of', h.dup_of, 'via', h.via, 'note', v_note));
    return jsonb_build_object('ok', true, 'action', 'allowed', 'status', 'screening');
  end if;

  -- reactivate_original: the second chance goes to the record that carries the history
  if o.user_id is null then return jsonb_build_object('error','the earlier application no longer exists — allow this one instead'); end if;
  if o.status <> 'rejected' then
    return jsonb_build_object('error','the earlier application is "' || o.status || '", not rejected — there is nothing to reactivate');
  end if;
  r := public.cc_dispatcher_decide(h.dup_of, 'screening', v_note);
  if r ? 'error' then return r; end if;
  update app_private.dispatcher_dup_holds
     set resolved_at = now(), resolved_by = auth.uid(), action = 'original_reactivated', note = v_note
   where user_id = p_user;
  perform app_private.disp_audit('dispatcher.duplicate.original_reactivated', 'dispatcher', p_user::text, null,
    coalesce(v_name,'candidate') || ': duplicate stays closed; the original application (' || coalesce(o.full_name, '?') || ') was reactivated',
    jsonb_build_object('dup_of', h.dup_of, 'via', h.via, 'note', v_note));
  return jsonb_build_object('ok', true, 'action', 'original_reactivated', 'original', h.dup_of, 'status', r->>'status');
end $$;
revoke execute on function public.cc_dispatcher_duplicate_resolve(uuid, text, text) from public, anon;
grant execute on function public.cc_dispatcher_duplicate_resolve(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- CC lists: flag a held application
do $$
declare d text; miss constant text := 'bl_disp_0602: anchor not found: ';
  a_b  constant text := '''has_id'', coalesce(p.skills->>''id_doc'','''') <> '''',';
  a_p1 constant text := 'd.trial_start, d.trial_end, d.reviewed_at, u.email, u.last_sign_in_at';
  a_p2 constant text := '''email'', b.email,';
begin
  d := pg_get_functiondef('public.cc_dispatchers_board(integer)'::regprocedure);
  if position(a_b in d) = 0 then raise exception '%cc_dispatchers_board', miss; end if;
  execute replace(d, a_b, a_b || E'\n             ''dup_held'', exists (select 1 from app_private.dispatcher_dup_holds h where h.user_id = p.user_id and h.resolved_at is null),   -- bl_disp_0602');

  d := pg_get_functiondef('public.cc_dispatchers_page(text,text,timestamptz,uuid,integer,uuid)'::regprocedure);
  if position(a_p1 in d) = 0 then raise exception '%cc_dispatchers_page base', miss; end if;
  if position(a_p2 in d) = 0 then raise exception '%cc_dispatchers_page row', miss; end if;
  d := replace(d, a_p1, a_p1 || E',\n           exists (select 1 from app_private.dispatcher_dup_holds h where h.user_id = d.user_id and h.resolved_at is null) dup_held   -- bl_disp_0602');
  d := replace(d, a_p2, a_p2 || ' ''dup_held'', b.dup_held,');
  execute d;
end $$;

-- ---------------------------------------------------------------- the anon-executable SECURITY DEFINER surface must not have moved
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and p.proname in ('cc_dispatcher_identity','cc_dispatcher_duplicate_resolve')
                and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'bl_disp_0602: a new function is executable by anon';
  end if;
end $$;
