-- bl_dial_0362 — LoadBoot Phone Terms (acceptance gate) + the "your phone line is ready" e-mail.
--   * app_private.dialer_terms_acceptances : who accepted which version, when, on what device. Append-only.
--   * dialer_config.terms_version / terms_required. The terms TEXT lives in one place: public.dialer_terms_status().
--   * dialer_token_context refuses a WebRTC token until the CURRENT version is accepted — only while terms_required is true.
--     terms_required defaults to FALSE so applying this migration cannot lock a working phone behind a gate the deployed
--     frontend does not know yet. ORDER ON PROD: migration → deploy frontend → verify the gate screen → set terms_required = true.
--   * cc_dialer_line_upsert e-mails the dispatcher when a NEW line is created for him (not on label / forward edits).
-- Rollback: update app_private.dialer_config set terms_required = false;  (the rest is inert without it)

alter table app_private.dialer_config
  add column if not exists terms_version  int     not null default 1,
  add column if not exists terms_required boolean not null default false;

create table if not exists app_private.dialer_terms_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  version     int  not null,
  accepted_at timestamptz not null default now(),
  device      text,
  unique (user_id, version)
);
alter table app_private.dialer_terms_acceptances enable row level security;   -- no policies: reachable only through the functions below
revoke all on app_private.dialer_terms_acceptances from public, anon, authenticated;

-- The terms. Version 1. Changing any point = bump dialer_config.terms_version and edit the text here in the same migration.
create or replace function app_private.dialer_terms_points() returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('t','Business use only.','b','This line is for LoadBoot freight work: brokers, carriers, drivers, shippers. No personal calls or texts.'),
    jsonb_build_object('t','Recording and monitoring.','b','All calls on this line are recorded and all texts are logged. LoadBoot staff may listen to, read and keep them for quality, training, disputes and legal compliance. You consent to this. Never tell anyone a call is not recorded. If a person objects to being recorded, end the call politely and continue by e-mail or text.'),
    jsonb_build_object('t','Be truthful about who you are.','b','Open every call with your name and that you dispatch with LoadBoot for the carrier concerned — for example: "This is <your name>, dispatching with LoadBoot for <carrier name>." Never pretend to be a carrier owner, a driver, a broker or anyone else. Never alter or hide the caller ID.'),
    jsonb_build_object('t','Dial by hand.','b','No auto-dialers, predictive dialers, robocalls, pre-recorded or AI-voice messages, and no calling lists you bought or scraped.'),
    jsonb_build_object('t','Texts.','b','Text only people you are dealing with about a specific load or truck, or who gave their number for business. No marketing blasts or bulk texts. If someone replies STOP — or asks in any words — never text them again. No content about sex, hate, alcohol, firearms, tobacco or cannabis. Never text bank details, SSNs, passwords or payment card numbers.'),
    jsonb_build_object('t','No harassment or deception.','b','No threats, abuse, repeated calling after being asked to stop, false promises, or anything fraudulent or misleading.'),
    jsonb_build_object('t','Where you can call.','b','United States and Canada only. No premium-rate or international numbers.'),
    jsonb_build_object('t','No emergency calls.','b','This line CANNOT reach 911 or any emergency service. Use your own phone in an emergency.'),
    jsonb_build_object('t','Security.','b','The line is for you alone. Do not share your login, do not let anyone else use it, do not download, copy or share recordings. Report anything suspicious to LoadBoot at once.'),
    jsonb_build_object('t','The number and the records belong to LoadBoot.','b','The number, call history, recordings, texts and contacts are LoadBoot''s business records. When your work with LoadBoot ends, the line is withdrawn and stays with LoadBoot.'),
    jsonb_build_object('t','The law and our provider''s rules.','b','You will follow the US Telephone Consumer Protection Act and Do-Not-Call rules, the Truth in Caller ID Act, federal and state call-recording consent laws, the CTIA messaging rules for business texting, and the acceptable-use policy of LoadBoot''s telephone provider.'),
    jsonb_build_object('t','If you break these terms.','b','LoadBoot may suspend the line immediately and end your trial or engagement. You are responsible for misuse of your line, and LoadBoot may report unlawful use to the people affected, its provider and the authorities.')
  ) $$;

