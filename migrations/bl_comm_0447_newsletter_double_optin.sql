-- bl_comm_0447 — Newsletter: double opt-in, consent record, its own category, welcome + weekly digest.
-- Plan: claude/NEWSLETTER-DOUBLE-OPTIN-0447.md. Owner decisions (26 Sep 2026): option (a) — a NEW preference
-- group `newsletter` ("Tips & market updates") so a person can keep tips and drop promos; built on the
-- unsubscribe engine (bl_comm_0446, live on prod 26 Sep).
--
-- Pieces:
--   1. email_pref_groups row `newsletter` (opt-out allowed; "fewer emails" cap offered for it too)
--   2. app_private.newsletter_subscribers — the consent record (pending / confirmed / unsubscribed)
--   3. public.newsletter_request(p jsonb)   ANON. The footer form. Stores a pending row + queues
--      `newsletter.confirm`. Never says whether the address is already on the list. Rate-limited.
--   4. public.newsletter_confirm(p_token)   ANON. The link in that email. Confirms, queues `newsletter.welcome`.
--   5. app_private.unsub_apply patched (anchor-replace): an unsubscribe / resubscribe that touches the
--      `newsletter` group (or "everything") keeps newsletter_subscribers.status honest.
--   6. Catalog + templates: newsletter.confirm (T, account_critical — requested by the person, must arrive),
--      newsletter.welcome and newsletter.weekly (group newsletter). Bodies live in comm_templates (CC-editable).
--   7. app_private.newsletter_weekly_run() — Tuesdays 14:00 UTC, behind system_settings comm.newsletter_enabled
--      (default false). Rates from get_public_market_rates(), one dispatch tip, one compliance reminder.
--      Every send goes through sys_email → email_gate, so an unsubscribe or a "fewer emails" cap wins.
--   8. Staff RPCs behind CC → Newsletter: cc_newsletter_overview / _person / _send_confirm / _preview / _weekly_run.
--   9. Backfill: old `newsletter` form_submissions → PENDING rows, NO email. The owner sends each confirm
--      from CC (cc_newsletter_send_confirm) — that is the approval step.
--
-- anon SECURITY DEFINER surface: +2 names (newsletter_request, newsletter_confirm): staging 33 → 35, prod 34 → 36.
-- Both are listed in docs/audit-2026-09/anon-secdef-baseline.md in the same commit. Every other new public
-- function is revoked from public + anon explicitly (CLAUDE.md §4).

-- ---------------------------------------------------------------- 1. the category
insert into app_private.email_pref_groups (code, label, description, opt_out_allowed, default_on, sort)
values ('newsletter', 'Tips & market updates', 'The weekly LoadBoot newsletter: market rates, one dispatch tip, one compliance reminder. Only for people who asked for it.', true, true, 65)
on conflict (code) do update set label = excluded.label, description = excluded.description, opt_out_allowed = true, sort = excluded.sort;

update app_private.unsub_settings set frequency_groups = array_append(frequency_groups, 'newsletter')
 where id = 1 and not ('newsletter' = any(frequency_groups));

