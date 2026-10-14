-- bl_dial_0550 — Carrier emails can carry an SMS (one switch + one text per Email-catalog row).
--
-- Owner plan (14 Oct hand-off): "carrier ki emails ke saath SMS bhi".
--   • email_catalog gets sms_enabled + sms_text. CC → Email catalog → a row → "Text message too" switch + text editor.
--   • app_private.sys_email: AFTER the email row is really queued (every email gate passed: suppression, preference group,
--     unsubscribe, catalog Off/Test), app_private.email_sms_note() puts ONE row on the SMS queue (status 'pending',
--     kind 'email'). So an SMS never goes where the email itself was refused. Email Test mode → no SMS at all.
--     Wrapped in its own exception block: a texting problem can never stop an email.
--   • doc_sms_queue is now the general SMS queue (same worker, same claim, same CC feed). Email rows are 'pending', so the
--     one-open-row-per-carrier index of document texts ('collecting') is untouched.
--   • app_private.email_sms_sweep() (called from doc_sms_sweep, every minute) runs the same gates as document texts:
--     email-SMS switch · master SMS switch · the catalog row still allows it · live sms_consent · STOP · dial_blocked ·
--     test mode (allow_all=false → only test_numbers) · 8 am – 9 pm carrier time (held to 9:00) · daily cap per carrier
--     (doc_sms_config.max_per_day, shared by ALL texts to a carrier; account_critical texts are never held back by the cap
--     but still count) · a sending number. The reason a text did not go is stored and shown in CC.
--   • Never for marketing / lifecycle / outreach: class M or P, preference group marketing/newsletter/product_announcements/
--     digests, or an audience that is not 'carrier' → refused by the setter AND re-checked at sweep time (fail-closed).
--   • Number: the email recipient's own phone when it has live consent, else the carrier's consented owner/admin. The same
--     catalog key to the same number within 6 hours is texted once (an email to two admins = one text).
--   • A docs reminder (carrier.reminder.docs_*) is not texted when a document-decision text went to that carrier in 24 h.
--
-- New public functions: cc_email_sms(text) (comm.view), cc_email_sms_set(text, boolean, text, boolean) (can_manage_comms).
-- Both authenticated only; revoke from public, anon explicit → anon SECDEF surface unchanged (35 staging / 36 prod).
-- Starter texts are written for the 15 keys in the hand-off and switched on per row; NOTHING is texted until the owner turns
-- on "Email texts" in CC → Text messages (doc_sms_config.email_enabled, default false), and real carriers only after
-- "every carrier" (allow_all) — which itself needs a delivered test text.

-- ---------------------------------------------------------------------------------------------------------------
alter table app_private.email_catalog
  add column if not exists sms_enabled    boolean not null default false,
  add column if not exists sms_text       text,
  add column if not exists sms_updated_at timestamptz,
  add column if not exists sms_updated_by uuid;

alter table app_private.doc_sms_config add column if not exists email_enabled boolean not null default false;

alter table app_private.doc_sms_queue
  add column if not exists catalog_key text,
  add column if not exists user_id     uuid,
  add column if not exists idem        text;
alter table app_private.doc_sms_queue drop constraint if exists doc_sms_queue_kind_check;
alter table app_private.doc_sms_queue add constraint doc_sms_queue_kind_check check (kind in ('attention','approved','test','email'));
alter table app_private.doc_sms_queue drop constraint if exists doc_sms_queue_status_check;
alter table app_private.doc_sms_queue add constraint doc_sms_queue_status_check
  check (status in ('collecting','pending','skipped','ready','sending','sent','failed'));