-- dispatcher: what must I accept, and have I?
create or replace function public.dialer_terms_status() returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare v_ver int; v_req boolean; v_at timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  select terms_version, terms_required into v_ver, v_req from app_private.dialer_config where id = 1;
  v_ver := coalesce(v_ver, 1);
  select accepted_at into v_at from app_private.dialer_terms_acceptances where user_id = auth.uid() and version = v_ver;
  return jsonb_build_object('ok', true, 'version', v_ver, 'required', coalesce(v_req,false), 'accepted', v_at is not null, 'accepted_at', v_at,
    'title', 'LoadBoot Phone Terms', 'points', app_private.dialer_terms_points(),
    'consent', 'I have read and accept the LoadBoot Phone Terms, and I consent to my calls being recorded and my texts being logged.');
end $fn$;

create or replace function public.dialer_terms_accept(p_version int, p_device text default null) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_ver int; v_at timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  if not exists (select 1 from app_private.dispatcher_profiles where user_id = auth.uid()) then return jsonb_build_object('error','not a dispatcher'); end if;
  select coalesce(terms_version,1) into v_ver from app_private.dialer_config where id = 1;
  v_ver := coalesce(v_ver, 1);
  if p_version is distinct from v_ver then return jsonb_build_object('error','the terms have changed — reload and read the current version', 'version', v_ver); end if;
  insert into app_private.dialer_terms_acceptances (user_id, version, device) values (auth.uid(), v_ver, nullif(left(coalesce(p_device,''), 300), ''))
    on conflict (user_id, version) do nothing;
  select accepted_at into v_at from app_private.dialer_terms_acceptances where user_id = auth.uid() and version = v_ver;
  perform app_private.disp_audit('dialer.terms_accept', 'dispatcher', auth.uid()::text, null, 'Phone Terms v' || v_ver || ' accepted', jsonb_build_object('version', v_ver));
  return jsonb_build_object('ok', true, 'version', v_ver, 'accepted_at', v_at);
end $fn$;

-- staff: acceptance per dispatcher for the CURRENT version (CC → Phones shows "Terms accepted: date")
create or replace function public.cc_dialer_terms_status() returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $fn$
declare v_ver int; v_req boolean;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select coalesce(terms_version,1), coalesce(terms_required,false) into v_ver, v_req from app_private.dialer_config where id = 1;
  return jsonb_build_object('ok', true, 'version', coalesce(v_ver,1), 'required', coalesce(v_req,false),
    'accepted', coalesce((select jsonb_object_agg(t.user_id::text, t.accepted_at) from app_private.dialer_terms_acceptances t where t.version = coalesce(v_ver,1)), '{}'::jsonb));
end $fn$;

create or replace function public.cc_dialer_terms_required(p_required boolean) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dialer_config set terms_required = coalesce(p_required,false), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform app_private.disp_audit('dialer.terms_required', 'dialer_config', '1', null, 'Phone Terms gate ' || case when p_required then 'ON' else 'OFF' end, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'required', coalesce(p_required,false));
end $fn$;

revoke all on function public.dialer_terms_status(), public.dialer_terms_accept(int,text), public.cc_dialer_terms_status(), public.cc_dialer_terms_required(boolean) from public, anon;
grant execute on function public.dialer_terms_status(), public.dialer_terms_accept(int,text), public.cc_dialer_terms_status(), public.cc_dialer_terms_required(boolean) to authenticated;