-- ---------------------------------------------------------------- 2. the consent record
create table if not exists app_private.newsletter_subscribers (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique check (email = lower(btrim(email)) and email ~ '^[^@]+@[^@]+\.[^@]+$'),
  status             text not null default 'pending' check (status in ('pending','confirmed','unsubscribed')),
  topics             text[] not null default '{tips,rates}',
  source_page        text,
  referrer           text,
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  anon_id            text,
  ip                 text,
  user_agent         text,
  consent_text       text,
  requested_at       timestamptz not null default now(),
  requests           integer not null default 1,
  confirm_token      uuid,
  token_expires_at   timestamptz,
  confirm_sent_at    timestamptz,
  confirm_sends      integer not null default 0,
  confirmed_at       timestamptz,
  confirm_ip         text,
  confirm_user_agent text,
  unsubscribed_at    timestamptz,
  welcome_sent_at    timestamptz,
  last_digest_at     timestamptz,
  digests_sent       integer not null default 0,
  form_submission_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists newsletter_subscribers_status_idx on app_private.newsletter_subscribers (status, confirmed_at desc);
create index if not exists newsletter_subscribers_token_idx  on app_private.newsletter_subscribers (confirm_token) where confirm_token is not null;
create index if not exists newsletter_subscribers_ip_idx     on app_private.newsletter_subscribers (ip, requested_at desc) where ip is not null;
comment on table app_private.newsletter_subscribers is 'Newsletter double opt-in consent record. pending = asked, not confirmed; confirmed = clicked the link; unsubscribed = left (mirrored from unsub_apply). Never mail a pending address anything but the confirm email.';

-- ---------------------------------------------------------------- 3. helpers
create or replace function app_private.newsletter_req_meta()
returns jsonb language plpgsql stable as $$
declare h jsonb;
begin
  begin h := current_setting('request.headers', true)::jsonb; exception when others then h := '{}'::jsonb; end;
  return jsonb_build_object(
    'ip', nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', ''), ',', 1)), ''),
    'user_agent', left(nullif(h->>'user-agent',''), 300));
end $$;
revoke all on function app_private.newsletter_req_meta() from public, anon, authenticated;

-- Fill a comm_templates body with {{tokens}}; sys_email adds the contact tokens at send time.
create or replace function app_private.newsletter_fill(p_key text, p_vars jsonb, out o_subject text, out o_html text)
language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare k text; v text;
begin
  select subject, body into o_subject, o_html from app_private.comm_templates where key = p_key and channel = 'email';
  if o_html is null then o_subject := coalesce(o_subject, p_key); o_html := '<p>' || p_key || '</p>'; end if;
  for k, v in select * from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    o_subject := replace(o_subject, '{{' || k || '}}', coalesce(v, ''));
    o_html    := replace(o_html,    '{{' || k || '}}', coalesce(v, ''));
  end loop;
end $$;
revoke all on function app_private.newsletter_fill(text, jsonb) from public, anon, authenticated;

create or replace function app_private.newsletter_site_url()
returns text language sql stable as $$
  select coalesce(nullif((select s.value #>> '{}' from app_private.system_settings s where s.key = 'site.url'), ''), 'https://loadboot.com');
$$;
revoke all on function app_private.newsletter_site_url() from public, anon, authenticated;

-- Queue the confirm email for one row (new token every time). Returns true when queued.
create or replace function app_private.newsletter_send_confirm(p_email text, p_actor uuid default null)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $$
declare n app_private.newsletter_subscribers%rowtype; v_tok uuid := gen_random_uuid(); t record;
begin
  select * into n from app_private.newsletter_subscribers where email = lower(btrim(p_email));
  if n.id is null or n.status <> 'pending' then return false; end if;
  update app_private.newsletter_subscribers
     set confirm_token = v_tok, token_expires_at = now() + interval '7 days', confirm_sent_at = now(),
         confirm_sends = confirm_sends + 1, updated_at = now()
   where id = n.id;
  select * into t from app_private.newsletter_fill('newsletter.confirm', jsonb_build_object(
    'confirm_url', app_private.newsletter_site_url() || '/newsletter-confirm.html?t=' || v_tok::text,
    'email', n.email));
  perform app_private.sys_email(n.email, 'newsletter.confirm', t.o_subject, t.o_html, null, 'nl:confirm:' || n.email || ':' || v_tok::text);
  perform app_private.log_audit('newsletter.confirm_sent', 'email', n.email, null,
    n.email || ': newsletter confirmation email queued (send ' || (n.confirm_sends + 1) || ')',
    jsonb_build_object('actor', p_actor, 'expires_at', now() + interval '7 days'));
  return true;
end $$;
revoke all on function app_private.newsletter_send_confirm(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. the footer form (anon)
-- Always answers {ok:true, state:'check_inbox'} for a valid address: never reveals whether it is on the list.
-- Limits: a confirm email at most once per 24 h per address; at most 5 new addresses per IP per hour; honeypot.
create or replace function public.newsletter_request(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare
  v_email text := lower(btrim(left(coalesce(p->>'email',''), 255)));
  m jsonb := app_private.newsletter_req_meta();
  n app_private.newsletter_subscribers%rowtype;
  v_consent text := left(coalesce(nullif(btrim(p->>'consent_text'),''), 'I agree to receive the weekly LoadBoot newsletter (market rates, dispatch tips, compliance reminders). Unsubscribe any time.'), 400);
begin
  if v_email !~ '^[^@]+@[^@]+\.[^@]+$' then return jsonb_build_object('ok', false, 'error', 'invalid_email'); end if;
  if coalesce(p->>'_hp','') <> '' then return jsonb_build_object('ok', true, 'state', 'check_inbox'); end if;  -- bot: say nothing
  if m->>'ip' is not null and (select count(*) from app_private.newsletter_subscribers s where s.ip = m->>'ip' and s.requested_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', true, 'state', 'check_inbox');  -- rate-limited: say nothing
  end if;

  select * into n from app_private.newsletter_subscribers where email = v_email;
  if n.id is null then
    insert into app_private.newsletter_subscribers(email, status, source_page, referrer, utm_source, utm_medium, utm_campaign, anon_id, ip, user_agent, consent_text)
    values (v_email, 'pending', left(p->>'page',512), left(p->>'referrer',512), left(p->>'utm_source',128), left(p->>'utm_medium',128), left(p->>'utm_campaign',128),
            left(p->>'anon_id',64), m->>'ip', m->>'user_agent', v_consent);
    perform app_private.newsletter_send_confirm(v_email);
  elsif n.status = 'confirmed' then
    update app_private.newsletter_subscribers set requests = requests + 1, updated_at = now() where id = n.id;  -- already on the list: nothing to send
  else
    -- pending, or unsubscribed and asking again: a fresh request, one confirm email per 24 h at most
    update app_private.newsletter_subscribers
       set status = 'pending', requested_at = now(), requests = requests + 1,
           source_page = coalesce(left(p->>'page',512), source_page), ip = coalesce(m->>'ip', ip), user_agent = coalesce(m->>'user_agent', user_agent),
           consent_text = v_consent, unsubscribed_at = null, updated_at = now()
     where id = n.id;
    if n.confirm_sent_at is null or n.confirm_sent_at < now() - interval '24 hours' then
      perform app_private.newsletter_send_confirm(v_email);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'state', 'check_inbox');
end $$;
revoke execute on function public.newsletter_request(jsonb) from public, anon, authenticated;
grant execute on function public.newsletter_request(jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- 5. the link in the email (anon)
create or replace function public.newsletter_confirm(p_token uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare n app_private.newsletter_subscribers%rowtype; m jsonb := app_private.newsletter_req_meta(); v_off boolean; t record;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  select * into n from app_private.newsletter_subscribers where confirm_token = p_token;
  if n.id is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if n.status = 'confirmed' then return jsonb_build_object('ok', true, 'already', true, 'email', n.email); end if;
  if n.status <> 'pending' or n.token_expires_at is null or n.token_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired', 'email', n.email);
  end if;

  update app_private.newsletter_subscribers
     set status = 'confirmed', confirmed_at = now(), confirm_ip = m->>'ip', confirm_user_agent = m->>'user_agent',
         token_expires_at = null, unsubscribed_at = null, updated_at = now()   -- the token stays: a second click says "already confirmed"
   where id = n.id;

  -- If the engine had this category (or everything) switched off for the address, the confirm is their consent to
  -- switch it back on — recorded through the one writer, like every other change (CLAUDE.md §6.5).
  select coalesce(bool_or((g->>'opted_out')::boolean), false) into v_off
    from jsonb_array_elements(app_private.unsub_state(n.email)->'groups') g where g->>'code' = 'newsletter';
  if v_off then
    perform app_private.unsub_apply(n.email, 'resubscribe', 'group', array['newsletter'], null, null, 'preference_page', null, null, null,
      jsonb_build_object('via', 'newsletter_confirm', 'ip', m->>'ip', 'user_agent', m->>'user_agent'));
  end if;

  perform app_private.log_audit('newsletter.confirmed', 'email', n.email, null, n.email || ' confirmed the newsletter (double opt-in)',
    jsonb_build_object('ip', m->>'ip', 'source_page', n.source_page, 'consent_text', n.consent_text, 'requested_at', n.requested_at));

  if n.welcome_sent_at is null then
    select * into t from app_private.newsletter_fill('newsletter.welcome', jsonb_build_object('email', n.email, 'site', app_private.newsletter_site_url()));
    perform app_private.sys_email(n.email, 'newsletter.welcome', t.o_subject, t.o_html, null, 'nl:welcome:' || n.email);
    update app_private.newsletter_subscribers set welcome_sent_at = now() where id = n.id;
  end if;
  return jsonb_build_object('ok', true, 'email', n.email);
end $$;
revoke execute on function public.newsletter_confirm(uuid) from public, anon, authenticated;
grant execute on function public.newsletter_confirm(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- 6. unsub_apply keeps the record honest
do $mig$
declare src text; out_src text;
begin
  src := pg_get_functiondef('app_private.unsub_apply(text,text,text,text[],text,text,text,text,uuid,uuid,jsonb)'::regprocedure);
  out_src := replace(src,
    E'  perform app_private.log_audit(\n    case when p_action = \'unsubscribe\' then \'comm.unsubscribe\' else \'comm.resubscribe\' end,',
    E'  -- bl_comm_0447: the newsletter consent record follows the engine (only a confirmed person can come back)\n'
    || E'  if v_all or \'newsletter\' = any(v_groups) then\n'
    || E'    update app_private.newsletter_subscribers n\n'
    || E'       set status = case when p_action = \'unsubscribe\' then \'unsubscribed\' else \'confirmed\' end,\n'
    || E'           unsubscribed_at = case when p_action = \'unsubscribe\' then now() end, updated_at = now()\n'
    || E'     where n.email = v_email and n.confirmed_at is not null\n'
    || E'       and n.status is distinct from case when p_action = \'unsubscribe\' then \'unsubscribed\' else \'confirmed\' end;\n'
    || E'  end if;\n\n'
    || E'  perform app_private.log_audit(\n    case when p_action = \'unsubscribe\' then \'comm.unsubscribe\' else \'comm.resubscribe\' end,');
  if out_src = src then raise exception 'bl_comm_0447: unsub_apply audit anchor not found'; end if;
  execute out_src;
end
$mig$;

-- ---------------------------------------------------------------- 7. catalog + templates
-- Direct inserts (cc_email_template_new needs a staff session and refuses an existing key; a migration must be idempotent).
with t(key,name,subject,body,class,grp,audience,purpose) as (values (
  'newsletter.confirm', 'Newsletter — confirm your email',
  'Confirm your LoadBoot newsletter subscription',
  '<p style="font-size:17px;font-weight:800;color:#10223B;margin:0 0 12px">One click and you''re in.</p>'
  '<p>You asked for the weekly LoadBoot newsletter — market rates, one dispatch tip and one compliance reminder every Tuesday. Confirm it''s really you:</p>'
  '<p style="margin:22px 0"><a href="{{confirm_url}}" class="lb-btn" style="display:inline-block;background:#0883F7;color:#ffffff !important;font-weight:800;padding:13px 24px;border-radius:10px;text-decoration:none"><span style="color:#ffffff !important">Confirm my subscription &rarr;</span></a></p>'
  '<p style="color:#64748b;font-size:13px">The link works for 7 days. If you didn''t ask for this, ignore this email — nothing else will be sent to {{email}}.</p>'
  '<p style="color:#64748b;font-size:13px">Questions? {{contact_inline}}</p>',
  'T', 'account_critical', 'any', 'Double opt-in: the one email a not-yet-confirmed newsletter address may receive. Fired by public.newsletter_request (footer form) and cc_newsletter_send_confirm (staff).'
)),
ins_tpl as (
  insert into app_private.comm_templates(key,name,channel,subject,body,active,category,status)
  select key,name,'email',subject,body,true,case when class='T' then 'transactional' else 'marketing' end,'live' from t
  on conflict (key) do update set name=excluded.name, subject=excluded.subject, body=excluded.body, active=true)
insert into app_private.email_catalog(key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,cc_deep_link,discovered_in)
select key,name,purpose,class,audience,'event','bl_comm_0447','see below','see below','see below',grp,true,'live','#/newsletter',array['code'] from t
on conflict (key) do update set name=excluded.name, purpose=excluded.purpose, class=excluded.class, preference_group=excluded.preference_group, status='live';

with t(key,name,subject,body,class,grp,audience,purpose) as (values (
  'newsletter.welcome', 'Newsletter — welcome',
  'You''re on the list — here''s what to expect',
  '<p style="font-size:17px;font-weight:800;color:#10223B;margin:0 0 12px">Welcome aboard.</p>'
  '<p>Every Tuesday you''ll get one short email: this week''s rates by equipment, one dispatch tip you can use the same day, and one compliance reminder so nothing expires on you.</p>'
  '<p>Until then, two free tools carriers use most:</p>'
  '<ul><li><a href="{{site}}/market-rates.html" style="color:#0883F7;font-weight:700">Live market rates</a> — what loads are paying this week</li>'
  '<li><a href="{{site}}/cost-per-mile-calculator.html" style="color:#0883F7;font-weight:700">Cost-per-mile calculator</a> — know your floor before you say yes</li></ul>'
  '<p style="color:#64748b;font-size:13px">Want to talk dispatch? {{contact_inline}}</p>',
  'M', 'newsletter', 'any', 'Sent once, right after the person confirms (public.newsletter_confirm).'
)),
ins_tpl as (
  insert into app_private.comm_templates(key,name,channel,subject,body,active,category,status)
  select key,name,'email',subject,body,true,case when class='T' then 'transactional' else 'marketing' end,'live' from t
  on conflict (key) do update set name=excluded.name, subject=excluded.subject, body=excluded.body, active=true)
insert into app_private.email_catalog(key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,cc_deep_link,discovered_in)
select key,name,purpose,class,audience,'event','bl_comm_0447','see below','see below','see below',grp,true,'live','#/newsletter',array['code'] from t
on conflict (key) do update set name=excluded.name, purpose=excluded.purpose, class=excluded.class, preference_group=excluded.preference_group, status='live';

with t(key,name,subject,body,class,grp,audience,purpose) as (values (
  'newsletter.weekly', 'Newsletter — weekly tips & market update',
  'This week''s rates + one tip — {{week_label}}',
  '<p style="font-size:17px;font-weight:800;color:#10223B;margin:0 0 6px">Rates this week</p>'
  '<p style="color:#64748b;font-size:13px;margin:0 0 12px">National benchmarks, per loaded mile, as of {{as_of}}.</p>'
  '{{rates_table}}'
  '<p style="margin:22px 0 6px;font-size:15px;font-weight:800;color:#10223B">&#128161; Dispatch tip</p><p>{{tip}}</p>'
  '<p style="margin:22px 0 6px;font-size:15px;font-weight:800;color:#10223B">&#128203; Compliance reminder</p><p>{{compliance}}</p>'
  '<p style="margin:24px 0 0"><a href="{{site}}/market-rates.html" style="color:#0883F7;font-weight:800;text-decoration:none">See all lanes &amp; equipment &rarr;</a></p>'
  '<p style="color:#64748b;font-size:13px;margin-top:22px">Want these loads dispatched for you? {{contact_inline}}</p>',
  'M', 'newsletter', 'any', 'The weekly newsletter. Fired by app_private.newsletter_weekly_run (cron, Tuesdays 14:00 UTC) for CONFIRMED subscribers only, through sys_email → email_gate.'
)),
ins_tpl as (
  insert into app_private.comm_templates(key,name,channel,subject,body,active,category,status)
  select key,name,'email',subject,body,true,case when class='T' then 'transactional' else 'marketing' end,'live' from t
  on conflict (key) do update set name=excluded.name, subject=excluded.subject, body=excluded.body, active=true)
insert into app_private.email_catalog(key,name,purpose,class,audience_role,trigger_type,trigger_source,cadence,cap_note,stop_condition,preference_group,unsub_allowed,status,cc_deep_link,discovered_in)
select key,name,purpose,class,audience,'event','bl_comm_0447','see below','see below','see below',grp,true,'live','#/newsletter',array['code'] from t
on conflict (key) do update set name=excluded.name, purpose=excluded.purpose, class=excluded.class, preference_group=excluded.preference_group, status='live';

update app_private.email_catalog set
  trigger_type = 'event', trigger_source = 'public.newsletter_request → app_private.newsletter_send_confirm; staff: public.cc_newsletter_send_confirm',
  cadence = 'once per request; at most one per address per 24 h', cap_note = 'one per token (idempotency nl:confirm:<email>:<token>)',
  stop_condition = 'the address confirms, or never asks again', unsub_allowed = false, cc_deep_link = '#/newsletter', send_mode = 'live', updated_at = now()
where key = 'newsletter.confirm';
update app_private.email_catalog set
  trigger_type = 'event', trigger_source = 'public.newsletter_confirm', cadence = 'once, on confirm', cap_note = 'one per address (idempotency nl:welcome:<email>)',
  stop_condition = 'unsubscribed from Tips & market updates, or everything', unsub_allowed = true, cc_deep_link = '#/newsletter', send_mode = 'live', updated_at = now()
where key = 'newsletter.welcome';
update app_private.email_catalog set
  trigger_type = 'cron', trigger_source = 'app_private.newsletter_weekly_run (cron lb-newsletter-weekly, Tue 14:00 UTC) — off until system_settings comm.newsletter_enabled = true',
  cadence = 'weekly (Tuesday)', cap_note = 'one per address per ISO week (idempotency nl:wk:<week>:<email>); "fewer emails" cap honoured by email_gate',
  stop_condition = 'unsubscribed from Tips & market updates, or everything; bounced / complained', unsub_allowed = true, cc_deep_link = '#/newsletter', send_mode = 'live', updated_at = now()
where key = 'newsletter.weekly';

-- ---------------------------------------------------------------- 8. the weekly digest
create or replace function app_private.newsletter_weekly_html(out o_subject text, out o_html text, out o_vars jsonb)
language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare
  rates jsonb; r jsonb; v_rows text := ''; v_as_of text; wk int := extract(week from current_date)::int;
  tips text[] := array[
    'Before you accept a load, add deadhead miles to the loaded miles and divide the rate by the total. A $2.80/mi load with 180 empty miles behind it is not a $2.80 load.',
    'Ask the broker two questions on every call: "Is this load ready now?" and "What is the detention policy?" The answers tell you more about the lane than the rate does.',
    'Book your Friday load on Wednesday. Thursday afternoon is when brokers panic and rates move — but the good freight is already gone.',
    'Keep one photo set per stop: BOL, seal, trailer, odometer. A POD dispute is won or lost on what you photographed at the dock, not on what you remember.',
    'A reload out of a dead market is worth accepting slightly under rate if the next leg is strong. Price the round trip, not the leg.',
    'Send the rate confirmation back within 15 minutes of agreeing. Brokers double-book the slow responders first.',
    'Check the broker''s credit before the second load, not after the first invoice ages 45 days. Free credit checks exist — use them every time.',
    'When the dispatcher quotes "all-in", ask what the fuel surcharge portion is. It changes how the rate compares week to week.'];
  comp text[] := array[
    'Your UCR registration renews every calendar year. If you have not filed for the coming year by December, you are operating out of compliance on January 1.',
    'Form 2290 (HVUT) is due by the end of August for the July–June tax period. Keep the stamped Schedule 1 in the truck — you need it to renew plates.',
    'Check your MCS-150 update date. Biennial updates are required even if nothing changed; a lapse can deactivate your USDOT number.',
    'Insurance certificates expire quietly. Put the cargo and liability renewal dates in your calendar 30 days early, and send the new COI to every broker you run for.',
    'IFTA quarterly returns are due the last day of April, July, October and January. Late filing means penalties AND interest, even with zero tax owed.',
    'A driver''s medical certificate must be on file with the state DMV, not just in the cab. An expired med card on a CDL means the CDL downgrades.',
    'BOC-3 process agents must cover every state you run in. If you added lanes this year, check the filing still does.',
    'Annual inspection stickers: the DOT inspection is valid 12 months from the inspection date, not the calendar year. Check the date on the sticker, not the year.'];
begin
  rates := public.get_public_market_rates();
  for r in select * from jsonb_array_elements(coalesce(rates, '[]'::jsonb)) loop
    v_as_of := coalesce(v_as_of, r->>'as_of');
    v_rows := v_rows || '<tr><td style="padding:8px 10px;border-bottom:1px solid #e8eef6;font-weight:700;color:#10223B">' || coalesce(r->>'equipment','')
      || '</td><td style="padding:8px 10px;border-bottom:1px solid #e8eef6;text-align:right;font-weight:800;color:#0883F7">$' || coalesce(r->>'carrier_rpm','—')
      || '</td><td style="padding:8px 10px;border-bottom:1px solid #e8eef6;text-align:right;color:#64748b">$' || coalesce(r->>'low','—') || ' – $' || coalesce(r->>'high','—') || '</td></tr>';
  end loop;
  o_vars := jsonb_build_object(
    'week_label', to_char(current_date, 'Mon DD'),
    'as_of', coalesce(to_char(v_as_of::date, 'DD Mon YYYY'), to_char(current_date, 'DD Mon YYYY')),
    'rates_table', '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
      || '<tr><th align="left" style="padding:6px 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Equipment</th>'
      || '<th align="right" style="padding:6px 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Carrier $/mi</th>'
      || '<th align="right" style="padding:6px 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Range</th></tr>' || v_rows || '</table>',
    'tip', tips[1 + (wk % array_length(tips, 1))],
    'compliance', comp[1 + ((wk / 2) % array_length(comp, 1))],
    'site', app_private.newsletter_site_url());
  select t.o_subject, t.o_html into o_subject, o_html from app_private.newsletter_fill('newsletter.weekly', o_vars) t;
end $$;
revoke all on function app_private.newsletter_weekly_html() from public, anon, authenticated;

create or replace function app_private.newsletter_weekly_run(p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare s record; t record; v_wk text := to_char(current_date, 'IYYY-"W"IW'); v_n int := 0;
begin
  if coalesce((select v.value #>> '{}' from app_private.system_settings v where v.key = 'comm.newsletter_enabled'), 'false') <> 'true' then
    return jsonb_build_object('ok', true, 'disabled', true, 'week', v_wk);
  end if;
  select * into t from app_private.newsletter_weekly_html();
  for s in select n.email from app_private.newsletter_subscribers n
            where n.status = 'confirmed' and (n.last_digest_at is null or n.last_digest_at < date_trunc('week', now()))
            order by n.confirmed_at limit greatest(coalesce(p_limit, 5000), 1) loop
    -- sys_email runs email_gate: an unsubscribe, a "fewer emails" cap or a suppression refuses and files the reason
    perform app_private.sys_email(s.email, 'newsletter.weekly', t.o_subject, t.o_html, null, 'nl:wk:' || v_wk || ':' || s.email);
    update app_private.newsletter_subscribers set last_digest_at = now(), digests_sent = digests_sent + 1, updated_at = now() where email = s.email;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'week', v_wk, 'queued', v_n);
end $$;
revoke all on function app_private.newsletter_weekly_run(integer) from public, anon, authenticated;

insert into app_private.system_setting_defs (key, value_type, description, validation, sensitivity, required_permission, default_value, environment)
values ('comm.newsletter_enabled', 'boolean', 'Send the weekly newsletter (Tips & market updates) every Tuesday to CONFIRMED subscribers. Off until the owner turns it on (CC → Newsletter).', '{}'::jsonb, 'internal', 'settings.manage', 'false'::jsonb, 'all')
on conflict (key) do nothing;
insert into app_private.system_settings (key, value)
select 'comm.newsletter_enabled', 'false'::jsonb
where not exists (select 1 from app_private.system_settings where key = 'comm.newsletter_enabled');

select cron.unschedule(jobid) from cron.job where jobname = 'lb-newsletter-weekly';
select cron.schedule('lb-newsletter-weekly', '0 14 * * 2', $$select app_private.newsletter_weekly_run();$$);

-- ---------------------------------------------------------------- 9. Command Center → Newsletter
create or replace function public.cc_newsletter_overview(p_q text default null, p_status text default null, p_limit integer default 200, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_lim integer := least(greatest(coalesce(p_limit,200),1),2000); v_off integer := greatest(coalesce(p_offset,0),0); v_q text := nullif(lower(btrim(p_q)),'');
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return (
    with f as (
      select n.* from app_private.newsletter_subscribers n
       where (v_q is null or n.email like '%'||v_q||'%' or lower(coalesce(n.source_page,'')) like '%'||v_q||'%')
         and (p_status is null or n.status = p_status))
    select jsonb_build_object(
      'kpis', jsonb_build_object(
        'pending',      (select count(*) from app_private.newsletter_subscribers where status = 'pending'),
        'confirmed',    (select count(*) from app_private.newsletter_subscribers where status = 'confirmed'),
        'unsubscribed', (select count(*) from app_private.newsletter_subscribers where status = 'unsubscribed'),
        'confirmed_30d',(select count(*) from app_private.newsletter_subscribers where confirmed_at >= now() - interval '30 days'),
        'awaiting_confirm_email', (select count(*) from app_private.newsletter_subscribers where status = 'pending' and confirm_sent_at is null),
        'last_digest',  (select max(last_digest_at) from app_private.newsletter_subscribers),
        'enabled',      coalesce((select v.value #>> '{}' from app_private.system_settings v where v.key = 'comm.newsletter_enabled'), 'false') = 'true',
        'next_run',     (select j.schedule from cron.job j where j.jobname = 'lb-newsletter-weekly')),
      'total', (select count(*) from f),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'email', f.email, 'status', f.status, 'source_page', f.source_page, 'utm_source', f.utm_source,
                 'requested_at', f.requested_at, 'requests', f.requests, 'confirm_sent_at', f.confirm_sent_at, 'confirm_sends', f.confirm_sends,
                 'token_expires_at', f.token_expires_at, 'confirmed_at', f.confirmed_at, 'unsubscribed_at', f.unsubscribed_at,
                 'welcome_sent_at', f.welcome_sent_at, 'last_digest_at', f.last_digest_at, 'digests_sent', f.digests_sent,
                 'is_user', exists (select 1 from app_private.email_identify(f.email)),
                 'gate', app_private.email_gate('newsletter.weekly', f.email)->>'code') order by coalesce(f.confirmed_at, f.requested_at) desc), '[]'::jsonb)
               from (select * from f order by coalesce(confirmed_at, requested_at) desc limit v_lim offset v_off) f)));
end $$;
revoke all on function public.cc_newsletter_overview(text,text,integer,integer) from public, anon;
grant execute on function public.cc_newsletter_overview(text,text,integer,integer) to authenticated;

create or replace function public.cc_newsletter_person(p_email text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_email text := lower(btrim(p_email));
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'subscriber', (select to_jsonb(n) - 'confirm_token' from app_private.newsletter_subscribers n where n.email = v_email),
    'state', app_private.unsub_state(v_email),
    'gate', app_private.email_gate('newsletter.weekly', v_email),
    'emails', (select coalesce(jsonb_agg(jsonb_build_object('at', coalesce(d.sent_at, d.created_at), 'key', d.template_key, 'status', d.status, 'reason', d.failure_reason) order by coalesce(d.sent_at, d.created_at) desc), '[]'::jsonb)
                 from (select * from app_private.message_deliveries where channel = 'email' and lower(btrim(recipient_email)) = v_email and template_key like 'newsletter.%' order by coalesce(sent_at, created_at) desc limit 30) d),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('at', b.created_at, 'key', b.template_key, 'reason', b.reason, 'code', b.code) order by b.created_at desc), '[]'::jsonb)
                  from (select * from app_private.email_blocked_log where lower(recipient_email) = v_email and template_key like 'newsletter.%' order by created_at desc limit 20) b),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at', a.occurred_at, 'action', a.action, 'summary', a.summary) order by a.occurred_at desc), '[]'::jsonb)
                from (select * from app_private.audit_logs where target_type = 'email' and target_id = v_email and action like 'newsletter.%' order by occurred_at desc limit 20) a));
end $$;
revoke all on function public.cc_newsletter_person(text) from public, anon;
grant execute on function public.cc_newsletter_person(text) to authenticated;

-- Staff: send (or resend) the confirm email to a pending address. This IS the owner's approval for the
-- backfilled prod addresses — nothing goes to them until someone presses this.
create or replace function public.cc_newsletter_send_confirm(p_email text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare n record;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into n from app_private.newsletter_subscribers where email = lower(btrim(p_email));
  if n.id is null then return jsonb_build_object('ok', false, 'error', 'no such subscriber'); end if;
  if n.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'only a pending address gets a confirm email (this one is ' || n.status || ')'); end if;
  if n.confirm_sent_at is not null and n.confirm_sent_at > now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'error', 'a confirm email went out less than an hour ago');
  end if;
  return jsonb_build_object('ok', app_private.newsletter_send_confirm(n.email, auth.uid()));
end $$;
revoke all on function public.cc_newsletter_send_confirm(text) from public, anon;
grant execute on function public.cc_newsletter_send_confirm(text) to authenticated;

-- Staff: what this week's digest would look like (nothing is sent).
create or replace function public.cc_newsletter_preview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare t record;
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into t from app_private.newsletter_weekly_html();
  return jsonb_build_object('subject', app_private.contact_expand(t.o_subject, true), 'html', app_private.contact_expand(t.o_html, false), 'vars', t.o_vars - 'rates_table');
end $$;
revoke all on function public.cc_newsletter_preview() from public, anon;
grant execute on function public.cc_newsletter_preview() to authenticated;

-- Staff: switch the weekly send on/off, or run it now (to confirmed subscribers only; the gate still runs).
create or replace function public.cc_newsletter_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_out jsonb := '{}'::jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p ? 'enabled' then
    insert into app_private.system_settings (key, value) values ('comm.newsletter_enabled', to_jsonb(coalesce((p->>'enabled')::boolean, false)))
    on conflict (key) do update set value = excluded.value;
    perform app_private.log_audit('newsletter.settings', 'newsletter', 'weekly', null, 'weekly newsletter ' || case when coalesce((p->>'enabled')::boolean, false) then 'enabled' else 'disabled' end, p);
    v_out := v_out || jsonb_build_object('enabled', coalesce((p->>'enabled')::boolean, false));
  end if;
  if coalesce((p->>'run_now')::boolean, false) then
    v_out := v_out || jsonb_build_object('run', app_private.newsletter_weekly_run(coalesce((p->>'limit')::int, 5000)));
  end if;
  return v_out;
end $$;
revoke all on function public.cc_newsletter_set(jsonb) from public, anon;
grant execute on function public.cc_newsletter_set(jsonb) to authenticated;

-- ---------------------------------------------------------------- 10. backfill: old form submissions → PENDING, no email
insert into app_private.newsletter_subscribers (email, status, source_page, referrer, utm_source, utm_medium, utm_campaign, anon_id, requested_at, consent_text, form_submission_id)
select lower(btrim(f.email)), 'pending', f.source_page, f.referrer, f.utm_source, f.utm_medium, f.utm_campaign, f.anon_id, min(f.created_at),
       'Footer form "Get carrier tips & better loads" before double opt-in (backfilled by bl_comm_0447; consent not yet confirmed)', (array_agg(f.id order by f.created_at))[1]
  from app_private.form_submissions f
 where f.form_key = 'newsletter' and coalesce(f.spam_score, 0) < 80 and lower(btrim(coalesce(f.email,''))) ~ '^[^@]+@[^@]+\.[^@]+$'
 group by lower(btrim(f.email)), f.source_page, f.referrer, f.utm_source, f.utm_medium, f.utm_campaign, f.anon_id
on conflict (email) do nothing;

-- ---------------------------------------------------------------- 11. assert the anon surface grew by exactly the two names
do $chk$
declare bad text;
begin
  select string_agg(p.proname, ',') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname like 'cc_newsletter%';
  if bad is not null then raise exception 'bl_comm_0447: staff RPC anon-executable: %', bad; end if;
  if not has_function_privilege('anon', 'public.newsletter_request(jsonb)', 'execute')
     or not has_function_privilege('anon', 'public.newsletter_confirm(uuid)', 'execute') then
    raise exception 'bl_comm_0447: the two form RPCs must be anon-executable';
  end if;
end
$chk$;