create unique index if not exists doc_sms_queue_idem on app_private.doc_sms_queue (idem) where idem is not null;
create index if not exists doc_sms_queue_to on app_private.doc_sms_queue (to_number, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Which catalog rows may ever have an SMS. null = allowed, else the sentence CC shows.
create or replace function app_private.email_sms_allowed(p_class text, p_group text, p_audience text) returns text
language sql immutable as $$
  select case
    when coalesce(p_class, '') in ('M','P') then 'Marketing and lifecycle emails never get a text.'
    when coalesce(p_group, '') in ('marketing','newsletter','product_announcements','digests')
      then 'Emails in the ' || p_group || ' group never get a text.'
    when coalesce(p_audience, '') !~* '(^|,)\s*carrier\s*(,|$)' then 'Only emails that go to carriers can have a text.'
    else null end
$$;

-- The text as the carrier gets it: later texts (prefix + " Reply STOP to opt out.") and the very first text to a number
-- (prefix + dialer_config.sms_first_msg_suffix, added by sms_consent_guard).
create or replace function app_private.email_sms_shape(p_text text) returns jsonb
language plpgsql stable set search_path to 'app_private', 'public' as $$
declare t text := btrim(coalesce(p_text, '')); sfx text; v_later text; v_first text;
begin
  select sms_first_msg_suffix into sfx from app_private.dialer_config where id = 1;
  v_later := case when t ~* '^loadboot\M' then t else 'LoadBoot: ' || t end;
  v_first := v_later || coalesce(sfx, '');
  if v_later !~* 'reply\s+stop' then v_later := v_later || ' Reply STOP to opt out.'; end if;
  return jsonb_build_object('text', v_later, 'segments', app_private.sms_segments(v_later),
                            'first_text', v_first, 'first_segments', app_private.sms_segments(v_first));
end $$;

-- null = the text is fine, else what is wrong with it.
create or replace function app_private.email_sms_text_problem(p_text text) returns text
language plpgsql stable set search_path to 'app_private', 'public' as $$
declare t text := btrim(coalesce(p_text, ''));
begin
  if t = '' then return 'Write the text first.'; end if;
  if t !~ '^[A-Za-z0-9 @$_!"#%&''()*+,./:;<=>?-]*$' then
    return 'Use plain letters, digits and basic punctuation only (no emoji, curly quotes or long dashes) - one fancy character makes the text 2-3x longer.';
  end if;
  if regexp_replace(t, '\D', '', 'g') ~ '4692537575|2537575' then
    return 'The Riley number (469) 253-7575 may not appear in a text. The text already comes from the main line.';
  end if;
  if t ~* '\{\{' then return 'Texts do not fill {{tokens}} - write the plain words.'; end if;
  if (app_private.email_sms_shape(t)->>'segments')::int > 2 then
    return 'Too long: with "LoadBoot: " and " Reply STOP to opt out." it must fit 2 text segments (306 characters).';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Called from sys_email after the email row was inserted. Never raises to the caller (sys_email wraps it too).
create or replace function app_private.email_sms_note(p_template text, p_user uuid, p_org uuid, p_idem text)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare c app_private.email_catalog; v_org uuid := p_org; v_num text;
begin
  select * into c from app_private.email_catalog where key = p_template;
  if not coalesce(c.sms_enabled, false) or nullif(btrim(coalesce(c.sms_text, '')), '') is null then return; end if;
  if app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role) is not null then return; end if;
  -- While "Email texts" is off nothing is queued (otherwise every carrier email would leave a 'skipped' row in the feed).
  if not coalesce((select x.email_enabled from app_private.doc_sms_config x where x.id = 1), false) then return; end if;

  if v_org is null and p_user is not null then
    select om.org_id into v_org from public.organization_memberships om
     where om.user_id = p_user and om.status = 'active' order by om.created_at limit 1;
  end if;
  if v_org is not null and exists (select 1 from public.organizations o where o.id = v_org and coalesce(o.is_demo, false)) then
    return;
  end if;

  -- The recipient's own number first, then the carrier's consented owner/admin (same order as document texts).
  if p_user is not null then
    select x.e into v_num
      from (select app_private.dial_e164(coalesce(u.raw_user_meta_data->>'phone', '')) e from auth.users u where u.id = p_user) x
      join app_private.sms_consent sc on sc.number = x.e and sc.revoked_at is null;
  end if;
  if v_num is null and v_org is not null then
    select m.e into v_num
      from (select app_private.dial_e164(coalesce(u.raw_user_meta_data->>'phone', '')) e, om.member_role, om.created_at
              from public.organization_memberships om join auth.users u on u.id = om.user_id
             where om.org_id = v_org and om.status = 'active') m
      join app_private.sms_consent sc on sc.number = m.e and sc.revoked_at is null
     order by (m.member_role in ('owner','admin')) desc nulls last, m.created_at
     limit 1;
  end if;

  -- One text per key per number (or per carrier when nobody has a number) in 6 hours.
  if exists (select 1 from app_private.doc_sms_queue q
              where q.kind = 'email' and q.catalog_key = p_template and q.created_at > now() - interval '6 hours'
                and ((v_num is not null and q.to_number = v_num) or (v_num is null and q.to_number is null and q.org_id is not distinct from v_org)
                     or (v_num is null and v_org is null and q.user_id is not distinct from p_user))) then
    return;
  end if;

  insert into app_private.doc_sms_queue (org_id, user_id, status, due_at, kind, catalog_key, body, to_number, idem, decisions)
  values (v_org, p_user, 'pending', now(), 'email', p_template, btrim(c.sms_text), v_num,
          'email:' || coalesce(p_idem, p_template || ':' || coalesce(p_user::text, '') || ':' || extract(epoch from now())::bigint::text),
          '[]'::jsonb)
  on conflict (idem) where idem is not null do nothing;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Every minute (from doc_sms_sweep): pending email texts → ready / skipped / held for quiet hours.
