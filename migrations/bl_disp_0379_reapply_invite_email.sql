-- bl_disp_0379 — "you can apply again, and here is exactly what to close" e-mail.
-- APPLIED staging 21 Sep 2026 (as 0379 + 0379a/b/c/d + 0381, all merged here). PRODUCTION: owner applies.
-- Owner rule, 21 Sep 2026: the test is HOW the candidate finds loads, not whose name the load-board
-- login is in. A board is one route; Facebook/WhatsApp freight groups, brokers they already know,
-- direct shippers and broker e-mail blasts all count, as long as they find the load and book it
-- themselves. The application asks this directly (skills.sourcing_channels, multi-select).
--
-- bl_disp_0378 gave the portal a gated re-application, but the applicants already rejected never
-- learn that it exists. This sends each of them ONE premium e-mail naming their OWN gap and their
-- OWN re-apply date. Never twice (reapply_invite_at), never past the 3-application limit,
-- and DRY BY DEFAULT — cc_dispatcher_reapply_invite sends nothing until p_dry => false.
-- Anon surface untouched: authenticated-only (staging 32 after apply; prod must stay 33).

alter table app_private.dispatcher_profiles
  add column if not exists reapply_invite_at timestamptz;

comment on column app_private.dispatcher_profiles.reapply_invite_at is
  'bl_disp_0379 — when the re-apply invitation was e-mailed. Non-null blocks a second send.';

