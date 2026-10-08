-- bl_disp_0534 — Unresponsive-carrier handling + daily trial report split + two fixes (owner ask, 8 Oct 2026).
-- STAGING FIRST (snslhvmkjusozgjelghi). The prod copy is migrations/bl_disp_0534_carrier_unreachable.PROD.sql (same SQL;
-- the owner applies it). Reads with migrations/bl_disp_0484_trial_daily_report.sql and CLAUDE.md §6 (catalog).
--
-- 1. dispatcher.carrier.unreachable — new catalog e-mail (audience carrier, class O, send_mode TEST until the owner flips it):
--    "Your LoadBoot dispatcher has been trying to reach you". Real numbers from dialer_calls. Staff copy to hello@ via
--    dispatcher.trial.alert (reason carrier_unreachable).
-- 2. Auto-flag (additive): an ACTIVE assignment is flagged carrier_unreachable when the dispatcher has >= 3 unanswered
--    outbound attempts on >= 2 distinct days, 0 answered (answered_at null or duration <= 20 s) and no inbound contact
--    from the carrier in that window. Flag = dispatcher_assignments.flagged_at + flag_reason (status stays 'active':
--    the status CHECK and the one-active-per-carrier index, wa_route, sms routing and every "status = 'active'"
--    query depend on it; the flag columns are the state). On flag: e-mail once, in-portal notice to the dispatcher
--    ("we've emailed the carrier, keep one attempt a day"), system line in the carrier thread, audit. 48 h later with
--    still no contact: CC sees "End assignment — carrier unresponsive" (one click, reason prefilled; NOTHING auto-ends).
--    Carrier contact (answered call > 20 s, inbound call, WhatsApp/SMS reply, carrier message in the thread, portal
--    login) clears the flag. Hourly cron lb-disp-unreachable; nothing is e-mailed twice (idempotency key per flag day).
-- 3. Daily trial report: EFFORT block (dispatcher-controlled, drives the tone, daily minimum) + OUTCOME block (loads,
--    RC, gross, check calls). While the carrier is flagged: outcome reads "Blocked by carrier" instead of a grade and
--    never drives the tone; flagged days are "paused" in the countdown and excluded from the trial-day count
--    (app_private.disp_trial_paused_days, written by the hourly run). Zero effort, or attempts on one day and nothing
--    after, is still tone = bad.
-- 4. email_catalog sends counter: sends_total / sends_30d / last_seen were only ever written by email_catalog_sync(),
--    which nothing schedules (prod: 44 dispatcher.trial.daily deliveries, catalog 0; last sync ~22 Sep). Fix for every
--    key: email_catalog_touch (called by sys_email on every send) bumps the counters live, cc_email_catalog reads the
--    30-day count from message_deliveries, and a nightly cron runs the sync.
-- 5. "W-9 Not signed" false blocker: disp_carrier_ready + carrier_dispatcher_desk only read public.documents (type w9);
--    an e-signed W-9 lives in app_private.w9_submissions (carrier_id = org id — THE WAY HOME, SPRINT SHIFT both have
--    rows). Both functions now count either.
-- Live functions are patched BY ANCHOR (pg_get_functiondef + replace, every anchor asserted — verified on staging
-- 8 Oct 2026). disp_trial_stats is replaced whole (bl_disp_0484's body + the effort block).
-- Anon surface (§4): no new public function is anon-executable (35 staging / 36 prod — check the NAMES).

-- ───────────────────────── 2a. columns + paused days ─────────────────────────
alter table app_private.dispatcher_assignments
  add column if not exists flagged_at       timestamptz,
  add column if not exists flag_reason      text,
  add column if not exists flag_cleared_at  timestamptz,
  add column if not exists flag_stats       jsonb;
create index if not exists dispatcher_assignments_flagged_ix on app_private.dispatcher_assignments (flagged_at) where flagged_at is not null;

create table if not exists app_private.disp_trial_paused_days (
  dispatcher_user_id uuid not null,
  day                date not null,
  assignment_id      uuid,
  created_at         timestamptz not null default now(),
  primary key (dispatcher_user_id, day)
);
alter table app_private.disp_trial_paused_days enable row level security;

-- ───────────────────────── 2b. who counts as "the carrier" on the phone ─────────────────────────
create or replace function app_private.disp_carrier_numbers(p_org uuid) returns text[]
language sql stable security definer set search_path to 'app_private', 'public' as $$
  select coalesce(array_agg(distinct n) filter (where n is not null), '{}')
    from (
      select app_private.disp_ph10(p.phone) n from public.organizations o join public.profiles p on p.id = o.owner_user_id where o.id = p_org
      union all select app_private.disp_ph10(p.whatsapp) from public.organizations o join public.profiles p on p.id = o.owner_user_id where o.id = p_org
      union all select app_private.disp_ph10(d.phone) from app_private.fleet_drivers d where d.carrier_id = p_org and coalesce(d.status,'active') <> 'inactive'
    ) x
$$;
revoke all on function app_private.disp_carrier_numbers(uuid) from public, anon, authenticated;

-- the newest moment the carrier side reached LoadBoot, on any channel, at or after p_since (null = never)
create or replace function app_private.disp_carrier_contact_at(p_assignment uuid, p_since timestamptz) returns timestamptz
language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare a record; nums text[]; v_owner uuid; v_at timestamptz;
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return null; end if;
  nums := app_private.disp_carrier_numbers(a.carrier_org_id);
  select owner_user_id into v_owner from public.organizations where id = a.carrier_org_id;
  select max(ts) into v_at from (
    select c.answered_at ts from app_private.dialer_calls c
     where c.dispatcher_user_id = a.dispatcher_user_id and c.direction = 'outbound' and c.answered_at is not null and coalesce(c.duration_sec,0) > 20
       and (c.carrier_org_id = a.carrier_org_id or app_private.disp_ph10(c.counterparty) = any(nums))
    union all
    select c.started_at from app_private.dialer_calls c
     where c.direction = 'inbound' and (c.carrier_org_id = a.carrier_org_id or app_private.disp_ph10(c.counterparty) = any(nums))
    union all
    select m.created_at from app_private.wa_messages m join app_private.wa_threads t on t.id = m.thread_id
     where m.direction = 'inbound' and (t.carrier_org_id = a.carrier_org_id or app_private.disp_ph10(t.counterparty) = any(nums))
    union all
    select m.created_at from app_private.dialer_messages m
     where m.direction = 'inbound' and (m.carrier_org_id = a.carrier_org_id or app_private.disp_ph10(m.counterparty) = any(nums))
    union all
    select dm.created_at from app_private.dispatcher_messages dm where dm.assignment_id = a.id and dm.sender_role = 'carrier'
    union all
    select u.last_sign_in_at from auth.users u where u.id = v_owner
  ) x where ts >= p_since;
  return v_at;
end $$;
revoke all on function app_private.disp_carrier_contact_at(uuid, timestamptz) from public, anon, authenticated;

-- the rule, as numbers. Window: since the assignment started / the flag was last cleared, at most 14 days back.
create or replace function app_private.disp_unreachable_eval(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare a record; nums text[]; v_since timestamptz; r record; v_contact timestamptz;
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return jsonb_build_object('qualifies', false, 'reason', 'no assignment'); end if;
  nums := app_private.disp_carrier_numbers(a.carrier_org_id);
  v_since := greatest(a.assigned_at, coalesce(a.flag_cleared_at, a.assigned_at), now() - interval '14 days');
  select count(*) attempts,
         count(*) filter (where c.answered_at is not null and coalesce(c.duration_sec,0) > 20) answered,
         count(*) filter (where c.answered_at is null or coalesce(c.duration_sec,0) <= 20) unanswered,
         count(distinct (c.started_at at time zone 'America/New_York')::date) days,
         count(*) filter (where c.status = 'voicemail' or coalesce(c.outcome,'') ilike '%voicemail%') voicemails,
         min(c.started_at) first_at, max(c.started_at) last_at
    into r
    from app_private.dialer_calls c
   where c.dispatcher_user_id = a.dispatcher_user_id and c.direction = 'outbound' and c.started_at >= v_since
     and (c.carrier_org_id = a.carrier_org_id or app_private.disp_ph10(c.counterparty) = any(nums));
  v_contact := app_private.disp_carrier_contact_at(a.id, v_since);
  return jsonb_build_object('attempts', r.attempts, 'answered', r.answered, 'unanswered', r.unanswered, 'days', r.days,
    'voicemails', r.voicemails, 'first_at', r.first_at, 'last_at', r.last_at, 'since', v_since, 'contact_at', v_contact,
    'qualifies', r.unanswered >= 3 and r.days >= 2 and r.answered = 0 and v_contact is null);
end $$;
revoke all on function app_private.disp_unreachable_eval(uuid) from public, anon, authenticated;

-- ───────────────────────── 1. the e-mail (premium layout, same shell as the trial report) ─────────────────────────
create or replace function app_private.disp_unreachable_email(p_assignment uuid, p_stats jsonb) returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare a record; d record; c record; F text := app_private.disp_tdr_f(); v_line text; v_first text; v_dname text; v_cname text;
  v_att int := coalesce((p_stats->>'attempts')::int, 0); v_vm int := coalesce((p_stats->>'voicemails')::int, 0);
  v_firstd text; v_lastd text; v_html text; v_text text; v_subj text; v_portal text := 'https://loadboot.com/app/carrier/#dispatcher';
  v_tiles text;
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return null; end if;
  select dp.full_name, dp.phone into d from app_private.dispatcher_profiles dp where dp.user_id = a.dispatcher_user_id;
  select o.name, p.contact_name into c from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id;
  select l.phone_e164 into v_line from app_private.dialer_lines l where l.dispatcher_user_id = a.dispatcher_user_id and l.status = 'active' limit 1;
  v_dname := app_private.disp_esc(coalesce(nullif(d.full_name,''), 'your LoadBoot dispatcher'));
  v_cname := app_private.disp_esc(coalesce(nullif(c.name,''), 'your company'));
  v_first := app_private.disp_esc(coalesce(nullif(split_part(btrim(coalesce(c.contact_name,'')), ' ', 1), ''), 'there'));
  v_firstd := coalesce(to_char((p_stats->>'first_at')::timestamptz at time zone 'America/New_York', 'Dy FMDD Mon'), '—');
  v_lastd  := coalesce(to_char((p_stats->>'last_at')::timestamptz at time zone 'America/New_York', 'Dy FMDD Mon, FMHH:MI AM'), '—');
  v_subj := 'Your LoadBoot dispatcher has been trying to reach you';

  v_tiles := '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
    || app_private.disp_tdr_kpi('Call attempts', v_att::text, 'to ' || v_cname)
    || app_private.disp_tdr_kpi('Voicemails', v_vm::text, 'left for you')
    || app_private.disp_tdr_kpi('First &rarr; last', v_firstd, v_lastd || ' ET') || '</tr></table>';

  v_html := '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f5;margin:0"><tr><td align="center" style="padding:24px 10px">'
    || '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e9f2">'
    || '<tr><td style="background:#10223B;padding:20px 28px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
    || '<td style="vertical-align:middle"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-white-2x.png" width="150" alt="LoadBoot" style="display:block;border:0;max-width:150px;height:auto"></a></td>'
    || '<td style="' || F || 'font-size:12px;color:#9fb3d1;text-align:right;vertical-align:middle">Dispatch &middot; ' || v_cname || '</td></tr></table>'
    || '<div style="' || F || 'font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#9fb3d1;margin-top:18px">Your dedicated dispatcher</div>'
    || '<div style="' || F || 'font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;margin-top:4px">' || v_dname || ' has been trying to reach you</div>'
    || '</td></tr>'
    || '<tr><td style="padding:24px 28px 0">'
    || '<p style="' || F || 'font-size:16px;color:#10223B;margin:0 0 6px">Hi ' || v_first || ',</p>'
    || '<p style="' || F || 'font-size:15px;line-height:1.6;color:#334155;margin:0">' || v_dname || ', your LoadBoot dispatcher for ' || v_cname
    || ', has called you ' || v_att || ' time' || case when v_att = 1 then '' else 's' end
    || case when v_vm > 0 then ' and left ' || v_vm || ' voicemail' || case when v_vm = 1 then '' else 's' end else '' end
    || ' and has not been able to get you on the phone. Nothing is wrong with your account &mdash; we just cannot move your truck without a short word from you.</p>'
    || '</td></tr>'
    || app_private.disp_tdr_section('The calls so far', 'from your dispatcher''s LoadBoot line', v_tiles)
    || app_private.disp_tdr_section('What we need from you', 'about 5 minutes', '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
      || (select string_agg('<tr><td style="width:30px;padding:6px 0;vertical-align:top"><div style="width:22px;height:22px;border-radius:50%;background:#10223B;color:#ffffff;' || F || 'font-size:12px;font-weight:700;text-align:center;line-height:22px">' || n || '</div></td>'
            || '<td style="padding:6px 0;' || F || 'font-size:14px;color:#10223B;line-height:1.5">' || t || '</td></tr>', '' order by n)
          from (values (1, 'A short call to confirm your truck is <b>available</b> and from when'),
                       (2, 'The <b>lanes</b> you want to run (and the states you do not)'),
                       (3, 'Your <b>rate floor</b> &mdash; the lowest rate per mile or total you will accept')) t(n, t))
      || '</table>')
    || app_private.disp_tdr_section('Tell us a good time, or call back', null,
      '<p style="' || F || 'font-size:14px;line-height:1.6;color:#334155;margin:0 0 12px">Reply to this e-mail with a good time and the best number to reach you, or call ' || v_dname || ' back'
      || case when v_line is not null then ' on <b>' || app_private.disp_esc(v_line) || '</b>' else '' end || '. You can also write in the thread in your portal.</p>'
      || app_private.disp_tdr_btn('Open my portal', v_portal, '#FC5305', '#ffffff', null)
      || case when v_line is not null then app_private.disp_tdr_btn('Call ' || v_dname, 'tel:' || v_line, '#ffffff', '#10223B', '#e3e9f2') else '' end)
    || '<tr><td style="padding:22px 28px 0"><div style="border:1px solid #f5d9a8;background:#fff4e2;border-radius:10px;padding:12px 14px;' || F || 'font-size:14px;line-height:1.55;color:#10223B">'
    || '<b style="color:#b86e00">If we don''t hear back within 48 hours</b> we''ll pause your dispatch assignment so your dispatcher can take another carrier. You can restart any time from your portal &mdash; nothing is lost.</div></td></tr>'
    || '<tr><td style="padding:24px 28px 26px">'
    || '<div style="' || F || 'font-size:14px;color:#10223B"><b>LoadBoot Dispatch</b></div>'
    || '<div style="' || F || 'font-size:13px;color:#10223B;margin-top:2px">{{contact_sig}}</div>'
    || '<div style="height:1px;background:#e3e9f2;margin:16px 0 12px;font-size:0;line-height:0">&nbsp;</div>'
    || '<div style="' || F || 'font-size:12px;line-height:1.55;color:#8ea2c3">This is an operational notice about your LoadBoot dispatch assignment, sent because your dispatcher could not reach you by phone. Call counts come from your dispatcher''s LoadBoot line.</div>'
    || '</td></tr></table></td></tr></table>';

  v_text := 'Hi ' || coalesce(nullif(split_part(btrim(coalesce(c.contact_name,'')), ' ', 1), ''), 'there') || E',\n\n'
    || coalesce(nullif(d.full_name,''), 'Your LoadBoot dispatcher') || ', your LoadBoot dispatcher for ' || coalesce(nullif(c.name,''), 'your company') || ', has called you ' || v_att || ' time(s)'
    || case when v_vm > 0 then ' and left ' || v_vm || ' voicemail(s)' else '' end || ' (' || v_firstd || ' to ' || v_lastd || ' ET) and could not reach you.' || E'\n\n'
    || E'What we need: a short call to confirm your availability, your lanes and your rate floor.\n'
    || 'Reply with a good time and number, or call back' || case when v_line is not null then ' on ' || v_line else '' end || E'. Portal: ' || v_portal || E'\n\n'
    || E'If we do not hear back within 48 hours we will pause your dispatch assignment so your dispatcher can take another carrier. Restart any time from your portal.\n\n'
    || 'LoadBoot Dispatch - {{contact_sig}}';
  return jsonb_build_object('subject', v_subj, 'html', v_html, 'text', v_text, 'to', (select u.email from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = a.carrier_org_id));
end $fn$;
revoke all on function app_private.disp_unreachable_email(uuid, jsonb) from public, anon, authenticated;

-- ───────────────────────── 2c. flag / clear / run ─────────────────────────
create or replace function app_private.disp_unreachable_flag(p_assignment uuid, p_stats jsonb) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare a record; e jsonb; v_cname text; v_dname text; v_day text := to_char(now() at time zone 'America/New_York', 'YYYYMMDD');
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment and status = 'active' and flagged_at is null;
  if a.id is null then return jsonb_build_object('flagged', false, 'reason', 'not active or already flagged'); end if;
  update app_private.dispatcher_assignments set flagged_at = now(), flag_reason = 'carrier_unreachable', flag_stats = p_stats, updated_at = now() where id = a.id;
  select name into v_cname from public.organizations where id = a.carrier_org_id;
  select full_name into v_dname from app_private.dispatcher_profiles where user_id = a.dispatcher_user_id;
  e := app_private.disp_unreachable_email(a.id, p_stats);
  if e->>'to' is not null then
    perform app_private.sys_email(e->>'to', 'dispatcher.carrier.unreachable', e->>'subject', e->>'html', e->>'text', 'disp.unreachable:' || a.id::text || ':' || v_day);
  end if;
  -- staff copy (reason carrier_unreachable) — hello@, per owner
  perform app_private.sys_email('hello@loadboot.com', 'dispatcher.trial.alert',
    'Trial: ' || coalesce(nullif(v_cname,''), 'a carrier') || ' is unreachable for ' || coalesce(nullif(v_dname,''), 'their dispatcher') || ' (carrier_unreachable)',
    '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a"><p>Reason: <b>carrier_unreachable</b>.</p><p><b>' || app_private.disp_esc(coalesce(v_dname,'The dispatcher')) || '</b> made '
      || coalesce(p_stats->>'attempts','0') || ' outbound attempts on ' || coalesce(p_stats->>'days','0') || ' days to <b>' || app_private.disp_esc(coalesce(v_cname,'the carrier')) || '</b> with none answered and no reply on any channel. '
      || 'The carrier was e-mailed (dispatcher.carrier.unreachable' || case when e->>'to' is null then ' — NO owner e-mail on file, nothing sent' else '' end || '). '
      || 'If there is still no contact 48 hours from now, Command Center will offer "End assignment — carrier unresponsive". Nothing ends by itself.</p>'
      || '<p><a href="https://loadboot.com/app/command-center/#/dispatcher?id=' || a.dispatcher_user_id::text || '">Open the dispatcher</a></p></div>',
    'carrier_unreachable: ' || coalesce(v_cname,'carrier') || ' / ' || coalesce(v_dname,'dispatcher') || ' — ' || coalesce(p_stats->>'attempts','0') || ' attempts on ' || coalesce(p_stats->>'days','0') || ' days, none answered.',
    'disp.trial.alert:carrier_unreachable:' || a.id::text || ':' || v_day);
  perform app_private.disp_notify(a.dispatcher_user_id, 'dispatcher', 'dispatcher.carrier_unreachable',
    'We''ve e-mailed ' || coalesce(nullif(v_cname,''), 'the carrier'),
    coalesce(nullif(v_cname,''), 'The carrier') || ' has not answered ' || coalesce(p_stats->>'attempts','0') || ' calls over ' || coalesce(p_stats->>'days','0') || ' days. LoadBoot has e-mailed them for a good time to call. Keep one attempt a day and log it; loads and RCs are not held against you while they are unreachable, and these days are paused in your trial.',
    '/app/agent/#dashboard', false);
  insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_role, body)
  values (a.id, a.carrier_org_id, 'system', 'LoadBoot e-mailed ' || coalesce(nullif(v_cname,''), 'the carrier') || ': ' || coalesce(p_stats->>'attempts','0') || ' calls over ' || coalesce(p_stats->>'days','0') || ' days went unanswered. Asked for a good time to talk.');
  perform app_private.disp_audit('dispatcher.carrier_unreachable', 'assignment', a.id::text, a.carrier_org_id,
    'flagged: ' || coalesce(p_stats->>'attempts','0') || ' attempts / ' || coalesce(p_stats->>'days','0') || ' days, none answered', coalesce(p_stats, '{}'::jsonb));
  return jsonb_build_object('flagged', true, 'emailed', e->>'to' is not null);
end $$;
revoke all on function app_private.disp_unreachable_flag(uuid, jsonb) from public, anon, authenticated;

create or replace function app_private.disp_unreachable_clear(p_assignment uuid, p_contact_at timestamptz) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare a record; v_cname text;
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment and flagged_at is not null;
  if a.id is null then return jsonb_build_object('cleared', false); end if;
  update app_private.dispatcher_assignments set flagged_at = null, flag_reason = null, flag_cleared_at = coalesce(p_contact_at, now()),
     flag_stats = coalesce(flag_stats, '{}'::jsonb) || jsonb_build_object('cleared_at', coalesce(p_contact_at, now())), updated_at = now() where id = a.id;
  select name into v_cname from public.organizations where id = a.carrier_org_id;
  perform app_private.disp_notify(a.dispatcher_user_id, 'dispatcher', 'dispatcher.carrier_reachable',
    coalesce(nullif(v_cname,''), 'The carrier') || ' is back',
    'They reached LoadBoot ' || to_char(coalesce(p_contact_at, now()) at time zone 'America/New_York', 'Dy FMDD Mon, FMHH:MI AM') || ' ET. Your trial clock runs again from today.', '/app/agent/#dashboard', false);
  perform app_private.disp_audit('dispatcher.carrier_reachable', 'assignment', a.id::text, a.carrier_org_id, 'flag cleared: carrier contact ' || coalesce(p_contact_at::text, now()::text), '{}'::jsonb);
  return jsonb_build_object('cleared', true);
end $$;
revoke all on function app_private.disp_unreachable_clear(uuid, timestamptz) from public, anon, authenticated;

-- hourly: clear flags where the carrier came back, record today as a paused day for the dispatchers still flagged,
-- then flag the assignments that now meet the rule. Every step idempotent.
create or replace function app_private.disp_unreachable_run() returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare r record; v_contact timestamptz; e jsonb; v_today date := (now() at time zone 'America/New_York')::date; v_out jsonb := '[]'::jsonb;
begin
  for r in select * from app_private.dispatcher_assignments where status = 'active' and flagged_at is not null loop
    v_contact := app_private.disp_carrier_contact_at(r.id, r.flagged_at);
    if v_contact is not null then
      v_out := v_out || jsonb_build_object('assignment', r.id, 'cleared', true, 'contact_at', v_contact);
      perform app_private.disp_unreachable_clear(r.id, v_contact);
    else
      insert into app_private.disp_trial_paused_days (dispatcher_user_id, day, assignment_id) values (r.dispatcher_user_id, v_today, r.id)
      on conflict (dispatcher_user_id, day) do nothing;
    end if;
  end loop;
  for r in select * from app_private.dispatcher_assignments where status = 'active' and flagged_at is null loop
    begin
      e := app_private.disp_unreachable_eval(r.id);
      if coalesce((e->>'qualifies')::boolean, false) then
        v_out := v_out || (jsonb_build_object('assignment', r.id) || app_private.disp_unreachable_flag(r.id, e));
      end if;
    exception when others then
      raise warning 'disp_unreachable_run % : %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ran', true, 'at', now(), 'results', v_out);