create or replace function app_private.email_sms_sweep() returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare cfg app_private.doc_sms_config; dc app_private.dialer_config; q app_private.doc_sms_queue; c app_private.email_catalog;
  v_tz text; v_local timestamp; why text; v_full text; v_first boolean; sfx text; v_sender boolean;
  n_done int := 0; n_ready int := 0;
begin
  if not exists (select 1 from app_private.doc_sms_queue where status = 'pending' and due_at <= now()) then
    return jsonb_build_object('processed', 0, 'ready', 0);
  end if;
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  sfx := dc.sms_first_msg_suffix;
  v_sender := cfg.from_e164 is not null
           or exists (select 1 from app_private.dialer_lines l where l.id = cfg.line_id and l.status = 'active');

  for q in select * from app_private.doc_sms_queue where status = 'pending' and due_at <= now()
           order by due_at limit 50 for update skip locked loop
    c := null;
    select * into c from app_private.email_catalog where key = q.catalog_key;

    why := case
      when not coalesce(cfg.email_enabled, false) then 'Email texts are switched off (CC → Text messages → Email texts).'
      when not (coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false)) then 'Text messaging is switched off (dialer_config.sms_enabled).'
      when c.key is null or not coalesce(c.sms_enabled, false) then 'The text for this email was switched off in the Email catalog.'
      when app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role) is not null
        then app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role)
      when q.to_number is null then 'No SMS consent: nobody on this account has ticked the text-message box for their number.'
      when exists (select 1 from app_private.dialer_sms_optout o where o.number = q.to_number) then 'This number replied STOP.'
      when not exists (select 1 from app_private.sms_consent s where s.number = q.to_number and s.revoked_at is null)
        then 'SMS consent was withdrawn for this number.'
      when app_private.dial_blocked(q.to_number, false) is not null then app_private.dial_blocked(q.to_number, false)
      when not coalesce(cfg.allow_all, false) and not (q.to_number = any(cfg.test_numbers)) then 'Test mode: only the test number(s) get texts.'
      when not v_sender then 'No sending number is set (CC → Text messages → Main line).'
      when q.catalog_key like 'carrier.reminder.docs%' and q.org_id is not null and exists (
             select 1 from app_private.doc_sms_queue x where x.org_id = q.org_id and x.kind in ('attention','approved')
                and x.status in ('ready','sending','sent') and x.updated_at > now() - interval '24 hours')
        then 'A document-decision text already went to this carrier today.'
      else null end;

    if why is null then
      v_tz := coalesce(nullif(case when q.org_id is null then null else app_private.riley_plan_tz(q.org_id) end, ''), 'America/Chicago');
      v_local := now() at time zone v_tz;
      if extract(hour from v_local) < 8 or extract(hour from v_local) >= 21 then
        update app_private.doc_sms_queue
           set due_at = (date_trunc('day', v_local) + case when extract(hour from v_local) >= 21 then interval '1 day 9 hours' else interval '9 hours' end) at time zone v_tz,
               reason = 'Held for quiet hours: texts go 8 am - 9 pm carrier time (' || v_tz || ').', updated_at = now()
         where id = q.id;
        continue;
      end if;
      if coalesce(c.preference_group, '') <> 'account_critical' and q.org_id is not null
         and (select count(*) from app_private.doc_sms_queue x where x.org_id = q.org_id and x.kind is distinct from 'test'
               and x.status in ('ready','sending','sent') and x.updated_at > now() - interval '24 hours') >= coalesce(cfg.max_per_day, 3) then
        why := 'Daily limit reached: ' || coalesce(cfg.max_per_day, 3) || ' texts to this carrier in 24 hours.';
      end if;
    end if;

    v_full := null; v_first := null;
    if q.to_number is not null then
      v_full := app_private.sms_compose(q.body, q.to_number)->>'body';
      select (s.confirmation_sent_at is null) into v_first from app_private.sms_consent s where s.number = q.to_number and s.revoked_at is null;
      if coalesce(v_first, true) and sfx is not null and position(sfx in v_full) = 0 then v_full := v_full || sfx; end if;
    end if;

    update app_private.doc_sms_queue
       set status = case when why is null then 'ready' else 'skipped' end, reason = why,
           preview = coalesce(v_full, app_private.email_sms_shape(q.body)->>'text'),
           segments = app_private.sms_segments(coalesce(v_full, app_private.email_sms_shape(q.body)->>'text')),
           updated_at = now()
     where id = q.id;
    n_done := n_done + 1;
    if why is null then n_ready := n_ready + 1; end if;
  end loop;
  return jsonb_build_object('processed', n_done, 'ready', n_ready);