-- "Your LoadBoot phone line is ready"
create or replace function app_private.disp_phone_line_email(p_user uuid, p_e164 text) returns void
language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_mail text; v_name text; v_num text := app_private.disp_fmt_us(p_e164); v_html text; v_contact text := app_private.disp_contact()->>'email';
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null or v_num is null then return; end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Phone', 'Your LoadBoot phone line is ready')
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(coalesce(nullif(v_name,''),'Dispatcher')) || ', you now have your own US business line inside your dispatcher workspace. Give this number to brokers and load boards &mdash; calls and texts to it reach you.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700">Your LoadBoot line</div>'
    || '<div style="font-size:26px;font-weight:800;color:#FC5305">' || app_private.disp_esc(v_num) || '</div>'
    || '<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8ea2c3;font-weight:700;margin-top:4px">Calls &middot; voicemail &middot; works in the browser, desktop and mobile</div></td></tr></table>'
    || app_private.disp_box('What it does', '<b>Call</b> any US/Canada number from the keypad, or click any phone number in your workspace. <b>Answer</b> broker call-backs in the browser. '
         || '<b>Voicemail + missed calls</b> land in your Callbacks tab. <b>After each call</b> save the outcome, a note and a call-back reminder. '
         || '<b>Texts</b> from the same number appear in your Texts tab once LoadBoot switches texting on. <b>Ring my mobile</b> (US numbers only) and <b>call alerts</b> are in the phone settings.')
    || app_private.disp_box('First time you open it', 'The phone asks you to read and accept the LoadBoot Phone Terms once. Allow the microphone when the browser asks.')
    || app_private.disp_box('The rules in one breath', 'Business use only. <b>Every call is recorded and every text is logged</b>, and LoadBoot may review them. Say who you are: your name, dispatching with LoadBoot for the carrier. '
         || 'Dial by hand &mdash; no auto-dialers, no mass texts. When someone says stop, stop. <b>No emergency calls &mdash; this line cannot reach 911.</b> The number belongs to LoadBoot and stays with LoadBoot.', 'stop')
    || app_private.disp_btn('Open my phone', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because a LoadBoot phone line was assigned to you.</p></div>';
  perform app_private.sys_email(v_mail, 'dispatcher.phone.line_ready', 'Your LoadBoot phone line is ready — ' || v_num, v_html,
    'Your LoadBoot phone line ' || v_num || ' is ready inside your dispatcher workspace: https://loadboot.com/app/agent/#dashboard . Business use only; every call is recorded and every text is logged; this line cannot reach 911.',
    'disp.phone_line:' || p_user::text || ':' || p_e164);
end $fn$;
revoke all on function app_private.disp_phone_line_email(uuid,text) from public, anon, authenticated;

do $patch$
declare v_def text;
begin
  -- token gate
  v_def := pg_get_functiondef('public.dialer_token_context(uuid)'::regprocedure);
  if position('terms not accepted' in v_def) = 0 then
    if position('if ln.id is null then return jsonb_build_object(''error'',''no line''); end if;' in v_def) = 0 then raise exception '0362: token anchor missing'; end if;
    v_def := replace(v_def, 'if ln.id is null then return jsonb_build_object(''error'',''no line''); end if;',
      'if ln.id is null then return jsonb_build_object(''error'',''no line''); end if;' || E'\n'
      || '  if coalesce(cfg.terms_required,false) and not exists (select 1 from app_private.dialer_terms_acceptances t where t.user_id = p_user and t.version = coalesce(cfg.terms_version,1)) then' || E'\n'
      || '    return jsonb_build_object(''error'',''terms not accepted'',''terms_version'',coalesce(cfg.terms_version,1)); end if;');
    execute v_def;
  end if;
  -- line e-mail, only when a NEW line row is created
  v_def := pg_get_functiondef('public.cc_dialer_line_upsert(jsonb)'::regprocedure);
  if position('disp_phone_line_email' in v_def) = 0 then
    if position('returning id into v_id;' in v_def) = 0 then raise exception '0362: line_upsert anchor missing'; end if;
    v_def := replace(v_def, 'returning id into v_id;', 'returning id into v_id;' || E'\n'
      || '    begin perform app_private.disp_phone_line_email(v_user, e); exception when others then null; end;');
    execute v_def;
  end if;
end $patch$;