end $$;
revoke all on function app_private.disp_unreachable_run() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'lb-disp-unreachable') then perform cron.unschedule('lb-disp-unreachable'); end if;
end $$;
select cron.schedule('lb-disp-unreachable', '23 * * * *', $c$select app_private.disp_unreachable_run()$c$);

-- ───────────────────────── 2d. the flag travels to Command Center and the dispatcher's workspace ─────────────────────────
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cc_dispatcher_360(uuid)'::regprocedure);
  n := replace(d, '''carrier_ack_at'', a.carrier_ack_at, ''carrier_notified_at'', a.carrier_notified_at, ''contact_released_at'', a.contact_released_at,',
    '''flagged_at'', a.flagged_at, ''flag_reason'', a.flag_reason, ''flag_cleared_at'', a.flag_cleared_at, ''flag_stats'', a.flag_stats,
          ''unreachable_end_ready'', (a.flagged_at is not null and a.flagged_at < now() - interval ''48 hours''),
          ''carrier_ack_at'', a.carrier_ack_at, ''carrier_notified_at'', a.carrier_notified_at, ''contact_released_at'', a.contact_released_at,');
  if n = d then raise exception 'bl_disp_0534: cc_dispatcher_360 anchor not found'; end if;
  execute n;

  d := pg_get_functiondef('public.dispatcher_workspace_feed()'::regprocedure);
  n := replace(d, '''carrier_ack_at'', a.carrier_ack_at, ''ack_state'', ''confirmed''::text,',
    '''flagged_at'', a.flagged_at, ''flag_reason'', a.flag_reason, ''flag_stats'', a.flag_stats,
        ''carrier_ack_at'', a.carrier_ack_at, ''ack_state'', ''confirmed''::text,');
  if n = d then raise exception 'bl_disp_0534: dispatcher_workspace_feed anchor not found'; end if;
  execute n;
end $mig$;

-- ───────────────────────── 1b. catalog row (§6) — TEST until the owner flips it ─────────────────────────
insert into app_private.email_catalog as c
 (key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,replaced_by,cc_deep_link,send_mode,send_mode_note,send_mode_at)
values
('dispatcher.carrier.unreachable','Carrier unreachable — please call your dispatcher',
 'Sent once to the carrier owner when the assigned dispatcher''s calls go unanswered (>= 3 attempts on >= 2 days, none answered, no reply on any channel): the real call counts, what we need (availability, lanes, rate floor), a good time or a call back, and the 48-hour pause notice',
 'O','carrier','cron','app_private.disp_unreachable_run (cron lb-disp-unreachable, hourly) → app_private.disp_unreachable_flag',
 'once per flag (idempotent per assignment per day)','1 per assignment per flag; re-flag only after the carrier made contact and went quiet again',
 'carrier makes contact (answered call, inbound call, WhatsApp/SMS reply, thread message, portal login) or the assignment ends',
 coalesce((select preference_group from app_private.email_catalog where key = 'dispatcher.assigned.carrier'), 'account_critical'), false, 'live', null, '#/dispatchers',
 'test', 'bl_disp_0534: test until the owner has seen it rendered on staging', now())
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = excluded.status, cc_deep_link = excluded.cc_deep_link, updated_at = now();

-- ───────────────────────── 3a. the numbers: bl_disp_0484's disp_trial_stats + the EFFORT block ─────────────────────────
create or replace function app_private.disp_trial_stats(p_user uuid, p_from timestamptz, p_to timestamptz, p_since timestamptz)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare
  v_orgs uuid[]; v_drv text[]; v_car text[]; v_acct uuid[]; v_carmail text[];
  w jsonb; cu jsonb; v_loads jsonb; v_pending jsonb; v_trucks int; ef jsonb;
begin
  select coalesce(array_agg(distinct carrier_org_id), '{}') into v_orgs
    from app_private.dispatcher_assignments where dispatcher_user_id = p_user and status in ('active','paused');
  select coalesce(array_agg(distinct app_private.disp_ph10(phone)) filter (where app_private.disp_ph10(phone) is not null), '{}') into v_drv
    from app_private.fleet_drivers where carrier_id = any(v_orgs);
  select coalesce(array_agg(distinct app_private.disp_ph10(p.phone)) filter (where app_private.disp_ph10(p.phone) is not null), '{}'),
         coalesce(array_agg(distinct lower(u.email)) filter (where u.email is not null), '{}')
    into v_car, v_carmail
    from public.organizations o join public.profiles p on p.id = o.owner_user_id left join auth.users u on u.id = o.owner_user_id
   where o.id = any(v_orgs);
  select coalesce(array_agg(id), '{}') into v_acct from app_private.dmail_accounts where assigned_to = p_user;
  select count(*)::int into v_trucks from app_private.fleet_trucks
   where carrier_id = any(v_orgs) and coalesce(status,'active') not in ('inactive','retired');

  -- window: touches
  with c as (
    select c.*, app_private.disp_ph10(c.counterparty) ph from app_private.dialer_calls c
     where c.dispatcher_user_id = p_user and c.started_at >= p_from and c.started_at < p_to),
  k as (
    select c.*, case when c.ph = any(v_drv) then 'driver'
                     when c.carrier_org_id is not null or c.ph = any(v_car) then 'carrier' else 'broker' end kind,
           coalesce(lower(nullif(bc.broker,'')), lower(nullif(bk.broker,'')), lower(nullif(bp.broker,'')), c.ph, c.counterparty) bkey
      from c
      left join app_private.broker_contacts bc on bc.id = c.broker_contact_id
      left join app_private.dispatcher_bookings bk on bk.id = c.booking_id
      left join lateral (select b.broker from app_private.broker_contacts b
                          where b.dispatcher_user_id = p_user and app_private.disp_ph10(b.phone) = c.ph limit 1) bp on true),
  m as (
    select mm.folder, lower(a.addr) addr
      from app_private.dmail_messages mm
      cross join lateral (
        select x->>'email' addr from jsonb_array_elements(case when mm.folder = 'sent' and jsonb_typeof(mm.to_addrs) = 'array' then mm.to_addrs else '[]'::jsonb end) x
        union all select mm.from_email where mm.folder = 'inbox') a
     where mm.account_id = any(v_acct) and mm.folder in ('sent','inbox') and mm.msg_date >= p_from and mm.msg_date < p_to
       and a.addr is not null),
  mb as (
    select coalesce(lower(nullif(b.broker,'')), m.addr) bkey from m
      left join lateral (select broker from app_private.broker_contacts where dispatcher_user_id = p_user and lower(email) = m.addr limit 1) b on true
     where m.addr not like '%@loadboot.com' and m.addr not like '%.loadboot.com' and not (m.addr = any(v_carmail))),
  bk as (select distinct bkey from k where kind = 'broker' and bkey is not null
         union select bkey from mb where bkey is not null)
  select jsonb_build_object(
    'brokers', (select count(*) from bk),
    'broker_calls', (select count(*) from k where kind = 'broker'),
    'carrier', (select count(*) from k where kind = 'carrier')
             + (select count(*) from app_private.dispatcher_messages dm join app_private.dispatcher_assignments a on a.id = dm.assignment_id
                 where a.dispatcher_user_id = p_user and dm.sender_role in ('dispatcher','carrier') and dm.created_at >= p_from and dm.created_at < p_to),
    'driver', (select count(*) from k where kind = 'driver'),
    'sent', (select count(*) from app_private.dmail_messages where account_id = any(v_acct) and folder = 'sent' and msg_date >= p_from and msg_date < p_to),
    'received', (select count(*) from app_private.dmail_messages where account_id = any(v_acct) and folder = 'inbox' and msg_date >= p_from and msg_date < p_to)
  ) into w;

  -- bl_disp_0534: EFFORT — what the dispatcher controls, counted every day whatever the carrier does
  select jsonb_build_object(
    'attempts', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.direction = 'outbound' and c.started_at >= p_from and c.started_at < p_to),
    'unanswered', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.direction = 'outbound' and c.started_at >= p_from and c.started_at < p_to
                     and (c.answered_at is null or coalesce(c.duration_sec,0) <= 20)),
    'voicemails', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.direction = 'outbound' and c.started_at >= p_from and c.started_at < p_to
                     and (c.status = 'voicemail' or coalesce(c.outcome,'') ilike '%voicemail%')),
    'messages', (select count(*) from app_private.dispatcher_messages dm join app_private.dispatcher_assignments a on a.id = dm.assignment_id
                   where a.dispatcher_user_id = p_user and dm.sender_role = 'dispatcher' and dm.created_at >= p_from and dm.created_at < p_to)
              + (select count(*) from app_private.wa_messages m where m.direction = 'outbound' and m.sender_user_id = p_user and m.created_at >= p_from and m.created_at < p_to)
              + (select count(*) from app_private.dialer_messages m where m.direction = 'outbound' and coalesce(m.sender_user_id, m.dispatcher_user_id) = p_user and m.created_at >= p_from and m.created_at < p_to),
    'availability_posts', (select count(*) from app_private.truck_availability av join app_private.fleet_trucks t on t.id = av.truck_id
                             where t.carrier_id = any(v_orgs) and av.updated_at >= p_from and av.updated_at < p_to),
    'offers', (select count(*) from app_private.dispatcher_bookings b where b.dispatcher_user_id = p_user and b.created_at >= p_from and b.created_at < p_to),
    'flagged', exists (select 1 from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status = 'active' and a.flagged_at is not null),
    'flagged_carriers', (select string_agg(o.name, ', ' order by o.name) from app_private.dispatcher_assignments a join public.organizations o on o.id = a.carrier_org_id
                           where a.dispatcher_user_id = p_user and a.status = 'active' and a.flagged_at is not null),
    'flagged_since', (select min(a.flagged_at) from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user and a.status = 'active' and a.flagged_at is not null)
  ) into ef;

  select coalesce(jsonb_agg(jsonb_build_object('lane', b.origin || ' → ' || b.destination, 'broker', b.broker, 'miles', b.miles,
            'gross', b.gross, 'status', b.status) order by b.created_at), '[]'::jsonb)
    into v_loads
    from app_private.dispatcher_bookings b
   where b.dispatcher_user_id = p_user and b.created_at >= p_from and b.created_at < p_to and b.status not in ('cancelled','rejected');

  -- cumulative scorecard since trial start
  with b as (select * from app_private.dispatcher_bookings
              where dispatcher_user_id = p_user and created_at >= p_since and created_at < p_to),
       ok as (select * from b where status not in ('cancelled','rejected'))
  select jsonb_build_object(
    'loads', (select count(*) from ok),
    'gross', (select coalesce(sum(gross),0) from ok),
    'miles', (select coalesce(sum(miles),0) from ok where miles > 0),
    'gross_mi', (select coalesce(sum(gross),0) from ok where miles > 0),
    'above_floor', (select count(*) from ok where not below_min),
    'rc', (select count(*) from ok where rc_received_at is not null or rc_doc_path is not null),
    'check_calls', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = p_user and c.booking_id in (select id from ok)),
    'deadhead', (select coalesce(sum(deadhead),0) from ok where deadhead is not null and miles > 0),
    'dh_miles', (select coalesce(sum(miles),0) from ok where deadhead is not null and miles > 0),
    'cancels', (select count(*) from b where status = 'cancelled'),
    'trucks', v_trucks
  ) into cu;

  -- pending with each carrier
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', a.id, 'carrier', o.name,
            'items', (select coalesce(jsonb_agg(jsonb_build_object('key', r->>'key', 'label', r->>'label', 'detail', r->>'detail', 'blocker', (r->>'blocker')::boolean)), '[]'::jsonb)
                        from jsonb_array_elements(app_private.disp_carrier_ready(a.carrier_org_id)) r where not (r->>'done')::boolean))
          order by a.assigned_at), '[]'::jsonb)
    into v_pending
    from app_private.dispatcher_assignments a join public.organizations o on o.id = a.carrier_org_id
   where a.dispatcher_user_id = p_user and a.status in ('active','paused');

  return jsonb_build_object('window', w, 'effort', ef, 'loads', v_loads, 'cum', cu, 'pending', v_pending, 'carriers', cardinality(v_orgs));