-- The reason codes staff ticked (bl_disp_0378), or — for anyone rejected before that — derived
-- from the closed application. Mirrors deriveReasons() in app/agent/dispatcher-gaps.js. Capped at 3.
-- NOTE: append with array[...]; `text[] || 'literal'` parses the literal as an array and throws.
-- Owner rule 21 Sep 2026: the subscription need NOT be in the candidate's own name — an employer's
-- or a carrier's login counts, as long as they can log in today and book loads themselves.
-- Legacy applications (before bl_disp_0319) only ever asked about a board in the candidate's OWN
-- name, so someone on an employer's login had to tick "No own access". We cannot conclude they have
-- no board, only that we never asked: board_unknown says so, and asks.
-- NOTE: append with array[...]; `text[] || 'literal'` parses the literal as an array and throws.
create or replace function app_private.disp_gap_codes(p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare d record; v text[] := '{}'; v_boards text; v_ch jsonb; v_legacy boolean; v_has boolean;
begin
  select * into d from app_private.dispatcher_profiles where user_id = p_user;
  if not found then return v; end if;
  if d.reject_reasons is not null and array_length(d.reject_reasons, 1) > 0 then return d.reject_reasons; end if;

  v_boards := coalesce((d.skills->'own_board_access')::text, '');
  v_ch     := case when jsonb_typeof(d.skills->'sourcing_channels') = 'array' then d.skills->'sourcing_channels' else null end;
  v_legacy := v_ch is null and coalesce(d.skills->>'board_status', '') = '';

  if v_ch is not null then
    -- the candidate answered the sourcing question: that answer decides
    v_has := jsonb_array_length(v_ch) > 0
             and not exists (select 1 from jsonb_array_elements_text(v_ch) x where x ~* '^not yet');
  else
    v_has := coalesce(d.skills->>'board_status','') in ('own_paid','employer') or v_boards ~* '(own|employer) login';
  end if;

  -- Legacy rows (before bl_disp_0319) were never asked how they source, only whether the board was
  -- in their OWN name. We cannot conclude they cannot source, only that we never asked: board_unknown
  -- says so, and asks. NOTE: append with array[...]; `text[] || 'literal'` throws.
  if not v_has then
    if v_legacy and coalesce(d.skills->>'can_source_loads','') <> 'learning' then v := v || array['board_unknown'];
    else v := v || array['no_own_board']; end if;
  end if;
  if d.english_level in ('basic','conversational') then v := v || array['english']; end if;
  if coalesce(d.years_exp, 0) < 1 then v := v || array['experience']; end if;
  if (d.skills->>'id_doc') is null then v := v || array['no_id']; end if;
  if (d.skills->>'cv_doc') is null then v := v || array['no_cv']; end if;
  if coalesce(d.skills->>'availability_hours','') = '20-30'
     or coalesce((d.skills->>'us_hours_overlap')::boolean, false) = false then v := v || array['availability']; end if;
  return v[1:3];
end;
$function$;

create or replace function app_private.disp_gap_text(p_code text)
returns text
language sql
immutable
as $function$
  select case p_code
    when 'board_unknown'    then 'How you find loads yourself. When you applied, our form only asked whether you had a load board in <b>your own name</b> — it never asked how you actually source. <b>Any route counts</b>: a board (your own login or an employer''s or carrier''s), Facebook or WhatsApp freight groups, brokers you already know, direct shippers. Tell us which routes you use, where exactly, and two loads you booked.'
    when 'no_own_board'     then 'Finding a load and booking it <b>yourself</b>. It does not have to be a load board in your own name — an employer''s or a carrier''s login, Facebook or WhatsApp freight groups, brokers you already know or direct shippers all count. Tell us which routes you use, where exactly, and two loads you booked.'
    when 'no_booking_proof' then 'Loads you sourced and booked <b>yourself</b>. We ask for two: the lane, the broker, the month and the rate.'
    when 'experience'       then 'US dispatch experience on the record — the carriers and lanes you have run, and how many trucks you kept loaded.'
    when 'english'          then 'English strong enough to <b>negotiate with US brokers by phone</b>. The next round includes a short spoken broker role-play.'
    when 'availability'     then '40+ hours a week, with real overlap with US business hours.'
    when 'no_cv'            then 'A CV we can open and read.'
    when 'no_id'            then 'A government photo ID on file — every LoadBoot dispatcher is verified before a carrier''s account is handed over.'
    when 'inconsistent'     then 'Answers that agree with each other — your last application contradicted itself on load-board access.'
    when 'other'            then 'The point raised in the note we sent you.'
    else null end;
$function$;

-- Builds (and, unless p_dry, sends) the invitation for ONE applicant.
create or replace function app_private.disp_reapply_invite(p_user uuid, p_dry boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  c_cool constant interval := interval '14 days';
  d record; v_mail text; v_when timestamptz; v_open boolean;
  v_codes text[]; v_items text := ''; v_plain text := ''; c text; t text;
  v_html text; v_text text; v_subj text; v_whenline text; v_whenplain text;
begin
  select * into d from app_private.dispatcher_profiles where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no application'); end if;
  if d.status <> 'rejected' then return jsonb_build_object('ok', false, 'reason', 'not_rejected', 'status', d.status); end if;
  if coalesce(d.reapply_count, 0) >= 3 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  if d.reapply_invite_at is not null and not p_dry then return jsonb_build_object('ok', false, 'reason', 'already_invited', 'at', d.reapply_invite_at); end if;
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return jsonb_build_object('ok', false, 'reason', 'no email'); end if;

  v_when := coalesce(d.reviewed_at, now() - c_cool) + c_cool;
  v_open := v_when <= now();

  v_codes := app_private.disp_gap_codes(p_user);
  foreach c in array coalesce(v_codes, '{}'::text[]) loop
    t := app_private.disp_gap_text(c);
    if t is not null then
      v_items := v_items || '<tr><td style="padding:0 0 10px 0;vertical-align:top;width:22px;color:#FC5305;font-weight:800">&#9656;</td>'
                         || '<td style="padding:0 0 10px 0;color:#334155">' || t || '</td></tr>';
      v_plain := v_plain || '  - ' || regexp_replace(t, '<[^>]+>', '', 'g') || E'\n';
    end if;
  end loop;
  if v_items = '' then
    v_items := '<tr><td style="padding:0 0 10px 0;vertical-align:top;width:22px;color:#FC5305;font-weight:800">&#9656;</td>'
            || '<td style="padding:0 0 10px 0;color:#334155">The point raised in the decision we sent you.</td></tr>';
    v_plain := E'  - The point raised in the decision we sent you.\n';
  end if;

  if v_open then
    v_whenline := 'Your application is <b>open now</b> — it reopens pre-filled with everything you told us last time.';
    v_whenplain := 'Your application is open now - it reopens pre-filled with everything you told us last time.';
  else
    v_whenline := 'You can apply again from <b>' || to_char(v_when, 'FMDay, FMDD FMMonth YYYY') || '</b>. Your account and all your answers are kept until then.';
    v_whenplain := 'You can apply again from ' || to_char(v_when, 'FMDay, FMDD FMMonth YYYY') || '. Your account and all your answers are kept until then.';
  end if;

  v_subj := case when v_open then 'You can apply again — LoadBoot dispatcher'
                 else 'Your LoadBoot dispatcher application reopens ' || to_char(v_when, 'FMDD FMMonth') end;

  v_html :=
    '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || '<div style="font-size:11px;letter-spacing:.16em;font-weight:700;color:#0883F7;text-transform:uppercase;margin-bottom:6px">LoadBoot Dispatch &middot; Recruiting</div>'
    || '<div style="font-size:22px;font-weight:800;color:#10223B;letter-spacing:-.01em;margin:0 0 14px">You can apply again — and this time we tell you exactly what to close</div>'
    || '<p style="margin:0 0 12px">Dear ' || coalesce(nullif(btrim(coalesce(d.full_name,'')),''), 'Applicant') || ',</p>'
    || '<p style="margin:0 0 14px">We closed your dispatcher application earlier, and we know that a decision with no clear next step is a frustrating thing to receive. We have rebuilt how this works: your previous answers are saved, your application reopens <b>pre-filled</b>, and we now name plainly what stood in the way.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #FC5305;background:#fff8f2;border-radius:0 10px 10px 0;margin:0 0 16px"><tr><td style="padding:14px 16px">'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#b45309;text-transform:uppercase;margin-bottom:9px">What to close before you apply again</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' || v_items || '</table>'
    || '</td></tr></table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;margin:0 0 16px"><tr><td style="padding:14px 16px">'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px">When</div>'
    || '<div style="color:#334155">' || v_whenline || '</div>'
    || '</td></tr></table>'
    || '<p style="margin:0 0 18px"><a href="https://loadboot.com/app/agent/" style="display:inline-block;background:#0883F7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">Open my application</a></p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;margin:0 0 18px"><tr><td style="padding:14px 16px">'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px">Already closed it?</div>'
    || '<div style="color:#334155">If the point above is already behind you — for example you are already booking loads off a board, out of freight groups or through brokers you know — <b>reply to this e-mail</b> or write to <a href="mailto:hello@loadboot.com" style="color:#0883F7">hello@loadboot.com</a> and tell us what changed. We will look at it again.</div>'
    || '</td></tr></table>'
    || '<p style="margin:0 0 4px">We would genuinely like to see a stronger application from you.</p>'
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b">Recruiting</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because you submitted a dispatcher application at loadboot.com. If you would rather not hear from us again, reply with the word STOP.</p>'
    || '</div>';

  v_text := 'Dear ' || coalesce(nullif(btrim(coalesce(d.full_name,'')),''), 'Applicant') || E',\n\n'
    || E'We closed your dispatcher application earlier. We have rebuilt how re-applying works: your previous answers are saved, your application reopens pre-filled, and we now name plainly what stood in the way.\n\n'
    || E'WHAT TO CLOSE BEFORE YOU APPLY AGAIN\n' || v_plain || E'\n'
    || v_whenplain || E'\n\nOpen your application: https://loadboot.com/app/agent/\n\n'
    || E'Already closed it? Reply to this e-mail or write to hello@loadboot.com and tell us what changed - we will look again.\n\n'
    || E'LoadBoot Dispatch - Recruiting';

  if p_dry then
    return jsonb_build_object('ok', true, 'dry', true, 'to', v_mail, 'name', d.full_name,
      'codes', v_codes, 'open_now', v_open, 'available_at', v_when, 'subject', v_subj, 'html', v_html, 'text', v_text);
  end if;

  perform app_private.sys_email(v_mail, 'dispatcher.reapply_invite', v_subj, v_html, v_text,
    'disp.reapply_invite:' || p_user::text);
  update app_private.dispatcher_profiles set reapply_invite_at = now(), updated_at = now() where user_id = p_user;
  perform app_private.disp_audit('dispatcher.reapply_invite', 'dispatcher', p_user::text, null,
    coalesce(d.full_name,'dispatcher') || ': re-apply invitation sent', jsonb_build_object('codes', v_codes, 'available_at', v_when));
  return jsonb_build_object('ok', true, 'sent', true, 'to', v_mail, 'codes', v_codes, 'available_at', v_when);
end;
$function$;

-- Staff entry point. DRY BY DEFAULT: nothing leaves the building until p_dry => false.
create or replace function public.cc_dispatcher_reapply_invite(p_users uuid[] default null, p_dry boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare u uuid; r jsonb; v_rows jsonb := '[]'::jsonb; v_sent int := 0; v_skip int := 0;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  for u in
    select d.user_id from app_private.dispatcher_profiles d
     where d.status = 'rejected' and coalesce(d.reapply_count,0) < 3
       and (p_dry or d.reapply_invite_at is null)
       and (p_users is null or d.user_id = any (p_users))
     order by d.reviewed_at nulls last
  loop
    r := app_private.disp_reapply_invite(u, p_dry);
    if coalesce((r->>'ok')::boolean, false) then v_sent := v_sent + 1; else v_skip := v_skip + 1; end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'user', u, 'name', r->>'name', 'to', r->>'to', 'codes', r->'codes',
      'open_now', r->'open_now', 'available_at', r->>'available_at', 'subject', r->>'subject',
      'ok', r->'ok', 'reason', r->>'reason'));
  end loop;
  return jsonb_build_object('ok', true, 'dry', p_dry, 'count', v_sent, 'skipped', v_skip, 'rows', v_rows);
end;
$function$;

revoke all on function public.cc_dispatcher_reapply_invite(uuid[], boolean) from public, anon;
grant execute on function public.cc_dispatcher_reapply_invite(uuid[], boolean) to authenticated;

-- bl_disp_0378's validator did not know about board_unknown. Widen it here.
create or replace function public.cc_dispatcher_set_reject_reasons(p_user uuid, p_reasons text[])
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  c_codes constant text[] := array['no_own_board','board_unknown','no_booking_proof','experience','english','availability','no_cv','no_id','inconsistent','other'];
  v_ok text[]; v_name text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select array(select x from unnest(coalesce(p_reasons, '{}'::text[])) x where x = any (c_codes)) into v_ok;
  update app_private.dispatcher_profiles
     set reject_reasons = nullif(v_ok, '{}'::text[]), updated_at = now()
   where user_id = p_user
  returning full_name into v_name;
  if not found then return jsonb_build_object('error','not a dispatcher'); end if;
  perform app_private.disp_audit('dispatcher.reject_reasons', 'dispatcher', p_user::text, null,
    coalesce(v_name,'dispatcher') || ': reject reasons set (' || coalesce(array_to_string(v_ok, ', '), 'cleared') || ')',
    jsonb_build_object('reasons', v_ok));
  return jsonb_build_object('ok', true, 'reasons', v_ok);
end;
$function$;