end $$;

revoke all on function app_private.email_sms_allowed(text, text, text) from public, anon, authenticated;
revoke all on function app_private.email_sms_shape(text) from public, anon, authenticated;
revoke all on function app_private.email_sms_text_problem(text) from public, anon, authenticated;
revoke all on function app_private.email_sms_note(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_private.email_sms_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- sys_email: queue the text only when the email row was really inserted (FOUND after ON CONFLICT DO NOTHING) and the
-- catalog row is not in Test mode.
do $p$
declare d text;
  a text := $a$  on conflict (idempotency_key) do nothing;
end $a$;
begin
  d := pg_get_functiondef('app_private.sys_email(text,text,text,text,text,text)'::regprocedure);
  if position('email_sms_note' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0550: anchor not found in sys_email'; end if;
  d := replace(d, a, $b$  on conflict (idempotency_key) do nothing;

  -- bl_dial_0550: the catalog row may carry a text too (carrier emails only). Never blocks or fails the email.
  if found and v_mode = 'live' then
    begin
      perform app_private.email_sms_note(p_template, v_user, v_org,
        coalesce(p_idem, 'sys:'||p_template||':'||v_real_to||':'||extract(epoch from now())::bigint::text));
    exception when others then null;
    end;
  end if;
end $b$);
  execute d;
end $p$;

-- doc_sms_sweep: run the email texts too (before the worker ping), and the cap sentence covers every text now.
do $p$
declare d text;
  a1 text := $a$  if cfg.worker_url is not null and (n_ready > 0$a$;
  a2 text := $a$' document texts to this carrier in 24 hours.'$a$;
begin
  d := pg_get_functiondef('app_private.doc_sms_sweep()'::regprocedure);
  if position('email_sms_sweep' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'bl_dial_0550: anchor not found in doc_sms_sweep'; end if;
  d := replace(d, a1, $b$  -- bl_dial_0550: texts that ride with a carrier email.
  begin n_ready := n_ready + coalesce((app_private.email_sms_sweep()->>'ready')::int, 0);
  exception when others then raise warning 'email_sms_sweep: %', sqlerrm; end;
$b$ || a1);
  d := replace(d, a2, $b$' texts to this carrier in 24 hours.'$b$);
  execute d;
end $p$;

-- Claim: an email text checks the email-text switch + its catalog row; every non-test text re-checks test mode.
do $p$
declare d text;
  a text := $a$      if q.kind is distinct from 'test' and not coalesce(cfg.enabled, false) then
        raise exception 'Document texts were switched off before the send.'; end if;$a$;
begin
  d := pg_get_functiondef('public.doc_sms_worker_claim(integer)'::regprocedure);
  if position('bl_dial_0550' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0550: anchor not found in doc_sms_worker_claim'; end if;
  d := replace(d, a, $b$      -- bl_dial_0550: email texts have their own switch and their catalog row.
      if q.kind = 'email' then
        if not coalesce(cfg.email_enabled, false) then raise exception 'Email texts were switched off before the send.'; end if;
        if not exists (select 1 from app_private.email_catalog ec where ec.key = q.catalog_key and ec.sms_enabled
                         and app_private.email_sms_allowed(ec.class, ec.preference_group, ec.audience_role) is null) then
          raise exception 'The text for this email was switched off before the send.'; end if;
      elsif q.kind is distinct from 'test' and not coalesce(cfg.enabled, false) then
        raise exception 'Document texts were switched off before the send.'; end if;
      if q.kind is distinct from 'test' and not coalesce(cfg.allow_all, false) and not (q.to_number = any(cfg.test_numbers)) then
        raise exception 'Test mode: this number is not on the test list.'; end if;$b$);
  execute d;
end $p$;

-- ---------------------------------------------------------------------------------------------------------------
-- CC Text messages: the email-text switch, pending rows, and which email a text belongs to.
do $p$
declare d text;
  a1 text := $a$'debounce_minutes', cfg.debounce_minutes$a$;
  a2 text := $a$'keys', (select coalesce(jsonb_agg(distinct d->>'key'), '[]'::jsonb) from jsonb_array_elements(q.decisions) d))
              order by q.created_at desc)$a$;
  a3 text := $a$jsonb_build_object('key', 'doc', 'ok', coalesce(cfg.enabled, false)),$a$;
begin
  d := pg_get_functiondef('public.cc_sms_center()'::regprocedure);
  if position('email_enabled' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'bl_dial_0550: anchor not found in cc_sms_center'; end if;
  d := replace(d, a1, $b$'email_enabled', coalesce(cfg.email_enabled, false), $b$ || a1);
  d := replace(d, a2, $b$'catalog_key', q.catalog_key, $b$ || a2);
  d := replace(d, a3, a3 || $b$
       jsonb_build_object('key', 'email', 'ok', coalesce(cfg.email_enabled, false)),$b$);
  d := replace(d, $a$status in ('collecting','ready','sending')$a$, $a$status in ('collecting','pending','ready','sending')$a$);
  execute d;
end $p$;

do $p$
declare d text;
  a text := $a$    enabled      = coalesce((p->>'enabled')::boolean, enabled),$a$;
begin
  d := pg_get_functiondef('public.cc_doc_sms_config_set(jsonb)'::regprocedure);
  if position('email_enabled' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0550: anchor not found in cc_doc_sms_config_set'; end if;
  d := replace(d, a, a || $b$
    email_enabled = coalesce((p->>'email_enabled')::boolean, email_enabled),   -- bl_dial_0550$b$);
  execute d;
end $p$;

-- CC Email catalog list: the SMS state per row.
do $p$
declare d text;
  a text := $a$'send_mode',coalesce(c.send_mode,'live'),'test_to',c.test_to,'send_mode_note',c.send_mode_note$a$;
begin
  d := pg_get_functiondef('public.cc_email_catalog(text,text)'::regprocedure);
  if position('sms_enabled' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_dial_0550: anchor not found in cc_email_catalog'; end if;
  d := replace(d, a, a || $b$,
      'sms_enabled',coalesce(c.sms_enabled,false),
      'sms_possible',app_private.email_sms_allowed(c.class,c.preference_group,c.audience_role) is null$b$);
  execute d;
end $p$;

-- ---------------------------------------------------------------------------------------------------------------
-- CC Email catalog → a row → "Text message too": read.
create or replace function public.cc_email_sms(p_key text) returns jsonb
language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare c app_private.email_catalog; cfg app_private.doc_sms_config; dc app_private.dialer_config;
begin
  if not public.has_global_permission('comm.view') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into c from app_private.email_catalog where key = p_key;
  if c.key is null then raise exception 'unknown template key' using errcode = '22023'; end if;
  select * into cfg from app_private.doc_sms_config where id = 1;
  select * into dc  from app_private.dialer_config where id = 1;
  return jsonb_build_object('ok', true, 'key', c.key,
    'enabled', coalesce(c.sms_enabled, false), 'text', c.sms_text, 'updated_at', c.sms_updated_at,
    'not_allowed', app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role),
    'problem', case when c.sms_text is null then null else app_private.email_sms_text_problem(c.sms_text) end,
    'shape', case when c.sms_text is null then null else app_private.email_sms_shape(c.sms_text) end,
    'switches', jsonb_build_object('email_texts', coalesce(cfg.email_enabled, false),
                                   'sms', coalesce(dc.enabled, false) and coalesce(dc.sms_enabled, false),
                                   'test_mode', not coalesce(cfg.allow_all, false), 'max_per_day', cfg.max_per_day),
    'kpi', (select jsonb_build_object(
              'sent_30d', count(*) filter (where status = 'sent'),
              'skipped_30d', count(*) filter (where status = 'skipped'),
              'failed_30d', count(*) filter (where status = 'failed'))
              from app_private.doc_sms_queue where kind = 'email' and catalog_key = c.key and created_at > now() - interval '30 days'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status, 'reason', q.reason, 'carrier', o.name,
               'to', case when q.to_number is null then null else '***' || right(q.to_number, 4) end,
               'created_at', q.created_at, 'sent_at', q.sent_at, 'due_at', q.due_at, 'msg_status', m.status, 'body', q.preview)
             order by q.created_at desc)
        from (select * from app_private.doc_sms_queue where kind = 'email' and catalog_key = c.key order by created_at desc limit 20) q
        left join public.organizations o on o.id = q.org_id
        left join app_private.dialer_messages m on m.id = q.message_id), '[]'::jsonb));
end $$;

-- Write (or preview with p_dry). Validation is the same in both, so the editor shows the real problem before saving.
create or replace function public.cc_email_sms_set(p_key text, p_enabled boolean, p_text text, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare c app_private.email_catalog; t text := nullif(btrim(coalesce(p_text, '')), ''); v_no text; v_problem text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into c from app_private.email_catalog where key = p_key;
  if c.key is null then raise exception 'unknown template key' using errcode = '22023'; end if;
  v_no := app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role);
  v_problem := case when t is null then (case when coalesce(p_enabled, false) then 'Write the text first.' end)
                    else app_private.email_sms_text_problem(t) end;
  if coalesce(p_dry, false) then
    return jsonb_build_object('ok', v_problem is null and (v_no is null or not coalesce(p_enabled, false)),
      'problem', coalesce(case when coalesce(p_enabled, false) then v_no end, v_problem),
      'shape', case when t is null then null else app_private.email_sms_shape(t) end);
  end if;
  if coalesce(p_enabled, false) and v_no is not null then return jsonb_build_object('error', v_no); end if;
  if v_problem is not null then return jsonb_build_object('error', v_problem); end if;
  update app_private.email_catalog
     set sms_enabled = coalesce(p_enabled, false), sms_text = t, sms_updated_at = now(), sms_updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  return jsonb_build_object('ok', true, 'key', p_key, 'enabled', coalesce(p_enabled, false),
                            'shape', case when t is null then null else app_private.email_sms_shape(t) end);
end $$;

revoke all on function public.cc_email_sms(text) from public, anon;
revoke all on function public.cc_email_sms_set(text, boolean, text, boolean) from public, anon;
grant execute on function public.cc_email_sms(text) to authenticated;
grant execute on function public.cc_email_sms_set(text, boolean, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Starter texts (hand-off list). "LoadBoot: " and " Reply STOP to opt out." are added at send time. Only rows that pass
-- email_sms_allowed are switched on; nothing goes out until CC → Text messages → Email texts is on.
with s(key, txt) as (values
  ('dispatcher.assigned.carrier',     'Your dispatcher has been assigned. Their name and how to reach them are in your email and here: https://loadboot.com/app/carrier/#dispatcher'),
  ('dispatcher.changed.carrier',      'Your dispatcher has changed - your truck stays covered. See who is handling it now: https://loadboot.com/app/carrier/#dispatcher'),
  ('dispatcher.carrier.unreachable',  'Your dispatcher has been trying to reach you about loads. Please check your email or open: https://loadboot.com/app/carrier/#dispatcher'),
  ('account.pause',                   'Your account has been paused. The reason and how to fix it are in your email and here: https://loadboot.com/app/carrier/#account'),
  ('account.violation',               'A policy notice was added to your account. Please read it in your email or here: https://loadboot.com/app/carrier/#account'),
  ('authority_lapsed',                'FMCSA shows your operating authority as not active, so load posting is paused. Details: https://loadboot.com/app/carrier/#documents'),
  ('carrier.reminder.confirm_email',  'Your account is not activated yet. Please open the confirmation email we sent you (check spam too) and tap the link.'),
  ('carrier.reminder.docs_start',     'Brokers cannot see you until you are verified. Upload your documents here: https://loadboot.com/app/carrier/#documents'),
  ('carrier.reminder.docs_finish',    'You are almost verified - a few documents are left. Finish here: https://loadboot.com/app/carrier/#documents'),
  ('carrier.reminder.docs_fix',       'One of your documents needs a correction. See what to change: https://loadboot.com/app/carrier/#documents'),
  ('carrier.reminder.truck_add',      'Your account is ready, but your truck is not in it yet. Add it here: https://loadboot.com/app/carrier/#fleet/add-truck'),
  ('carrier.reminder.truck_continue', 'You started adding your truck - it is still saved. Finish here: https://loadboot.com/app/carrier/#fleet'),
  ('carrier.reminder.driver_add',     'Your truck is in. Now add a driver for it: https://loadboot.com/app/carrier/#fleet/add-driver'),
  ('carrier.reminder.avail_start',    'Tell your dispatcher where your truck is and when it is free, so they can find loads: https://loadboot.com/app/carrier/#availability'),
  ('carrier.reminder.avail_continue', 'Your truck availability is out of date. Update it so loads keep coming: https://loadboot.com/app/carrier/#availability'),
  ('carrier.reminder.avail_confirm',  'Is your truck still available today? Confirm in one tap: https://loadboot.com/app/carrier/#availability')
)
update app_private.email_catalog c
   set sms_text = s.txt,
       sms_enabled = app_private.email_sms_allowed(c.class, c.preference_group, c.audience_role) is null
                     and app_private.email_sms_text_problem(s.txt) is null,
       sms_updated_at = now(), updated_at = now()
  from s
 where c.key = s.key and c.sms_text is null;