end $fn$;
revoke all on function app_private.disp_trial_stats(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- a fifth score state: blocked by the carrier (grey, not a grade)
create or replace function app_private.disp_tdr_score(p_label text, p_val text, p_pct numeric, p_state text) returns text
language sql immutable set search_path to 'app_private', 'public' as $$
  select '<tr><td style="' || app_private.disp_tdr_f() || 'font-size:14px;color:#10223B;padding:7px 0;width:44%">' || p_label || '</td>'
    || '<td style="padding:7px 10px;width:26%"><div style="height:6px;background:#edf1f7;border-radius:3px"><div style="height:6px;width:'
    || greatest(4, least(100, round(coalesce(p_pct,0))))::int || '%;background:' || c.col || ';border-radius:3px"></div></div></td>'
    || '<td style="' || app_private.disp_tdr_f() || 'font-size:13px;color:#10223B;text-align:right;white-space:nowrap;padding:7px 0">' || p_val
    || ' <span style="color:' || c.col || ';font-weight:600">&middot; ' || c.lbl || '</span></td></tr>'
  from (select case p_state when 'ok' then '#0f8a5c' when 'behind' then '#b86e00' when 'none' then '#94a3b8' when 'blocked' then '#8a97ad' else '#c7321f' end col,
               case p_state when 'ok' then 'On track' when 'behind' then 'Behind' when 'none' then 'No loads yet' when 'blocked' then 'Blocked by carrier' else 'Missed' end lbl) c
$$;

-- ───────────────────────── 3b. the e-mail: EFFORT + OUTCOME, blocked, paused days (patched by anchor) ─────────────────────────
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('app_private.disp_trial_daily_build(uuid, date)'::regprocedure);

  -- declarations
  n := replace(d, 'v_toneA text; v_toneB text; v_date_lbl text; v_end_lbl text;',
                  'v_toneA text; v_toneB text; v_date_lbl text; v_end_lbl text;
  ef jsonb; v_att int; v_flag boolean; v_flag_names text; v_paused int := 0; v_min_att int := 15; v_outsub text;');
  if n = d then raise exception 'bl_disp_0534: build anchor 1 (declare) not found'; end if; d := n;

  -- zero = zero EFFORT (not zero outcome); paused days; the carrier flag
  n := replace(d, 'v_zero := not v_kick and coalesce((w->>''brokers'')::int,0) + coalesce((w->>''carrier'')::int,0) + coalesce((w->>''driver'')::int,0)
            + coalesce((w->>''sent'')::int,0) + coalesce((w->>''received'')::int,0) + jsonb_array_length(s->''loads'') = 0;',
                  'ef := coalesce(s->''effort'', ''{}''::jsonb);
  v_att := coalesce((ef->>''attempts'')::int, 0);
  v_flag := coalesce((ef->>''flagged'')::boolean, false);
  v_flag_names := app_private.disp_esc(ef->>''flagged_carriers'');
  v_outsub := case when v_flag then ''<span style="color:#8a97ad">Blocked by carrier</span>'' end;
  select count(*)::int into v_paused from app_private.disp_trial_paused_days pd
   where pd.dispatcher_user_id = p_user and pd.day >= d.trial_start and pd.day < p_date and extract(isodow from pd.day) < 6;
  v_day := greatest(1, v_day - v_paused);
  v_zero := not v_kick and v_att + coalesce((ef->>''messages'')::int,0) + coalesce((ef->>''availability_posts'')::int,0)
            + coalesce((ef->>''offers'')::int,0) + coalesce((w->>''sent'')::int,0) = 0;');
  if n = d then raise exception 'bl_disp_0534: build anchor 2 (v_zero) not found'; end if; d := n;

  -- tone from EFFORT only
  n := replace(d, 'v_tone := case when v_zero then ''bad'' when v_kick or v_final then ''info''
                 when coalesce((w->>''brokers'')::int,0) < 5 and jsonb_array_length(s->''loads'') = 0 then ''warn'' else ''good'' end;',
                  'v_tone := case when v_zero then ''bad'' when v_kick or v_final then ''info''
                 when v_att < 5 then ''bad'' when v_att < v_min_att then ''warn'' else ''good'' end;');
  if n = d then raise exception 'bl_disp_0534: build anchor 3 (tone) not found'; end if; d := n;

  -- the warning box speaks effort; a flagged carrier gets its own line
  n := replace(d, 'when v_tone = ''warn'' then ''<b style="color:'' || v_toneA || ''">Heads up.</b> Your activity '' || v_when || '' was well under pace: '' || (w->>''brokers'') || '' broker touch'' || case when (w->>''brokers'')::int = 1 then '''' else ''es'' end || '' against a target of 15 a day, and no load booked. If something got in the way, tap <b>I need help</b> below and tell us.'' end;',
                  'when v_tone = ''bad'' then ''<b style="color:'' || v_toneA || ''">We need to hear from you today.</b> Only '' || v_att || '' call attempt'' || case when v_att = 1 then '''' else ''s'' end || '' '' || v_when || '' against a minimum of '' || v_min_att || '' a day. Attempts count whether or not anyone picks up; this is the one number that is entirely yours. If something got in the way, tap <b>I need help</b> below and tell us today.''
    when v_tone = ''warn'' then ''<b style="color:'' || v_toneA || ''">Heads up.</b> '' || v_att || '' call attempt'' || case when v_att = 1 then '''' else ''s'' end || '' '' || v_when || '' against a minimum of '' || v_min_att || '' a day. Attempts count whether or not anyone picks up. If something got in the way, tap <b>I need help</b> below and tell us.'' end;
  if v_flag then
    v_warn := coalesce(v_warn || ''<br><br>'', '''') || ''<b>Blocked by carrier.</b> '' || coalesce(v_flag_names, ''Your carrier'') || '' has not answered your calls and LoadBoot has e-mailed them. Keep one attempt a day and log it. Loads, rate confirmations and gross are not graded while this lasts, and these days are paused in your trial clock.'';
  end if;');
  if n = d then raise exception 'bl_disp_0534: build anchor 4 (warn) not found'; end if; d := n;

  -- countdown band: paused days in grey after today
  n := replace(d, '|| case when i < v_day then ''#ffffff'' when i = v_day then ''#FC5305'' else ''#3a4a63'' end',
                  '|| case when i < v_day then ''#ffffff'' when i = v_day then ''#FC5305'' when i <= v_day + v_paused then ''#8a97ad'' else ''#3a4a63'' end');
  if n = d then raise exception 'bl_disp_0534: build anchor 5 (segments) not found'; end if; d := n;
  n := replace(d, '''working days left, today included &middot; ends '' || v_end_lbl || '', 6:00 PM ET'' end',
                  '''working days left, today included &middot; ends '' || v_end_lbl || '', 6:00 PM ET'' end || case when v_paused > 0 then '' &middot; '' || v_paused || '' day'' || case when v_paused = 1 then '''' else ''s'' end || '' paused (carrier unreachable)'' else '''' end');
  if n = d then raise exception 'bl_disp_0534: build anchor 6 (countdown label) not found'; end if; d := n;

  -- the activity block becomes EFFORT + OUTCOME
  n := replace(d, 'v_html := v_html || app_private.disp_tdr_section(''Your activity '' || v_when, case when p_date - v_prev > 1 then to_char(v_prev, ''FMDay FMDD Mon'') || '' to Sunday'' end,
      ''<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>''
      || app_private.disp_tdr_kpi(''Brokers'', w->>''brokers'', case when (w->>''brokers'')::int >= 15 then ''target 15'' else ''<span style="color:#b86e00">target 15</span>'' end)
      || app_private.disp_tdr_kpi(''Carrier'', w->>''carrier'', ''calls + messages'')
      || app_private.disp_tdr_kpi(''Drivers'', w->>''driver'', ''calls'') || ''</tr><tr>''
      || app_private.disp_tdr_kpi(''E-mails sent'', w->>''sent'', null)
      || app_private.disp_tdr_kpi(''Received'', w->>''received'', null)
      || app_private.disp_tdr_kpi(''Loads booked'', jsonb_array_length(s->''loads'')::text,
           case when jsonb_array_length(s->''loads'') > 0 then ''$'' || to_char((select sum((x->>''gross'')::numeric) from jsonb_array_elements(s->''loads'') x), ''FM999,999,990'') || '' gross'' end)
      || ''</tr></table>'');
  end if;',
                  'v_html := v_html || app_private.disp_tdr_section(''Effort '' || v_when, ''minimum '' || v_min_att || '' call attempts a day'' || case when p_date - v_prev > 1 then '' &middot; '' || to_char(v_prev, ''FMDay FMDD Mon'') || '' to Sunday'' else '''' end,
      ''<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>''
      || app_private.disp_tdr_kpi(''Call attempts'', v_att::text, case when v_att >= v_min_att then ''incl. unanswered &middot; min '' || v_min_att else ''<span style="color:#b86e00">incl. unanswered &middot; min '' || v_min_att || ''</span>'' end)
      || app_private.disp_tdr_kpi(''Voicemails'', coalesce(ef->>''voicemails'',''0''), ''left'')
      || app_private.disp_tdr_kpi(''Messages sent'', coalesce(ef->>''messages'',''0''), ''thread, WhatsApp, SMS'') || ''</tr><tr>''
      || app_private.disp_tdr_kpi(''Broker calls'', coalesce(w->>''broker_calls'',''0''), (w->>''brokers'') || '' broker'' || case when (w->>''brokers'')::int = 1 then '''' else ''s'' end || '' reached'')
      || app_private.disp_tdr_kpi(''Availability posts'', coalesce(ef->>''availability_posts'',''0''), ''trucks updated'')
      || app_private.disp_tdr_kpi(''Load offers sent'', coalesce(ef->>''offers'',''0''), ''bookings created'')
      || ''</tr></table>''
      || ''<div style="'' || F || ''font-size:12px;color:#5c6f8f;margin-top:8px">Effort is yours alone and sets the tone of this report every day. Attempts count whether or not anyone picks up.</div>'');
    v_html := v_html || app_private.disp_tdr_section(''Outcome '' || v_when, coalesce(v_outsub, ''what the market gave back''),
      ''<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>''
      || app_private.disp_tdr_kpi(''Brokers reached'', w->>''brokers'', coalesce(v_outsub, case when (w->>''brokers'')::int >= 15 then ''target 15'' else ''<span style="color:#b86e00">target 15</span>'' end))
      || app_private.disp_tdr_kpi(''Carrier'', w->>''carrier'', coalesce(v_outsub, ''calls + messages''))
      || app_private.disp_tdr_kpi(''Drivers'', w->>''driver'', coalesce(v_outsub, ''calls'')) || ''</tr><tr>''
      || app_private.disp_tdr_kpi(''E-mails sent'', w->>''sent'', null)
      || app_private.disp_tdr_kpi(''Received'', w->>''received'', null)
      || app_private.disp_tdr_kpi(''Loads booked'', jsonb_array_length(s->''loads'')::text,
           coalesce(v_outsub, case when jsonb_array_length(s->''loads'') > 0 then ''$'' || to_char((select sum((x->>''gross'')::numeric) from jsonb_array_elements(s->''loads'') x), ''FM999,999,990'') || '' gross'' end))
      || ''</tr></table>''
      || case when v_flag then ''<div style="'' || F || ''font-size:12px;color:#5c6f8f;margin-top:8px">'' || coalesce(v_flag_names, ''Your carrier'') || '' is unreachable, so outcome is not graded today and does not set the tone.</div>'' else '''' end);
  end if;');
  if n = d then raise exception 'bl_disp_0534: build anchor 7 (activity block) not found'; end if; d := n;

  -- scorecard: while blocked, every row reads "Blocked by carrier" instead of a grade
  n := replace(d, 'v_html := v_html || app_private.disp_tdr_section(case when v_final then ''Your trial scorecard'' else ''Trial scorecard so far'' end,
      ''$'' || to_char(v_gross, ''FM999,999,990'') || '' booked''',
                  'v_html := v_html || app_private.disp_tdr_section(case when v_final then ''Your trial scorecard'' else ''Trial scorecard so far'' end,
      case when v_flag then ''Blocked by carrier &middot; '' else '''' end || ''$'' || to_char(v_gross, ''FM999,999,990'') || '' booked''');
  if n = d then raise exception 'bl_disp_0534: build anchor 8 (scorecard head) not found'; end if; d := n;
  n := replace(d, 'case when v_nloads >= 0.9 * ceil(v_target::numeric * (v_day - 1) / v_days) then ''ok'' else ''behind'' end)',
                  'case when v_flag then ''blocked'' when v_nloads >= 0.9 * ceil(v_target::numeric * (v_day - 1) / v_days) then ''ok'' else ''behind'' end)');
  if n = d then raise exception 'bl_disp_0534: build anchor 9 (score loads) not found'; end if; d := n;
  n := replace(d, 'case when v_nloads = 0 then ''none'' when (cu->>''above_floor'')::int = v_nloads then ''ok'' else ''missed'' end)',
                  'case when v_flag then ''blocked'' when v_nloads = 0 then ''none'' when (cu->>''above_floor'')::int = v_nloads then ''ok'' else ''missed'' end)');
  if n = d then raise exception 'bl_disp_0534: build anchor 10 (score floor) not found'; end if; d := n;
  n := replace(d, 'case when v_nloads = 0 then ''none'' when (cu->>''rc'')::int = v_nloads then ''ok'' else ''behind'' end)',
                  'case when v_flag then ''blocked'' when v_nloads = 0 then ''none'' when (cu->>''rc'')::int = v_nloads then ''ok'' else ''behind'' end)');
  if n = d then raise exception 'bl_disp_0534: build anchor 11 (score rc) not found'; end if; d := n;
  n := replace(d, 'case when v_nloads = 0 then ''none'' when (cu->>''check_calls'')::numeric / v_nloads >= 2 then ''ok'' else ''behind'' end)',
                  'case when v_flag then ''blocked'' when v_nloads = 0 then ''none'' when (cu->>''check_calls'')::numeric / v_nloads >= 2 then ''ok'' else ''behind'' end)');
  if n = d then raise exception 'bl_disp_0534: build anchor 12 (score check calls) not found'; end if; d := n;
  n := replace(d, 'case when (cu->>''dh_miles'')::numeric = 0 then ''none'' when 100.0 * (cu->>''deadhead'')::numeric / ((cu->>''dh_miles'')::numeric + (cu->>''deadhead'')::numeric) <= 15 then ''ok'' else ''missed'' end)',
                  'case when v_flag then ''blocked'' when (cu->>''dh_miles'')::numeric = 0 then ''none'' when 100.0 * (cu->>''deadhead'')::numeric / ((cu->>''dh_miles'')::numeric + (cu->>''deadhead'')::numeric) <= 15 then ''ok'' else ''missed'' end)');
  if n = d then raise exception 'bl_disp_0534: build anchor 13 (score deadhead) not found'; end if; d := n;
  n := replace(d, '|| app_private.disp_tdr_score(''Cancelled loads'', cu->>''cancels'', 100, case when (cu->>''cancels'')::int = 0 then ''ok'' else ''missed'' end)',
                  '|| app_private.disp_tdr_score(''Cancelled loads'', cu->>''cancels'', 100, case when v_flag then ''blocked'' when (cu->>''cancels'')::int = 0 then ''ok'' else ''missed'' end)');
  if n = d then raise exception 'bl_disp_0534: build anchor 14 (score cancels) not found'; end if; d := n;

  -- three moves: one logged attempt a day while blocked
  n := replace(d, 'if v_zero then v_moves := array_append(v_moves, ''Message the carrier today: what happened and your plan''::text); end if;',
                  'if v_flag then v_moves := array_append(v_moves, (''One call to '' || coalesce(v_flag_names, ''the carrier'') || '' today, logged on your line &mdash; LoadBoot has e-mailed them'')::text); end if;
    if v_zero then v_moves := array_append(v_moves, ''Message the carrier today: what happened and your plan''::text); end if;');
  if n = d then raise exception 'bl_disp_0534: build anchor 15 (moves) not found'; end if; d := n;

  -- plain-text twin
  n := replace(d, '|| case when v_kick then '''' else E''\nYour activity '' || v_when || '': brokers '' || (w->>''brokers'')',
                  '|| case when v_kick then '''' else E''\nEffort '' || v_when || '': call attempts '' || v_att || '' (min '' || v_min_att || ''), voicemails '' || coalesce(ef->>''voicemails'',''0'') || '', messages '' || coalesce(ef->>''messages'',''0'') || '', availability posts '' || coalesce(ef->>''availability_posts'',''0'') || '', load offers '' || coalesce(ef->>''offers'',''0'') || E''\n'' end
    || case when v_flag then E''Blocked by carrier: '' || coalesce(ef->>''flagged_carriers'',''your carrier'') || E'' is unreachable - LoadBoot e-mailed them; outcome is not graded and these days are paused.\n'' else '''' end
    || case when v_kick then '''' else E''Outcome '' || v_when || '': brokers '' || (w->>''brokers'')');
  if n = d then raise exception 'bl_disp_0534: build anchor 16 (text) not found'; end if; d := n;

  -- what is stored with the report row
  n := replace(d, '''stats'', s || jsonb_build_object(''target'', v_target, ''window_from''',
                  '''stats'', s || jsonb_build_object(''tone_basis'', ''effort'', ''attempts'', v_att, ''min_attempts'', v_min_att, ''flagged'', v_flag, ''paused_days'', v_paused, ''target'', v_target, ''window_from''');
  if n = d then raise exception 'bl_disp_0534: build anchor 17 (return) not found'; end if; d := n;

  execute d;
end $mig$;

-- ───────────────────────── 4. email_catalog sends counter ─────────────────────────
create index if not exists md_template_key_at_idx on app_private.message_deliveries (template_key, created_at desc);

-- counted at send time, not only when somebody presses Sync
create or replace function app_private.email_catalog_touch(p_key text) returns void
language plpgsql security definer set search_path to 'public', 'app_private' as $$
begin
  if coalesce(btrim(p_key),'') = '' then return; end if;
  insert into app_private.email_catalog(key, discovered_in, first_seen, last_seen, sends_total, sends_30d)
  values (p_key, array['code'], now(), now(), 1, 1)
  on conflict (key) do update set
    sends_total = app_private.email_catalog.sends_total + 1,
    sends_30d   = app_private.email_catalog.sends_30d + 1,
    first_seen  = coalesce(app_private.email_catalog.first_seen, now()),
    last_seen   = now(),
    updated_at  = now();
exception when others then
  return;
end $$;
revoke all on function app_private.email_catalog_touch(text) from public, anon, authenticated;

-- the screen reads the 30-day number from the log itself (the column is a cache that the nightly sync corrects)
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cc_email_catalog(text, text)'::regprocedure);
  n := replace(d, '''sends_total'',c.sends_total,''sends_30d'',c.sends_30d,''last_seen'',c.last_seen,',
    '''sends_total'', greatest(c.sends_total, coalesce((select count(*) from app_private.message_deliveries d0 where d0.template_key = c.key), 0))::int,
      ''sends_30d'', coalesce((select count(*) from app_private.message_deliveries d1 where d1.template_key = c.key and d1.created_at > now() - interval ''30 days''), 0)::int,
      ''last_seen'', coalesce((select max(d2.created_at) from app_private.message_deliveries d2 where d2.template_key = c.key), c.last_seen),');
  if n = d then raise exception 'bl_disp_0534: cc_email_catalog anchor not found'; end if;
  execute n;
end $mig$;

-- one true count every night (03:40 UTC), so sends_30d also decays
do $$ begin
  if exists (select 1 from cron.job where jobname = 'lb-email-catalog-sync') then perform cron.unschedule('lb-email-catalog-sync'); end if;
end $$;
select cron.schedule('lb-email-catalog-sync', '40 3 * * *', $c$select app_private.email_catalog_sync()$c$);
select app_private.email_catalog_sync();   -- and once now, so the screen is right today

-- ───────────────────────── 5. W-9: an e-signed W-9 counts ─────────────────────────
-- 'done' = a reviewed document OR an e-signed W-9 (w9_submissions). 'detail' keeps "Approved" for the document and says
-- "Signed <date>" for the e-signature. The document check is swapped for a marker first so only the 'done' test widens.
do $mig$
declare d text; n text; v_old text := 'exists (select 1 from docs where type=''w9'' and status=''approved'')';
  v_det text := '''detail'', case when exists (select 1 from docs where type=''w9'' and status=''approved'') then ''Approved''';
  v_mark text := '''detail'', case when __W9DOC__ then ''Approved''';
  v_tail text := 'when exists (select 1 from docs where type=''w9'' and status=''pending'') then ''Submitted — LoadBoot is reviewing it'' else ''Not signed'' end)';
begin
  -- the dispatcher's readiness list (p_org)
  d := pg_get_functiondef('app_private.disp_carrier_ready(uuid)'::regprocedure);
  n := replace(d, v_det, v_mark);
  if n = d then raise exception 'bl_disp_0534: disp_carrier_ready w9 detail anchor not found'; end if; d := n;
  n := replace(d, v_tail, 'when exists (select 1 from docs where type=''w9'' and status=''pending'') then ''Submitted — LoadBoot is reviewing it'' when exists (select 1 from app_private.w9_submissions w9 where w9.carrier_id = p_org) then ''Signed '' || to_char((select max(w9.signed_at) from app_private.w9_submissions w9 where w9.carrier_id = p_org) at time zone ''America/New_York'', ''FMDD Mon YYYY'') else ''Not signed'' end)');
  if n = d then raise exception 'bl_disp_0534: disp_carrier_ready w9 tail anchor not found'; end if; d := n;
  n := replace(d, v_old, '(' || v_old || ' or exists (select 1 from app_private.w9_submissions w9 where w9.carrier_id = p_org))');
  if n = d then raise exception 'bl_disp_0534: disp_carrier_ready w9 done anchor not found'; end if; d := n;
  d := replace(d, '__W9DOC__', v_old);
  execute d;

  -- the carrier's own Dispatcher tab (v_org) — the same rows, kept in step
  d := pg_get_functiondef('public.carrier_dispatcher_desk()'::regprocedure);
  n := replace(d, v_det, v_mark);
  if n = d then raise exception 'bl_disp_0534: carrier_dispatcher_desk w9 detail anchor not found'; end if; d := n;
  n := replace(d, v_tail, 'when exists (select 1 from docs where type=''w9'' and status=''pending'') then ''Submitted — LoadBoot is reviewing it'' when exists (select 1 from app_private.w9_submissions w9 where w9.carrier_id = v_org) then ''Signed '' || to_char((select max(w9.signed_at) from app_private.w9_submissions w9 where w9.carrier_id = v_org) at time zone ''America/New_York'', ''FMDD Mon YYYY'') else ''Not signed'' end)');
  if n = d then raise exception 'bl_disp_0534: carrier_dispatcher_desk w9 tail anchor not found'; end if; d := n;
  n := replace(d, v_old, '(' || v_old || ' or exists (select 1 from app_private.w9_submissions w9 where w9.carrier_id = v_org))');
  if n = d then raise exception 'bl_disp_0534: carrier_dispatcher_desk w9 done anchor not found'; end if; d := n;
  d := replace(d, '__W9DOC__', v_old);
  execute d;
end $mig$;

-- ───────────────────────── 3c. subject + verdict speak effort too (seen on the first staging render) ─────────────────────────
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('app_private.disp_trial_daily_build(uuid, date)'::regprocedure);
  n := replace(d, 'when v_tone = ''warn'' then ''Day '' || v_day || '' of '' || v_days || '' · Quiet day: '' || (w->>''brokers'') || '' broker'' || case when (w->>''brokers'')::int = 1 then '''' else ''s'' end || ''. '' || v_left || '' working days left''',
                  'when v_tone = ''bad'' then ''Day '' || v_day || '' of '' || v_days || '' · Low effort: '' || v_att || '' call attempt'' || case when v_att = 1 then '''' else ''s'' end || '' (min '' || v_min_att || ''). '' || v_left || '' working days left''
    when v_tone = ''warn'' then ''Day '' || v_day || '' of '' || v_days || '' · Quiet day: '' || v_att || '' call attempt'' || case when v_att = 1 then '''' else ''s'' end || '' (min '' || v_min_att || ''). '' || v_left || '' working days left''');
  if n = d then raise exception 'bl_disp_0534: build anchor 18 (subject warn) not found'; end if; d := n;
  n := replace(d, 'v_verdict := case v_tone when ''bad'' then ''No activity '' || v_when when ''warn'' then ''Quiet day'' when ''good'' then ''Solid day''',
                  'v_verdict := case v_tone when ''bad'' then case when v_zero then ''No activity '' || v_when else ''Low effort '' || v_when end when ''warn'' then ''Quiet day'' when ''good'' then ''Solid day''');
  if n = d then raise exception 'bl_disp_0534: build anchor 19 (verdict) not found'; end if; d := n;
  execute d;
end $mig$;

-- ───────────────────────── 1c. the dispatcher's line reads as a phone number, not E.164 ─────────────────────────
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('app_private.disp_unreachable_email(uuid, jsonb)'::regprocedure);
  n := replace(d, '|| case when v_line is not null then '' on <b>'' || app_private.disp_esc(v_line) || ''</b>'' else '''' end',
                  '|| case when v_line is not null then '' on <b>'' || regexp_replace(v_line, ''^\+1(\d{3})(\d{3})(\d{4})$'', ''+1 (\1) \2-\3'') || ''</b>'' else '''' end');
  if n = d then raise exception 'bl_disp_0534: unreachable email anchor (line html) not found'; end if; d := n;
  n := replace(d, '|| case when v_line is not null then '' on '' || v_line else '''' end',
                  '|| case when v_line is not null then '' on '' || regexp_replace(v_line, ''^\+1(\d{3})(\d{3})(\d{4})$'', ''+1 (\1) \2-\3'') else '''' end');
  if n = d then raise exception 'bl_disp_0534: unreachable email anchor (line text) not found'; end if; d := n;
  execute d;
end $mig$;

-- CHECK after applying (names, not just the count — docs/audit-2026-09/anon-secdef-baseline.md): 35 staging / 36 prod.
